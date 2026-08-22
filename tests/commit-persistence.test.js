#!/usr/bin/env node
'use strict';
/**
 * commit-persistence.test.js — v9.7.559 / proxy v7.55 / reporter v1.13.
 *
 * The Phase 2 observer logged to console only, which defeated its own purpose: the plan is to
 * read delta counts off LIVE traffic to decide whether the comprehension pass is ever trusted,
 * and a DevTools line nobody exports cannot produce a sample. This makes it durable.
 *
 * Three pieces, all exercised here against the SHIPPED bytes of each file:
 *   extension  _lpSendCommitComprehension  — POST, fire-and-forget, same shape as _lpFeedbackSend
 *   proxy      POST /commit-comprehension  — same validation discipline + 90-day TTL as /feedback
 *   reporter   Commit Comprehension section — agree/disagree counts and rate
 *
 * THE TWO THINGS THAT MATTER MOST, and both are proven rather than asserted:
 *
 *   FIRE-AND-FORGET IS REAL. A POST that hangs forever, or rejects, must not delay or alter the
 *   observer's own result or the generate flow. Tested by handing the sender a fetch that never
 *   resolves and one that throws synchronously, then checking the observer still resolves with
 *   its verdict.
 *
 *   THE PRIVACY POSTURE IS v9.7.489's, NOT A NEW ONE. The payload carries CRM record locators
 *   (autoLeadId, customerId, dealerId, leadSource, store) and NO customer contact data and NO
 *   CRM note text. Asserted field-by-field against a scraped record deliberately loaded with
 *   phone, email and address, none of which may appear anywhere in the body.
 *   ONE DELIBERATE EXCEPTION: an UNVERIFIED quote is sent, because it is model-generated text
 *   that by definition is NOT in the lead — opening the lead cannot recover it, so a
 *   QUOTE-FABRICATED row could not otherwise be audited at all. A VERIFIED quote is never sent.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const args = process.argv.slice(2);
const BUILDS   = args.filter(a => /popup\.js$/.test(a));
const PROXY    = args.find(a => /cloudflare-worker/.test(a));
const REPORTER = args.find(a => /leadpro-reporter/.test(a));
if (!BUILDS.length || !PROXY || !REPORTER) {
  console.error('usage: commit-persistence.test.js <popup.js...> <cloudflare-worker.js> <leadpro-reporter.js>');
  process.exit(2);
}

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const ha = src.indexOf('var LP_SCAFFOLD_LINE_RE =');
  const hb = src.indexOf('// (v9.7.429/427) ONE definition of');
  const wa = src.indexOf('var LP_CRM_ENTRY_SPLIT_RE =');
  const wb = src.indexOf('// ── (v9.7.558) COMPREHENSION PASS');
  const cb = src.indexOf('// (v9.7.559) DURABLE, NOT EPHEMERAL');
  const sb = src.indexOf('// ── (v9.7.554) AGENT LP COMMAND CHANNEL COVERAGE');
  if ([ha, hb, wa, wb, cb, sb].some(x => x < 0)) throw new Error('could not locate the blocks in ' + file);

  const logs = [];
  const sandbox = {
    console: { log: (...x) => logs.push(x.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' ')) },
    window: {}, JSON, Promise, Date, String, Number, Object,
    chrome: { runtime: { getManifest: () => ({ version: '9.7.559', version_name: '9.7.559-dev' }) } }
  };
  vm.createContext(sandbox);
  vm.runInContext(src.slice(ha, hb), sandbox);
  vm.runInContext(src.slice(wa, wb), sandbox);
  vm.runInContext(src.slice(wb, cb), sandbox);   // the observer
  vm.runInContext(src.slice(cb, sb), sandbox);   // the sender

  const api = vm.runInContext('({ run:_lpRunCommitComprehension, send:_lpSendCommitComprehension })', sandbox);
  return { name: path.basename(path.dirname(file)), src, api, sandbox, logs };
}

const impls = BUILDS.map(extract);
const proxySrc    = fs.readFileSync(PROXY, 'utf8');
const reporterSrc = fs.readFileSync(REPORTER, 'utf8');

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
function one(name, value, want) {   // single-source (worker/reporter) assertion
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

// A scraped record deliberately loaded with contact data none of which may be persisted.
const SCRAPED = {
  autoLeadId: '2043828702', customerId: '1427380503', dealerId: '24399',
  leadSource: 'Kbb Ico Kelley Blue Book - Mobile (Internet)', store: 'Community Honda Lafayette',
  phone: '(337) 256-3478', email: 'apelle4@gmail.com', name: 'Jason Pellegrin',
  customerZip: '70560', customerState: 'LA'
};

const VERDICT_OK = {
  regexFired: true, regexQuote: 'will try to come in on sat', kind: 'soft',
  quote: 'will try to come in on sat just to see what her car is worth',
  claimedNote: 2, verifiedNote: 2, quoteVerified: true, delta: 'AGREE-COMMITMENT', notesRead: 6
};
const VERDICT_FAB = Object.assign({}, VERDICT_OK, {
  quote: 'the customer agreed to visit on Saturday', quoteVerified: false, verifiedNote: 0,
  delta: 'QUOTE-FABRICATED'
});

function sendWith(i, result, fetchImpl) {
  const sent = [];
  const f = fetchImpl || function (url, opts) { sent.push({ url, opts, body: JSON.parse(opts.body) }); return Promise.resolve({ ok: true }); };
  const r = i.api.send(result, { fetch: f, attach: p => p, scrub: t => t, scraped: SCRAPED, id: 'gen-123' });
  return { sent, returned: r };
}

console.log('\nv9.7.559 / proxy v7.55 / reporter v1.13 — the observer becomes durable');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── The payload ────────────────────────────────────────────────────────────────
console.log('the payload — locators only, the v9.7.489 posture:');

check('it POSTs to /commit-comprehension',
  i => sendWith(i, VERDICT_OK).sent[0].url.endsWith('/commit-comprehension'), true);

check('it carries the four locator fields the brief names, plus store',
  i => sendWith(i, VERDICT_OK).sent[0].body.meta,
  { autoLeadId: '2043828702', customerId: '1427380503', dealerId: '24399',
    leadSource: 'Kbb Ico Kelley Blue Book - Mobile (Internet)', store: 'Community Honda Lafayette' });

check('NO customer contact data appears anywhere in the body',
  i => {
    const raw = JSON.stringify(sendWith(i, VERDICT_OK).sent[0].body);
    return ['337', '256-3478', 'apelle4', '@gmail', 'Jason', 'Pellegrin', '70560']
      .filter(needle => raw.indexOf(needle) >= 0);
  }, []);

check('it carries both verdicts and the delta',
  i => {
    const b = sendWith(i, VERDICT_OK).sent[0].body;
    return { delta: b.delta, regexFired: b.regexFired, compKind: b.compKind, quoteVerified: b.quoteVerified };
  }, { delta: 'AGREE-COMMITMENT', regexFired: true, compKind: 'soft', quoteVerified: true });

check('a VERIFIED quote is NOT persisted — only its length',
  i => {
    const b = sendWith(i, VERDICT_OK).sent[0].body;
    return { hasQuote: 'unverifiedQuote' in b, regexQuoteLen: b.regexQuoteLen };
  }, { hasQuote: false, regexQuoteLen: 26 });

check('no CRM note text rides along on an agreeing row',
  i => /will try to come in on sat|Chassica|CALL NOTE/.test(JSON.stringify(sendWith(i, VERDICT_OK).sent[0].body)), false);

check('an UNVERIFIED quote IS persisted — the one thing the lead cannot recover',
  i => sendWith(i, VERDICT_FAB).sent[0].body.unverifiedQuote,
  'the customer agreed to visit on Saturday');

check('the unverified quote is capped',
  i => sendWith(i, Object.assign({}, VERDICT_FAB, { quote: 'x'.repeat(900) })).sent[0].body.unverifiedQuote.length, 300);

check('it carries the extension version, so old rows stay attributable',
  i => sendWith(i, VERDICT_OK).sent[0].body.extensionVersion, '9.7.559-dev');

check('it uses keepalive, like the feedback flush',
  i => sendWith(i, VERDICT_OK).sent[0].opts.keepalive, true);

// ── Containment ────────────────────────────────────────────────────────────────
console.log('\ncontainment — the POST cannot touch a message:');

check('the kill switch stops the POST — no second flag',
  i => {
    i.sandbox.LEADPRO_COMMIT_COMPREHENSION = false;
    const n = sendWith(i, VERDICT_OK).sent.length;
    i.sandbox.LEADPRO_COMMIT_COMPREHENSION = true;
    return n;
  }, 0);

check('a fetch that throws SYNCHRONOUSLY is swallowed',
  i => {
    const r = i.api.send(VERDICT_OK, { fetch: () => { throw new Error('boom'); }, attach: p => p, scraped: SCRAPED });
    return r === null || r === undefined;
  }, true);

check('a rejecting fetch is swallowed — the returned promise does not reject',
  i => {
    const r = i.api.send(VERDICT_OK, { fetch: () => Promise.reject(new Error('offline')), attach: p => p, scraped: SCRAPED });
    return typeof r.then === 'function';
  }, true);

check('a verdict with no delta sends nothing',
  i => sendWith(i, { regexFired: true }).sent.length, 0);

check('buildUserPrompt references the sender nowhere',
  i => {
    const lines = i.src.split('\n');
    let a = -1; for (let n = 0; n < lines.length; n++) if (lines[n].startsWith('function buildUserPrompt(')) { a = n; break; }
    let b = -1; for (let n = a + 1; n < lines.length; n++) if (lines[n] === '}') { b = n; break; }
    return (lines.slice(a, b + 1).join('\n').match(/_lpSendCommitComprehension/g) || []).length;
  }, 0);

// ── Fire-and-forget, proven ────────────────────────────────────────────────────
section('fire-and-forget, proven rather than asserted:');

checkAsync('a POST that NEVER resolves does not stop the observer resolving',
  async i => {
    const never = () => new Promise(() => {});
    const r = await i.api.run(
      '[08/19/2026 4:10 PM] [CALL NOTE] Outbound phone call (Contacted)\n  By: A\n  will come in Friday',
      { fired: true, quote: 'will come in Friday' },
      { fetch: () => Promise.resolve({ json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: '{"kind":"firm","note":1,"quote":"will come in Friday"}' }] } }] }) }),
        endpoint: { url: 'https://example.invalid/generate' }, attach: p => p, log: () => {},
        send: res => i.api.send(res, { fetch: never, attach: p => p, scraped: SCRAPED }) });
    return r && r.delta;
  }, 'AGREE-COMMITMENT');

checkAsync('a send that THROWS does not stop the observer resolving',
  async i => {
    const r = await i.api.run(
      '[08/19/2026 4:10 PM] [CALL NOTE] Outbound phone call (Contacted)\n  By: A\n  will come in Friday',
      { fired: true, quote: 'will come in Friday' },
      { fetch: () => Promise.resolve({ json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: '{"kind":"firm","note":1,"quote":"will come in Friday"}' }] } }] }) }),
        endpoint: { url: 'https://example.invalid/generate' }, attach: p => p, log: () => {},
        send: () => { throw new Error('send exploded'); } });
    return r && r.delta;
  }, 'AGREE-COMMITMENT');

checkAsync('the observer fires the send exactly once, with its own verdict',
  async i => {
    const seen = [];
    await i.api.run(
      '[08/19/2026 4:10 PM] [CALL NOTE] Outbound phone call (Contacted)\n  By: A\n  will come in Friday',
      { fired: true, quote: 'will come in Friday' },
      { fetch: () => Promise.resolve({ json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: '{"kind":"firm","note":1,"quote":"will come in Friday"}' }] } }] }) }),
        endpoint: { url: 'https://example.invalid/generate' }, attach: p => p, log: () => {},
        send: res => { seen.push(res.delta); } });
    return seen;
  }, ['AGREE-COMMITMENT']);

checkAsync('an observer that SKIPS (no notes) sends nothing',
  async i => {
    const seen = [];
    await i.api.run('[08/20/2026] [NOTE] General Note\n  By: A\n  nothing', { fired: false, quote: '' },
      { fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
        endpoint: { url: 'https://example.invalid/generate' }, attach: p => p, log: () => {},
        send: res => seen.push(res) });
    return seen.length;
  }, 0);

// ── Proxy endpoint ─────────────────────────────────────────────────────────────
pending.push(async () => {
  console.log('\nproxy v7.55 — POST /commit-comprehension:');

  one('the endpoint exists',
    () => /url\.pathname\.endsWith\('\/commit-comprehension'\)/.test(proxySrc), true);
  one('it rejects invalid JSON, like /feedback',
    () => /catch \{ return corsResponse\('\{"error":"Invalid JSON"\}', 400\); \}/.test(
      proxySrc.slice(proxySrc.indexOf("endsWith('/commit-comprehension')"))), true);
  one('it requires id and delta',
    () => /if \(!cc \|\| !cc\.id \|\| !cc\.delta\) return corsResponse\('\{"error":"Missing required fields"\}', 400\);/.test(proxySrc), true);
  one('it rejects an unknown delta rather than storing junk',
    () => /if \(CC_DELTAS\.indexOf\(cc\.delta\) < 0\) return corsResponse\('\{"error":"Unknown delta"\}', 400\);/.test(proxySrc), true);
  // (v9.7.564) Seven now: PROBE-FAILED marks a row where the probe call itself returned no usable
  // answer. Before it existed that failure arrived here wearing AGREE-NONE, because the canned
  // SAFE_FALLBACK the proxy returned instead is valid JSON that simply has no "kind" key.
  // (v9.7.566) Nine now: Phase 3 adds AGREE-FIRED (both readers found the fact) and
  // NO-COMPREHENSION-VERDICT (the probe produced nothing usable, so there was no comparison).
  one('the accepted delta set is exactly the nine the observers emit',
    () => (proxySrc.match(/const CC_DELTAS = \[([\s\S]*?)\];/) || [, ''])[1]
      .match(/'[A-Z-]+'/g).map(x => x.replace(/'/g, '')),
    ['AGREE-COMMITMENT', 'AGREE-NONE', 'DISAGREE-REGEX-ONLY', 'DISAGREE-COMPREHENSION-ONLY',
     'QUOTE-FABRICATED', 'NO-REGEX-VERDICT', 'PROBE-FAILED', 'AGREE-FIRED',
     'NO-COMPREHENSION-VERDICT']);
  one('every delta the extension can emit is accepted by the endpoint — no silent 400s',
    () => {
      const accepted = (proxySrc.match(/const CC_DELTAS = \[([\s\S]*?)\];/) || [, ''])[1]
        .match(/'[A-Z-]+'/g).map(x => x.replace(/'/g, ''));
      // Scoped to the observer block ONLY. A file-wide scan for /return '[A-Z-]+'/ also picks up
      // 'BOTH', 'NEITHER', 'TX' and 'LA' from unrelated functions — measured, which is why this
      // is bounded by the block's own markers rather than run over the whole file.
      const emitted = new Set();
      impls.forEach(i => {
        const a = i.src.indexOf('// ── (v9.7.558) COMPREHENSION PASS');
        const b = i.src.indexOf('// ── (v9.7.554) AGENT LP COMMAND CHANNEL COVERAGE');
        if (a < 0 || b < a) throw new Error('observer block markers not found in ' + i.name);
        const block = i.src.slice(a, b);
        (block.match(/delta:\s*'([A-Z-]+)'/g) || []).forEach(m => emitted.add(m.replace(/.*'([A-Z-]+)'.*/, '$1')));
        (block.match(/return '([A-Z][A-Z-]{4,})';/g) || []).forEach(m => emitted.add(m.replace(/.*'([A-Z-]+)'.*/, '$1')));
        (block.match(/:\s*'(NO-REGEX-VERDICT|PROBE-FAILED)'/g) || []).forEach(m => emitted.add(m.replace(/.*'([A-Z-]+)'.*/, '$1')));
      });
      if (emitted.size < 5) throw new Error('scan found only ' + emitted.size + ' deltas — the scope is wrong, not the code');
      return [...emitted].filter(d => accepted.indexOf(d) < 0);
    }, []);
  one('it honours REQUIRE_LICENSE the same way /feedback does',
    () => /if \(env\.REQUIRE_LICENSE === 'true'\) \{\s*const ccAuth = await validateLicenseRecord\(cc\.licenseKey, env\);/.test(proxySrc), true);
  one('the KV key uses a SERVER timestamp, not the client one',
    () => /const ccKey = `commit:\$\{new Date\(\)\.toISOString\(\)\}:\$\{cc\.id\}`;/.test(proxySrc), true);
  one('the TTL mirrors /feedback at 90 days',
    () => {
      const fbTtl = (proxySrc.match(/put\(fbKey, fbValue, \{ expirationTtl: ([^}]+)\}/) || [, ''])[1].trim();
      const ccTtl = (proxySrc.match(/put\(ccKey, ccValue, \{ expirationTtl: ([^}]+)\}/) || [, ''])[1].trim();
      return { fbTtl, ccTtl, same: fbTtl === ccTtl };
    }, { fbTtl: '60 * 60 * 24 * 90', ccTtl: '60 * 60 * 24 * 90', same: true });
  one('the stored meta is locators only — no phone, email or note text field',
    () => {
      const block = proxySrc.slice(proxySrc.indexOf('const ccValue = JSON.stringify({'));
      const meta = block.slice(block.indexOf('meta: {'), block.indexOf('unverifiedQuote'));
      return { locators: (meta.match(/^\s*(\w+):/gm) || []).map(x => x.trim().replace(':', '')),
               leaks: /phone|email|name|zip|address/i.test(meta) };
    }, { locators: ['meta', 'autoLeadId', 'customerId', 'dealerId', 'leadSource', 'store'], leaks: false });
  one('the unverified quote is stored ONLY when verification failed, and capped',
    () => /cc\.quoteVerified === false && cc\.unverifiedQuote\s*\?\s*\{ unverifiedQuote: String\(cc\.unverifiedQuote\)\.slice\(0, 300\) \}/.test(proxySrc), true);
  // Compare the /feedback HANDLER itself, bounded by its own first and last distinctive lines —
  // slicing "from /feedback to /list-licenses" fails once a new endpoint is inserted between
  // them, which is what the first version of this assertion did.
  one('the endpoint is additive — the /feedback handler is byte-identical to v7.54',
    () => {
      const prev = fs.readFileSync(PROXY.replace('v7.55', 'v7.54'), 'utf8');
      const cut = t => {
        const a = t.indexOf("if (request.method === 'POST' && url.pathname.endsWith('/feedback')) {");
        const b = t.indexOf("[FEEDBACK] KV write failed:", a);
        return a < 0 || b < 0 ? null : t.slice(a, b);
      };
      const A = cut(prev), B = cut(proxySrc);
      return !!A && A === B;
    }, true);
});

// ── Reporter section ───────────────────────────────────────────────────────────
pending.push(async () => {
  console.log('\nreporter v1.13 — the section that makes it readable:');

  one('buildReport takes commitData',
    () => /function buildReport\(reqs, dateLabel, feedbackData = null, commitData = null\)/.test(reporterSrc), true);
  one('the section renders into the report body',
    () => /\$\{commitHtml\}/.test(reporterSrc), true);
  one('it reads the commit: KV prefix',
    () => /prefix: `commit:\$\{datePrefix\}`/.test(reporterSrc), true);
  one('it applies the same CT-date filter as the feedback read',
    () => /ccEntries = \[\.\.\.c1, \.\.\.c2\]\.filter\(e => !e\.ts \|\| ctDateLabel\(new Date\(e\.ts\)\) === dateLabel\)/.test(reporterSrc), true);
  one('it reads two UTC-adjacent prefixes, like the feedback read',
    () => /Promise\.all\(\[ccAggregate\(dateLabel\), ccAggregate\(ccNext\)\]\)/.test(reporterSrc), true);
  one('the read has its OWN try/catch so it cannot cost the report its content',
    () => /Commit-comprehension query failed:/.test(reporterSrc), true);
  one('it reports agreement AND disagreement rate',
    () => /Agreement rate/.test(reporterSrc) && /Disagreement rate/.test(reporterSrc), true);
  // (v1.16) Rates read verifiedDeltas — rows whose probe actually answered — not the raw deltas.
  one('it counts fabricated quotes separately from disagreements',
    () => /Fabricated quotes/.test(reporterSrc)
       && /const disagree\s+= vd\['DISAGREE-REGEX-ONLY'\] \+ vd\['DISAGREE-COMPREHENSION-ONLY'\];/.test(reporterSrc), true);
  one('every rate reads verifiedDeltas, so an unanswered probe cannot move one',
    () => /const vd\s+= cd\.verifiedDeltas \|\| cd\.deltas;/.test(reporterSrc)
       && /const agree\s+= vd\['AGREE-COMMITMENT'\] \+ vd\['AGREE-NONE'\] \+ \(vd\['AGREE-FIRED'\] \|\| 0\);/.test(reporterSrc), true);
  one('a row without probeOk===true is counted and then skipped, not silently dropped',
    () => /if \(e\.probeOk !== true\) \{ unverifiedProbe\+\+; continue; \}/.test(reporterSrc), true);
  one('comparable is COUNTED in the loop, not derived by subtracting overlapping exclusions',
    () => /if \(e\.delta !== 'NO-REGEX-VERDICT' && e\.delta !== 'PROBE-FAILED'\) comparable\+\+;/.test(reporterSrc)
       && !/const comparable = cd\.total - noRegex;/.test(reporterSrc), true);
  one('zero comparable rows renders an explanation instead of a rate over nothing',
    () => /No usable comprehension verdicts for this date/.test(reporterSrc), true);

  // ── (v7.60 / v1.18) The two bugs the 8/22 report exposed ────────────────────
  one('THE CLAMP: day-lock and off-franchise answers are no longer collapsed to "none"',
    () => {
      // v7.59 clamped compKind to verbal-commit's vocabulary only, so "Saturday" and "Ram" — the
      // ONLY things those two detectors ever answer with — were stored as 'none', which reads
      // identically to "found nothing". Every positive they produced would have been lost.
      // Run the shipped helper WITH its dependency — ccKind closes over CC_WEEKDAYS, so evaluating
      // it alone throws "CC_WEEKDAYS is not defined", which looks like a code fault and is not one.
      const a = proxySrc.indexOf('const CC_WEEKDAYS =');
      const b = proxySrc.indexOf('\n      };', proxySrc.indexOf('const ccKind =', a)) + '\n      };'.length;
      if (a < 0 || b <= a) return 'ccKind helper not found';
      const box = { String, RegExp };
      vm.createContext(box);
      vm.runInContext(proxySrc.slice(a, b), box);
      const fn = vm.runInContext('ccKind', box);
      return {
        dayReal:   fn('day-lock', 'Saturday'),
        dayJunk:   fn('day-lock', 'Someday'),
        makeReal:  fn('off-franchise', 'Ram'),
        makeJunk:  fn('off-franchise', 'a'.repeat(60)),
        commitOk:  fn('verbal-commit', 'firm'),
        commitJunk:fn('verbal-commit', 'Saturday'),
        nulls:     [fn('day-lock', null), fn('off-franchise', ''), fn('verbal-commit', 'none')]
      };
    },
    { dayReal: 'saturday', dayJunk: 'none', makeReal: 'ram', makeJunk: 'none',
      commitOk: 'firm', commitJunk: 'none', nulls: ['none', 'none', 'none'] });

  one('...and the clamp is still a clamp — verbal-commit cannot smuggle a weekday through',
    () => /if \(detector === 'day-lock'\)\s+return CC_WEEKDAYS\.indexOf\(v\) >= 0/.test(proxySrc), true);

  one('the stored compKind is computed per detector, not from one shared list',
    () => /compKind:\s+ccKind\(CC_DETECTORS\.indexOf\(cc\.detector\) >= 0 \? cc\.detector : 'verbal-commit', cc\.compKind\)/.test(proxySrc), true);

  one('THE LIST: disagreements is a POSITIVE list, so a new delta cannot fall into it',
    () => /\['DISAGREE-REGEX-ONLY', 'DISAGREE-COMPREHENSION-ONLY', 'QUOTE-FABRICATED'\]\.indexOf\(e\.delta\) >= 0/.test(reporterSrc), true);

  one('...and the old exclusion form is gone — that is what put AGREE-FIRED under DISAGREEMENTS',
    () => /e\.delta !== 'AGREE-COMMITMENT' && e\.delta !== 'AGREE-NONE'/.test(reporterSrc), false);

  one('every delta the proxy accepts is classified by the reporter as exactly one of agree / disagree / neither',
    () => {
      const accepted = (proxySrc.match(/const CC_DELTAS = \[([\s\S]*?)\];/) || [, ''])[1]
        .match(/'[A-Z-]+'/g).map(x => x.replace(/'/g, ''));
      const disagree = ['DISAGREE-REGEX-ONLY', 'DISAGREE-COMPREHENSION-ONLY', 'QUOTE-FABRICATED'];
      // Anything that is neither an AGREE-* nor a listed disagreement must be a "neither" — the
      // three not-a-comparison deltas. Nothing may be unaccounted for.
      const unaccounted = accepted.filter(d =>
        d.indexOf('AGREE') !== 0 && disagree.indexOf(d) < 0 &&
        ['NO-REGEX-VERDICT', 'PROBE-FAILED', 'NO-COMPREHENSION-VERDICT'].indexOf(d) < 0);
      return unaccounted;
    }, []);
  one('disagreements deep-link to the lead via the v1.12 helper',
    () => /vinLeadUrl\(d\.autoLeadId, d\.customerId\)/.test(reporterSrc), true);
  one('it says plainly that the observer is not authoritative',
    () => /no comprehension verdict has ever changed a customer-facing message/i.test(reporterSrc), true);
  one('an unknown delta is skipped rather than crashing the report',
    () => /if \(deltas\[e\.delta\] === undefined\) continue;/.test(reporterSrc), true);
  one('no-data renders a placeholder rather than an empty section',
    () => /No comprehension verdicts recorded for this date/.test(reporterSrc), true);

  // Run the real aggregation shape through the real section renderer.
  // The reporter's shared helpers include an R2 decoder; give the sandbox the globals it expects.
  const sandbox = { console: { log() {} }, TextDecoder, JSON, Date, Math, Object, String, Number, Intl };
  vm.createContext(sandbox);
  const lines = reporterSrc.split('\n');
  let s0 = -1; for (let n = 0; n < lines.length; n++) if (lines[n].startsWith('function buildReport(')) { s0 = n; break; }
  let s1 = -1; for (let n = s0 + 1; n < lines.length; n++) if (lines[n] === '}') { s1 = n; break; }
  // Everything buildReport reads from module scope — ctParts through percentiles. Slicing only
  // as far as listObjects left `percentiles` undefined and buildReport threw.
  const helpers = reporterSrc.slice(reporterSrc.indexOf('const _CT_FMT ='), reporterSrc.indexOf('function buildReport('));
  vm.runInContext(helpers, sandbox);
  vm.runInContext(lines.slice(s0, s1 + 1).join('\n'), sandbox);
  const build = vm.runInContext('buildReport', sandbox);

  const CD = {
    date: '2026-08-21', total: 10,
    deltas: { 'AGREE-COMMITMENT': 3, 'AGREE-NONE': 5, 'DISAGREE-REGEX-ONLY': 1,
              'DISAGREE-COMPREHENSION-ONLY': 0, 'QUOTE-FABRICATED': 1 },
    bySource: { 'CarGurus': { total: 6, agree: 5, disagree: 1, fabricated: 0 },
                'Kbb Ico':  { total: 4, agree: 3, disagree: 0, fabricated: 1 } },
    disagreements: [
      { ts: '2026-08-21T15:00:00Z', delta: 'DISAGREE-REGEX-ONLY', store: 'Community Honda Lafayette',
        leadSource: 'CarGurus', autoLeadId: '2043828702', customerId: '1427380503' },
      { ts: '2026-08-21T14:00:00Z', delta: 'QUOTE-FABRICATED', store: 'Community Kia Baytown',
        leadSource: 'Kbb Ico', autoLeadId: '2070428771', customerId: '111840497' }
    ],
    regexFired: 4, compFired: 3
  };
  const reqs = [{ final: { ts: '2026-08-21T15:00:00Z', ms: 100, tier: 'primary' }, fails: [], ts: '2026-08-21T15:00:00Z' }];
  const out = build(reqs, '2026-08-21', null, CD);

  one('the rendered section shows the agreement rate',   () => /80\.0%/.test(out.html), true);
  one('the rendered section shows the disagreement rate', () => /10\.0%/.test(out.html), true);
  one('the rendered section names both disagreeing leads',
    () => /2043828702/.test(out.html) && /2070428771/.test(out.html), true);
  one('the deep link is a real VinSolutions lead URL',
    () => /AutoLeadID=2043828702&GlobalCustomerID=1427380503/.test(out.html), true);
  one('a null commitData still renders the report, with a placeholder',
    () => /No comprehension verdicts recorded/.test(build(reqs, '2026-08-21', null, null).html), true);
  // Scope the NaN check to the COMMIT SECTION. The whole-report check failed, and the cause was
  // the pre-existing Latency table ("All requests / NaNms") reacting to this test's deliberately
  // thin `reqs` fixture — nothing to do with this build. Asserting on the whole report would be
  // asserting on my own fixture, not on the code under test.
  const commitSection = h => {
    const a = h.indexOf('Commit Comprehension');
    const b = h.indexOf('LeadPro · Community Auto Group', a);
    return a < 0 ? '' : h.slice(a, b < 0 ? h.length : b);
  };
  one('a zero-total commitData renders the placeholder, not a divide-by-zero',
    () => {
      const sec = commitSection(build(reqs, '2026-08-21', null, Object.assign({}, CD, { total: 0 })).html);
      return /No comprehension verdicts recorded/.test(sec) && !/NaN/.test(sec);
    }, true);
  one('the commit section never renders NaN with real data',
    () => /NaN/.test(commitSection(out.html)), false);
  one('...and the check is not vacuous — the section really was found',
    () => commitSection(out.html).length > 400, true);
});

(async () => {
  for (const p of pending) await p();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
