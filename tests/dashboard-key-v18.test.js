#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('dashboard-key-v18.test.js');
// dashboard v1.8. The director key was written into the page source, and the repo is public with Pages on, so anyone
// could read it. Now: no key in the file; asked once, kept in this browser (localStorage), sent as X-LP-Key (not in the
// URL), and re-asked on a 403. Executes the shipped directorKey + fetchRange with prompt, localStorage and fetch stubbed.
// Placeholder keys only.
//
// Usage: node tests/dashboard-key-v18.test.js <dashboard.html>
const fs = require('fs'), vm = require('vm');
const file = process.argv[2];
if (!file) { console.error('usage: dashboard-key-v18.test.js <dashboard.html>'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const html = fs.readFileSync(file, 'utf8');
const script = (html.match(/<script>([\s\S]*?)<\/script>/g) || []).join('\n');

check('no director key is written in the page (no LPDEV- value, no DIRECTOR_KEY string literal)', () =>
  [/LPDEV-/.test(html), /DIRECTOR_KEY\s*=\s*['"`]/.test(script)], [false, false]);
check('the feedback URL carries no key= parameter', () => /\/feedback\/range\?[^`'"]*key=/.test(script), false);

const a = html.indexOf('const DIRECTOR_KEY_STORE'), b = html.indexOf('\n}\n', html.indexOf('async function fetchRange(')) + 3;
const make = (stored, typed, statusFor) => {
  const mem = new Map(stored ? [['lp_director_key', stored]] : []), asks = [], calls = [];
  const sb = { PROXY: 'https://proxy.invalid', encodeURIComponent, Date, String,
    localStorage: { getItem: (k) => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
    prompt: (q) => { asks.push(q); return typed.shift() || ''; },
    fetch: async (u, o) => { const k = (o && o.headers && o.headers['X-LP-Key']) || ''; calls.push({ u: String(u), k });
      const st = statusFor(k); return { ok: st === 200, status: st, json: async () => ({}) }; } };
  vm.createContext(sb);
  vm.runInContext(html.slice(a, b), sb);
  return { sb, mem, asks, calls };
};
(async () => {
  if (a < 0) { check('(new helper) directorKey is in the page', () => false, true); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(1); }
  const GOOD = 'LP-TESTKEY2', OLD = 'LP-OLDKEY23';
  const ok = (k) => k === GOOD ? 200 : 403;
  let t = make('', [GOOD], ok);
  await acheck('first visit: asked once, the key sent as X-LP-Key and remembered', async () => {
    await vm.runInContext('fetchRange("2026-10-02", "2026-10-02")', t.sb);
    return [t.asks.length, t.calls.map(c => c.k), t.mem.get('lp_director_key'), /key=/.test(t.calls[0].u)]; }, [1, [GOOD], GOOD, false]);
  await acheck('next load: no question, the stored key is used', async () => {
    await vm.runInContext('fetchRange("2026-10-03", "2026-10-03")', t.sb); return [t.asks.length, t.calls[1].k]; }, [1, GOOD]);
  t = make(OLD, [GOOD], ok);
  await acheck('after rotation: the old stored key gets 403 -> asked again, retried with the new one, which is kept', async () => {
    await vm.runInContext('fetchRange("2026-10-02", "2026-10-02")', t.sb);
    return [t.asks.length, t.calls.map(c => c.k), t.mem.get('lp_director_key')]; }, [1, [OLD, GOOD], GOOD]);
  t = make('', [OLD, ''], ok);
  await acheck('a refused key and an empty answer: a clear "director key refused" error, nothing stored', async () => {
    let err = ''; try { await vm.runInContext('fetchRange("2026-10-02", "2026-10-02")', t.sb); } catch (e) { err = e.message; }
    return [err, t.mem.has('lp_director_key')]; }, ['HTTP 403 — director key refused', false]);
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
