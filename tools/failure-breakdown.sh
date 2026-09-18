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

# --- structured gemini_req lines (Worker v3.6+) -------------------------------
# Workers Logs may keep a JSON console.log as a raw string in .message or split
# it into fields, so normalize both shapes before reading them.
GEM='def gem:
  [ (.message? | if type == "string" then (fromjson? // empty) else empty end),
    (if .evt then . else empty end),
    (.["$metadata"]? | if type == "object" and .evt then . else empty end) ]
  | map(select(type == "object" and has("evt"))) | first // empty;'

if jq -e "$GEM"' gem | select(.evt == "gemini_req")' "$FILE" >/dev/null 2>&1; then
  echo
  echo "--- request outcomes ---"
  jq -r "$GEM"' gem | select(.evt == "gemini_req")
         | if .ok then (if .winner == "primary" then "ok (primary)" else "ok (fallback: \(.winner))" end)
           else "FAILED" end' "$FILE" | sort | uniq -c | sort -rn

  echo
  echo "--- tier failures by cause (cancelled = another tier won, expected) ---"
  jq -r "$GEM"' gem | select(.evt == "gemini_req") | .tiers[] | select(.ok == false)
         | "\(.tier)\t\(.err)\t\(.status // "-")\t\(.reason // "-")"' "$FILE" \
    | sort | uniq -c | sort -rn

  echo
  echo "--- real failures only, chronological ---"
  jq -r "$GEM"' gem | select(.evt == "gemini_req" and .ok == false)
         | . as $r | .tiers[] | select(.ok == false and .err != "cancelled")
         | [$r.rid, $r.ms, .tier, .err, (.status // "-"), ((.msg // "-") | .[0:90])] | @tsv' "$FILE"

  echo
  echo "--- rejected before Gemini ---"
  jq -r "$GEM"' gem | select(.evt == "gemini_reject") | "\(.status)\t\(.error)"' "$FILE" \
    | sort | uniq -c | sort -rn
fi
