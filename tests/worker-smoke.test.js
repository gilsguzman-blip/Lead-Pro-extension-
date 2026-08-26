#!/usr/bin/env node
'use strict';
/**
 * worker-smoke.test.js — v7.65. ACTUALLY RUN THE WORKER.
 *
 * ── WHY THIS EXISTS, AND IT IS THE SHORTEST INCIDENT REPORT IN THE REPO ───────────────────
 * v7.64 shipped this line into the tier loop:
 *
 *   const _escalated = spec.tier === 'primary' && isEscalation(reasoningEffort);
 *
 * `reasoningEffort` does not exist in that scope. It is the PARAMETER name inside the payload
 * builder; the tier loop's own variable is `reqEffort`, declared ~70 lines above. Every request
 * threw a ReferenceError before any API call, the worker returned 500 in ~28ms, and NOTHING
 * generated — drafts and probes alike.
 *
 * The suite was green. It was green because the assertion covering that exact line was:
 *
 *   /const _escalated = spec\.tier === 'primary' && isEscalation\(reasoningEffort\);/.test(proxySrc)
 *
 * — a regex over SOURCE TEXT, which matched the typo verbatim and confirmed it was present.
 *
 * That is the second consecutive build where source-text assertions stayed green through a live
 * outage. v7.61 was the first: three assertions pinned prompt_cache_options onto the two tiers
 * that reject it with a 400, and 68 assertions agreed the change had been made exactly as
 * intended. A regex proves a string is in a file. It cannot prove the file RUNS.
 *
 * So this suite does the one thing none of the others do: it loads the shipped worker as a module,
 * calls its fetch handler with stubbed I/O, and asserts real responses come back. Any
 * ReferenceError, TypeError or throw anywhere in the request path fails it — including in code no
 * assertion here names, which is the entire point.
 *
 * Deliberately NOT a behavioural suite. It answers "does it run", not "is it right"; the other
 * suites answer the second question. Keep it cheap and keep it broad.
 */
const fs = require('fs');
const vm = require('vm');

const PROXY = process.argv[2];
if (!PROXY) { console.error('usage: worker-smoke.test.js <cloudflare-worker.js>'); process.exit(2); }

const src = fs.readFileSync(PROXY, 'utf8');

let pass = 0, fail = 0;
function ok(name)        { pass++; console.log('  ok   ' + name); }
function bad(name, why)  { fail++; console.log('  FAIL ' + name + '\n        ' + why); }
function check(name, fn, want) {
  let got; try { got = JSON.stringify(fn()); } catch (e) { got = 'THREW: ' + e.message; }
  if (got === JSON.stringify(want)) ok(name);
  else bad(name, 'expected ' + JSON.stringify(want) + '\n        got      ' + got);
}

// ── Load the shipped worker for real ──────────────────────────────────────────
// Module syntax is rewritten to an assignment; nothing else about the file is touched.
function load(upstream) {
  const calls = [];
  const logs  = [];
  const box = {
    console: {
      log:   (...a) => logs.push(a.join(' ')),
      warn:  (...a) => logs.push(a.join(' ')),
      error: (...a) => logs.push(a.join(' '))
    },
    Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder,
    AbortController, Promise, Date, Math, JSON, String, Number, Object, Array, RegExp, Error,
    setTimeout, clearTimeout, crypto,
    // Every outbound call is stubbed. `upstream` decides what the model API returns.
    fetch: (url, opts) => {
      calls.push({ url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null });
      return Promise.resolve(upstream(String(url), calls.length));
    },
    caches: { default: { match: () => Promise.resolve(undefined), put: () => Promise.resolve() } }
  };
  box.globalThis = box;
  box.self = box;
  vm.createContext(box);
  vm.runInContext(src.replace(/^export default\s*\{/m, 'globalThis.__WORKER = {'), box);
  return { worker: box.__WORKER, calls, logs };
}

const OK_BODY = {
  choices: [{ message: { content: JSON.stringify({
    sms: 'Adriana, understood — the birthday party comes first. No pressure from us at all today.',
    email: 'Subject: No rush\n\nHi Adriana,\n\nUnderstood — enjoy the party. We will be here when you are ready to pick things back up.\n\nTania',
    voicemail: 'Hi Adriana, Tania at Community Honda Lafayette. No rush at all — call when you are ready.'
  }) }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 15000, completion_tokens: 200 }
};
const upstreamOK = () => new Response(JSON.stringify(OK_BODY), { status: 200, headers: { 'Content-Type': 'application/json' } });

const ENV = { LEADPRO_REGISTRY: null, OPENAI_API_KEY: 'sk-test', REQUIRE_LICENSE: 'false' };
const CTX = { waitUntil: () => {}, passThroughOnException: () => {} };

function draftBody(extra) {
  return Object.assign({
    system_instruction: { parts: [{ text: 'You are a BDC agent. '.repeat(400) }] },
    contents: [{ role: 'user', parts: [{ text: 'Lead context. '.repeat(400) }] }],
    generationConfig: { temperature: 0.5, maxOutputTokens: 2500, topP: 0.9, responseMimeType: 'application/json' }
  }, extra || {});
}

function post(body, upstream) {
  const L = load(upstream || upstreamOK);
  return L.worker.fetch(
    new Request('https://leadpro-proxy.test/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }), ENV, CTX
  ).then(res => ({ status: res.status, L }), err => ({ threw: err && err.message, L }));
}

console.log('\nv7.65 — does the shipped worker actually run?');
console.log('worker under test: ' + PROXY + '\n');

const pending = [];

// ── The module itself ─────────────────────────────────────────────────────────
console.log('it loads, and it exposes a handler:');

check('the module evaluates with no throw', () => { load(upstreamOK); return 'loaded'; }, 'loaded');
check('it exports a fetch handler', () => typeof load(upstreamOK).worker.fetch, 'function');

// ── A plain draft ─────────────────────────────────────────────────────────────
console.log('\na plain draft request — the path every generation takes:');

pending.push(() => post(draftBody()).then(r => {
  if (r.threw) return bad('a normal draft does not throw', 'threw: ' + r.threw);
  if (r.status === 500) return bad('a normal draft does not 500', 'status 500 — a throw inside the handler');
  return ok('a normal draft returns a real response (status ' + r.status + ')');
}));

pending.push(() => post(draftBody()).then(r => {
  const upstreamCalls = r.L.calls.filter(c => !/valuefact|commit-comprehension/.test(c.url));
  return upstreamCalls.length >= 1
    ? ok('...and it actually reached the upstream model API')
    : bad('...and it actually reached the upstream model API', 'no upstream call was made — it failed before the request');
}));

// ── THE v7.64 REGRESSION — an escalated request ───────────────────────────────
console.log('\nan ESCALATED request — this is the exact v7.64 crash:');

pending.push(() => post(draftBody({
  generationConfig: { temperature: 0.5, maxOutputTokens: 2500, responseMimeType: 'application/json',
                      reasoningEffort: 'high' }
})).then(r => {
  if (r.threw) return bad('a regen at "high" does not throw', 'threw: ' + r.threw);
  if (r.status === 500) return bad('a regen at "high" does not 500',
    'status 500 — this is the v7.64 ReferenceError, reproduced');
  return ok('a regen at "high" returns a real response (status ' + r.status + ')');
}));

pending.push(() => post(draftBody({
  generationConfig: { temperature: 0.5, maxOutputTokens: 2500, responseMimeType: 'application/json',
                      reasoningEffort: 'high' }
})).then(r => {
  const line = r.L.logs.find(l => /primary budget raised/.test(l));
  return line
    ? ok('...and the raised primary budget is logged: ' + line.replace(/^\[EFFORT\] /, '').slice(0, 60))
    : bad('...and the raised primary budget is logged', 'no "[EFFORT] primary budget raised" line — the escalation path did not run');
}));

// ── Every effort value the caller can send ────────────────────────────────────
console.log('\nevery effort a caller can name must survive the request path:');

['none', 'low', 'medium', 'high', 'xhigh', 'max', 'garbage', ''].forEach(eff => {
  pending.push(() => post(draftBody({
    generationConfig: { temperature: 0.5, maxOutputTokens: 2500, responseMimeType: 'application/json',
                        reasoningEffort: eff }
  })).then(r => {
    const label = 'effort "' + (eff || '(absent)') + '" does not crash the worker';
    if (r.threw)          return bad(label, 'threw: ' + r.threw);
    if (r.status === 500) return bad(label, 'status 500');
    return ok(label);
  }));
});

// ── The recovery ladder, driven for real ──────────────────────────────────────
console.log('\nthe recovery ladder — the v7.61 outage, executed rather than grepped:');

// Primary 400s; the fallback tier must be reached AND must not be handed the 5.6-only field.
const primaryFails = (url, n) => n === 1
  ? new Response(JSON.stringify({ error: { message: 'simulated primary failure' } }), { status: 400 })
  : new Response(JSON.stringify(OK_BODY), { status: 200 });

pending.push(() => post(draftBody(), primaryFails).then(r => {
  if (r.threw || r.status === 500) return bad('a primary failure falls through to the fallback tier',
    r.threw ? 'threw: ' + r.threw : 'status 500');
  const upstream = r.L.calls.filter(c => /openai|chat\/completions/i.test(c.url));
  return upstream.length >= 2
    ? ok('a primary failure falls through to the fallback tier (' + upstream.length + ' upstream calls)')
    : bad('a primary failure falls through to the fallback tier',
          'only ' + upstream.length + ' upstream call(s) — the ladder did not advance');
}));

pending.push(() => post(draftBody(), primaryFails).then(r => {
  // THE v7.61 BUG, executed: the second tier's real payload must not carry prompt_cache_options.
  const upstream = r.L.calls.filter(c => /openai|chat\/completions/i.test(c.url));
  const second = upstream[1] && upstream[1].body;
  if (!second) return bad('the fallback tier is not handed the 5.6-only cache field', 'no second tier payload captured');
  return second.prompt_cache_options === undefined
    ? ok('the fallback tier is not handed the 5.6-only cache field')
    : bad('the fallback tier is not handed the 5.6-only cache field',
          'payload carried prompt_cache_options — this 400s that model, and it is what took the ladder down between v7.61 and v7.64');
}));

pending.push(() => post(draftBody(), primaryFails).then(r => {
  const upstream = r.L.calls.filter(c => /openai|chat\/completions/i.test(c.url));
  const first = upstream[0] && upstream[0].body;
  return first && first.prompt_cache_options
    ? ok('...while the primary tier DOES get it — the gate is per-tier, not a blanket removal')
    : bad('...while the primary tier DOES get it',
          'the primary payload lost prompt_cache_options; caching is off on the tier that answers everything');
}));

// ── (v7.68) /commit-comprehension, POSTED FOR REAL AND CHECKED INTO KV ─────────────────────
// v7.67 added a log line to make the detector default audible and passed it `requestId` — a const
// declared 254 lines BELOW that handler, in a branch it returns before reaching. `const` hoists but
// stays uninitialised, so EVERY POST threw
//   ReferenceError: Cannot access 'requestId' before initialization
// and 93 of 93 comprehension rows on 8/26 were lost. The report read "No comprehension verdicts
// recorded for this date" while the extension was posting correctly the whole time.
//
// THAT IS THE SECOND TIME THIS WEEK. v7.64 was isEscalation(reasoningEffort) — a wrong name; this
// was a declaration order. Both are "the identifier is not usable where it is used", and both
// shipped past suites that confirmed the code was PRESENT. Presence is not scope.
//
// So this endpoint is now POSTED, not grepped: a real body through the real handler, with the KV
// binding stubbed so the row can be read back. A TDZ throw cannot pass this.
console.log('\n/commit-comprehension — posted for real, and the row read back out of KV:');

function ccBody(over) {
  return Object.assign({
    type: 'commit-comprehension',
    id: 'gen-smoke-1',
    ts: new Date().toISOString(),
    detector: 'day-lock',
    authoritative: false,
    sourceUsed: '',
    delta: 'AGREE-NONE',
    regexRan: true, regexFired: false, regexQuoteLen: 0,
    compKind: 'none', probeOk: true, probeFailReason: '',
    quoteVerified: false, claimedNote: null, verifiedNote: 0, notesRead: 2,
    vacuous: false, extensionVersion: '9.7.582',
    meta: { autoLeadId: '123', customerId: '456', dealerId: '21135', leadSource: 'x', store: 'y' }
  }, over || {});
}

function postCC(body) {
  const L = load(upstreamOK);
  const kv = [];
  const env = Object.assign({}, ENV, {
    LEADPRO_LICENSES: { put: (k, v) => { kv.push({ k, v }); return Promise.resolve(); },
                        get: () => Promise.resolve(null) }
  });
  return L.worker.fetch(
    new Request('https://leadpro-proxy.test/commit-comprehension', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }), env, CTX
  ).then(res => ({ status: res.status, kv, logs: L.logs }),
         err => ({ threw: (err && err.message) || String(err), kv, logs: L.logs }));
}

pending.push(() => postCC(ccBody()).then(r => {
  if (r.threw) return bad('a real POST does not throw', 'threw: ' + r.threw);
  if (r.status >= 500) return bad('a real POST does not 500',
    'status ' + r.status + ' — this is the v7.67 TDZ, reproduced');
  return ok('a real POST returns ' + r.status + ', not a 500');
}));

pending.push(() => postCC(ccBody()).then(r =>
  r.kv.length === 1
    ? ok('...and exactly one row reached KV')
    : bad('...and exactly one row reached KV', r.kv.length + ' row(s) written')));

pending.push(() => postCC(ccBody()).then(r => {
  if (!r.kv.length) return bad('the stored row keeps the detector it was sent', 'nothing written');
  let stored; try { stored = JSON.parse(r.kv[0].v); } catch (e) { return bad('the stored row parses', e.message); }
  return stored.detector === 'day-lock'
    ? ok('the stored row keeps the detector it was sent (day-lock, not defaulted)')
    : bad('the stored row keeps the detector it was sent', 'stored as "' + stored.detector + '"');
}));

pending.push(() => postCC(ccBody({ detector: undefined })).then(r => {
  if (!r.kv.length) return bad('a row with NO detector still stores, and says so', 'nothing written');
  const said = r.logs.some(l => /detector DEFAULTED to verbal-commit/.test(l));
  const stored = JSON.parse(r.kv[0].v);
  return (stored.detector === 'verbal-commit' && said)
    ? ok('a row with NO detector defaults to verbal-commit AND logs that it did')
    : bad('a row with NO detector defaults AND logs it',
          'stored=' + stored.detector + ' logged=' + said);
}));

pending.push(() => postCC(ccBody({ detector: 'not-a-detector' })).then(r => {
  const said = r.logs.some(l => /unrecognised detector/.test(l));
  return said ? ok('an UNRECOGNISED detector is logged distinctly from a missing one')
              : bad('an unrecognised detector is logged distinctly', 'no such log line');
}));

pending.push(() => postCC(ccBody({ id: undefined })).then(r =>
  r.status === 400
    ? ok('a body missing its required id is still rejected with 400, not a crash')
    : bad('a body missing its id is rejected with 400', 'status ' + r.status)));

(async () => {
  for (const p of pending) { try { await p(); } catch (e) { bad('harness', e.message); } }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
