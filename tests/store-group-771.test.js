#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('store-group-771.test.js');
// (v9.7.771) Which dealerships are ours. Honda Baytown lead 2095705388 (log292): the visit notes say the rep "went to Kia
// and showed a telluride"; the draft wrote "the Telluride Hybrid at Kia" without any prompt ever saying which stores are in
// the group. Gil, 10/7: the three Baytown stores (Toyota, Kia, Honda) are sister stores and may be named; Audi Lafayette and
// Community Honda Lafayette have no connection to each other or anyone else, so another brand in Lafayette is a competitor.
// On a Baytown be-back that went to a sister store, the close offers both: own-brand options based on what they liked, and
// the sister store's numbers on that vehicle. Every store sells used units of other brands, so a mention counts only when the
// notes say they went elsewhere for it. Executes the shipped populateFromData. Placeholder data only.
//
// Usage: node tests/store-group-771.test.js <dev popup.js> <commercial popup.js>
const vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: store-group-771.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const STORES = { hb: ['6191', 'Community Honda Baytown'], kb: ['6190', 'Community Kia Baytown'], tb: ['6189', 'Community Toyota Baytown'],
  hl: ['24399', 'Community Honda Lafayette'], al: ['21135', 'Audi Lafayette'] };
const VISIT = (txt) => '[10/06/2026 4:29 PM] [SHOWROOM VISIT]\n  By: Rep Name\n  ' + txt + '\n[10/06/2026 9:00 AM] [AGENT] Outbound Text Message\n  Hi Test.';
for (const f of BUILDS) {
  console.log('\n== ' + f);
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (expr) => vm.runInContext(expr, sb);
  const lead = (st, notes, x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '', dealerId: STORES[st][0],
    store: STORES[st][1], leadSource: 'Showroom', convState: 'active-follow-up', leadAgeDays: 1, isShowroomFollowUp: true,
    showroomDetails: 'By: Rep Name\n' + notes, conversationBrief: VISIT(notes), hasOutbound: true, totalNoteCount: 6,
    phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '', relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 0 } }, x || {});
  const ctx = (d) => { run('activeFlags = new Set(); leadContext = "";'); const ol = sb.console.log; sb.console.log = () => {};
    try { sb.populateFromData(d); } finally { sb.console.log = ol; } return run('leadContext'); };
  const line = (c, rx) => (c.split('\n').find(l => rx.test(l)) || '');

  console.log(' 1. Baytown be-back that went to a sister store (lead 2095705388 shape):');
  const c1 = ctx(lead('hb', 'Showed them a passport, pilot, and went to Kia and showed a telluride really likes the Kia telluride hybrid needs to be in white the high trim.'));
  const s1 = line(c1, /^SISTER STORE ON THIS VISIT/);
  check('the close offers both: Honda options based on the Telluride, and the Telluride numbers from Community Kia Baytown', () =>
    [/looked at the Kia Telluride at our sister store Community Kia Baytown/.test(s1), /Rep putting together a couple of Honda options based on what they liked about the Telluride/.test(s1),
     /getting them the numbers on that Kia Telluride from Community Kia Baytown/.test(s1), /never say we carry Kia at Community Honda Baytown/.test(s1), /Still one question/.test(s1)], [true, true, true, true, true]);
  check('the roster names the three Baytown sister stores and calls every other dealer a competitor', () => { const r = line(c1, /^OUR STORES:/);
    return [/Community Toyota Baytown, Community Kia Baytown and Community Honda Baytown/.test(r), /Any other dealership[^.]*is a competitor/.test(r), /A used vehicle of any brand on our own lot is ours to sell/.test(r)]; }, [true, true, true]);
  check('Toyota Baytown, "went over to Honda next door, liked the Pilot": sister store Community Honda Baytown', () =>
    /looked at the Honda Pilot at our sister store Community Honda Baytown/.test(line(ctx(lead('tb', 'Drove the RAV4 then went over to Honda next door and liked the Pilot.')), /^SISTER STORE ON/)), true);

  console.log(' 2. Lafayette has no sister store:');
  const c2 = ctx(lead('hl', 'Showed the Pilot then they went to Kia and looked at a Telluride.'));
  check('Honda Lafayette, notes went to Kia: competitor line, no sister store, Kia not named as ours', () =>
    [/^ANOTHER BRAND IN THE VISIT NOTES: the notes mention a Kia Telluride\. Community Honda Lafayette has no sister store/m.test(c2), /Do not name the Kia or the dealership/.test(c2),
     /Make the offer about our own Honda vehicles/.test(c2), /SISTER STORE ON/.test(c2), /Community Kia Baytown/.test(c2)], [true, true, true, false, false]);
  check('...and its roster says it has no sister store and is connected to no other dealership', () =>
    /^OUR STORE: Community Honda Lafayette has no sister store\. It is not connected to any other dealership, in Lafayette or anywhere else\./m.test(c2), true);
  const c3 = ctx(lead('al', 'Customer is comparing a Honda Pilot across the street.'));
  check('Audi Lafayette, comparing a Honda: a competitor, and Community Honda Lafayette is never offered as a sister store', () =>
    [/^ANOTHER BRAND IN THE VISIT NOTES: the notes mention a Honda Pilot\. Audi Lafayette has no sister store/m.test(c3), /sister store Community Honda/.test(c3)], [true, false]);

  console.log(' 3. controls -- nothing new:');
  check('a used Ford F-150 on the Honda lot (the lead vehicle) is ours, not a competitor', () =>
    /SISTER STORE ON|ANOTHER BRAND IN/.test(ctx(lead('hb', 'Showed him the Ford F-150 and went to the desk. Wants to think about it.', { vehicle: '2023 Ford F-150 XL' }))), false);
  check('a used unit of another brand named as used or in stock: no visit line', () =>
    /SISTER STORE ON|ANOTHER BRAND IN/.test(ctx(lead('hl', 'Went to look at the used Toyota Highlander in stock.'))), false);
  check('their trade is not a vehicle they looked at', () =>
    /SISTER STORE ON|ANOTHER BRAND IN/.test(ctx(lead('hb', 'Trade appraisal on his 2015 Toyota Camry, went to the desk.'))), false);
  check('another brand with no went-elsewhere cue: no visit line', () => /SISTER STORE ON|ANOTHER BRAND IN/.test(ctx(lead('kb', 'Likes the Telluride but also mentioned the Honda Pilot.'))), false);
  check('only its own brand anywhere: no roster and no visit line', () => /^OUR STORE|SISTER STORE ON|ANOTHER BRAND IN/m.test(ctx(lead('hb', 'Showed the Pilot and the Passport, went to the desk.'))), false);
  check('not a showroom follow-up: the roster can appear, the visit line cannot', () => { const c = ctx(lead('kb', 'x', { isShowroomFollowUp: false, conversationBrief: '[10/06/2026 9:00 AM] [CUSTOMER] Inbound Text Message\n  Is this better than the Honda Pilot?', showroomDetails: '' }));
    return [/^OUR STORES: Community Kia Baytown is one of three sister stores/m.test(c), /SISTER STORE ON|ANOTHER BRAND IN/.test(c)]; }, [true, false]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
