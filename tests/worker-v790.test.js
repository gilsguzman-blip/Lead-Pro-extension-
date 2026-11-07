#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('worker-v790.test.js');
/**
 * worker-v790.test.js — proxy v7.90: GET /clickpath reads a store site's Dealer eProcess click-path page and returns its sessions,
 * never the page. Honda Lafayette lead 2106212974: "still on the lot?" with no vehicle on the lead; the click path showed the new
 * Accord Sedan search page right before the inquiry. Runs the SHIPPED handler with fetch stubbed to serve a placeholder page.
 * [new] fails on v7.89 (no route). Placeholder data only.
 *
 *   usage: worker-v790.test.js <cloudflare-worker.js>
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const CP = require('./helpers/clickpath-page.js');
const PROXY = process.argv[2];
if (!PROXY) { console.error('usage: worker-v790.test.js <cloudflare-worker.js>'); process.exit(2); }
const src = fs.readFileSync(PROXY, 'utf8');
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
function load(serve) {
  const asked = [];
  const box = { console: { log() {}, warn() {}, error() {} }, Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, Intl, AbortController, Promise, Date, Math, JSON,
    String, Number, Object, Array, RegExp, Error, Set, Map, crypto, setTimeout, clearTimeout, caches: { default: { match: () => Promise.resolve(undefined), put: () => Promise.resolve() } } };
  box.fetch = (url, o) => { asked.push({ url: String(url), redirect: o && o.redirect }); return Promise.resolve(serve(String(url))); };
  box.globalThis = box; vm.createContext(box);
  vm.runInContext(src.replace(/^export default\s*\{/m, 'globalThis.__WORKER = {'), box);
  return { box, asked };
}
const ask = async (w, u) => {
  const r = await w.box.__WORKER.fetch(new Request('https://proxy.example.test/clickpath?u=' + encodeURIComponent(u)), {}, { waitUntil() {} });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, j };
};
(async function () {
  console.log('\n' + path.relative(process.cwd(), PROXY) + ' — proxy v7.90');
  const ok = load(() => new Response(CP.page(), { status: 200, headers: { 'content-type': 'text/html' } }));
  const r = await ask(ok, CP.URL);
  check('[new] the click path is read: three sessions, the one for this lead marked current', r.j && r.j.ok && [r.j.lead, r.j.sessions.length, r.j.sessions.map(s => s.current)], ['100000002', 3, [false, true, false]]);
  const cur = r.j && r.j.sessions && r.j.sessions[1];
  check('[new] this lead\'s session: the new Accord Sedan search page, as a model', cur && [cur.date, cur.leads, cur.vehicles], ['Tuesday, October 27, 2026', ['100000002'], [{ kind: 'model', name: 'New Honda Accord Sedan', dwell: '3m 14s' }]]);
  const first = r.j && r.j.sessions && r.j.sessions[0];
  check('[new] a vehicle details page is a unit with its stock number, the make put after the year', first && first.vehicles, [{ kind: 'unit', name: 'New 2027 Honda HR-V', stock: 'TEST001A', dwell: '2m 13s' }]);
  check('[new] the page is never returned -- only the parsed sessions; pages carry a path, not a full link', r.j && [JSON.stringify(r.j).indexOf('<div') < 0, /^\/search\//.test(cur.pages[1].path)], [true, true]);
  check('[new] fetched with redirects refused', ok.asked[0] && ok.asked[0].redirect, 'manual');

  const none = load(() => { throw new Error('should not fetch'); });
  const refused = [];
  for (const u of ['http://www.example-honda.com/resrc/leadinfo/clickpath/100000002', 'https://www.example-honda.com/admin/', 'https://www.example-honda.com/resrc/leadinfo/clickpath/100000002?x=1',
    'https://10.0.0.1/resrc/leadinfo/clickpath/100000002', 'https://internal.example-honda.com/resrc/leadinfo/clickpath/100000002', 'https://www.example-honda.com:8443/resrc/leadinfo/clickpath/100000002', 'not a url']) {
    refused.push((await ask(none, u)).status);
  }
  check('[new] refused without a fetch: http, another path, a query, an IP, a deeper host, a port, junk', [refused, none.asked.length], [[400, 400, 400, 400, 400, 400, 400], 0]);
  const redir = load(() => new Response('', { status: 302, headers: { location: 'https://elsewhere.example.test/' } }));
  check('[new] a redirect is not followed: ok false with its status', (await ask(redir, CP.URL)).j, { ok: false, status: 302 });
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
