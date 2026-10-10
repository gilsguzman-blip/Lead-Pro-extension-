#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('feedback-gatherer-v15.test.js');
// Feedback Gatherer v1.5. v1.3/v1.4 called a same-origin Pages Function (/api) that injected a DIRECTOR_KEY
// secret; after the key was rotated, the upload-only Pages project could not be redeployed to pick up the new
// secret, so every gather got 403. Now: no key in the file and no Function. The page calls the worker named in
// the Worker URL field, asks for the director key once, keeps it in this browser (localStorage), sends it as
// X-LP-Key (never in the URL), and re-asks once on a 403. Executes the shipped page script with document,
// prompt, localStorage and fetch stubbed. Placeholder keys only.
//
// Usage: node tests/feedback-gatherer-v15.test.js <tools/feedback-gatherer/index.html>
const fs = require('fs'), vm = require('vm');
const file = process.argv[2];
if (!file) { console.error('usage: feedback-gatherer-v15.test.js <index.html>'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const html = fs.readFileSync(file, 'utf8');
const script = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';

check('no key is written in the page (no LPDEV- / LP- key value)', () => /LPDEV-|\bLP-[A-Z0-9]{6,}/.test(html), false);
check('no same-origin /api base (the Pages Function is gone)', () => /const\s+base\s*=\s*['"`]\/api/.test(script), false);
check('the drafts URL carries no key= parameter', () => /\/feedback\/drafts\?[^`'"]*key=/.test(script), false);

const WORKER = 'https://proxy.invalid/';
const make = (stored, typed, statusFor) => {
  const els = {}, statuses = [];
  const el = (id) => els[id] || (els[id] = { id, value: id === 'worker' ? WORKER : '', disabled: false, innerHTML: '', textContent: '',
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, querySelectorAll: () => [] });
  const mem = new Map(stored ? [['lp_director_key', stored]] : []), asks = [], calls = [];
  const sb = { Intl, Date, String, JSON, Set, Map, Math, Number, Array, Object, Error, console: { log() {}, warn() {}, error() {} },
    document: { getElementById: el, querySelectorAll: () => [], querySelector: () => null, createElement: () => el('_tmp'), addEventListener() {}, body: el('_body') },
    window: {}, navigator: { clipboard: { writeText: async () => {} } }, setTimeout, clearTimeout,
    localStorage: { getItem: (k) => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
    prompt: (q) => { asks.push(q); return typed.shift() || ''; },
    fetch: async (u, o) => { const k = (o && o.headers && o.headers['X-LP-Key']) || ''; calls.push({ u: String(u), k });
      const st = statusFor(k);
      return { ok: st === 200, status: st, headers: { get: () => 'application/json' }, text: async () => '{}',
        json: async () => ({ rows: [{ id: 'r-' + calls.length, ts: '2026-10-05T15:00:00Z' }] }) }; } };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(script, sb);
  // The filter/render helpers draw the result table; stub them so only the fetch path is exercised.
  vm.runInContext('buildFilters=function(){}; applyFilters=function(){}; setStatus=function(m,e){ __st.push([String(m), !!e]); };', Object.assign(sb, { __st: statuses }));
  els.from.value = '2026-10-05'; els.to.value = '2026-10-05';
  return { sb, mem, asks, calls, statuses, els };
};
const run = (t) => vm.runInContext('gather()', t.sb);
const last = (t) => t.statuses[t.statuses.length - 1] || ['', false];
(async () => {
  if (!/function directorKey\(/.test(script)) { check('(new helper) directorKey is in the page', () => false, true); console.log('\nFAILED — ' + pass + ' passed, ' + fail + ' failed'); process.exit(1); }
  const GOOD = 'LP-TESTKEY2', OLD = 'LP-OLDKEY23';
  const ok = (k) => k === GOOD ? 200 : 403;
  let t = make('', [GOOD], ok);
  await acheck('first visit: asked once, the worker URL field is used, the key goes as X-LP-Key and is remembered', async () => {
    await run(t);
    return [t.asks.length, t.calls.map(c => c.u), t.calls.map(c => c.k), t.mem.get('lp_director_key'), /^Gathered 1 pair/.test(last(t)[0])]; },
    [1, ['https://proxy.invalid/feedback/drafts?date=2026-10-05'], [GOOD], GOOD, true]);
  await acheck('next gather: no question, the stored key is used', async () => {
    await run(t); return [t.asks.length, t.calls[1].k]; }, [1, GOOD]);
  t = make(OLD, [GOOD], ok);
  await acheck('after rotation: the old stored key gets 403 -> asked again, retried with the new one, which is kept', async () => {
    await run(t); return [t.asks.length, t.calls.map(c => c.k), t.mem.get('lp_director_key'), /^Gathered 1 pair/.test(last(t)[0])]; },
    [1, [OLD, GOOD], GOOD, true]);
  t = make('', [OLD, OLD], ok);
  await acheck('a key refused twice: a clear "refused" error shown, no third request', async () => {
    await run(t); return [t.calls.length, last(t)[1], /director key was refused/.test(last(t)[0])]; }, [2, true, true]);
  t = make('', [''], ok);
  await acheck('no key entered: nothing is fetched and the page says a key is needed', async () => {
    await run(t); return [t.calls.length, last(t)[1], /director key is needed/.test(last(t)[0]), t.mem.has('lp_director_key')]; }, [0, true, true, false]);
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
