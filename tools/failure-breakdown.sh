#!/usr/bin/env bash
# Break down a day of exported Worker logs by failure.
# Usage: ./tools/failure-breakdown.sh worker-logs-2026-09-17.ndjson
set -euo pipefail

FILE="${1:?usage: failure-breakdown.sh <logs.ndjson>}"
command -v jq >/dev/null || { echo "jq is required (brew install jq)"; exit 1; }

total=$(wc -l < "$FILE" | tr -d ' ')
echo "=== $FILE — $total events ==="
echo

echo "--- events by service ---"
jq -r '.["$metadata"].service // "unknown"' "$FILE" | sort | uniq -c | sort -rn
echo

echo "--- events by level ---"
jq -r '.["$metadata"].level // "unknown"' "$FILE" | sort | uniq -c | sort -rn
echo

echo "--- error lines, chronological ---"
jq -r 'select((.["$metadata"].level // "") | test("error|fatal"))
       | [((.timestamp // 0) / 1000 | strftime("%H:%M:%SZ")), (.message // (.["$metadata"].message // "-"))]
       | @tsv' "$FILE" | sort
echo

echo "--- error shapes (digits collapsed, most frequent first) ---"
jq -r 'select((.["$metadata"].level // "") | test("error|fatal")) | .message // ""' "$FILE" \
  | sed -E 's/[0-9]{3,}/N/g' | sort | uniq -c | sort -rn | head -30
echo

echo "--- responses by status ---"
jq -r '.["$metadata"].statusCode // empty' "$FILE" | sort -n | uniq -c
echo

echo "--- errors per hour (UTC) ---"
jq -r 'select((.["$metadata"].level // "") | test("error|fatal"))
       | ((.timestamp // 0) / 1000 | strftime("%H")) ' "$FILE" | sort | uniq -c
