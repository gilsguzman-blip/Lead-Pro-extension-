#!/usr/bin/env node
'use strict';
/**
 * observer-wiring.test.js — v9.7.562.
 *
 * THE TEST THAT WAS MISSING, and its absence is why the bug shipped.
 *
 * Every existing observer suite injects ctxText directly — commit-comprehension.test.js and
 * commit-persistence.test.js both call _lpRunCommitComprehension(ctx, verdict, deps) with a
 * context they construct themselves. They exercise the FUNCTION perfectly and never once
 * exercise the WIRING that decides what the function is handed. So a dispatch site passing an
 * always-empty expression passed every suite in the repo.
 *
 * THE BUG: the v9.7.559 dispatch passed `(lastScrapedData && lastScrapedData.context) || ''`
 * while the regex path it mirrors reads `data.context` — which buildUserPrompt receives as
 * `context: leadContext`. lastScrapedData.context is not stale, it is never populated: this
 * file's own [LP CTX-SCOPE DIAG] prints "legacy d.context was: undefined (expected)". The
 * expression evaluated to '' on every generation.
 *
 * MEASURED on log120 (8/21, running v9.7.561-dev): 7 generations, 7 × "SKIPPED — no readable
 * notes", ZERO verdicts — while [LP VERBAL COMMIT DIAG] read real notes on 4 of them, one
 * reporting "note 1 of 16 on the lead (12 call, 4 general)". The disagreement dataset the whole
 * Phase 2 programme exists to collect was empty, not undercounted.
 *
 * This suite slices the ACTUAL DISPATCH SITE out of the shipped file and runs it, so what the
 * observer is handed is asserted rather than assumed.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2);
if (!BUILDS.length) { console.error('usage: observer-wiring.test.js <popup.js> [popup.js...]'); process.exit(2); }

const KIA = fs.readFileSync(path.join(__dirname, 'fixtures', 'log120-kia-context.txt'), 'utf8');

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const at = n => { const i = src.indexOf(n); if (i < 0) throw new Error('missing ' + n + ' in ' + file); return i; };

  // The dispatch site, verbatim. Bounded by its own comment marker and its catch.
  const da = at('      // (v9.7.562) LIVE WIRING BUG, FIXED.');
  const db = at("      } catch (_lpccErr) { try { console.log('[LP COMMIT COMPREHENSION DIAG] dispatch failed:'");
  const dispatchSrc = src.slice(da, db) + '      } catch (_lpccErr) { throw _lpccErr; }\n';

  // The observer + its dependencies, for the end-to-end run.
  const spans = [
    [at('var LP_SCAFFOLD_LINE_RE ='), at('// (v9.7.429/427) ONE definition of')],
    [at('var LP_CRM_ENTRY_SPLIT_RE ='), at('// ── (v9.7.560) NOTE TYPES')],
    [at('// ── (v9.7.560) NOTE TYPES'), at('// ── (v9.7.561) PHASE A')],
    [at('// ── (v9.7.558) COMPREHENSION PASS'), at('// (v9.7.559) DURABLE, NOT EPHEMERAL')]
  ];

  return {
    name: path.basename(path.dirname(file)), src, dispatchSrc,

    // Run the real dispatch site with a stubbed observer, so we can see exactly what ctxText
    // and which ctxSource the wiring hands over.
    dispatch: (scope) => {
      const seen = [];
      const sandbox = Object.assign({
        console: { log() {} }, JSON, String, Object,
        _lpRunCommitComprehension: (ctxText, verdict, deps) => { seen.push({ ctxText, verdict, deps }); }
      }, scope);
      vm.createContext(sandbox);
      vm.runInContext('(function(){\n' + dispatchSrc + '})()', sandbox);
      return seen;
    },

    // The observer itself, for the end-to-end assertion.
    observer: () => {
      const logs = [];
      const sandbox = {
        console: { log: (...x) => logs.push(x.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' ')) },
        window: {}, JSON, Promise, Date, String, Number, Object, Array, RegExp, Math
      };
      vm.createContext(sandbox);
      spans.forEach(([a, b]) => vm.runInContext(src.slice(a, b), sandbox));
      const run = vm.runInContext('(function(c,v,d){ return _lpRunCommitComprehension(c,v,d); })', sandbox);
      return { logs, run };
    }
  };
}

// (v9.7.597) Extraction failure is a REPORTED failure, not a fatal one — see
// tests/lib/guarded-impls.js. Pointed at a build that predates the code under test,
// this suite now runs every assertion and fails loudly instead of printing nothing.
const guardedImpls = require('./lib/guarded-impls.js');
const impls = guardedImpls(BUILDS, extract);
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

// The shape the live code is in at the dispatch site.
const LIVE = (ctx) => ({
  leadContext: ctx,
  lastScrapedData: { context: undefined, autoLeadId: '2070719392' },   // as the scraper really leaves it
  window: { _lpVerbalCommitVerdict: { fired: false, quote: '', noteType: '[CALL NOTE]' } }
});

console.log('\nv9.7.562 — the observer is handed the same text the regex reads');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

console.log('the dispatch site, sliced out of the shipped file and actually run:');

check('it hands over leadContext, not the empty lastScrapedData.context',
  i => { const s = i.dispatch(LIVE(KIA)); return { calls: s.length, ctxLen: s[0].ctxText.length }; },
  { calls: 1, ctxLen: KIA.length });

check('the text it hands over is byte-identical to what the regex path reads',
  i => i.dispatch(LIVE(KIA))[0].ctxText === KIA, true);

check('it reports which source it used',
  i => i.dispatch(LIVE(KIA))[0].deps.ctxSource, 'leadContext');

check('the regex verdict still rides along',
  i => i.dispatch(LIVE(KIA))[0].verdict.noteType, '[CALL NOTE]');

console.log('\nthe exact failure the live build had:');

check('lastScrapedData.context is undefined in the live shape — the v9.7.559 expression was always \'\'',
  i => {
    const lsd = LIVE(KIA).lastScrapedData;
    return (lsd && lsd.context) || '';
  }, '');

check('...and with leadContext EMPTY the dispatch reports NONE rather than pretending',
  i => {
    const s = i.dispatch({ leadContext: '', lastScrapedData: { context: undefined }, window: {} });
    return { ctxLen: s[0].ctxText.length, source: s[0].deps.ctxSource };
  }, { ctxLen: 0, source: 'NONE' });

check('the fallback still works if leadContext ever goes missing but the legacy field returns',
  i => {
    const s = i.dispatch({ leadContext: '', lastScrapedData: { context: 'legacy text here' }, window: {} });
    return { ctx: s[0].ctxText, source: s[0].deps.ctxSource };
  }, { ctx: 'legacy text here', source: 'lastScrapedData.context' });

check('a missing verdict stash does not throw the dispatch',
  i => i.dispatch({ leadContext: KIA, lastScrapedData: {}, window: {} })[0].verdict,
  { fired: false, quote: '' });

console.log('\nthe dispatch no longer names the broken source at all:');

check('the shipped dispatch reads leadContext first',
  i => /var _ccCtx = \(typeof leadContext === 'string' && leadContext\) \? leadContext/.test(i.dispatchSrc), true);

check('the old always-empty expression is gone as the primary source',
  i => /_lpRunCommitComprehension\(\s*\n\s*\(lastScrapedData && lastScrapedData\.context\) \|\| ''/.test(i.src), false);

// ── End to end on the real log120 capture ─────────────────────────────────────
section('end to end on the real log120 lead — the observer now sees the notes:');

const observeWith = (i, ctx) => {
  const { logs, run } = i.observer();
  let probeText = '';
  return run(ctx, { fired: false, quote: '', noteType: '[CALL NOTE]' }, {
    fetch: (u, o) => {
      probeText = JSON.parse(o.body).contents[0].parts[0].text;
      return Promise.resolve({ json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: '{"kind":"none","note":null,"quote":null}' }] } }] }) });
    },
    endpoint: { url: 'https://example.invalid/g' }, attach: p => p,
    log: (...x) => logs.push(x.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' ')),
    send: () => {}, ctxSource: 'leadContext'
  }).then(r => ({ result: r, logs, probeText }));
};

checkAsync('it reads the real call notes instead of skipping',
  async i => {
    const o = await observeWith(i, KIA);
    return { skipped: o.result === null, notesRead: o.result && o.result.notesRead };
  }, { skipped: false, notesRead: 2 });

checkAsync('the note it read is the one the regex diagnostic named',
  async i => /Hung up/.test((await observeWith(i, KIA)).probeText), true);

// The lead has three call notes: "Hung up" (Contacted), a System callmeasurement URL row, and
// "Left message" (Machine). Only the last is boilerplate, so two are read and one refused.
checkAsync('the machine-drop note is still refused, not read',
  async i => {
    const o = await observeWith(i, KIA);
    return { refused: o.result.notesRefused, probeHasLeftMessage: /Left message/.test(o.probeText) };
  }, { refused: 1, probeHasLeftMessage: false });

// NOTED, NOT FIXED HERE. A System-authored callmeasurement URL row is not conversation, and it
// now reaches the probe as a numbered note. Adding it to the boilerplate filter is a one-line
// change, but v9.7.560 made that filter SHARED with the verbal-commit regex path, so touching it
// would change commit-detection behaviour in a build whose whole job is a wiring fix. Pinned
// here so the next build has the evidence rather than rediscovering it.
checkAsync('a System URL row currently reaches the probe — recorded so it is not lost',
  async i => /callmeasurement\.com/.test((await observeWith(i, KIA)).probeText), true);

checkAsync('the fired log names the source and the length, so the wiring is visible',
  async i => {
    const o = await observeWith(i, KIA);
    // 6591, not the 6586 a byte/char count suggests: the context carries five astral emoji
    // (💲🚙🎯🔥📋) and a JS string length counts those as surrogate pairs.
    return /ctxSource:leadContext ctxLen:6591/.test(o.logs.join(' '));
  }, true);

// ── The three-way skip diagnostic ─────────────────────────────────────────────
section('SKIPPED now says WHICH of three things happened:');

const skipWith = (i, ctx, ctxSource) => {
  const { logs, run } = i.observer();
  return run(ctx, { fired: false, quote: '' }, {
    fetch: () => { throw new Error('probe must not run'); },
    endpoint: { url: 'https://example.invalid/g' }, attach: p => p,
    log: (...x) => logs.push(x.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' ')),
    send: () => {}, ctxSource: ctxSource
  }).then(() => logs.join(' '));
};

checkAsync('empty context reports a WIRING FAULT, not a note-free lead',
  async i => /NO CONTEXT TEXT REACHED THE OBSERVER — this is a wiring fault, not a note-free lead\. ctxSource:NONE ctxLen:0/
    .test(await skipWith(i, '', 'NONE')), true);

checkAsync('a lead that genuinely has no notes says exactly that',
  async i => /this lead genuinely carries no CRM notes \| ctxLen:\d+/.test(
    await skipWith(i, '[08/20/2026 9:00 AM] [AGENT] Outbound Text Message\n  Sent to: x Sent by: A\n  hello', 'leadContext')), true);

checkAsync('a lead whose notes were all refused says THAT, with the count',
  async i => /every note was refused \(1 as boilerplate or contact data\) \| ctxLen:\d+/.test(
    await skipWith(i, '[08/20/2026 9:00 AM] [CALL NOTE] Outbound phone call (Machine)\n  By: A\n  Left message', 'leadContext')), true);

checkAsync('the three skip reasons are mutually exclusive — no lead reports two',
  async i => {
    const cases = ['', '[08/20/2026 9:00 AM] [AGENT] Outbound\n  Sent to: x Sent by: A\n  hi',
                   '[08/20/2026 9:00 AM] [CALL NOTE] Outbound phone call (Machine)\n  By: A\n  Left message'];
    const outs = await Promise.all(cases.map(c => skipWith(i, c, 'leadContext')));
    return outs.map(o => [/wiring fault/.test(o), /genuinely carries no CRM notes/.test(o),
                          /every note was refused/.test(o)].filter(Boolean).length);
  }, [1, 1, 1]);

checkAsync('the skip line still carries the regex verdict for side-by-side reading',
  async i => {
    const { logs, run } = i.observer();
    await run('', { fired: true, quote: 'x', noteType: '[CALL NOTE]' }, {
      fetch: () => { throw new Error('no'); }, endpoint: { url: 'u' }, attach: p => p,
      log: (...x) => logs.push(x.join(' ')), send: () => {}, ctxSource: 'NONE' });
    return /regex:FIRED \(regex read a \[CALL NOTE\]\)/.test(logs.join(' '));
  }, true);

// ── (v9.7.563) THE STALE VERDICT STASH ────────────────────────────────────────
// log121, first live batch after the v9.7.562 fix. Its only two DISAGREE-REGEX-ONLY rows are
// Alissa's two grabs — and BOTH are 🏪 SHOWROOM FOLLOW-UP leads carrying no [LP VERBAL COMMIT
// DIAG] line at all, because the block is gated `if (hasCallNoteContent && !isShowroomFollowUp)`.
// The regex never ran on her lead. v9.7.558 put the stash RESET inside that same gate, so
// window._lpVerbalCommitVerdict kept the previous lead's value and the observer compared against
// a verdict belonging to a different customer. The quote it reported — "coming in he lives in
// Mississippi" — is not in Alissa's notes at all.
// Same class as the v9.7.562 wiring bug, and this one was mine.
section('the reset must run even when the verbal-commit block does not:');

const resetSrc = (i) => {
  const a = i.src.indexOf('  // ── (v9.7.563) THE RESET MUST BE OUTSIDE THE GATE');
  const b = i.src.indexOf('  if (hasCallNoteContent && !data.isShowroomFollowUp) {');
  return { block: i.src.slice(a, b), gateAt: b, resetAt: a };
};

check('the reset is placed BEFORE the gate, not inside it',
  i => { const r = resetSrc(i); return r.resetAt > 0 && r.gateAt > r.resetAt; }, true);

check('the reset no longer appears anywhere inside the gated block',
  i => {
    const g = i.src.indexOf('  if (hasCallNoteContent && !data.isShowroomFollowUp) {');
    const e = i.src.indexOf('  if (data.conversationBrief && (data.convState !== ');
    return (i.src.slice(g, e).match(/_lpVerbalCommitVerdict = \{ fired: false/g) || []).length;
  }, 0);

// Run the hoisted reset with the two shapes that skip the block.
const runReset = (i, scope) => {
  const sandbox = Object.assign({ window: {}, console: { log() {} } }, scope);
  vm.createContext(sandbox);
  vm.runInContext('(function(){\n' + resetSrc(i).block + '})()', sandbox);
  return sandbox.window._lpVerbalCommitVerdict;
};

check('a showroom-followup lead clears the stash and records why',
  i => runReset(i, { hasCallNoteContent: true, data: { isShowroomFollowUp: true } }),
  { fired: false, quote: '', note: '', noteType: '', subject: '',
    ran: false, skipReason: 'showroom follow-up — the v9.7.197 exception' });

check('a lead with no call-note content clears it too',
  i => runReset(i, { hasCallNoteContent: false, data: { isShowroomFollowUp: false } }),
  { fired: false, quote: '', note: '', noteType: '', subject: '',
    ran: false, skipReason: 'no call-note content on the lead' });

check('a lead where the block WILL run marks ran:true',
  i => runReset(i, { hasCallNoteContent: true, data: { isShowroomFollowUp: false } }).ran, true);

check('...and Alissa can no longer inherit a previous lead\'s quote',
  i => {
    const sandbox = { window: { _lpVerbalCommitVerdict: { fired: true, quote: 'coming in he lives in Mississippi', ran: true } },
                      console: { log() {} }, hasCallNoteContent: true, data: { isShowroomFollowUp: true } };
    vm.createContext(sandbox);
    vm.runInContext('(function(){\n' + resetSrc(i).block + '})()', sandbox);
    return { fired: sandbox.window._lpVerbalCommitVerdict.fired,
             quote: sandbox.window._lpVerbalCommitVerdict.quote };
  }, { fired: false, quote: '' });

section('a regex that never ran is reported as such, not as "none":');

const observeRan = (i, verdict) => {
  const { logs, run } = i.observer();
  return run('[08/19/2026 4:10 PM] [CALL NOTE] Inbound phone call\n  By: A\n  returning call, transferred to gerald',
    verdict, {
      fetch: () => Promise.resolve({ json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: '{"kind":"none","note":null,"quote":null}' }] } }] }) }),
      endpoint: { url: 'https://example.invalid/g' }, attach: p => p,
      log: (...x) => logs.push(x.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' ')),
      send: () => {}, ctxSource: 'leadContext'
    }).then(r => ({ result: r, logs }));
};

checkAsync('ran:false yields NO-REGEX-VERDICT, not AGREE-NONE',
  async i => (await observeRan(i, { fired: false, quote: '', ran: false, skipReason: 'showroom follow-up — the v9.7.197 exception' })).result.delta,
  'NO-REGEX-VERDICT');

checkAsync('...and the log says the regex did not run, and why',
  async i => /regex:DID NOT RUN \(showroom follow-up — the v9.7.197 exception\)/.test(
    (await observeRan(i, { fired: false, quote: '', ran: false, skipReason: 'showroom follow-up — the v9.7.197 exception' })).logs.join(' ')),
  true);

checkAsync('a stale FIRED verdict with ran:false does NOT become a disagreement',
  async i => (await observeRan(i, { fired: true, quote: 'coming in he lives in Mississippi', ran: false, skipReason: 'showroom follow-up — the v9.7.197 exception' })).result.delta,
  'NO-REGEX-VERDICT');

checkAsync('a genuine ran:true disagreement still reports DISAGREE-REGEX-ONLY',
  async i => (await observeRan(i, { fired: true, quote: 'will come in Friday', ran: true })).result.delta,
  'DISAGREE-REGEX-ONLY');

checkAsync('rows from before v9.7.563 carry no `ran` and stay readable',
  async i => (await observeRan(i, { fired: false, quote: '' })).result.delta, 'AGREE-NONE');

checkAsync('quoteVerified reads n/a when comprehension said none — it verified nothing',
  async i => /quoteVerified:n\/a \(nothing to verify\)/.test(
    (await observeRan(i, { fired: false, quote: '', ran: true })).logs.join(' ')), true);

checkAsync('the persisted payload carries regexRan so the reporter can exclude it',
  async i => {
    let body = null;
    await observeRan(i, { fired: false, quote: '', ran: false, skipReason: 'x' });
    const r = await i.observer().run('[08/19/2026 4:10 PM] [CALL NOTE] Inbound phone call\n  By: A\n  returning call, transferred to gerald',
      { fired: false, quote: '', ran: false, skipReason: 'x' }, {
        fetch: () => Promise.resolve({ json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: '{"kind":"none","note":null,"quote":null}' }] } }] }) }),
        endpoint: { url: 'u' }, attach: p => p, log: () => {}, send: () => {} });
    return r.regexRan;
  }, false);

(async () => {
  for (const p of pending) await p();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
