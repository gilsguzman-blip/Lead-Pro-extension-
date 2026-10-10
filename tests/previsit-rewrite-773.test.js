#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('previsit-rewrite-773.test.js');
// (v9.7.773) log295. The text rewrite is handed the raw scrape, not the generation payload, so v9.7.195's rule -- a customer
// text sent BEFORE the newest showroom visit is left out -- never reached it. Toyota Baytown lead 2093513607: her 9:22 AM
// "on my way, running a little late" (visit 9:55 AM) came back as "thanks for letting us know you're running a little late";
// lead 2092136687's rewrite answered a pre-visit mileage question the visit had handled. Both first passes were right.
// Executes the shipped _lpBuildSmsRefinePrompt. Placeholder data only.
//
// Usage: node tests/previsit-rewrite-773.test.js <dev popup.js> <commercial popup.js>
const vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: previsit-rewrite-773.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const LATE = 'Buenos días, estoy en camino llegaré un poquito tarde';
const MILES = 'How many miles does the gray one that’s lifted have?';
const EMAIL = 'Subject: Your trade and the Camry\n\nHi Test,\n\nYou came in today to look at a 2026 Camry and have your trade assessed.\n\nWould a quick call be helpful?\n\nAgent Name';
const PASS1 = 'Test, I want to make sure you get a clear answer on your trade value as you consider the 2026 Camry. Would a quick call be helpful?';
for (const f of BUILDS) {
  console.log('\n== ' + f);
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const build = (x) => { const ol = sb.console.log; sb.console.log = () => {};
    try { return vm.runInContext('_lpBuildSmsRefinePrompt', sb)(PASS1, EMAIL, Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name',
      store: 'Community Toyota Baytown', dealerId: '6189', isShowroomFollowUp: true, relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 0 } }, x)); }
    finally { sb.console.log = ol; } };

  console.log(' 1. a text sent before the visit is left out of the rewrite:');
  const p1 = build({ inboundPreVisit: true, lastInboundMsg: LATE });
  check('lead 2093513607 shape: no "running late" text, and no last-message block at all', () =>
    [p1.indexOf('poquito tarde') !== -1, /WHAT THE CUSTOMER LAST SAID/.test(p1)], [false, false]);
  check('lead 2092136687 shape: the pre-visit mileage question is not shown', () => build({ inboundPreVisit: true, lastInboundMsg: MILES }).indexOf('How many miles') !== -1, false);
  check('...and the rest of the rewrite prompt is intact (email, first draft, one-offer block)', () =>
    [/THE EMAIL THAT IS GOING OUT/.test(p1), p1.indexOf(PASS1) !== -1, /ONE CONCRETE OFFER/.test(p1)], [true, true, true]);

  console.log(' 2. controls -- the last message is still shown:');
  check('sent after the visit (inboundPreVisit false)', () => { const p = build({ inboundPreVisit: false, lastInboundMsg: MILES });
    return [/WHAT THE CUSTOMER LAST SAID, IN THEIR OWN WORDS/.test(p), p.indexOf('How many miles') !== -1]; }, [true, true]);
  check('no visit flag at all (not a showroom lead)', () => build({ isShowroomFollowUp: false, lastInboundMsg: MILES }).indexOf('How many miles') !== -1, true);
  check('the 735 old-message block still applies when the message is not pre-visit', () =>
    /DAYS AGO, BACKGROUND ONLY/.test(build({ lastInboundMsg: MILES, relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 40 } })), true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
