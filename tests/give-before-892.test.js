#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('give-before-892.test.js');
// (v9.7.892) GIVE BEFORE YOU ASK, AND A SOLD CAR IS NEVER AN OPTION. Owner, 11/24: "fold the stalled length and follow ups in general into
// the Wrangler build and actually look into expanding the first touch also. They seem to be shorter now that the appointment ask is gone."
// On 11/23 the Expand chip was pressed 11 times, every one on a stalled follow-up, every result sent. No length target (owner, 9/16): the
// Expand chip's job -- substance before the question -- becomes the default on first touches and follow-ups, and yields to a hold that
// keeps a message small. Kia 2106486534 (11/23, two thumbs-down): "the 2015 Wrangler Unlimited Sport ... has sold ... Which Wrangler should
// I focus on: the 2018 Sahara or the 2015 Sport?" Executes buildUserPrompt through the panel payload. Placeholder data only.
//
// Usage: node tests/give-before-892.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: give-before-892.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const CT = (y, mo, d, h, mi) => { const guess = Date.UTC(y, mo - 1, d, h + 6, mi); const off = (new Date(guess).toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }) | 0) - h; return guess - off * 3600000; };
const NOW = CT(2026, 11, 23, 14, 0);
const E = (day, clock, tag, title, body) => '[' + day + ' ' + clock + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (day) => '[' + day + ' 9:00 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const NEW = E('11/23/2026', '1:50 PM', 'CUSTOMER REQUEST FROM INQUIRY', 'Lead Received', 'I am interested in the CR-V EX.') + MARK('11/23/2026');
const FOLLOW = E('11/20/2026', '10:00 AM', 'AGENT', 'Outbound Text Message', 'Test, thanks for asking about the CR-V EX. Is it still on your list?') + E('11/18/2026', '9:30 AM', 'CUSTOMER REQUEST FROM INQUIRY', 'Lead Received', 'I am interested in the CR-V EX.') + MARK('11/18/2026');
const LEAD = (h, x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Honda CR-V EX', condition: 'New', dealerId: '6191',
  store: 'Community Honda Baytown', leadSource: 'Honda.com', convState: 'first-touch', leadAgeDays: 0, hasOutbound: false, hasCustomerReply: false, totalNoteCount: 3, phone: '(555) 010-0199',
  email: 'test@example.com', customerZip: '12345', relationshipSignals: { unansweredQuestions: [] }, conversationBrief: h, history: h, context: '', autoLeadId: 'TEST016R', outboundSends: [] }, x || {});
const FOLLOW_LEAD = (x) => LEAD(FOLLOW, Object.assign({ convState: 'active-follow-up', hasOutbound: true, leadAgeDays: 5, totalNoteCount: 6 }, x || {}));
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  vm.runInContext('(function(){ var RD = Date, FIX = ' + NOW + '; function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); } FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; Date = FD; })()', sb);
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const prompt = (d) => quiet(() => { vm.runInContext('activeFlags = new Set(); leadContext = ""; window._lpAddApptLeadId = "";', sb); sb.__L = d; vm.runInContext('lastScrapedData = globalThis.__L;', sb); sb.populateFromData(d);
    return String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: d, context: String(vm.runInContext('leadContext', sb) || '') }))); });
  const FU = /\nGIVE BEFORE YOU ASK: on follow-ups agents have been pressing Expand/;

  console.log(' give before you ask:');
  const p1 = prompt(LEAD(NEW));
  check('the first reach-out: "GIVE BEFORE YOU ASK" -- a real fact, what we can do, or the offer -- ahead of the question', () => [/GIVE BEFORE YOU ASK\. With no visit ask, the substance is what earns the reply[^\n]*The question comes last\./.test(p1), FU.test(p1)], [true, false]);
  const p2 = prompt(FOLLOW_LEAD());
  check('a follow-up: substance before the question, no length target, and a hold that keeps it small wins', () => [FU.test(p2), /One or two sentences of that, then the question\. No padding[^\n]*that rule wins\./.test(p2)], [true, true]);
  check('a stalled follow-up gets it too', () => FU.test(prompt(FOLLOW_LEAD({ leadAgeDays: 26, _isStalled: true }))), true);
  check('control: they asked for room (a pause) -> no such line', () => FU.test(prompt(FOLLOW_LEAD({ convState: 'pause', hasPauseSignal: true }))), false);
  check('control: an exit -> no such line', () => FU.test(prompt(FOLLOW_LEAD({ convState: 'exit', hasExitSignal: true }))), false);

  console.log(' a sold car is never one of the options:');
  const SOLD_H = E('11/20/2026', '10:00 AM', 'AGENT', 'Outbound Text Message', 'Test, the 2015 Jeep Wrangler Unlimited Sport has sold. I can look for a comparable one for you.') + E('11/18/2026', '9:30 AM', 'CUSTOMER REQUEST FROM INQUIRY', 'Lead Received', 'Is the 2015 Wrangler still available?') + MARK('11/18/2026');
  const pS = prompt(LEAD(SOLD_H, { vehicle: '2015 Jeep Wrangler Unlimited Sport', condition: 'Used', dealerId: '6190', store: 'Community Kia Baytown', convState: 'active-follow-up', hasOutbound: true, leadAgeDays: 5, totalNoteCount: 6,
    selfClaims: { sold: { text: 'Test, the 2015 Jeep Wrangler Unlimited Sport has sold.', msg: 'Test, the 2015 Jeep Wrangler Unlimited Sport has sold. I can look for a comparable one for you.', ms: CT(2026, 11, 20, 10, 0), date: '11/20' } } }));
  check('lead 2106486534\'s shape: the vehicle on the lead sold -> never an option, never in a choice', () => /THE 2015 JEEP WRANGLER UNLIMITED SPORT ON THIS LEAD HAS SOLD: never offer it as one of the options and never put it in a choice/.test(pS), true);
  check('control: a vehicle that has not sold -> no such line', () => /ON THIS LEAD HAS SOLD/.test(p2), false);
  const claim = (veh, said) => quiet(() => { const r = vm.runInContext('_lpSoldClaimForVoi', sb)({ vehicle: veh, selfClaims: { sold: { text: said, msg: said, ms: 1, date: '11/20' } } }); return r ? r.counts : null; });
  check('our own "the 2015 Jeep Wrangler Unlimited Sport has sold" counts on a used Jeep at a Kia store (the model list knew only our four brands)', () => claim('2015 Jeep Wrangler Unlimited Sport', 'Test, the 2015 Jeep Wrangler Unlimited Sport has sold.'), true);
  check('control: the same sentence on a lead for the 2018 Wrangler Sahara -> a different year, does not count', () => claim('2018 Jeep Wrangler JK Unlimited Sahara', 'Test, the 2015 Jeep Wrangler Unlimited Sport has sold.'), false);
  check('the two-model question: when the pinned one sold, the other is the one -- no either/or', () => /\? 'Vehicle:    ' \+ data\.vehicle \+ '  ← SOLD \(see the vehicle status\)\.[^\n]*Do NOT ask them to choose between the two, and never offer the ' \+ data\.vehicle \+ ' as an option\.'/.test(src), true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
