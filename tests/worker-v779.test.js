#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('worker-v779.test.js');

/**
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
if (!PROXY) { console.error('usage: worker-v779.test.js <cloudflare-worker.js>'); process.exit(2); }
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
const efforts = r => r.calls.map(c => [c.model, c.payload.reasoning_effort || null]);

(async function () {
  console.log('\n' + path.relative(process.cwd(), PROXY) + ' — proxy v7.79, drafts at "none" on GPT-6 Luna');

  console.log('\n1. which requests go to "none":');
  {
    const r = await run({});
    check('[new] a full draft with no requested effort: gpt-6-luna at "none"', efforts(r), [['gpt-6-luna', 'none']]);
    check('[new] ...and the log says why', r.logs.some(l => /\[EFFORT\] primary gpt-6-luna: no effort requested on a full draft → "none" \(tier draftEffort, v7\.79\)/.test(l)), true);
    check('[control] ...on the ordinary 12000ms primary budget, not the escalated one', r.calls[0].timeoutMs, 12000);
    check('[control] the START line still reads effort=low and ends at contract= (the v7.76 shape)',
      r.logs.filter(l => / START tokens=/.test(l)).map(l => / effort=low /.test(l) && / contract=\w+$/.test(l)), [true]);
  }
  {
    const r = await run({ script: [{ status: 500, error: { message: 'x' } }, { status: 500, error: { message: 'x' } }, 'ok'] });
    check('[new] the recovery tiers keep "low" — only gpt-6-luna was measured at "none"', efforts(r),
      [['gpt-6-luna', 'none'], ['gpt-5.6-luna', 'low'], ['gpt-5.4-nano-2026-03-17', 'low']]);
  }
  {
    const r = await run({ effort: 'low' });
    check('[control] an explicit "low" is honoured', efforts(r), [['gpt-6-luna', 'low']]);
  }
  {
    const r = await run({ effort: 'none', script: [{ status: 500, error: { message: 'x' } }, 'ok'] });
    check('[control] an explicit "none" goes to every tier, as before', efforts(r), [['gpt-6-luna', 'none'], ['gpt-5.6-luna', 'none']]);
  }
  {
    const r = await run({ sys: REFINE_SYS });
    check('[control] the SMS refine pass (its own prompt, no cache sentinel) stays on "low" — not in the test',
      [efforts(r), r.logs.some(l => /tier draftEffort/.test(l))], [[['gpt-6-luna', 'low']], false]);
  }
  {
    const r = await run({ contract: 'fact', script: [JSON.stringify({ kind: 'none', quote: '' })] });
    check('[control] a fact probe with no effort field stays on "low" (the probes send "none" themselves)', efforts(r), [['gpt-6-luna', 'low']]);
  }

  console.log('\n2. the phone-ask regen:');
  {
    const asks = JSON.stringify({ sms: SMS + ' What is the best number to reach you?', subject: 'Your Accord', email: BODY, voicemail: VM });
    const r = await run({ user: USER_PHONE, classifyAs: 'YES', script: [asks, 'ok'] });
    check('[new] the regen edits at the effort of the draft it edits', efforts(r), [['gpt-6-luna', 'none'], ['gpt-6-luna', 'none']]);
  }

  console.log('\n3. a subject in the wrong place is kept:');
  {
    const noTop = JSON.stringify({ sms: SMS, email: 'subject: Your Accord and next step\n\n' + BODY, voicemail: VM });
    const r = await run({ script: [noTop] });
    check('[new] a leading "subject:" line (any case) becomes the top-level subject', r.draft && r.draft.subject, 'Your Accord and next step');
    check('[control] ...and the email itself is returned exactly as the model wrote it', r.draft && r.draft.email, 'subject: Your Accord and next step\n\n' + BODY);
    check('[new] ...logged with the source and the length only', r.logs.filter(l => /SUBJECT-LIFTED/.test(l)).map(l => l.replace(/^\[[^\]]+\] /, '')), ['SUBJECT-LIFTED from=line chars=25']);
    check('[new] ...and counted on the perf: row', r.perf.map(p => [p.effort, p.subjectLifted]), [['none', true]]);
  }
  {
    const obj = JSON.stringify({ sms: SMS, email: { subject: 'Your RAV4 search', body: BODY }, voicemail: VM });
    const r = await run({ script: [obj] });
    check('[new] an email OBJECT with its own subject: lifted too, the object left as it was',
      [r.draft && r.draft.subject, r.draft && typeof r.draft.email], ['Your RAV4 search', 'object']);
  }
  {
    const r = await run({});
    check('[control] a draft that already has a top-level subject is returned byte for byte', r.text, GOOD);
    check('[control] ...no lift logged', r.logs.some(l => /SUBJECT-LIFTED/.test(l)), false);
  }
  {
    const none = JSON.stringify({ sms: SMS, email: BODY, voicemail: VM });
    const r = await run({ script: [none] });
    check('[control] no subject anywhere → nothing invented', [r.text, r.draft && 'subject' in r.draft], [none, false]);
  }
  {
    const mid = JSON.stringify({ sms: SMS, email: BODY + '\nsubject: not a header', voicemail: VM });
    const r = await run({ script: [mid] });
    check('[control] a "subject:" that is not the first line is not a header and is not lifted', r.draft && 'subject' in r.draft, false);
  }

  console.log('\n4. /perf:');
  {
    const kv = makeKV();
    await run({ kv });
    await run({ kv, effort: 'low' });
    await run({ kv, script: [JSON.stringify({ sms: SMS, email: 'Subject: X\n\n' + BODY, voicemail: VM })] });
    const L = await run({ kv, sys: REFINE_SYS });
    const date = new Date(1758650000000).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    const res = await L.box.__WORKER.fetch(new Request('https://p.test/perf?date=' + date + '&key=TESTDIRECTORKEY'), L.env,
      { waitUntil: () => {}, passThroughOnException: () => {} });
    const b = await res.json();
    const t = b.tallies || b;
    // (v7.80) Only the "none" bucket is pinned here. This run's "low" bucket holds one full draft and one
    // refine pass; v7.79 counted both as drafts, v7.80 counts the refine pass apart (worker-v780 pins it).
    check('[new] primary-tier drafts split by the effort actually sent, with a latency median each',
      t.draftsByEffort && t.draftsByEffort.none, { calls: 2, latencyMedian: 3000 });
    check('[new] ...and the lifted subjects counted', t.subjectLifted, 1);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL harness: ' + (e && e.stack || e)); process.exit(1); });
