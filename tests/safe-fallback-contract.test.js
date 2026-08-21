#!/usr/bin/env node
'use strict';
/**
 * safe-fallback-contract.test.js — v9.7.564 / proxy v7.58 / reporter v1.16.
 *
 * THE INCIDENT, RECONSTRUCTED FROM THE SHIPPED BYTES RATHER THAN DESCRIBED.
 *
 * 8/21, 15:04-16:02 UTC: 17 requests failed all three model tiers and returned SAFE_FALLBACK —
 * the canned placeholder with unfilled [Agent]/[Store]. The reported question was whether real
 * customers received it. They did not, and none of the 17 was a customer draft: every one carries
 * cacheKey=lp_fd4886ea, and that is promptCacheKey() of the OBSERVER PROBE's own system string.
 * The first assertion below computes it with the hash function sliced out of the shipped worker,
 * so the attribution is arithmetic, not inference. In the same window the 71 real generations
 * (lp_773499b2) were 71/71 OK. The partition is perfect.
 *
 * ROOT CAUSE: MIN_CONTENT_CHARS is 150 and applied to every response at every tier. The probe's
 * CORRECT answer, {"kind":"none","note":null,"quote":null}, is 40 characters. Every possible
 * correct probe answer is under the floor, so all three tiers rejected it as "Empty response
 * (finish=stop)", deterministically, on every probe ever sent. Not a rate limit, not a quota, not
 * a provider issue, and not token starvation — spec.tokens is set on all three tiers and shadows
 * callerMax, so the logged tokens=300 never reached OpenAI. Asserted below, all of it.
 *
 * WORSE THAN THE FAILURE: SAFE_FALLBACK_TEXT is VALID JSON. The observer parsed it, found no
 * "kind" key, defaulted to 'none', and persisted a canned customer apology as "the comprehension
 * pass read the notes and found no commitment". The floor predates the observer, so this is true
 * of EVERY comprehension row ever collected — the corpus is empty, not thin.
 *
 * WHAT THIS SUITE PINS, so no future build can quietly re-open any of it:
 *   1. The probe's system string still hashes to the key that identifies these 17 requests.
 *   2. Every probe answer shape is under the draft floor — that is WHY a contract is needed.
 *   3. The draft contract is byte-for-byte unchanged: same floor, same degenerate guard.
 *   4. The fact contract still rejects everything the length floor was really catching.
 *   5. An unknown, absent or malformed contract falls back to 'draft' — the strict default.
 *   6. A non-draft contract receives NO candidates array, so there is nothing to misread.
 *   7. Both observer nets fire, and net two fires WITHOUT any proxy cooperation.
 *   8. Net two does not over-fire on a real answer, including an unknown `kind` value.
 *
 * Sliced out of the SHIPPED files. Both extension builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const args   = process.argv.slice(2);
const BUILDS = args.filter(a => /popup\.js$/.test(a));
const PROXY  = args.find(a => /cloudflare-worker/.test(a)) || 'worker/cloudflare-worker-v7.58.js';
if (!BUILDS.length) {
  console.error('usage: safe-fallback-contract.test.js <popup.js...> [cloudflare-worker.js]');
  process.exit(2);
}
const proxySrc = fs.readFileSync(path.resolve(PROXY), 'utf8');
const FIX = p => fs.readFileSync(path.join(__dirname, 'fixtures', p), 'utf8');
const JASON = FIX('jason-pellegrin-context.txt');

// ── The worker's own guards, sliced and runnable ───────────────────────────────
function workerApi() {
  const at = n => { const i = proxySrc.indexOf(n); if (i < 0) throw new Error('missing ' + n + ' in proxy'); return i; };
  const sandbox = { console: { log() {}, warn() {} }, JSON, String, Number, Object, Array, Math };
  vm.createContext(sandbox);
  // promptCacheKey + the contract helpers + the degenerate guard, verbatim.
  const spans = [
    [at('function promptCacheKey('), at('function logCacheHit(')],
    [at('const MIN_CONTENT_CHARS  = 150;'), at('const CLASSIFIER_MODEL')],
  ];
  spans.forEach(([a, b]) => vm.runInContext(proxySrc.slice(a, b), sandbox));
  // CACHE_KEY_PREFIX lives elsewhere; take it from the file rather than assuming it.
  const pfx = (proxySrc.match(/const CACHE_KEY_PREFIX\s*=\s*'([^']+)'/) || [, 'lp'])[1];
  vm.runInContext(`const CACHE_KEY_PREFIX = '${pfx}';`, sandbox);
  vm.runInContext(proxySrc.slice(at('function promptCacheKey('), at('function logCacheHit(')), sandbox);
  return vm.runInContext(
    '({ key: promptCacheKey, normalize: normalizeContract, factFail: factContractFailure,'
    + '  MIN: MIN_CONTENT_CHARS, CONTRACTS: RESPONSE_CONTRACTS })', sandbox);
}

// ── The extension's observer, sliced and runnable ──────────────────────────────
function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const at = n => { const i = src.indexOf(n); if (i < 0) throw new Error('missing ' + n + ' in ' + file); return i; };
  const spans = [
    [at('var LP_SCAFFOLD_LINE_RE ='), at('// (v9.7.429/427) ONE definition of')],
    [at('var LP_CRM_ENTRY_SPLIT_RE ='), at('// ── (v9.7.560) NOTE TYPES')],
    [at('// ── (v9.7.560) NOTE TYPES'), at('// ── (v9.7.561) PHASE A')],
    [at('// ── (v9.7.558) COMPREHENSION PASS'), at('// (v9.7.559) DURABLE, NOT EPHEMERAL')],
  ];
  return {
    name: path.basename(path.dirname(file)), src,
    // Drive the real observer with a stubbed fetch returning `body`, and capture what it logged,
    // what it resolved to, and what it tried to persist.
    run: (ctx, verdict, body, extra) => {
      const logs = [];
      const sent = [];
      const sandbox = {
        console: { log: (...x) => logs.push(x.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' ')) },
        window: {}, JSON, Promise, Date, String, Number, Object, Array, RegExp, Math,
      };
      vm.createContext(sandbox);
      spans.forEach(([a, b]) => vm.runInContext(src.slice(a, b), sandbox));
      const run = vm.runInContext('(function(c,v,d){ return _lpRunCommitComprehension(c,v,d); })', sandbox);
      const payloads = [];
      const deps = Object.assign({
        endpoint: { url: 'https://proxy.test/' },
        log: (...x) => logs.push(x.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' ')),
        send: (r) => sent.push(r),
        fetch: (url, opts) => {
          try { payloads.push(JSON.parse(opts.body)); } catch (e) { payloads.push(null); }
          const data = typeof body === 'string'
            ? { candidates: [{ content: { parts: [{ text: body }] } }] }
            : body;
          return Promise.resolve({ json: () => Promise.resolve(data) });
        },
      }, extra || {});
      return run(ctx, verdict, deps).then(result => ({ logs, sent, payloads, result }));
    },
  };
}

const impls = BUILDS.map(extract);
const W = workerApi();

let pass = 0, fail = 0;
const pending = [];
function report(name, results, want) {
  const agree = results.every(r => r === results[0]);
  const ok = agree && results[0] === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; console.log('  FAIL ' + name);
    if (!agree) impls.forEach((i, n) => console.log('        ' + i.name + ' -> ' + results[n]));
    else console.log('        expected ' + JSON.stringify(want) + '\n        got      ' + results[0]);
  }
}
function check(name, fn, want) {
  report(name, impls.map(i => { try { return JSON.stringify(fn(i)); } catch (e) { return 'THREW: ' + e.message; } }), want);
}
function one(name, value, want) {
  const got = (() => { try { return JSON.stringify(value()); } catch (e) { return 'THREW: ' + e.message; } })();
  const ok = got === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + JSON.stringify(want) + '\n        got      ' + got); }
}
function checkAsync(name, fn, want) {
  pending.push(async () => {
    let results;
    try { results = await Promise.all(impls.map(async i => JSON.stringify(await fn(i)))); }
    catch (e) { results = ['THREW: ' + e.message]; }
    report(name, results, want);
  });
}
function section(t) { pending.push(async () => console.log('\n' + t)); }
// Queued forms, so a heading printed via section() actually precedes the checks under it.
function pOne(name, value, want) { pending.push(async () => one(name, value, want)); }
function pCheck(name, fn, want)  { pending.push(async () => check(name, fn, want)); }

// STRIP COMMENTS BEFORE ASSERTING ON CODE. Learned the hard way twice now: a check that counts
// occurrences of a symbol counts the ones in the prose ABOUT that symbol too, so an explanatory
// comment — or this build's own changelog header — fails a check that claims to measure code.
function stripComments(t) {
  return String(t).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}
const PROXY_CODE = stripComments(proxySrc);

// The probe's system string, read out of the SHIPPED extension rather than retyped — if a future
// build edits it, the cacheKey assertion below changes with it and says so.
const PROBE_SYSTEM = (impls[0].src.match(
  /system_instruction: \{ parts: \[\{ text: '([^']+)' \}\] \},\s*\n\s*contents: \[\{ role: 'user', parts: \[\{ text: _lpBuildCommitProbe/) || [, ''])[1];

// The exact bytes the proxy returns when every tier fails, read out of the SHIPPED proxy.
const SAFE_FALLBACK_TEXT = (() => {
  const a = proxySrc.indexOf('const SAFE_FALLBACK_TEXT = JSON.stringify({');
  const b = proxySrc.indexOf('});', a) + 3;
  const sandbox = { JSON, out: null };
  vm.createContext(sandbox);
  vm.runInContext(proxySrc.slice(a, b).replace('const SAFE_FALLBACK_TEXT =', 'out ='), sandbox);
  return sandbox.out;
})();

console.log('\nv9.7.564 / v7.58 — the 17 SAFE_FALLBACKs were the observer probe, not customer drafts');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── 1. The attribution, computed ───────────────────────────────────────────────
console.log('the 17 requests are identified arithmetically, not by inference:');

one('the probe system string is still present in the shipped extension',
  () => PROBE_SYSTEM.slice(0, 40), 'You extract one fact from CRM notes and ');

one('promptCacheKey(probe system) === lp_fd4886ea — the key on all 17 failing requests',
  () => W.key(PROBE_SYSTEM), 'lp_fd4886ea');

one('a customer draft prompt hashes to a DIFFERENT key, so the partition is real',
  () => W.key('\n━━━ YOUR JOB ━━━\nYou are the best BD agent this customer has ever dealt with')
        !== 'lp_fd4886ea', true);

// promptCacheKey deliberately hashes only the first 200 chars (v7.39 reverted a change that
// hashed the whole prompt), so it is a prompt-FAMILY id. The probe's system string is only 93
// chars, so it is hashed in full — which is why appending to it DOES move the key, and why the
// 200-char property has to be demonstrated on a string long enough to exercise it.
one('promptCacheKey hashes only the first 200 chars, so the key is a prompt-FAMILY id',
  () => {
    const head = 'x'.repeat(220);
    return { longPrefixShared: W.key(head + 'AAA') === W.key(head + 'BBB'),
             probeSystemLen: PROBE_SYSTEM.length,
             probeHashedInFull: PROBE_SYSTEM.length < 200 };
  }, { longPrefixShared: true, probeSystemLen: 93, probeHashedInFull: true });

// ── 2. Why every probe failed ──────────────────────────────────────────────────
console.log('\nwhy every probe failed — the floor is a DRAFT floor:');

one('MIN_CONTENT_CHARS is 150', () => W.MIN, 150);

const PROBE_ANSWERS = {
  none: JSON.stringify({ kind: 'none', note: null, quote: null }),
  soft: JSON.stringify({ kind: 'soft', note: 2, quote: 'he said he would try to swing by' }),
  firm: JSON.stringify({ kind: 'firm', note: 3, quote: 'coming in Saturday to look at the truck' }),
  firmLong: JSON.stringify({ kind: 'firm', note: 1,
    quote: 'he said he would come in Saturday morning to look at the truck and get his trade appraised' }),
};
one('every correct probe answer shape is UNDER the draft floor — this is the whole bug',
  () => Object.keys(PROBE_ANSWERS).map(k => ({ shape: k, len: PROBE_ANSWERS[k].length,
                                               rejectedByDraftFloor: PROBE_ANSWERS[k].length < W.MIN })),
  [{ shape: 'none',     len: 40,  rejectedByDraftFloor: true },
   { shape: 'soft',     len: 67,  rejectedByDraftFloor: true },
   { shape: 'firm',     len: 74,  rejectedByDraftFloor: true },
   { shape: 'firmLong', len: 125, rejectedByDraftFloor: true }]);

one('spec.tokens is set on ALL THREE tiers, so the logged tokens=300 never reached OpenAI',
  () => (proxySrc.match(/const MODEL_CASCADE = \[([\s\S]*?)\];/) || [, ''])[1]
    .match(/tokens:\s*(\d+)/g).map(x => Number(x.replace(/\D/g, ''))),
  [3500, 3500, 2000]);

one('...and the START line now says so, so tokens=300 cannot mislead the next reader',
  () => /tokens=\$\{callerMax\}\(caller; tiers use spec\.tokens\)/.test(proxySrc), true);

// ── 3. The fabrication ─────────────────────────────────────────────────────────
console.log('\nthe fabrication — a canned draft read as a verdict:');

one('SAFE_FALLBACK_TEXT is VALID JSON, which is why nothing caught this',
  () => { try { return typeof JSON.parse(SAFE_FALLBACK_TEXT) === 'object'; } catch (e) { return false; } }, true);

one('...and it carries no "kind" key, so the old code read kind:none off a customer apology',
  () => Object.prototype.hasOwnProperty.call(JSON.parse(SAFE_FALLBACK_TEXT), 'kind'), false);

one('the placeholder really is unfilled — [Agent] and [Store] are in the shipped text',
  () => /\[Agent\]/.test(SAFE_FALLBACK_TEXT) && /\[Store\]/.test(SAFE_FALLBACK_TEXT), true);

one('the OLD delta logic turns that into AGREE-NONE — reproduced, not asserted from memory',
  () => {
    const p = JSON.parse(SAFE_FALLBACK_TEXT);
    const kind = (p.kind === 'firm' || p.kind === 'soft') ? p.kind : 'none';   // the v9.7.563 line
    const compFired = (kind === 'firm' || kind === 'soft');
    return (!false && !compFired) ? 'AGREE-NONE' : 'other';
  }, 'AGREE-NONE');

// ── 4. The contract, worker side ───────────────────────────────────────────────
console.log('\nthe contract — strict by default, loose only when asked by name:');

one('the known contracts are exactly draft and fact', () => W.CONTRACTS, ['draft', 'fact']);

one('absent, unknown, malformed and hostile values ALL fall back to draft',
  () => [undefined, null, '', 'fact ', 'FACT', 'none', 0, {}, [], 'draft'].map(v => W.normalize(v)),
  ['draft', 'draft', 'draft', 'draft', 'draft', 'draft', 'draft', 'draft', 'draft', 'draft']);

one('only the exact string "fact" selects the loose contract',
  () => W.normalize('fact'), 'fact');

one('the fact floor still rejects everything the length floor was really catching',
  () => [['', 'empty'], ['{}', 'empty object'], ['[]', 'array'], ['{', 'bare brace'],
         ['   ', 'whitespace'], ['not json at all', 'prose']]
    .map(([t, label]) => ({ input: label, rejected: W.factFail(t) !== null })),
  [{ input: 'empty', rejected: true }, { input: 'empty object', rejected: true },
   { input: 'array', rejected: true }, { input: 'bare brace', rejected: true },
   { input: 'whitespace', rejected: true }, { input: 'prose', rejected: true }]);

one('the fact floor ACCEPTS every real probe answer — the point of the whole change',
  () => Object.keys(PROBE_ANSWERS).map(k => W.factFail(PROBE_ANSWERS[k])),
  [null, null, null, null]);

one('the draft path still applies MIN_CONTENT_CHARS, unchanged and unguarded by anything else',
  () => /if \(_contract === RESPONSE_CONTRACT_DRAFT\) \{\s*\n\s*if \(text\.length < MIN_CONTENT_CHARS\)/.test(proxySrc), true);

one('the degenerate-field guard runs on the draft contract only — it judges sms/email/voicemail',
  () => /const degenerate = \(_contract === RESPONSE_CONTRACT_DRAFT && isLikelyJson\(text\)\)/.test(proxySrc), true);

one('isParseableJson applies to BOTH contracts — any JSON contract requires JSON',
  () => {
    const a = proxySrc.indexOf('if (!isParseableJson(text)) {');
    const before = proxySrc.slice(Math.max(0, a - 400), a);
    return a > 0 && !/_contract ===/.test(before);
  }, true);

one('callOpenAI defaults its own contract too — a caller that forgets gets the strict path',
  () => /const _contract = normalizeContract\(contract\);/.test(proxySrc), true);

// ── 5. No draft consolation prize for a non-draft caller ───────────────────────
console.log('\na non-draft contract never receives a draft:');

one('safeFallback branches on contract BEFORE it serves SAFE_FALLBACK_TEXT',
  () => {
    const fn = PROXY_CODE.slice(PROXY_CODE.indexOf('function safeFallback('),
                                PROXY_CODE.indexOf('function corsResponse('));
    const branch = fn.indexOf('if (contract !== RESPONSE_CONTRACT_DRAFT)');
    const serve  = fn.indexOf('SAFE_FALLBACK_TEXT');
    return branch > 0 && serve > 0 && branch < serve;
  }, true);

one('the non-draft failure envelope carries NO candidates array at all',
  () => {
    const fn = proxySrc.slice(proxySrc.indexOf('if (contract !== RESPONSE_CONTRACT_DRAFT)'),
                              proxySrc.indexOf("console.warn(`[${requestId}] SAFE_FALLBACK after"));
    return { hasCandidates: /candidates/.test(fn), hasFallbackFlag: /_fallback:\s*true/.test(fn),
             hasError: /error:\s*'All model tiers failed'/.test(fn) };
  }, { hasCandidates: false, hasFallbackFlag: true, hasError: true });

one('the call site passes the contract through — the branch is reachable',
  () => /return safeFallback\(requestId, startTime, \{ lastError, lastTier, lastModel, contract \}\);/.test(proxySrc), true);

one('the draft path still returns the safe fallback exactly as before',
  () => {
    const fn = proxySrc.slice(proxySrc.indexOf("console.warn(`[${requestId}] SAFE_FALLBACK after"),
                              proxySrc.indexOf('function corsResponse('));
    return /_fallback:\s*true/.test(fn) && /text: SAFE_FALLBACK_TEXT/.test(fn);
  }, true);

// ── 6. The observer's two nets ─────────────────────────────────────────────────
section('the observer\'s two nets — either one alone would have caught this:');

const V = { fired: false, quote: '', ran: true };

checkAsync('NET ONE — a proxy SAFE_FALLBACK envelope is refused, not read',
  async i => {
    const r = await i.run(JASON, V, {
      candidates: [{ content: { parts: [{ text: SAFE_FALLBACK_TEXT }] },
                     _fallback: true, _lastError: 'Empty response (finish=stop)' }],
    });
    return { delta: r.result.delta, probeOk: r.result.probeOk,
             reason: /SAFE_FALLBACK/.test(r.result.probeFailReason) };
  }, { delta: 'PROBE-FAILED', probeOk: false, reason: true });

checkAsync('NET TWO — the SAME text with NO _fallback marker is still refused',
  async i => {
    // This is the assertion that matters most: it needs no cooperation from the proxy at all.
    // An old proxy, a proxy that forgets the flag, a future envelope change — net two holds.
    const r = await i.run(JASON, V, SAFE_FALLBACK_TEXT);
    return { delta: r.result.delta, probeOk: r.result.probeOk,
             reason: /no "kind" field/.test(r.result.probeFailReason) };
  }, { delta: 'PROBE-FAILED', probeOk: false, reason: true });

checkAsync('the v7.58 no-candidates failure envelope is refused too',
  async i => {
    const r = await i.run(JASON, V, { error: 'All model tiers failed', _fallback: true,
                                      _contract: 'fact', _lastError: 'Empty response (finish=stop)' });
    return r.result.delta;
  }, 'PROBE-FAILED');

checkAsync('a PROBE-FAILED row IS persisted — a dead probe has to be countable',
  async i => {
    const r = await i.run(JASON, V, SAFE_FALLBACK_TEXT);
    return { sent: r.sent.length, delta: r.sent[0] && r.sent[0].delta,
             probeOk: r.sent[0] && r.sent[0].probeOk };
  }, { sent: 1, delta: 'PROBE-FAILED', probeOk: false });

checkAsync('the log says plainly that this is NOT agreement',
  async i => {
    const r = await i.run(JASON, V, SAFE_FALLBACK_TEXT);
    return r.logs.filter(l => /PROBE-FAILED/.test(l) && /NOT agreement/.test(l)).length;
  }, 1);

checkAsync('a genuine "none" answer still reads AGREE-NONE and is marked probeOk',
  async i => {
    const r = await i.run(JASON, V, PROBE_ANSWERS.none);
    return { delta: r.result.delta, probeOk: r.result.probeOk };
  }, { delta: 'AGREE-NONE', probeOk: true });

checkAsync('net two does NOT over-fire on an unknown kind value — the key is present',
  async i => {
    const r = await i.run(JASON, V, '{"kind":"maybe","note":1,"quote":"something"}');
    return { delta: r.result.delta, kind: r.result.kind, probeOk: r.result.probeOk };
  }, { delta: 'AGREE-NONE', kind: 'none', probeOk: true });

checkAsync('net two does NOT over-fire on a kind of null — still an answer to the question asked',
  async i => {
    const r = await i.run(JASON, V, '{"kind":null,"note":null,"quote":null}');
    return { delta: r.result.delta, probeOk: r.result.probeOk };
  }, { delta: 'AGREE-NONE', probeOk: true });

checkAsync('a fenced ```json answer still reaches the parser past both nets',
  async i => (await i.run(JASON, V, '```json\n' + PROBE_ANSWERS.none + '\n```')).result.delta,
  'AGREE-NONE');

// ── 7. The probe declares its contract ─────────────────────────────────────────
section('the probe declares its contract:');

pCheck('the shipped probe payload sends responseContract: fact',
  i => /responseContract: 'fact'/.test(i.src), true);

pCheck('...inside the probe payload specifically, not somewhere unrelated',
  i => {
    const a = i.src.indexOf("var payload = {\n      system_instruction: { parts: [{ text: 'You extract one fact");
    const b = i.src.indexOf('return _fetch(_endpoint.url,', a);
    return a > 0 && b > a && /responseContract: 'fact'/.test(i.src.slice(a, b));
  }, true);

pCheck('the probe payload is the ONLY place the extension declares a non-draft contract',
  i => (stripComments(i.src).match(/responseContract:/g) || []).length, 1);

checkAsync('the contract really rides on the wire, not just in the source',
  async i => {
    const r = await i.run(JASON, V, PROBE_ANSWERS.none);
    return r.payloads[0] && r.payloads[0].responseContract;
  }, 'fact');

// ── 8. requestId correlation ───────────────────────────────────────────────────
section('feedback-to-generation correlation, which was genuinely impossible before:');

pOne('the proxy returns _requestId on the SUCCESS envelope, not only the fallback one',
  () => /envelope\._requestId = requestId;/.test(proxySrc), true);

pOne('the proxy stores workerRequestId on a feedback row when one is sent',
  () => /\.\.\.\(fb\.workerRequestId \? \{ workerRequestId: String\(fb\.workerRequestId\)\.slice\(0, 64\) \} : \{\}\)/.test(proxySrc), true);

pCheck('the extension captures it off the generation response',
  i => /_lpFeedback\.workerRequestId = String\(data\._requestId\)\.slice\(0, 64\);/.test(i.src), true);

pCheck('the extension sends it on the feedback row when present',
  i => /if \(_lpFeedback\.workerRequestId\) payload\.workerRequestId = _lpFeedback\.workerRequestId;/.test(i.src), true);

pCheck('IT IS CLEARED ON RESET — a generate that errors must not stamp the next lead\'s row',
  i => {
    // The v9.7.562/563 stale-global class, in a correlation field, where a wrong value is worse
    // than a missing one. The clear must live in _lpFeedbackReset, not only at the capture site.
    const a = i.src.indexOf('function _lpFeedbackReset(');
    const b = i.src.indexOf('function _lpFeedbackCaptureMeta', a);
    return a > 0 && b > a && /_lpFeedback\.workerRequestId = '';/.test(i.src.slice(a, b));
  }, true);

// ── 9. What did NOT change ─────────────────────────────────────────────────────
section('what did NOT change — the draft path is the one nobody was allowed to loosen:');

pOne('the draft floor constant is untouched at 150', () => W.MIN, 150);

pOne('the degenerate guard is not model-gated — it never was, and Luna needs no exception',
  () => {
    const fn = PROXY_CODE.slice(PROXY_CODE.indexOf('function hasDegenerateField('),
                                PROXY_CODE.indexOf('function isParseableJson('));
    return fn.length > 200 && /luna|gpt-5|gpt-4/i.test(fn);
  }, false);

pOne('the guard still catches the nested {"subject":...} shape the 8/21 PRIMARY failures hit',
  () => {
    const at = n => proxySrc.indexOf(n);
    const sandbox = { console: { log() {}, warn() {} }, JSON, String, Number, Object, Array, Math };
    vm.createContext(sandbox);
    vm.runInContext(proxySrc.slice(at('const MIN_CONTENT_CHARS  = 150;'), at('const CLASSIFIER_MODEL')), sandbox);
    vm.runInContext(proxySrc.slice(at('function isLikelyJson('), at('function isParseableJson(')), sandbox);
    const bad = JSON.stringify({
      sms: 'Real text here that is long enough to be a genuine message body.',
      email: '{"subject":"2026 Tacoma i-FORCE MAX details","body":"..."}',
      voicemail: 'Hi, this is a real voicemail script with enough content in it.',
    });
    const d = vm.runInContext('hasDegenerateField', sandbox)(bad);
    return { caught: !!d, field: d && d.field };
  }, { caught: true, field: 'email' });

pOne('the draft path is what an absent contract gets, so no existing caller changed behaviour',
  () => W.normalize(undefined), 'draft');

pCheck('the extension still refuses to RENDER a SAFE_FALLBACK draft (v9.7.379/377 W4, untouched)',
  i => (i.src.match(/candidates\[0\]\._fallback/g) || []).length >= 3, true);

(async () => {
  for (const p of pending) await p();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
