#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('audi-sold-881.test.js');
// (v9.7.881) AUDI LAFAYETTE NEVER TELLS A CUSTOMER A VEHICLE SOLD. Owner, 11/18: the Audi sold message "contradicts the rule about not
// disclosing a vehicle had been sold at Audi". Lead 2115371024 (Drive By, a pause, 11/17): "I'm sorry the Q5 you considered had just
// sold" (thumbs-down) and the regeneration "the 2026 Audi Q5 Premium Plus you explored sold, so it's no longer available". Executes
// _lpHouseGuard (the render chain's store guard), populateFromData and buildUserPrompt through the panel payload, and
// _lpBuildSmsRefinePrompt. Placeholder data only.
//
// Usage: node tests/audi-sold-881.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: audi-sold-881.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const AUDI = { dealerId: '21135', store: 'Audi Lafayette' }, HONDA = { dealerId: '24399', store: 'Community Honda Lafayette' };
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const at = (store, t, ch) => quiet(() => { sb.__S = store; vm.runInContext('lastScrapedData = Object.assign({}, globalThis.__S);', sb); return vm.runInContext('_lpHouseGuard', sb)(t, ch || 'sms'); });

  console.log(' the drafts, at render:');
  check('lead 2115371024\'s first draft: the sale sentence goes, the name opener stays',
    () => at(AUDI, 'Test, I’m sorry the Q5 you considered had just sold. When you’re ready, Rep Name can help find another option. I’m here as your Concierge whenever it’s useful.'),
    'Test, when you’re ready, Rep Name can help find another option. I’m here as your Concierge whenever it’s useful.');
  check('...its regeneration ("you explored sold, so it\'s no longer available") the same',
    () => at(AUDI, 'Test, the 2026 Audi Q5 Premium Plus you explored sold, so it’s no longer available. I understand you’re not ready to move forward, and there’s no pressure.'),
    'Test, I understand you’re not ready to move forward, and there’s no pressure.');
  check('...and the email: the sentence goes, the greeting, the rest and the sign-off stay',
    () => at(AUDI, 'Subject: When you’re ready\n\nHi Test,\n\nI understand you’re not quite ready. I’m sorry the vehicle you considered had just sold.\n\nWhen you’re ready, Rep Name can help.\n\nAgent Name', 'email'),
    'Subject: When you’re ready\n\nHi Test,\n\nI understand you’re not quite ready.\n\nWhen you’re ready, Rep Name can help.\n\nAgent Name');
  check('"on hold" and "spoken for" are a status too -> removed', () => at(AUDI, 'Test, the A5 is on hold for another buyer right now. I can show you two similar A5s today.'), 'Test, I can show you two similar A5s today.');
  check('control: a purchase of their own ("congratulations ... sold it to you") stays', () => at(AUDI, 'Test, congratulations on your new Q5! The team sold it to you with everything ready.'), 'Test, congratulations on your new Q5! The team sold it to you with everything ready.');
  check('control: another store keeps its sold news (the policy is Audi Lafayette\'s)', () => at(HONDA, 'Test, the CR-V you asked about has sold. We have a similar one here.'), 'Test, the CR-V you asked about has sold. We have a similar one here.');

  console.log(' the prompt and the text rewrite:');
  const lead = (x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Audi Q5 Premium Plus', condition: 'New', dealerId: '21135',
    store: 'Audi Lafayette', leadSource: 'Drive By', convState: 'pause', leadAgeDays: 2, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 6, phone: '(555) 010-0199', email: 'test@example.com',
    relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 1 }, conversationBrief: '', history: '', context: '', autoLeadId: 'TEST009J' }, x || {});
  const prompt = (d) => quiet(() => { vm.runInContext('activeFlags = new Set(); leadContext = "";', sb); sb.__L = d; vm.runInContext('lastScrapedData = globalThis.__L;', sb); sb.populateFromData(d);
    return String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: d, context: String(vm.runInContext('leadContext', sb) || '') }))); });
  check('every Audi prompt carries the store rule, with no inventory flag raised', () => /STORE POLICY \(Audi Lafayette\): never tell a customer that a vehicle is sold, on hold, pending, spoken for or no longer available/.test(prompt(lead())), true);
  check('control: not at another store', () => /STORE POLICY \(Audi Lafayette\)/.test(prompt(lead(Object.assign({ vehicle: '2026 Honda CR-V EX' }, HONDA)))), false);
  const rf = (d, email) => quiet(() => String(vm.runInContext('_lpBuildSmsRefinePrompt', sb)('Test, the Q5 has sold. Rep Name can help you find another.', email, d)));
  const EM = 'Hi Test,\n\nThe Q5 you considered has sold. Rep Name can help you find another.\n\nAgent Name';
  const rA = rf(lead(), EM);
  check('the text rewrite at Audi: the rule, and no "THE VEHICLE THEY ASKED ABOUT HAS SOLD" section even when the email says it', () => [/STORE POLICY \(Audi Lafayette\): never tell the customer a vehicle is sold/.test(rA), /THE VEHICLE THEY ASKED ABOUT HAS SOLD/.test(rA)], [true, false]);
  check('control: at another store the rewrite still delivers the sale first', () => /THE VEHICLE THEY ASKED ABOUT HAS SOLD/.test(rf(lead(HONDA), EM)), true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
