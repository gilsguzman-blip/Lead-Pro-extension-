#!/usr/bin/env node
'use strict';
// (v9.7.698) PHASE 2 STEP 3 — PROMPT HYGIENE (audit M3, M5, M6, M7).
//
// These run the WHOLE shipped popup.js in a vm sandbox (tests/helpers/load-popup.js) and call the
// real buildUserPrompt on a lead object, so what is asserted is the prompt the model would receive,
// not a regex over the source. Leads are synthetic, with placeholder names and a 555-01xx number.
//
// Usage: node tests/prompt-hygiene-698.test.js <dev popup.js> <commercial popup.js>
const path = require('path');
const vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: prompt-hygiene-698.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const pad = (n) => String(n).padStart(2, '0');
function entry(m, d, t, kind, title, body) { return '[' + pad(m) + '/' + pad(d) + '/2026 ' + t + '] [' + kind + '] ' + title + '\n  ' + body + '\n'; }
function transcript(entries) {
  return entries.join('') + '=== CURRENT LEAD SUBMITTED HERE ===\n' + entry(7, 30, '9:00 AM', 'NOTE', 'Lead Received', 'Internet lead');
}
// Ten outbound on this lead, no reply: seven texts/emails and three voicemails.
const OUTREACH = [
  entry(9, 20, '10:00 AM', 'AGENT', 'Outbound Text Message', 'Hi Test, checking in on the Carnival.'),
  entry(9, 14, '7:40 PM', 'AGENT', 'Email reply to prospect', 'Subject: Your Carnival\n  Hi Test, a note on the Carnival.'),
  entry(9, 10, '4:35 PM', 'CALL NOTE', 'Outbound phone call (Machine)', 'By: Agent Name\n  Left message'),
  entry(9, 9, '4:35 PM', 'CALL NOTE', 'Outbound phone call (Machine)', 'By: Agent Name\n  Left message'),
  entry(9, 8, '4:35 PM', 'CALL NOTE', 'Outbound phone call (Machine)', 'By: Agent Name\n  Left message'),
  entry(9, 7, '4:48 PM', 'AGENT', 'Outbound Text Message', 'Hi Test, any questions on the Carnival?'),
  entry(8, 30, '1:00 PM', 'AGENT', 'Email reply to prospect', 'Subject: Following up\n  Hi Test, following up.'),
  entry(8, 20, '2:00 PM', 'AGENT', 'Outbound Text Message', 'Hi Test, still around?'),
  entry(8, 10, '2:00 PM', 'AGENT', 'Email reply to prospect', 'Subject: Options\n  Hi Test, options.'),
  entry(8, 1, '2:00 PM', 'AGENT', 'Outbound Text Message', 'Hi Test, welcome.'),
];
const BASE = { name: 'Test Customer', firstName: 'Test', vehicle: '2026 Kia Carnival LX FWD', leadSource: 'Internet',
  dealerId: '6190', store: 'Community Kia Baytown', agent: 'Agent Name', phone: '(555) 010-0199', email: 'test@example.com' };

function prompt(sb, header, data) {
  const c = header + transcript(data._entries);
  vm.runInContext('leadContext = ' + JSON.stringify(c) + ';', sb);
  const d = Object.assign({}, BASE, data, { context: c });
  delete d._entries;
  return sb.__lp.buildUserPrompt(d);
}
const n = (p, s) => p.split(s).length - 1;

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }

  // ── A zero-contact stalled lead, 55 days, 10 outreaches, never replied ──────────────────
  // The header is what populateFromData puts at the top of the context on such a lead (its
  // v9.7.698 wording; an older build's own header does not change what buildUserPrompt adds).
  const zc = prompt(sb, '🚫 ZERO-CONTACT LEAD: this customer has not replied to any of our outreach on this lead.\n\n⚠ STALLED LEAD: This lead has been open for 55 days.\n\n',
    { _entries: OUTREACH, leadAgeDays: 55, convState: 'stalled', hasCustomerReply: false, _isStalled: true, _neverReplied: true, hasOutbound: true,
      relationshipSignals: { totalOutboundCount: 10, leadOutboundCount: 10, totalInboundCount: 0 } });
  console.log(' M5 — zero-contact stalled lead (executed buildUserPrompt):');
  check('the STALLED LEAD RE-ENGAGEMENT phase block renders, once', () => n(zc, 'STALLED LEAD RE-ENGAGEMENT'), 1);
  check('...and it carries the appointment ban', () => /DO NOT offer appointment times\. DO NOT write duration\./.test(zc), true);
  check('the ZERO-CONTACT RE-ENGAGEMENT block is gone', () => n(zc, 'ZERO-CONTACT RE-ENGAGEMENT'), 0);
  check('"GOAL: Get their first reply. Nothing else." (contradicted PHASE 5) is gone', () => n(zc, 'GOAL: Get their first reply'), 0);
  check('the hedged NO APPOINTMENT TIME (UNLESS…) block stands down', () => n(zc, 'NO APPOINTMENT TIME (UNLESS'), 0);
  check('VARY YOUR ANGLE and ONE-SIDED stand down (the phase block says both)', () => [n(zc, 'VARY YOUR ANGLE:'), n(zc, 'ONE-SIDED CONVERSATION:')], [0, 0]);
  check('the appointment ban is now stated by ONE block', () => n(zc, 'DO NOT offer appointment times') + n(zc, 'No appointment times') + n(zc, 'do NOT offer a specific appointment time'), 1);

  console.log(' M3 — scenarioRules once:');
  check('the SITUATION line appears once, not twice', () => n(zc, '📋 SITUATION'), 1);
  check('the scenario judgment line appears once, not twice', () => n(zc, 'Read the conversation and use judgment'), 1);

  console.log(' M6 — format rules:');
  check('no Duration line and no APPOINTMENT TIME FORMAT on a lead offered no times', () => [n(zc, 'Duration to state before times'), n(zc, 'APPOINTMENT TIME FORMAT')], [0, 0]);
  check('the SMS signature rule no longer contradicts the LEAD section', () => [n(zc, 'agent first name only + phone number'), n(zc, 'SMS signature: the stacked block given in the LEAD section')], [0, 1]);
  check('the JSON instruction names the subject field the parser reads', () => n(zc, 'Return ONLY the JSON object {"sms":"...","email":"...","subject":"...","voicemail":"..."}'), 1);

  // ── CONTROL: an engaged lead that asks to come in — times ARE offered ──────────────────
  const live = prompt(sb, '', { _entries: [entry(9, 23, '9:05 AM', 'CUSTOMER', 'Inbound Text Message', 'Received from: (555) 010-0199\n  Is the Carnival still available? I could come look at it.'),
      entry(9, 23, '8:40 AM', 'AGENT', 'Outbound Text Message', 'Hi Test, thanks for reaching out about the Carnival.')],
    leadAgeDays: 0, convState: 'active-follow-up', hasCustomerReply: true, _isStalled: false, _neverReplied: false, hasOutbound: true,
    lastInboundMsg: 'Is the Carnival still available? I could come look at it.',
    relationshipSignals: { totalOutboundCount: 1, leadOutboundCount: 1, totalInboundCount: 1 } });
  console.log(' controls — an engaged lead (executed):');
  check('times are offered, so Duration and APPOINTMENT TIME FORMAT still render', () => [n(live, 'Duration to state before times'), n(live, 'APPOINTMENT TIME FORMAT')], [1, 1]);
  check('...beside the suggested times they format', () => /Option: /.test(live) || /would .* or .* work\?/.test(live), true);

  // ── CONTROL: replied once long ago, then ten unanswered outreaches — not zero-contact ───
  const quiet = prompt(sb, '⚠ STALLED LEAD: This lead has been open for 55 days.\n\n', {
    _entries: OUTREACH.concat([entry(7, 31, '9:00 AM', 'CUSTOMER', 'Inbound Text Message', 'Received from: (555) 010-0199\n  Thanks, I will look at it this weekend.')]),
    leadAgeDays: 55, convState: 'stalled', hasCustomerReply: true, _isStalled: true, _neverReplied: false, hasOutbound: true,
    relationshipSignals: { totalOutboundCount: 10, leadOutboundCount: 10, totalInboundCount: 1 } });
  console.log(' controls — a customer who replied once, then went quiet (executed):');
  check('VARY YOUR ANGLE still renders: the phase block is not there to own it', () => [n(quiet, 'VARY YOUR ANGLE:'), n(quiet, 'STALLED LEAD RE-ENGAGEMENT')], [1, 0]);

  // ── LOG240: THE LEASE-MATURITY BRANCH HAD NO FOLLOW-UP ARM ───────────────────────────────
  // A one-day-old AFS off-lease lead with outreach already sent and a Contacted call where the
  // customer said they have not decided. The draft opened with the maturity and re-listed the options.
  const lmData = (fu) => ({ _entries: fu ? [
      entry(9, 22, '12:23 PM', 'CALL NOTE', 'Outbound phone call (Contacted)', 'By: Agent Name\n  has not figured out what to do just yet, said they need to talk about it'),
      entry(9, 22, '10:40 AM', 'AGENT', 'Email reply to prospect', 'Subject: Your Q5\n  Hi Test, your Q5 agreement ends in about three months. You can return it, purchase it, or move into another Audi.'),
      entry(9, 22, '10:05 AM', 'AGENT', 'Outbound Text Message', 'Hi Test, your Q5 agreement is coming up in about three months.')] : [],
    name: 'Test Customer', firstName: 'Test', vehicle: '2024 Audi Q5 Sportback S line Premium Plus', leadSource: 'Afs - Off Lease In 3 Months',
    dealerId: '21135', store: 'Audi Lafayette', leadAgeDays: 1, convState: fu ? 'active-follow-up' : 'first-touch',
    hasCustomerReply: false, hasOutbound: fu, isContacted: fu, _hcaAccountType: 'lease',
    relationshipSignals: { totalOutboundCount: fu ? 2 : 0, leadOutboundCount: fu ? 2 : 0, totalInboundCount: 0 } });
  const lmFu = prompt(sb, '', lmData(true));
  const lmFirst = prompt(sb, '', lmData(false));
  console.log(' Log240 — lease-maturity follow-up (executed):');
  check('a follow-up says PRIOR OUTREACH already made', () => /transition lead with PRIOR OUTREACH already made/.test(lmFu), true);
  check('...and no longer tells the model to open with the lease end, or that it is the hook',
    () => [/Open by acknowledging their current vehicle and the upcoming lease end/.test(lmFu), /matures in approximately 3 months -- this is the hook/.test(lmFu)], [false, false]);
  check('...it points at the latest exchange, call notes included', () => /Build on the latest exchange, including anything the customer said on a call/.test(lmFu), true);
  check('...and keeps the facts that stop a wrong message: their own vehicle, never in stock; figures unverified',
    () => [/NEVER say it is in stock, available, or on the lot/.test(lmFu), /UNVERIFIED lender projections/.test(lmFu)], [true, true]);
  check('control: the FIRST touch still opens with the maturity and names it the hook',
    () => [/Open by acknowledging their current vehicle and the upcoming lease end/.test(lmFirst), /this is the hook/.test(lmFirst), /PRIOR OUTREACH/.test(lmFirst.split('━━━ SCENARIO ━━━')[1] || '')], [true, true, false]);

  // ── M7 ─────────────────────────────────────────────────────────────────────────────────
  const fs = require('fs');
  const code = fs.readFileSync(f, 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  console.log(' M7 — the NO CUSTOMER REPLY YET digest (source):');
  check('no "a specific detail about the vehicle or trade"', () => /about the vehicle or trade, or a softer/.test(code), false);
  check('no "feel like a different person picked up the thread"', () => /different person picked up the thread/.test(code), false);
  console.log(' repeat customer — same missing follow-up arm (source):');
  check('the repeat-customer branch forks on isFollowUp && hasRealOutbound, and only the first touch "acknowledges the relationship immediately"',
    () => /var rcFollowUp = sc\.isFollowUp && hasRealOutbound;/.test(code)
       && /scenarioRules = \(rcFollowUp \? \[[\s\S]{0,400}do not re-open with it/.test(code), true);
  check('the CRITICAL different-agent line stays', () => /CRITICAL: Do NOT say "I left a voicemail" or "I called earlier" unless YOU are the agent/.test(code), true);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
