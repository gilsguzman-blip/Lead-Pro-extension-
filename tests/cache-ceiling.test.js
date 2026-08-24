#!/usr/bin/env node
'use strict';
/**
 * cache-ceiling.test.js — reporter v1.20. A HEALTHY CACHE WAS BEING GRADED AS A FAILING ONE.
 *
 * ── THE TILE THAT COULD NEVER LIGHT UP ────────────────────────────────────────────────────
 * The 8/23 report read: Avg Hit Rate 9.8%, Hot ≥80% = 0, Cold 0% = 46 of 75. Read plainly that
 * says the prompt cache is dead. It is not, and it never was.
 *
 * 'Hot ≥80%' counted requests whose cached tokens were ≥80% of the WHOLE prompt. About 75% of an
 * LP prompt is per-lead user content that is not cacheable by construction, so the ceiling is
 * ~25% — the tile could not have lit up on any day, however well caching worked. A metric that
 * cannot move is worse than no metric: it invites work on a problem that does not exist. This is
 * the same shape as the NO-CUSTOMER-TEXT bug fixed the same day — a healthy system reported
 * against a denominator that makes it look broken.
 *
 * ── WHAT THE PROXY WAS ALREADY SAYING, AND THE REPORT WAS THROWING AWAY ───────────────────
 * The proxy has emitted the honest numbers since v7.45. Its own header says they exist to
 * "distinguish 'the per-lead prompt just dominates' (expected, unfixable) from 'the prefix is not
 * being cached'". A real line, verbatim from the 8/23 worker log:
 *
 *   CACHE primary cached=3993/15370 (26.0%) written=0 | sysChars=20051 userChars=46679
 *   sysTokEst=4618 ceiling=30.0% cachedOfSys=86% key=lp_773499b2
 *
 * MEASURED across every worker log captured on 8/23, primary tier, 258 draft requests:
 *   ceiling            24.5%   the most cached/total can ever be
 *   cachedOfSys (warm)   84%   of the CACHEABLE prefix, actually served from cache
 *   warm / cold      67% / 33%
 * The prefix was being cached correctly. One stable cache key across every log; zero
 * "breakpoint NOT applied" warnings.
 *
 * ── WHAT THIS SUITE PINS ──────────────────────────────────────────────────────────────────
 * The parser reads ceiling and cachedOfSys off the real line shape; both are OPTIONAL so an older
 * line without the split still parses rather than throwing; the unreachable tile is gone; and the
 * headline is graded against the ceiling rather than against 100%.
 *
 * Driven against the SHIPPED reporter with real log text, not a reconstruction.
 */
const fs = require('fs');
const vm = require('vm');

const FILE = process.argv[2];
if (!FILE) { console.error('usage: cache-ceiling.test.js <leadpro-reporter.js>'); process.exit(2); }
const src = fs.readFileSync(FILE, 'utf8');
// Comment lines removed for "does this still exist" scans. The comment explaining why the
// 'Hot ≥80%' tile was deleted necessarily NAMES that tile, so scanning raw source finds the
// explanation and reports the tile as still present. Scan CODE for existence; scan PROSE only
// when the assertion is about the prose.
const code = src.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');

let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = JSON.stringify(fn()); } catch (e) { got = 'THREW: ' + e.message; }
  if (got === JSON.stringify(want)) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + JSON.stringify(want) + '\n        got      ' + got); }
}

// The shipped regex, evaluated — not a copy of it.
const RE = (() => {
  const m = src.match(/const RE_CACHE\s*=\s*(\/[\s\S]*?\/);/);
  if (!m) throw new Error('RE_CACHE not found in ' + FILE);
  const sb = {}; vm.createContext(sb);
  return vm.runInContext('(' + m[1] + ')', sb);
})();

// Verbatim from the 8/23 worker log.
const REAL = '[bfb68214-7391-4dd7-8caf-6d1941c5220d] CACHE primary cached=3993/15370 (26.0%) '
  + 'written=0 | sysChars=20051 userChars=46679 sysTokEst=4618 ceiling=30.0% cachedOfSys=86% key=lp_773499b2';
const COLD = '[x] CACHE primary cached=0/15370 (0.0%) written=0 | sysChars=20051 userChars=46679 '
  + 'sysTokEst=4618 ceiling=30.0% cachedOfSys=0% key=lp_773499b2';
// A pre-v7.45 line: no split fields at all. Must still parse.
const OLD  = '[y] CACHE primary cached=1200/15370 (7.8%) written=0';
// The fallback tier must not be picked up — it has cacheBreakpoints:false and cannot cache.
const FB   = '[z] CACHE fallback cached=0/15369 (0.0%) written=0 | sysChars=20051 userChars=46679 '
  + 'sysTokEst=4618 ceiling=30.0% cachedOfSys=0%';

console.log('\nreporter v1.20 — grade the cache against its ceiling, not against 100%');
console.log('reporter under test: ' + FILE + '\n');

console.log('the parser reads what the proxy has been saying all along:');

check('a real warm line yields cached, total, ceiling and cachedOfSys',
  () => { const m = REAL.match(RE); return { cached: +m[1], total: +m[2], ceiling: +m[3], ofSys: +m[4] }; },
  { cached: 3993, total: 15370, ceiling: 30, ofSys: 86 });

check('a cold line parses too, and is distinguishable from a warm one',
  () => { const m = COLD.match(RE); return { cached: +m[1], ofSys: +m[4] }; }, { cached: 0, ofSys: 0 });

check('a PRE-v7.45 line with no split still parses — the new groups are optional',
  () => { const m = OLD.match(RE); return { cached: +m[1], total: +m[2], ceiling: m[3], ofSys: m[4] }; },
  { cached: 1200, total: 15370, ceiling: undefined, ofSys: undefined });

check('the FALLBACK tier is not counted — it cannot cache, and averaging it in is the same denominator error',
  () => RE.test(FB), false);

console.log('\nthe unreachable tile is gone:');

check('"Hot ≥80%" no longer appears — the ceiling is ~25%, so it could never fire',
  () => /Hot ≥80%/.test(code), false);

check('...and nothing else thresholds cache at 80 either',
  () => /cacheVals\.filter\(v => v >= 80\)/.test(code), false);

check('the removal is explained in place, so it is not "restored" as a missing feature',
  () => /could never light up on any day|cannot move is worse than no metric/.test(src), true);

check('no reference to the removed hotCount survives — THIS SUITE MISSED THAT ONCE',
  () => {
    // Removing hotCount's definition left one use alive in the plain-text summary. The reporter
    // threw ReferenceError and the whole report died — while this suite sat at 17/17 green,
    // because every assertion here scans SOURCE TEXT. commit-persistence caught it, because it
    // RUNS buildReport. Same lesson as the v7.64 proxy crash. Execution coverage for this
    // section lives there deliberately; what belongs here is a direct pin on the orphan.
    return (code.match(/hotCount/g) || []).length;
  }, 0);

check('...and the text summary reports the same honest figures as the tiles',
  () => /Of achievable: \$\{ofCeiling/.test(src) && /Raw \(cached\/total\)/.test(src), true);

console.log('\nthe headline is graded against the ceiling:');

check('"Of achievable" divides the hit rate BY the ceiling',
  () => /\(\+avgCache \/ \+avgCeiling\) \* 100/.test(src), true);

check('the warm-prefix figure excludes cold requests — mixing them answers a different question',
  () => /d\.cacheOfSys !== undefined && d\.cacheWarm/.test(src), true);

check('the ceiling itself is shown, so a reader can see why the raw rate is low',
  () => /stat\('Ceiling'/.test(src), true);

check('cold starts are reported with a percentage, not a bare count',
  () => /stat\('Cold starts', coldCount \+ ' \(' \+ coldPct \+ '%\)'/.test(src), true);

check('the section says which tier it describes',
  () => /section\('Prompt Cache \(primary tier\)'/.test(src), true);

check('a caption explains ceiling vs prefix-cached, so the numbers are not re-misread',
  () => /Ceiling = system tokens as a share of the whole prompt/.test(src), true);

console.log('\nit degrades rather than throwing when the fields are absent:');

check('every new value has an N/A path — a day of old log lines must not crash the report',
  () => ({
    ofSys:   /avgOfSys \? avgOfSys \+ '%' : 'N\/A'/.test(src),
    ceiling: /avgCeiling \? avgCeiling \+ '%' : 'N\/A'/.test(src),
    achiev:  /ofCeiling \? ofCeiling \+ '%' : 'N\/A'/.test(src)
  }), { ofSys: true, ceiling: true, achiev: true });

check('"of achievable" guards against a zero ceiling rather than dividing by it',
  () => /\+avgCeiling > 0 && avgCache !== 'N\/A'/.test(src), true);

// ── The arithmetic the tiles will actually produce, on the real 8/23 numbers ──
console.log('\nthe numbers it would have shown on 8/23:');

check('9.8% of the total prompt is 40% of what was achievable — the same cache, honestly graded',
  () => {
    const avgCache = 9.8, avgCeiling = 24.5;
    return +((avgCache / avgCeiling) * 100).toFixed(0);
  }, 40);

check('and the measured warm prefix rate was 84%, which is the number that says the prefix works',
  () => { const m = REAL.match(RE); return +m[4] >= 80; }, true);

// ── (v1.21) THE DETECTOR TABLE WAS UNREADABLE, AND NOTHING SAID SO ──────────────────────────
// 8/24 read day-lock 1 · off-franchise 2 · verbal-commit 374, against 8/23's 36 · 29 · 32. The
// chain was traced end to end — extension row, sender payload, proxy clamp, reporter clamp all
// preserve `detector` — so there is no defect. The likely cause is FLEET VERSION SKEW: a build
// before v9.7.566 runs the old single-row observer and posts ONE verbal-commit row per
// generation, while v9.7.566+ posts THREE. The report could not distinguish that from a
// regression, because it never showed extensionVersion — which the proxy has stored since v7.55.
console.log('\nthe detector table can now be read honestly:');

check('rows filed under a detector by DEFAULT are counted separately from rows it produced',
  () => /if \(!_known\) _b\.defaulted\+\+;/.test(code), true);

check('the default itself is kept — a pre-v9.7.566 row really is verbal-commit by construction',
  () => /const _det = _known \? e\.detector : 'verbal-commit';/.test(code), true);

check('the Defaulted column is rendered, and amber when non-zero',
  () => /'Defaulted'/.test(src) && /b\.defaulted \? '#fbbf24' : '#4b5563'/.test(src), true);

check('extensionVersion is collected off the row the proxy already stores',
  () => /String\(e\.extensionVersion \|\| ''\)/.test(code), true);

check('a row with no version is labelled, not dropped',
  () => /\|\| '\(not recorded\)'/.test(code), true);

check('byVersion is threaded through to the renderer — not collected and discarded',
  () => /byNoteType, byDetector, byVersion, disagreements/.test(code), true);

check('the version table explains WHY a mixed fleet skews the detector table',
  () => /Builds before v9\.7\.566 post ONE/.test(src), true);

check('a defaulted row is tallied under its own label in the version table, not silently as verbal-commit',
  () => /_known \? e\.detector : '\(defaulted\)'/.test(code), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
