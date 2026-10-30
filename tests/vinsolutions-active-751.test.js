#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('vinsolutions-active-751.test.js');
// (v9.7.751) Toyota Baytown lead 2092976040, 10/1 (log274, dump 02786a32; regrab log275). An Edmunds lead the store moved
// onto stock TX455588, a 2026 Tundra 1794 Edition that arrived the day before. Four things made the draft read unsure:
//  (1) The 124-unit feed Lead Pro held did not have the truck yet, so the prompt said "NOT confirmed available" and the
//      draft wrote "I can confirm the exact unit's status before you make plans". VinSolutions' own record of the unit --
//      PageData Status "A", active inventory -- was on the same grab. Gil: "the Vin lead panel shows it as in stock ...
//      Does the model not check that info and only rely on the feed data?"
//  (2) "VEHICLE VARIANT MISMATCH ... "sr"" -- from the CRM's record "By: System Primary vehicle changed from 2026 Toyota
//      Tundra SR 4dr ... to 2026 Toyota Tundra 4WD 1794 Edition", which is nobody's words.
//  (3) "TIMING — APPOINTMENT FELL THROUGH" from a missed appointment in August on an earlier lead -> "Are you still
//      interested in coming in?" on a lead submitted that afternoon.
//  (4) Edmunds' price fields ("Base MSRP: 43260.0 Base TMV: 39663.0 ...") shown as "the customer's own words ... address
//      it directly" -- and priced for the SR, not the 1794 on the lead.
// Executes the shipped _lpFeedUnitCheck, populateFromData, buildUserPrompt, _lpIsToolFieldBlob and the price-data block.
// Placeholder data only.
//
// Usage: node tests/vinsolutions-active-751.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: vinsolutions-active-751.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const OTHER = { stock: 'TEST002A', stockNum: 'TEST002A', vehicle: '2026 Toyota Tundra SR5', year: 2026, make: 'Toyota', model: 'Tundra SR5', condition: 'new' };
const UNIT = { stock: 'TEST001A', stockNum: 'TEST001A', vehicle: '2026 Toyota Tundra 1794 Edition', year: 2026, make: 'Toyota', model: 'Tundra 1794 Edition', condition: 'new' };
const lead = (extra) => Object.assign({ dealerId: '6189', stockNum: 'TEST001A', vehicle: '2026 Toyota Tundra 4WD 1794 Edition', _pdStatus: 'A', _pdUnitStock: 'TEST001A' }, extra);
const ent = (stamp, tag, title, body) => '[' + stamp + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const brief = (entries) => 'AGENT CONTEXT — READ THIS FIRST.\nCONVERSATION TRANSCRIPT (newest first):\n---\n' + entries.join('') + '---\n';
const SYS_NOTE = ent('10/01/2026 1:27 PM', 'NOTE', '', 'By: System Primary vehicle changed from 2026 Toyota Tundra SR 4dr CrewMax SB (3.4L 6cyl Turbo 10A) to 2026 Toyota Tundra 4WD 1794 Edition.');
const CALL = ent('10/01/2026 1:28 PM', 'AGENT', 'Outbound phone call (Contacted)', 'By: Agent Name works here.');
const EDMUNDS = 'Base MSRP: 43260.0 Base TMV: 39663.0 Total MSRP Price with Options: 45455.0 Total TMV Price with Options: 41858.0 Edmunds TMV includes options, regional adjustment and destination charge. Timeframe: Week. Show Less';

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  const sb = loadPopup(f, { withAuth: true });
  const setFeed = (units) => {
    sb.__c = units ? { vf: null, inv: { units }, fetchedAt: Date.now() - 1000, invSettledAt: Date.now() - 900, pending: false, _settled: 2 } : null;
    vm.runInContext('if (globalThis.__c) _lpValueFactCache["6189"] = globalThis.__c; else delete _lpValueFactCache["6189"]; window._lpGrabStartedAt = Date.now() - 5000;', sb);
  };
  const fuc = (d) => { const r = sb._lpFeedUnitCheck(d); return [r.confirmed, r.source || '']; };

  console.log(' 1. VinSolutions\' active status confirms the unit when the feed has not caught up:');
  setFeed([OTHER]);
  check('log274 shape: not in the feed, VinSolutions Status A on this lead\'s own stock -> confirmed, from VinSolutions', () => fuc(lead()), [true, 'vinsolutions']);
  setFeed(null);
  check('...and with no feed loaded at all', () => fuc(lead()), [true, 'vinsolutions']);
  setFeed([OTHER]);
  check('control: Status I (out of active inventory) -> not confirmed', () => fuc(lead({ _pdStatus: 'I' })), [false, '']);
  check('control: a stock found elsewhere on the page, not PageData\'s (v9.7.696) -> not confirmed', () => fuc(lead({ _pdUnitStock: '' })), [false, '']);
  check('control: VinSolutions\' warning banner -> not confirmed', () => fuc(lead({ inventoryWarning: true, _rgxInventoryWarning: true })), [false, '']);
  check('control: an agent note says it sold -> not confirmed', () => fuc(lead({ inventoryWarningFromNotes: true })), [false, '']);
  check('control: sale pending -> not confirmed', () => fuc(lead({ vehiclePendingSale: true })), [false, '']);
  check('control: in transit -> not confirmed', () => fuc(lead({ isInTransit: true })), [false, '']);
  setFeed([{ stock: 'TEST001A', stockNum: 'TEST001A', vehicle: '2026 Toyota RAV4 XLE', year: 2026, make: 'Toyota', model: 'RAV4 XLE', condition: 'new' }]);
  check('control: the feed holds this stock as a DIFFERENT vehicle -> not confirmed', () => fuc(lead()), [false, '']);
  setFeed([UNIT, OTHER]);
  check('control: the feed has it (log275) -> confirmed from the feed, as before (new field: source)', () => fuc(lead()), [true, 'feed']);

  console.log(' 2. the prompt says so, and says where it came from:');
  const pfd = (d, units) => {
    setFeed(units);
    const full = Object.assign({ name: 'Test Buyer', agent: 'Agent Name', store: 'Community Toyota Baytown', leadSource: 'Edmunds', convState: 'first-touch',
      leadAgeDays: 0, totalNoteCount: 4, hasOutbound: true, hasCustomerReply: false, relationshipSignals: { lastInboundAgeDays: 0 },
      conversationBrief: brief([CALL, SYS_NOTE]), history: '', context: '', pdPresent: true, pdHasLeadVehicle: true, pdVoiCount: 1 }, d);
    vm.runInContext('activeFlags = new Set(); leadContext = "";', sb); sb.__logs.length = 0;
    sb.populateFromData(full);
    return { d: full, c: vm.runInContext('leadContext', sb) };
  };
  const vs = pfd(lead(), [OTHER]);
  check('log274 shape: "confirmed in stock" and "CONFIRMED IN STOCK BY VINSOLUTIONS", no "NOT confirmed available"',
    () => [/2026 Toyota Tundra 4WD 1794 Edition — confirmed in stock/.test(vs.c), /CONFIRMED IN STOCK BY VINSOLUTIONS/.test(vs.c), /NOT confirmed available/.test(vs.c), !!vs.d._lpInvConfirmedAvailable], [true, true, false, true]);
  const fd = pfd(lead(), [UNIT, OTHER]);
  check('control: confirmed from the feed keeps the feed\'s wording', () => [/CONFIRMED IN TODAY’S LIVE INVENTORY LOAD/.test(fd.c), /BY VINSOLUTIONS/.test(fd.c)], [true, false]);
  const off = pfd(lead({ _pdStatus: 'I', inventoryWarning: true }), [OTHER]);
  check('control: Status I -> no confirmation line', () => [/CONFIRMED IN STOCK/.test(off.c), /confirmed in stock\./.test(off.c)], [false, false]);

  console.log(' 3. the CRM\'s record of a vehicle change is not the customer asking for another trim:');
  check('log274 shape: "By: System Primary vehicle changed from ... Tundra SR ..." -> no VARIANT MISMATCH', () => /VEHICLE VARIANT MISMATCH/.test(vs.c), false);
  const asked = pfd(lead({ conversationBrief: brief([CALL, ent('10/01/2026 1:26 PM', 'NOTE', 'General Note', 'By: Agent Name Customer is really after the 2026 Toyota Tundra SR5, not the 1794.')]) }), [OTHER]);
  check('control: an agent\'s note of what the customer asked for still raises it ("sr5")', () => /VEHICLE VARIANT MISMATCH[^\n]*"sr5"/.test(asked.c), true);

  console.log(' 4. a missed appointment on an earlier lead does not set this lead\'s timing:');
  const bup = (extra) => {
    setFeed([UNIT, OTHER]);
    vm.runInContext('leadContext = ""; window._lpSuppressApptChip = false; window._lpNoApptLeadId = "";', sb);
    return sb.__lp.buildUserPrompt(Object.assign({ name: 'Test Buyer', agent: 'Agent Name', phone: '(555) 010-0199', email: 'test@example.com',
      vehicle: '2026 Toyota Tundra 4WD 1794 Edition', stockNum: 'TEST001A', dealerId: '6189', store: 'Community Toyota Baytown', leadSource: 'Edmunds',
      convState: 'first-touch', hasOutbound: true, hasCustomerReply: false, totalNoteCount: 4, relationshipSignals: {}, autoLeadId: '2000000001',
      context: '', lastInboundMsg: '', hasMissedAppt: true }, extra));
  };
  check('log274 shape: the only appointment events are 58 days old, the lead is from today -> no "APPOINTMENT FELL THROUGH"',
    () => /APPOINTMENT FELL THROUGH/.test(bup({ freshestApptEventDays: 58, leadAgeDays: 0 })), false);
  check('control: missed today, on this lead -> the block stands', () => /APPOINTMENT FELL THROUGH/.test(bup({ freshestApptEventDays: 0, leadAgeDays: 0 })), true);
  check('control: no event age known -> the block stands, as before', () => /APPOINTMENT FELL THROUGH/.test(bup({ leadAgeDays: 0 })), true);

  console.log(' 5. a listing site\'s price fields are not the customer\'s words:');
  const a = src.indexOf('    function _lpIsToolFieldBlob(s) {'), b = src.indexOf('\n    }', a);
  const pa = src.indexOf('    var _lpToolIsPrice = '), pb = src.indexOf('    if (_lpToolFieldData) {\n      var toolDataBlock', pa);
  const ctx = { String, RegExp, JSON };
  vm.createContext(ctx);
  if (a > 0 && b > a) vm.runInContext(src.slice(a, b + 6), ctx);
  const blob = (s) => (typeof ctx._lpIsToolFieldBlob === 'function' ? ctx._lpIsToolFieldBlob(s) : 'no _lpIsToolFieldBlob');
  check('log274: Edmunds\' "Base MSRP: 43260.0 Base TMV: 39663.0 ..." is a record, not an inquiry', () => blob(EDMUNDS), true);
  check('control: a customer\'s sentence with a decimal in it stays theirs', () => blob('Can you do 2.9% on the 36 month? My budget is $450. Thanks.'), false);
  check('control: "Trade: 2019 Durango. Timeframe: 2 weeks." keeps its periods and stays theirs', () => blob('Trade: 2019 Durango. Timeframe: 2 weeks. Color: red.'), false);
  const priceBlock = (voiSwap, text) => {
    if (pa < 0 || pb < 0) return 'price block not found (new code)';
    const c = { String, RegExp, JSON, _lpToolFieldData: EDMUNDS, _voiSwap: voiSwap, TEXT: text || '', conversationBrief: 'AGENT CONTEXT', _lpD: () => {} };
    vm.createContext(c); vm.runInContext(src.slice(pa, pb), c);
    return { brief: c.conversationBrief, left: c._lpToolFieldData };
  };
  const same = priceBlock(null, '');
  check('vehicle unchanged: shown as the site\'s figures, never as the customer\'s words', () => typeof same === 'string' ? same
    : [/^LISTING-SITE PRICE DATA — NOT THE CUSTOMER'S WORDS/.test(same.brief), /Do NOT quote them back/.test(same.brief), same.left], [true, true, '']);
  const moved = priceBlock({ fromStock: 'TEST000A', toStock: 'TEST001A' }, 'Primary vehicle changed from 2026 Toyota Tundra SR to 2026 Toyota Tundra 4WD 1794 Edition.');
  check('log274 shape: the store changed the vehicle -> the figures are withheld, the customer\'s timeframe "Week" is kept', () => typeof moved === 'string' ? moved
    : [/43260/.test(moved.brief), /LEAD FORM TIMEFRAME[^\n]*"Week"/.test(moved.brief)], [false, true]);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
