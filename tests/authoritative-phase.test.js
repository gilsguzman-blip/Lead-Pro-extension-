#!/usr/bin/env node
'use strict';
// (v9.7.608) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('authoritative-phase.test.js');

/**
 * authoritative-phase.test.js — v9.7.608. COMPREHENSION NOW DRIVES THE DIRECTIVE.
 *
 * All three conversational-fact detectors move from observer to authoritative together. This suite
 * exists to answer the three questions that decide whether that was safe:
 *
 *   1. Does a verified comprehension reading actually REPLACE the regex directive?
 *   2. Does every failure mode still fall back to the regex, so no path ends with less signal?
 *   3. Does ONE kill switch roll back ONE detector, leaving the other two authoritative?
 *
 * It drives the SHIPPED _lpFactDecide against the SHIPPED detector table with the SHIPPED flag
 * values, and mutates the flags in-context to prove independence. No source scanning for behaviour.
 *
 * ── THE CASE THAT DECIDED THE PHASE ───────────────────────────────────────────────────────────
 * 9/1, Roshni Khan, Community Toyota Baytown, lead 2056662795. Her call note:
 *
 *   "said this will be their second vehicle they have a camry that they bought not too long ago.
 *    asked if are interested in the 4runner she said not that particularly said that suvs are too
 *    big. wants too keep payments down"
 *
 * The verbal-commit regex matched on "will be" — inside the description of the car she ALREADY
 * OWNS — and manufactured a commitment. Live log, with the flag still off:
 *
 *   [LP FACT DIAG] verbal-commit | source:regex-fallback | authoritative:OFF (observer only)
 *     | comprehension:none | regex:FIRED "will be their second vehicle they have a camry that they
 *     bought not to" | agreement:DISAGREE
 *
 * The shipped prompt then carried "Customer already made a verbal commitment on the phone. Confirm
 * what was agreed" — to a lead with 0 inbound and 9 outbound. That exact input is the first
 * fixture below, and with the flag on it must suppress.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: authoritative-phase.test.js <popup.js> [popup.js...]'); process.exit(2); }

function slice(src, a, b, what) {
  const i = src.indexOf(a);
  if (i < 0) throw new Error(what + ' start not found');
  const j = src.indexOf(b, i);
  if (j < 0) throw new Error(what + ' end not found');
  return src.slice(i, j + b.length);
}

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const flags = slice(src, 'var LEADPRO_VERBALCOMMIT_COMPREHENSION = true;',
                           'var LEADPRO_OFFFRANCHISE_AUTHORITATIVE = true;', 'flags');
  const ids   = slice(src, 'var LP_FACT_IDS', '};', 'LP_FACT_IDS');
  const dets  = slice(src, 'var LP_FACT_DETECTORS = {', '\n};', 'LP_FACT_DETECTORS');
  const dec   = slice(src, 'function _lpFactDecide(detId, comp, regex, log) {',
                           "\n}", '_lpFactDecide');
  return { name: path.basename(path.dirname(file)), src, code: flags + '\n' + ids + '\n' + dets + '\n' + dec };
}

// A fresh sandbox per case so flag mutation in one cannot leak into another.
function ctx(impl) {
  const logs = [];
  const sb = { String, JSON, Object, window: {}, console: { log: (...a) => logs.push(a.join(' ')) } };
  vm.createContext(sb);
  vm.runInContext(impl.code, sb);
  return {
    logs,
    setAuth: (id, on) => vm.runInContext(
      ({ 'verbal-commit': 'LEADPRO_VERBALCOMMIT_AUTHORITATIVE',
         'day-lock': 'LEADPRO_DAYLOCK_AUTHORITATIVE',
         'off-franchise': 'LEADPRO_OFFFRANCHISE_AUTHORITATIVE' })[id] + ' = ' + (on ? 'true' : 'false') + ';', sb),
    decisions: () => vm.runInContext('window._lpFactDecisions || {}', sb),
    decide: (id, comp, rx) => vm.runInContext('_lpFactDecide', sb)(id, comp, rx,
      (...a) => logs.push(a.join(' ')))
  };
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

const IDS = ['verbal-commit', 'day-lock', 'off-franchise'];
// Comprehension result shapes as _lpRunFactProbe returns them.
const compNone  = (notes) => ({ usable: true, fired: false, kind: null, quote: '', verifiedNote: 0, notesRead: notes || 1 });
const compFired = (kind, quote, note) => ({ usable: true, fired: true, kind: kind, quote: quote, verifiedNote: note || 1, notesRead: 1 });
const compDead  = (why) => ({ usable: false, fired: false, reason: why, notesRead: 0 });

// Roshni's real strings.
const ROSHNI_RX = 'will be their second vehicle they have a camry that they bought not too long ago. asked if are interested i';

console.log('\nv9.7.608 — comprehension drives the directive for all three detectors');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);
console.log('');

// ── 1. THE FLAGS SHIPPED ON ────────────────────────────────────────────────
console.log('all three detectors ship authoritative:');
for (const id of IDS) {
  check('  ' + id, i => ctx(i).decide(id, compNone(), { fired: false, value: '' }).authoritative, true);
}

// ── 2. ROSHNI — THE REGEX FACT IS SUPPRESSED ───────────────────────────────
console.log('\nRoshni Khan, 9/1 — a manufactured commitment is now overruled:');

check('comprehension produces the directive, not the regex',
  i => ctx(i).decide('verbal-commit', compNone(1), { fired: true, value: ROSHNI_RX }).source, 'comprehension');

check('...and the commitment does NOT fire — the CALL NOTE block is suppressed',
  i => ctx(i).decide('verbal-commit', compNone(1), { fired: true, value: ROSHNI_RX }).fired, false);

check('...the delta is still recorded honestly as a disagreement',
  i => ctx(i).decide('verbal-commit', compNone(1), { fired: true, value: ROSHNI_RX }).delta,
  'DISAGREE-REGEX-ONLY');

check('...and the hand-check line names it SUPPRESSED',
  i => { const c = ctx(i); c.decide('verbal-commit', compNone(1), { fired: true, value: ROSHNI_RX });
         const l = c.logs.filter(x => x.indexOf('[LP FACT AUTHORITATIVE]') >= 0).join(' ');
         return /outcome:SUPPRESSED/.test(l) && /DISAGREEMENT — HAND-CHECK/.test(l); }, true);

check('...carrying the regex text it overruled, so the check needs no other source',
  i => { const c = ctx(i); c.decide('verbal-commit', compNone(1), { fired: true, value: ROSHNI_RX });
         return c.logs.join(' ').indexOf('camry') > 0; }, true);

// ── 3. THE OTHER OUTCOMES ARE NAMED DISTINCTLY ─────────────────────────────
console.log('\nevery authoritative outcome is named, so day-one review is a grep:');

check('comprehension finding one the regex missed reads ADDED',
  i => { const c = ctx(i); c.decide('day-lock', compFired('Saturday', 'I can come Saturday', 2), { fired: false, value: '' });
         return /outcome:ADDED/.test(c.logs.join(' ')); }, true);

check('a verified quote replacing the regex match reads QUOTE-REPLACED',
  i => { const c = ctx(i); c.decide('verbal-commit', compFired('firm', 'I will be there Tuesday', 1),
           { fired: true, value: 'will be there' });
         return /outcome:QUOTE-REPLACED/.test(c.logs.join(' ')); }, true);

check('both readers agreeing reads CONFIRMED and is NOT flagged for hand-check',
  i => { const c = ctx(i); c.decide('off-franchise', compNone(3), { fired: false, value: '' });
         const l = c.logs.join(' ');
         return /outcome:CONFIRMED/.test(l) && l.indexOf('HAND-CHECK') < 0; }, true);

// ── 4. EVERY FAILURE MODE FALLS BACK ───────────────────────────────────────
// The rail that makes this recoverable: no path may end with less signal than the regex alone.
console.log('\nno failure mode ends with less signal than the regex alone:');

for (const [label, comp] of [
  ['an unusable probe',            compDead('proxy error')],
  ['no customer text to read',     compDead('the customer has never written anything on this lead')],
  ['a probe that never answered',  compDead('timeout')],
  ['a missing comprehension result', undefined],
  ['a null result',                null]
]) {
  check('  ' + label + ' → regex-fallback',
    i => ctx(i).decide('verbal-commit', comp, { fired: true, value: ROSHNI_RX }).source, 'regex-fallback');
  check('  ...and the regex verdict is what ships',
    i => ctx(i).decide('verbal-commit', comp, { fired: true, value: ROSHNI_RX }).fired, true);
}

check('a fallback writes NO authoritative hand-check line — nothing was overridden',
  i => { const c = ctx(i); c.decide('verbal-commit', compDead('timeout'), { fired: true, value: ROSHNI_RX });
         return c.logs.join(' ').indexOf('[LP FACT AUTHORITATIVE]') < 0; }, true);

// ── 5. KILL-SWITCH INDEPENDENCE — THE ROLLBACK STORY ───────────────────────
// Shipping three together is only safe if one can be pulled without the others.
console.log('\neach kill switch rolls back ONE detector and leaves the other two authoritative:');

for (const off of IDS) {
  check('  ' + off + ' OFF → it falls back',
    i => { const c = ctx(i); c.setAuth(off, false);
           return c.decide(off, compNone(1), { fired: true, value: 'x' }).source; }, 'regex-fallback');
  check('  ...while the other two still ship comprehension',
    i => { const c = ctx(i); c.setAuth(off, false);
           return IDS.filter(x => x !== off)
                     .map(x => c.decide(x, compNone(1), { fired: true, value: 'x' }).source); },
    ['comprehension', 'comprehension']);
}

check('all three OFF returns the build to pre-v9.7.608 behaviour exactly',
  i => { const c = ctx(i); IDS.forEach(x => c.setAuth(x, false));
         return IDS.map(x => c.decide(x, compNone(1), { fired: true, value: 'x' }).source); },
  ['regex-fallback', 'regex-fallback', 'regex-fallback']);

// ── 6. THE DECISION IS RECORDED FOR TELEMETRY EITHER WAY ───────────────────
console.log('\nthe decision still reaches the telemetry flush, authoritative or not:');

check('the decision is recorded into window._lpFactDecisions for the flush to read',
  i => { const c = ctx(i); c.decide('day-lock', compNone(1), { fired: true, value: 'x' });
         const rec = c.decisions()['day-lock'] || {};
         return [rec.source, rec.authoritative, rec.regexFired]; },
  ['comprehension', true, true]);

check('...and a rolled-back detector records regex-fallback, so the report shows the rollback',
  i => { const c = ctx(i); c.setAuth('day-lock', false);
         c.decide('day-lock', compNone(1), { fired: true, value: 'x' });
         const rec = c.decisions()['day-lock'] || {};
         return [rec.source, rec.authoritative]; },
  ['regex-fallback', false]);

check('the returned decision carries detector, source and delta for the flush',
  i => { const d = ctx(i).decide('off-franchise', compNone(2), { fired: false, value: '' });
         return [d.detector, d.source, d.delta]; },
  ['off-franchise', 'comprehension', 'AGREE-NONE']);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
