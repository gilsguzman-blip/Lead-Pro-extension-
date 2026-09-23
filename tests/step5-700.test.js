#!/usr/bin/env node
'use strict';
// (v9.7.700) PHASE 2 STEP 5 — M4 (lead-independent rules above the cache breakpoint) and Gil's distance
// ruling ("I don't want the model mentioning 'since you're 30 miles away' or 'since you're an hour away'.
// That pushes away the customer from making the drive."). Runs the WHOLE popup.js + auth.js in a vm.
//
// Usage: node tests/step5-700.test.js <dev popup.js> <commercial popup.js>
const path = require('path');
const vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: step5-700.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const pad = (n) => String(n).padStart(2, '0');
const entry = (m, d, t, k, ti, b) => '[' + pad(m) + '/' + pad(d) + '/2026 ' + t + '] [' + k + '] ' + ti + '\n  ' + b + '\n';
const tr = (e) => e.join('') + '=== CURRENT LEAD SUBMITTED HERE ===\n' + entry(7, 30, '9:00 AM', 'NOTE', 'Lead Received', 'Internet lead');
// The 23 lines M4 moves, by their first 40 characters.
const MOVED = ['⚠ RELATIVE DATE AGING IN NOTES AND TEXTS', '⚠ THE CUSTOMER\'S OWN DAY WORDS AGE THE SA', '- Write three formats: SMS, email (with s',
  '- SMS: first-name opener, specific and su', '- Email: match the depth of the customer\'', '- Voicemail: 20-30 seconds, natural speec',
  '- NEVER fabricate vehicle specs, prices, ', '- CLARIFYING QUESTIONS must be logically ', '- TRADE-IN: Only discuss a trade if the c',
  '- DO NOT introduce topics the customer ha', '- LOGISTICAL CONSTRAINTS — CHECK THE FULL', '- NEVER use the sales rep name as the sig',
  '- LANGUAGE: ALL responses are written in ', '- EMOTIONAL CALIBRATION: If the customer\'', 'OTD / PAYMENT DISCIPLINE (all stores): Do',
  'EMAIL FORMAT RULES:', '- Greeting: Use the customer first name o', '- After greeting: blank line, then body s', '- CORRECT (first touch): "Jose,',
  '- CORRECT (follow-up): "Hi Ashley,', '- Paragraphs: one blank line between para', '- Signature: each part on its own line — ',
  'Email signature: Use line breaks between '];
const hasLine = (text, key) => text.split('\n').some(l => l.startsWith(key));

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const prompt = (d0) => { const d = Object.assign({ agent: 'Agent Name', phone: '(555) 010-0199', email: 'test@example.com', relationshipSignals: {} }, d0);
    const c = tr(d._e || []); delete d._e; d.context = c; vm.runInContext('leadContext = ' + JSON.stringify(c) + ';', sb); return sb.__lp.buildUserPrompt(d); };
  const live = prompt({ name: 'Test Buyer', vehicle: '2026 Honda CR-V EX', leadSource: 'Cars.com', dealerId: '6191', store: 'Community Honda Baytown',
    leadAgeDays: 0, convState: 'active-follow-up', hasCustomerReply: true, hasOutbound: true, lastInboundMsg: 'Can I come see it today?',
    _e: [entry(9, 23, '9:05 AM', 'CUSTOMER', 'Inbound Text Message', 'Received from: (555) 010-0199\n  Can I come see it today?')] });
  const heads = ['bdc', 'sales', 'concierge', 'internet_director', 'manager'].map(p => { const s = sb.__lp.buildSystemPrompt(p); return s.slice(0, s.indexOf('⟦LP_CACHE_BREAKPOINT⟧')); });

  console.log(' M4 — the lead-independent rules sit above the cache breakpoint:');
  check('all 23 moved lines are in the cached head of the system prompt', () => MOVED.filter(k => !hasLine(heads[0], k)).length, 0);
  check('...and none of them is left in the user prompt', () => MOVED.filter(k => hasLine(live, k)), []);
  check('the cached head is byte-identical across all five personas', () => heads.every(h => h === heads[0]), true);
  check('the user prompt points at them from HARD CONSTRAINTS', () => /━━━ HARD CONSTRAINTS ━━━\n- Every STANDING RULE in your system prompt applies to this message\./.test(live), true);
  check('the lead-specific constraints stay in the user prompt (source naming, vehicle naming)', () => [/- HOW THIS LEAD REACHED US:/.test(live), /- NEVER mention a specific vehicle model/.test(live)], [true, true]);
  check('the three deal-condition-gated time rules stay where the FINAL CLOSE RULE can follow them',
    () => [/^Only offer appointment times that fall within/m.test(live), /^CLOSED DAYS ARE NEVER OFFERED/m.test(live), /^TIME-OFFER VARIETY:/m.test(live)], [true, true, true]);
  check('YOUR TASK and THE CUSTOMER\'S OWN MESSAGES ARE THE RECORD stay (they point at their own position)',
    () => [/━━━ YOUR TASK ━━━/.test(live), /━━━ THE CUSTOMER'S OWN MESSAGES ARE THE RECORD ━━━/.test(live)], [true, true]);
  check('the JSON instruction is still in the user prompt\'s tail', () => /Return ONLY the JSON object \{"sms"/.test(live.slice(-2500)), true);

  console.log(' distance — never stated, on any lead (Gil, 9/23):');
  const RULE = /DISTANCE: never tell a customer how far they are from us — no miles, no drive time, no "since you're 30 miles away", "since you're an hour away"/;
  check('the rule is in the cached head, for every persona (Audi\'s concierge included)', () => heads.every(h => RULE.test(h)), true);
  check('...and in the SMS refine pass, which does not see the main brief', () => RULE.test(sb.buildSystemPromptSmsRefine('Agent', 'Audi Lafayette', '(555) 010-0199')), true);
  const remote = prompt({ name: 'Far Buyer', vehicle: '2026 Honda Pilot', leadSource: 'Cars.com', dealerId: '6191', store: 'Community Honda Baytown',
    leadAgeDays: 1, convState: 'active-follow-up', hasCustomerReply: true, hasOutbound: true, customerState: 'OK', customerZip: '73101', isDistanceBuyer: true,
    lastInboundMsg: 'Can you ship it to Oklahoma?', _e: [entry(9, 23, '9:05 AM', 'CUSTOMER', 'Inbound Text Message', 'Received from: (555) 010-0199\n  Can you ship it to Oklahoma?')] });
  check('an out-of-state buyer is no longer told to "acknowledge the distance once"', () => /acknowledge the distance/i.test(remote), false);
  check('...and still gets the remote path', () => /make the remote path easy/.test(remote), true);
  const fs = require('fs');
  const code = fs.readFileSync(f, 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  check('the distance block\'s own example no longer talks about "your trip"', () => /make sure your trip is productive/.test(code), false);
  check('populate\'s dead distance push (never reached a prompt) is gone', () => /It is appropriate to acknowledge the distance ONCE/.test(code), false);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
