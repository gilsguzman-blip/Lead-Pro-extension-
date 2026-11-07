#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('dashboard-join-v112.test.js');
// dashboard v1.12 (audit M-10, measurement only). The Agents footnote listed "matched to their generation", "by license" and
// "unattributed" side by side as if all three were joins. Only a request-id match is; "by license" is the feedback row's own
// user field. The line now gives the matched share as a percentage and names the fallback. Evaluates the footnote expression
// sliced from the page with a fixed attribution object. Placeholder data only.
//
// Usage: node tests/dashboard-join-v112.test.js <dashboard.html>
const fs = require('fs'), vm = require('vm');
const HTML = process.argv[2];
if (!HTML) { console.error('usage: dashboard-join-v112.test.js <dashboard.html>'); process.exit(2); }
const html = fs.readFileSync(HTML, 'utf8');
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
// The disclosure's text arguments, from the attribution line to the end of that h(...) call's string list.
const a = html.indexOf("(at.feedback || 0).toLocaleString()"), b = html.indexOf("'Drafts, hours, draft time", a);
const expr = a > 0 && b > a ? html.slice(a, b).trim().replace(/,\s*$/, '').replace(/\/\/[^\n]*\n/g, '\n') : '';
const render = (at) => { const box = { at, Math }; vm.createContext(box); return vm.runInContext('[' + expr + '].join("")', box); };
check('the matched share is given as a percentage, and the license credit is named as no request-id match', () =>
  render({ feedback: 8, joined: 2, byUser: 5, unattributed: 1 }),
  '8 feedback sessions: 2 matched to their generation by request id (25%), 5 credited by the license on the feedback row (no request-id match), 1 unattributed. '
  + 'The Feedback Gatherer export lists why each unmatched session was not joined. ');
check('control: no sessions: no percentage, no division by zero', () => /\(NaN%\)|Infinity/.test(render({ feedback: 0, joined: 0, byUser: 0, unattributed: 0 })), false);
check('the page says v1.12', () => /const DASH_VERSION = 'v1\.12';/.test(html), true);
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
