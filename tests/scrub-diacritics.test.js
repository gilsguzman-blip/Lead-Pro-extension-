#!/usr/bin/env node
'use strict';
// (v9.7.610) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('scrub-diacritics.test.js');

/**
 * scrub-diacritics.test.js — v9.7.610. AN ACCENT DEFEATED THE NAME SCRUB.
 *
 * LIVE, 9/2. A Community Toyota Baytown draft was run through the Translate button, and the
 * captured feedback pair reads:
 *
 *   "Bárbaro, sé que estabas viendo la Toyota Highlander 2019, pero esa en específico ya no
 *    está disponible..."
 *
 * The customer's first name, unscrubbed, in an exported file. The EMAIL half of that same row
 * scrubbed correctly to "[NAME]" — which is what makes the mechanism certain rather than a guess:
 * one spelling matched the CRM's and one did not.
 *
 * _lpScrubPII matched each name token literally and case-insensitively against
 * lastScrapedData.name. "á" and "a" are different characters, so \bBarbaro\b never matched
 * "Bárbaro". It fails in BOTH directions, and it never needed a translation to fire — any lead
 * whose CRM spelling differs from the written spelling by a diacritic has always leaked.
 * Translation only makes it systematic, because a Spanish translator restores the accent the CRM
 * dropped.
 *
 * This is the v9.7.489 posture — contact data never leaves the CRM — failing on a character
 * comparison. Driven against the SHIPPED scrubber. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: scrub-diacritics.test.js <popup.js> [popup.js...]'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('function _lpScrubPII(text) {');
  if (a < 0) throw new Error('_lpScrubPII not found');
  const b = src.indexOf('\n}', src.indexOf('} catch(e) {}', a));
  if (b < 0) throw new Error('_lpScrubPII end not found');
  return { name: path.basename(path.dirname(file)), src, code: src.slice(a, b + 2) };
}

function scrub(impl, text, lead) {
  const sb = { String, RegExp, lastScrapedData: lead || {} };
  vm.createContext(sb);
  vm.runInContext(impl.code, sb);
  return vm.runInContext('_lpScrubPII', sb)(text);
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

console.log('\nv9.7.610 — a diacritic must not carry a customer name out of the CRM');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);
console.log('');

// ── THE REAL 9/2 ROW ────────────────────────────────────────────────────────
console.log('the 9/2 Toyota Baytown row, exactly as it was captured:');

const BARBARO = { name: 'Barbaro Ruiz', email: '', phone: '' };

check('the accented first name is scrubbed',
  i => scrub(i, 'Bárbaro, sé que estabas viendo la Toyota Highlander 2019', BARBARO),
  '[NAME], sé que estabas viendo la Toyota Highlander 2019');

check('...and the rest of the Spanish text is untouched',
  i => scrub(i, 'Bárbaro, gracias', BARBARO).indexOf('gracias') > 0, true);

check('the unaccented spelling still scrubs — the old path must not regress',
  i => scrub(i, 'Barbaro, I know you were looking', BARBARO), '[NAME], I know you were looking');

check('the reverse direction too — accented CRM name, plain message text',
  i => scrub(i, 'Barbaro, I know you were looking', { name: 'Bárbaro Ruiz' }),
  '[NAME], I know you were looking');

check('both tokens of a two-part name are caught',
  i => scrub(i, 'Hola Bárbaro Ruiz, gracias', BARBARO), 'Hola [NAME] [NAME], gracias');

// ── OTHER SCRIPTS ───────────────────────────────────────────────────────────
console.log('\nother diacritics behave the same way:');
for (const [crm, written] of [
  ['Jose',    'José'],
  ['Renee',   'Renée'],
  ['Muller',  'Müller'],
  ['Francois','François'],
  ['Sofia',   'Sofía']
]) {
  check('  CRM "' + crm + '" scrubs "' + written + '"',
    i => scrub(i, written + ' asked about the CR-V', { name: crm }),
    '[NAME] asked about the CR-V');
}

// ── THE REST OF THE SCRUB IS UNCHANGED ──────────────────────────────────────
// Over-scrubbing is the risk of a looser match: the folded compare must not start eating words.
console.log('\nnothing else changed, and the match did not get looser:');

check('a different name is left alone',
  i => scrub(i, 'Maria asked about the CR-V', BARBARO), 'Maria asked about the CR-V');

check('a substring is not a match — word boundaries still hold',
  i => scrub(i, 'Barbarossa asked about the CR-V', BARBARO), 'Barbarossa asked about the CR-V');

check('one-character name tokens are still skipped',
  i => scrub(i, 'A B testing the CR-V', { name: 'A B' }), 'A B testing the CR-V');

check('phones are still scrubbed',
  i => scrub(i, 'call 281-837-3381 today', BARBARO), 'call [PHONE] today');

check('emails are still scrubbed',
  i => scrub(i, 'write to a@b.com', BARBARO), 'write to [EMAIL]');

check('empty input is still empty, not "[NAME]"',
  i => scrub(i, '', BARBARO), '');

check('a lead with no name cannot throw',
  i => scrub(i, 'Bárbaro asked', {}), 'Bárbaro asked');

check('a name that is only whitespace is skipped',
  i => scrub(i, 'Bárbaro asked', { name: '   ' }), 'Bárbaro asked');

// ── INDEX SAFETY ────────────────────────────────────────────────────────────
// Folding must be 1:1 per character or a match found in the folded copy splices the wrong span.
console.log('\nfolding preserves offsets, so the splice lands on the right characters:');

check('a name appearing three times is replaced three times, in place',
  i => scrub(i, 'Bárbaro and Barbaro and Bárbaro', BARBARO), '[NAME] and [NAME] and [NAME]');

check('text after a multi-byte character is not shifted',
  i => scrub(i, 'Está aquí — Bárbaro, gracias señor', BARBARO),
  'Está aquí — [NAME], gracias señor');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
