#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('regen-room-827.test.js');
// (v9.7.827) FROM THE 10/26 REPORT AND A GRAB OF HONDA LAFAYETTE LEAD 2105314541 (log364).
// (1) The Key Information panel failed to load and its error text -- "Failed to fetch customer summary banner preview text" --
//     reached the prompt as the CDP summary, under the rule that the summary is the best read on the customer.
// (2) On an IdentityMax lead with no vehicle, the customer claimed "$1000 OFF TSRP ON ALL NEW HONDAS"; the "ask smaller, a two-way
//     choice" rule and a Pre-Owned condition field produced "Would you reply 'new' or 'used'?", and the draft said "I see you were
//     asking about the $1,000 savings" -- a claimed website offer, not a question.
// (3) The pitch-out line said "our message told them about the car" on a lead with no car (the message asked what they wanted, with times).
// (4) "We've been trying to reach you" was fixed as the opening in every format: nine regens on Kia lead 2105429946 opened the same
//     way, and the text rewrite's guard put it back. A regen or chip may now move it or shrink it to a clause.
// (5) Store hours appeared in texts unprompted ("We're open Monday through Saturday, 9 AM to 8 PM").
// Executes _lpKeyInfoLines, _lpCdpSummary, _lpImxOfferGuidance, buildUserPrompt through the panel payload, _lpBuildSmsRefinePrompt
// and _lpRefineSms (worker stubbed). Placeholder data only.
//
// Usage: node tests/regen-room-827.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: regen-room-827.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const sure = (fn) => { try { return fn(); } catch (e) { return 'THREW: ' + e.message; } };
const H = 3600000, NOW = Date.now();
const fmt = (ms) => { const f = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  .formatToParts(new Date(ms)).reduce((o, p) => (o[p.type] = p.value, o), {}); return f.month + '/' + f.day + '/' + f.year + ' ' + f.hour + ':' + f.minute + ' ' + f.dayPeriod.toUpperCase(); };
const E = (ms, tag, title, body) => '[' + fmt(ms) + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (ms) => '[' + fmt(ms) + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const T0 = NOW - 20 * H;
const PITCH = 'Test, the Summit White 2024 GMC Sierra 1500 AT4 is here and ready for you to see. Would 9:15 AM or 10:30 AM Wednesday work better? Agent';
const ASKIN = 'Test, what kind of vehicle are you shopping for? I can narrow down the right options and have everything ready for you today. Could you come in at 11:30 AM or 12:15 PM? Agent';
const HIST = (o) => (o.calls ? E(T0 + 14 * H + 4 * 60000, 'AGENT', 'Outbound phone call (Machine)', 'By: Rep Name\n  Left message') + E(T0 + 14 * H, 'AGENT', 'Outbound phone call (Machine)', 'By: Rep Name\n  Left message') : '')
  + E(T0, 'AGENT', 'Outbound Text Message', 'By: Agent Name\n  ' + (o.pitch || PITCH)) + MARK(T0 - 60000);
const LEAD = (o) => { o = o || {}; const h = HIST(o); return Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name',
  vehicle: o.noVeh ? '' : '2024 GMC Sierra 1500 AT4', condition: 'Pre-Owned', stockNum: o.noVeh ? '' : 'P0001', _lpInvConfirmedAvailable: !o.noVeh, dealerId: '6190', store: 'Test Kia',
  leadSource: 'Internet', convState: 'active-follow-up', leadAgeDays: 1, hasOutbound: true, hasCustomerReply: false, totalNoteCount: 6, phone: '(555) 010-0199', email: 'test@example.com',
  customerZip: '00000', relationshipSignals: { unansweredQuestions: [], totalOutboundCount: 3 }, lastInboundMsg: '', lastSubstantiveOutboundMsg: o.pitch || PITCH, history: h,
  conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + h + '---', outboundSends: [{ title: 'outbound text message', ms: T0, body: o.pitch || PITCH }] }, o.x || {}); };
const PASS1 = 'Test, Rep and I have been trying to reach you about the Sierra AT4. Is a quick call or an email easier for you?\nAgent';
const MOVED = 'Test, is there a feature on the Sierra AT4 you are still weighing? A quick call or an email works. Rep and I have been trying to reach you.\nAgent';
const EMAIL = 'Subject: The Sierra AT4\n\nTest,\n\nRep has tried reaching you by phone. Is there a particular question you are weighing?\n\nAgent Name';
const NEWOFFER = 'claimed the website offer "$1000 OFF TSRP ON ALL NEW HONDAS! Limited Time Savings on All New Inventory"';

(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  run('_lpValueFactCache')['6190'] = { inv: { units: [{ stock: 'P0001', stockNum: 'P0001', vin: 'TESTVINP0001', vehicle: '2024 GMC Sierra 1500 AT4', year: 2024, make: 'GMC', model: 'Sierra 1500 AT4',
    condition: 'used', certified: false, class: 'Truck', body: 'Crew Cab', color: 'Summit White', odometer: 20000, daysOnLot: 10, price: 58067 }] }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true };
  const viaPanel = (lsd) => String(sure(() => quiet(() => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(lsd);
    return sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: run('leadContext') })); })));
  const regen = (on) => run('window._lpDraftHistory = ' + (on ? '["Test, we have been trying to reach you. Agent"]' : '[]') + '; window._lpRegenDirective = "";');

  console.log(' 1. the Key Information panel\'s own load error is not a summary:');
  const KI = (blurb) => ({ keyInfo: [{ key: 'CustomerSummary', label: 'Fullpath CDP', blurb: blurb }] });
  check('lead 2105314541: "Failed to fetch customer summary banner preview text" -> no summary line, no summary',
    [sure(() => sb._lpKeyInfoLines(KI('Failed to fetch customer summary banner preview text')).length), sure(() => sb._lpCdpSummary(KI('Failed to fetch customer summary banner preview text')))], [0, '']);
  check('control: a real summary is kept', /Fullpath CDP summary: "Test leased one vehicle and has many service visits with the dealership"/.test(
    String(sure(() => sb._lpKeyInfoLines(KI('Test leased one vehicle and has many service visits with the dealership')).join('\n')))), true);

  console.log(' 2. a claimed new-only offer settles new or used, and it is not a question of theirs:');
  const g = String(sure(() => run('_lpImxOfferGuidance')(NEWOFFER, 'Pre-Owned', '', { dealerId: '24399', followUp: true })));
  check('no vehicle, follow-up: never ask new or used; a small question is which kind or which model; never "you asked about it"',
    [/They claimed a NEW-vehicle offer, so new or used is settled: never ask whether they want new or used\. A small question about what they want is which kind \(car, SUV, truck or minivan\) or which model\./.test(g),
      /They claimed it on our website; that is not a question of theirs -- never write that they asked about it/.test(g)], [true, true]);
  const gp = String(sure(() => run('_lpImxOfferGuidance')('claimed the website offer "Pre-owned and Certified Vehicles under $25,000!"', 'Pre-Owned', '', { dealerId: '24399', followUp: true })));
  check('control: the pre-owned offer keeps its own rule and carries no "new or used is settled" line',
    [/They claimed the PRE-OWNED offer: do NOT ask whether they want new or pre-owned/.test(gp), /new or used is settled/.test(gp)], [true, false]);

  console.log(' 3. the pitch-out line on a lead with no vehicle:');
  regen(false);
  check('the unanswered message asked what they want, with times -> "our message invited them in", not "told them about the car"',
    [/OUR PITCH IS ALREADY OUT AND UNANSWERED: on [\d/]+ our message invited them in and offered times/.test(viaPanel(LEAD({ noVeh: true, pitch: ASKIN }))), /told them about the car/.test(viaPanel(LEAD({ noVeh: true, pitch: ASKIN })))], [true, false]);
  check('control: with the car on the lead it still says the car is here', /our message told them the car is here and offered times/.test(viaPanel(LEAD())), true);

  console.log(' 4. "we have been trying to reach you" leads the first draft; a regen may move it:');
  const p1 = viaPanel(LEAD({ calls: true }));
  regen(true); const p2 = viaPanel(LEAD({ calls: true })); regen(false);
  check('first draft: it comes first in every format; regen: it need not open the message',
    [/in every format it comes first, right after their name/.test(p1), /need not open the message/.test(p1), /need not open the message: it may come later, or as a short clause/.test(p2), /in every format it comes first/.test(p2)],
    [true, false, true, false]);
  const refine = async (reply, on) => { const logs = []; sb.__reply = reply; sb.__d = LEAD({ calls: true });
    run('window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Test Kia" };'
      + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpActiveProhibitions = [];'
      + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
      + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
      + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };');
    regen(on); const ol = sb.console.log; sb.console.log = (...a) => logs.push(a.join(' '));
    let out; try { out = await run('_lpRefineSms(' + JSON.stringify(PASS1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)'); } catch (e) { out = 'THREW ' + e.message; }
    sb.console.log = ol; regen(false); return [out === null ? null : 'shipped', logs.some(l => /it opened on "we have been trying to reach you" and the rewrite did not/.test(l))]; };
  check('the text rewrite moves it on a regen -> it ships', await refine(MOVED, true), ['shipped', false]);
  check('control: on the first draft the guard still keeps it first', await refine(MOVED, false), [null, true]);
  regen(true); const rp2 = String(quiet(() => sb._lpBuildSmsRefinePrompt(PASS1, EMAIL, LEAD({ calls: true })))); regen(false);
  check('...and the rewrite prompt says so on a regen', [/it is the reason for this text, wherever the first draft put it\./.test(rp2), /Say we have been trying to reach them where the first draft does/.test(rp2)], [true, true]);

  console.log(' 5. store hours are for scheduling:');
  check('the hours block says not to list them unless asked', /STORE HOURS — [^\n]+\n(?:  [^\n]+\n){3}These hours are for your scheduling\. Do not list the store's hours in the message unless the customer asked about them\./.test(p1), true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
