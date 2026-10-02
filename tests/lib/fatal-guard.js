'use strict';
/**
 * fatal-guard.js — the last line of defence against a suite that dies before it speaks.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────
 * tests/lib/guarded-impls.js fixes the common case: the 43 suites that build an `impls` array
 * now report extraction failure as a normal FAIL. It cannot help the ten worker and reporter
 * suites, which extract at MODULE TOP LEVEL —
 *
 *     const src = fs.readFileSync(FILE, 'utf8');
 *     const W = (() => { ... throw new Error('handler not found') ... })();
 *
 * — because the throw happens before any `impls` exists to guard, and each suite's shape is
 * different enough that a uniform rewrite would mean ten separate rewrites of working code.
 *
 * A synchronous throw during module evaluation propagates to Node's top-level handler, so a
 * process-level listener registered EARLIER IN THE SAME FILE does catch it. Verified by
 * experiment before relying on it, because "I think Node does X" is how the last four of these
 * went wrong.
 *
 * ── WHAT IT DOES ──────────────────────────────────────────────────────────────────────────
 * Prints a line in the exact shape the runners count — `^  FAIL ` — followed by the usual
 * summary, then exits 1. run-all.sh and non-vacuity.sh both then see a suite that RAN and
 * FAILED rather than one that produced nothing, which is the whole difference between "this
 * doesn't catch the bug" and "this never executed".
 *
 * ── WHY IT IS APPLIED TO EVERY SUITE, NOT JUST THE TEN ────────────────────────────────────
 * A guarded suite can still die for a reason its guard does not cover — a missing fixture, a
 * bad require, a typo in a regex literal. This costs one line and one listener, fires only on
 * an otherwise-fatal error, and changes nothing on a healthy run.
 */
module.exports = function fatalGuard(suiteName) {
  process.on('uncaughtException', function (e) {
    var msg = (e && e.message) ? e.message : String(e);
    console.log('');
    console.log('  FAIL  ' + suiteName + ' — THE SUITE DID NOT LOAD, so it asserted nothing');
    console.log('        ' + msg);
    console.log('');
    console.log('        This is not evidence about the code under test. It means extraction');
    console.log('        threw before the first assertion — usually because the code being');
    console.log('        tested is absent from the build passed in, which is exactly what a');
    console.log('        non-vacuity check does on purpose.');
    if (e && e.stack) {
      var frame = String(e.stack).split('\n').filter(function (l) { return /tests\//.test(l); })[0];
      if (frame) console.log('        at' + frame.replace(/^\s*at/, ''));
    }
    console.log('');
    console.log('0 passed, 1 failed');
    process.exit(1);
  });
};

/**
 * bail(suite, why) — for a suite that cannot find what it needs and stops DELIBERATELY.
 *
 * Four suites did this with `console.error(...); process.exit(2)`. A non-zero exit means
 * run-all.sh catches it, but the output is a single bare line with no FAIL in it, so a
 * single-suite read — which is how a non-vacuity check is actually performed — shows something
 * that looks more like a usage error than a result. Same family as the silent death: the
 * suite's verdict has to be legible on its own, not only to the runner.
 */
module.exports.bail = function (suiteName, why) {
  console.log('');
  console.log('  FAIL  ' + suiteName + ' — could not find the code it tests, so it asserted nothing');
  console.log('        ' + why);
  console.log('');
  console.log('        Expected when pointed at a build that predates the code under test.');
  console.log('        Not evidence about that code either way.');
  console.log('');
  console.log('0 passed, 1 failed');
  process.exit(1);
};
