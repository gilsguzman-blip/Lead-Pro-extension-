#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('worker-v787.test.js');

/**
 * worker-v787.test.js — proxy v7.87 (Gil, 10/8): the emergency tier is gpt-4.1-mini (non-reasoning, outside the GPT-5/6
 * family), and every tier failure keeps its reason on the perf: row; /perf tallies count them. Runs the SHIPPED fetch
 * handler with the model API stubbed per call index and a virtual clock (the worker-v778 harness), and the shipped
 * _lpFailKind against the reporter v1.24 copy. [new] fails on v7.86; [control] passes on both. Placeholder data only.
 *
 *   usage: worker-v787.test.js <cloudflare-worker.js> [leadpro-reporter.js]
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const PROXY = process.argv[2];
if (!PROXY) { console.error('usage: worker-v787.test.js <cloudflare-worker.js>'); process.exit(2); }
const src = fs.readFileSync(PROXY, 'utf8');

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}


const SENTINEL = '⟦LP_CACHE_BREAKPOINT⟧';
const SYS = 'You are a BDC agent. '.repeat(300) + SENTINEL + '\nPERSONA: agent at the store.\n';
const USER = 'Lead context. '.repeat(400);
const GOOD = JSON.stringify({
  sms: 'Thanks for reaching out on the Accord. It is here and available to see, and I can have everything ready for you when you arrive so the visit is quick.',
  subject: 'Your Accord',
  email: 'Subject: Your Accord\n\nHi there,\n\nThe Accord is here and ready for you to see whenever works. I can have everything staged so the visit is quick.\n\nAgent',
  voicemail: 'Hi, Agent at the store about the Accord. It is here and ready whenever you are.' });
const USAGE = { prompt_tokens: 12000, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 7000, cache_write_tokens: 0 } };

function makeKV() {
  const store = new Map(), puts = [];
  return { store, puts,
    put: (k, v, o) => { puts.push({ k, v, o }); store.set(k, v); return Promise.resolve(); },
    get: (k) => Promise.resolve(store.has(k) ? store.get(k) : null),
    list: () => Promise.resolve({ keys: [], list_complete: true }) };
}

// script: one entry per model call, in order. 'ok' | 'hang' | { status, error } | { fastMs }
function run(script, effort) {
  let vnow = 1758650000000;
  const timers = [], calls = [], logs = [];
  class VDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(vnow); }
    static now() { return vnow; }
  }
  const box = {
    console: { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) },
    Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, Intl,
    AbortController, Promise, Date: VDate, Math, JSON, String, Number, Object, Array, RegExp, Error, crypto,
    // Only the two abort timers in the worker use setTimeout; they fire when the script says so.
    setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cleared = true; },
    caches: { default: { match: () => Promise.resolve(undefined), put: () => Promise.resolve() } },
  };
  box.fetch = (url, o) => {
    const payload = o && o.body ? JSON.parse(o.body) : null;
    const timer = timers[timers.length - 1];
    const step = script[calls.length] || 'ok';
    calls.push({ model: payload && payload.model, timeoutMs: timer ? timer.ms : null, payload });
    const reply = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
    if (step === 'hang') {
      return new Promise((resolve, reject) => {
        o.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
        setImmediate(() => { vnow += timer.ms; timer.fn(); });
      });
    }
    if (step && step.status) { vnow += step.fastMs || 120; return Promise.resolve(reply(step.status, { error: step.error })); }
    vnow += 4000;
    return Promise.resolve(reply(200, { choices: [{ message: { content: GOOD }, finish_reason: 'stop' }], usage: USAGE }));
  };
  box.globalThis = box; box.self = box;
  vm.createContext(box);
  vm.runInContext(src.replace(/^export default\s*\{/m, 'globalThis.__WORKER = {'), box);
  const kv = makeKV(), waits = [];
  const ctx = { waitUntil: (p) => { waits.push(p); if (p && p.catch) p.catch(() => {}); }, passThroughOnException: () => {} };
  const env = { LEADPRO_LICENSES: kv, OPENAI_API_KEY: 'sk-test', REQUIRE_LICENSE: 'false' };
  const req = new Request('https://p.test/', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({
      system_instruction: { parts: [{ text: SYS }] },
      contents: [{ role: 'user', parts: [{ text: USER }] }],
      generationConfig: Object.assign({ temperature: 0.5, maxOutputTokens: 2500, topP: 0.9, responseMimeType: 'application/json' }, effort ? { reasoningEffort: effort } : {}),
    })) });
  return box.__WORKER.fetch(req, env, ctx).then(async (res) => {
    await Promise.all(waits.map(p => Promise.resolve(p).catch(() => {})));
    const out = await res.json();
    const c = out && out.candidates && out.candidates[0];
    return { calls, logs, kv, tier: res.headers.get('X-Tier'), fallback: !!(c && c._fallback), lastError: c && c._lastError };
  });
}
const models = r => r.calls.map(c => c.model);
const sys0 = p => p.messages[0].content;
const shape = p => ({
  cacheOptions: p.prompt_cache_options || null,
  retention: p.prompt_cache_retention || null,
  systemIs: Array.isArray(sys0(p)) ? 'blocks' : typeof sys0(p),
  breakpoint: Array.isArray(sys0(p)) && sys0(p).some(b => b.prompt_cache_breakpoint && b.prompt_cache_breakpoint.mode === 'explicit'),
  sentinelLeft: JSON.stringify(sys0(p)).indexOf('LP_CACHE_BREAKPOINT') > -1,
  effort: p.reasoning_effort || null, verbosity: p.verbosity || null,
  temperature: ('temperature' in p) ? p.temperature : null, maxTokens: p.max_completion_tokens,
});

const REPORTER = process.argv[3] || '';
const perfRow = r => { const p = r.kv.puts.find(x => /^perf:/.test(x.k)); return p ? JSON.parse(p.v) : null; };

(async function () {
  console.log('\n' + path.relative(process.cwd(), PROXY) + ' — proxy v7.87');

  console.log('\n1. the emergency tier (primary 429, fallback 500, emergency answers):');
  {
    const r = await run([{ status: 429, error: { message: 'Rate limit reached for requests' } }, { status: 500, error: { message: 'server had an error' } }, 'ok']);
    check('[new] the tiers are gpt-6-luna -> gpt-5.6-luna -> gpt-4.1-mini', models(r), ['gpt-6-luna', 'gpt-5.6-luna', 'gpt-4.1-mini']);
    const p = r.calls[2].payload;
    check('[new] gpt-4.1-mini is sent as a non-reasoning model: no reasoning_effort, no verbosity, temperature 0.3, 2500 tokens',
      [p.reasoning_effort || null, p.verbosity || null, p.temperature, p.max_completion_tokens], [null, null, 0.3, 2500]);
    check('[control] ...as JSON, with the cache retention field and a plain system string (no breakpoint blocks)',
      [p.response_format && p.response_format.type, p.prompt_cache_retention || null, typeof p.messages[0].content], ['json_object', '24h', 'string']);
    check('[control] its draft is served, not the safe fallback', [r.tier, r.fallback], ['emergency', false]);
    const row = perfRow(r);
    check('[new] the perf: row says why each tier above it failed', row && row.fails,
      [{ tier: 'primary', model: 'gpt-6-luna', ms: 120, status: 429, kind: 'rate_limit' }, { tier: 'fallback', model: 'gpt-5.6-luna', ms: 120, status: 500, kind: 'server_5xx' }]);
    check('[control] ...and the row is still the emergency tier\'s', row && [row.tier, row.model], ['emergency', 'gpt-4.1-mini']);
  }

  console.log('\n2. the reason, for a timeout and when every tier fails:');
  {
    const r = await run(['hang', { status: 400, error: { message: 'Unsupported parameter' } }, { status: 503, error: { message: 'overloaded' } }]);
    const row = perfRow(r);
    check('[new] primary timeout, fallback 400, emergency 503 -> timeout / bad_request / server_5xx, row exhausted',
      row && [row.tier, (row.fails || []).map(f => f.kind)], ['exhausted', ['timeout', 'bad_request', 'server_5xx']]);
    check('[control] the FAIL log line is unchanged (status, arrow, message)', r.logs.some(l => /FALLBACK FAIL gpt-5\.6-luna \d+ms status=400 → Unsupported parameter/.test(l)), true);
    check('[control] no message text is stored on the row', JSON.stringify((row && row.fails) || []).indexOf('Unsupported') < 0, true);
  }
  {
    const r = await run(['ok']);
    check('[control] a request the primary answers carries no fails', 'fails' in (perfRow(r) || {}), false);
  }

  console.log('\n3. /perf tallies:');
  {
    const box = { console: { log() {}, warn() {}, error() {} }, Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, Intl,
      AbortController, Promise, Date, Math, JSON, String, Number, Object, Array, RegExp, Error, Set, Map, crypto, setTimeout, clearTimeout,
      caches: { default: { match: () => Promise.resolve(undefined), put: () => Promise.resolve() } } };
    box.globalThis = box; vm.createContext(box);
    vm.runInContext(src.replace(/^export default\s*\{/m, 'globalThis.__WORKER = {'), box);
    const T = vm.runInContext('_perfTallies', box);
    const t = T([{ tier: 'fallback', contract: 'draft', fails: [{ tier: 'primary', kind: 'rate_limit' }] },
                 { tier: 'exhausted', contract: 'draft', fails: [{ tier: 'primary', kind: 'rate_limit' }, { tier: 'fallback', kind: 'timeout' }, { tier: 'emergency', kind: 'server_5xx' }] },
                 { tier: 'primary', contract: 'draft' }]);
    check('[new] failKinds counts every failure; failKindsByTier splits them', [t.failKinds, t.failKindsByTier],
      [{ rate_limit: 2, timeout: 1, server_5xx: 1 }, { primary: { rate_limit: 2 }, fallback: { timeout: 1 }, emergency: { server_5xx: 1 } }]);
  }

  console.log('\n4. _lpFailKind, and the reporter\'s copy gives the same answers:');
  {
    const box = { RegExp, String, Number }; vm.createContext(box);
    let wk = null, rk = null;
    try { const m = src.match(/function _lpFailKind\([\s\S]*?\n\}/); if (m) wk = vm.runInContext('(' + m[0] + ')', box); } catch (e) {}
    try { if (REPORTER) { const rs = fs.readFileSync(REPORTER, 'utf8'); const m = rs.match(/function _lpFailKind\([\s\S]*?\n\}/); if (m) rk = vm.runInContext('(' + m[0] + ')', box); } } catch (e) {}
    const CASES = [[429, 'Rate limit'], [500, 'x'], [503, 'x'], [400, 'Unsupported parameter'], [401, 'bad key'], [404, 'model_not_found'], [418, 'x'],
      [null, 'Timeout 12000ms'], [null, 'Degenerate field content (finish=stop) [sms: "{"]'], [null, 'Empty response (finish=stop)'],
      [null, 'Unparseable JSON (finish=length, truncated — token budget too low)'], [null, 'Unparseable JSON (finish=stop)'], [null, 'Non-JSON content with STOP finish'], [null, 'fetch failed'], [null, '']];
    const WANT = ['rate_limit', 'server_5xx', 'server_5xx', 'bad_request', 'auth_model', 'auth_model', 'http_other', 'timeout', 'degenerate', 'empty', 'truncated', 'unparseable', 'unparseable', 'network', 'unknown'];
    check('[new] the proxy\'s _lpFailKind', wk ? CASES.map(c => wk(c[0], c[1])) : '(missing)', WANT);
    if (REPORTER) check('[new] the reporter\'s copy agrees on every case', rk ? CASES.map(c => rk(c[0], c[1])) : '(missing)', WANT);
  }

  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
