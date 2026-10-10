#!/usr/bin/env node
'use strict';
// (v9.7.611) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('sms-opener.test.js');

/**
 * sms-opener.test.js — v9.7.667. THE GUARD TESTED A LIST OF BAD OPENERS, NOT THE RULE.
 *
 * Gil, 9/16: "grabbed Allie Trahan and it picked up the name on the text. So was the Amiee a once
 * wrong or is it broken." Neither. log204 carries TWO Aimee generations, both fresh, both shipping
 * an SMS with no first name, while Allie's on the same build opened with hers.
 *
 * The HARD CONSTRAINT is positive — "SMS: first-name opener". The guard was negative: it fired only
 * when the opener matched one of nine named template phrases AND the name was missing. Aimee's
 * opener is not on that list, so a message that plainly broke the rule passed untouched.
 *
 * Executes the SHIPPED guard against both real drafts.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: sms-opener.test.js <popup.js> [popup.js...]'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('    // Light-touch SMS opener check');
  if (a < 0) throw new Error('the opener guard not found');
  const b = src.indexOf('\n    })();', a);
  if (b < 0) throw new Error('the opener guard end not found');
  return { name: path.basename(path.dirname(file)), src, guard: src.slice(a, b + '\n    })();'.length) };
}

// ── THE TWO REAL DRAFTS, from log204 ────────────────────────────────────────
const AIMEE = 'The Glacial White Pearl 2026 Kia Sportage LX is here, and I can have it ready while we appraise your 2022 Seltos and get finance to confirm your approval. Can you make it at 1:30 PM or 2:15 PM today? I’ll have everything ready so you are not waiting.';
const ALLIE = 'Allie, I can review the $25,988 offer and work toward the strongest complete price we can provide. I’ll have the Crystal Black Pearl HR-V Sport ready so you won’t be waiting; would 1:00 PM or 2:30 PM tomorrow work?';
// The shape the OLD guard was built for, so its case is asserted still handled.
const BANNED = 'Just checking in on the Sportage you were looking at last week.';

function guard(impl, sms, fullName, opts) {
  const logs = [];
  const sb = {
    String, RegExp,
    rawSms: sms,
    lastScrapedData: fullName === null ? null : { name: fullName },
    console: { log: (...x) => logs.push(x.join(' ')) },
  };
  vm.createContext(sb);
  vm.runInContext((opts && opts.mutate) ? opts.mutate(impl.guard) : impl.guard, sb);
  return { sms: vm.runInContext('rawSms', sb), logs: logs.join(' ') };
}

const guardedImpls = require('./lib/guarded-impls.js');
const impls = guardedImpls(BUILDS, extract);
let pass = 0, fail = 0;
function report(name, results, want) {
  const agree = results.every(r => r === results[0]);
  const ok = agree && results[0] === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; console.log('  FAIL ' + name);
    if (!agree) impls.forEach((i, n) => console.log('        ' + i.name + ' -> ' + results[n]));
    else console.log('        expected ' + JSON.stringify(want) + '\n        got      ' + results[0]);
  }
}
const check = (name, fn, want) =>
  report(name, impls.map(i => { try { return JSON.stringify(fn(i)); } catch (e) { return 'THREW: ' + e.message; } }), want);

console.log('\nv9.7.667 — the opener guard tests the rule now');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);

console.log('\n(1) the two drafts that produced this build:');

check('Aimee\'s draft gets her name, which is what shipped without one',
  i => guard(i, AIMEE, 'Aimee Williams').sms.startsWith('Aimee, the Glacial White Pearl'), true);
check('...and the sentence the model wrote survives intact after the join',
  i => /Glacial White Pearl 2026 Kia Sportage LX is here, and I can have it ready/.test(guard(i, AIMEE, 'Aimee Williams').sms), true);
check('...and the diagnostic says it stepped in',
  i => /prepended the first name/.test(guard(i, AIMEE, 'Aimee Williams').logs), true);

check('Allie\'s draft already has hers and is untouched, character for character',
  i => guard(i, ALLIE, 'Allie Trahan').sms === ALLIE, true);
check('...and the diagnostic says so',
  i => /opener already carries the first name/.test(guard(i, ALLIE, 'Allie Trahan').logs), true);

console.log('\n(2) the case the old guard was built for still works:');
check('a banned template opener without the name still gets it',
  i => guard(i, BANNED, 'Aimee Williams').sms.startsWith('Aimee, just checking in'), true);

console.log('\n(3) it does not fire where it has nothing to add:');
check('a name already in the first sentence but not first',
  i => guard(i, 'Good morning Allie, the HR-V is here.', 'Allie Trahan').sms,
  'Good morning Allie, the HR-V is here.');
check('a name that only appears in a LATER sentence is still missing from the opener',
  i => guard(i, 'The HR-V is here. Allie, want to come see it?', 'Allie Trahan').sms.startsWith('Allie, the HR-V'), true);
check('no scraped name means it cannot act',
  i => guard(i, AIMEE, '').sms, AIMEE);
check('no scraped data at all cannot throw',
  i => guard(i, AIMEE, null).sms, AIMEE);
check('an empty draft is left alone',
  i => guard(i, '', 'Aimee Williams').sms, '');
check('the match is case-insensitive',
  i => guard(i, 'aimee, the Sportage is here.', 'Aimee Williams').sms, 'aimee, the Sportage is here.');

// ── NON-VACUITY ─────────────────────────────────────────────────────────────
console.log('\nnon-vacuity (v9.7.667):');

// Put the nine-phrase condition back and Aimee's opener walks through, which is what shipped.
const OLD_GUARD = c => c.replace(
  'if (!hasName && firstName) {',
  "if (/^(I saw you started|I saw you were|I noticed you|I wanted to|I am reaching|Just checking|Following up|I.d love to|I hope this)/i.test(rawSms.trim()) && !hasName && firstName) {");
check('neuter A actually restored the banned-opener condition', i => OLD_GUARD(i.guard) !== i.guard, true);
check('A: Aimee\'s draft ships with no name — exactly what v9.7.666 produced, twice',
  i => guard(i, AIMEE, 'Aimee Williams', { mutate: OLD_GUARD }).sms, AIMEE);
check('A: ...while the nine named phrases were always caught, which is why this looked fine',
  i => guard(i, BANNED, 'Aimee Williams', { mutate: OLD_GUARD }).sms.startsWith('Aimee, just checking'), true);
check('A (control): the shipped guard catches Aimee\'s',
  i => guard(i, AIMEE, 'Aimee Williams').sms.startsWith('Aimee, '), true);

// The list must be gone from the decision, not merely widened.
check('no opener word-list survives in the shipped guard',
  i => /I saw you started|Just checking|Following up/.test(i.guard), false);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
