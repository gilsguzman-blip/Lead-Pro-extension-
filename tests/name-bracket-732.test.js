#!/usr/bin/env node
'use strict';
// (v9.7.732) 9/26, Audi Lafayette, a Drive By lead (2090426084): the draft opened "Hi [Firstname], this is
// Dahize, your Audi Concierge at Audi Lafayette." The Audi opener template reads 'Hi [Name], this is ...'
// and the model kept the brackets around the real name (the feedback export showed "[[NAME]]", the scrub
// masking the name inside the model's own brackets). Now, after the model, brackets around the customer's
// name are removed and an unfilled name placeholder becomes their first name (or "there" with no name).
// Executes the shipped _lpUnbracketName and checks it runs on every path that writes a draft.
// Placeholder names only.
//
// Usage: node tests/name-bracket-732.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: name-bracket-732.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
for (const f of BUILDS) {
  const src = fs.readFileSync(f, 'utf8');
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const sb = loadPopup(f, { withAuth: true });
  const ub = (t, n) => vm.runInContext('_lpUnbracketName', sb)(t, n);
  const N = 'Test Buyer';

  console.log(' 1. the customer\'s name comes out plain:');
  check('the 9/26 shape: "Hi [Test], this is Agent, your Audi Concierge"', () => ub('Hi [Test], this is Agent, your Audi Concierge at Audi Lafayette.', N), 'Hi Test, this is Agent, your Audi Concierge at Audi Lafayette.');
  check('double brackets and the full name', () => [ub('[[Test]], the Q3 and Q5 are different sizes.', N), ub('Hi [Test Buyer],', N)], ['Test, the Q3 and Q5 are different sizes.', 'Hi Test Buyer,']);
  check('an unfilled placeholder takes their first name', () => ['Hi [Name],', 'Hi [Customer Name],', 'Hi [First Name],', '[Customer], quick one'].map(t => ub(t, N)), ['Hi Test,', 'Hi Test,', 'Hi Test,', 'Test, quick one']);
  check('...or "there" when no name is on the lead', () => ub('Hi [Name], this is Agent.', ''), 'Hi there, this is Agent.');

  console.log(' 2. and nothing else moves:');
  check('control: other bracketed text stays (a stock number, a model)', () => ub('Stock [P0000001] and the [Q5] stay as written.', N), 'Stock [P0000001] and the [Q5] stay as written.');
  check('control: a draft with no brackets is returned unchanged', () => ub('Test, the Q5 is here.', N), 'Test, the Q5 is here.');
  check('control: empty and null are safe', () => [ub('', N), ub(null, N)], ['', '']);

  console.log(' 3. every path that writes a draft runs it:');
  check('the main draft (SMS, subject, email) right after parsing', () => /var rawEmail = flattenField\(parsed\.email, 'email'\);\s*\/\/ \(v9\.7\.732\)[\s\S]{0,400}rawSms = _lpUnbracketName\(rawSms, _ubName\); rawSubject = _lpUnbracketName\(rawSubject, _ubName\); rawEmail = _lpUnbracketName\(rawEmail, _ubName\);/.test(src), true);
  check('the SMS refine pass, which writes the SMS again', () => /if \(_rfSms\) rawSms = _rfSms;\s*try \{ rawSms = _lpUnbracketName\(rawSms,/.test(src), true);
  check('the voicemail', () => /vmText = parsed\.voicemail \|\| parsed\.vm \|\| parsed\.message \|\| rawText;\s*try \{ vmText = _lpUnbracketName\(vmText,/.test(src), true);
  check('the Audi opener template says the name goes in without brackets', () => /\[Name\] stands for the customer\\'s first name, written plainly: never in brackets/.test(src), true);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
