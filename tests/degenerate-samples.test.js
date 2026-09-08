#!/usr/bin/env node
'use strict';
// Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('degenerate-samples.test.js');

/**
 * degenerate-samples.test.js — v7.72. A DAY OF SAMPLES HAS TO SURVIVE THE DAY.
 *
 * The degenerate-email rejection has been the biggest open reliability item since 8/29: 10 that
 * day, 4 on 9/6, 27 on 9/7 against 4,770 requests. Every sample read so far is the EMAIL field,
 * and the three captured in the 9/7 log export were
 *
 *     [email: "subject"]   [email: "subject_placeholder"]   [email: "{"subject":"Your 2022 RAV4…"]
 *
 * All recover on fallback, so nothing reaches a customer. What nobody could answer is whether the
 * SUBJECT field held a real subject at the same moment — i.e. whether the model collapsed two
 * fields into one, or abandoned the envelope. v7.72 records the envelope shape and persists one
 * row per rejection so a day of traffic answers it.
 *
 * THIS SUITE RUNS THE SHIPPED WORKER. The module is loaded and its fetch handler is called with a
 * stubbed model API and a stubbed KV — the rejection, the KV write and the export are all
 * exercised for real. A regex over source text is what stayed green through two live outages
 * (see the opening of worker-smoke.test.js), and this build is pure instrumentation, which is
 * exactly the kind of change that can look present and do nothing.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const PROXY = process.argv[2];
if (!PROXY) { console.error('usage: degenerate-samples.test.js <cloudflare-worker.js>'); process.exit(2); }
const src = fs.readFileSync(PROXY, 'utf8');

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const bail = (m) => require('./lib/fatal-guard.js').bail('degenerate-samples.test.js', m);

if (src.indexOf("url.pathname.endsWith('/degenerate')") < 0) {
  bail('the /degenerate endpoint is not in ' + PROXY + ' — THE SUITE DID NOT LOAD');
}

// Long enough to clear MIN_CONTENT_CHARS (150) so the envelope reaches the field guard rather
// than being rejected upstream as a short response — that upstream floor is a different guard.
const SMS = 'Thanks for reaching out on the Accord. It is here and available to see, and I can have '
          + 'everything ready for you when you arrive so the visit is quick and easy for you.';

const envelope = (email, subject) => JSON.stringify({
  sms: SMS, email, subject, voicemail: ''
});

// The cap the shipped file applies to a sample, read FROM the shipped file. Hand-counting the
// truncation point is how the first draft of this suite failed: the expectation was off by one
// character, which says nothing about the worker and everything about my arithmetic.
const CAP = (() => {
  const m = src.match(/DEGENERATE_SAMPLE_CHARS\s*=\s*(\d+)/);
  if (!m) bail('DEGENERATE_SAMPLE_CHARS not found in ' + PROXY);
  return Number(m[1]);
})();
const sampleOf = (s) => (s.length > CAP ? s.slice(0, CAP) + '\u2026' : s);

// The three real 9/7 shapes.
const NESTED = '{"subject":"Your 2022 RAV4 appraisal options"}';
const CASES = [
  ['the literal word "subject"', envelope('subject', 'Your Accord trade appraisal'), sampleOf('subject')],
  ['a placeholder token',        envelope('subject_placeholder', 'Your Accord trade appraisal'), sampleOf('subject_placeholder')],
  ['a nested JSON object',       envelope(NESTED, 'Your RAV4'), sampleOf(NESTED)],
];

function load(upstream, kv) {
  const logs = [];
  const box = {
    console: { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) },
    Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder,
    AbortController, Promise, Date, Math, JSON, String, Number, Object, Array, RegExp, Error,
    setTimeout, clearTimeout, crypto,
    fetch: (url, opts) => Promise.resolve(upstream(String(url))),
    caches: { default: { match: () => Promise.resolve(undefined), put: () => Promise.resolve() } },
  };
  box.globalThis = box; box.self = box;
  vm.createContext(box);
  vm.runInContext(src.replace(/^export default\s*\{/m, 'globalThis.__WORKER = {'), box);
  if (!box.__WORKER || typeof box.__WORKER.fetch !== 'function') bail('worker exposes no fetch handler');
  return { worker: box.__WORKER, logs };
}

// A KV stub that records writes and serves them back, so the write path and the read path are
// exercised against the same store rather than against a fixture of what the write "should" be.
function makeKV() {
  const store = new Map();
  return {
    store,
    put: (k, v) => { store.set(k, v); return Promise.resolve(); },
    get: (k) => Promise.resolve(store.has(k) ? store.get(k) : null),
    list: ({ prefix }) => Promise.resolve({
      keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })),
      list_complete: true,
    }),
  };
}

const DIRECTOR = 'TESTDIRECTORKEY';
const CTX = { waitUntil: (p) => { if (p && p.then) p.catch(() => {}); }, passThroughOnException: () => {} };
const okBody = (text) => new Response(JSON.stringify({
  choices: [{ message: { content: text }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 12000, completion_tokens: 300 },
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

const GOOD = envelope(
  'Subject: Your Accord\n\nHi there,\n\nThe Accord is here and ready for you to see whenever works. '
  + 'I can have everything staged so the visit is quick.\n\nJolette', 'Your Accord');

function draftBody() {
  return {
    system_instruction: { parts: [{ text: 'You are a BDC agent. '.repeat(400) }] },
    contents: [{ role: 'user', parts: [{ text: 'Lead context. '.repeat(400) }] }],
    generationConfig: { temperature: 0.5, maxOutputTokens: 2500, topP: 0.9, responseMimeType: 'application/json' },
  };
}

(async function () {
  console.log('\n' + path.relative(process.cwd(), PROXY) + ' — the rejection is recorded, not just logged');

  const ENVBASE = (kv) => ({ LEADPRO_LICENSES: kv, OPENAI_API_KEY: 'sk-test', REQUIRE_LICENSE: 'false', DIRECTOR_KEYS: DIRECTOR });

  // ── EACH REAL SHAPE IS REJECTED, RECORDED, AND RECOVERED ───────────────────
  for (const [label, bad, wantSample] of CASES) {
    console.log('\n' + label + ':');
    const kv = makeKV();
    let n = 0;
    const L = load(() => okBody(++n === 1 ? bad : GOOD), kv);
    const res = await L.worker.fetch(new Request('https://p.test/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draftBody()),
    }), ENVBASE(kv), CTX);
    await new Promise(r => setTimeout(r, 0));   // let ctx.waitUntil settle

    check('  the caller still gets a draft (recovered on the next tier)', res.status, 200);
    const keys = [...kv.store.keys()].filter(k => k.startsWith('degen:'));
    check('  one degen record was written', keys.length, 1);
    const row = keys.length ? JSON.parse(kv.store.get(keys[0])) : {};
    check('  it names the email field', row.field, 'email');
    check('  it carries the sample the log line carries', row.sample, wantSample);
    check('  ...and the envelope SHAPE, which the log line never did', !!row.shape, true);
    check('  THE QUESTION THIS BUILD EXISTS FOR: was there a real subject?',
      row.shape && row.shape.subject > 0, true);
    check('  ...with the sms length recorded too, so "was it only email" is answerable',
      row.shape && row.shape.sms, SMS.length);
    check('  ...and the prompt sizes, lengths only', typeof row.sysChars === 'number' && typeof row.userChars === 'number', true);
    check('  no draft text beyond the 40-char sample is stored',
      Object.keys(row).filter(k => typeof row[k] === 'string' && row[k].length > CAP + 1), []);
    check('  the error STRING is unchanged, so log alerting still matches',
      L.logs.some(l => /Degenerate field content \(finish=/.test(l)), true);
  }

  // ── THE EXPORT ─────────────────────────────────────────────────────────────
  console.log('\nGET /degenerate returns the day and answers the collapse question up front:');
  const kv = makeKV();
  let n = 0;
  const L = load(() => okBody(++n % 2 === 1 ? CASES[0][1] : GOOD), kv);
  const ENV = ENVBASE(kv);
  for (let g = 0; g < 3; g++) {
    await L.worker.fetch(new Request('https://p.test/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draftBody()),
    }), ENV, CTX);
    await new Promise(r => setTimeout(r, 0));
  }
  // No `date` param: the endpoint defaults to centralTodayStr(), which is the same basis the
  // records were written under. Passing a UTC date here silently queried the wrong Central day —
  // caught by this suite returning 0 rows against a store that demonstrably had 3.

  const noKey = await L.worker.fetch(new Request('https://p.test/degenerate'), ENV, CTX);
  check('  no director key is refused', noKey.status, 403);
  const wrong = await L.worker.fetch(new Request('https://p.test/degenerate?key=NOTADIRECTOR'), ENV, CTX);
  check('  a non-director key is refused', wrong.status, 403);

  const out = await L.worker.fetch(new Request('https://p.test/degenerate?key=' + DIRECTOR), ENV, CTX);
  check('  a director gets 200', out.status, 200);
  const body = await out.json();
  check('  every rejection is in the export', body.count, 3);
  check('  tallied by field', body.byField, { email: 3 });
  check('  ...and by finish reason', Object.keys(body.byFinish), ['stop']);
  check('  emailRejections answers the collapse question directly',
    body.emailRejections, { subjectPresent: 3, subjectEmptyOrAbsent: 0 });
  check('  rows carry the shape', body.rows.every(r => r.shape && typeof r.shape.subject === 'number'), true);

  // ── THE OTHER HALF: AN ABANDONED ENVELOPE MUST TALLY DIFFERENTLY ───────────
  // If subject is empty too, this is not a field collapse — it is the model giving up. The whole
  // point of the counter is that these two land in different buckets.
  console.log('\nan abandoned envelope (no subject either) tallies as the OTHER case:');
  const kv2 = makeKV();
  let n2 = 0;
  const L2 = load(() => okBody(++n2 === 1 ? envelope('subject', '') : GOOD), kv2);
  const ENV2 = ENVBASE(kv2);
  await L2.worker.fetch(new Request('https://p.test/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draftBody()),
  }), ENV2, CTX);
  await new Promise(r => setTimeout(r, 0));
  const out2 = await L2.worker.fetch(new Request('https://p.test/degenerate?key=' + DIRECTOR), ENV2, CTX);
  const body2 = await out2.json();
  check('  subjectEmptyOrAbsent, not subjectPresent',
    body2.emailRejections, { subjectPresent: 0, subjectEmptyOrAbsent: 1 });

  // ── A CLEAN DAY WRITES NOTHING ─────────────────────────────────────────────
  console.log('\na clean generation records nothing at all:');
  const kv3 = makeKV();
  const L3 = load(() => okBody(GOOD), kv3);
  const ENV3 = ENVBASE(kv3);
  const good = await L3.worker.fetch(new Request('https://p.test/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draftBody()),
  }), ENV3, CTX);
  await new Promise(r => setTimeout(r, 0));
  check('  the draft succeeds', good.status, 200);
  check('  and no degen row was written', [...kv3.store.keys()].filter(k => k.startsWith('degen:')).length, 0);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => bail('the suite threw: ' + (e && e.stack || e)));
