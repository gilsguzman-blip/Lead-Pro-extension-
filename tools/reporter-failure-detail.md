# Reporter patch — stop discarding the failure cause

Against `leadpro-reporter` v1.22. Six edits, each an exact find/replace. The
first two are the whole point; the rest make the result readable and correct.

## 1. `RE_FAIL` keeps only tier and latency

Capture group 2 (`FAIL|ERROR`) is matched and never read, the model is matched
as a throwaway `\S+`, and anything after the ms is outside the match entirely.

```js
// FIND
const RE_FAIL      = /(PRIMARY|FALLBACK|EMERGENCY)\s+(FAIL|ERROR)\s+\S+\s+(\d+)ms/;

// REPLACE
const RE_FAIL      = /(PRIMARY|FALLBACK|EMERGENCY)\s+(FAIL|ERROR)\s+(\S+)\s+(\d+)ms\s*(.*)$/;
```

## 2. Carry what the regex now captures

Note the group renumbering — `ms` moves from `x[3]` to `x[4]`.

```js
// FIND
      } else if ((x = msg.match(RE_FAIL)))
        (req.fails = req.fails ?? []).push({ tier: x[1], ms: +x[3] });

// REPLACE
      } else if ((x = msg.match(RE_FAIL)))
        (req.fails = req.fails ?? []).push({
          tier:   x[1],
          kind:   x[2],                    // FAIL vs ERROR — matched since v1.0, never stored
          model:  x[3],
          ms:     +x[4],
          detail: (x[5] || '').trim()      // '' when the proxy logs nothing after the ms
        });
```

## 3. An escaper, because the cause is upstream text

`detail` is a Gemini error message interpolated into an HTML email. Add beside
the other helpers in `buildReport`:

```js
  const esc = s => String(s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
```

## 4. Render it, and count both numbers

`Failures (${failReqs.length})` counts *requests*, while the table body emits one
row per *fail event* — which is why the 9/17 report reads `Failures (23)` above
24 rows. The 17:25:42 PRIMARY and FALLBACK lines are one request, two events.

```js
// FIND
  ${failReqs.length ? section(`Failures (${failReqs.length})`, table(
    ['Time (UTC)', 'Tier', 'Latency'],
    failReqs.flatMap(d => d.fails.map(f =>
      tr([`<span style="color:#f87171">${d.final.ts.slice(0,19)}Z</span>`, f.tier, f.ms+'ms'])
    ))
  )) : ''}

// REPLACE
  ${failReqs.length ? (() => {
    const failEvents = failReqs.reduce((a, d) => a + d.fails.length, 0);
    const withCause  = failReqs.reduce((a, d) => a + d.fails.filter(f => f.detail).length, 0);
    return section(
      `Failures (${failEvents} event${failEvents === 1 ? '' : 's'} across ${failReqs.length} request${failReqs.length === 1 ? '' : 's'})`,
      table(
        ['Time (UTC)', 'Tier', 'Kind', 'Model', 'Latency', 'Cause'],
        failReqs.flatMap(d => d.fails.map(f =>
          tr([
            `<span style="color:#f87171">${d.final.ts.slice(0,19)}Z</span>`,
            f.tier,
            `<span style="color:${f.kind === 'ERROR' ? '#f87171' : '#fbbf24'}">${f.kind || '—'}</span>`,
            `<span style="color:#6b7280">${esc((f.model || '—').replace(/^gemini-/, ''))}</span>`,
            f.ms + 'ms',
            f.detail ? `<span style="color:#94a3b8">${esc(f.detail).slice(0, 140)}</span>`
                     : '<span style="color:#4b5563">not logged</span>'
          ])
        ))
      )
      + (withCause === 0
          ? '<div style="font-size:10px;color:#fbbf24;margin-top:8px">No cause text on any fail '
            + 'line — the proxy is not emitting one. Tier, kind and model are all that can be '
            + 'recovered until it does.</div>'
          : '')
    );
  })() : ''}
```

## 5. Same in the plain-text summary

```js
// FIND
      `── FAILURES (${failReqs.length}) ──`,
      ...failReqs.flatMap(d => d.fails.map(f => `  ${d.final.ts.slice(0,19)}Z  ${f.tier} @ ${f.ms}ms`))

// REPLACE
      `── FAILURES (${failReqs.reduce((a, d) => a + d.fails.length, 0)} events / ${failReqs.length} requests) ──`,
      ...failReqs.flatMap(d => d.fails.map(f =>
        `  ${d.final.ts.slice(0,19)}Z  ${f.tier} ${f.kind || ''} ${f.model || ''} @ ${f.ms}ms`
        + (f.detail ? `  — ${f.detail}` : '')))
```

And the reliability line, which calls a request count "fail events":

```js
// FIND
    `  Completion : ${compRate}%  (${failReqs.length} fail events)`,

// REPLACE
    `  Completion : ${compRate}%  (${failReqs.length} requests saw a tier fail)`,
```

## 6. Optional but recommended — "Completion Rate" measures something else

`compRate = 100 * (n - failReqs.length) / n` counts a request as incomplete if
*any* tier failed, even when a lower tier then succeeded and the draft shipped.
`parseLogs` only pushes requests that reached `FINAL`, so every request in `n`
completed by definition. 99.3% is the share of requests that ran clean on the
first tier, not the share that produced a draft.

```js
// FIND
    stat('Completion Rate', compRate + '%', colorFor(100 - +compRate, 1, 3)),

// REPLACE
    stat('Clean-Run Rate', compRate + '%', colorFor(100 - +compRate, 1, 3)),
```

Renaming rather than recomputing keeps the series continuous — the number was
always this; only the label was wrong.

## 7. A raw route, so the source text is reachable without a redeploy

Add to `fetch`, just after `dateLabel` is computed. Reuses `listObjects` /
`readObject` / `ctDateLabel` as they already exist. Gated on a secret because it
returns unparsed log content; without `RAW_LOG_TOKEN` set it 404s.

```js
    // (v1.23) Raw fail lines for the day, straight from R2. The Failures table is
    // a summary; this is the text it was summarised from. Two UTC partitions are
    // read and each entry's own CT date decides, same rule as runReport.
    if (url.searchParams.get('raw') === 'failures') {
      if (!env.RAW_LOG_TOKEN || url.searchParams.get('token') !== env.RAW_LOG_TOKEN)
        return new Response('Not found', { status: 404 });
      const day  = dateLabel.replace(/-/g, '');
      const next = new Date(new Date(dateLabel + 'T00:00:00Z').getTime() + 86400000)
                     .toISOString().slice(0, 10).replace(/-/g, '');
      const keys = (await Promise.all([
        listObjects(env.LOGS, `logs/${day}/`),
        listObjects(env.LOGS, `logs/${next}/`)
      ])).flat();
      const out = [];
      for (const chunk of await Promise.all(keys.map(k => readObject(env.LOGS, k)))) {
        for (const e of chunk) {
          const ts = e.EventTimestampMs ?? e.eventTimestampMs ?? 0;
          if (ts && ctDateLabel(new Date(ts)) !== dateLabel) continue;
          for (const log of (e.Logs ?? e.logs ?? [])) {
            const msg = Array.isArray(log.Message) ? log.Message.join(' ') : (log.message ?? '');
            if (RE_FAIL.test(msg)) out.push((ts ? new Date(ts).toISOString() : '') + '\t' + msg);
          }
        }
      }
      return new Response(out.sort().join('\n') + '\n',
                          { headers: { 'Content-Type': 'text/plain' } });
    }
```

Set the secret with `npx wrangler secret put RAW_LOG_TOKEN`, then:

```bash
curl -s 'https://leadpro-reporter.gilsguzman.workers.dev/?date=2026-09-17&raw=failures&token=…'
```

That answers the question this patch turns on: **is there anything after the ms?**
If those lines end at `…ms`, edits 1–2 recover tier, kind and model but no cause,
and the proxy has to start logging one. If they carry text, every archived day
becomes analysable retroactively.
