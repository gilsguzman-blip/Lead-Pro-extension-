/**
 * LeadPro Daily Reporter — Cloudflare Worker
 * Cron: 13:00 UTC daily (8 AM CT)
 * Reads yesterday's Logpush R2 files, analyzes, emails report.
 * Parses native Logpush format (one JSON object per request, Logs array inside)
 * v1.2 — performance optimizations
 */

const CT_OFFSET = -5;

// Module-scope singletons
const decoder = new TextDecoder();

// Pre-compiled regexes (avoid per-call re-creation)
const RE_PRIMARY   = /PRIMARY OK\s+(\S+)\s+(\d+)ms/;
const RE_FALLBACK  = /FALLBACK OK\s+(\S+)\s+(\d+)ms/;
const RE_EMERGENCY = /EMERGENCY OK\s+(\S+)\s+(\d+)ms/;
const RE_REGEN     = /REGEN OK\s+(\S+)\s+(\d+)ms total=(\d+)/;
const RE_FINAL     = /FINAL total=(\d+)ms regenerated=(true|false)/;
const RE_CLASSIFY  = /CLASSIFY sms=(\w+) email=(\w+) phoneOnFile=(\w+)/;
const RE_CACHE     = /CACHE primary cached=(\d+)\/(\d+)/;
const RE_FAIL      = /(PRIMARY|FALLBACK|EMERGENCY)\s+(FAIL|ERROR)\s+\S+\s+(\d+)ms/;

// ── R2 helpers ────────────────────────────────────────────────────────────

async function listObjects(bucket, prefix) {
  let objects = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
    objects = objects.concat(page.objects.map(o => o.key));
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
  return objects;
}

async function readObject(bucket, key) {
  const obj = await bucket.get(key);
  if (!obj) return [];

  let text;

  if (key.endsWith('.gz')) {
    const compressed = await obj.arrayBuffer();
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(compressed);
    writer.close();
    const chunks = [];
    const reader = ds.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const totalLen = chunks.reduce((a, b) => a + b.length, 0);
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) { merged.set(c, offset); offset += c.length; }
    text = decoder.decode(merged);
  } else {
    text = await obj.text();
  }

  return text.split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
}

// ── Log parsing — native Logpush format ──────────────────────────────────

function parseLogs(entries) {
  const requests = [];

  for (const entry of entries) {
    if (!entry.Logs && !entry.logs) continue;

    const logs        = entry.Logs ?? entry.logs ?? [];
    const wallMs      = entry.WallTimeMs ?? entry.wallTimeMs ?? 0;
    const cpuMs       = entry.CPUTimeMs ?? entry.cpuTimeMs ?? 0;
    const outcome     = entry.Outcome ?? entry.outcome ?? '';
    const scriptName  = entry.ScriptName ?? entry.scriptName ?? '';
    const scriptVersion = entry.ScriptVersion?.ID ?? entry.scriptVersion?.id ?? '';
    const colo        = entry.Event?.Request?.cf?.colo ?? entry.event?.request?.cf?.colo ?? '';
    const tsMs        = entry.EventTimestampMs ?? entry.eventTimestampMs ?? 0;
    const ts          = tsMs ? new Date(tsMs).toISOString() : '';

    const req = { ts, wallMs, cpuMs, outcome, scriptName, scriptVersion, colo };

    for (const log of logs) {
      const msg   = Array.isArray(log.Message) ? log.Message.join(' ') : (log.message ?? '');
      const logTs = log.TimestampMs ? new Date(log.TimestampMs).toISOString() : ts;
      let x;

      if ((x = msg.match(RE_PRIMARY)))
        req.primary = { ts: logTs, model: x[1], ms: +x[2] };
      else if ((x = msg.match(RE_FALLBACK)))
        req.fallback = { ts: logTs, model: x[1], ms: +x[2] };
      else if ((x = msg.match(RE_EMERGENCY)))
        req.emergency = { ts: logTs, model: x[1], ms: +x[2] };
      else if ((x = msg.match(RE_REGEN)))
        req.regen = { ts: logTs, model: x[1], ms: +x[2], total: +x[3] };
      else if ((x = msg.match(RE_FINAL)))
        req.final = { ts: logTs, total: +x[1], regen: x[2] === 'true' };
      else if ((x = msg.match(RE_CLASSIFY)))
        req.classify = { sms: x[1], email: x[2], phone: x[3] };
      else if ((x = msg.match(RE_CACHE))) {
        const tot = +x[2];
        req.cachePct = tot ? +(100 * +x[1] / tot).toFixed(1) : 0;
      } else if ((x = msg.match(RE_FAIL)))
        (req.fails = req.fails ?? []).push({ tier: x[1], ms: +x[3] });
    }

    if (!req.final && wallMs) {
      req.final = { ts, total: wallMs, regen: false };
    }

    if (req.final) requests.push(req);
  }

  return requests;
}

// ── Stats helpers ─────────────────────────────────────────────────────────

const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
const safeMax = arr => arr.length ? arr.reduce((a, b) => (b > a ? b : a), -Infinity) : 0;

// Sort once, return multiple percentiles in one call
function percentiles(arr, ...ps) {
  if (!arr.length) return ps.map(() => 0);
  const s = [...arr].sort((a, b) => a - b);
  return ps.map(p => s[Math.min(Math.floor(s.length * p / 100), s.length - 1)]);
}

const ctHour = ts => {
  try { return (new Date(ts).getUTCHours() + CT_OFFSET + 24) % 24; }
  catch { return -1; }
};

const colorFor = (val, good, warn) =>
  val <= good ? '#34d399' : val <= warn ? '#fbbf24' : '#f87171';

// ── Report builder ────────────────────────────────────────────────────────

function buildReport(reqs, dateLabel) {
  const n = reqs.length;
  if (!n) return {
    text: 'No completed requests found.',
    html: `<p style="font-family:monospace;color:#999">No data for ${dateLabel}.</p>`
  };

  // Single-pass classification instead of 6 separate .filter() calls
  const regenReqs = [], noRegenReqs = [], failReqs = [], fbReqs = [], emReqs = [];
  for (const r of reqs) {
    (r.final.regen ? regenReqs : noRegenReqs).push(r);
    if (r.fails?.length) failReqs.push(r);
    if (r.fallback)      fbReqs.push(r);
    if (r.emergency)     emReqs.push(r);
  }

  const tsList = reqs.map(d => d.final.ts).sort();

  const allTotals     = reqs.map(d => d.final.total);
  const noRegenTots   = noRegenReqs.map(d => d.final.total);
  const withRegenTots = regenReqs.map(d => d.final.total);
  const primaryMs     = reqs.filter(d => d.primary).map(d => d.primary.ms);
  const regenMs       = reqs.filter(d => d.regen).map(d => d.regen.ms);
  const fbMs          = fbReqs.map(d => d.fallback.ms);

  // Each array sorted once, all needed percentiles extracted together
  const [allMed, allP95, allP99] = percentiles(allTotals, 50, 95, 99);
  const [nrMed,  nrP95,  nrP99]  = percentiles(noRegenTots, 50, 95, 99);
  const [wrMed,  wrP95]           = percentiles(withRegenTots, 50, 95);
  const [prMed,  prP95,  prP99]  = percentiles(primaryMs, 50, 95, 99);
  const [rgMed,  rgP95]           = percentiles(regenMs, 50, 95);

  const maxAll  = safeMax(allTotals);
  const maxNr   = safeMax(noRegenTots);
  const maxWr   = safeMax(withRegenTots);
  const maxPr   = safeMax(primaryMs);
  const maxRg   = safeMax(regenMs);

  const cacheVals = reqs.filter(d => d.cachePct !== undefined).map(d => d.cachePct);
  const avgCache  = cacheVals.length
    ? (cacheVals.reduce((a, b) => a + b, 0) / cacheVals.length).toFixed(1)
    : 'N/A';
  const hotCount  = cacheVals.filter(v => v >= 80).length;
  const coldCount = cacheVals.filter(v => v === 0).length;

  const clsCounts = {};
  for (const d of reqs) {
    if (!d.classify) continue;
    const k = `sms=${d.classify.sms} email=${d.classify.email}`;
    clsCounts[k] = (clsCounts[k] ?? 0) + 1;
  }
  const clsTotal = Object.values(clsCounts).reduce((a, b) => a + b, 0);

  const hourly = {};
  for (const d of reqs) {
    const h = ctHour(d.final.ts);
    (hourly[h] = hourly[h] ?? []).push(d);
  }

  const models = {};
  for (const d of reqs) {
    if (d.primary?.model) models[d.primary.model] = (models[d.primary.model] ?? 0) + 1;
  }

  const regenPct = (100 * regenReqs.length / n).toFixed(1);
  const compRate = (100 * (n - failReqs.length) / n).toFixed(1);
  const winStart = tsList[0]?.slice(11, 16) + 'Z';
  const winEnd   = tsList[tsList.length - 1]?.slice(11, 16) + 'Z';

  // ── Plain text ─────────────────────────────────────────────
  const lines = [
    `LeadPro Performance Report — ${dateLabel}`,
    `Window: ${tsList[0]?.slice(0,19)}Z → ${tsList[tsList.length-1]?.slice(0,19)}Z`,
    `Requests: ${n}`,
    '',
    '── RELIABILITY ──',
    `  Completion : ${compRate}%  (${failReqs.length} fail events)`,
    `  Regen rate : ${regenPct}%  (${regenReqs.length}/${n})`,
    `  Fallbacks  : ${fbReqs.length}    Emergencies: ${emReqs.length}`,
    '',
    '── LATENCY ──',
    `  All     avg=${avg(allTotals)}ms  med=${allMed}ms  p95=${allP95}ms  p99=${allP99}ms  max=${maxAll}ms`,
    `  No regen avg=${avg(noRegenTots)}ms  p95=${nrP95}ms`,
    `  W/ regen avg=${avg(withRegenTots)}ms  p95=${wrP95}ms`,
    `  PRIMARY  avg=${avg(primaryMs)}ms  p95=${prP95}ms  max=${maxPr}ms`,
    ...(regenMs.length ? [`  REGEN    avg=${avg(regenMs)}ms  p95=${rgP95}ms`] : []),
    ...(fbMs.length    ? [`  FALLBACK avg=${avg(fbMs)}ms`] : []),
    '',
    '── PROMPT CACHE ──',
    `  Avg: ${avgCache}%    Hot(≥80%): ${hotCount}    Cold(0%): ${coldCount}`,
    '',
    ...(clsTotal ? [
      `── CLASSIFY (${clsTotal}) ──`,
      ...Object.entries(clsCounts).sort((a,b)=>b[1]-a[1])
        .map(([k,v]) => `  ${k}: ${v}${k.includes('YES') ? ' → REGEN' : ''}`),
      ''
    ] : []),
    '── HOURLY (CT) ──',
    ...Object.keys(hourly).map(Number).sort((a,b)=>a-b).map(h => {
      const hrs  = hourly[h];
      const tots = hrs.map(d => d.final.total);
      const rg   = hrs.filter(d => d.final.regen).length;
      const fb   = hrs.filter(d => d.fallback).length;
      const [hp95] = percentiles(tots, 95);
      return `  ${String(h).padStart(2,'0')}:xx  ${hrs.length} req  avg=${avg(tots)}ms  p95=${hp95}ms  regen=${rg}(${Math.round(100*rg/hrs.length)}%)${fb?`  fb=${fb}`:''}`;
    }),
    '',
    '── MODELS ──',
    ...Object.entries(models).map(([m, c]) => `  ${m}: ${c}`),
    ...(failReqs.length ? [
      '',
      `── FAILURES (${failReqs.length}) ──`,
      ...failReqs.flatMap(d => d.fails.map(f => `  ${d.final.ts.slice(0,19)}Z  ${f.tier} @ ${f.ms}ms`))
    ] : []),
  ];
  const text = lines.join('\n');

  // ── HTML email ─────────────────────────────────────────────
  const stat = (label, value, color = '#f0f9ff') =>
    `<div style="background:#0d1117;border-radius:4px;padding:12px">
       <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:1px">${label}</div>
       <div style="font-size:22px;font-weight:bold;color:${color};margin-top:3px">${value}</div>
     </div>`;

  const tr = (cells, header = false) =>
    `<tr>${cells.map(c =>
      `<t${header?'h':'d'} style="padding:7px 10px;border-bottom:1px solid #1f2937;${header?'color:#60a5fa;font-size:10px;text-transform:uppercase;letter-spacing:1px':''}">${c}</t${header?'h':'d'}>`
    ).join('')}</tr>`;

  const section = (title, body) =>
    `<div style="background:#111827;border:1px solid #1f2937;border-radius:6px;padding:18px;margin-bottom:14px">
       <h2 style="margin:0 0 14px;font-size:11px;color:#60a5fa;letter-spacing:3px;text-transform:uppercase;border-bottom:1px solid #1f2937;padding-bottom:8px">${title}</h2>
       ${body}
     </div>`;

  const grid = (...items) =>
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${items.join('')}</div>`;

  const table = (headers, rows) =>
    `<table style="width:100%;border-collapse:collapse;font-size:12px">
       ${tr(headers, true)}
       ${rows.join('')}
     </table>`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:'Courier New',monospace;background:#0a0e1a;color:#e2e8f0;margin:0;padding:24px">
<div style="max-width:680px;margin:0 auto">

  <div style="background:linear-gradient(135deg,#1e3a5f,#0f2744);border:1px solid #2d5a8e;border-radius:8px;padding:24px;margin-bottom:20px">
    <div style="font-size:22px;color:#60a5fa;letter-spacing:2px;text-transform:uppercase">LeadPro Daily Report</div>
    <div style="color:#94a3b8;font-size:13px;margin-top:6px">${dateLabel} &nbsp;·&nbsp; ${winStart} – ${winEnd} UTC</div>
  </div>

  ${section('Reliability', grid(
    stat('Total Requests', n),
    stat('Completion Rate', compRate + '%', colorFor(100 - +compRate, 1, 3)),
    stat('Regen Rate', regenPct + '%', colorFor(+regenPct, 15, 25)),
    stat('Fallback Hits', fbReqs.length, fbReqs.length === 0 ? '#34d399' : '#fbbf24')
  ))}

  ${section('Latency', table(
    ['Segment', 'Avg', 'Median', 'P95', 'P99', 'Max'],
    [
      tr(['All requests', avg(allTotals)+'ms', allMed+'ms', allP95+'ms', allP99+'ms', maxAll+'ms']),
      tr(['No regen',     avg(noRegenTots)+'ms', nrMed+'ms', nrP95+'ms', nrP99+'ms', maxNr+'ms']),
      tr(['With regen',   avg(withRegenTots)+'ms', wrMed+'ms', wrP95+'ms', '—', maxWr+'ms']),
      tr(['PRIMARY call', avg(primaryMs)+'ms', prMed+'ms', prP95+'ms', prP99+'ms', maxPr+'ms']),
      ...(regenMs.length ? [tr(['REGEN call', avg(regenMs)+'ms', rgMed+'ms', rgP95+'ms', '—', maxRg+'ms'])] : []),
    ]
  ))}

  ${section('Prompt Cache', grid(
    stat('Avg Hit Rate', avgCache + '%', colorFor(100 - +avgCache, 40, 70)),
    stat('Hot ≥80%', hotCount, '#34d399'),
    stat('Cold 0%', coldCount, coldCount > 10 ? '#fbbf24' : '#94a3b8'),
    stat('Total Logged', cacheVals.length)
  ))}

  ${clsTotal > 0 ? section(`Classify (${clsTotal} logged)`, table(
    ['Type', 'Count', 'Flag'],
    Object.entries(clsCounts).sort((a,b)=>b[1]-a[1]).map(([k, v]) =>
      tr([k, v, k.includes('YES') ? '<span style="color:#fbbf24">→ REGEN</span>' : '—'])
    )
  )) : ''}

  ${section('Hourly Breakdown (CT)', table(
    ['Hour', 'Reqs', 'Avg', 'P95', 'Regen', 'Fallback'],
    Object.keys(hourly).map(Number).sort((a,b)=>a-b).map(h => {
      const hrs  = hourly[h];
      const tots = hrs.map(d => d.final.total);
      const rg   = hrs.filter(d => d.final.regen).length;
      const fb   = hrs.filter(d => d.fallback).length;
      const rgPct = Math.round(100*rg/hrs.length);
      const [hp95] = percentiles(tots, 95);
      return tr([
        `${String(h).padStart(2,'0')}:xx CT`,
        hrs.length,
        avg(tots)+'ms',
        hp95+'ms',
        `<span style="color:${rgPct>25?'#fbbf24':'#34d399'}">${rg} (${rgPct}%)</span>`,
        `<span style="color:${fb>0?'#fbbf24':'#4b5563'}">${fb||'—'}</span>`,
      ]);
    })
  ))}

  ${failReqs.length ? section(`Failures (${failReqs.length})`, table(
    ['Time (UTC)', 'Tier', 'Latency'],
    failReqs.flatMap(d => d.fails.map(f =>
      tr([`<span style="color:#f87171">${d.final.ts.slice(0,19)}Z</span>`, f.tier, f.ms+'ms'])
    ))
  )) : ''}

  <div style="text-align:center;color:#374151;font-size:11px;margin-top:20px">
    LeadPro · Community Auto Group · leadpro-reporter Worker
  </div>
</div>
</body></html>`;

  return { text, html };
}

// ── Email via MailChannels ────────────────────────────────────────────────

async function sendEmail(to, from, subject, text, html) {
  return fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from, name: 'LeadPro Reporter' },
      subject,
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html',  value: html },
      ],
    }),
  });
}

// ── Entry point ───────────────────────────────────────────────────────────

export default {

  async scheduled(event, env, ctx) {
    const ctNow = new Date(Date.now() + CT_OFFSET * 3600 * 1000);
    const yesterday = new Date(ctNow);
    yesterday.setDate(yesterday.getDate() - 1);
    const dateLabel = yesterday.toISOString().slice(0, 10);
    await runReport(env, dateLabel);
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const dateParam = url.searchParams.get('date');
    const send = url.searchParams.get('send') === '1';

    const ctNow = new Date(Date.now() + CT_OFFSET * 3600 * 1000);
    const defaultDate = new Date(ctNow);
    defaultDate.setDate(defaultDate.getDate() - 1);
    const dateLabel = dateParam ?? defaultDate.toISOString().slice(0, 10);

    const { text, html, count } = await runReport(env, dateLabel, send);
    if (!count) return new Response(`No data for ${dateLabel}`, { status: 404 });

    const accept = request.headers.get('Accept') ?? '';
    return new Response(accept.includes('text/plain') ? text : html, {
      headers: { 'Content-Type': accept.includes('text/plain') ? 'text/plain' : 'text/html' }
    });
  }
};

async function runReport(env, dateLabel, sendMail = true) {
  const datePart = dateLabel.replace(/-/g, '');
  const prefix   = `logs/${datePart}/`;
  const keys     = await listObjects(env.LOGS, prefix);

  if (!keys.length) {
    console.log(`No files for ${dateLabel} (prefix: ${prefix})`);
    return { count: 0 };
  }

  // Parallel R2 reads — all files fetched concurrently instead of sequentially
  const chunks    = await Promise.all(keys.map(k => readObject(env.LOGS, k)));
  const allEntries = chunks.flat();
  console.log(`${allEntries.length} raw entries from ${keys.length} files`);

  const reqs  = parseLogs(allEntries);
  const count = reqs.length;
  console.log(`${count} completed requests parsed`);

  const { text, html } = buildReport(reqs, dateLabel);
  const subject = `LeadPro Report — ${dateLabel} (${count} requests)`;

  if (sendMail && env.REPORT_TO && env.REPORT_FROM) {
    const res = await sendEmail(env.REPORT_TO, env.REPORT_FROM, subject, text, html);
    console.log(`Email: ${res.status}`);
  }

  return { text, html, count };
}
