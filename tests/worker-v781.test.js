#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('worker-v781.test.js');

/**
 * worker-v781.test.js — proxy v7.81: the SMS refine pass takes gpt-6-luna's draftEffort ('none') when the
 * caller sends no effort, recognised by the fixed sentence the extension's refine system prompt opens on.
 * Runs the SHIPPED worker handler with a scripted upstream (harness from worker-v780), and checks the
 * marker against the SHIPPED extension builds, so the two cannot drift apart silently.
 *
 * Usage: node tests/worker-v781.test.js <cloudflare-worker.js> [dev popup.js] [commercial popup.js]
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const PROXY = process.argv[2];
if (!PROXY) { console.error('usage: worker-v781.test.js <cloudflare-worker.js> [popup.js...]'); process.exit(2); }
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
  console.log('\n' + path.relative(process.cwd(), PROXY) + ' — proxy v7.81, the SMS refine pass at "none"');
  const m = src.match(/const SMS_REFINE_MARKER = '([^']+)';/);
  const MARK = m ? m[1] : 'An email to this customer has ALREADY been written and is going out.';
  const REFINE_REAL = 'You are Test at Community Kia Baytown.\n\nYou write ONE text message to a real car dealership customer.\n\n'
    + MARK + ' It has already decided what this outreach is about and which facts are true.\n' + 'Keep it short. '.repeat(200);
  const TRANSLATE_SYS = 'You are a professional automotive BDC translator. Translate to natural Mexican Spanish.';
  const eff = (r) => r.calls.map(c => [c.model, c.payload.reasoning_effort || null]);
  const SHORT = JSON.stringify({ sms: SMS });

  console.log('\n1. the refine pass:');
  const r1 = await run({ sys: REFINE_REAL, script: [SHORT] });
  check('[new] no effort sent -> gpt-6-luna is called at "none"', eff(r1)[0], ['gpt-6-luna', 'none']);
  check('[new] ...and the [EFFORT] line names the refine pass', r1.logs.some(l => /\[EFFORT\] primary gpt-6-luna: no effort requested on the SMS refine pass → "none" \(tier draftEffort, v7\.81\)/.test(l)), true);
  check('[new] ...and the perf row says smsRefine:true, fullDraft:false, effort none', [r1.perf[0].smsRefine, r1.perf[0].fullDraft, r1.perf[0].effort], [true, false, 'none']);
  const r2 = await run({ sys: REFINE_REAL, effort: 'low', script: [SHORT] });
  check('[control] an explicit "low" is honoured', eff(r2)[0], ['gpt-6-luna', 'low']);
  const r3 = await run({ sys: REFINE_REAL, script: [{ status: 500, error: 'upstream' }, SHORT] });
  check('[new] when Luna 6 fails on a refine, it had been called at "none"', eff(r3)[0], ['gpt-6-luna', 'none']);
  check('[control] ...and the 5.6 fallback runs it at its normal effort', eff(r3)[1], ['gpt-5.6-luna', 'low']);

  console.log('\n2. everything else is as v7.80 left it:');
  const r4 = await run({ sys: TRANSLATE_SYS, script: [SHORT] });
  check('[control] the translation call (no marker, no sentinel) stays "low"', eff(r4)[0], ['gpt-6-luna', 'low']);
  check('[new] ...and its perf row says smsRefine:false', r4.perf[0].smsRefine, false);
  const r5 = await run({});
  check('[control] a full draft is still "none" and fullDraft:true', [eff(r5)[0], r5.perf[0].fullDraft], [['gpt-6-luna', 'none'], true]);
  check('[new] ...and not marked as a refine', r5.perf[0].smsRefine, false);
  const r6 = await run({ sys: REFINE_REAL, contract: 'fact', script: [JSON.stringify({ kind: 'none', quote: '' })] });
  check('[control] a non-draft contract carrying the sentence keeps the default effort', eff(r6)[0], ['gpt-6-luna', 'low']);

  console.log('\n3. the extension actually sends the sentence the worker looks for:');
  const builds = process.argv.slice(3).filter(a => /popup\.js$/.test(a));
  if (!builds.length) console.log('  (no extension builds given — skipped)');
  for (const b of builds) {
    const sb = require('./helpers/load-popup.js')(b, { withAuth: true });
    const sys = vm.runInContext('buildSystemPromptSmsRefine', sb)('Test', 'Community Kia Baytown', '(555) 010-0199');
    check('[link] ' + path.basename(path.dirname(b)) + ': buildSystemPromptSmsRefine carries the marker', sys.indexOf(MARK) > -1, true);
    const main = vm.runInContext('typeof buildSystemPrompt === "function" ? buildSystemPrompt : null', sb);
    check('[control] ' + path.basename(path.dirname(b)) + ': the main system prompt does not', main ? String(main({}) || '').indexOf(MARK) === -1 : true, true);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL harness: ' + (e && e.stack || e)); process.exit(1); });
