#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('worker-v780.test.js');

/**
 * worker-v780.test.js — proxy v7.80: /perf draftsByEffort counts FULL drafts only; perf rows carry
 * fullDraft; the refine pass and translation are reported separately. Harness copied from
 * worker-v779.test.js (below), unchanged.
 *
 * (harness notes from worker-v779.test.js)
 * worker-v779.test.js — proxy v7.79 (Gil, 9/24: "if none holds up, ship it as v7.79").
 *   1  a FULL DRAFT with no requested effort goes to gpt-6-luna at 'none' (its draftEffort);
 *      everything else keeps the effort it had: explicit efforts, the recovery tiers, the SMS refine
 *      pass and translation (no cache sentinel), fact probes.
 *   2  the phone-ask regen edits at the effort of the draft it edits.
 *   3  a subject the model put in the wrong place is lifted to the top-level key the extension reads.
 *   4  perf: rows carry the effort sent and whether a subject was lifted; /perf tallies both.
 *
 * Runs the SHIPPED fetch handler; model calls scripted by index (classifier calls are answered by
 * model name and do not consume the script); virtual clock as in worker-v778. Labels: [new] fails on
 * v7.78, [control] passes on both.
 *
 *   usage: worker-v779.test.js <cloudflare-worker.js>
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const PROXY = process.argv[2];
if (!PROXY) { console.error('usage: worker-v780.test.js <cloudflare-worker.js>'); process.exit(2); }
const src = fs.readFileSync(PROXY, 'utf8');

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

const SENTINEL = '⟦LP_CACHE_BREAKPOINT⟧';
const FULL_SYS = 'You are a BDC agent. '.repeat(300) + SENTINEL + '\nPERSONA: agent at the store.\n';
const REFINE_SYS = 'Rewrite the SMS from the email. '.repeat(40);   // the refine pass: its own short prompt, no sentinel
const USER = 'Lead context. '.repeat(400);
const USER_PHONE = USER + '\nCustomer Phone: (555) 010-0199\n';
const SMS = 'Thanks for reaching out on the Accord. It is here and available to see, and I can have everything ready for you when you arrive so the visit is quick.';
const BODY = 'Hi there,\n\nThe Accord is here and ready for you to see whenever works. I can have everything staged so the visit is quick.\n\nJolette';
const VM = 'Hi, Jolette at the store about the Accord. It is here and ready whenever you are.';
const GOOD = JSON.stringify({ sms: SMS, subject: 'Your Accord', email: BODY, voicemail: VM });
const USAGE = { prompt_tokens: 12000, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 7000, cache_write_tokens: 0 } };

function makeKV() {
  const store = new Map(), puts = [];
  return { store, puts,
    put: (k, v, o) => { puts.push({ k, v, o }); store.set(k, v); return Promise.resolve(); },
    get: (k) => Promise.resolve(store.has(k) ? store.get(k) : null),
    list: ({ prefix } = {}) => Promise.resolve({ keys: [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }) };
}

// script entries: 'ok' | a draft string to return | 'hang' | { status, error }. classifyAs: the classifier's answer.
function run({ script, effort, sys, user, contract, classifyAs, kv }) {
  let vnow = 1758650000000;
  const timers = [], calls = [], logs = [];
  let n = 0;
  class VDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(vnow); }
    static now() { return vnow; }
  }
  const box = {
    console: { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) },
    Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, Intl,
    AbortController, Promise, Date: VDate, Math, JSON, String, Number, Object, Array, RegExp, Error, crypto,
    setTimeout: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimeout: () => {},
    caches: { default: { match: () => Promise.resolve(undefined), put: () => Promise.resolve() } },
  };
  const reply = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  const answer = (text) => reply(200, { choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: USAGE });
  box.fetch = (url, o) => {
    const payload = o && o.body ? JSON.parse(o.body) : null;
    if (payload && payload.model === 'gpt-4.1-nano') return Promise.resolve(answer(classifyAs || 'NO'));   // the classifier
    const timer = timers[timers.length - 1];
    const step = (script || [])[n++] || 'ok';
    calls.push({ model: payload && payload.model, timeoutMs: timer ? timer.ms : null, payload });
    if (step === 'hang') {
      return new Promise((resolve, reject) => {
        o.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
        setImmediate(() => { vnow += timer.ms; timer.fn(); });
      });
    }
    if (step && step.status) { vnow += 120; return Promise.resolve(reply(step.status, { error: step.error })); }
    vnow += 3000;
    return Promise.resolve(answer(step === 'ok' ? GOOD : step));
  };
  box.globalThis = box; box.self = box;
  vm.createContext(box);
  vm.runInContext(src.replace(/^export default\s*\{/m, 'globalThis.__WORKER = {'), box);
  kv = kv || makeKV();
  const waits = [];
  const ctx = { waitUntil: (p) => { waits.push(p); if (p && p.catch) p.catch(() => {}); }, passThroughOnException: () => {} };
  const env = { LEADPRO_LICENSES: kv, OPENAI_API_KEY: 'sk-test', REQUIRE_LICENSE: 'false', DIRECTOR_KEYS: 'TESTDIRECTORKEY' };
  const req = new Request('https://p.test/', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({
      system_instruction: { parts: [{ text: sys || FULL_SYS }] },
      contents: [{ role: 'user', parts: [{ text: user || USER }] }],
      generationConfig: Object.assign({ temperature: 0.5, maxOutputTokens: 2500, responseMimeType: 'application/json' }, effort ? { reasoningEffort: effort } : {}),
    }, contract ? { responseContract: contract } : {})) });
  return box.__WORKER.fetch(req, env, ctx).then(async (res) => {
    await Promise.all(waits.map(p => Promise.resolve(p).catch(() => {})));
    const out = await res.json();
    const c = out && out.candidates && out.candidates[0];
    const text = c && c.content && c.content.parts && c.content.parts[0] && c.content.parts[0].text;
    let draft = null; try { draft = JSON.parse(text); } catch (e) {}
    const perf = kv.puts.filter(p => /^perf:/.test(p.k)).map(p => JSON.parse(p.v));
    return { calls, logs, kv, perf, text, draft, tier: res.headers.get('X-Tier'), fallback: !!(c && c._fallback), box, env };
  });
}

(async function () {
  console.log('\n' + path.relative(process.cwd(), PROXY) + ' — proxy v7.80, full drafts counted apart');
  const TRANSLATE_SYS = 'You are a professional automotive BDC translator. Translate to natural Mexican Spanish.';
  const perfOf = async (opts) => (await run(opts)).perf[0] || {};

  console.log('\n1. the perf: row says which calls are full drafts:');
  check('[new] a full draft (draft contract + cache sentinel) is fullDraft:true', (await perfOf({})).fullDraft, true);
  check('[new] the SMS refine pass is fullDraft:false', (await perfOf({ sys: REFINE_SYS })).fullDraft, false);
  check('[control] ...and still goes out at "low" (the efforts sent are unchanged)', (await perfOf({ sys: REFINE_SYS })).effort, 'low');

  console.log('\n2. /perf:');
  const kv = makeKV();
  await run({ kv });                        // full draft, no effort -> none
  await run({ kv });                        // full draft -> none
  await run({ kv, effort: 'low' });         // full draft, explicit low
  await run({ kv, sys: REFINE_SYS });       // refine pass -> low
  await run({ kv, sys: TRANSLATE_SYS });    // translation -> low
  // a row as v7.79 wrote it: effort, no fullDraft flag (the 9/23 02:32 refine pass, sizes as logged)
  kv.store.set('perf:2026-09-23T15:00:00.000Z:legacy-refine', JSON.stringify({ ts: '2026-09-23T15:00:00.000Z', requestId: 'legacy-refine',
    contract: 'draft', tier: 'primary', model: 'gpt-6-luna', latency: 3669, effort: 'low', sysChars: 7411, subjectLifted: false }));
  kv.store.set('perf:2026-09-23T15:01:00.000Z:legacy-full', JSON.stringify({ ts: '2026-09-23T15:01:00.000Z', requestId: 'legacy-full',
    contract: 'draft', tier: 'primary', model: 'gpt-6-luna', latency: 4275, effort: 'none', sysChars: 33128, subjectLifted: false }));
  const L = await run({ kv, contract: 'fact', script: [JSON.stringify({ kind: 'none', quote: '' })] });
  const q = async (date) => { const res = await L.box.__WORKER.fetch(new Request('https://p.test/perf?date=' + date + '&key=TESTDIRECTORKEY'), L.env,
    { waitUntil: () => {}, passThroughOnException: () => {} }); const b = await res.json(); return b.tallies || b; };
  const today = await q(new Date(1758650000000).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }));
  check('[new] draftsByEffort holds the full drafts only: 2 at none, 1 at explicit low',
    today.draftsByEffort && { low: (today.draftsByEffort.low || {}).calls, none: (today.draftsByEffort.none || {}).calls }, { low: 1, none: 2 });
  check('[new] the refine pass and translation are reported beside it, not in it',
    today.otherDraftCallsByEffort && { low: (today.otherDraftCallsByEffort.low || {}).calls }, { low: 2 });
  const legacy = await q('2026-09-23');
  check('[control] fact probes are in neither', [JSON.stringify(today.draftsByEffort).includes('fact'), (today.byContract || {}).fact], [false, 1]);
  check('[control] ...and every generation is still counted once in byTier', (today.byTier || {}).primary, 6);
  check('[new] a v7.79 row with no fullDraft flag is sorted by its prompt size (7,411 chars = refine, 33,128 = full)',
    [legacy.draftsByEffort, legacy.otherDraftCallsByEffort],
    [{ none: { calls: 1, latencyMedian: 4275 } }, { low: { calls: 1, latencyMedian: 3669 } }]);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL harness: ' + (e && e.stack || e)); process.exit(1); });
