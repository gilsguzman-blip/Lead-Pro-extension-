#!/usr/bin/env bash
# non-vacuity.sh — run a suite against a build that PREDATES the fix and prove it fails.
#
# ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────
# The check "does this suite actually catch the bug?" is performed by pointing the suite at the
# previous build and reading the output. When the suite throws on load — which is the NORMAL
# case there, because the helper under test does not exist yet — stdout is empty.
#
# Empty output is indistinguishable at a glance from "every assertion passed quietly". That
# misreading has cost four wrong non-vacuity readings in one week (v9.7.583, v9.7.592, and
# v9.7.595 twice), each reported as "the suite doesn't catch the bug" when the suite had never
# run at all. Measured across the directory before v9.7.597: 48 of 52 suites died this way.
#
# tests/lib/guarded-impls.js fixes that inline for the 43 suites built on the `impls` pattern.
# The remaining suites extract at module top level and cannot be guarded uniformly without a
# rewrite each. THIS script covers all of them, whatever their shape, because it judges the run
# by what was printed rather than by trusting the suite to survive.
#
#   ZERO ASSERTIONS IS ITSELF A FAILURE. That is the whole rule.
#
# ── USAGE ────────────────────────────────────────────────────────────────────────────────
#   tests/non-vacuity.sh <suite.test.js> <old-build> [more args...]
#
#   tests/non-vacuity.sh close-out-eligibility.test.js /tmp/v595/popup.js /tmp/v595/popup.js
#   tests/non-vacuity.sh worker-smoke.test.js          worker/cloudflare-worker-v7.67.js
#
# Exit 0 means the suite ran AND failed — which is what a non-vacuity check wants to see.
set -uo pipefail

if [ $# -lt 2 ]; then
  echo "usage: tests/non-vacuity.sh <suite.test.js> <old-build> [more args...]" >&2
  exit 2
fi

SUITE=$1; shift
[ -f "tests/$SUITE" ] || { echo "no such suite: tests/$SUITE" >&2; exit 2; }

OUT=$(node "tests/$SUITE" "$@" 2>&1)
RC=$?
ASSERTS=$(grep -cE '^  (ok|FAIL) ' <<<"$OUT")
FAILURES=$(grep -cE '^  FAIL ' <<<"$OUT")
PASSES=$(grep -cE '^  ok   ' <<<"$OUT")

echo "$OUT"
echo
echo "───────────────────────────────────────────────────────────"
printf 'suite    : %s\n' "$SUITE"
printf 'against  : %s\n' "$1"
printf 'ran      : %d assertions (%d passed, %d failed)\n' "$ASSERTS" "$PASSES" "$FAILURES"

if [ "$ASSERTS" -eq 0 ]; then
  cat <<'MSG'
verdict  : ✗ VACUOUS — the suite printed NO assertions.

           This is NOT evidence that the suite fails to catch the bug. It is evidence that the
           suite never ran: it almost certainly threw during extraction because the code under
           test is absent from this build, which is exactly what you would expect.

           Do not record this as a non-vacuity result. Either guard the suite's extraction (see
           tests/lib/guarded-impls.js) or model the old behaviour explicitly and assert against
           that instead.
MSG
  exit 1
fi

if [ "$FAILURES" -eq 0 ]; then
  cat <<'MSG'
verdict  : ✗ NOT NON-VACUOUS — the suite ran and passed completely against the OLD build.

           Whatever it asserts was already true before the change, so it cannot be evidence that
           the change did anything. Check for assertions that only scan comments, that test a
           local helper instead of shipped code, or that read a hardcoded path rather than the
           build passed in (trade-attribution did the last of those until v9.7.597).
MSG
  exit 1
fi

printf 'verdict  : ✓ non-vacuous — %d assertions ran and %d failed against the old build\n' \
  "$ASSERTS" "$FAILURES"
exit 0
