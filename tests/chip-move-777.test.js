#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('chip-move-777.test.js');
// (v9.7.777) log299, Honda Lafayette lead 2091288708 on v9.7.776. The first draft acknowledged the missed appointment and
// asked whether they still wanted to come in -- the 775 fix working. The agent pressed Warmer, and the regenerated draft
// asked "Was the $1,000 offer on a new Honda what you wanted to ask about?". Two causes:
//  (1) the drafts-already-written block (v9.7.688) said "they are rejecting THE MOVE ... make a different one" on every
//      regenerate, beside the chip's "warm the tone" -- a chip is an adjustment of the newest draft, not a rejection of
//      its move. With a chip pressed the block now says keep the newest draft's move and change only what the chip asks.
//  (2) our first text, "the $1,000 off MSRP offer applies to the new Honda you choose", registered as price only, so the
//      relationship facts listed incentive as "Not raised with this customer yet". A dollar amount OFF and an offer we
//      name as one are now the incentive angle.
// Executes the shipped buildUserPrompt and _lpArcAnglesSpent. Placeholder data only.
//
// Usage: node tests/chip-move-777.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: chip-move-777.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const LEAD = { name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '', dealerId: '24399',
  store: 'Community Honda Lafayette', leadSource: 'Identitymax', convState: 'active-follow-up', leadAgeDays: 9, hasOutbound: true, totalNoteCount: 20,
  phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: 'Okay', hasMissedAppt: true, relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 0 }, context: '' };
const DRAFT = '[NAME], sorry we missed you Saturday. If you are still interested in coming in, just let me know. Agent Name';
const FIRST_TEXT = 'Test, the $1,000 off MSRP offer applies to the new Honda you choose, with eligibility confirmed in person. Which model and trim are you considering?';

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const prompt = (directive, key) => {
    vm.runInContext('leadContext = ""; window._lpDraftHistory = ' + JSON.stringify([DRAFT]) + '; window._lpRegenDirective = ' + JSON.stringify(directive)
      + '; window._lpRegenChipKey = ' + JSON.stringify(key) + ';', sb);
    const ol = sb.console.log; sb.console.log = () => {};
    try { return sb.__lp.buildUserPrompt(Object.assign({}, LEAD)); } finally { sb.console.log = ol; vm.runInContext('window._lpDraftHistory = []; window._lpRegenDirective = ""; window._lpRegenChipKey = "";', sb); }
  };
  const WARM = vm.runInContext('_regenDirectives', sb).warmer;

  console.log(' 1. a chip regenerate keeps the newest draft\'s move:');
  const pw = prompt(WARM, 'warmer');
  check('Warmer (lead 2091288708 shape): no "rejecting THE MOVE ... make a different one"', () =>
    [/they are rejecting THE MOVE/.test(pw), /make a different one/.test(pw), /THE AGENT REJECTED EVERY ONE/.test(pw)], [false, false, false]);
  check('...it says the chip is the change, keep the newest draft\'s subject and ask, no new topic, offer or angle', () =>
    /THE AGENT PRESSED AN ADJUSTMENT \(the TONE ADJUSTMENT above\), AND THAT ADJUSTMENT IS THE CHANGE THEY ASKED FOR\. Keep what the newest draft above was doing[^\n]*Do NOT swap in a different topic, offer or angle/.test(pw), true);
  check('...beside the chip\'s own directive and the draft it adjusts', () =>
    [pw.indexOf('━━━ TONE ADJUSTMENT (REGENERATE) ━━━') >= 0, pw.indexOf(WARM) >= 0, /1\. \[NAME\], sorry we missed you Saturday/.test(pw)], [true, true, true]);
  check('every chip takes the adjustment wording, not "make a different one"', () => {
    const D = vm.runInContext('_regenDirectives', sb);
    return Object.keys(D).filter(k => { const p = prompt(D[k], k); return /make a different one/.test(p) || !/THAT ADJUSTMENT IS THE CHANGE THEY ASKED FOR/.test(p); }); }, []);
  check('control: a plain Regenerate (no chip) still says the move is what was rejected', () => { const p = prompt('', '');
    return [/REWORDING IS NOT REGENERATING/.test(p), /make a different one/.test(p), /THE AGENT REJECTED EVERY ONE/.test(p), /THAT ADJUSTMENT IS THE CHANGE/.test(p)]; }, [true, true, true, false]);

  console.log(' 2. a dollar-off offer we sent is the incentive angle:');
  const spent = (body) => sb._lpArcAnglesSpent([{ body, ms: 1 }]);
  check('"$1,000 off MSRP offer applies to the new Honda you choose": incentive spent, not listed as unused', () => {
    const r = spent(FIRST_TEXT); return [r.spent.some(x => x.angle === 'incentive'), r.unused.indexOf('incentive') >= 0, r.spent.some(x => x.angle === 'price')]; }, [true, false, true]);
  check('"$500 off", "the website offer", "the offer is still good" count; "$500 down" and "I can offer 10 AM" do not', () =>
    ['There is $500 off this one.', 'You claimed the website offer.', 'That offer is still good this week.', 'With $500 down the payment is lower.', 'I can offer 10:00 AM or 11:00 AM.']
      .map(t => spent(t).spent.some(x => x.angle === 'incentive')), [true, true, true, false, false]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
