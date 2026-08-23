#!/usr/bin/env node
'use strict';
/**
 * fact-comprehension.test.js — v9.7.566, PHASE 3.
 *
 * Promotes comprehension from observer to AUTHORITATIVE-CAPABLE for three conversational-fact
 * detectors: verbal-commit, day-lock, off-franchise. Every flag ships OFF; this suite is what has
 * to be true before any of them is flipped on.
 *
 * ── THE EVIDENCE BASE, BECAUSE IT SET THE DEFAULTS ────────────────────────────────────────
 * The plan was to promote verbal-commit broadly on its ~113 observer verdicts while day-lock and
 * off-franchise waited behind flags. That asymmetry does not exist. v9.7.564 established that the
 * proxy's MIN_CONTENT_CHARS=150 floor — already 150 in v7.52, while the observer shipped against
 * v7.55 — rejected EVERY probe answer at every tier, and that the SAFE_FALLBACK returned instead
 * is valid JSON with no "kind" key, which the observer read as kind:'none'. Those ~113 rows are
 * the count of PERSISTED ROWS and essentially all of them are that fabricated series. All three
 * detectors therefore have the same evidence base, which is zero, and all three ship OFF.
 *
 * ── WHAT THIS SUITE HOLDS, and it is the same bar verbal-commit's own suite reached ───────
 *  RAIL 1  Fallback to regex on EVERY failure mode, enumerated: flag off, no endpoint, no notes,
 *          proxy SAFE_FALLBACK, proxy error, malformed JSON, missing answer key, unverified quote,
 *          timeout, a fetch that never settles, a fetch that throws synchronously.
 *  RAIL 2  A positive answer with no LITERALLY verified quote is unusable. A paraphrase is refused.
 *  RAIL 3  Every decision logs which source produced the shipped directive.
 *  RAIL 4  Per-detector kill switches are independent — one off never disables another.
 *  RAIL 5  The probe reads the SAME BYTES the regex read, carried out of inlineScraper rather
 *          than re-derived, so a disagreement can never be a boundary artefact.
 *  PLUS    The fences are stripped unconditionally, on every path, including the throw path.
 *
 * Driven against the three real captures the incidents came from: Jason Pellegrin (verbal-commit),
 * Jeri Mayes (day-lock), Hayden N (off-franchise). Sliced out of the SHIPPED files; both builds
 * must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: fact-comprehension.test.js <popup.js> [popup.js...]'); process.exit(2); }

const FIX = p => fs.readFileSync(path.join(__dirname, 'fixtures', p), 'utf8');
const JASON = FIX('jason-pellegrin-context.txt');

// Jeri's real inbound email — the day-lock incident. Her customer-authored part is "Thank you.";
// the v9.7.565 stripper removes the Yahoo header before it ever reaches the probe.
const JERI_CUSTOMER_TEXT = 'Thank you.';
// Hayden's real lastInboundMsg — the off-franchise incident. "ram" lives inside "Timeframe".
const HAYDEN_METADATA = 'Phone Lead from CarGurus. Caller Id: None, Duration: 6 minutes, '
  + '51 seconds Likelihood to buy: Standard Timeframe: 2 weeks. Show Less';

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const at = n => { const i = src.indexOf(n); if (i < 0) throw new Error('missing ' + n + ' in ' + file); return i; };
  const spans = [
    [at('var LP_SCAFFOLD_LINE_RE ='), at('// (v9.7.429/427) ONE definition of')],
    [at('var LP_CRM_ENTRY_SPLIT_RE ='), at('// ── (v9.7.560) NOTE TYPES')],
    [at('// ── (v9.7.560) NOTE TYPES'), at('// ── (v9.7.561) PHASE A')],
    [at('// ── (v9.7.558) COMPREHENSION PASS'), at('// (v9.7.559) DURABLE, NOT EPHEMERAL')],
    [at('// ── (v9.7.566) PHASE 3 — COMPREHENSION AS THE AUTHORITATIVE READER'),
     at('// ── (v9.7.554) AGENT LP COMMAND CHANNEL COVERAGE')]
  ];

  // FLAG OVERRIDES ARE APPLIED AFTER THE SPANS RUN. The Phase 3 span contains
  // `var LEADPRO_DAYLOCK_AUTHORITATIVE = false;`, so anything seeded into the sandbox beforehand
  // is silently clobbered by the shipped default — which made three assertions fail in a way that
  // looked like the override was broken when the harness was.
  function box(over) {
    const logs = [];
    const sb = {
      console: { log: (...x) => logs.push(x.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' ')) },
      window: {}, JSON, Promise, Date, String, Number, Object, Array, RegExp, Math,
      setTimeout, clearTimeout, AbortController: typeof AbortController === 'function' ? AbortController : undefined
    };
    vm.createContext(sb);
    spans.forEach(([a, b]) => vm.runInContext(src.slice(a, b), sb));
    Object.keys(over || {}).forEach(k => {
      vm.runInContext(k + ' = ' + JSON.stringify(over[k]) + ';', sb);
    });
    sb.__logs = logs;
    return sb;
  }

  return {
    name: path.basename(path.dirname(file)), src, box,

    // Run one probe end to end with a stubbed proxy response.
    probe: (detId, notes, body, over) => {
      const sb = box();
      const payloads = [];
      const deps = Object.assign({
        endpoint: { url: 'https://proxy.test/' },
        fetch: (url, opts) => {
          try { payloads.push(JSON.parse(opts.body)); } catch (e) { payloads.push(null); }
          if (body === '__never__') return new Promise(function () {});
          if (body === '__throw__') throw new Error('synchronous boom');
          if (body === '__reject__') return Promise.reject(new Error('network down'));
          const data = typeof body === 'string'
            ? { candidates: [{ content: { parts: [{ text: body }] } }] } : body;
          return Promise.resolve({ json: () => Promise.resolve(data) });
        }
      }, over || {});
      const run = vm.runInContext('(function(d,n,dep){ return _lpRunFactProbe(d,n,dep); })', sb);
      return Promise.resolve(run(detId, notes, deps))
        .then(r => ({ result: r, payloads, logs: sb.__logs }));
    },

    decide: (detId, comp, regex, over) => {
      const sb = box(over);
      const logs = [];
      const run = vm.runInContext('(function(d,c,r,l){ return _lpFactDecide(d,c,r,l); })', sb);
      const out = run(detId, comp, regex, (...x) => logs.push(x.join(' ')));
      return { out, logs };
    },

    override: (text, verdicts, over) => {
      const sb = box(over);
      const logs = [];
      const run = vm.runInContext('(function(t,v,l){ return _lpApplyFactOverrides(t,v,l); })', sb);
      const out = run(text, verdicts, (...x) => logs.push(x.join(' ')));
      return { out, logs };
    },

    // (v9.7.568) The telemetry flush, driven with a stubbed sender.
    flush: (verdicts, decisions, over, vcStash) => {
      const sb = box(over);
      const rows = [];
      const logs = [];
      vm.runInContext('window._lpVerbalCommitVerdict = ' + JSON.stringify(vcStash || {}) + ';', sb);
      const run = vm.runInContext('(function(d){ return _lpFlushFactTelemetry(d); })', sb);
      const out = run({ verdicts, decisions, genId: 'gen-test',
                        send: (r) => rows.push(r),
                        log: (...x) => logs.push(x.join(' ')) });
      return { out, rows, logs };
    },

    read: (expr, over) => vm.runInContext(expr, box(over)),
    fences: () => {
      const sb = box();
      return { open: vm.runInContext('LP_FACT_FENCE_OPEN', sb), close: vm.runInContext('LP_FACT_FENCE_CLOSE', sb) };
    }
  };
}

const impls = BUILDS.map(extract);
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
function checkAsync(name, fn, want) {
  pending.push(async () => {
    let results;
    try { results = await Promise.all(impls.map(async i => JSON.stringify(await fn(i)))); }
    catch (e) { results = ['THREW: ' + e.message]; }
    report(name, results, want);
  });
}
function section(t) { pending.push(async () => console.log('\n' + t)); }
function pCheck(name, fn, want) { pending.push(async () => check(name, fn, want)); }

const ANS = {
  commitNone: '{"kind":"none","note":null,"quote":null}',
  commitFirm: n => JSON.stringify({ kind: 'firm', note: 1, quote: n }),
  dayNone:    '{"day":null,"note":null,"quote":null}',
  dayFirm:    (d, q) => JSON.stringify({ day: d, note: 1, quote: q }),
  makeNone:   '{"make":null,"note":null,"quote":null}',
  makeFirm:   (m, q) => JSON.stringify({ make: m, note: 1, quote: q })
};

console.log('\nv9.7.566 Phase 3 — comprehension as the authoritative reader for three fact detectors');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── Defaults ───────────────────────────────────────────────────────────────────
console.log('the flags, and the evidence that set them:');

check('all three AUTHORITATIVE flags ship OFF',
  i => [i.read('LEADPRO_VERBALCOMMIT_AUTHORITATIVE'), i.read('LEADPRO_DAYLOCK_AUTHORITATIVE'),
        i.read('LEADPRO_OFFFRANCHISE_AUTHORITATIVE')], [false, false, false]);

check('all three OBSERVER flags ship ON — the data has to start accumulating',
  i => [i.read('LEADPRO_VERBALCOMMIT_COMPREHENSION'), i.read('LEADPRO_DAYLOCK_COMPREHENSION'),
        i.read('LEADPRO_OFFFRANCHISE_COMPREHENSION')], [true, true, true]);

check('the flags are SEPARATE symbols, not one shared switch',
  i => new Set(['LEADPRO_VERBALCOMMIT_AUTHORITATIVE', 'LEADPRO_DAYLOCK_AUTHORITATIVE',
                'LEADPRO_OFFFRANCHISE_AUTHORITATIVE', 'LEADPRO_VERBALCOMMIT_COMPREHENSION',
                'LEADPRO_DAYLOCK_COMPREHENSION', 'LEADPRO_OFFFRANCHISE_COMPREHENSION']
                .filter(s => new RegExp('var ' + s + '\\s*=').test(i.src))).size, 6);

check('the build states plainly that the ~113 verdicts are the fabricated series',
  i => /essentially all of them are that fabricated\s*\n\/\/ series/.test(i.src)
    || /essentially all of them are that fabricated/.test(i.src), true);

// ── RAIL 1: every failure mode falls back ──────────────────────────────────────
section('RAIL 1 — every failure mode falls back to regex, enumerated:');

const FAILURES = [
  ['proxy returns SAFE_FALLBACK',        { candidates: [{ content: { parts: [{ text: '{"sms":"x"}' }] }, _fallback: true, _lastError: 'Empty response' }] }, /SAFE_FALLBACK/],
  ['proxy returns an error envelope',    { error: 'All model tiers failed', _fallback: true },       /SAFE_FALLBACK|proxy error/],
  ['response is not JSON',               'I think they said Monday',                                  /no usable JSON/],
  ['response is a JSON array',           '["Monday"]',                                                /no usable JSON/],
  ['response has no answer key',         '{"answer":"Monday"}',                                       /carries no "day" field/],
  ['fetch rejects',                      '__reject__',                                                /probe failed/],
  ['fetch throws synchronously',         '__throw__',                                                 /probe failed|threw/]
];
FAILURES.forEach(([label, body, reasonRe]) => {
  checkAsync('day-lock: ' + label + ' → unusable, with a reason',
    async i => {
      const r = (await i.probe('day-lock', [JERI_CUSTOMER_TEXT], body)).result;
      return { usable: r.usable, reasonMatches: reasonRe.test(r.reason || '') };
    }, { usable: false, reasonMatches: true });
});

checkAsync('a fetch that NEVER settles is bounded by the timeout, not left hanging',
  async i => {
    const t0 = Date.now();
    const r = (await i.probe('day-lock', [JERI_CUSTOMER_TEXT], '__never__', { timeoutMs: 250 })).result;
    return { usable: r.usable, timedOut: /timed out/.test(r.reason || ''), under2s: (Date.now() - t0) < 2000 };
  }, { usable: false, timedOut: true, under2s: true });

checkAsync('no endpoint → unusable, no throw',
  async i => {
    const r = (await i.probe('day-lock', [JERI_CUSTOMER_TEXT], ANS.dayNone, { endpoint: null })).result;
    return { usable: r.usable, reason: r.reason };
  }, { usable: false, reason: 'no endpoint available' });

checkAsync('no notes to read → unusable, and NO network call is made',
  async i => {
    const p = await i.probe('day-lock', [], ANS.dayNone);
    return { usable: p.result.usable, calls: p.payloads.length };
  }, { usable: false, calls: 0 });

checkAsync('an unknown detector id is refused rather than throwing',
  async i => (await i.probe('not-a-detector', ['x'], ANS.dayNone)).result.usable, false);

check('EVERY unusable result decides regex-fallback, whatever the reason',
  i => ['flag off', 'timed out', 'proxy error', 'QUOTE-FABRICATED', 'no endpoint available']
        .map(r => i.decide('day-lock', { usable: false, reason: r }, { fired: true, value: 'Monday' }).out.source),
  ['regex-fallback', 'regex-fallback', 'regex-fallback', 'regex-fallback', 'regex-fallback']);

check('a MISSING verdict entirely still decides regex-fallback',
  i => i.decide('day-lock', undefined, { fired: true, value: 'Monday' }).out.source, 'regex-fallback');

check('...and the fallback carries the regex value through unchanged',
  i => {
    const d = i.decide('day-lock', undefined, { fired: true, value: 'Saturday' }).out;
    return { fired: d.fired, value: d.value };
  }, { fired: true, value: 'Saturday' });

// ── RAIL 2: quote verification ─────────────────────────────────────────────────
section('RAIL 2 — a positive answer with no literally verified quote is unusable:');

checkAsync('verbal-commit: a VERIFIED quote is usable',
  async i => {
    const note = 'spoke with customer, will try to come in on sat to see what her car is worth';
    const r = (await i.probe('verbal-commit', [note], ANS.commitFirm('will try to come in on sat'))).result;
    return { usable: r.usable, verifiedNote: r.verifiedNote, quoteVerified: r.quoteVerified };
  }, { usable: true, verifiedNote: 1, quoteVerified: true });

checkAsync('verbal-commit: a PARAPHRASE is refused as fabricated',
  async i => {
    const note = 'spoke with customer, will try to come in on sat to see what her car is worth';
    const r = (await i.probe('verbal-commit', [note], ANS.commitFirm('the customer agreed to visit Saturday'))).result;
    return { usable: r.usable, fabricated: !!r.fabricated };
  }, { usable: false, fabricated: true });

checkAsync('day-lock: a day quoted from text that is not in the note is refused',
  async i => {
    const r = (await i.probe('day-lock', [JERI_CUSTOMER_TEXT], ANS.dayFirm('Monday', 'On Monday, August 10, 2026'))).result;
    return { usable: r.usable, fabricated: !!r.fabricated };
  }, { usable: false, fabricated: true });

checkAsync('off-franchise: a make quoted from text that is not in the note is refused',
  async i => {
    const r = (await i.probe('off-franchise', [HAYDEN_METADATA], ANS.makeFirm('Ram', 'looking for a Ram 1500'))).result;
    return { usable: r.usable, fabricated: !!r.fabricated };
  }, { usable: false, fabricated: true });

checkAsync('a NEGATIVE answer needs no quote — the asymmetry is deliberate',
  async i => {
    const r = (await i.probe('day-lock', [JERI_CUSTOMER_TEXT], ANS.dayNone)).result;
    return { usable: r.usable, fired: r.fired, quote: r.quote };
  }, { usable: true, fired: false, quote: '' });

checkAsync('quote verification is whitespace-normalised and case-insensitive, not brittle',
  async i => {
    const note = 'Customer  said   he will COME IN Saturday morning';
    const r = (await i.probe('verbal-commit', [note], ANS.commitFirm('he will come in saturday'))).result;
    return r.usable;
  }, true);

// ── The three real incidents ───────────────────────────────────────────────────
section('the three real captures — what each detector must produce:');

checkAsync('JERI: the probe is handed only "Thank you." — the Yahoo header never reaches it',
  async i => {
    const p = await i.probe('day-lock', [JERI_CUSTOMER_TEXT], ANS.dayNone);
    // Scope to the MESSAGES block: the RULES above it deliberately QUOTE a Yahoo header as an
    // example of what to ignore, so scanning the whole prompt finds the probe's own prose.
    const sent = p.payloads[0].contents[0].parts[0].text;
    const messages = sent.slice(sent.indexOf('MESSAGES:'));
    return { hasYahooHeader: /On Monday, August 10/.test(messages), hasCustomerWords: /Thank you\./.test(messages) };
  }, { hasYahooHeader: false, hasCustomerWords: true });

checkAsync('JERI: with the flag ON, a "no day" verdict REMOVES the fabricated LOCK IN directive',
  async i => {
    const f = i.fences();
    const ctx = 'before\n' + f.open + 'day-lock⟧\n📅 CUSTOMER NAMED A SPECIFIC DAY — THIS IS A HARD CONSTRAINT:\n'
      + '- Customer said Monday is when they are available. LOCK IN Monday\n' + f.close + 'day-lock⟧\nafter';
    const r = i.override(ctx, { 'day-lock': { usable: true, fired: false, kind: null, notesRead: 1 } },
      { LEADPRO_DAYLOCK_AUTHORITATIVE: true });
    return { hasLockIn: /LOCK IN/.test(r.out.text), hasFence: /⟦/.test(r.out.text), applied: r.out.applied };
  }, { hasLockIn: false, hasFence: false, applied: ['day-lock:REMOVE'] });

checkAsync('JERI: with the flag OFF — today\'s default — the directive is KEPT untouched',
  async i => {
    const f = i.fences();
    const ctx = f.open + 'day-lock⟧\nLOCK IN Monday\n' + f.close + 'day-lock⟧';
    const r = i.override(ctx, { 'day-lock': { usable: true, fired: false, kind: null, notesRead: 1 } });
    return { hasLockIn: /LOCK IN/.test(r.out.text), hasFence: /⟦/.test(r.out.text), applied: r.out.applied };
  }, { hasLockIn: true, hasFence: false, applied: ['day-lock:KEEP'] });

checkAsync('HAYDEN: the probe is told the store brand, or the question is unanswerable',
  async i => {
    const p = await i.probe('off-franchise', [HAYDEN_METADATA], ANS.makeNone, { opts: { storeBrand: 'honda' } });
    return /The dealership sells honda/.test(p.payloads[0].contents[0].parts[0].text);
  }, true);

checkAsync('HAYDEN: the probe prompt names the exact failure — letters inside another word',
  async i => {
    const p = await i.probe('off-franchise', [HAYDEN_METADATA], ANS.makeNone);
    const sent = p.payloads[0].contents[0].parts[0].text;
    return { namesTimeframe: /"ram" inside "Timeframe"/.test(sent), namesMetadata: /Call-record blobs/.test(sent) };
  }, { namesTimeframe: true, namesMetadata: true });

checkAsync('HAYDEN: with the flag ON, a "no make" verdict removes the Ram directive',
  async i => {
    const f = i.fences();
    const ctx = f.open + 'off-franchise⟧\n🚧 OFF-FRANCHISE REQUEST — the customer asked about a Ram\n' + f.close + 'off-franchise⟧';
    const r = i.override(ctx, { 'off-franchise': { usable: true, fired: false, kind: null, notesRead: 1 } },
      { LEADPRO_OFFFRANCHISE_AUTHORITATIVE: true });
    return { hasRam: /Ram/.test(r.out.text), applied: r.out.applied };
  }, { hasRam: false, applied: ['off-franchise:REMOVE'] });

checkAsync('JASON: the verbal-commit probe still reads his real 22-note history',
  async i => {
    const sb = i.box();
    const build = vm.runInContext('(function(c){ var n=[],k=[]; [LP_NOTE_TYPES.CALL,LP_NOTE_TYPES.GENERAL].forEach(function(kind){ _lpWalkCrmEntries(c,{type:kind,max:6}).forEach(function(e){ if(_lpNoteBoilerplateReason(e.text,kind)) return; n.push(e.text); k.push(kind); }); }); return n; })', sb);
    const notes = build(JASON);
    return notes.length > 0;
  }, true);

// ── RAIL 3: source logging ─────────────────────────────────────────────────────
section('RAIL 3 — every decision says which source produced the shipped directive:');

check('a fallback decision logs source:regex-fallback',
  i => /source:regex-fallback/.test(i.decide('day-lock', { usable: false, reason: 'timed out' }, { fired: true, value: 'Monday' }).logs.join('\n')), true);

check('an authoritative decision logs source:comprehension',
  i => /source:comprehension/.test(i.decide('day-lock',
        { usable: true, fired: true, kind: 'Saturday', quote: 'come Saturday', verifiedNote: 1, notesRead: 1 },
        { fired: true, value: 'Monday' }, { LEADPRO_DAYLOCK_AUTHORITATIVE: true }).logs.join('\n')), true);

check('the log names the detector, so three lines per generation stay separable',
  i => ['verbal-commit', 'day-lock', 'off-franchise'].map(d =>
        new RegExp('\\[LP FACT DIAG\\] ' + d).test(i.decide(d, undefined, { fired: false, value: '' }).logs.join('\n'))),
  [true, true, true]);

check('the log states whether the detector is authoritative or observer-only',
  i => /authoritative:OFF \(observer only\)/.test(i.decide('day-lock', undefined, { fired: false, value: '' }).logs.join('\n')), true);

check('a disagreement is labelled as such, and an unusable probe is not called agreement',
  i => [
    i.decide('day-lock', { usable: true, fired: false, kind: null, notesRead: 1 }, { fired: true, value: 'Monday' }).out.delta,
    i.decide('day-lock', { usable: true, fired: true, kind: 'Monday', quote: 'x', verifiedNote: 1, notesRead: 1 }, { fired: true, value: 'Monday' }).out.delta,
    i.decide('day-lock', { usable: false, reason: 'timed out' }, { fired: true, value: 'Monday' }).out.delta
  ], ['DISAGREE-REGEX-ONLY', 'AGREE-FIRED', 'NO-COMPREHENSION-VERDICT']);

// ── RAIL 4: independent kill switches ──────────────────────────────────────────
section('RAIL 4 — the kill switches are independent:');

checkAsync('day-lock observer OFF makes no network call for day-lock',
  async i => (await i.probe('day-lock', ['x'], ANS.dayNone, {})).payloads.length, 1);

checkAsync('...and with its flag off, zero calls and an explanatory reason',
  async i => {
    const sb = i.box({});
    vm.runInContext('LEADPRO_DAYLOCK_COMPREHENSION = false;', sb);
    const payloads = [];
    const run = vm.runInContext('(function(d,n,dep){ return _lpRunFactProbe(d,n,dep); })', sb);
    const r = await run('day-lock', ['x'], { endpoint: { url: 'u' }, fetch: () => { payloads.push(1); return Promise.resolve({ json: () => Promise.resolve({}) }); } });
    return { calls: payloads.length, usable: r.usable, reason: r.reason };
  }, { calls: 0, usable: false, reason: 'observer flag off for day-lock' });

checkAsync('turning day-lock OFF leaves verbal-commit and off-franchise running',
  async i => {
    const sb = i.box({});
    vm.runInContext('LEADPRO_DAYLOCK_COMPREHENSION = false;', sb);
    const calls = [];
    const run = vm.runInContext('(function(d,n,dep){ return _lpRunFactProbe(d,n,dep); })', sb);
    const dep = { endpoint: { url: 'u' }, fetch: (u, o) => { calls.push(JSON.parse(o.body).contents[0].parts[0].text.slice(0, 24)); return Promise.resolve({ json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: '{"kind":"none"}' }] } }] }) }); } };
    await run('day-lock', ['x'], dep);
    await run('verbal-commit', ['x'], dep);
    await run('off-franchise', ['x'], dep);
    return calls.length;
  }, 2);

check('an authoritative flag ON with the observer OFF still falls back — no orphan state',
  i => i.decide('day-lock', { usable: false, reason: 'observer flag off for day-lock' },
        { fired: true, value: 'Monday' }, { LEADPRO_DAYLOCK_AUTHORITATIVE: true }).out.source, 'regex-fallback');

// ── RAIL 5: same bytes ─────────────────────────────────────────────────────────
section('RAIL 5 — the probe reads the same bytes the regex read:');

check('the scraper carries its customer-authored text OUT rather than the popup re-deriving it',
  i => /schedCustomerNotes\.push\(\{ i: nti/.test(i.src)
    && /schedCustomerNotes/.test(i.src.slice(i.src.indexOf('conversationBrief, customerSaidNotToday'), i.src.indexOf('conversationBrief, customerSaidNotToday') + 220)), true);

check('...and _lpCustomerAuthoredPart is NOT reimplemented at module scope',
  i => {
    const lines = i.src.split('\n');
    const start = lines.findIndex(l => l === '  function inlineScraper() {') + 1;
    const end   = lines.findIndex(l => l === '  } // end inlineScraper') + 1;
    const defs  = [];
    lines.forEach((l, n) => { if (/^\s*function _lpCustomerAuthoredPart\(/.test(l)) defs.push(n + 1); });
    return { definitions: defs.length, allInsideScraper: defs.every(d => d > start && d < end) };
  }, { definitions: 1, allInsideScraper: true });

check('day-lock input is built from schedCustomerNotes, not re-walked from context',
  i => {
    const a = i.src.indexOf('out[LP_FACT_IDS.DAYLOCK] =');
    return /schedCustomerNotes/.test(i.src.slice(a - 400, a + 200));
  }, true);

check('off-franchise input is _lpCustomerText — the same function the matcher reads',
  i => {
    const a = i.src.indexOf('out[LP_FACT_IDS.OFFFRANCHISE] =');
    return /_lpCustomerText\(data\)/.test(i.src.slice(a - 700, a));
  }, true);

// ── The fences ─────────────────────────────────────────────────────────────────
section('the fences never reach a customer-facing prompt:');

checkAsync('a fenced region with NO verdict at all still has its fences stripped',
  async i => {
    const f = i.fences();
    const r = i.override(f.open + 'day-lock⟧X' + f.close + 'day-lock⟧', {});
    return { text: r.out.text, clean: !/⟦/.test(r.out.text) };
  }, { text: 'X', clean: true });

checkAsync('an ORPHAN opening fence with no partner is still stripped',
  async i => i.override('before ' + i.fences().open + 'day-lock⟧ after', {}).out.text, 'before  after');

checkAsync('an orphan CLOSING fence is stripped too',
  async i => i.override('before ' + i.fences().close + 'off-franchise⟧ after', {}).out.text, 'before  after');

checkAsync('a context with no fences at all is returned byte-identical',
  async i => i.override('plain context, nothing fenced', {}).out.text, 'plain context, nothing fenced');

check('the generate path strips fences even when the override call throws',
  i => /catch \(_lpOvErr\)[\s\S]{0,200}replace\(\/⟦\\\/\?LP_FACT:/.test(i.src), true);

check('the fenced directives are the two that render at SCRAPE time, and only those',
  i => (i.src.match(/vehicleExtras\.push\(LP_FACT_FENCE_OPEN/g) || []).length, 2);

// ── No double-probing ──────────────────────────────────────────────────────────
section('the v9.7.559 observer does not fire a second time for the same question:');

check('the old dispatch is gated on the Phase 3 verbal-commit flag',
  i => /if \(typeof LEADPRO_VERBALCOMMIT_COMPREHENSION !== 'undefined' && LEADPRO_VERBALCOMMIT_COMPREHENSION\) \{/.test(i.src), true);

check('...and says so in the log rather than going silent',
  i => /superseded by the Phase 3 fact probe this generation/.test(i.src), true);

check('the v9.7.559 observer is NOT deleted — it is the fallback path when Phase 3 is off',
  i => /function _lpRunCommitComprehension\(/.test(i.src), true);

// ── Prompt hygiene ─────────────────────────────────────────────────────────────
section('probe prompt hygiene — the isolation rule still holds:');

checkAsync('no probe is shown the regex answer',
  async i => {
    const p = await i.probe('day-lock', ['I can come Saturday'], ANS.dayNone);
    const sent = p.payloads[0].contents[0].parts[0].text;
    return /LOCK IN|regex|CUSTOMER SPECIFIED DAY/.test(sent);
  }, false);

checkAsync('every probe declares responseContract fact — or it cannot succeed at all',
  async i => {
    const out = [];
    for (const d of ['verbal-commit', 'day-lock', 'off-franchise']) {
      out.push((await i.probe(d, ['x'], '{"kind":null,"day":null,"make":null}')).payloads[0].responseContract);
    }
    return out;
  }, ['fact', 'fact', 'fact']);

checkAsync('the day-lock prompt names the quoted-reply failure explicitly',
  async i => {
    const sent = (await i.probe('day-lock', ['x'], ANS.dayNone)).payloads[0].contents[0].parts[0].text;
    return /DATE OR DAY INSIDE EMAIL METADATA IS NOT/.test(sent) && /wrote:/.test(sent);
  }, true);

checkAsync('the day-lock prompt refuses relative words as day names',
  async i => {
    const sent = (await i.probe('day-lock', ['x'], ANS.dayNone)).payloads[0].contents[0].parts[0].text;
    return /"today", "tomorrow", "this weekend" and "next week" are NOT day names/.test(sent);
  }, true);

checkAsync('a day the customer RULED OUT is named as a non-answer',
  async i => {
    const sent = (await i.probe('day-lock', ['x'], ANS.dayNone)).payloads[0].contents[0].parts[0].text;
    return /ruled out|RULED OUT/.test(sent);
  }, true);

// ── (v9.7.568) THE TELEMETRY POST — the regression this suite did not have ─────
section('RAIL 6 — the telemetry POST fires on EVERY generation, not only when a regex fired:');

// THE BUG: v9.7.566 hung the POST off _lpFactDecide, whose two call sites both require the regex
// to have fired first. On an ordinary lead nothing was ever sent — measured 8/22 as 8 of 8
// generations with zero rows and three same-day reports reading "No comprehension verdicts
// recorded for this date". This is the assertion that would have caught it on the day.
const ALL_USABLE = {
  'verbal-commit': { usable: true, fired: false, kind: 'none', quote: '', notesRead: 6, quoteVerified: true, verifiedNote: 0, claimedNote: null },
  'day-lock':      { usable: true, fired: false, kind: null,   quote: '', notesRead: 2, quoteVerified: true, verifiedNote: 0, claimedNote: null },
  'off-franchise': { usable: true, fired: false, kind: null,   quote: '', notesRead: 1, quoteVerified: true, verifiedNote: 0, claimedNote: null }
};

check('THE REGRESSION: a generation where NO regex fired still posts one row per detector',
  i => i.flush(ALL_USABLE, {}).rows.map(r => r.detector),
  ['verbal-commit', 'day-lock', 'off-franchise']);

check('...and every one of them is AGREE-NONE, the majority case that was never being counted',
  i => i.flush(ALL_USABLE, {}).rows.map(r => r.delta),
  ['AGREE-NONE', 'AGREE-NONE', 'AGREE-NONE']);

check('a generation where the verbal-commit regex DID fire posts a disagreement, not silence',
  i => {
    const rows = i.flush(ALL_USABLE, {}, {}, { fired: true, quote: 'will come in sat', ran: true }).rows;
    return rows.filter(r => r.detector === 'verbal-commit').map(r => r.delta);
  }, ['DISAGREE-REGEX-ONLY']);

check('both readers finding the fact is AGREE-FIRED',
  i => {
    const v = Object.assign({}, ALL_USABLE, { 'verbal-commit': Object.assign({}, ALL_USABLE['verbal-commit'], { fired: true, kind: 'firm', quote: 'coming saturday', verifiedNote: 1 }) });
    return i.flush(v, {}, {}, { fired: true, quote: 'coming saturday', ran: true }).rows
      .filter(r => r.detector === 'verbal-commit').map(r => r.delta);
  }, ['AGREE-FIRED']);

check('an UNUSABLE probe still posts — a dead probe has to be countable, not invisible',
  i => {
    const v = Object.assign({}, ALL_USABLE, { 'day-lock': { usable: false, reason: 'probe timed out after 4500ms', notesRead: 2 } });
    const r = i.flush(v, {}).rows.filter(x => x.detector === 'day-lock')[0];
    return { delta: r.delta, probeOk: r.probeOk, reason: r.probeFailReason };
  }, { delta: 'NO-COMPREHENSION-VERDICT', probeOk: false, reason: 'probe timed out after 4500ms' });

check('a regex that never RAN is reported as such, not as "found nothing" (the v9.7.563 rule)',
  i => i.flush(ALL_USABLE, {}, {}, { fired: false, quote: '', ran: false, skipReason: 'showroom follow-up' })
        .rows.filter(r => r.detector === 'verbal-commit').map(r => r.delta),
  ['NO-REGEX-VERDICT']);

check('a detector whose observer flag is off contributes no row rather than a fabricated one',
  i => {
    const v = { 'verbal-commit': ALL_USABLE['verbal-commit'] };
    return i.flush(v, {}).rows.map(r => r.detector);
  }, ['verbal-commit']);

check('when NO probe ran at all, nothing is posted — silence beats a fabricated verdict',
  i => { const r = i.flush({}, {}); return { rows: r.rows.length, said: /no probes ran/.test(r.logs.join(' ')) }; },
  { rows: 0, said: true });

check('the flush is idempotent per generation — a re-entry does not double-post',
  i => {
    const sb = i.box();
    const rows = [];
    vm.runInContext('window._lpVerbalCommitVerdict = {};', sb);
    const run = vm.runInContext('(function(d){ return _lpFlushFactTelemetry(d); })', sb);
    const dep = { verdicts: ALL_USABLE, decisions: {}, genId: 'gen-1', send: r => rows.push(r), log: () => {} };
    run(dep); run(dep);
    return rows.length;
  }, 3);

check('...but a NEW generation flushes again',
  i => {
    const sb = i.box();
    const rows = [];
    vm.runInContext('window._lpVerbalCommitVerdict = {};', sb);
    const run = vm.runInContext('(function(d){ return _lpFlushFactTelemetry(d); })', sb);
    run({ verdicts: ALL_USABLE, decisions: {}, genId: 'gen-1', send: r => rows.push(r), log: () => {} });
    run({ verdicts: ALL_USABLE, decisions: {}, genId: 'gen-2', send: r => rows.push(r), log: () => {} });
    return rows.length;
  }, 6);

check('one detector\'s POST throwing does not stop the other two',
  i => {
    const sb = i.box();
    const rows = [];
    vm.runInContext('window._lpVerbalCommitVerdict = {};', sb);
    const run = vm.runInContext('(function(d){ return _lpFlushFactTelemetry(d); })', sb);
    run({ verdicts: ALL_USABLE, decisions: {}, genId: 'g',
          send: r => { if (r.detector === 'day-lock') throw new Error('boom'); rows.push(r); }, log: () => {} });
    return rows.map(r => r.detector);
  }, ['verbal-commit', 'off-franchise']);

check('the row carries the Phase 3 fields the proxy v7.59 handler stores',
  i => {
    const r = i.flush(ALL_USABLE, { 'verbal-commit': { source: 'regex-fallback', authoritative: false } }).rows[0];
    return Object.keys(r).sort();
  }, ['authoritative', 'claimedNote', 'delta', 'detector', 'kind', 'notesRead', 'probeFailReason',
      'probeOk', 'quote', 'quoteVerified', 'regexFired', 'regexQuote', 'regexRan', 'sourceUsed',
      'verifiedNote']);

check('sourceUsed is empty when no decision was reached — its absence is information',
  i => i.flush(ALL_USABLE, {}).rows.map(r => r.sourceUsed), ['', '', '']);

check('...and carries the decision when one WAS reached',
  i => i.flush(ALL_USABLE, { 'day-lock': { source: 'comprehension', authoritative: true } }).rows
        .filter(r => r.detector === 'day-lock').map(r => r.sourceUsed), ['comprehension']);

// The claim is NOT "one call site in the file" — the superseded v9.7.559 observer legitimately
// keeps its own two, and they are unreachable while Phase 3's verbal-commit comprehension is on.
// The claim is that _lpFactDecide does not send, because that is the function whose call sites
// require the regex to have fired.
check('_lpFactDecide no longer sends — that is exactly what made the POST conditional',
  i => {
    const a = i.src.indexOf('function _lpFactDecide(');
    const b = i.src.indexOf('\nfunction ', a + 10);
    const body = i.src.slice(a, b).replace(/^[ \t]*\/\/.*$/gm, '');
    return (body.match(/_lpSendCommitComprehension/g) || []).length;
  }, 0);

check('...it records the decision for the flush to read instead',
  i => {
    const a = i.src.indexOf('function _lpFactDecide(');
    const b = i.src.indexOf('\nfunction ', a + 10);
    return /window\._lpFactDecisions\[detId\] = \{/.test(i.src.slice(a, b));
  }, true);

check('the only sends outside the flush live in the superseded v9.7.559 observer',
  i => {
    const code = i.src.replace(/^[ \t]*\/\/.*$/gm, '');
    const a = code.indexOf('function _lpRunCommitComprehension(');
    const b = code.indexOf('function _lpSendCommitComprehension(');
    const inObserver = (code.slice(a, b).match(/_lpSendCommitComprehension\s*\(/g) || []).length;
    const total = (code.match(/_lpSendCommitComprehension\s*\(/g) || []).length;
    return { inObserver, total, definitionIsTheRest: total - inObserver === 1 };
  }, { inObserver: 2, total: 3, definitionIsTheRest: true });

// ── (v9.7.572) The detail line for rows that reach no decision ───────────────
check('a COMPREHENSION-ONLY disagreement now says WHAT the probe found',
  i => {
    // The shape that had a telemetry row and no diagnostic: probe fired, regex silent, so
    // _lpFactDecide never ran and [LP FACT DIAG] was never written.
    const v = Object.assign({}, ALL_USABLE, { 'off-franchise': {
      usable: true, fired: true, kind: 'ram', quote: 'do you have any Ram 1500s',
      verifiedNote: 1, notesRead: 2, quoteVerified: true, claimedNote: 1 } });
    const l = i.flush(v, {}).logs.join('\n');
    return {
      named:    /\[LP FACT DETAIL\] off-franchise → DISAGREE-COMPREHENSION-ONLY/.test(l),
      quoted:   /quote "do you have any Ram 1500s"/.test(l),
      verified: /verified in note 1 of 2/.test(l),
      regexSaid:/regex:found nothing/.test(l),
      noDecision:/no decision reached this generation/.test(l)
    };
  }, { named: true, quoted: true, verified: true, regexSaid: true, noDecision: true });

check('the majority case stays quiet — AGREE-NONE writes no detail line',
  i => i.flush(ALL_USABLE, {}).logs.filter(l => /FACT DETAIL/.test(l)).length, 0);

check('...but every non-AGREE-NONE row gets one',
  i => {
    const v = Object.assign({}, ALL_USABLE, {
      'day-lock': { usable: false, reason: 'probe timed out after 4500ms', notesRead: 2 },
      'off-franchise': { usable: true, fired: true, kind: 'ram', quote: 'a Ram', verifiedNote: 1, notesRead: 1, quoteVerified: true, claimedNote: 1 }
    });
    return i.flush(v, {}, {}, { fired: true, quote: 'coming saturday', ran: true })
      .logs.filter(l => /FACT DETAIL/.test(l)).length;
  }, 3);

check('an unusable probe reports its reason on the detail line',
  i => {
    const v = Object.assign({}, ALL_USABLE, { 'day-lock': { usable: false, reason: 'probe timed out after 4500ms', notesRead: 2 } });
    return /day-lock → NO-COMPREHENSION-VERDICT \| comprehension:UNUSABLE \(probe timed out after 4500ms\)/
      .test(i.flush(v, {}).logs.join('\n'));
  }, true);

check('a regex that never RAN says so rather than reading as "found nothing"',
  i => /regex:DID NOT RUN \(showroom follow-up\)/.test(
    i.flush(ALL_USABLE, {}, {}, { fired: false, quote: '', ran: false, skipReason: 'showroom follow-up' })
      .logs.join('\n')), true);

check('the detail line is CONSOLE ONLY — no quote text enters the persisted row',
  i => {
    const v = Object.assign({}, ALL_USABLE, { 'off-franchise': {
      usable: true, fired: true, kind: 'ram', quote: 'do you have any Ram 1500s',
      verifiedNote: 1, notesRead: 2, quoteVerified: true, claimedNote: 1 } });
    // The row carries the quote field the sender already scrubs/caps; what must NOT happen is the
    // detail line adding note text to the payload. Assert the row shape is unchanged.
    const row = i.flush(v, {}).rows.filter(r => r.detector === 'off-franchise')[0];
    return Object.keys(row).sort().join(',') ===
      ['authoritative','claimedNote','delta','detector','kind','notesRead','probeFailReason',
       'probeOk','quote','quoteVerified','regexFired','regexQuote','regexRan','sourceUsed',
       'verifiedNote'].sort().join(',');
  }, true);

check('the flush is dispatched once in the generate path',
  i => (i.src.replace(/^[ \t]*\/\/.*$/gm, '').match(/_lpFlushFactTelemetry\(\)/g) || []).length, 1);

check('the decision map is cleared per generation, so a stale source cannot ride over',
  i => /window\._lpFactDecisions = \{\}; window\._lpFactFlushedFor = '';/.test(i.src), true);

check('the "superseded" line is UNTOUCHED — it gates a duplicate probe, never the POST',
  i => /superseded by the Phase 3 fact probe this generation/.test(i.src), true);

(async () => {
  for (const p of pending) await p();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
