#!/usr/bin/env bash
# Runs every suite against the CURRENT shipped files. Args differ per suite, so they are named
# here rather than guessed. Exits non-zero if any suite fails.
#
# Usage: tests/run-all.sh [proxy.js] [reporter.js]
set -uo pipefail
cd "$(dirname "$0")/.."

DEV=builds/dev/popup.js
COMM=builds/commercial/popup.js
PROXY=${1:-worker/cloudflare-worker-v7.70.js}
REPORTER=${2:-worker/leadpro-reporter-v1.22.js}
DASH=$(ls dashboard*.html dashboard/*.html 2>/dev/null | head -1)

declare -a FAILED=()
TOTAL_PASS=0
TOTAL_FAIL=0

run() {
  local name=$1; shift
  local out
  out=$(node "tests/$name" "$@" 2>&1)
  local rc=$?
  local p f
  p=$(grep -c '^  ok   ' <<<"$out")
  f=$(grep -c '^  FAIL ' <<<"$out")
  TOTAL_PASS=$((TOTAL_PASS + p))
  TOTAL_FAIL=$((TOTAL_FAIL + f))
  # (v9.7.597) A SUITE THAT PRINTS NOTHING IS NOT A PASSING SUITE. A non-zero rc already caught
  # the common case, but a suite that exits 0 having asserted nothing — a bad slice that matched
  # empty, a guard that returned early, an argument list it silently ignored — was scored as green
  # and added 0 to the totals. That is the same misreading that cost four wrong non-vacuity results
  # this week, in the place where it would be least visible.
  if [ $((p + f)) -eq 0 ]; then
    FAILED+=("$name")
    printf '  FAIL  %-36s   NO ASSERTIONS RAN (rc=%d) — suite did not execute\n' "$name" "$rc"
    head -12 <<<"$out" | sed 's/^/        /'
  elif [ $rc -ne 0 ] || [ "$f" -ne 0 ]; then
    FAILED+=("$name")
    printf '  FAIL  %-36s %3d ok  %3d failed\n' "$name" "$p" "$f"
    grep -A3 '^  FAIL ' <<<"$out" | head -40
  else
    printf '  ok    %-36s %3d assertions\n' "$name" "$p"
  fi
}

echo
echo "build integrity (manifests + popup headers):"
run build-integrity.test.js builds/dev builds/commercial

echo
echo "extension suites (dev + commercial, both must agree):"
for t in amp-banner arc-bound bereavement delivery-match arc-relevancy commit-comprehension crm-entry-walk \
         decline-attribution distance-zip feedback-copy feedback-flush fences-fallback \
         lp-command-coverage observer-wiring off-franchise pivot \
         sched-attribution spouse-attribution fact-comprehension cadence arc-state stalled-phase edge-bypass value-fact-diag on-premise-authorship sched-scan-depth transcript-cutoff tapback-anchor anchor-authorship reply-vs-inquiry close-out-floor own-words-topics close-out-eligibility customer-facing-hygiene consent-and-stock declined-alternative phone-directory vm-lead-scope inventory-freshness authoritative-phase scrub-diacritics distance-appt-gate pause-supersession color-ask friction-state concern-scope voi-family lead-boundary \
         scaffold-leak sold-scan splitframe-lead state-validity trade-attribution \
         trade-delivery verbal-commit; do
  [ -f "tests/$t.test.js" ] && run "$t.test.js" "$DEV" "$COMM"
done

echo
echo "cross-surface suites (extension + worker + reporter):"
run commit-persistence.test.js "$DEV" "$COMM" "$PROXY" "$REPORTER"
run note-types.test.js         "$DEV" "$COMM" "$PROXY" "$REPORTER"
# safe-fallback-contract asserts on the PROXY as well as the extension — it belongs here,
# not in the extension-only loop, where it silently tested whatever its default pointed at.
run safe-fallback-contract.test.js "$DEV" "$COMM" "$PROXY"
run regen-effort.test.js          "$DEV" "$COMM" "$PROXY"

echo
echo "worker / reporter suites:"
run probe-label.test.js              "$PROXY"
run valuefact-freshness.test.js      "$PROXY"
run live-check.test.js
run worker-smoke.test.js             "$PROXY"
run worker-aggregate.test.js         "$PROXY"
run dashboard-explicit-down.test.js  "$PROXY"
run cache-ceiling.test.js            "$REPORTER"
run reporter-feedback.test.js        "$REPORTER"
run reporter-leadlink.test.js        "$REPORTER"
[ -n "${DASH:-}" ] && run dashboard-render.test.js "$DASH" "$PROXY"

echo
echo "───────────────────────────────────────────────────────────"
printf 'TOTAL: %d assertions passed, %d failed\n' "$TOTAL_PASS" "$TOTAL_FAIL"
if [ ${#FAILED[@]} -ne 0 ]; then
  echo "FAILING SUITES: ${FAILED[*]}"
  exit 1
fi
echo "all suites green"
