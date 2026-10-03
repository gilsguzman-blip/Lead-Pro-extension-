# Lead Pro: Worker v7.77 and extension v9.7.706

- **Proxy:** `worker/cloudflare-worker-v7.77.js`, built on v7.76.
- **Extension:** v9.7.706 (DEV and COMMERCIAL paired).
- **Reporter:** unchanged at v1.22 (see item 3).
- **Privacy posture:** unchanged (v9.7.489). Every new field is an id, a length, a count, a timing or a build string.

## Deploy order

Any order is safe. Recommended:

1. **Worker v7.77.**
   - Safe alone: an older extension sends no `extensionVersion`, so the START line and `degen:` rows are byte-identical to v7.76 (tested).
   - It already gets the neutral fallback text, the Central-day endpoints, the classifier-failure visibility and `perf:` rows.
   - **Before deploying, check the Cloudflare plan** (item 6). On the Workers Free plan, set `PERF_ROWS=draft` or `off` first.
2. **Extension v9.7.706.**
   - Safe alone: an older worker ignores `extensionVersion`, and it still sends `_fallback`, which the new notice handles.
3. **Reporter:** nothing to deploy.
4. **Dashboard:** nothing to deploy. It works against either worker (item 3).

After the worker deploys, call `/list-licenses` once and read `keyFormats` (item 1).

## Items

### 1. /list-licenses returns licenses only

**The claim that real licenses could fall outside the first 1,000 keys does not hold.**
- KV lists keys in UTF-8 byte order. `L` (0x4C) sorts before every lowercase byte, so every `LP-` key comes before every telemetry key (`commit:`, `degen:`, `feedback:`, `invite:`, `perf:`).
- A license could only be pushed off the first page if there were more than 1,000 uppercase keys.

**The real harms were the rest of that first page.**
- About 1,000 minus the license count of `commit:`, `degen:` and `invite:` rows were each read (one KV read per row) and returned as "licenses".
- `invite:` rows carry `customerEmail`, so customer email addresses reached the license list.

**The fix:** list by the `LP-` prefix and follow the cursor to the end.
- Every writer in the worker mints `LP-` plus 8 characters.
- `LPDEV-GIL-DIRECTOR-001` is a `DIRECTOR_KEYS` environment value, not a KV record.

**Checking for other formats.** I can't read the live namespace from here, so two list-only passes look for anything else:
- uppercase keys before the first lowercase byte that don't start with `LP-` (an older format);
- `lp-` keys (the validate-license backfill before v7.37 wrote under the key exactly as it was typed).
- Both are **included**, flagged with `keyFormat`, and named in a new `keyFormats` response field. They are never dropped silently.
- The first `/list-licenses` call after deploy answers the "are there older formats" question on real data.

**Tests:**
- Licenses plus every telemetry prefix, including `invite:` rows with emails, come back as licenses only.
- 12 licenses come back across 3 pages of 5.
- There is one KV read per license and none on telemetry.
- An older format and a lowercase duplicate are each included and reported.

### 2. /feedback/summary byScenario

- `e.signal` is now passed to `_tallyBucket`. Every other bucket got it in v7.51; before this, every scenario's `explicitDown` was 0.
- The v7.52 abandoned→incomplete rewrite is now applied before the scenario loop.
- **Tests:**
  - Explicit and implicit thumbs split correctly per scenario.
  - An empty-meta abandoned row is counted as `incomplete` in its scenario, as it is in the top line.
  - Scenario totals, incomplete and abandoned all reconcile with the top line.

### 3. Central-day basis

**What changed:**
- `/feedback/summary` (`date=` and its default) and `/feedback/range` (the day list, per-day buckets and totals) now use Central days, matching `/feedback/drafts` and `/degenerate`.
- Rows are placed by their own `ts`, falling back to the key's server timestamp.
- Each UTC-date prefix is read once per request.
- Both responses now include `tz`.
- A malformed date returns 400.

**The reporter needed no change, and this corrects the premise:**
- Reporter v1.22 has zero reads of `/feedback/summary` or `/feedback/range`.
- It reads `feedback:` rows from KV directly and has filtered them to the Central day since v1.7.
- The v7.29 note ("stay on their existing UTC basis") described the two endpoints, not the email.
- So the daily email was already on Central time, and this build makes the endpoints agree with it. There was nothing to update, so the reporter version is not bumped.

**The dashboard also needs no change:**
- It is the real consumer of `/feedback/range`.
- All its ranges end on Central today, and it already asks for `to+1` to catch the evening rows filed under the next UTC date.
- Against v7.77 that extra day is tomorrow and empty. Against v7.76 it does what it always did.

**Transition effect.** Nothing is written differently, so there is no discontinuity day. Every past day re-renders on the Central basis the moment v7.77 deploys. What moves is each evening:

| | |
|---|---|
| Rows that move | 7 PM–midnight Central (CDT; 6 PM–midnight CST), from the next day to their own |
| Size | 3.2% of the 496 feedback rows in the 9/1–9/22 exports; 0–19% on any one day (19.2% on 9/17) |
| A single-day summary | moves by that day's evening minus the previous evening |
| A range | loses the evening before its first day |
| The reporter's emails | do not move (already Central) |

**Tests:** a row at 9:30 PM Central lands on the same Central day in summary, range and drafts, and only that day. This is checked on 9/22 (CDT), on 11/1 when DST ends, and on 3/8 when DST starts.

### 4. Build stamp on /generate

- **Extension:** `_lpAttachLicense` stamps `extensionVersion` on every generate-shaped body, read from the manifest exactly as the feedback row does. That covers the drafts, the SMS rewrite pass, the fact probes, the voicemail and the translation.
- **Worker:**
  - The value is clamped to 24 characters of version-string characters.
  - It is appended to the START line as ` ext=<ver>`.
  - It is stored on `degen:` and `perf:` rows.
  - When absent, output is byte-identical to v7.76.
- **Tests:**
  - Present: logged and stored.
  - Clamped.
  - Absent: the START line has the v7.76 shape and the `degen:` row matches v7.76 byte for byte (timestamp, id and latency normalised).
  - Manifest and non-generate cases.

### 5. Classifier failures are visible

- `classifyPhoneAsk` now returns `yes`, `no` or `failed`, with the HTTP status or the error.
- A failure produces:
  - its own `CLASSIFY FAILED sms=HTTP 400 …` line;
  - `FAILED` in the diagnostic, not `NO`;
  - `classifyFailed=true`, so the edge cache skips it;
  - a PREFILTER shadow line that says `FAILED`.
- Behaviour is unchanged: the primary draft is kept.
- **Tests:**
  - A 400 and a timeout each give a logged failure, `classifyFailed=true`, no cache store, and the primary draft kept.
  - Control: a real "no" still reads NO and is cached.

### 6. Durable performance counters

**The rows.**
- One row per generation, keyed `perf:<ts>:<requestId>`, with a 14-day TTL. About 430 bytes each.
- Written on `ctx.waitUntil` inside its own try, like `degen:` rows.
- One key per row, never a shared counter.
- Written on success, on an exhausted cascade and on an edge-cache HIT, so the HIT count can be non-zero.
- `perf:` is lowercase, so item 1 never lists these rows.

**GET /perf?date=YYYY-MM-DD** (Central day, director key required) returns the rows plus tallies:
- calls per tier and per contract;
- edge-cache HIT / MISS / BYPASS counts;
- classifier ran / skipped / failed counts;
- prefilter wouldSkip rate and miss count;
- cached and uncached tokens (median, mean, hit count) for primary-tier drafts, split at sysChars 30,000 (before M4 about 20–25k, after M4 about 32.5k).

**KV write volume at current traffic.**
- The 9/11 and 9/17 Worker exports show about 86–92 generations an hour in the afternoon, roughly 60% drafts and 40% fact probes.
- Over a 12-hour day that is **about 700–1,100 `perf:` writes on a weekday** (about 30,000 a month), holding about 6 MB at the 14-day TTL.

| Plan | Effect |
|---|---|
| Workers Paid | about 3% of the 1M writes included each month |
| Workers **Free** | the KV limit is 1,000 writes per day for the whole account, shared with the existing `feedback:` and `commit:` writes. This alone could exceed it. |

- `PERF_ROWS=off` stops the writes; `PERF_ROWS=draft` keeps only drafts (about 60%). The default is `all`.

**Tests:**
- One row per generation, with the right key and TTL.
- Every field is present with real values, and there is no prompt text, phone number or draft content.
- A failing KV write never breaks a generation.
- The `off` and `draft` modes, the exhausted and edge-HIT rows, the director gate, the Central-day window, and every tally.

### 7. Safe-fallback handling

- **Worker:** the fallback text is now "Thanks for reaching out. I'm pulling your information together and will follow up shortly." in all three fields.
  - No "today or tomorrow", no "come in", no visit, no brackets.
  - Still three fields, so an older client parses it.
- **Extension:** a `_fallback` envelope now does the following.
  - It empties the panes that failure owns: all three for a draft, only the voicemail pane for the voicemail button, so the agent's SMS and email survive a voicemail failure.
  - It disables their Copy buttons until the next generation.
  - It shows a notice before the output that stays put: "Draft generation failed. Try again.", with a **Try again** button that re-runs the same generation.
  - It logs `[LP FALLBACK DIAG]` with the tier, model, error, request id and time. No draft text is logged.
- **Tests:**
  - The notice, the empty fields, the disabled Copy, the retry and the log line.
  - Voicemail-only scope.
  - `generateAll`'s own fallback branch, lifted verbatim and executed.
  - The new text has no appointment push and no brackets.
  - `safe-fallback-contract.test.js` inverts one assertion on purpose (it pinned the placeholders as present).

## Tests

| Suite | Assertions | Against the previous build |
|---|---|---|
| `worker-v777.test.js` (new) | 52 | 39 fail on v7.76; the 13 that pass are 12 labelled controls and 1 labelled finding (the KV byte order) |
| `fallback-notice-706.test.js` (new) | 30 (15 per build) | 11 of 15 fail on v9.7.705; the 4 that pass are labelled controls |
| `run-all` | **6,152, 0 failed** (was 6,070) | 129 suites; now defaults to proxy v7.77 |

## Left alone

- **Deferred:** prefilter gating and edge-cache removal wait for a week of `/perf` data.
- **Unchanged:** the cascade, timeouts, cache breakpoints, regen guard and degenerate handling.
- **Reporter:** no reads to update.
- **Dashboard:** correct with either worker.
