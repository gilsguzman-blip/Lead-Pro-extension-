#!/usr/bin/env node
'use strict';
/**
 * transcript-cutoff.test.js — v9.7.589. A SAME-DAY LEAD LOST ITS ENTIRE TRANSCRIPT.
 *
 * ── THE BUG ───────────────────────────────────────────────────────────────────────────────
 * Three filters compared a DATE-TRUNCATED line stamp against a TIME-PRECISE cutoff:
 *
 *     var dateMatch = line.match(/^\[(\d{1,2}\/\d{1,2}\/\d{2,4})/);   // date only
 *     var lineMs = new Date(dateMatch[1]).getTime();                  // -> MIDNIGHT
 *     if (lineMs > 0 && lineMs < transcriptCutoffMs) return false;    // vs a precise cutoff
 *
 * The line reads "[08/27/2026 12:36 PM]" — the time is right there — but the capture group stops
 * at the date. transcriptCutoffMs for Keisha Burgess (lead 2074168344) came from her "Lead
 * received" note at 08/27 11:12 AM minus a 1-hour buffer = 10:12 AM. Midnight < 10:12 AM, so every
 * note from that day was dropped. All 32. The delivered prompt carried:
 *
 *     CONVERSATION TRANSCRIPT (newest first — read the full thread before responding):
 *     ---
 *
 *     ---
 *
 * ── WHY IT SURVIVED ───────────────────────────────────────────────────────────────────────
 * The rule it produces is "every note dated the SAME CALENDAR DAY as the lead-received timestamp
 * is discarded, unless the lead arrived before 1:00 AM". On a multi-day lead that costs one day and
 * hides. On a SAME-DAY lead it costs the whole conversation. Andrea Pardon's transcript was full
 * (notes 8/22–8/26, receipt 8/21 9:05 PM) while Keisha's was empty — same code, same day, opposite
 * outcomes. Her own "Lead received" line was dropped too, and nobody noticed that either.
 *
 * ── THE FIX, IN TWO PARTS ─────────────────────────────────────────────────────────────────
 *  (1) Capture the time already present in the line, so both sides compare at full precision.
 *  (2) When a line carries NO time, compare against the START OF THE CUTOFF'S DAY — otherwise a
 *      date-only line is still killed by a same-day cutoff, which is the identical bug in a
 *      smaller costume and is exactly how this was missed the first time.
 *
 * Written once as _lpLineIsBeforeCutoff and called from all three sites, which were byte-identical
 * copies. This suite EXECUTES the shipped helper. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: transcript-cutoff.test.js <popup.js> [popup.js...]'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('    var _LP_LINE_STAMP_RE =');
  const b = src.indexOf('    var recentHistory = transcript.filter(');
  const sb = { String, Date, RegExp, Number };
  vm.createContext(sb);
  if (a >= 0 && b > a) {
    vm.runInContext(src.slice(a, b), sb);
  } else {
    // PRE-FIX BUILD. Without this branch the suite THROWS on load and prints nothing, which reads
    // exactly like "the suite does not catch the bug" — the vacuous check of a vacuous check this
    // repo has now hit twice. The old comparison is reproduced from the OLD FILE'S OWN regex,
    // lifted verbatim rather than retyped, so the non-vacuity run exercises shipped bytes.
    const m = src.match(/var dateMatch = line\.match\((\/\^\\\[[^\n]*?)\);/);
    if (!m) throw new Error('neither the helper nor the old date-only filter found in ' + file);
    vm.runInContext(
      'var _oldRe = ' + m[1] + ';\n' +
      'function _lpLineIsBeforeCutoff(line, cutoffMs){\n' +
      '  if (!cutoffMs || cutoffMs <= 0) return false;\n' +
      '  var d = String(line||"").match(_oldRe); if (!d) return false;\n' +
      '  var lineMs = new Date(d[1]).getTime();\n' +
      '  return lineMs > 0 && lineMs < cutoffMs;\n' +
      '}', sb);
  }
  // Comment lines removed before any "is this gone" scan. The fix's own post-mortem QUOTES the
  // broken line and the misleading log string it replaced — so scanning raw source finds the
  // explanation and reports the bug as still present. That happened on the first run of this very
  // suite, for the fourth time in this repo. Scan CODE for existence; scan PROSE only when the
  // assertion is about the prose.
  const code = src.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
  return {
    name: path.basename(path.dirname(file)),
    src, code,
    drops: (line, cutoff) => vm.runInContext('_lpLineIsBeforeCutoff', sb)(line, cutoff)
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
  else {
    fail++; console.log('  FAIL ' + name);
    if (!agree) impls.forEach((i, n) => console.log('        ' + i.name + ' -> ' + results[n]));
    else console.log('        expected ' + JSON.stringify(want) + '\n        got      ' + results[0]);
  }
}
const check = (name, fn, want) =>
  report(name, impls.map(i => { try { return JSON.stringify(fn(i)); } catch (e) { return 'THREW: ' + e.message; } }), want);

const ms = s => new Date(s).getTime();

// Keisha: lead received 08/27 11:12 AM, 1-hour buffer -> cutoff 10:12 AM. Every note is same-day.
const KEISHA_CUTOFF = ms('08/27/2026 11:12 AM') - 3600e3;
const KEISHA_LINES = [
  '[08/27/2026 1:03 PM] [AGENT] Outbound Text Message',
  '[08/27/2026 12:36 PM] [CUSTOMER] Inbound Text Message',
  '[08/27/2026 12:03 PM] [AGENT] Outbound Text Message',
  '[08/27/2026 11:23 AM] [AGENT] Outbound Text Message',
  '[08/27/2026 11:22 AM] [NOTE] General Note',
  '[08/27/2026 11:12 AM] [NOTE] Lead received'
];
// Andrea: lead received 08/21 9:05 PM, notes on LATER days. Must stay exactly as it is today.
const ANDREA_CUTOFF = ms('08/21/2026 9:05 PM') - 3600e3;
const ANDREA_LINES = [
  '[08/26/2026 12:48 PM] [AGENT] Outbound phone call (Machine)',
  '[08/25/2026 8:57 AM] [AGENT] Outbound Text Message',
  '[08/22/2026 8:26 AM] [AGENT] Outbound Text Message'
];

const kept = (i, lines, cutoff) => lines.filter(l => !i.drops(l, cutoff)).length;

console.log('\nv9.7.589 — the cutoff compares like for like');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── THE INCIDENT ──────────────────────────────────────────────────────────────
console.log("Keisha's same-day lead — every line was being dropped:");

check('all six same-day lines survive the cutoff',
  i => kept(i, KEISHA_LINES, KEISHA_CUTOFF), 6);

check('...including the 11:23 AM note, which is only 11 minutes past the receipt',
  i => i.drops('[08/27/2026 11:23 AM] [AGENT] Outbound Text Message', KEISHA_CUTOFF), false);

check('...and the "Lead received" line itself, which used to delete itself',
  i => i.drops('[08/27/2026 11:12 AM] [NOTE] Lead received', KEISHA_CUTOFF), false);

// ── THE EXCLUSION IT EXISTS FOR MUST STILL WORK ───────────────────────────────
console.log('\nthe prior-cycle exclusion still fires — this is not "keep everything":');

check('a note from BEFORE the buffered cutoff, same day, is still dropped',
  i => i.drops('[08/27/2026 9:15 AM] [AGENT] prior cycle outreach', KEISHA_CUTOFF), true);

check('a note from a previous lead cycle months earlier is still dropped',
  i => i.drops('[03/04/2026 2:00 PM] [CUSTOMER] not interested', KEISHA_CUTOFF), true);

check('the boundary is the cutoff instant, not the day — 10:11 out, 10:13 in',
  i => [i.drops('[08/27/2026 10:11 AM] x', KEISHA_CUTOFF),
        i.drops('[08/27/2026 10:13 AM] x', KEISHA_CUTOFF)], [true, false]);

// ── ANDREA MUST BE BYTE-IDENTICAL ─────────────────────────────────────────────
console.log("\nAndrea's multi-day lead is unchanged — the path that worked is untouched:");

check('all three later-day lines still survive',
  i => kept(i, ANDREA_LINES, ANDREA_CUTOFF), 3);

check('...and her own same-day "Lead received" now survives too, where it used to drop',
  i => i.drops('[08/21/2026 9:05 PM] [NOTE] Lead received', ANDREA_CUTOFF), false);

// ── PART TWO OF THE FIX: DATE-ONLY LINES ──────────────────────────────────────
console.log('\na line with NO time compares day-to-day, so a same-day cutoff cannot delete it:');

check('a date-only line on the cutoff day survives',
  i => i.drops('[08/27/2026] [NOTE] undated entry', KEISHA_CUTOFF), false);

check('...but a date-only line from the day BEFORE is still dropped',
  i => i.drops('[08/26/2026] [NOTE] previous day', KEISHA_CUTOFF), true);

// ── ROBUSTNESS ────────────────────────────────────────────────────────────────
console.log('\nit degrades safely rather than dropping things it cannot read:');

check('a line with no bracketed stamp is never dropped on time grounds',
  i => i.drops('  This is when the current inquiry was submitted.', KEISHA_CUTOFF), false);

check('an unparseable stamp is not treated as ancient',
  i => i.drops('[99/99/9999 25:61 PM] garbage', KEISHA_CUTOFF), false);

check('a zero or absent cutoff drops nothing at all',
  i => [i.drops(KEISHA_LINES[0], 0), i.drops(KEISHA_LINES[0], null)], [false, false]);

check('single-digit month/day and 2-digit years still parse',
  i => [i.drops('[8/27/26 1:03 PM] x', KEISHA_CUTOFF),
        i.drops('[8/27/26 9:15 AM] x', KEISHA_CUTOFF)], [false, true]);

check('a leading-whitespace entry is still recognised as dated',
  i => i.drops('   [08/27/2026 9:15 AM] indented prior-cycle note', KEISHA_CUTOFF), true);

// ── ONE DEFINITION, THREE CALLERS ─────────────────────────────────────────────
console.log('\nthe rule is written once — the three sites were byte-identical copies:');

// The first version of this assertion banned the LINE `var lineMs = new Date(dateMatch[1])...`,
// which also appears at the 180-day concern-scan filter — and THAT one was always correct, because
// its capture is /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}[^\]]*)\]/ and takes the time with it. Banning the
// generic line failed a site that had the right answer all along. What was ever wrong is the
// DATE-ONLY capture group, so that is what is banned.
// THIRD over-broad version of this one assertion, and the pattern is worth naming: every attempt to
// express "the bad shape is gone" as a REGEX OVER SOURCE caught something innocent — first the
// 180-day concern filter, then the Created-field parse, which is legitimately date-only because it
// reads a date field rather than a timestamped transcript line. Matching a regex with a regex is how
// that keeps happening. This counts the LITERAL anchored pattern instead, which is unambiguous. The
// executable assertions above are the real coverage; this one only guards against a copy-paste
// reintroduction.
const DATE_ONLY_LINE = '/^\\[(\\d{1,2}\\/\\d{1,2}\\/\\d{2,4})/';
check('the date-only TRANSCRIPT-LINE pattern is gone — that, not the comparison, was the defect',
  i => i.code.split(DATE_ONLY_LINE).length - 1, 0);

check('...and the 180-day concern filter, which always captured the time, is untouched',
  i => /\\d\{2,4\}\[\^\\\]\]\*\)\\\]\//.test(i.code), true);

check('the helper is defined exactly once and called from all three sites',
  i => ({
    defined: (i.code.match(/function _lpLineIsBeforeCutoff\(/g) || []).length,
    called:  (i.code.match(/_lpLineIsBeforeCutoff\(line, transcriptCutoffMs\)/g) || []).length
  }), { defined: 1, called: 3 });

// ── THE DIAGNOSTIC THAT MISLED THE INVESTIGATION ──────────────────────────────
console.log('\nthe arc-bound diag distinguishes an empty body from an absent fence:');

check('"fences NOT found" is no longer asserted from an inference',
  i => /transcript fences NOT found/.test(i.code), false);

check('...and the empty-body case names itself and points at the cutoff',
  i => /FENCES PRESENT AND THE BODY BETWEEN THEM IS EMPTY/.test(i.code)
    && /look at the cutoff, not at the fences/.test(i.code), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
