#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('open-questions-760.test.js');
// (v9.7.760) Kia Baytown lead 2091734847, 10/5 (log279). On 9/30 the customer asked to itemize "the 832.50 in dealer fees"
// and said "if you can get the dealer discount to $5,000 ... I'd be ready". By 10/5 that EV9 had sold. The main prompt
// listed the fee question as open ("address it directly"), the text rewrite was told to answer it first, and the deal
// trigger said "engage the number directly", while the SOLD notice in the same prompt said "do not work it, quote it,
// or re-run its numbers". The text that shipped opened "I'll get you an itemized breakdown of the $832.50 in fees".
// Gil: acknowledge it sold and pivot. When this message is the one telling them (the NEWS variant of the notice), the
// sold deal's number questions leave both open-question lists and the deal trigger stands down.
// Also (v9.7.760) Kia Baytown, 10/5 (log280): on a lead opened 9/25/2026 the open-question resolver listed two questions
// from 10/07/2023, about the Forte she bought then ("Do we need a steering wheel lock?", "Is this particular model/year
// susceptible to being stolen?"), and the text opened "I can't confirm whether this model year is susceptible to theft".
// A question dated before the current-lead marker belongs to an earlier lead and is not open on this one. (v9.7.761) On
// the same lead the marker was absent (a phone-up lead) and the DOM Created date did not parse; the CRM's LeadCreatedUTC
// now bounds it too.
// Executes the shipped buildUserPrompt, _lpBuildSmsRefinePrompt and the scraper's detectUnansweredQuestions (lifted, as
// open-thread-resolver does). Placeholder data only.
//
// Usage: node tests/open-questions-760.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: open-questions-760.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const DAY = 86400000, NOW = Date.now();
const fmt = (ms) => { const f = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  .formatToParts(new Date(ms)).reduce((o, p) => (o[p.type] = p.value, o), {}); return f.month + '/' + f.day + '/' + f.year + ' ' + f.hour + ':' + f.minute + ' ' + f.dayPeriod.toUpperCase(); };
const T_C = NOW - 5 * DAY, D_C = fmt(T_C);
const COND = 'If you can get the dealer discount to $5,000 while keeping the incentive, I would be ready to finalize.';
const FEES = 'Can you itemize the 832 in fees? So I can compare?';
const NEWS = '🔴 VEHICLE STATUS: SOLD — this specific unit is no longer available. Do not work it, quote it, or re-run its numbers. Tell the customer once, plainly, and pivot to comparable options.';
const TOLD = '🔴 VEHICLE STATUS: SOLD — and the transcript shows the customer was ALREADY TOLD. Do NOT re-announce it.';
const transcript = 'CONVERSATION TRANSCRIPT (newest first):\n---\n'
  + '[' + fmt(NOW - 0.2 * DAY) + '] [AGENT] Outbound Text Message\n  Test, just checking in on the EV9.\n'
  + '[' + D_C + '] [CUSTOMER] Inbound Text Message\n  ' + FEES + '\n'
  + '[' + fmt(T_C - 600000) + '] [CUSTOMER] Inbound Text Message\n  ' + COND + '\n'
  + '[' + fmt(T_C - DAY) + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n---\n';
const UQ = [{ date: D_C, question: 'Can you itemize the 832 in fees?' }, { date: D_C, question: 'So I can compare?' }];
// The fields the scraper's relationship signals carry (the reading only renders with them).
const sig = (uq) => ({ unansweredQuestions: uq, hasUnansweredQuestions: uq.length > 0, customerCommitments: [], agentCommitments: [],
  lastInboundAgeDays: 4.9, totalInboundCount: 19, totalOutboundCount: 40, consecutiveOutboundNoReply: 11, channelFatigue: true });
const lead = (notice, extra) => Object.assign({ name: 'Test Buyer', agent: 'Agent Name', phone: '(555) 010-0199', email: 'test@example.com',
  vehicle: '2026 Kia EV9 Light Long Range', stockNum: 'TEST001A', dealerId: '6190', store: 'Community Kia Baytown', leadSource: 'Dealer E-Process - General Sales',
  convState: 'active-follow-up', hasOutbound: true, hasCustomerReply: true, totalNoteCount: 69, leadAgeDays: 5, inventoryWarning: !!notice,
  context: (notice ? notice + '\n\n' : '') + transcript, conversationBrief: transcript, lastInboundMsg: FEES,
  relationshipSignals: sig(UQ.slice()) }, extra || {});

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const sb = loadPopup(f, { withAuth: true });
  const prompt = (d) => { vm.runInContext('leadContext = ""; window._lpNoApptLeadId = ""; window._lpSuppressApptChip = false;', sb); return sb.__lp.buildUserPrompt(d); };
  const refine = (d) => { sb.__d = d; vm.runInContext('leadContext = "";', sb);
    return vm.runInContext('_lpBuildSmsRefinePrompt("Test, the EV9 you asked about has sold. A 2026 EV9 Land is here.\\nAgent", "Subject: EV9\\n\\nHi Test,\\n\\nThe EV9 has sold.\\n\\nAgent Name", globalThis.__d)', sb); };
  const p1 = prompt(lead(NEWS)), r1 = refine(lead(NEWS));

  console.log(' 1. lead 2091734847 shape: the unit sold and this message tells them:');
  check('main prompt: the fee question is no longer listed as possibly unanswered',
    () => /Customer asked question\(s\) that may not have been answered:[^\n]*itemize the 832/.test(p1), false);
  check('...instead: "about that deal\'s numbers ... SOLD, so they are moot", pivot, offer numbers on the alternative',
    () => /Their earlier questions about that deal's numbers \("Can you itemize the 832 in fees\?"[^\n]*were about the vehicle that has SOLD, so they are moot: do NOT promise, send or itemize those figures/.test(p1), true);
  check('text rewrite: no "QUESTIONS OF THEIRS THAT ARE STILL OPEN" with the fee question; the sold section instead',
    () => [/QUESTIONS OF THEIRS THAT ARE STILL OPEN/.test(r1), /THE VEHICLE THEY ASKED ABOUT HAS SOLD/.test(r1)], [false, true]);
  check('...the sold section names the fee question, and "So I can compare?" (same message) is not listed as open',
    () => [/THE VEHICLE THEY ASKED ABOUT HAS SOLD[\s\S]{0,80}itemize the 832/.test(r1), /^\s+- "So I can compare\?"/m.test(r1)], [true, false]);
  check('the deal trigger stands down: no "engage the number directly" for the sold car\'s $5,000 condition',
    () => /The customer put a SPECIFIC DEAL CONDITION on the table/.test(p1), false);

  console.log(' 2. controls:');
  const p0 = prompt(lead('', { inventoryWarning: false })), r0 = refine(lead('', { inventoryWarning: false }));
  check('control: unit not sold -> the fee question stays open in both prompts',
    () => [/may not have been answered:[^\n]*itemize the 832/.test(p0), /QUESTIONS OF THEIRS THAT ARE STILL OPEN[\s\S]{0,80}itemize the 832/.test(r0)], [true, true]);
  check('control: unit not sold -> the deal trigger still fires on the condition', () => /The customer put a SPECIFIC DEAL CONDITION on the table/.test(p0), true);
  const pT = prompt(lead(TOLD)), rT = refine(lead(TOLD));
  check('control: customer ALREADY TOLD it sold -> a later question may be about the alternative, so it stays open',
    () => [/may not have been answered:[^\n]*itemize the 832/.test(pT), /QUESTIONS OF THEIRS THAT ARE STILL OPEN/.test(rT)], [true, true]);
  const pN = prompt(lead(NEWS, { relationshipSignals: sig([{ date: D_C, question: 'Does it have captain chairs?' }]) }));
  check('control: a non-number question on the sold unit is left to the sold notice (not rewritten as moot)',
    () => [/may not have been answered:[^\n]*captain chairs/.test(pN), /were about the vehicle that has SOLD/.test(pN)], [true, false]);

  console.log(' 3. a question from an earlier lead is not open on this one (the scraper\'s resolver):');
  const src = require('fs').readFileSync(f, 'utf8');
  const HEAD = '      (function detectUnansweredQuestions() {', TAIL = '\n      })();';
  const ia = src.indexOf(HEAD), ib = src.indexOf(TAIL, ia);
  const item = (dir, date, body) => ({ getAttribute: k => (k === 'data-direction' ? dir : null),
    querySelector: sel => sel === '.notes-and-history-item-content' ? { innerText: body } : (sel === '.notes-and-hsitory-item-date' ? { innerText: date } : null) });
  const resolve = (els, markerMs, createdMs, pdCreatedMs) => {
    const s = { unansweredQuestions: [] }, diag = [];
    const box = { noteEls: els, sig: s, parseNoteDate: x => Date.parse(x) || 0, _lpD: function () { diag.push([].join.call(arguments, ' ')); } };
    if (markerMs != null) box._lpMarkerMs = markerMs;
    if (createdMs != null) box.leadCreatedMs = createdMs;
    if (pdCreatedMs != null) box._lpLeadCreatedMs = pdCreatedMs;
    vm.createContext(box); vm.runInContext(src.slice(ia, ib + TAIL.length), box);
    return { open: s.unansweredQuestions.map(q => q.question), diag: diag.join(' ') };
  };
  const OLD_Q = 'Quick question!\n\nDo we need a steering wheel lock? Is this particular model/year susceptible to being stolen?';
  const els = (qDate) => [
    item('Outbound', '10/02/2026 5:11 PM', 'Sent to: (555) 010-0199\nSent by: Agent Name\nTest, are you still thinking about a Sportage or Seltos?'),
    item('', '09/25/2026 5:16 PM', 'By: System\nLead received'),
    item('Outbound', '10/07/2023 4:36 PM', 'Sent to: (555) 010-0199\nSent by: Old Agent\nYou should be okay with the Forte but if it gives you peace of mind it would not hurt to have an additional layer of safety.'),
    item('Inbound', qDate, 'Received from: (555) 010-0199\nReceived by: Old Agent\n' + OLD_Q)];
  const MARK = Date.parse('09/25/2026 5:16 PM');
  const r3 = resolve(els('10/07/2023 4:28 PM'), MARK, 0);
  check('log280 shape: the 2023 steering-wheel-lock questions, lead marker 9/25/2026 -> nothing open', () => r3.open, []);
  check('...and the diag says why: PRIOR-LEAD', () => /PRIOR-LEAD[^|]*steering wheel lock/.test(r3.diag), true);
  check('no marker found: the lead\'s Created date (less 2 days) bounds it the same way',
    () => resolve(els('10/07/2023 4:28 PM'), 0, Date.parse('09/25/2026 5:16 PM')).open, []);
  // (v9.7.761) log281, the same lead on 760: a phone-up lead ("Auto generated from adding customer", no lead-received note)
  // had no marker and its DOM Created date did not parse -- only the CRM's LeadCreatedUTC was there.
  const PD = Date.parse('2026-09-25T22:16:00Z');
  check('log281 shape: no marker, no Created date, only the CRM lead-created time -> nothing open (760 left both OPEN)',
    () => resolve(els('10/07/2023 4:28 PM'), 0, 0, PD).open, []);
  check('control: with only the CRM time, a question asked on this lead is still open',
    () => resolve(els('10/03/2026 9:00 AM'), 0, 0, PD).open.some(q => /steering wheel lock/.test(q)), true);
  check('control: the same question asked on THIS lead (after the marker) is still open',
    () => resolve(els('10/03/2026 9:00 AM'), MARK, 0).open.some(q => /steering wheel lock/.test(q)), true);
  check('control (as before): no marker and no Created date -> unchanged, still open',
    () => resolve(els('10/07/2023 4:28 PM'), null, null).open.some(q => /steering wheel lock/.test(q)), true);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
