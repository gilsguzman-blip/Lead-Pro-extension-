/**
 * LeadPro Daily Reporter — Cloudflare Worker
 * Cron: 13:00 UTC daily (8 AM CT)
 * Reads yesterday's Logpush R2 files, analyzes, emails report.
 * Parses native Logpush format (one JSON object per request, Logs array inside)
 * v1.2 — performance optimizations
 * v1.3 — honest feedback metrics: headline is SHIPPED rate (up+weak_up+neutral)/total
 * v1.4 — bare URL defaults to TODAY (live, bookmarkable like the dashboard); ?date= still pins a day;
 *        cron email still covers yesterday. CT_OFFSET replaced with DST-safe America/Chicago time.
 * v1.5 — COMPLETE-DAY reporting: logs are UTC-partitioned but a report is a CENTRAL calendar day,
 *        which straddles UTC midnight. Now reads the target UTC partition AND the next one, then
 *        filters to entries whose CT date matches — so a day no longer smears (carried prior CT
 *        evening, dropped current CT evening). Applies to both the live view and the cron email.
 *        cron email still covers yesterday. CT_OFFSET replaced with DST-safe America/Chicago time.
 *        to match proxy v7.22 + dashboard. A copied-after-regen message ('neutral')
 *        DID ship; the old (up+weak_up)/total made distance/stalled read as a fake
 *        0-4%. Adds First-Try column (sent with no regen) so the real "needed a regen"
 *        signal is visible. byLeadSource/byScenario now keep full rating breakdowns.
 *        Stale "MailChannels" comment corrected to Resend.
 * v1.6 — adds a 👎 Sessions detail table (per down-rated generation: time, store, lead source,
 *        scenario, conv-state, regens, signal) and per-hour Cache hit% + Cold count columns in the
 *        Hourly Breakdown, to diagnose whether cold-cache sessions cluster by hour (expiry) or spread.
 * v1.7 — fixes feedback cross-midnight double-count: the KV feedback read pulls two UTC-adjacent
 *        date prefixes (correct) but counted every entry with no per-entry CT-date check, so a
 *        rating recorded near CT midnight appeared in BOTH days' reports. Now each entry is
 *        filtered by its own true Central calendar day, mirroring the R2/log path's v1.5 fix.
 */

// (v1.4) DST-safe Central Time. Previously CT_OFFSET = -5 was hardcoded (CDT); correct in
// summer but wrong Nov–Mar (CST = -6), drifting the hourly buckets one hour and — near midnight —
// rolling the default report date to the wrong day. Intl with timeZone 'America/Chicago' tracks
// DST automatically (Cloudflare Workers ship full ICU).
const _CT_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
function ctParts(date) {
  const o = {};
  for (const p of _CT_FMT.formatToParts(date)) o[p.type] = p.value;
  return o; // { year, month, day, hour }
}
// YYYY-MM-DD in Central
function ctDateLabel(date) {
  const p = ctParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}
// Yesterday's Central date label (anchored at noon UTC to stay clear of DST/midnight edges)
function ctYesterdayLabel() {
  const today = ctDateLabel(new Date());
  const anchor = new Date(today + 'T12:00:00Z');
  anchor.setUTCDate(anchor.getUTCDate() - 1);
  return anchor.toISOString().slice(0, 10);
}
// HH:MM in Central (for the report window label, which can span UTC midnight)
function ctHM(ts) {
  const p = ctParts(new Date(ts));
  return `${p.hour}:${p.minute}`;
}

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
  try { return parseInt(ctParts(new Date(ts)).hour, 10) % 24; }
  catch { return -1; }
};

const colorFor = (val, good, warn) =>
  val <= good ? '#34d399' : val <= warn ? '#fbbf24' : '#f87171';

// ── Report builder ────────────────────────────────────────────────────────

function buildReport(reqs, dateLabel, feedbackData = null) {
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
  const winStart = tsList[0] ? ctHM(tsList[0]) : '—';
  const winEnd   = tsList[tsList.length - 1] ? ctHM(tsList[tsList.length - 1]) : '—';

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

  // ── Feedback section ──────────────────────────────────────────
  const feedbackHtml = (() => {
    if (!feedbackData || feedbackData.total === 0) {
      return section('Response Quality (Feedback)', '<div style="color:#4b5563;font-size:12px;text-align:center;padding:12px">No feedback signals recorded for this date. Deploy v9.7.135+ to start collecting.</div>');
    }
    const fd = feedbackData;
    // v1.3: headline is the SHIPPED rate (up+weak_up+neutral)/total — copied-after-regen
    // DID ship. Color by first-try lag instead of an absolute threshold, since shipped is
    // almost always high; a low first-try (lots of regens before send) is the real signal.
    const shipped  = fd.shippedRate  != null ? fd.shippedRate  : fd.posRate;
    const firstTry = fd.firstTryRate != null ? fd.firstTryRate : fd.posRate;
    const posColor = shipped >= 90 ? '#34d399' : shipped >= 75 ? '#fbbf24' : '#f87171';

    // Chip frequency top 5
    const topChips = Object.entries(fd.chipFreq || {})
      .sort((a,b) => b[1]-a[1]).slice(0,5)
      .map(([chip, count]) => tr([chip, count, '']))
      .join('');

    // By store — v1.3: shipped rate (up+weak_up+neutral)/total, first-try shown alongside.
    const storeRows = Object.entries(fd.byStore || {})
      .sort((a,b) => b[1].total - a[1].total)
      .map(([store, s]) => {
        const sShipped  = s.total ? Math.round(100 * ((s.up||0)+(s.weak_up||0)+(s.neutral||0)) / s.total) : 0;
        const sFirstTry = s.total ? Math.round(100 * ((s.up||0)+(s.weak_up||0)) / s.total) : 0;
        const col = sShipped >= 90 ? '#34d399' : sShipped >= 75 ? '#fbbf24' : '#f87171';
        const ftCol = sFirstTry < sShipped ? '#94a3b8' : col;
        return tr([
          store.replace('Community ',''),
          s.total,
          `<span style="color:${col}">${sShipped}%</span>`,
          `<span style="color:${ftCol}">${sFirstTry}%</span>`,
          s.down || 0
        ]);
      }).join('');

    // Signal breakdown
    const sigRows = Object.entries(fd.signals || {})
      .filter(([,v]) => v > 0)
      .sort((a,b) => b[1]-a[1])
      .map(([sig, cnt]) => tr([sig.replace(/_/g,' '), cnt, ''])).join('');

    // 👎 sessions — individual down-rated generations (v1.6). No message content in the
    // payload (by design), but store + leadSource + scenario + convState + time is enough to
    // bucket each 👎 by category and check it against when a fix shipped.
    const downRows = (fd.downSessions || [])
      .slice().sort((a,b) => (a.ts||'').localeCompare(b.ts||''))
      .map(d => tr([
        d.ts ? ctHM(d.ts) : '—',
        d.store,
        (d.leadSource || '').replace(/^Hds\s+/i,''),
        d.scenario,
        d.convState || '—',
        d.regenCount,
        (d.signal || '').replace(/_/g,' ')
      ])).join('');

    return section('Response Quality (Feedback)', `
      ${grid(
        stat('Shipped Rate', shipped + '%', posColor),
        stat('First-Try Rate', firstTry + '%', firstTry >= 75 ? '#34d399' : firstTry >= 50 ? '#fbbf24' : '#94a3b8'),
        stat('Explicit 👍', fd.ratings?.up || 0, '#34d399'),
        stat('Explicit 👎', fd.ratings?.down || 0, (fd.ratings?.down || 0) > 5 ? '#f87171' : '#94a3b8')
      )}
      <div style="font-size:10px;color:#4b5563;margin-top:6px">Shipped = copied &amp; sent (incl. after a regen). First-try = sent with no regen.</div>
      <div style="margin-top:12px">
        ${table(['Signal Type', 'Count', ''], [sigRows])}
      </div>
      ${topChips ? `<div style="margin-top:12px">
        <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Top Chips Used</div>
        ${table(['Chip', 'Uses', ''], [topChips])}
      </div>` : ''}
      ${storeRows ? `<div style="margin-top:12px">
        <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">By Store</div>
        ${table(['Store', 'Signals', 'Shipped', '1st-Try', '👎'], [storeRows])}
      </div>` : ''}
      ${downRows ? `<div style="margin-top:12px">
        <div style="font-size:10px;color:#f87171;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">👎 Sessions (${fd.downSessions.length})</div>
        ${table(['Time CT','Store','Lead Source','Scenario','State','Regens','Signal'], [downRows])}
      </div>` : ''}
      <div style="font-size:10px;color:#4b5563;margin-top:8px">
        Avg regens per session: ${fd.avgRegens} &nbsp;·&nbsp; Avg chips per session: ${fd.avgChips}
        &nbsp;·&nbsp; Weak positive (chip helped): ${fd.ratings?.weak_up || 0}
        &nbsp;·&nbsp; Neutral / shipped-after-regen: ${fd.ratings?.neutral || 0}
      </div>
    `);
  })();

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:'Courier New',monospace;background:#0a0e1a;color:#e2e8f0;margin:0;padding:24px">
<div style="max-width:680px;margin:0 auto">

  <div style="background:linear-gradient(135deg,#1e3a5f,#0f2744);border:1px solid #2d5a8e;border-radius:8px;padding:24px;margin-bottom:20px">
    <div style="font-size:22px;color:#60a5fa;letter-spacing:2px;text-transform:uppercase">LeadPro Daily Report</div>
    <div style="color:#94a3b8;font-size:13px;margin-top:6px">${dateLabel} &nbsp;·&nbsp; ${winStart} – ${winEnd} CT</div>
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
    ['Hour', 'Reqs', 'Avg', 'P95', 'Regen', 'Cache', 'Cold', 'Fallback'],
    Object.keys(hourly).map(Number).sort((a,b)=>a-b).map(h => {
      const hrs  = hourly[h];
      const tots = hrs.map(d => d.final.total);
      const rg   = hrs.filter(d => d.final.regen).length;
      const fb   = hrs.filter(d => d.fallback).length;
      const rgPct = Math.round(100*rg/hrs.length);
      const [hp95] = percentiles(tots, 95);
      const cvals = hrs.filter(d => d.cachePct !== undefined).map(d => d.cachePct);
      const cold  = cvals.filter(v => v === 0).length;
      const avgC  = cvals.length ? Math.round(cvals.reduce((a,b)=>a+b,0)/cvals.length) : null;
      const coldPct = cvals.length ? Math.round(100*cold/cvals.length) : 0;
      return tr([
        `${String(h).padStart(2,'0')}:xx CT`,
        hrs.length,
        avg(tots)+'ms',
        hp95+'ms',
        `<span style="color:${rgPct>25?'#fbbf24':'#34d399'}">${rg} (${rgPct}%)</span>`,
        avgC===null ? '<span style="color:#4b5563">—</span>' : `<span style="color:${avgC>=50?'#34d399':avgC>=25?'#fbbf24':'#f87171'}">${avgC}%</span>`,
        `<span style="color:${cvals.length===0?'#4b5563':coldPct>=50?'#f87171':coldPct>0?'#fbbf24':'#34d399'}">${cvals.length?cold:'—'}</span>`,
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

  ${feedbackHtml}

  <div style="text-align:center;color:#374151;font-size:11px;margin-top:20px">
    LeadPro · Community Auto Group · leadpro-reporter Worker
  </div>
</div>
</body></html>`;

  return { text, html };
}

// ── Email via Resend ───────────────────────────────────────────────────────

async function sendEmail(env, to, subject, text, html) {
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: 'LeadPro Reporter <onboarding@resend.dev>',
      to: [to],
      subject,
      text,
      html,
    }),
  });
}

// ── Entry point ───────────────────────────────────────────────────────────

export default {

  async scheduled(event, env, ctx) {
    // Morning email = the prior complete day, in Central.
    const dateLabel = ctYesterdayLabel();
    await runReport(env, dateLabel);
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const dateParam = url.searchParams.get('date');
    const send = url.searchParams.get('send') === '1';

    // (v1.4) Bare URL (no ?date=) now shows TODAY's live, in-progress report — so the link can be
    // bookmarked like the dashboard instead of hand-editing the date each time. An explicit ?date=
    // still pins a specific day; the cron email still covers yesterday.
    const dateLabel = dateParam ?? ctDateLabel(new Date());

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
  // (v1.5) Logs are partitioned by UTC date, but a report is for a CENTRAL calendar day, which
  // straddles the UTC-midnight boundary. CT day D's entries live in TWO UTC partitions: the target
  // UTC date (CT morning/afternoon) and the NEXT UTC date (CT evening, after ~7pm CT). Reading only
  // logs/{D}/ smeared the report across midnight — it carried the PREVIOUS CT evening (UTC D
  // 00:00–05:00) and dropped the CURRENT CT evening (which sits in UTC D+1). Read both partitions
  // and filter to entries whose CT date == D for a clean, complete day. (The feedback read below
  // already crosses midnight the same way.)
  const nextDateLabel = new Date(new Date(dateLabel + 'T00:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
  const nextPart      = nextDateLabel.replace(/-/g, '');
  const [keysA, keysB] = await Promise.all([
    listObjects(env.LOGS, `logs/${datePart}/`),
    listObjects(env.LOGS, `logs/${nextPart}/`),
  ]);
  const keys = [...keysA, ...keysB];

  if (!keys.length) {
    console.log(`No files for ${dateLabel} (prefixes: logs/${datePart}/ + logs/${nextPart}/)`);
    return { count: 0 };
  }

  // Parallel R2 reads — all files fetched concurrently instead of sequentially
  const chunks    = await Promise.all(keys.map(k => readObject(env.LOGS, k)));
  const allEntries = chunks.flat();
  console.log(`${allEntries.length} raw entries from ${keys.length} files (2 UTC partitions)`);

  // Keep only requests whose CENTRAL date matches the report day — drops the prior CT evening that
  // shares the UTC-D partition and includes the current CT evening pulled from UTC D+1.
  let reqs = parseLogs(allEntries).filter(r => {
    const t = (r.final && r.final.ts) || r.ts;
    return t && ctDateLabel(new Date(t)) === dateLabel;
  });
  const count = reqs.length;
  console.log(`${count} completed requests parsed`);

  // Fetch feedback directly from KV — avoids worker-to-worker routing issues.
  // Requires LEADPRO_LICENSES KV bound to this worker (same namespace as proxy).
  let feedbackData = null;
  try {
    if (env.LEADPRO_LICENSES) {
      const aggregate = async (datePrefix) => {
        let cursor;
        const entries = [];
        do {
          const page = await env.LEADPRO_LICENSES.list({ prefix: `feedback:${datePrefix}`, limit: 1000, ...(cursor ? { cursor } : {}) });
          for (const key of page.keys) {
            const val = await env.LEADPRO_LICENSES.get(key.name);
            if (val) { try { entries.push(JSON.parse(val)); } catch {} }
          }
          cursor = page.list_complete ? null : page.cursor;
        } while (cursor);
        return entries;
      };

      const nextDate = new Date(new Date(dateLabel).getTime() + 24*60*60*1000).toISOString().slice(0,10);
      console.log(`[FEEDBACK] querying KV direct for ${dateLabel} and ${nextDate}`);
      const [e1, e2] = await Promise.all([aggregate(dateLabel), aggregate(nextDate)]);
      const beforeFilter = e1.length + e2.length;
      // (v1.7) mirrors the reqs.filter() above — reading two UTC-adjacent KV prefixes isn't
      // enough, each entry needs its own true CT calendar day checked before being counted.
      // Without this, a rating recorded near CT midnight (UTC-dated the next day) shows up in
      // BOTH days' reports. Entries with no timestamp are kept as-is (fail open) rather than
      // dropped, since we can't verify their date either way.
      const entries = [...e1, ...e2].filter(e => !e.ts || ctDateLabel(new Date(e.ts)) === dateLabel);
      console.log(`[FEEDBACK] ${beforeFilter} raw entries -> ${entries.length} after CT-date filter`);

      if (entries.length > 0) {
        const ratings  = { up:0, weak_up:0, neutral:0, down:0 };
        const signals  = { explicit:0, implicit_copy:0, implicit_chip_copy:0, implicit_regen_copy:0, implicit_regen_no_copy:0, implicit_chip_no_copy:0, no_interaction:0 };
        const chipFreq = {}, byStore = {}, byPersona = {}, byLeadSource = {}, byScenario = {};
        const downSessions = [];
        let totalRegens = 0, totalChips = 0;
        for (const e of entries) {
          if (ratings[e.rating]  !== undefined) ratings[e.rating]++;
          if (e.rating === 'down') downSessions.push({
            ts: e.ts || '', signal: e.signal || '', regenCount: e.regenCount || 0,
            store: (e.meta?.store || 'unknown').replace('Community ',''),
            leadSource: e.meta?.leadSource || 'unknown',
            scenario: e.meta?.scenario || 'standard',
            convState: e.meta?.convState || '', persona: e.meta?.persona || ''
          });
          if (signals[e.signal]  !== undefined) signals[e.signal]++;
          totalRegens += e.regenCount || 0;
          totalChips  += e.chipCount  || 0;
          (e.chipsUsed || []).forEach(c => { chipFreq[c] = (chipFreq[c]||0)+1; });
          const store = e.meta?.store || 'unknown';
          if (!byStore[store]) byStore[store] = { up:0,weak_up:0,neutral:0,down:0,total:0 };
          byStore[store].total++;
          if (e.rating) byStore[store][e.rating] = (byStore[store][e.rating]||0)+1;
          const persona = e.meta?.persona || 'unknown';
          if (!byPersona[persona]) byPersona[persona] = { up:0,weak_up:0,neutral:0,down:0,total:0 };
          byPersona[persona].total++;
          if (e.rating) byPersona[persona][e.rating] = (byPersona[persona][e.rating]||0)+1;
          const ls = e.meta?.leadSource || 'unknown';
          if (!byLeadSource[ls]) byLeadSource[ls] = { up:0,weak_up:0,neutral:0,down:0,total:0 };
          byLeadSource[ls].total++;
          if (e.rating) byLeadSource[ls][e.rating] = (byLeadSource[ls][e.rating]||0)+1;
          const sc = e.meta?.scenario || 'unknown';
          if (!byScenario[sc]) byScenario[sc] = { up:0,weak_up:0,neutral:0,down:0,total:0 };
          byScenario[sc].total++;
          if (e.rating) byScenario[sc][e.rating] = (byScenario[sc][e.rating]||0)+1;
        }
        const total = entries.length;
        // v1.3: SHIPPED rate (up+weak_up+neutral)/total is the headline — matches
        // proxy worker v7.22 and the dashboard. A copied-after-regen message ('neutral')
        // DID ship; counting only up+weak_up made flags like distance/stalled read as a
        // fake 0-4% even though the output was used. firstTryRate exposes the real
        // "needed a regen before sending" signal.
        const shipped  = ratings.up + ratings.weak_up + ratings.neutral;
        const firstTry = ratings.up + ratings.weak_up;
        feedbackData = {
          date: dateLabel, total,
          shippedRate:  total ? Math.round(100*shipped/total)  : 0,
          firstTryRate: total ? Math.round(100*firstTry/total) : 0,
          downRate:     total ? Math.round(100*ratings.down/total) : 0,
          // posRate kept as alias of shippedRate for any downstream consumer.
          posRate:      total ? Math.round(100*shipped/total)  : 0,
          ratings, signals, chipFreq, byStore, byPersona, byLeadSource, byScenario,
          downSessions,
          avgRegens: total ? +(totalRegens/total).toFixed(2) : 0,
          avgChips:  total ? +(totalChips/total).toFixed(2)  : 0
        };
      }
    } else {
      console.log('[FEEDBACK] LEADPRO_LICENSES not bound to reporter — add KV binding');
    }
  } catch(e) {
    console.log('Feedback query failed:', e.message);
  }

  const { text, html } = buildReport(reqs, dateLabel, feedbackData);
  const subject = `LeadPro Report — ${dateLabel} (${count} requests)`;

  if (sendMail && env.REPORT_TO && env.RESEND_API_KEY) {
    const res = await sendEmail(env, env.REPORT_TO, subject, text, html);
    console.log(`Email: ${res.status}`);
  }

  return { text, html, count };
}
