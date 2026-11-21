#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('email-field-779.test.js');
// (v9.7.779) 10/8 /degenerate (proxy v7.87's first day of failure reasons): all 15 rejected full drafts were GPT-6 Luna
// writing "email" as "subject", "subject omitted", "subject line omitted" or "{" -- with the subject in its own field.
// The prompt said "Subject line in the "subject" field" and never said what the email field must hold. It now does, in
// the system prompt's EMAIL rule and CRITICAL line and in the user prompt's JSON line. Executes the shipped
// buildSystemPrompt and buildUserPrompt. Placeholder data only.
//
// Usage: node tests/email-field-779.test.js <dev popup.js> <commercial popup.js>
const path = require('path');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: email-field-779.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const LEAD = { name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '2026 Honda Accord', dealerId: '24399', store: 'Community Honda Lafayette',
  leadSource: 'Internet', convState: 'first-touch', leadAgeDays: 0, hasOutbound: false, totalNoteCount: 1, phone: '(555) 010-0199', email: 'test@example.com',
  lastInboundMsg: '', relationshipSignals: { unansweredQuestions: [] }, context: '' };
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const quiet = (fn) => { const ol = sb.console.log; sb.console.log = () => {}; try { return fn(); } finally { sb.console.log = ol; } };
  const sys = quiet(() => sb.__lp.buildSystemPrompt('bdc'));
  const up = quiet(() => sb.__lp.buildUserPrompt(Object.assign({}, LEAD)));
  check('the EMAIL rule says what the email field holds, and that it is never a label or a note about the subject', () =>
    /The "email" field is the WHOLE email every time -- greeting, body, close and signature\. It is never a label, a placeholder or a note about the subject \("subject", "subject omitted"\): the subject text goes in the "subject" field and nowhere else\./.test(sys), true);
  check('the CRITICAL line: never a single word or a note in its place', () => /Never return an empty string for email, and never a single word or a note in its place: "email" holds the full written email\./.test(sys), true);
  check('the user prompt\'s JSON line says it too', () => /"email" is the full email from greeting to signature; "subject" is the subject line alone\./.test(up), true);
  check('control: the subject still has its own field, and all four fields are still required', () =>
    [/Subject line in the "subject" field\./.test(sys), /You MUST always include ALL four fields/.test(sys)], [true, true]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
