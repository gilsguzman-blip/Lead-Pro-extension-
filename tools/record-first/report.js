#!/usr/bin/env node
'use strict';
// Side-by-side page for a replay run. Holds real customer drafts: write it outside the repo and never publish it.
// Usage: node tools/record-first/report.js <results.json> <out.html>
const fs = require('fs');
const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: report.js <results.json> <out.html>'); process.exit(2); }
const R = JSON.parse(fs.readFileSync(IN, 'utf8'));
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ct = iso => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT';
const card = (title, sub, text, email, subject) => `
  <div class="col"><div class="h">${esc(title)}<span>${esc(sub || '')}</span></div>
    <div class="lbl">Text</div><pre>${esc(text || '(none)')}</pre>
    <div class="lbl">Email${subject ? ' — ' + esc(subject) : ''}</div><pre>${esc(email || '(none)')}</pre></div>`;
const rows = R.map(r => {
  const d = (r.recordFirst && r.recordFirst.draft) || {}, rd = d.read || {};
  const b = r.baseline || {}, bl = r.latest;
  const read = Object.keys(rd).map(k => `<div><b>${esc(k.replace(/_/g, ' '))}:</b> ${esc(rd[k])}</div>`).join('');
  return `<section>
  <h2>${esc(r.store)} · lead ${esc(r.lead)} <small>${r.recordNotes} notes · ${esc(r.recordSource)} · ${r.captures} capture(s)</small></h2>
  <div class="last"><b>Customer's last message:</b> ${esc(r.lastCustomer || '(none on file)')}</div>
  <div class="grid ${bl ? 'three' : 'two'}">
    ${card('Lead Pro at the time', ct(b.at) + ' · ' + (b.rewrite || ''), b.shipped, b.first && b.first.email, b.first && b.first.subject)}
    ${bl ? card('Lead Pro, latest build on this lead', ct(bl.at) + ' · ' + (bl.rewrite || ''), bl.shipped, bl.first && bl.first.email, bl.first && bl.first.subject) : ''}
    ${card('Record-first', (r.recordFirst ? (r.recordFirst.ms / 1000).toFixed(1) + 's · ' + (r.recordFirst.model || '') : ''), d.sms, d.email, d.subject)}
  </div>
  <details open><summary>What record-first read</summary><div class="read">${read || esc(r.recordFirst && (r.recordFirst.raw || r.recordFirst.error) || '')}</div></details>
</section>`;
}).join('\n');
fs.writeFileSync(OUT, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Record-first replay</title><style>
:root{--bg:#f7f7f5;--card:#fff;--ink:#1d1d1b;--mute:#6b6b66;--line:#e2e1dc;--acc:#2f5d8a}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--card:#1e1e1c;--ink:#ecebe6;--mute:#9a9992;--line:#33332f;--acc:#8db4dc}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;padding:24px 16px}
main{max-width:1280px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}p.sub{color:var(--mute);margin:0 0 24px}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:0 0 20px}
h2{font-size:17px;margin:0 0 8px}h2 small{color:var(--mute);font-weight:400;font-size:13px;margin-left:6px}
.last{background:var(--bg);border-radius:6px;padding:8px 10px;margin:0 0 12px}
.grid{display:grid;gap:12px}.grid.two{grid-template-columns:1fr 1fr}.grid.three{grid-template-columns:1fr 1fr 1fr}
@media (max-width:860px){.grid.two,.grid.three{grid-template-columns:1fr}}
.col{border:1px solid var(--line);border-radius:8px;padding:10px;min-width:0}.col:last-child{border-color:var(--acc)}
.h{font-weight:600;margin-bottom:6px}.h span{display:block;font-weight:400;color:var(--mute);font-size:12px}
.lbl{font-size:12px;color:var(--mute);margin:8px 0 2px;text-transform:uppercase;letter-spacing:.04em}
pre{white-space:pre-wrap;word-wrap:break-word;font:inherit;margin:0}
details{margin-top:10px}summary{cursor:pointer;color:var(--acc)}.read{padding:8px 0 0}.read div{margin:3px 0}
</style></head><body><main><h1>Record-first replay</h1>
<p class="sub">${R.length} saved leads. Left: what Lead Pro produced at the time (the text that shipped and the first-pass email). Right: the record-first prompt on the same notes, same proxy and model, clock set to the capture time. Contains customer data — keep local.</p>
${rows}</main></body></html>`);
console.log('wrote', OUT);
