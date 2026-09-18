# Worker log tools

Pull a complete day of `leadpro-proxy` logs and break the failures down. The
dashboard Query Builder is an investigation UI — it caps what it returns per
query and has no "export day" button, so a day with thousands of requests never
fits on screen.

**Start here: complete days are already archived.** `leadpro-reporter` reads
Workers Trace Events Logpush output from the `LOGS` R2 bucket at
`logs/YYYYMMDD/` (gzipped NDJSON), so every day is already on disk with no
retention clock. A Central day straddles two UTC partitions — `logs/{D}/` holds
the CT morning and afternoon, `logs/{D+1}/` the CT evening — so read both and
filter by each entry's own CT date, the rule `runReport` applies.

| Want | Use |
| --- | --- |
| A past day, complete | The R2 archive + `logpush-failures.mjs` |
| Just the fail lines, no download | The `?raw=failures` route in `reporter-failure-detail.md` |
| Today, before Logpush has flushed | `fetch-worker-logs.mjs` (Query API, 3–7 day retention) |

## Breaking down proxy failures

Run these on your own machine, from the repo root, after `git pull` — they read a
file you have downloaded, not Cloudflare directly.

**Getting the file.** `wrangler r2 object` has only `get`/`put`/`delete` — there
is no listing command, and Logpush object keys carry generated IDs, so a day's
files cannot be enumerated locally. Two ways around that:

1. **The `?raw=failures` route** (patch 7 in `reporter-failure-detail.md`). The
   reporter already holds the R2 binding and a `listObjects` helper, so it can
   enumerate what you cannot:

   ```bash
   curl -s 'https://leadpro-reporter.gilsguzman.workers.dev/?date=2026-09-17&raw=failures&token=…'      > failures-2026-09-17.txt
   node tools/logpush-failures.mjs failures-2026-09-17.txt --date 2026-09-17
   ```

2. **The R2 S3 API**, with an R2 access key from the dashboard, using `rclone` or
   `aws s3` to sync `logs/20260917/` and `logs/20260918/`, then `gunzip -c *.gz >
   day.ndjson`.

**Exporting from the dashboard instead?** Filter *before* you export. An
unfiltered export hits the 2000-event cap, and on this proxy 2000 events is
about 34 seconds — most of it auto-instrumented `kv_get` tracing spans
(`$metadata.type == "span"`), not console output. Put `FAIL` in the search box,
set the range to the whole day, then export: the cap applies to matching events,
so a day's ~25 fail lines fit easily.

All three inputs work — Logpush JSON, the route's `<iso>TAB<message>` lines, and
the dashboard's JSON export (message under `$metadata.message`, spans skipped
and counted):

```bash
node tools/logpush-failures.mjs day.ndjson --date 2026-09-17
node tools/logpush-failures.mjs day.ndjson --date 2026-09-17 --raw   # source lines only
```

**To answer only "is a cause logged at all", skip all of this** and search the
Observability Query Builder for `FAIL`, then expand one event and read the
message. 9/17 is still inside the 3–7 day retention window.

Parses the Logpush shape the reporter reads, but keeps what the reporter's
`RE_FAIL` discards: the model, the FAIL-vs-ERROR distinction, and any text after
the ms. It reports up front how many fail lines carry a cause, which decides
whether the reporter patch alone is enough — see `reporter-failure-detail.md`.

## The Query API path (live / recent days)

## One-time setup

1. **Turn observability on** (if it isn't already) in each Worker's Wrangler
   config, and check the sampling rate — anything below `1.0` means the export
   is a sample, not a complete day:

   ```toml
   [observability]
   enabled = true
   head_sampling_rate = 1.0
   ```

2. **Create an API token** at
   <https://dash.cloudflare.com/profile/api-tokens> → *Create Token* →
   *Create Custom Token*, with permission **Account · Account Analytics · Read**
   scoped to your account.

3. **Export the credentials** (add to `~/.zshrc` to make it permanent):

   ```bash
   export CLOUDFLARE_ACCOUNT_ID=your-account-id     # dash URL: dash.cloudflare.com/<this>
   export CLOUDFLARE_API_TOKEN=your-token
   ```

Requires Node 18+ (for built-in `fetch`) and `jq` for the breakdown script.

## Pull a day

```bash
./tools/fetch-worker-logs.mjs --date 2026-09-17 --tz -05:00 \
    --service leadpro-proxy --out worker-logs-2026-09-17.ndjson
```

| Flag | Meaning |
| --- | --- |
| `--date` | Day to pull, `YYYY-MM-DD`. Defaults to today. |
| `--tz` | Offset that defines "the day". `-05:00` = CDT, `-06:00` = CST. |
| `--service` | Keep only this Worker's events (client-side). Omit for all Workers. |
| `--out` | Output file. Defaults to `worker-logs-<date>.ndjson`. |
| `--debug` | Dump the raw first API page to stderr when the response shape surprises it. |

It pages backwards through the day at the documented 2000-event maximum per
query, using the oldest event of each page as the next page's cursor, dedupes by
event id, and retries 429/5xx with exponential backoff.

**Retention is the constraint** on this path: Workers Logs keeps 3 days on Free
and 7 on Paid. That is why it is the fallback — the R2 archive above has no such
limit.

## Break down the failures

```bash
./tools/failure-breakdown.sh worker-logs-2026-09-17.ndjson
```

Prints events by service and level, every error line in time order, error
"shapes" with digits collapsed so repeats group together, responses by status,
and errors per hour.

Useful ad-hoc queries on the same file:

```bash
# every error line
jq -r 'select(.["$metadata"].level == "error")
       | [(.timestamp/1000 | strftime("%H:%M:%SZ")), .message] | @tsv' worker-logs-2026-09-17.ndjson

# everything in a two-minute window around a known bad request
jq -r 'select(.timestamp > 1758155000000 and .timestamp < 1758155120000) | .message' worker-logs-2026-09-17.ndjson
```

## Reference: structured per-request logging

`cloudflare-worker.js` v3.6 is a **reference implementation, not the deployed
proxy** — production runs a sequential tier cascade with a different log format.
The shape below is what to port onto the live proxy if its FAIL lines turn out to
carry no cause. It writes one structured line per invocation. Lead content is never logged — only
tier, model, timing and the upstream error.

```json
{"evt":"gemini_req","rid":"9a1f…","ok":true,"winner":"secondary","ms":551,
 "tiers":[{"tier":"primary","model":"gemini-3.1-flash-lite-preview","wait":0,"ms":60,
           "ok":false,"err":"http","status":429,"reason":"RESOURCE_EXHAUSTED",
           "msg":"Quota exceeded for quota metric …"},
          {"tier":"secondary","model":"gemini-3-flash-preview","wait":400,"ms":150,"ok":true},
          {"tier":"pro","model":"gemini-3.1-pro-preview","wait":1000,"ms":1,"ok":false,"err":"cancelled"}]}
```

`err` separates the four cases that used to be indistinguishable:

| `err` | Meaning |
| --- | --- |
| `cancelled` | Another tier won and aborted this one. Expected — two per healthy request, not a failure. |
| `timeout` | The 12s `TIMEOUT_MS` ceiling fired. Shows up as a ~12000ms row. |
| `http` | Gemini rejected it. Carries `status` (429/500/…), `reason` (`RESOURCE_EXHAUSTED`, `INVALID_ARGUMENT`, …) and the message. |
| `network` | The call never reached Gemini. |

`rid` is the `cf-ray` header, so a line joins to Cloudflare's own request log.
Requests rejected before Gemini is reached (bad JSON, missing fields, missing key)
emit `evt:"gemini_reject"` — previously invisible.

Successful requests log at `info`, failures at `error`, so the level filters in
the breakdown script line up with real failures.

## If the failures have no cause attached

The breakdown is only as good as what the proxy logs. Run
`logpush-failures.mjs` first — it says outright whether the archived fail lines
carry text after the ms. If they do, the cause is already in R2 and only the
reporter needs fixing. If they don't, the proxy has to emit one:

```js
console.log(JSON.stringify({ evt: 'gemini_fail', model, tier, ms: Date.now() - t0,
                             status: res.status, msg: detail }));
```
