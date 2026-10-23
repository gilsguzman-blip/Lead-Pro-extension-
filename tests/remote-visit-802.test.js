#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('remote-visit-802.test.js');
// (v9.7.802) KIA BAYTOWN LEAD 2099780329 (log326, on 801). An out-of-state CarGurus buyer in a live text thread with the sales
// rep: "The 2023 K5 LXS (Gravity Gray) - This is still in our service department. (Not on the lot yet)", then "I have a 2022 Kia
// K5 LXS (White) on the lot", and the customer answered "Good", "I will bring it up dere wen ii come", "Pay cash". The draft said
// the 2023 "is here in Gravity Gray", never mentioned the white one, and offered a video instead of asking when they are coming;
// that morning the agent regenerated the first touch ten times looking for a visit ask the out-of-state rule had removed.
//   (1) the rep's "not on the lot / in service" is read from every message of ours on the lead, not only the newest;
//   (2) a unit we offered instead, answered without a turn-down, is the car the conversation is about;
//   (3) a remote buyer who says in their own words that they will make the trip is asked when -- no set times;
//   (4) Add Appt Ask (Gil, 10/14: keep the out-of-state logic intact, let the agent choose): the agent's chip lifts the
//       out-of-state no-visit rule for that lead only -- times, not today by default; holds like exit still win.
// Executes the shipped helpers, populateFromData, buildUserPrompt, _lpBuildSmsRefinePrompt and the chip helpers. Placeholder data.
//
// Usage: node tests/remote-visit-802.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: remote-visit-802.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const E = (time, tag, title, body) => '[10/14/2026 ' + time + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = '[10/14/2026 11:26 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const NOT_ON_LOT = E('1:30 PM', 'AGENT', 'Outbound Text Message', 'The 2023 K5 LXS (Gravity Gray) - This is still in our service department. (Not on the lot yet) I have some other pre-owned K5s in the inventory.');
const OFFER = E('1:46 PM', 'AGENT', 'Outbound Text Message', 'I have a 2022 Kia K5 LXS (White) on the lot. Less miles.');
const GOOD = E('1:51 PM', 'CUSTOMER', 'Inbound Text Message', 'Good');
const TRIP = E('1:55 PM', 'CUSTOMER', 'Inbound Text Message', 'I will bring it up dere wen ii come');
const ASK = E('1:57 PM', 'AGENT', 'Outbound Text Message', 'Are you wanting to pay cash or finance it?');
const CASH = E('1:59 PM', 'CUSTOMER', 'Inbound Text Message', 'Pay cash');
const HOWMUCH = E('1:06 PM', 'CUSTOMER', 'Inbound Text Message', 'I wanted to see how much was it plus tax');
const THREAD = (...newestFirst) => newestFirst.join('') + MARK;
const FULL = THREAD(CASH, ASK, TRIP, GOOD, OFFER, NOT_ON_LOT, HOWMUCH);
const UNIT = { stock: 'T001A', stockNum: 'T001A', vin: 'TESTVIN0000000001', vehicle: '2023 Kia K5 LXS', year: 2023, make: 'Kia', model: 'K5 LXS', condition: 'used',
  certified: false, class: 'Car', body: '4D Sedan', color: 'Gravity Gray', odometer: 40000, daysOnLot: 30, price: 19990 };
const UNIT2 = Object.assign({}, UNIT, { stock: 'T002A', stockNum: 'T002A', vin: 'TESTVIN0000000002', vehicle: '2022 Kia K5 LXS', year: 2022, color: 'Glacial White Pearl' });
const LEAD = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2023 Kia K5 LXS',
  condition: 'Used', color: 'Gravity Gray', stockNum: 'T001A', vin: 'TESTVIN0000000001', dealerId: '6190', store: 'Community Kia Baytown', leadSource: 'Cargurus',
  convState: 'active-follow-up', leadAgeDays: 0, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 9, phone: '(555) 010-0199', email: 'test@example.com',
  lastInboundMsg: 'Pay cash', lastOutboundMsg: 'Are you wanting to pay cash or finance it?', relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 0.01 },
  history: FULL, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + FULL + '---' }, x || {});

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  const fn = (name) => { try { return run(name); } catch (e) { return null; } };
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  run('_lpValueFactCache')['6190'] = { inv: { units: [UNIT, UNIT2] }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true };
  // populate, then build the user prompt on the populated object -- the order a real grab runs in
  const prompt = (x, opts) => quiet(() => { opts = opts || {};
    run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0; window._lpNoApptLeadId = ""; window._lpSuppressApptChip = false;'
      + 'window._lpAddApptLeadId = ' + JSON.stringify(opts.chip || '') + ';');
    // out of state the way the real lead was: a Louisiana address on a Texas store (placeholder ZIP)
    const d = LEAD(Object.assign(opts.remote === false ? { customerState: '', customerZip: '' } : { customerState: 'LA', customerZip: '70001' }, x)); sb.populateFromData(d); const ctx = run('leadContext');
    return sb.__lp.buildUserPrompt(Object.assign({}, d, { context: ctx })); });

  console.log(' 1. the rep said it is not on the lot -- on any message of ours, not only the newest (new helper):');
  const nol = fn('_lpRepNotOnLot');
  check('lead 2099780329: "still in our service department. (Not on the lot yet)", four messages back, is found', () => { const r = nol(LEAD()); return r && [r.date, /service department/.test(r.quote)]; }, ['10/14', true]);
  check('control: a newer message of ours "it\'s on the lot now" wins; a note about the 2022 is not about the 2023 on the lead', () =>
    [nol(LEAD({ history: THREAD(E('2:30 PM', 'AGENT', 'Outbound Text Message', 'Good news, the 2023 K5 is on the lot now and ready to see.'), NOT_ON_LOT) })),
     nol(LEAD({ history: THREAD(E('1:30 PM', 'AGENT', 'Outbound Text Message', 'The 2022 K5 is still in our service department.')) }))], [null, null]);
  const p = prompt();
  check('the prompt no longer says it is here: VEHICLE ON LEAD, PRESENCE, the feed line and the INVENTORY note all say still in service', () =>
    [/^VEHICLE ON LEAD: 2023 Kia K5 LXS -- ours \(in today's inventory, not sold\), but the sales rep told the customer it is still in service and not on the lot yet/m.test(p),
     /^PRESENCE LANGUAGE: On 10\/14 the sales rep told this customer the car is still in service and not on the lot yet/m.test(p),
     /^IN TODAY'S INVENTORY FEED, BUT STILL IN SERVICE: stock T001A is ours/m.test(p), /CONFIRMED IN TODAY.S LIVE INVENTORY LOAD/.test(p),
     /INVENTORY: VEHICLE NOTE: The 2023 Kia K5 LXS is ours \(in today's inventory, not sold\), but on 10\/14 the sales rep told the customer it is still in service/.test(p),
     /Say "we have it here"|Confirm it is available/.test(p)], [true, true, true, false, true, false]);
  const pC = prompt({ history: THREAD(CASH, ASK, HOWMUCH), conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + THREAD(CASH, ASK, HOWMUCH) + '---' });
  check('control: with no such message the unit is still confirmed in stock', () =>
    [/^VEHICLE ON LEAD: 2023 Kia K5 LXS — confirmed in stock/m.test(pC), /STILL IN SERVICE/.test(pC)], [true, false]);
  check('the text rewrite is told the same: ours, still in service -- not "THE VEHICLE IS IN STOCK ... the email says it is here"', () => {
    const r = quiet(() => run('_lpBuildSmsRefinePrompt')('Test, pass one.', 'Hi Test,\n\nThe white 2022 K5 LXS is on the lot, and paying cash works.\n\nAgent Name', LEAD({ _lpInvConfirmedAvailable: true })));
    return [/THE VEHICLE IS OURS, BUT STILL IN SERVICE/.test(r), /THE VEHICLE IS IN STOCK/.test(r)]; }, [true, false]);

  console.log(' 2. the unit we offered, answered without a turn-down, is the car on the table (new helper):');
  const ofr = fn('_lpOfferedUnit');
  check('lead 2099780329: the 2022 Kia K5 LXS (White), answered "Good"', () => { const r = ofr(LEAD()); return r && [r.unit, r.reply]; }, ['2022 Kia K5 LXS (White)', 'Good']);
  check('control: answered "No thanks" -> nothing moved; the lead\'s own car re-offered -> not another unit', () =>
    [ofr(LEAD({ history: THREAD(E('1:51 PM', 'CUSTOMER', 'Inbound Text Message', 'No thanks'), OFFER) })),
     ofr(LEAD({ history: THREAD(GOOD, E('1:46 PM', 'AGENT', 'Outbound Text Message', 'I have a 2023 Kia K5 LXS on the lot for you.')) }))], [null, null]);
  check('the prompt: THE CAR ON THE TABLE NOW, the Vehicle line points at it, and the Gravity Gray colour line stands down', () =>
    [/^THE CAR ON THE TABLE NOW: on 10\/14 we offered this customer a different unit -- "I have a 2022 Kia K5 LXS \(White\) on the lot\. Less miles\." -- and their reply after it was "Good"\. The conversation moved to the 2022 Kia K5 LXS \(White\)/m.test(p),
     /^Vehicle: {4}2023 Kia K5 LXS {2}← the vehicle the lead came in on\. The conversation has since moved to the 2022 Kia K5 LXS \(White\) we offered/m.test(p),
     /THIS IS THE VEHICLE FOR THIS LEAD/.test(p), /THE COLOUR IS ALREADY SETTLED/.test(p)], [true, true, false, false]);

  console.log(' 3. a remote buyer who said they will make the trip (new helper):');
  const trip = fn('_lpTripIntent');
  check('"I will bring it up dere wen ii come" and "But if I come get it from Texas how much?" are both the trip; the newest is quoted', () =>
    [trip(LEAD()), trip(LEAD({ history: THREAD(E('1:06 PM', 'CUSTOMER', 'Inbound Text Message', 'But if I come get it from Texas how much?')) }))],
    ['I will bring it up dere wen ii come', 'But if I come get it from Texas how much?']);
  check('control: "I can\'t come this week", "how much plus tax" and our own "when are you wanting to come?" are not', () =>
    [trip(LEAD({ history: THREAD(E('1:06 PM', 'CUSTOMER', 'Inbound Text Message', "I can't come this week")) })), trip(LEAD({ history: THREAD(HOWMUCH) })),
     trip(LEAD({ history: THREAD(E('1:59 PM', 'AGENT', 'Outbound Text Message', 'When are you wanting to come?')) }))], ['', '', '']);
  check('the remote block: THEY SAID THEY WILL MAKE THE TRIP; the visit decision is "no set times" (level 2), not "no visit ask"', () =>
    [/^- THEY SAID THEY WILL MAKE THE TRIP: in their own words on this lead -- "I will bring it up dere wen ii come"\. The visit is on the table: ask when they are planning to come/m.test(p),
     /Do NOT push an in-person visit/.test(p), /^VISIT DECISION FOR THIS MESSAGE: no specific appointment times and no same-day push in this message; invite them in only as that instruction allows -- the REMOTE BUYER who said they will make the trip/m.test(p)],
    [true, false, true]);
  const pN = prompt({ history: THREAD(CASH, ASK, HOWMUCH), conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + THREAD(CASH, ASK, HOWMUCH) + '---' });
  check('control: a remote buyer who said nothing of the kind keeps the out-of-state rule -- no visit ask (level 3)', () =>
    [/^- Do NOT push an in-person visit or offer appointment times as the ask/m.test(pN), /^VISIT DECISION FOR THIS MESSAGE: no visit ask and no appointment times in this message -- the REMOTE \/ OUT-OF-STATE BUYER block/m.test(pN)], [true, true]);

  console.log(' 4. Add Appt Ask (new chip):');
  const pA = prompt({ history: THREAD(CASH, ASK, HOWMUCH), conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + THREAD(CASH, ASK, HOWMUCH) + '---' }, { chip: 'TEST001A' });
  check('pressed on this lead: AGENT OVERRIDE -- APPOINTMENT ASK, the visit decision allows times (not today by default), and the times come back', () =>
    [/^- AGENT OVERRIDE -- APPOINTMENT ASK FOR AN OUT-OF-STATE BUYER: the agent chose to invite this customer in\. Ask for the visit with one or two specific times inside store hours/m.test(pA),
     /Do NOT push an in-person visit/.test(pA), /^VISIT DECISION FOR THIS MESSAGE: appointment times are fine, but not today by default -- the agent's ADD APPT ASK chip/m.test(pA),
     /SUGGESTED APPOINTMENT TIMES/.test(pA), /SUGGESTED APPOINTMENT TIMES/.test(pN)], [true, false, true, true, false]);
  check('control: pressed on a different lead -> nothing; this lead with an exit signal -> the exit still wins', () => {
    const o = prompt({ history: THREAD(CASH, ASK, HOWMUCH) }, { chip: 'OTHER99' });
    const x = prompt({ history: THREAD(CASH, ASK, HOWMUCH), hasExitSignal: true, convState: 'exit' }, { chip: 'TEST001A' });
    return [/AGENT OVERRIDE -- APPOINTMENT ASK/.test(o), /AGENT OVERRIDE -- APPOINTMENT ASK/.test(x)]; }, [false, false]);
  check('control: a local buyer is untouched by the chip\'s remote override (no remote block at all)', () =>
    /REMOTE \/ OUT-OF-STATE BUYER|AGENT OVERRIDE -- APPOINTMENT ASK/.test(prompt({ history: THREAD(CASH, ASK, HOWMUCH) }, { chip: 'TEST001A', remote: false })), false);
  check('the chip is in the panel, and the text rewrite knows it: it is an active chip, and a rewrite that drops the time breaks it', () => {
    const html = fs.readFileSync(path.join(path.dirname(f), 'popup.html'), 'utf8');
    run('window._lpAddApptLeadId = "TEST001A"; window._lpRegenChipKey = "";');
    const keys = run('_lpActiveChips')({ autoLeadId: 'TEST001A' });
    const br = run('_lpChipBroken')('add-appt', 'Test, would 10:30 AM Thursday work?\nAgent', 'Test, when works for you?\nAgent');
    run('window._lpAddApptLeadId = "";');
    return [/<button class="regen-chip" data-regen="add-appt">Add Appt Ask<\/button>/.test(html), keys.indexOf('add-appt') >= 0, br, typeof run('LP_CHIP_KEEP')['add-appt']]; },
    [true, true, 'the agent asked for an appointment ask and the rewrite dropped the time', 'string']);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
