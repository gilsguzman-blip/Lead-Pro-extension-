# Worker log tools

Pull a complete day of Cloudflare Workers Logs out of the `leadpro-proxy` /
`leadpro-reporter` Workers and break the failures down locally. The dashboard
Query Builder is an investigation UI — it caps what it returns per query and has
no "export day" button, so a day with thousands of requests never fits on screen.

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

**Retention is the constraint:** Workers Logs keeps 3 days on the Free plan and
7 on Paid. Anything older is gone — for a permanent archive, set `logpush = true`
in the Wrangler config and create a Logpush job on the `workers_trace_events`
dataset pointing at an R2 bucket (Workers Paid; $0.05/M delivered with 10M/month
free).

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

## If the failures have no cause attached

The breakdown is only as good as what the Worker logs. If a hedged Gemini call
fails, the `AggregateError` detail has to be written to the log explicitly or it
never reaches observability — one structured line per failed tier is what makes
the export greppable:

```js
console.log(JSON.stringify({ evt: 'gemini_fail', model, tier, ms: Date.now() - t0,
                             status: res.status, msg: detail }));
```
