#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('come-back-774.test.js');
// (v9.7.774) Gil, 10/7 (Honda Lafayette lead 2096017815, log296): showroom follow-ups kept offering to send the customer the
// numbers or offer details "to review at home". "We don't want that. We want them to come back and review new options."
// Every such draft since log292 traced to wording Lead Pro itself added (769's close examples, 768/769's no-vehicle line,
// 771's sister-store "compare at home"). The offer now brings them back in to go over new options with the rep, and the text
// rewrite is told not to turn it into sending. Executes the shipped populateFromData and _lpBuildSmsRefinePrompt.
// Placeholder data only.
//
// Usage: node tests/come-back-774.test.js <dev popup.js> <commercial popup.js>
const vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: come-back-774.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const VISIT = (txt) => '[10/07/2026 12:14 PM] [SHOWROOM VISIT]\n  By: Rep Name\n  ' + txt + '\n[10/07/2026 9:00 AM] [AGENT] Outbound Text Message\n  Hi Test.';
const EMAIL = 'Subject: The CR-V EX\n\nHi Test,\n\nRep Name noted you wanted to think it over.\n\nAgent Name';
// Every place "at home" (or "look them over") appears must be inside a prohibition.
const homeOffers = (t) => (t.match(/[^.\n]*\b(?:at home|look (?:them|it) over)\b[^.\n]*/gi) || []).filter(s => !/\b(?:not|never|NOT)\b/.test(s));
for (const f of BUILDS) {
  console.log('\n== ' + f);
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (expr) => vm.runInContext(expr, sb);
  const lead = (x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Honda CR-V EX', dealerId: '24399',
    store: 'Community Honda Lafayette', leadSource: 'Showroom', convState: 'active-follow-up', leadAgeDays: 1, isShowroomFollowUp: true,
    showroomDetails: 'By: Rep Name\nWants to think about it overnight.', conversationBrief: VISIT('Wants to think about it overnight.'), hasOutbound: true, totalNoteCount: 6,
    phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '', relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 0 } }, x || {});
  const ctx = (d) => { run('activeFlags = new Set(); leadContext = "";'); const ol = sb.console.log; sb.console.log = () => {};
    try { sb.populateFromData(d); } finally { sb.console.log = ol; } return run('leadContext'); };
  const refine = (d) => { const ol = sb.console.log; sb.console.log = () => {}; try { return run('_lpBuildSmsRefinePrompt')('Test, would you like Rep Name to go over a couple of new options when you come back in?', EMAIL, d); } finally { sb.console.log = ol; } };

  console.log(' 1. the showroom close brings them back in (lead 2096017815 shape):');
  const c1 = ctx(lead());
  check('the close: new options gone over with the rep, in person', () =>
    /CLOSE WITH ONE CONCRETE OFFER they can answer yes or no, and the offer BRINGS THEM BACK IN: the rep putting together new options for what the notes say[^\n]*going over them with them here, in person\./.test(c1), true);
  check('...and it says not to offer sending things to review at home', () =>
    /Do NOT offer to send numbers, offer details or options for them to review, look over or compare at home -- new options are reviewed here, with the rep\./.test(c1), true);
  check('no line in the brief offers "at home" or "look them over" as the next step', () => homeOffers(c1), []);

  console.log(' 2. the other showroom lines say the same:');
  const c2 = ctx(lead({ vehicle: '', showroomDetails: 'By: Rep Name\nThanks', conversationBrief: VISIT('Thanks') }));
  check('no vehicle on the lead: the example and the thin-notes offer both bring them back in', () =>
    [/coming back in so the rep can go over new options on the vehicle they liked/.test(c2), /new options on what they looked at to go over with them when they come back in/.test(c2), homeOffers(c2)], [true, true, []]);
  const c3 = ctx(lead({ vehicle: '', dealerId: '6191', store: 'Community Honda Baytown', showroomDetails: 'By: Rep Name\nShowed the Pilot and went to Kia and showed a telluride.',
    conversationBrief: VISIT('Showed the Pilot and went to Kia and showed a telluride.') }));
  check('Baytown sister-store visit: compared side by side when they come back in, not at home', () =>
    [/so they can come back in and compare them side by side -- not sent to compare at home/.test(c3), homeOffers(c3)], [true, []]);

  console.log(' 3. the text rewrite:');
  check('the rewrite is told the offer brings them back in, never sending for review at home', () =>
    /The offer brings them back in to go over new options with the rep; never turn it into sending numbers, details or options for them to review or compare at home\./.test(refine(lead())), true);
  check('control: not a showroom follow-up, no such line', () => /The offer brings them back in/.test(refine(lead({ isShowroomFollowUp: false }))), false);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
