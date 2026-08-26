# Post-deployment review — leadpro-proxy, 2026-08-26

Log window `14:03:32Z`–`15:03:35Z` (09:03–10:03 CT), 1,157 entries, 216 distinct
requests, read against the leadpro-reporter daily report for 08:11–10:01 CT.

Reproduce with:

```
python3 analysis/parse-worker-logs.py <logs.json>
```

## Summary

Worker version `67faf555` shipped a reference error that failed **every**
`/commit-comprehension` request for 31 minutes. The redeploy to `59e62ed2` at
14:37Z closed it; no action outstanding. Three issues remain open, none of which
break anything but all of which cost money or hide problems.

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 01 | Critical | TDZ `ReferenceError` killed `/commit-comprehension` outright | Resolved by redeploy |
| 02 | High | Prompt-cache prefix frozen at 3,993 tokens; nothing ever written | Open |
| 03 | Medium | "Cold starts 41%" counts structurally uncacheable requests | Open |
| 04 | Medium | Daily report cannot see non-generate failures | Open |
| 05 | Opportunity | Shadow prefilter looks safe; would cut ~59% of classify calls | Needs more data |

## 01 — TDZ ReferenceError, resolved

Every failure carries an identical signature:

```
ReferenceError: Cannot access 'requestId' before initialization
    at Object.fetch (cloudflare-worker.js:1333:50)
```

`requestId` is read at line 1333 before its `let`/`const` declaration is reached,
on the `/commit-comprehension` branch.

A TDZ error has no partial-failure mode — it fires on 100% of requests reaching
the line. The logs match exactly: 48 requests, 48 throws, zero successes. There
was no degradation period.

| Script version | Live | Requests | Threw |
|----------------|------|---------:|------:|
| `67faf555` | 14:03:32 – 14:35:20Z | 48 | 48 |
| `59e62ed2` | 14:37:51 – 15:03:35Z | 6 | 0 |

Blast radius stayed inside the observer. The generate path ran 39/39 through the
same window, so nothing customer-facing broke; the extension absorbs a 500 here
without surfacing it.

**Action:** none outstanding. Worth adding a post-deploy smoke step that POSTs one
request per route — a TDZ error surfaces on the first call, so this would have
been caught in under a minute rather than 31.

## 02 — The prompt cache is frozen

All 41 `CACHE` lines report `written=0`. Not one new entry was created. Every one
of the 25 draft-tier requests reports exactly `cached=3993` — the same number, to
the token, on every call.

The cause sits in the same log line. Under cache key `lp_773499b2` the system
prompt is not byte-stable:

| Cache key | Reqs | `sysChars` range | Distinct | Cached | Written |
|-----------|-----:|------------------|---------:|-------:|--------:|
| `lp_773499b2` (draft) | 25 | 20,050 – 22,166 | 15 | 3,993 | 0 |
| `lp_639bd9d7` (fact) | 12 | 102 | 1 | 0 | 0 |
| `lp_fd4886ea` (fact) | 4 | 93 | 1 | 0 | 0 |

The shared prefix ends at token 3,993 because that is where per-request content
starts varying inside the system block. Everything past it can never match a
cached prefix, so it is re-billed on every call and never written back.

Cost: 480–1,356 uncached system tokens per draft request, averaging **702**.

The daily report's own footnote predicts this: *"a low figure there means the
prefix boundary moved, not that the prompt is big."* It moved, and it is stuck.

**Action:** find what varies between 20,050 and 22,166 characters in the draft
system block — an inventory slice, a store block, a date stamp — and move it to
the end of the system block or into the user turn. That extends the stable prefix
across the full ~4.5k tokens and should take "prefix cached (warm)" from 86%
toward 100%.

## 03 — Cold-start metric counts the wrong population

16 of 41 cache rows are `fact`-tier calls whose entire system prompt is 93 or 102
characters (~25 tokens). Those sit below any cacheable prefix minimum and report
`cached=0` by construction.

Excluding them, **zero** of the 25 draft-tier requests were cold. The tile reading
"41% of prompts missed cache" actually says "39% of requests were tiny fact
lookups that cannot cache at all."

**Action:** compute cold starts over cacheable-tier requests only, or split the
tile by tier. As written the number cannot improve however well the cache performs.

## 04 — The daily report cannot see this failure class

The 08-26 report covers 08:11–10:01 CT and states 487 requests, 99.4% completion,
Failures (3) — all three PRIMARY-tier generate failures. The outage sat inside
that window at 09:04–09:35 CT. The 09:xx CT row shows 225 requests and no failure
signal. Forty-eight hard errors appear in no tile.

The reporter derives its numbers from generate-path telemetry (`START` / `FINAL`
lines). A request that throws before emitting them contributes to no denominator.
"Completion rate" therefore means *of requests that got far enough to be counted*.

**Action:** count entries where `$metadata.level == "error"` grouped by request
path, and add a per-endpoint error tile. Without it any non-generate route can go
fully dark while the report still prints 99.4%.

## 05 — Shadow prefilter

17 shadow rows, `miss=false` on all 17 — it never would have skipped a lead the
model went on to flag. On the 10 rows reporting `wouldSkip=true`, the model
returned `sms=NO email=NO` every time. The 7 disagreements all run the safe
direction (prefilter sees contact where the model sees none, so it runs an
unnecessary classify rather than wrongly skipping).

**Action:** hold. 17 samples is thin and only 2 leads in the window were flagged
at all, so the shadow has barely been tested against positives. Let it run through
a window with a real cluster of `sms=YES` leads before promoting.

## What held up

- 39/39 generate requests completed. Median 4,061ms, mean 3,993ms, max 12,222ms.
- Zero fallback-tier invocations; every PRIMARY succeeded on `gpt-5.6-luna`.
- Every PRIMARY returned `finish=STOP` — no truncation at the token limit.
- `classifyFailed=true` on zero requests.
- One regeneration, correctly triggered by an SMS flag, 3,064ms.
- Edge cache: 38 stored, 36 miss, 4 deliberate bypass.
- 36 feedback posts with a single `abandoned | no_interaction`, matching the
  report's "1 produced and never used".

## Repository drift

The crash is at `cloudflare-worker.js:1333`. The `cloudflare-worker.js` in this
repository is 100 lines, identifies as v3.5, and targets Gemini models. Production
runs `gpt-5.6-luna` behind edge caching with feedback, commit-comprehension,
inventory, valuefact and appointment-invite routes — none of which exist in the
checked-in file.

The extension has drifted the same way: `manifest.json` reads 8.46, the bundled
zip is 9.7.118, production reports 9.7.582. Neither contains the string
`commit-comprehension`.

There is no line 1333 in this repository to fix and no deployed-worker revision to
diff against, which is why this review ends at diagnosis. Getting the deployed
worker and extension under version control is the single change that would make
the next one of these a code review rather than a log reading.
