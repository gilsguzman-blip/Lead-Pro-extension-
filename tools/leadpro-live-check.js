/**
 * leadpro-live-check.js — Cloudflare Worker. ONE FILE, ONE PASTE, NO EDITS TO THE DATA TOOL.
 *
 * WHAT IT ANSWERS: "what is Lead Pro actually holding right now?" — the question that cost a full
 * day on 9/4 and that no existing surface could answer. The Data Tool's summary table is a receipt
 * for the file you just dropped (incResult is replaced on every Normalize; nothing merges across
 * runs), so a Kia-only upload never appears beside four stores parsed in a different run. And
 * dashboard/index.html has ZERO references to incentives or valuefact — there is no view there at
 * all. This page reads the proxy back, per store.
 *
 * WHY A SEPARATE PAGE RATHER THAN A PATCH TO THE DATA TOOL: the only copy of that tool available
 * here is a browser "Save As" of the rendered page, carrying data-scribe-recorder-ready, a
 * <simplycodes-ui> element and extension CSS injected by the browser. Editing that and handing it
 * back would mean deploying a reconstruction that cannot be verified against the live tool — on the
 * surface that publishes incentives to five rooftops. This changes nothing that already works.
 *
 * REQUIRES PROXY v7.70. v7.69's GET /valuefact projected {store, count, incentives} and dropped
 * `generated`, so every Published cell reads "proxy older than v7.70" until the worker is deployed.
 * That is stated on the page rather than left to look like missing data.
 *
 * DEPLOY (about a minute):
 *   Cloudflare dashboard -> Workers & Pages -> Create -> Worker -> name it (e.g. leadpro-live) ->
 *   Deploy -> Edit code -> select all, paste this file, Deploy. Open the worker URL.
 *   Or, with wrangler:  wrangler deploy tools/leadpro-live-check.js --name leadpro-live
 *
 * NO SECRETS, NO BINDINGS, NO KV. GET /valuefact is unauthenticated and returns incentive lines
 * only — never contact data — so this page needs no license key and holds none. It is a pure
 * read; nothing here can write to KV. The same file also opens straight off disk as .html if you
 * would rather not deploy anything (the proxy sends Access-Control-Allow-Origin: *).
 */

const PROXY_DEFAULT = 'https://leadpro-proxy.gilsguzman.workers.dev';

// Keep in step with the Data Tool's store <select>. Adding a sixth rooftop means one line here.
const STORES = [
  ['6189',  'Toyota Baytown'],
  ['6190',  'Kia Baytown'],
  ['6191',  'Honda Baytown'],
  ['24399', 'Honda Lafayette'],
  ['21135', 'Audi Lafayette'],
];

const PAGE = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lead Pro · What's Live</title>
<style>
  :root{--bg:#0e1420;--panel:#131b2b;--border:#22304a;--text:#dbe4f2;--mut:#7f8ea8;
        --accent:#e0a82e;--ok:#4ec98a;--warn:#e0a82e;--bad:#e06c6c}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);
       font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:28px}
  .wrap{max-width:1000px;margin:0 auto}
  h1{font-size:19px;margin:0 0 2px}
  .sub{color:var(--mut);font-size:12px;margin-bottom:18px}
  .panel{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px}
  .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
  label{font-size:11px;color:var(--mut);letter-spacing:.06em;text-transform:uppercase;display:block;margin-bottom:4px}
  input{background:#0b111c;border:1px solid var(--border);color:var(--text);border-radius:7px;
        padding:8px 10px;font:inherit;font-size:12px;min-width:390px}
  button{background:var(--accent);border:0;color:#1a1206;font:inherit;font-weight:700;
         border-radius:7px;padding:9px 16px;cursor:pointer}
  button:disabled{opacity:.55;cursor:wait}
  .note{margin:12px 0;padding:9px 12px;border-radius:7px;font-size:12px;border:1px solid var(--border)}
  .note.ok{border-color:#1f5d40;color:var(--ok)} .note.warn{border-color:#6b5316;color:var(--warn)}
  .note.bad{border-color:#6b2323;color:var(--bad)}
  table{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}
  th{text-align:left;color:var(--mut);font-weight:600;font-size:11px;letter-spacing:.05em;
     text-transform:uppercase;padding:7px 9px;border-bottom:1px solid var(--border)}
  td{padding:9px;border-bottom:1px solid var(--border);vertical-align:top}
  td.num{text-align:right;font-variant-numeric:tabular-nums}
  .store{font-weight:600}
  .did{color:var(--mut);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
  .good{color:var(--ok)} .stale{color:var(--warn)} .bad{color:var(--bad)}
  .models{color:var(--mut);font-size:11px;line-height:1.7}
  .foot{color:var(--mut);font-size:11px;margin-top:18px}
  code{background:#0b111c;padding:1px 5px;border-radius:4px;font-size:11px}
</style></head><body>
<div class="wrap">
  <h1>What Lead Pro is holding right now</h1>
  <div class="sub">Read back from the proxy — not from the last file you uploaded.</div>
  <div class="panel">
    <div class="row">
      <div style="flex:1">
        <label>Proxy endpoint</label>
        <input id="ep" value="__PROXY__">
      </div>
      <div style="align-self:flex-end"><button id="go">Check what's live</button></div>
    </div>
    <div id="msg"></div>
    <div id="out"></div>
  </div>
  <div class="foot">
    Reads <code>GET /valuefact?dealer=…</code> once per rooftop. No license key: that route is
    unauthenticated and returns incentive lines only, never contact data. This page cannot write.<br>
    <b>Published</b> needs proxy <b>v7.70</b> — v7.69 dropped <code>generated</code> from the
    response, which is why a store's age was previously unknowable from outside.
  </div>
</div>
<script>
const STORES = __STORES__;
const $ = id => document.getElementById(id);
function note(t, cls){ $('msg').innerHTML = t ? '<div class="note ' + (cls||'') + '">' + t + '</div>' : ''; }

function baseOf(v){ return String(v||'').trim().replace(/\\/valuefact\\/?$/,'').replace(/\\/+$/,''); }

// Format "now" directly in America/Chicago. en-CA gives YYYY-MM-DD natively. Never round-trip
// through UTC to get a local date — see the note at the one call site.
function centralToday(){
  return new Intl.DateTimeFormat('en-CA', { timeZone:'America/Chicago',
    year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
}

async function readStore(base, did, name){
  try{
    const r = await fetch(base + '/valuefact?dealer=' + encodeURIComponent(did));
    if(!r.ok) return { did, name, state:'error', detail:'HTTP ' + r.status };
    const j = await r.json();
    const vf = j && j.valuefact;
    if(!vf) return { did, name, state:'empty' };
    const inc = Array.isArray(vf.incentives) ? vf.incentives : [];
    const models = {};
    inc.forEach(function(x){ const m = (x && x.model) || '(unnamed)'; models[m] = (models[m]||0)+1; });
    return {
      did, name,
      state: inc.length ? 'live' : 'lapsed',
      live: inc.length,
      // storedCount arrives from v7.70. null on an older proxy — reported as unknown, not as 0,
      // because "we don't know" and "there are none" are the two states this page exists to separate.
      stored: (typeof vf.storedCount === 'number') ? vf.storedCount : null,
      generated: vf.generated || null,
      models
    };
  }catch(e){ return { did, name, state:'error', detail:String((e && e.message) || e) }; }
}

function render(rows){
  const cell = r => {
    if(r.state === 'error') return '<span class="bad">unreachable</span>';
    if(r.state === 'empty') return '<span class="bad">nothing published</span>';
    if(r.state === 'lapsed') return '<span class="stale">0 — all lapsed</span>';
    return '<span class="good">' + r.live + '</span>';
  };
  // centralToday(), NOT new Date().toISOString() — .toISOString() always converts to UTC first, so
  // after ~7 PM Central "today" is already tomorrow and the afternoon's own upload renders stale.
  // The dashboard was fixed for exactly this in v1.0 (Gil caught it rolling over at 7:55 PM).
  const today = centralToday();
  const body = rows.map(function(r){
    const stale = r.generated && r.generated < today;
    return '<tr>'
      + '<td class="store">' + r.name + '</td>'
      + '<td class="did">' + r.did + '</td>'
      + '<td class="num">' + cell(r) + '</td>'
      + '<td class="num">' + (r.stored == null ? '<span class="mut">—</span>' : r.stored) + '</td>'
      + '<td>' + (r.generated
          ? '<span class="' + (stale ? 'stale' : 'good') + '">' + r.generated + '</span>'
          : '<span class="stale">— proxy older than v7.70</span>') + '</td>'
      + '<td class="models">' + (r.models && Object.keys(r.models).length
          ? Object.keys(r.models).map(function(m){ return m + ':' + r.models[m]; }).join(' · ')
          : (r.detail || '—')) + '</td>'
      + '</tr>';
  }).join('');
  $('out').innerHTML =
    '<table><thead><tr><th>Store</th><th>Dealer ID</th><th style="text-align:right">Live lines</th>'
    + '<th style="text-align:right">Stored</th><th>Published</th><th>Models</th></tr></thead>'
    + '<tbody>' + body + '</tbody></table>';
}

async function run(){
  const base = baseOf($('ep').value);
  if(!base){ note('Endpoint is empty.', 'bad'); return; }
  $('go').disabled = true; note('Checking ' + STORES.length + ' rooftops…');
  const rows = [];
  for(const s of STORES) rows.push(await readStore(base, s[0], s[1]));
  render(rows);
  const empty  = rows.filter(function(r){ return r.state === 'empty';  }).length;
  const lapsed = rows.filter(function(r){ return r.state === 'lapsed'; }).length;
  const errs   = rows.filter(function(r){ return r.state === 'error';  }).length;
  // Three states, deliberately named separately — before v7.70 they were indistinguishable from
  // outside, which is the whole reason "is Kia in there?" took a day to answer.
  if(errs)        note(errs + ' rooftop(s) unreachable — check the endpoint.', 'bad');
  else if(empty)  note(empty + ' rooftop(s) have NOTHING published to Lead Pro.', 'bad');
  else if(lapsed) note(lapsed + ' rooftop(s) published but every line has lapsed — re-publish those.', 'warn');
  else            note('All ' + rows.length + ' rooftops published and live.', 'ok');
  $('go').disabled = false;
}

$('go').addEventListener('click', run);
run();
</script></body></html>`;

function html() {
  return PAGE.replace('__PROXY__', PROXY_DEFAULT)
             .replace('__STORES__', JSON.stringify(STORES));
}

export default {
  async fetch() {
    return new Response(html(), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }
};

// Also usable without Cloudflare: `node tools/leadpro-live-check.js > live.html` and open the file.
if (typeof process !== 'undefined' && process.argv && process.argv[1] &&
    process.argv[1].endsWith('leadpro-live-check.js')) {
  console.log(html());
}
