#!/usr/bin/env node
'use strict';
// (v1.22) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('per-lead-denominator.test.js');

/**
 * per-lead-denominator.test.js — reporter v1.22. ONE LEAD MUST NOT MOVE A FLEET METRIC.
 *
 * 9/1: all EIGHT DISAGREE-REGEX-ONLY rows that day were ONE lead — 2056662795, Roshni Khan —
 * regenerated eight times between 13:29 and 17:11. One call note, one false "will be" match,
 * counted eight times. That single lead:
 *
 *   • took the day's agreement rate from 97.0% to 94.5%
 *   • produced a "Facebook 39.1% disagreement rate" in the by-source table
 *
 * Neither is comprehension behaving differently. Both are an agent pressing Generate.
 *
 * v1.22 collapses to LEAD + DETECTOR for the headline rate, keeps the per-verdict rate visible and
 * labelled (it is the right denominator for probe cost and telemetry volume), and adds a
 * repeat-generated tile so the size of the effect is on the page rather than inferred.
 *
 * COLLAPSE RULE, asserted here because it is a judgement: a lead+detector pair counts as
 * disagreeing if ANY of its comparable rows disagreed — not the majority, not the last. This
 * table's job is to produce the review list, so it must not hide a disagreement behind seven
 * agreements. The opposite bias is the accepted cost and is asserted too.
 *
 * Drives the SHIPPED aggregator and the SHIPPED renderer.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const FILES = process.argv.slice(2).filter(a => /\.js$/.test(a) && fs.existsSync(a));
if (!FILES.length) { console.error('usage: per-lead-denominator.test.js <reporter.js> [reporter.js...]'); process.exit(2); }

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; console.log('  FAIL ' + name);
    console.log('        expected ' + JSON.stringify(want) + '\n        got      ' + JSON.stringify(got));
  }
}

// Re-implement nothing: lift the collapse out of the shipped file and run it.
function collapser(src) {
  const a = src.indexOf('        const byLead = Object.create(null);');
  if (a < 0) throw new Error('byLead not found — v1.22 aggregation missing');
  const b = src.indexOf('const leadMaxRows', a);
  if (b < 0) throw new Error('lead tallies not found');
  const end = src.indexOf(';', src.indexOf('reduce((m, k) => Math.max(m, byLead[k].rows), 0)', b));

  // The two shipped fragments: the per-row record, and the final collapse.
  const recStart = src.indexOf('            const _lid = (e.meta && e.meta.autoLeadId)');
  const recEnd   = src.indexOf('          }', recStart);
  const record   = src.slice(recStart, recEnd);
  const collapse = src.slice(a, end + 1);

  const sb = { Object, Math, String, JSON };
  vm.createContext(sb);
  vm.runInContext(
    'function run(rows){\n' + collapse.replace(/^\s*const byLead/m, '  var byLead')
      .replace(/^\s*let _leadRowSeq/m, '  var _leadRowSeq')
      .replace('const _leadKeys', 'var _leadKeys')
      .replace('const leadComparable', 'var leadComparable')
      .replace('const leadDisagree', 'var leadDisagree')
      .replace('const leadFabricated', 'var leadFabricated')
      .replace('const leadRepeats', 'var leadRepeats')
      .replace('const leadMaxRows', 'var leadMaxRows')
      .replace(/const _leadKeys[\s\S]*$/, m => m) + '\n return {leadComparable:leadComparable,'
      + 'leadDisagree:leadDisagree,leadFabricated:leadFabricated,leadRepeats:leadRepeats,'
      + 'leadMaxRows:leadMaxRows}; }', sb);
  // Rebuild the loop body around the shipped record fragment.
  vm.runInContext(
    'function tally(rows){ var byLead = Object.create(null); var _leadRowSeq = 0;\n'
    + '  rows.forEach(function(e){ var _known = true;\n' + record + '\n });\n'
    + '  var k = Object.keys(byLead);\n'
    + '  return { leadComparable: k.length,\n'
    + '           leadDisagree: k.filter(function(x){return byLead[x].disagree;}).length,\n'
    + '           leadFabricated: k.filter(function(x){return byLead[x].fabricated;}).length,\n'
    + '           leadRepeats: k.filter(function(x){return byLead[x].rows>1;}).length,\n'
    + '           leadMaxRows: k.reduce(function(m,x){return Math.max(m,byLead[x].rows);},0) }; }', sb);
  return { tally: rows => vm.runInContext('tally', sb)(rows) };
}

const impls = FILES.map(f => {
  const src = fs.readFileSync(f, 'utf8');
  return { name: path.basename(f), src, c: collapser(src) };
});

const row = (lead, delta, det) => ({ meta: { autoLeadId: lead }, delta: delta, detector: det || 'verbal-commit' });

console.log('\nreporter v1.22 — the headline rate counts leads, not generations');
console.log('files under test: ' + impls.map(i => i.name).join(', '));
console.log('');

// ── ROSHNI, EXACTLY AS SHE HAPPENED ─────────────────────────────────────────
console.log('9/1 — Roshni regenerated eight times plus five other leads:');

const NINE_ONE = [
  ...Array(8).fill(0).map(() => row('2056662795', 'DISAGREE-REGEX-ONLY')),
  row('2060562771', 'DISAGREE-COMPREHENSION-ONLY'),
  row('2059845508', 'DISAGREE-COMPREHENSION-ONLY'),
  row('2073409525', 'DISAGREE-COMPREHENSION-ONLY'),
  row('2076122289', 'DISAGREE-COMPREHENSION-ONLY'),
  row('2068121359', 'DISAGREE-COMPREHENSION-ONLY'),
  ...Array(221).fill(0).map((_, n) => row('agree-' + n, 'AGREE-NONE'))
];

for (const i of impls) {
  const t = i.c.tally(NINE_ONE);
  check('  ' + i.name + ' — 13 disagreeing rows collapse to 6 leads',
    [t.leadDisagree, t.leadComparable], [6, 227]);
  check('  ' + i.name + ' — the repeat is surfaced, not hidden',
    [t.leadRepeats, t.leadMaxRows], [1, 8]);
}

// ── THE COLLAPSE RULE, BOTH DIRECTIONS ──────────────────────────────────────
console.log('\nthe collapse rule — a disagreement cannot hide behind agreements:');

for (const i of impls) {
  check('  one disagreement among seven agreements still counts the lead',
    i.c.tally([row('L1','AGREE-NONE'), row('L1','AGREE-NONE'), row('L1','DISAGREE-REGEX-ONLY'),
               row('L1','AGREE-NONE'), row('L1','AGREE-NONE'), row('L1','AGREE-NONE'),
               row('L1','AGREE-NONE'), row('L1','AGREE-NONE')]).leadDisagree, 1);

  check('  ...and that is ONE lead, not eight rows',
    i.c.tally([row('L1','AGREE-NONE'), row('L1','DISAGREE-REGEX-ONLY')]).leadComparable, 1);

  check('  the same lead under DIFFERENT detectors is two units, not one',
    i.c.tally([row('L1','DISAGREE-REGEX-ONLY','verbal-commit'),
               row('L1','AGREE-NONE','day-lock')]).leadComparable, 2);

  check('  ...and only the disagreeing detector counts',
    i.c.tally([row('L1','DISAGREE-REGEX-ONLY','verbal-commit'),
               row('L1','AGREE-NONE','day-lock')]).leadDisagree, 1);

  check('  a fabricated quote is tracked separately from a disagreement',
    (() => { const t = i.c.tally([row('L1','QUOTE-FABRICATED')]);
             return [t.leadFabricated, t.leadDisagree]; })(), [1, 0]);
}

// ── ROWS WE CANNOT ATTRIBUTE ────────────────────────────────────────────────
console.log('\nrows with no lead id still count once each rather than merging:');

for (const i of impls) {
  check('  three unattributed rows are three units, not one',
    i.c.tally([{ meta: {}, delta: 'AGREE-NONE' }, { meta: {}, delta: 'AGREE-NONE' },
               { meta: {}, delta: 'DISAGREE-REGEX-ONLY' }]).leadComparable, 3);
  check('  ...and the disagreeing one is counted',
    i.c.tally([{ meta: {}, delta: 'AGREE-NONE' },
               { meta: {}, delta: 'DISAGREE-REGEX-ONLY' }]).leadDisagree, 1);
  check('  a missing meta object cannot throw',
    i.c.tally([{ delta: 'AGREE-NONE' }]).leadComparable, 1);
}

// ── THE RENDER SIDE ─────────────────────────────────────────────────────────
console.log('\nthe report shows leads as the headline and keeps per-generation visible:');
for (const i of impls) {
  check('  the headline tiles read "of N leads"',
    /leadAgree \+ ' of ' \+ leadComparable \+ ' leads'/.test(i.src), true);
  check('  the per-verdict rate is kept and labelled per generation',
    /tile\('Per generation'[\s\S]{0,120}verdicts disagree/.test(i.src), true);
  check('  a repeat-generated tile names the size of the effect',
    /Repeat-generated/.test(i.src) && /run more than once/.test(i.src), true);
  check('  a pre-v1.22 payload degrades to the old numbers instead of rendering zeroes',
    /const hasLead\s+= cd\.leadComparable !== undefined;/.test(i.src), true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
