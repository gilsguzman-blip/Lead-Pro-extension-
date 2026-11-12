#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('our-store-first-772.test.js');
// (v9.7.772) log293, Honda Baytown lead 2095705388 on 771. The first pass offered "a couple of Honda options and the numbers on
// the Telluride from Community Kia Baytown"; the text rewrite opened on the Telluride, offered "the Telluride numbers and a
// couple of Honda options", and dropped the store name -- it read as a push to the Kia store. Gil, 10/7: we are the Honda store.
// The sister-store line now says to lead with our store, and the rewrite is told to keep our options first and the sister
// store's name on the other vehicle's numbers. Executes the shipped populateFromData and _lpBuildSmsRefinePrompt.
// Placeholder data only.
//
// Usage: node tests/our-store-first-772.test.js <dev popup.js> <commercial popup.js>
const vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: our-store-first-772.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const STORES = { hb: ['6191', 'Community Honda Baytown'], tb: ['6189', 'Community Toyota Baytown'], hl: ['24399', 'Community Honda Lafayette'] };
const VISIT = (txt) => '[10/06/2026 4:29 PM] [SHOWROOM VISIT]\n  By: Rep Name\n  ' + txt + '\n[10/06/2026 9:00 AM] [AGENT] Outbound Text Message\n  Hi Test.';
const KIA = 'Showed them a passport, pilot, and went to Kia and showed a telluride really likes the Kia telluride hybrid.';
const EMAIL = 'Subject: Honda options\n\nTest,\n\nRep Name can put together a couple of Honda options.\n\nAgent Name';
const PASS1 = 'Test, would you like Rep Name to put together a couple of Honda options and the numbers on the Telluride from Community Kia Baytown?';
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
  const refine = (d) => { const ol = sb.console.log; sb.console.log = () => {}; try { return run('_lpBuildSmsRefinePrompt')(PASS1, EMAIL, d); } finally { sb.console.log = ol; } };

  console.log(' 1. the brief (lead 2095705388 shape):');
  const s1 = (ctx(lead('hb', KIA)).split('\n').find(l => /^SISTER STORE ON THIS VISIT/.test(l)) || '');
  check('the sister-store line says to lead with our store: open on the visit or the rep, not the Telluride', () =>
    /LEAD WITH OUR STORE: open on their visit here or on Rep, not on the Telluride\./.test(s1), true);
  check('...Honda options first, Telluride numbers second as the comparison, always from Community Kia Baytown', () =>
    /the Honda options come FIRST; the Telluride numbers come second, as the comparison, and always say they come from Community Kia Baytown\./.test(s1), true);

  console.log(' 2. the text rewrite:');
  const r1 = refine(lead('hb', KIA));
  check('the rewrite is told our store first, and to keep "from Community Kia Baytown"', () =>
    [/OUR STORE FIRST/.test(r1), /We are Community Honda Baytown\. Do not open the text on the Telluride\./.test(r1),
     /the Honda options come first and the Telluride numbers second, and keep "from Community Kia Baytown" with them/.test(r1)], [true, true, true]);
  check('Toyota Baytown whose customer went to Honda: the same block, the other way round', () =>
    /We are Community Toyota Baytown\. Do not open the text on the Pilot\. In the offer the Toyota options come first/.test(refine(lead('tb', 'Drove the RAV4 then went over to Honda next door and liked the Pilot.'))), true);

  console.log(' 3. controls -- no block:');
  check('Lafayette (no sister store)', () => /OUR STORE FIRST/.test(refine(lead('hl', 'Showed the Pilot then they went to Kia and looked at a Telluride.'))), false);
  check('a Baytown be-back that stayed with its own brand', () => /OUR STORE FIRST/.test(refine(lead('hb', 'Showed the Pilot and the Passport, went to the desk.'))), false);
  check('not a showroom follow-up', () => /OUR STORE FIRST/.test(refine(lead('hb', KIA, { isShowroomFollowUp: false }))), false);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
