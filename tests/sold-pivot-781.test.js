#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('sold-pivot-781.test.js');
// (v9.7.781) Honda Lafayette lead 2097428117, 10/9: an out-of-state CarGurus lead on a pre-owned 2018 Accord EX-L 2.0T. We
// texted "It's here and available"; the customer answered "Yes that would be great!" to a video; a manager then added an
// INTERNAL note that the unit had sold. The prompt said (1) "the customer was ALREADY TOLD -- do not re-announce", read off
// that internal note; (2) pivot to a NEW 2026 Accord Hybrid EX-L with an APR program, while a 2024 Accord LX CPO near the
// sold unit's price sat in the same feed; (3) "FRESH ARRIVAL -- just came in" for the sold unit; (4) the store-hours "today
// is the default" beside the remote block's "do NOT push an in-person visit". Executes the shipped populateFromData,
// _lpCustomerFacingThread, _lpComparablesWithUnits and _lpApplyVisitDecision. Placeholder data only.
//
// Usage: node tests/sold-pivot-781.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: sold-pivot-781.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const U = (stock, vehicle, year, model, condition, price, color) => ({ stock, stockNum: stock, vin: 'TESTVIN' + stock, vehicle, year, make: 'Honda', model, condition,
  certified: condition === 'cpo', class: 'Car, Intermediate', body: '4D Sedan', color, odometer: condition === 'new' ? 5 : 60000, daysOnLot: 10, price });
const UNITS = [
  U('TEST001A', '2018 Honda Accord EX-L 2.0T', 2018, 'Accord EX-L 2.0T', 'used', 21991, 'Gray'),
  U('TEST002N', '2026 Honda Accord Hybrid EX-L', 2026, 'Accord Hybrid EX-L', 'new', 38990, 'Urban Gray Pearl'),
  U('TEST003C', '2024 Honda Accord LX', 2024, 'Accord LX', 'cpo', 23691, 'Platinum White Pearl'),
  U('TEST004C', '2025 Honda Accord SE', 2025, 'Accord SE', 'cpo', 28891, 'Platinum White') ];
const VF = { incentives: [{ model: 'Accord Hybrid', line: '3.49% APR for 24-60 mos', expires: '2099-12-31', year: 2026 }] };
const HIST = (soldLine) => '[10/09/2026 5:21 PM] [NOTE] General Note\n  By: Rep Name ' + soldLine + '\n'
  + '[10/09/2026 3:13 PM] [CUSTOMER] Inbound Text Message\n  Yes that would be great!\n'
  + '[10/09/2026 3:12 PM] [AGENT] Outbound Text Message\n  Test, I can send you a video walkaround of the 2018 Accord EX-L 2.0T. It is here and available to see.\n'
  + '[10/09/2026 3:07 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n';
const LEAD = (x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2018 Honda Accord Sedan EX-L 2.0T',
  condition: 'Pre-Owned', stockNum: 'TEST001A', vin: 'TESTVIN0000000001', dealerId: '24399', store: 'Community Honda Lafayette', leadSource: 'Cargurus',
  convState: 'active-follow-up', leadAgeDays: 0, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 6, inventoryWarning: true, inventoryWarningFromNotes: true,
  daysOnLot: 4, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: 'Yes that would be great!',
  history: HIST('Stock #:TEST001A has been sold'), conversationBrief: '', relationshipSignals: { unansweredQuestions: [] } }, x || {});

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  run('_lpValueFactCache')['24399'] = { inv: { store: 'Community Honda Lafayette', count: UNITS.length, units: UNITS }, vf: VF, fetchedAt: Date.now() - 1000, invSettledAt: Date.now(), _settled: true };
  const ctx = (x) => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); const ol = sb.console.log; sb.console.log = () => {};
    try { sb.populateFromData(LEAD(x)); } finally { sb.console.log = ol; } return run('leadContext'); };

  console.log(' 1. who was told it sold:');
  const c1 = ctx();
  check('only an INTERNAL note says sold -> the customer has NOT been told: tell them once and pivot', () =>
    [/SOLD — and the transcript shows the customer was ALREADY TOLD/.test(c1), /SOLD — this specific unit is no longer available\. Do not work it, quote it, or re-run its numbers\. Tell the customer once, plainly/.test(c1)], [false, true]);
  check('control: our own text told them it sold -> ALREADY TOLD', () => /customer was ALREADY TOLD/.test(ctx({ history: HIST('called back') .replace('It is here and available to see.', 'Sorry, that one has sold.') })), true);
  check('a note that records telling the customer counts', () => /customer was ALREADY TOLD/.test(ctx({ history: HIST('told customer the Accord has been sold') })), true);

  console.log(' 2. the pivot stays in the customer\'s lane:');
  // (v9.7.782) model > price > type: a new unit may follow the pre-owned ones in the list, but never leads it here
  check('pre-owned lead: the pivot names the 2024 Accord LX CPO first, and there is no new-car incentive pivot', () =>
    [/2024 Honda Accord LX \(Platinum White Pearl\) — Certified Pre-Owned/.test(c1), /SOLD → INCENTIVE PIVOT/.test(c1),
     c1.indexOf('2024 Honda Accord LX') > -1 && (c1.indexOf('2026 Honda Accord Hybrid EX-L') < 0 || c1.indexOf('2024 Honda Accord LX') < c1.indexOf('2026 Honda Accord Hybrid EX-L'))], [true, false, true]);
  check('(new helper) the ranking: model, then the closest price, then the lead\'s type (v9.7.782 order)', () => {
    const r = run('_lpComparablesWithUnits')('2018 Honda Accord Sedan EX-L 2.0T', UNITS, 'TEST001A', '', 3, { cond: 'Pre-Owned', price: 21991 });
    return r.map(x => x.unit.stock); }, ['TEST003C', 'TEST004C', 'TEST002N']);
  check('control: a NEW lead still gets new units first', () => {
    const r = run('_lpComparablesWithUnits')('2026 Honda Accord Hybrid Sport', UNITS, '', '', 1, { cond: 'New' }); return r.map(x => x.unit.stock); }, ['TEST002N']);
  check('control: no opts -> the old ordering, unchanged', () => {
    const r = run('_lpComparablesWithUnits')('2018 Honda Accord Sedan EX-L 2.0T', UNITS, 'TEST001A', '', 3); return r.length; }, 3);

  console.log(' 3. fresh arrival, and the internal-note filter:');
  check('no FRESH ARRIVAL line for a sold unit; control: an available 4-day unit still gets it', () =>
    [/FRESH ARRIVAL/.test(c1), /FRESH ARRIVAL/.test(ctx({ inventoryWarning: false, inventoryWarningFromNotes: false, history: HIST('called') }))], [false, true]);
  check('(new helper) _lpCustomerFacingThread drops an internal note, keeps the customer-facing entries', () => {
    const t = run('_lpCustomerFacingThread')(HIST('Stock #:TEST001A has been sold')); return [/has been sold/.test(t), /Yes that would be great/.test(t), /here and available/.test(t)]; }, [false, true, true]);

  console.log(' 4. the remote buyer holds the visit:');
  check('(new helper) "Do NOT push an in-person visit" is a level-3 hold and the today default goes', () => {
    const r = sb._lpApplyVisitDecision(['CURRENT TIME: x', 'STORE STATUS RIGHT NOW: OPEN. Closes at 7 PM. OFFER THE SOONEST REAL OPENING FIRST: today is the default.',
      '🔴 REMOTE / OUT-OF-STATE BUYER: Customer is NOT local.', '- Do NOT push an in-person visit or offer appointment times as the ask — they are remote.'].join('\n'));
    return [r.level, r.owner, /today is the default/.test(r.text)]; }, [3, 'the REMOTE / OUT-OF-STATE BUYER block', false]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
