#!/usr/bin/env node
/**
 * Dump a full day of Cloudflare Workers Logs to NDJSON.
 *
 * The dashboard Query Builder caps what it will hand back in one view, so a
 * whole day never fits. This walks the day backwards in pages, using the
 * oldest event of each page as the cursor for the next one, until the window
 * is exhausted.
 *
 *   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
 *   node fetch-worker-logs.mjs --date 2026-09-17 --tz -05:00 \
 *        --service leadpro-proxy --out logs-2026-09-17.ndjson
 *
 * Token needs "Account Analytics: Read" (Workers Observability read).
 */

const API = 'https://api.cloudflare.com/client/v4';
const PAGE_LIMIT = 2000;           // documented max for telemetry/query
const MAX_PAGES  = 500;            // safety stop: 1M events

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token     = process.env.CLOUDFLARE_API_TOKEN;
if (!accountId || !token) {
  console.error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.');
  process.exit(1);
}

const date    = arg('date', new Date().toISOString().slice(0, 10));
const tz      = arg('tz', '-05:00');          // CDT; use -06:00 for CST
const service = arg('service', null);         // client-side filter, optional
const out     = arg('out', `worker-logs-${date}.ndjson`);
const debug   = !!arg('debug', false);
const base    = arg('api', API);

const from = Date.parse(`${date}T00:00:00${tz}`);
const to   = Date.parse(`${date}T23:59:59.999${tz}`);
if (Number.isNaN(from) || Number.isNaN(to)) {
  console.error(`Bad --date/--tz: ${date} ${tz}`);
  process.exit(1);
}

/** Find the events array in the response without hard-coding the envelope. */
function extractEvents(payload) {
  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return null;
    seen.add(node);
    if (Array.isArray(node)) {
      if (node.length && node.every(e => e && typeof e === 'object' && tsOf(e) !== null)) return node;
      for (const child of node) { const hit = walk(child); if (hit) return hit; }
      return null;
    }
    for (const key of ['events', 'result', 'data', 'rows']) {
      if (key in node) { const hit = walk(node[key]); if (hit) return hit; }
    }
    for (const v of Object.values(node)) { const hit = walk(v); if (hit) return hit; }
    return null;
  };
  return walk(payload) || [];
}

/** Event timestamp in epoch ms, wherever the field happens to live. */
function tsOf(e) {
  const raw = e.timestamp ?? e.$metadata?.timestamp ?? e.EventTimestampMs ?? e.time ?? null;
  if (raw === null) return null;
  const n = typeof raw === 'number' ? raw : Date.parse(raw);
  if (Number.isNaN(n)) return null;
  return n < 1e12 ? n * 1000 : n;   // tolerate seconds
}

function idOf(e, ts) {
  return e.$metadata?.id ?? e.id ?? `${ts}:${JSON.stringify(e).length}:${(e.message ?? '').slice(0, 64)}`;
}

function serviceOf(e) {
  return e.$metadata?.service ?? e.ScriptName ?? e.script ?? e.service ?? null;
}

async function queryPage(windowFrom, windowTo) {
  const body = {
    queryId: 'full-day-export',
    view: 'events',
    limit: PAGE_LIMIT,
    dry: false,
    parameters: { datasets: ['cloudflare-workers'] },
    timeframe: { from: windowFrom, to: windowTo }
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${base}/accounts/${accountId}/workers/observability/telemetry/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.status === 429 || res.status >= 500) {
      const wait = 2000 * 2 ** attempt;
      console.error(`  HTTP ${res.status}; retrying in ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
    const json = JSON.parse(text);
    if (debug) console.error(JSON.stringify(json).slice(0, 2000));
    if (json.success === false) throw new Error(`API error: ${JSON.stringify(json.errors)}`);
    return json;
  }
  throw new Error('giving up after 5 attempts');
}

const fs = await import('node:fs');
const sink = fs.createWriteStream(out, { flags: 'w' });
const seenIds = new Set();
let cursor = to, pages = 0, written = 0, skipped = 0;

console.error(`Window ${new Date(from).toISOString()} → ${new Date(to).toISOString()}`);

while (pages < MAX_PAGES) {
  const page = await queryPage(from, cursor);
  const events = extractEvents(page);
  pages++;
  if (!events.length) {
    if (pages === 1) console.error('No events returned — check --debug output and the token scope.');
    break;
  }

  let oldest = cursor;
  let fresh = 0;
  for (const e of events) {
    const ts = tsOf(e);
    if (ts !== null && ts < oldest) oldest = ts;
    const key = idOf(e, ts);
    if (seenIds.has(key)) continue;
    seenIds.add(key);
    fresh++;
    if (service && serviceOf(e) && serviceOf(e) !== service) { skipped++; continue; }
    sink.write(JSON.stringify(e) + '\n');
    written++;
  }

  console.error(`  page ${pages}: ${events.length} events, ${fresh} new, oldest ${new Date(oldest).toISOString()}`);

  if (events.length < PAGE_LIMIT) break;      // window exhausted
  if (fresh === 0) { console.error('  no new events — stopping to avoid a loop'); break; }
  if (oldest <= from) break;
  cursor = oldest - 1;                        // step the window back
}

sink.end();
console.error(`\nWrote ${written} events to ${out}` + (service ? ` (${skipped} from other services filtered out)` : ''));
if (pages >= MAX_PAGES) console.error('Hit the page cap — raise MAX_PAGES if the day is bigger.');
