#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('worker-v777.test.js');

/**
 * worker-v777.test.js — proxy v7.77. Every item runs the SHIPPED fetch handler against a stubbed KV
 * and a stubbed model API; nothing here is a regex over source text.
 *
 *   1  /list-licenses returns licenses only, paged, and reports non-LP- key formats
 *   2  /feedback/summary byScenario splits explicit/implicit and reconciles with the top line
 *   3  summary, range and drafts all answer date= as the same Central day, across DST
 *   4  extensionVersion on /generate: logged and stored when present, byte-identical when absent
 *   5  a classifier failure is a logged failure with classifyFailed=true, not sms=NO
 *   6  perf: rows per generation, GET /perf tallies, and the rows never break a generation
 *   7  the safe-fallback text is neutral: no appointment push, no placeholders
 *
 * The KV stub lists in UTF-8 byte order and pages at 5 keys regardless of `limit` (a real KV may
 * return fewer keys than asked, with a cursor), so "more than one page" is exercised on small data.
 *
 *   usage: worker-v777.test.js <cloudflare-worker.js> [older-worker.js for byte-identity checks]
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const PROXY = process.argv[2];
const OLDER = process.argv[3] || path.join(path.dirname(PROXY || '.'), 'cloudflare-worker-v7.76.js');
if (!PROXY) { console.error('usage: worker-v777.test.js <cloudflare-worker.js>'); process.exit(2); }
const src = fs.readFileSync(PROXY, 'utf8');
const oldSrc = fs.existsSync(OLDER) ? fs.readFileSync(OLDER, 'utf8') : null;

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

const CLASSIFIER_MODEL = (src.match(/const CLASSIFIER_MODEL\s*=\s*'([^']+)'/) || [])[1];

// ── harness ───────────────────────────────────────────────────────────────────
function makeKV(opts) {
  opts = opts || {};
  const store = new Map(), meta = new Map();
  const gets = [], puts = [];
  const sorted = () => [...store.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return {
    store, meta, gets, puts,
    put: (k, v, o) => { puts.push({ k, o }); if (opts.putThrows) return Promise.reject(new Error('KV write limit')); store.set(k, v); meta.set(k, o || null); return Promise.resolve(); },
    get: (k) => { gets.push(k); return Promise.resolve(store.has(k) ? store.get(k) : null); },
    list: ({ prefix, limit, cursor } = {}) => {
      const all = sorted().filter(k => !prefix || k.startsWith(prefix));
      const start = cursor ? Number(cursor) : 0;
      const page = Math.min(limit || 1000, opts.pageCap || 1000);
      const keys = all.slice(start, start + page).map(name => ({ name }));
      const done = start + page >= all.length;
      return Promise.resolve({ keys, list_complete: done, ...(done ? {} : { cursor: String(start + page) }) });
    },
  };
}
function load(source, upstream) {
  const logs = [], cachePuts = [];
  const box = {
    console: { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) },
    Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, Intl,
    AbortController, Promise, Date, Math, JSON, String, Number, Object, Array, RegExp, Error,
    setTimeout, clearTimeout, crypto,
    fetch: (url, o) => upstream(String(url), o && o.body ? JSON.parse(o.body) : null),
    caches: { default: { match: () => Promise.resolve(undefined), put: (k, v) => { cachePuts.push(k); return Promise.resolve(); } } },
  };
  box.globalThis = box; box.self = box;
  vm.createContext(box);
  vm.runInContext(source.replace(/^export default\s*\{/m, 'globalThis.__WORKER = {'), box);
  return { worker: box.__WORKER, logs, cachePuts, box };
}
function makeCtx() {
  const waits = [];
  return { waits, waitUntil: (p) => { waits.push(p); if (p && p.then) p.catch(() => {}); }, passThroughOnException: () => {} };
}
const settle = () => new Promise(r => setTimeout(r, 5));
const DIRECTOR = 'TESTDIRECTORKEY';
const ENV = (kv, extra) => Object.assign({ LEADPRO_LICENSES: kv, OPENAI_API_KEY: 'sk-test', REQUIRE_LICENSE: 'false', DIRECTOR_KEYS: DIRECTOR }, extra || {});
const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'Content-Type': 'application/json' } });

const SMS = 'Thanks for reaching out on the Accord. It is here and available to see, and I can have everything ready for you when you arrive so the visit is quick.';
const GOOD = JSON.stringify({ sms: SMS, subject: 'Your Accord',
  email: 'Subject: Your Accord\n\nHi there,\n\nThe Accord is here and ready for you to see whenever works. I can have everything staged so the visit is quick.\n\nJolette',
  voicemail: 'Hi, Jolette at the store about the Accord. It is here and ready whenever you are.' });
const BAD_EMAIL = JSON.stringify({ sms: SMS, subject: 'Your Accord', email: 'subject', voicemail: '' });
const USAGE = { prompt_tokens: 12000, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 7000, cache_write_tokens: 0 } };
const model = (text) => json({ choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: USAGE });
const SYS = 'You are a BDC agent. '.repeat(400);
const USER_PHONE = 'Lead context. '.repeat(400) + '\nCustomer Phone: (555) 010-0199\n';
const genBody = (extra) => Object.assign({
  system_instruction: { parts: [{ text: SYS }] },
  contents: [{ role: 'user', parts: [{ text: 'Lead context. '.repeat(400) }] }],
  generationConfig: { temperature: 0.5, maxOutputTokens: 2500, topP: 0.9, responseMimeType: 'application/json' },
}, extra || {});
const post = (L, env, ctx, body) => L.worker.fetch(new Request('https://p.test/', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, ctx);
const getJ = async (L, env, u) => { const r = await L.worker.fetch(new Request('https://p.test' + u), env, makeCtx()); return { status: r.status, body: await r.json() }; };

(async function () {
  console.log('\n' + path.relative(process.cwd(), PROXY) + ' — proxy v7.77');

  // ── 1. /list-licenses ───────────────────────────────────────────────────────
  console.log('\n1. /list-licenses returns licenses only:');
  const seedLicenses = (kv) => {
    const lic = (i) => 'LP-' + String.fromCharCode(65 + i).repeat(8);
    for (let i = 0; i < 12; i++) kv.store.set(lic(i), JSON.stringify({ agentName: 'Agent ' + i, persona: 'bdc', active: true }));
    kv.store.set('OLDFMT-0001', JSON.stringify({ agentName: 'Legacy', persona: 'bdc', active: true }));
    kv.store.set('lp-aaaaaaaa', JSON.stringify({ agentName: 'Agent 0', persona: 'bdc', active: true }));
    for (let i = 0; i < 6; i++) {
      kv.store.set('commit:2026-09-2' + i + 'T10:00:00.000Z:c' + i, JSON.stringify({ id: 'c' + i, verdict: 'x' }));
      kv.store.set('degen:2026-09-2' + i + 'T10:00:00.000Z:d' + i, JSON.stringify({ requestId: 'd' + i }));
      kv.store.set('feedback:2026-09-2' + i + 'T10:00:00.000Z:f' + i, JSON.stringify({ id: 'f' + i, rating: 'up' }));
      kv.store.set('invite:20800000' + i + ':1758000000000', JSON.stringify({ customerEmail: 'customer' + i + '@example.com', dealerId: '6191' }));
      kv.store.set('perf:2026-09-2' + i + 'T10:00:00.000Z:p' + i, JSON.stringify({ requestId: 'p' + i }));
    }
    return kv;
  };
  const listLicenses = async (kv) => {
    const L = load(src, () => json({}));
    const r = await L.worker.fetch(new Request('https://p.test/list-licenses', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directorKey: DIRECTOR }) }), ENV(kv), makeCtx());
    return { L, b: await r.json() };
  };
  {
    // REALISTIC PAGES (up to 1,000 keys, as KV serves them): the harm v7.76 did.
    const kv = seedLicenses(makeKV());
    check('finding (a property of KV, not of the worker): byte order puts every uppercase LP- key sorts before every lowercase telemetry prefix',
      (() => { const all = [...kv.store.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
               const lastUpper = Math.max(...all.map((k, i) => (k.charCodeAt(0) < 0x61 ? i : -1)));
               const firstLower = all.findIndex(k => k.charCodeAt(0) >= 0x61);
               return lastUpper < firstLower; })(), true);
    const { L, b } = await listLicenses(kv);
    const names = (b.licenses || []).map(x => x.licenseKey).sort();
    check('no telemetry row comes back as a license (commit: degen: feedback: invite: perf:)',
      names.filter(n => /^(commit|degen|feedback|invite|perf):/.test(n)), []);
    check('no customer email anywhere in the response', /@example\.com/.test(JSON.stringify(b)), false);
    check('an older uppercase format is included, flagged and reported — not dropped',
      [(b.licenses || []).some(x => x.licenseKey === 'OLDFMT-0001' && x.keyFormat === 'other'), (b.keyFormats || {}).other], [true, ['OLDFMT-0001']]);
    check('a stray lowercase lp- duplicate is included, flagged and reported',
      [(b.licenses || []).some(x => x.licenseKey === 'lp-aaaaaaaa' && x.keyFormat === 'lowercase'), (b.keyFormats || {}).lowercase], [true, ['lp-aaaaaaaa']]);
    check('one KV read per license and NONE on telemetry rows', [kv.gets.length, kv.gets.filter(k => /:/.test(k)).length], [14, 0]);
    // SMALL PAGES (5 keys each): the cursor is followed to the end.
    const kvS = seedLicenses(makeKV({ pageCap: 5 }));
    const small = await listLicenses(kvS);
    check('all 12 LP- licenses come back across 3 pages of 5',
      (small.b.licenses || []).filter(x => /^LP-/.test(x.licenseKey)).length, 12);
    check('control: a non-director key is refused', (await L.worker.fetch(new Request('https://p.test/list-licenses', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ directorKey: 'LP-NOTADIR' }) }), ENV(kv), makeCtx())).status, 403);
  }

  // ── 2 + 3. feedback summary / range / drafts ─────────────────────────────────
  // Rows keyed exactly as POST /feedback keys them: feedback:<server ISO ts>:<id>.
  const fbRow = (iso, o) => ['feedback:' + iso + ':' + o.id, JSON.stringify(Object.assign({ ts: iso }, o))];
  console.log('\n2. /feedback/summary byScenario:');
  {
    const kv = makeKV();
    const rows = [
      fbRow('2026-09-22T15:00:00.000Z', { id: 'a', rating: 'down', signal: 'explicit', meta: { scenario: 'follow-up', store: 'X' } }),
      fbRow('2026-09-22T15:01:00.000Z', { id: 'b', rating: 'down', signal: 'implicit_regen_no_copy', meta: { scenario: 'follow-up', store: 'X' } }),
      fbRow('2026-09-22T15:02:00.000Z', { id: 'c', rating: 'up', signal: 'explicit', meta: { scenario: 'first-touch', store: 'X' } }),
      fbRow('2026-09-22T15:03:00.000Z', { id: 'd', rating: 'up', signal: 'implicit_copy', meta: { scenario: 'first-touch', store: 'X' } }),
      fbRow('2026-09-22T15:04:00.000Z', { id: 'e', rating: 'abandoned', signal: 'implicit_abandoned', meta: {} }),
      fbRow('2026-09-22T15:05:00.000Z', { id: 'f', rating: 'abandoned', signal: 'implicit_abandoned', meta: { scenario: 'follow-up', store: 'X' } }),
    ];
    rows.forEach(([k, v]) => kv.store.set(k, v));
    const L = load(src, () => json({}));
    const { body: s } = await getJ(L, ENV(kv), '/feedback/summary?date=2026-09-22&key=' + DIRECTOR);
    const sc = s.byScenario || {};
    check('explicit and implicit thumbs-down split per scenario',
      [sc['follow-up'] && sc['follow-up'].explicitDown, sc['follow-up'] && sc['follow-up'].implicitDown], [1, 1]);
    check('explicit thumbs-up counted per scenario', sc['first-touch'] && sc['first-touch'].explicitUp, 1);
    check('the abandoned row with empty meta is INCOMPLETE in its scenario bucket, as in the top line',
      [sc.unknown && sc.unknown.incomplete, sc.unknown && sc.unknown.abandoned], [1, 0]);
    check('control: scenario bucket totals sum to the top-line total (true in v7.76 too; the columns were what drifted)',
      Object.values(sc).reduce((n, x) => n + x.total, 0) === s.total && s.total === 6, true);
    check('...and incomplete / abandoned reconcile too',
      [Object.values(sc).reduce((n, x) => n + x.incomplete, 0), Object.values(sc).reduce((n, x) => n + x.abandoned, 0)],
      [s.ratings ? s.ratings.incomplete : s.incomplete, s.ratings ? s.ratings.abandoned : s.abandoned]);
  }

  console.log('\n3. summary, range and drafts agree on the Central day (9:30 PM Central, across DST):');
  {
    const cases = [
      ['CDT, 9/22 9:30 PM', '2026-09-22', '2026-09-23T02:30:00.000Z'],
      ['DST ends 11/1: 9:30 PM CST', '2026-11-01', '2026-11-02T03:30:00.000Z'],
      ['DST starts 3/8: 9:30 PM CDT', '2026-03-08', '2026-03-09T02:30:00.000Z'],
    ];
    for (const [label, day, iso] of cases) {
      const kv = makeKV();
      const [k, v] = fbRow(iso, { id: 'late', rating: 'up', signal: 'implicit_copy', meta: { scenario: 'follow-up', store: 'X' },
        drafts: { final: { sms: 'x' } } });
      kv.store.set(k, v);
      // a morning row on the NEXT Central day, which also lives under the same UTC-date prefix
      const nextDay = new Date(Date.parse(day + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
      const [k2, v2] = fbRow(nextDay + 'T15:00:00.000Z', { id: 'next', rating: 'down', signal: 'explicit', meta: { scenario: 'follow-up' },
        drafts: { final: { sms: 'y' } } });
      kv.store.set(k2, v2);
      const L = load(src, () => json({}));
      const sum = (await getJ(L, ENV(kv), '/feedback/summary?date=' + day + '&key=' + DIRECTOR)).body;
      const rng = (await getJ(L, ENV(kv), '/feedback/range?from=' + day + '&to=' + nextDay + '&key=' + DIRECTOR)).body;
      const drf = (await getJ(L, ENV(kv), '/feedback/drafts?date=' + day + '&key=' + DIRECTOR)).body;
      check(label + ' — summary, range.byDay and drafts all put it on ' + day + ', and only there',
        { summary: sum.total, range: rng.byDay && rng.byDay[day] && rng.byDay[day].total, next: rng.byDay && rng.byDay[nextDay] && rng.byDay[nextDay].total,
          drafts: drf.count }, { summary: 1, range: 1, next: 1, drafts: 1 });
    }
    const L = load(src, () => json({}));
    const kv = makeKV();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    check('summary with no date= answers Central today, and says which zone',
      await (async () => { const b = (await getJ(L, ENV(kv), '/feedback/summary?key=' + DIRECTOR)).body; return [b.date, b.tz]; })(),
      [today, 'America/Chicago']);
    check('range says which zone too, and a malformed date is a 400, not a silent UTC read',
      [(await getJ(L, ENV(kv), '/feedback/range?from=2026-09-01&to=2026-09-02&key=' + DIRECTOR)).body.tz,
       (await getJ(L, ENV(kv), '/feedback/range?from=9/1/2026&to=2026-09-02&key=' + DIRECTOR)).status], ['America/Chicago', 400]);
  }

  // ── 4. extensionVersion ─────────────────────────────────────────────────────
  console.log('\n4. extensionVersion on /generate:');
  const degenRun = async (source, body) => {
    const kv = makeKV(); let n = 0;
    const L = load(source, () => model(++n === 1 ? BAD_EMAIL : GOOD));
    const ctx = makeCtx();
    const r = await post(L, ENV(kv), ctx, body);
    await settle();
    const dk = [...kv.store.keys()].filter(k => k.startsWith('degen:'));
    return { status: r.status, logs: L.logs, kv, row: dk.length ? JSON.parse(kv.store.get(dk[0])) : null };
  };
  {
    const withV = await degenRun(src, genBody({ extensionVersion: '9.7.706-dev' }));
    check('present: logged on the START line', withV.logs.some(l => / START tokens=.* ext=9\.7\.706-dev$/.test(l)), true);
    check('present: stored on the degen: row', withV.row && withV.row.extensionVersion, '9.7.706-dev');
    const long = await degenRun(src, genBody({ extensionVersion: '9.7.706-dev<script>' + 'x'.repeat(40) }));
    check('clamped to 24 characters of version-string alphabet', long.row && long.row.extensionVersion, '9.7.706-devscriptxxxxxxx');
    const without = await degenRun(src, genBody());
    check('control: absent — the START line is exactly the v7.76 shape (no ext=)',
      without.logs.filter(l => / START tokens=/.test(l)).every(l => / contract=\w+$/.test(l)), true);
    check('control: absent — the degen: row has no extensionVersion key', without.row && Object.prototype.hasOwnProperty.call(without.row, 'extensionVersion'), false);
    if (oldSrc) {
      const old = await degenRun(oldSrc, genBody());
      const norm = (r) => r && JSON.stringify(Object.assign({}, r, { ts: 'T', requestId: 'R', latency: 0 }));
      check('control: absent — the degen: row is byte-identical to v7.76 (ts, id and latency normalised)', norm(without.row), norm(old.row));
    }
  }

  // ── 5. classifier failure ───────────────────────────────────────────────────
  console.log('\n5. a classifier failure is visible:');
  const classRun = async (classifier, extraEnv) => {
    const kv = makeKV();
    const L = load(src, (url, b) => (b && b.model === CLASSIFIER_MODEL) ? classifier() : model(GOOD));
    const ctx = makeCtx();
    const r = await post(L, ENV(kv, extraEnv), ctx, Object.assign(genBody(), { contents: [{ role: 'user', parts: [{ text: USER_PHONE }] }] }));
    const body = await r.json();
    await settle();
    const pk = [...kv.store.keys()].filter(k => k.startsWith('perf:'));
    return { body, logs: L.logs, cachePuts: L.cachePuts, perf: pk.length ? JSON.parse(kv.store.get(pk[0])) : null, kv };
  };
  {
    const f = await classRun(() => json({ error: { message: 'bad request' } }, 400));
    check('a 400 is logged on its own CLASSIFY FAILED line with the status', f.logs.some(l => /CLASSIFY FAILED sms=HTTP 400 email=HTTP 400/.test(l)), true);
    check('...the diag says FAILED, not NO', [f.body._classify, /sms=NO/.test(f.body._classify)], ['sms=FAILED email=FAILED phoneOnFile=true', false]);
    check('...classifyFailed=true on the FINAL line', f.logs.some(l => /FINAL .*classifyFailed=true/.test(l)), true);
    check('...the edge cache does not store it', f.cachePuts.length, 0);
    check('control: ...and the primary draft is kept (no regen) — behaviour on failure is unchanged', [f.body._regenerated === true, JSON.parse(f.body.candidates[0].content.parts[0].text).sms], [false, SMS]);
    check('...and the perf row says the classifier failed', f.perf && f.perf.classifier, 'failed');
    const t = await classRun(() => Promise.reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })));
    check('a thrown call (timeout) is a failure too, named', t.logs.some(l => /CLASSIFY FAILED sms=timeout email=timeout/.test(l)), true);
    const ok = await classRun(() => json({ choices: [{ message: { content: 'NO' } }] }));
    check('control: a real NO is still NO, classifyFailed=false, and it caches',
      [ok.body._classify, ok.logs.some(l => /classifyFailed=false/.test(l)), ok.cachePuts.length], ['sms=NO email=NO phoneOnFile=true', true, 1]);
  }

  // ── 6. perf: rows and GET /perf ─────────────────────────────────────────────
  console.log('\n6. perf: rows and GET /perf:');
  {
    const ok = await classRun(() => json({ choices: [{ message: { content: 'NO' } }] }));
    const pk = [...ok.kv.store.keys()].filter(k => k.startsWith('perf:'));
    check('one perf: row per generation, keyed perf:<ts>:<requestId>, 14-day TTL',
      [pk.length, /^perf:\d{4}-\d\d-\d\dT[\d:.]+Z:[0-9a-f-]{36}$/.test(pk[0]), ok.kv.meta.get(pk[0])], [1, true, { expirationTtl: 1209600 }]);
    const p = ok.perf || {};
    check('it carries the fields asked for', Object.keys(p), ['ts', 'requestId', 'extensionVersion', 'contract', 'tier', 'model', 'latency', 'total',
      'sysChars', 'userChars', 'promptTokens', 'cachedTokens', 'writtenTokens', 'edgeCache', 'classifier', 'prefilterWouldSkip', 'prefilterMiss',
      'regenerated', 'regenRejected']);
    check('...with real values', [p.tier, p.contract, p.promptTokens, p.cachedTokens, p.writtenTokens, p.edgeCache, p.classifier, typeof p.prefilterWouldSkip, p.sysChars],
      ['primary', 'draft', 12000, 7000, 0, 'MISS', 'ran', 'boolean', SYS.length]);
    check('control: ...and no prompt text, phone or draft content', /BDC agent|Lead context|010-0199|Accord/.test(JSON.stringify(p)), false);
    const noKv = await (async () => { const kv = makeKV({ putThrows: true }); const L = load(src, () => model(GOOD));
      const r = await post(L, ENV(kv), makeCtx(), genBody()); await settle(); return r.status; })();
    check('control: a failing KV write never breaks the generation', noKv, 200);
    const off = await classRun(() => json({ choices: [{ message: { content: 'NO' } }] }), { PERF_ROWS: 'off' });
    check('control: PERF_ROWS=off writes none', off.perf, null);
    const factDraftOnly = await (async () => { const kv = makeKV(); const L = load(src, () => model(JSON.stringify({ kind: 'none', evidence: '' })));
      await post(L, ENV(kv, { PERF_ROWS: 'draft' }), makeCtx(), genBody({ responseContract: 'fact' })); await settle();
      return [...kv.store.keys()].filter(k => k.startsWith('perf:')).length; })();
    check("control: PERF_ROWS=draft skips the fact probes", factDraftOnly, 0);
    const exhausted = await (async () => { const kv = makeKV(); const L = load(src, () => json({ error: { message: 'x' } }, 500));
      await post(L, ENV(kv), makeCtx(), genBody()); await settle();
      const k = [...kv.store.keys()].find(x => x.startsWith('perf:')); return k ? JSON.parse(kv.store.get(k)).tier : null; })();
    check('an exhausted cascade still writes its row (tier "exhausted")', exhausted, 'exhausted');
    const hit = await (async () => { const kv = makeKV(); const L = load(src, () => model(GOOD));
      L.box.caches.default.match = () => Promise.resolve(json({ candidates: [] }));
      await post(L, ENV(kv), makeCtx(), genBody()); await settle();
      const k = [...kv.store.keys()].find(x => x.startsWith('perf:')); return k ? JSON.parse(kv.store.get(k)) : null; })();
    check('an edge-cache HIT writes a row too (tier "edge", edgeCache HIT)', hit && [hit.tier, hit.edgeCache], ['edge', 'HIT']);

    // GET /perf over a day of rows
    const kv = makeKV();
    const day = '2026-09-22';
    const rows = [
      { tier: 'primary', contract: 'draft', sysChars: 25000, promptTokens: 15000, cachedTokens: 4000, writtenTokens: 0, edgeCache: 'MISS', classifier: 'ran', prefilterWouldSkip: true, prefilterMiss: false },
      { tier: 'primary', contract: 'draft', sysChars: 24000, promptTokens: 16000, cachedTokens: 0, writtenTokens: 5000, edgeCache: 'BYPASS', classifier: 'skipped', prefilterWouldSkip: null, prefilterMiss: null },
      { tier: 'primary', contract: 'draft', sysChars: 32500, promptTokens: 15000, cachedTokens: 6000, writtenTokens: 0, edgeCache: 'MISS', classifier: 'ran', prefilterWouldSkip: false, prefilterMiss: true },
      { tier: 'fallback', contract: 'draft', sysChars: 32500, promptTokens: 15000, cachedTokens: 0, writtenTokens: 0, edgeCache: 'MISS', classifier: 'failed', prefilterWouldSkip: null, prefilterMiss: null },
      { tier: 'primary', contract: 'fact', sysChars: 3000, promptTokens: 2000, cachedTokens: 1500, writtenTokens: 0, edgeCache: 'MISS', classifier: null },
      { tier: 'edge', contract: 'draft', sysChars: 32500, edgeCache: 'HIT' },
    ];
    rows.forEach((r, i) => { const ts = '2026-09-22T1' + i + ':00:00.000Z'; kv.store.set('perf:' + ts + ':r' + i, JSON.stringify(Object.assign({ ts, requestId: 'r' + i }, r))); });
    kv.store.set('perf:2026-09-23T02:30:00.000Z:late', JSON.stringify({ ts: '2026-09-23T02:30:00.000Z', requestId: 'late', tier: 'primary', contract: 'draft', edgeCache: 'MISS' }));
    kv.store.set('perf:2026-09-23T12:00:00.000Z:next', JSON.stringify({ ts: '2026-09-23T12:00:00.000Z', requestId: 'next', tier: 'primary', contract: 'draft' }));
    const L = load(src, () => json({}));
    check('GET /perf is director-gated', (await getJ(L, ENV(kv), '/perf?date=' + day)).status, 403);
    const g = (await getJ(L, ENV(kv), '/perf?date=' + day + '&key=' + DIRECTOR)).body;
    check('it returns the Central day\'s rows (9:30 PM Central included, next morning excluded)', g.count, 7);
    const t = g.tallies || {};
    const band = (t.tokensBySysCharsBand || {}); const pre = band.preM4 || {}, postB = band.postM4 || {};
    check('calls per tier', t.byTier, { primary: 5, fallback: 1, edge: 1 });
    check('edge-cache HIT / MISS / BYPASS', t.edgeCache, { HIT: 1, MISS: 5, BYPASS: 1 });
    check('classifier ran / skipped / failed', t.classifier, { ran: 2, skipped: 1, failed: 1 });
    check('prefilter wouldSkip rate and miss count', t.prefilter, { evaluated: 2, wouldSkip: 1, wouldSkipRate: 50, miss: 1 });
    check('tokens by sysChars band: primary-tier DRAFTS only, pre-M4 vs post-M4',
      [pre.calls, pre.cachedMedian, pre.uncachedMean, postB.calls, postB.cachedMean, postB.uncachedMedian],
      [2, 2000, 13500, 1, 6000, 9000]);
  }

  // ── 7. safe fallback ────────────────────────────────────────────────────────
  console.log('\n7. the safe-fallback text:');
  {
    const kv = makeKV();
    const L = load(src, () => json({ error: { message: 'x' } }, 500));
    const r = await post(L, ENV(kv), makeCtx(), genBody());
    const b = await r.json();
    const text = b.candidates && b.candidates[0].content.parts[0].text;
    const p = JSON.parse(text);
    check('control: still the three-field shape an older client parses, flagged _fallback', [Object.keys(p).sort(), b.candidates[0]._fallback], [['email', 'sms', 'voicemail'], true]);
    check('no "today or tomorrow", no "come in", no visit', /today or tomorrow|come in|visit/i.test(text), false);
    check('no bracket placeholders', /\[[^\]]*\]/.test(text), false);
    check('the SMS is the neutral line', p.sms, "Thanks for reaching out. I'm pulling your information together and will follow up shortly.");
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL suite threw: ' + (e && e.stack || e)); process.exit(1); });
