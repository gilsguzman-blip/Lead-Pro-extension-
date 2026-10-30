#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('worker-v791.test.js');
/**
 * worker-v791.test.js — proxy v7.91: a short {"translation":"..."} from the extension's translate call is not an "Empty
 * response". 10/30, 11:16-11:19 CT: three translate requests failed every tier on the 150-char draft floor and served
 * SAFE_FALLBACK; the text stayed in English. Runs the SHIPPED fetch handler with the model API stubbed per call (the
 * harness is the one the v7.88 test uses). [new] fails on v7.90; [control] passes on both. Placeholder data only.
 *
 *   usage: worker-v791.test.js <cloudflare-worker.js>
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const PROXY = process.argv[2];
if (!PROXY) { console.error('usage: worker-v791.test.js <cloudflare-worker.js>'); process.exit(2); }
const src = fs.readFileSync(PROXY, 'utf8');
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const REFINE_SYS = 'You are Agent Name at Test Store. You write ONE text message to a real car dealership customer.\nAn email to this customer has ALREADY been written and is going out. It has already decided what this outreach is about.';
const DRAFT_SYS = 'You are a BDC agent. '.repeat(200) + '⟦LP_CACHE_BREAKPOINT⟧\nPERSONA: agent.';
const SHORT_SMS = JSON.stringify({ sms: 'Test, would you still like to come in? Just reply yes or no and we can find a day.' });
const LONG_SMS = JSON.stringify({ sms: 'Test, would you still like to come in? Just reply yes or no and we can find a day that works for you. I can have everything ready so the visit is quick and easy for you.' });
const USAGE = { prompt_tokens: 2000, completion_tokens: 60, prompt_tokens_details: { cached_tokens: 0 } };

// replies: one model reply body (string) per call, in order
function run(system, replies) {
  const calls = [], logs = [];
  const box = { console: { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: () => {} },
    Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, Intl, AbortController, Promise, Date, Math, JSON,
    String, Number, Object, Array, RegExp, Error, Set, Map, crypto, setTimeout, clearTimeout,
    caches: { default: { match: () => Promise.resolve(undefined), put: () => Promise.resolve() } } };
  box.fetch = (url, o) => {
    const payload = o && o.body ? JSON.parse(o.body) : null;
    if (payload && (payload.model === 'gpt-4.1-nano' || /You are a binary classifier/.test(JSON.stringify(payload.messages || '')))) return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'NO' }, finish_reason: 'stop' }], usage: USAGE })));
    const body = replies[calls.length] !== undefined ? replies[calls.length] : replies[replies.length - 1];
    calls.push(payload && payload.model);
    return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: body }, finish_reason: 'stop' }], usage: USAGE }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  };
  box.globalThis = box; vm.createContext(box);
  vm.runInContext(src.replace(/^export default\s*\{/m, 'globalThis.__WORKER = {'), box);
  const puts = [], waits = [];
  const kv = { put: (k, v) => { puts.push({ k, v }); return Promise.resolve(); }, get: () => Promise.resolve(null), list: () => Promise.resolve({ keys: [], list_complete: true }) };
  const ctx = { waitUntil: (p) => { waits.push(p); if (p && p.catch) p.catch(() => {}); } };
  const env = { LEADPRO_LICENSES: kv, OPENAI_API_KEY: 'sk-test', REQUIRE_LICENSE: 'false' };
  const req = new Request('https://p.test/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    system_instruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: 'THE FIRST DRAFT OF THE TEXT. '.repeat(20) }] }],
    generationConfig: { maxOutputTokens: 700, responseMimeType: 'application/json' }, noEdgeCache: true }) });
  return box.__WORKER.fetch(req, env, ctx).then(async (res) => {
    await Promise.all(waits.map(p => Promise.resolve(p).catch(() => {})));
    const out = await res.json(); const c = out && out.candidates && out.candidates[0];
    const perf = puts.find(x => /^perf:/.test(x.k));
    return { calls, logs, tier: res.headers.get('X-Tier'), fallback: !!(c && c._fallback), text: c && c.content && c.content.parts && c.content.parts[0] && c.content.parts[0].text, perf: perf ? JSON.parse(perf.v) : null };
  });
}

// The translate call as the extension sends it (9.7.841 _lpTranslateOne).
const TRANSLATE_SYS = 'You are a professional automotive BDC translator. Translate to natural Mexican Spanish. Always return your translation wrapped in {"translation": "..."} JSON. Preserve line breaks as \\n in the JSON string.';
const SHORT_ES = JSON.stringify({ translation: 'Test, ¿le interesa el Camry SE rojo?\nAgent\nTest Store\n(555) 010-0100' });
const LONG_ES = JSON.stringify({ translation: 'Test, le escribo para dar seguimiento sobre el Camry SE 2026 rojo como otra opción además del Camry LE que preguntó. ¿Le interesaría el SE rojo?\nAgent\nTest Store\n(555) 010-0100' });

(async function () {
  console.log('\n' + path.relative(process.cwd(), PROXY) + ' — proxy v7.91');
  {
    const r = await run(TRANSLATE_SYS, [SHORT_ES]);
    check('[new] 10/30: a translated text whose reply is a short {"translation":"..."} (' + SHORT_ES.length + ' chars) is served by the primary tier', [r.tier, r.fallback, r.calls.length], ['primary', false, 1]);
    check('[new] ...and the Spanish that comes back is the model\'s', JSON.parse(r.text || '{}').translation, JSON.parse(SHORT_ES).translation);
  }
  {
    const r = await run(TRANSLATE_SYS, [JSON.stringify({ translation: '' }), LONG_ES]);
    check('[control] a translation reply with an empty translation is still empty: the next tier runs', [r.calls.length, r.tier], [2, 'fallback']);
  }
  {
    const r = await run(TRANSLATE_SYS, [JSON.stringify({ sms: 'Test, hola.' }), LONG_ES]);
    check('[control] a short translate reply with no translation field is still empty', [r.calls.length, r.tier], [2, 'fallback']);
  }
  {
    const r = await run(TRANSLATE_SYS, [LONG_ES]);
    check('[control] a long translation was always served (the email case)', [r.tier, r.fallback], ['primary', false]);
  }
  {
    const shortDraft = JSON.stringify({ sms: 'Test, the Accord is here.', email: '', subject: 's', voicemail: '' });
    const ok = JSON.stringify({ sms: 'Test, the Accord is here and ready for you whenever works.', subject: 'Your Accord',
      email: 'Hi Test,\n\nThe Accord is here and ready for you to see whenever works for you. I can have it staged so your visit is quick.\n\nAgent Name\nTest Store',
      voicemail: 'Hi Test, Agent Name at Test Store about the Accord. It is here and ready whenever you are.' });
    const r = await run(DRAFT_SYS, [shortDraft, ok]);
    check('[control] a FULL draft under 150 characters is still rejected (its floor is unchanged)', [shortDraft.length < 150, r.calls.length > 1, r.tier], [true, true, 'fallback']);
  }
  {
    const r = await run(DRAFT_SYS, [SHORT_ES, JSON.stringify({ sms: 'x'.repeat(60), subject: 's', email: 'y'.repeat(200), voicemail: '' })]);
    check('[control] a short {"translation"} reply to a DRAFT prompt is still rejected (the exemption is for the translate call)', [r.calls.length > 1], [true]);
  }
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
