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
  const calls = { n: 0 };
  const box = {
    console: { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) },
    Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder,
    AbortController, Promise, Date, Math, JSON, String, Number, Object, Array, RegExp, Error,
    setTimeout, clearTimeout, crypto,
    fetch: (url, opts) => { calls.n++; return Promise.resolve(upstream(String(url))); },
    caches: { default: { match: () => Promise.resolve(undefined), put: () => Promise.resolve() } },
  };
  box.globalThis = box; box.self = box;
  vm.createContext(box);
  vm.runInContext(src.replace(/^export default\s*\{/m, 'globalThis.__WORKER = {'), box);
  if (!box.__WORKER || typeof box.__WORKER.fetch !== 'function') bail('worker exposes no fetch handler');
  return { worker: box.__WORKER, logs, calls };
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
  // (v7.73) These three are the "subject" abandonment shape, so they tally as abandoned. The
  // v7.72 counter this replaced would have called them subjectPresent — see the header.
  check('  emailShapes splits them on whether the email field was a JSON envelope',
    body.emailShapes, { doubleEncoded: 0, abandoned: 3 });
  check('  rows carry the shape', body.rows.every(r => r.shape && typeof r.shape.subject === 'number'), true);

  // ── (v7.73) THE TOP-LEVEL SUBJECT IS IRRELEVANT TO THE SPLIT ───────────────
  // This block used to assert the opposite, because v7.72 split the day on "was there a top-level
  // subject". One afternoon of real rows disproved that axis, so what is pinned now is that the
  // subject does NOT move a row between buckets: an abandonment with no subject tallies exactly
  // like one with a subject.
  console.log('\nan abandonment tallies the same with or without a top-level subject:');
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
  check('  still abandoned, exactly as the subject-bearing one was',
    body2.emailShapes, { doubleEncoded: 0, abandoned: 1 });


  // ── (v7.73) THE UNWRAP: A DOUBLE-ENCODED EMAIL IS RESCUED, NOT DISCARDED ───
  // The 9/8 rows showed four of five rejections carrying a complete 410-468 char email wrapped in
  // a JSON object. We were paying for a second model call to replace output we already had.
  // The inner body key was never visible in the 40-char samples, so three different key names are
  // driven here — two conventional and one that is not — to prove the extraction does not depend
  // on guessing it.
  console.log('\n(v7.73) a double-encoded email is unwrapped and served:');
  const BODY = 'Hi there,\n\nThe Camry is here at Kia Baytown and I can have it ready whenever suits you. '
             + 'Everything will be staged before you arrive so the visit stays quick, and I can walk you '
             + 'through the numbers in person rather than guessing at them over text.\n\nJolette';
  const INNER_KEYS = [['body', 'the conventional key'], ['text', 'another conventional key'],
                      ['emailBody', 'a key the extractor was never told about']];

  for (const [key, label] of INNER_KEYS) {
    console.log('\n  inner body under "' + key + '" — ' + label + ':');
    const inner = JSON.stringify({ subject: 'Your 2018 Camry is at Kia Baytown', [key]: BODY });
    const kvR = makeKV();
    const LR = load(() => okBody(envelope(inner, 'Your 2018 Camry is at Kia Baytown')), kvR);
    const r = await LR.worker.fetch(new Request('https://p.test/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draftBody()),
    }), ENVBASE(kvR), CTX);
    await new Promise(z => setTimeout(z, 0));

    check('    the caller gets a draft', r.status, 200);
    check('    ...on the FIRST upstream call — the second model call is saved', LR.calls.n, 1);
    const served = JSON.parse((await r.json()).candidates[0].content.parts[0].text);
    check('    the email is now prose, not a JSON envelope', served.email.startsWith('{'), false);
    check('    ...rebuilt in the shape a clean generation produces',
      served.email, 'Subject: Your 2018 Camry is at Kia Baytown\n\n' + BODY);
    check('    ...and the other fields are untouched', [served.sms, served.voicemail], [SMS, '']);
    const rk = [...kvR.store.keys()].filter(k => k.startsWith('degen:'));
    check('    the rescue is STILL recorded — it is a defect that now succeeds', rk.length, 1);
    const rr = rk.length ? JSON.parse(kvR.store.get(rk[0])) : {};
    check('    ...marked repaired, not rejected', rr.outcome, 'repaired');
    check('    ...naming the inner keys it found', !!(rr.repair && rr.repair.innerKeys), true);
  }

  // The top-level subject is filled only when the model omitted it — the 9/8 16:35 shape.
  console.log('\n  the 16:35 shape — no top-level subject, one nested inside:');
  const kvS = makeKV();
  const innerS = JSON.stringify({ subject: 'Verifying your 2027 Seltos match', body: BODY });
  const LS = load(() => okBody(JSON.stringify({ sms: SMS, email: innerS, voicemail: '' })), kvS);
  const rs = await LS.worker.fetch(new Request('https://p.test/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draftBody()),
  }), ENVBASE(kvS), CTX);
  await new Promise(z => setTimeout(z, 0));
  const servedS = JSON.parse((await rs.json()).candidates[0].content.parts[0].text);
  check('    the missing top-level subject is filled from the nested one',
    servedS.subject, 'Verifying your 2027 Seltos match');

  // ── THE ABANDONMENT IS NOT RESCUED ────────────────────────────────────────
  // There is nothing to unwrap in a 7-character "subject", and inventing a body would be far worse
  // than a fallback call. This is the line between the two shapes.
  console.log('\n(v7.73) a genuine abandonment is still rejected:');
  const kvA = makeKV();
  let na = 0;
  const LA = load(() => okBody(++na === 1 ? envelope('subject', 'Your Accord trade appraisal') : GOOD), kvA);
  const ra = await LA.worker.fetch(new Request('https://p.test/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draftBody()),
  }), ENVBASE(kvA), CTX);
  await new Promise(z => setTimeout(z, 0));
  check('    it still falls through to the next tier', LA.calls.n, 2);
  check('    the caller still gets a draft', ra.status, 200);
  const ar = JSON.parse(kvA.store.get([...kvA.store.keys()].find(k => k.startsWith('degen:'))));
  check('    recorded as rejected, not repaired', ar.outcome, 'rejected');

  // A nested envelope whose body is too short to stand on its own must NOT be admitted — the
  // unwrap may only rescue, never lower the bar.
  console.log('\n(v7.73) the unwrap cannot admit a body the guard would refuse:');
  const kvT = makeKV();
  let nt = 0;
  const tiny = JSON.stringify({ subject: 'Hi', body: 'ok' });
  const LT = load(() => okBody(++nt === 1 ? envelope(tiny, 'Hi') : GOOD), kvT);
  await LT.worker.fetch(new Request('https://p.test/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draftBody()),
  }), ENVBASE(kvT), CTX);
  await new Promise(z => setTimeout(z, 0));
  const tr = JSON.parse(kvT.store.get([...kvT.store.keys()].find(k => k.startsWith('degen:'))));
  check('    a two-character body is rejected, not unwrapped', tr.outcome, 'rejected');

  // ── (v7.73) THE TALLY SPLITS ON THE RIGHT AXIS ────────────────────────────
  // Driven with the two shapes that broke v7.72's counter: a double-encoded email with NO
  // top-level subject, and an abandonment WITH one. Under the old axis these landed in each
  // other's bucket.
  console.log('\n(v7.73) the export splits double-encoded from abandoned:');
  const kvX = makeKV();
  let nx = 0;
  const LX = load(() => {
    nx++;
    if (nx === 1) return okBody(JSON.stringify({ sms: SMS, email: innerS, voicemail: '' })); // double, no top subject
    if (nx === 2) return okBody(envelope('subject', 'Your Accord trade appraisal'));         // abandoned, top subject
    return okBody(GOOD);
  }, kvX);
  const ENVX = ENVBASE(kvX);
  for (let g = 0; g < 2; g++) {
    await LX.worker.fetch(new Request('https://p.test/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draftBody()),
    }), ENVX, CTX);
    await new Promise(z => setTimeout(z, 0));
  }
  const xo = await LX.worker.fetch(new Request('https://p.test/degenerate?key=' + DIRECTOR), ENVX, CTX);
  const xb = await xo.json();
  check('    both rows are exported', xb.count, 2);
  check('    ...split correctly despite the top-level subject being the WRONG signal',
    xb.emailShapes, { doubleEncoded: 1, abandoned: 1 });
  // Sorted: JSON.stringify is key-order sensitive and the insertion order here depends on which
  // generation ran first, which is not a property worth asserting.
  check('    ...and byOutcome distinguishes the rescue from the rejection',
    Object.entries(xb.byOutcome).sort(), [['rejected', 1], ['repaired', 1]]);
  check('    the retired v7.72 counter is gone', xb.emailRejections === undefined, true);

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
