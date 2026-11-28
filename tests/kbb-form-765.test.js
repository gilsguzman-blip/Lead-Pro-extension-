#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('kbb-form-765.test.js');
// (v9.7.765) Two fixes.
//  (1) THE TRADE-IN FORM'S CONDITION QUESTIONS ARE NOT THE CUSTOMER'S. Audi Lafayette lead 2094315571 (log286): the Gubagoo
//      Click & Go "Lead received" note carries "How much were repair costs?" / "Dashboard warning lights" between "Total Value
//      Adjustment" and "Net Trade-in Value", and the open-question detector read the label as her question. Executes the
//      shipped cut, lifted from inlineScraper.
//  (2) "WORTH THE TRIP" OUT OF THE PROMPT. v9.7.764 rewrote "Make the comparison worth 20 minutes" to "...worth the trip",
//      a phrase the text-rewrite rules ban as distance talk. The sentence is cut. The CarGurus rule's "...and worth the
//      drive", the same banned phrase, now reads "worth coming in to see". No prompt string carries either.
// Placeholder data only.
//
// Usage: node tests/kbb-form-765.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: kbb-form-765.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const NOTE = 'Lead received\nBy: System\nPayment: $365.81/month (Finance);\nTrade-In Vehicle: 2014 Test Sedan SE\nMileage: 200,900 mi\nKBB Value Range: $600 to $1,100\n'
  + 'Trade-In Value: $800 (Average value)\nTotal Value Adjustment (Vehicle Condition): $0\nHow much were repair costs?\nDashboard warning lights\nNet Trade-in Value: $800\nLead Type: virtual retailing';
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  const a = src.indexOf('  function inlineScraper() {'), b = src.indexOf('  } // end inlineScraper', a);
  const line = (src.match(/qbody = qbody\.replace\(\/Total Value Adjustment[^\n]*/) || [''])[0];
  console.log(' 1. the trade form\'s condition questions (shipped cut, lifted from inlineScraper):');
  check('(new code) the cut is inside inlineScraper, before the question collector runs', () => {
    const i = src.indexOf(line), q = src.indexOf("var qs = qbody.match(/[^.!?\\n]{8,200}\\?/g)", a);
    return !!line && i > a && i < b && i < q; }, true);
  const cut = (t) => { if (!line) return t; const ctx = { qbody: t }; vm.createContext(ctx); vm.runInContext(line, ctx); return ctx.qbody; };
  const o = cut(NOTE);
  check('"How much were repair costs?" and its answer are gone; the trade and payment lines around them stay', () =>
    [/repair costs/.test(o), /Dashboard warning/.test(o), /Net Trade-in Value: \$800/.test(o), /Trade-In Value: \$800 \(Average value\)/.test(o), /Payment: \$365\.81/.test(o)],
    [false, false, true, true, true]);
  check('no question mark is left for the collector to find in that note', () => (o.match(/[^.!?\n]{8,200}\?/g) || []).length, 0);
  check('a lead note with the customer\'s own questions and no condition section is untouched', () => {
    const t = 'Lead received\nComments:\n1. Can you confirm it’s still available?\n2. Could you send a photo of the window sticker?'; return cut(t) === t; }, true);
  check('without a "Net Trade-in Value" line nothing is cut (the cut needs both ends)', () => {
    const t = 'Total Value Adjustment (Vehicle Condition): $0\nHow much were repair costs?\nDashboard warning lights'; return cut(t) === t; }, true);

  console.log(' 2. no distance phrase in a prompt string:');
  const code = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  check('"worth the trip" / "worth the drive" appear only in the rule that bans them', () =>
    (code.match(/[^\n]{0,60}worth the (?:trip|drive)[^\n]{0,20}/g) || []).filter(m => !/never tell a customer how far|"worth the drive"|"worth the trip"/.test(m)), []);
  check('the comparison line ends on its list of advantages', () => /'- Give a specific advantage: availability, price, trade value, feature match, or proximity\.',/.test(src), true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
