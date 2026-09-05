#!/usr/bin/env node
'use strict';
// (v9.7.597) Registered BEFORE anything can throw. A suite that dies during module
// evaluation prints nothing, and nothing reads exactly like 'asserted nothing wrong'.
// See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('spouse-attribution.test.js');

/**
 * spouse-attribution.test.js — v9.7.581. A LEAD SOURCE IS NOT A SPOUSE.
 *
 * PETER GORDON (Audi Lafayette, lead 2068934775, 8/25). Lead source:
 *   "Audi Partner Lead - Audi Partner Lead (Internet)"
 * The concern scanner tested a BARE \bpartner\b against text that included that source string,
 * matched the word PARTNER inside a CRM FIELD, and pushed into the prompt:
 *   "SPOUSE/PARTNER INVOLVED: Customer mentioned needing to involve their spouse or partner."
 * Peter has no spouse and never mentioned one anywhere in 43 notes.
 *
 * ── WHY THIS ONE COMPOUNDS, AND THAT IS WHAT MAKES IT WORSE THAN THE OTHERS ───────────────
 * Two agents then wrote the invented fact TO HIM, verbatim:
 *   08/18  "Since you mentioned involving your spouse, I'm happy to answer any questions you
 *           both have..."
 *   08/20  "Taking time to decide between SQ5 configurations makes sense, especially with your
 *           spouse involved."
 * Once those went out they became TRANSCRIPT — so every later generation re-matched on LP's own
 * words and the claim reinforced itself. A manufactured fact that manufactures its own evidence.
 * Jeri's Yahoo header and Fidel's past-tense Saturday were single-shot; this one ratchets.
 *
 * ── THE TWO FAULTS ────────────────────────────────────────────────────────────────────────
 *  1. LEAD-SOURCE METADATA WAS BEING SCANNED AS SPEECH. It is a CRM field, not something anyone
 *     said. Stripped before any concern scan.
 *  2. A BARE NOUN IS NOT A RELATIONSHIP CLAIM. A real mention is POSSESSED ("my wife") or is an
 *     act of consulting someone ("run it by my husband"). The bare-noun alternative is gone.
 *
 * Sliced out of the SHIPPED files. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: spouse-attribution.test.js <popup.js> [popup.js...]'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const re = src.match(/var _spouseRe = (\/[\s\S]*?\/i);/);
  const nz = src.match(/var _lpSrcNoise = (\/[\s\S]*?\/gi);/);
  if (!re) throw new Error('_spouseRe not found in ' + file);
  if (!nz) throw new Error('_lpSrcNoise not found in ' + file);
  const sb = {}; vm.createContext(sb);
  return {
    name: path.basename(path.dirname(file)), src,
    code: src.replace(/^\s*(\/\/|\*|\/\*).*$/gm, ''),
    // The SHIPPED expressions, evaluated — not copies.
    fires: t => vm.runInContext('(' + re[1] + ')', sb)
                  .test(String(t).replace(vm.runInContext('(' + nz[1] + ')', sb), ' '))
  };
}
// (v9.7.597) Extraction failure is a REPORTED failure, not a fatal one — see
// tests/lib/guarded-impls.js. Pointed at a build that predates the code under test,
// this suite now runs every assertion and fails loudly instead of printing nothing.
const guardedImpls = require('./lib/guarded-impls.js');
const impls = guardedImpls(BUILDS, extract);
let pass = 0, fail = 0;
function report(name, results, want) {
  const agree = results.every(r => r === results[0]);
  const ok = agree && results[0] === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name);
    if (!agree) impls.forEach((i, n) => console.log('        ' + i.name + ' -> ' + results[n]));
    else console.log('        expected ' + JSON.stringify(want) + '\n        got      ' + results[0]); }
}
const check = (name, fn, want) =>
  report(name, impls.map(i => { try { return JSON.stringify(fn(i)); } catch (e) { return 'THREW: ' + e.message; } }), want);

console.log('\nv9.7.581 — a lead source is not a spouse');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

console.log("Peter Gordon — the real strings off his lead:");

check('THE INCIDENT: his lead source no longer invents a spouse',
  i => i.fires('Audi Partner Lead - Audi Partner Lead (Internet)'), false);

check('...nor does the bare source field in any phrasing',
  i => ['Source: Audi Partner Lead', 'Audi Partner Lead', 'Lead Source: Partner Lead'].map(t => i.fires(t)),
  [false, false, false]);

check('THE TEST IS NOT VACUOUS: the OLD bare-noun rule DID match his source',
  i => /\b(wife|husband|spouse|partner)\b/i.test('Audi Partner Lead - Audi Partner Lead (Internet)'), true);

check('and the self-reinforcing loop is broken — OUR OWN invented sentence no longer re-fires it',
  i => {
    // Once "your spouse" went out it became transcript. If the detector still matched a bare noun
    // it would keep re-confirming its own fabrication on every subsequent generation.
    const ours = 'Taking time to decide between SQ5 configurations makes sense, especially with '
      + 'your spouse involved.';
    return i.fires(ours);
  }, false);

console.log('\ngenuine mentions must still fire — that is the half that matters:');

[['I need to talk to my wife first', true],
 ['let me run it by my husband', true],
 ['my partner wants to see it too', true],
 ['I want to bring her in on Saturday', true],
 ['my fiance is coming with me', true],
 ['we need to discuss it with my spouse', true]].forEach(([t, want]) => {
  check('fires: "' + t + '"', i => i.fires(t), want);
});

console.log('\nand these must stay silent:');

[['I want to talk to the dealership', false],
 ['partner', false],
 ['our partner program', false],
 ['I will talk to my bank', false]].forEach(([t, want]) => {
  check('silent: "' + t + '"', i => i.fires(t), want);
});

console.log('\nthe fix is visible when it fires:');

check('the matched string and its context are logged, so a bad match is auditable',
  i => /\[LP SPOUSE DIAG\] SPOUSE\/PARTNER INVOLVED fired on: /.test(i.code), true);

check('the bare-noun alternative is GONE from the shipped test',
  i => /\\b\(wife\|husband\|spouse\|partner\)\\b\|run it by/.test(i.code), false);

// (v9.7.638) Repointed: the scan text is now built from _lpConcernLines, which is concernScanLines
// with our own outbound sends removed (the `over.*budget` incident — our word "budget" completed a
// match that started in the customer's "over the phone"). The property this asserts is unchanged
// and is the one that matters: _lpSrcNoise is stripped as the scan text is BUILT, so no consumer
// can ever see the lead-source string, rather than each consumer having to remember to strip it.
check('lead-source noise is stripped BEFORE the scan text is built, not after',
  i => /_lpConcernLines\.join\(' '\)\.replace\(_lpSrcNoise, ' '\)/.test(i.code), true);
check('...and the scan text excludes messages we composed and sent',
  i => /var _lpConcernLines = concernScanLines\.filter\(function \(line\) \{ return !_lpIsOurOwnSend\(line\); \}\);/.test(i.code), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
