#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('worker-v778.test.js');

/**
 * worker-v778.test.js — proxy v7.78: the cascade moved down one rung (Gil, 9/23).
 *   primary gpt-6-luna, fallback gpt-5.6-luna, emergency gpt-5.4-nano; classifier unchanged.
 *
 * Runs the SHIPPED fetch handler. The model API is stubbed per CALL INDEX (call 0, 1, 2 — not per
 * model name), so the same script means the same thing against v7.77 and the comparison is honest.
 * The clock is virtual: a "hang" advances it by exactly the timeout the worker armed and fires the
 * abort, so the budget arithmetic runs for real in milliseconds of wall time.
 *
 * Every assertion is labelled. [new] fails on v7.77; [control] is unchanged behaviour and passes on
 * both, which is the point of it.
 *
 *   usage: worker-v778.test.js <cloudflare-worker.js>
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const PROXY = process.argv[2];
if (!PROXY) { console.error('usage: worker-v778.test.js <cloudflare-worker.js>'); process.exit(2); }
const src = fs.readFileSync(PROXY, 'utf8');

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

const NANO = 'gpt-5.4-nano-2026-03-17';
const SENTINEL = '⟦LP_CACHE_BREAKPOINT⟧';
const SYS = 'You are a BDC agent. '.repeat(300) + SENTINEL + '\nPERSONA: agent at the store.\n';
const USER = 'Lead context. '.repeat(400);
const GOOD = JSON.stringify({
  sms: 'Thanks for reaching out on the Accord. It is here and available to see, and I can have everything ready for you when you arrive so the visit is quick.',
  subject: 'Your Accord',
  email: 'Subject: Your Accord\n\nHi there,\n\nThe Accord is here and ready for you to see whenever works. I can have everything staged so the visit is quick.\n\nJolette',
  voicemail: 'Hi, Jolette at the store about the Accord. It is here and ready whenever you are.' });
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

(async function () {
  console.log('\n' + path.relative(process.cwd(), PROXY) + ' — proxy v7.78, the cascade one rung down');

  console.log('\n1. the order, under the worst case (primary and fallback both time out):');
  {
    const r = await run(['hang', 'hang', 'ok']);
    check('[new] the tiers are gpt-6-luna → gpt-5.6-luna → gpt-5.4-nano', models(r), ['gpt-6-luna', 'gpt-5.6-luna', NANO]);
    check('[control] the timeouts are 12000 → 8000 → 3700: the 24000ms budget still reaches all three tiers',
      r.calls.map(c => c.timeoutMs), [12000, 8000, 3700]);
    check('[control] ...and the emergency tier\'s draft is served, not the safe fallback', [r.tier, r.fallback], ['emergency', false]);
    check('[new] the log names the model that answered', r.logs.some(l => /EMERGENCY OK gpt-5\.4-nano-2026-03-17 /.test(l)), true);
  }

  console.log('\n2. the ordinary request — one call, to GPT-6 Luna:');
  {
    const r = await run(['ok']);
    check('[new] exactly one call, to gpt-6-luna, answered on the primary tier', [models(r), r.tier], [['gpt-6-luna'], 'primary']);
    // (v7.79) effort left out of this shape: from v7.79 a full draft with no requested effort goes to
    // gpt-6-luna at 'none' by design (its draftEffort). worker-v779.test.js pins that.
    check('[control] its payload has the shape 5.6 Luna had as primary: breakpoint at the sentinel, mode explicit + ttl 30m, no legacy retention, verbosity low, no temperature, 3500 tokens',
      (({ effort, ...rest }) => rest)(shape(r.calls[0].payload)),
      { cacheOptions: { mode: 'explicit', ttl: '30m' }, retention: null, systemIs: 'blocks', breakpoint: true, sentinelLeft: false,
        verbosity: 'low', temperature: null, maxTokens: 3500 });
    const perf = r.kv.puts.filter(p => /^perf:/.test(p.k)).map(p => JSON.parse(p.v));
    check('[new] the perf: row records gpt-6-luna on the primary tier', perf.map(p => [p.tier, p.model]), [['primary', 'gpt-6-luna']]);
  }

  console.log('\n3. each recovery tier gets the fields its model accepts:');
  {
    const r = await run([{ status: 500, error: { message: 'server error' } }, { status: 500, error: { message: 'server error' } }, 'ok']);
    check('[new] fallback (5.6 Luna) keeps its breakpoint and prompt_cache_options — never the retention field it deprecated',
      shape(r.calls[1].payload),
      { cacheOptions: { mode: 'explicit', ttl: '30m' }, retention: null, systemIs: 'blocks', breakpoint: true, sentinelLeft: false,
        effort: 'low', verbosity: 'low', temperature: null, maxTokens: 3500 });
    check('[new] emergency (5.4-nano) gets prompt_cache_retention, a plain system string with the sentinel stripped, effort low, no temperature, 3500 tokens',
      shape(r.calls[2].payload),
      { cacheOptions: null, retention: '24h', systemIs: 'string', breakpoint: false, sentinelLeft: false,
        effort: 'low', verbosity: 'low', temperature: null, maxTokens: 3500 });
    check('[new] after two FAST failures the emergency tier gets its own 8000ms cap (was 5000 for 4.1-nano)',
      r.calls.map(c => c.timeoutMs), [12000, 8000, 8000]);
    check('[control] and it answers', [r.tier, r.fallback], ['emergency', false]);
  }

  console.log('\n4. effort, per tier:');
  {
    const r = await run(['hang', 'hang', 'ok'], 'high');
    check('[new] a regen at "high" gets ONE high attempt on gpt-6-luna with the 18000ms escalated budget; 5.6 Luna recovers at low',
      r.calls.map(c => [c.model, c.payload.reasoning_effort, c.timeoutMs]), [['gpt-6-luna', 'high', 18000], ['gpt-5.6-luna', 'low', 5700]]);
    check('[control] ...and the emergency tier is squeezed out, the v7.64 trade, stated in the error',
      [r.fallback, /Budget exhausted before emergency/.test(r.lastError || '')], [true, true]);
  }
  {
    const r = await run([{ status: 500, error: { message: 'x' } }, { status: 500, error: { message: 'x' } }, 'ok'], 'none');
    check('[new] a probe\'s "none" reaches all three tiers — 5.4-nano takes it (4.1-nano took no effort at all)',
      r.calls.map(c => c.payload.reasoning_effort || null), ['none', 'none', 'none']);
  }

  console.log('\n5. a model the project cannot use does not end the cascade:');
  {
    const r = await run([{ status: 404, error: { code: 'model_not_found', message: 'The model `gpt-6-luna` does not exist or you do not have access to it.' } }, 'ok']);
    check('[new] a 404 model_not_found on the primary moves on to the fallback, which answers',
      [r.calls.length, r.tier, r.fallback], [2, 'fallback', false]);
    check('[control] ...and the FAIL line still names the status', r.logs.some(l => /PRIMARY FAIL \S+ \d+ms status=404/.test(l)), true);
  }
  {
    const r = await run([{ status: 403, error: { message: 'You are not allowed to sample from this model' } }, 'ok']);
    check('[new] a 403 naming the model moves on too', [r.calls.length, r.tier], [2, 'fallback']);
  }
  {
    const r = await run([{ status: 401, error: { code: 'invalid_api_key', message: 'Incorrect API key provided: sk-test.' } }, 'ok']);
    check('[control] a bad API key (401) still stops at once — every tier shares the key', [r.calls.length, r.fallback], [1, true]);
  }
  {
    const r = await run([{ status: 404, error: { message: 'Invalid URL (POST /v1/chat/completion)' } }, 'ok']);
    check('[control] a 404 that is not about the model (a bad endpoint) still stops at once', [r.calls.length, r.fallback], [1, true]);
  }
  {
    const r = await run([{ status: 429, error: { message: 'Rate limit reached for gpt-6-luna' } }, 'ok']);
    check('[control] a 429 was never fatal and still is not', [r.calls.length, r.tier], [2, 'fallback']);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL harness: ' + (e && e.stack || e)); process.exit(1); });
