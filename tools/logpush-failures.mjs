#!/usr/bin/env node
/**
 * Break down proxy failures from Logpush NDJSON already archived in R2.
 *
 * The reporter reads the same files (env.LOGS, logs/YYYYMMDD/) but its RE_FAIL
 * keeps only tier and latency — the model, the FAIL/ERROR distinction and
 * everything after the ms are dropped before the report is built. This reads
 * the raw lines instead, so whatever the proxy actually emits survives.
 *
 *   node tools/logpush-failures.mjs day.ndjson --date 2026-09-17
 *
 * A Central day straddles two UTC partitions, so pass both partitions'
 * contents concatenated and let --date filter to the CT day (same rule the
 * reporter applies in runReport).
 */

import fs from 'node:fs';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const flag = n => { const i = args.indexOf(`--${n}`); return i === -1 ? null : args[i + 1]; };
if (!file) {
  console.error('usage: logpush-failures.mjs <logs.ndjson> [--date YYYY-MM-DD] [--raw]');
  process.exit(1);
}
const wantDate = flag('date');
const rawOnly  = args.includes('--raw');

const CT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false
});
const ctParts = d => Object.fromEntries(CT.formatToParts(d).map(p => [p.type, p.value]));
const ctDate  = d => { const p = ctParts(d); return `${p.year}-${p.month}-${p.day}`; };
const ctHM    = d => { const p = ctParts(d); return `${p.hour}:${p.minute}`; };

// Same anchors the reporter uses, but nothing after the ms is thrown away.
const RE_FAIL  = /(PRIMARY|FALLBACK|EMERGENCY)\s+(FAIL|ERROR)\s+(\S+)\s+(\d+)ms\s*(.*)$/;
const RE_FINAL = /FINAL total=(\d+)ms regenerated=(true|false)/;

const fails = [];
let entries = 0, withLogs = 0, requests = 0, nonOk = 0;

for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t) continue;
  let e; try { e = JSON.parse(t); } catch { continue; }
  entries++;

  const logs = e.Logs ?? e.logs ?? null;
  if (!logs) continue;
  withLogs++;

  const tsMs    = e.EventTimestampMs ?? e.eventTimestampMs ?? 0;
  const when    = tsMs ? new Date(tsMs) : null;
  const outcome = e.Outcome ?? e.outcome ?? '';
  const script  = e.ScriptName ?? e.scriptName ?? '';
  if (wantDate && when && ctDate(when) !== wantDate) continue;
  if (outcome && outcome !== 'ok') nonOk++;

  let isRequest = false;
  for (const log of logs) {
    const msg = Array.isArray(log.Message) ? log.Message.join(' ') : (log.message ?? '');
    if (RE_FINAL.test(msg)) isRequest = true;
    const m = msg.match(RE_FAIL);
    if (!m) continue;
    fails.push({
      when: log.TimestampMs ? new Date(log.TimestampMs) : when,
      tier: m[1], kind: m[2], model: m[3], ms: +m[4],
      detail: (m[5] || '').trim(),
      outcome, script, raw: msg
    });
  }
  if (isRequest) requests++;
}

if (rawOnly) {
  for (const f of fails) console.log(f.raw);
  process.exit(0);
}

const pct = (a, b) => b ? ((100 * a) / b).toFixed(2) + '%' : '—';

console.log(`entries ${entries} · with logs ${withLogs} · completed requests ${requests}` +
            (nonOk ? ` · non-ok outcomes ${nonOk}` : ''));
console.log(`fail events ${fails.length} across ${new Set(fails.map(f => f.when?.getTime())).size} distinct timestamps`);

if (!fails.length) {
  console.log('\nNo PRIMARY/FALLBACK/EMERGENCY FAIL or ERROR lines matched.');
  process.exit(0);
}

const withDetail = fails.filter(f => f.detail);
console.log(`\n=== does the cause survive? ===`);
console.log(`${withDetail.length} of ${fails.length} fail lines carry text after the ms (${pct(withDetail.length, fails.length)})`);
if (!withDetail.length) {
  console.log('→ The proxy is not emitting a reason. Fixing the reporter alone will not');
  console.log('  recover it; the proxy has to log it first.');
} else {
  console.log('→ The cause is already in R2. The reporter is discarding it at RE_FAIL.');
}

const tally = (label, keyFn) => {
  console.log(`\n--- ${label} ---`);
  const m = new Map();
  for (const f of fails) { const k = keyFn(f); m.set(k, (m.get(k) || 0) + 1); }
  for (const [k, v] of [...m].sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(5), k);
};

tally('by tier and kind', f => `${f.tier} ${f.kind}`);
tally('by model',         f => f.model);
if (withDetail.length) tally('by cause (digits collapsed)', f => f.detail.replace(/\d{3,}/g, 'N').slice(0, 110) || '(none)');
tally('by CT hour',       f => (f.when ? ctHM(f.when).slice(0, 2) : '??') + ':xx');

console.log('\n--- every fail event, chronological ---');
for (const f of [...fails].sort((a, b) => (a.when ?? 0) - (b.when ?? 0))) {
  console.log([
    f.when ? f.when.toISOString().slice(0, 19) + 'Z' : '—',
    f.when ? ctHM(f.when) + ' CT' : '—',
    f.tier, f.kind, f.model, f.ms + 'ms',
    f.detail || '(no detail logged)'
  ].join('\t'));
}
