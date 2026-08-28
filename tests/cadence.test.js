#!/usr/bin/env node
'use strict';
/**
 * cadence.test.js — v9.7.577, PHASE 1: AUTO-COMPUTED JOURNEY POSITION, INJECTION OFF.
 *
 * ── THE BRIEF'S OWN VERIFICATION GATE CANNOT BE SATISFIED, AND THAT IS WHY THIS SHIPS OFF ──
 * The brief requires the computed touch-selection be checked against real leads with KNOWN correct
 * manual selections before it is trusted on live traffic. That sample does not exist:
 *   • ZERO of the captured prompts contain a cadence [LP: ...] block.
 *   • 712 logged generations read "LP commands found: 0"; 5 found one, and all five were
 *     ["curiosity"] or ["value"] — touch ROLE tags, not 90-day cadence commands.
 * So there is nothing to compare against, and inventing a comparison would be the v9.7.564
 * fabricated-corpus mistake in a new costume. LEADPRO_CADENCE_AUTO ships FALSE: the computation
 * runs and logs on every generation, injecting nothing, which produces exactly the sample the gate
 * asks for on live traffic with no customer-facing change.
 *
 * ── WHAT IS ASSERTED ──────────────────────────────────────────────────────────────────────
 *  • The 16 touches match the document — numbers, days, channels, VALUE flags — and the
 *    instruction text is present VERBATIM and unedited. The brief is explicit that this build
 *    auto-SELECTS separately-authored content rather than rewriting it.
 *  • Reconciliation: progress wins over day-count, in BOTH directions the brief names — a lead
 *    that fell behind lands on its correct NEXT touch, and one that ran ahead is not double-counted.
 *  • A large disagreement is REFUSED rather than resolved. No touch is safer than the wrong touch.
 *  • Phone calls are not cadence touches. Counting them would over-advance every dialled lead.
 *  • A manual paste always wins, and the computed value is still logged so the two can be compared.
 *  • A bare role tag ("value", "curiosity") is NOT a cadence paste — treating it as one would
 *    suppress the computed touch on the only leads that currently carry any command at all.
 *
 * Sliced out of the SHIPPED files. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: cadence.test.js <popup.js> [popup.js...]'); process.exit(2); }

// The document's own table, transcribed independently of the code so the code is checked against
// the SOURCE rather than against itself.
// THE REAL VINSOLUTIONS CADENCE, transcribed from the live task list — NOT the .md document.
// The two differ and the live one governs: the doc has a day-2 touch the real cadence does not
// LP-command at all, and the real cadence marks day 33 as value where the doc does not. Built from
// the source that actually runs.
const DOC = [[4,'value','email'],[7,'curiosity','text'],[8,'value','email'],[13,'curiosity','text'],
             [15,'value','email'],[24,'curiosity','text'],[28,'value','email'],[33,'value','email'],
             [41,'value','email'],[45,'curiosity','text'],[53,'soft','email'],[64,'curiosity','text'],
             [68,'value','email'],[78,'curiosity','text'],[82,'soft','email']];

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('// ── (v9.7.577) 90-DAY CADENCE');
  const b = src.indexOf('var LP_CMD_STOPWORDS = {');
  if (a < 0 || b < 0 || b <= a) throw new Error('cadence block not found in ' + file);
  const sb = { console: { log() {} }, String, Number, Math, JSON, RegExp, Object, Array, parseFloat };
  vm.createContext(sb);
  vm.runInContext(src.slice(a, b), sb);
  return {
    name: path.basename(path.dirname(file)), src,
    code: src.replace(/^\s*(\/\/|\*|\/\*).*$/gm, ''),
    read: e => vm.runInContext(e, sb),
    count: t => vm.runInContext('_lpCadenceCountTouches', sb)(t),
    compute: (age, sent) => vm.runInContext('_lpComputeCadenceTouch', sb)(age, sent),
    cadence: d => vm.runInContext('_lpCadence', sb)(d),
    render: t => vm.runInContext('_lpRenderCadenceTouch', sb)(t),
    diag: r => { const L = []; vm.runInContext('_lpCadenceDiag', sb)(r, (...x) => L.push(x.join(' '))); return L.join('\n'); }
  };
}

// (v9.7.597) Extraction failure is a REPORTED failure, not a fatal one — see
// tests/lib/guarded-impls.js. Pointed at a build that predates the code under test,
// this suite now runs every assertion and fails loudly instead of printing nothing.
const guardedImpls = require('./lib/guarded-impls.js');
const impls = guardedImpls(BUILDS, extract);
let pass = 0, fail = 0;
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
const vmRender = (i, t) => i.render(t);
const check = (name, fn, want) =>
  report(name, impls.map(i => { try { return JSON.stringify(fn(i)); } catch (e) { return 'THREW: ' + e.message; } }), want);

// A dated transcript carrying n scheduled touches, in the real shape.
const txn = (entries) => entries.map(e =>
  '[' + e[0] + '/2026 10:40 AM] [AGENT] Outbound ' + e[1] + '\n  Sent to: (337) 441-5318 body').join('\n');

console.log('\nv9.7.577 Phase 1 — journey position, computed and logged, injected only when armed');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── It is off, and it is an observer ──────────────────────────────────────────
console.log('containment — the brief\'s verification gate has no sample, so this ships OFF:');

check('LEADPRO_CADENCE_AUTO ships false', i => i.read('LEADPRO_CADENCE_AUTO'), false);

check('with the flag off a due touch is COMPUTED but NOT injected',
  i => {
    const r = i.cadence({ leadAgeDays: 8, agentLPCommands: [], contextText: txn([['08/01','Text Message']]), flagOn: false });
    return { selected: r.touch ? r.touch.day : null, injected: r.inject.length };
  }, { selected: 7, injected: 0 });

check('...and even with the flag armed nothing is injected — the tag path is retired',
  i => {
    const r = i.cadence({ leadAgeDays: 8, agentLPCommands: [], contextText: txn([['08/01','Text Message']]), flagOn: true });
    return { selected: r.touch.day, tag: r.inject };
  }, { selected: 7, tag: '' });

// ── The document is the source of truth ───────────────────────────────────────
console.log('\nthe 16 touches match the document, and the text is verbatim:');

check('the 15 LP-commanded touches match the LIVE cadence — day, role and channel',
  i => i.read('LP_CADENCE_TOUCHES').map(t => [t.day, t.role, t.ch]), DOC);

// (v9.7.578) The tag renderer is RETIRED. v9.7.577 emitted '[LP: value]' — the same one-word
// directive an agent pastes — which automated the workaround rather than removing it. The computed
// POSITION survives as one observed fact inside the situation read; the tag does not survive at all.
check('the tag renderer is a dead stub — position is now a fact, not an injected directive',
  i => i.read('LP_CADENCE_TOUCHES').map(t => vmRender(i, t)).join('') , '');

check('only the three roles the cadence actually uses ever appear',
  i => Array.from(new Set(i.read('LP_CADENCE_TOUCHES').map(t => t.role))).sort(),
  ['curiosity', 'soft', 'value']);

check('the seven value touches are the days the live cadence marks [LP: value]',
  i => i.read('LP_CADENCE_TOUCHES').filter(t => t.role === 'value').map(t => t.day),
  [4, 8, 15, 28, 33, 41, 68]);

// ── Counting prior touches ────────────────────────────────────────────────────
console.log('\ncounting prior scheduled touches off the dated transcript:');

check('texts and emails both count',
  i => i.count(txn([['08/01','Text Message'], ['08/04','Email'], ['08/08','Text Message']])).count, 3);

check('PHONE CALLS DO NOT — the cadence is text and email only',
  i => i.count('[08/01/2026 10:40 AM] [AGENT] Outbound phone call (Contacted)\n  By: Patricia hung up').count, 0);

check('two sends the same day on the same channel count once, not twice',
  i => i.count(txn([['08/01','Text Message'], ['08/01','Text Message']])).count, 1);

check('an empty transcript is readable and simply has none',
  i => { const c = i.count(''); return { count: c.count, readable: c.readable }; }, { count: 0, readable: false });

// ── Reconciliation, both directions ───────────────────────────────────────────
console.log('\nreconciliation — progress beats the calendar, in both directions:');

check('AGREEMENT: day 15 with 4 sent lands on the day-15 value touch, both readings agreeing',
  i => {
    // days 4,7,8,13 sent -> next is day 15, which is also what the calendar says.
    const r = i.compute(15, { count: 4, readable: true, days: [] });
    return { day: r.touch.day, role: r.touch.role, conf: r.confidence };
  }, { day: 15, role: 'value', conf: 'high' });

check('BEHIND: day 15 but only 1 touch sent -> next is day 7, not the calendar\'s day 15',
  i => {
    const r = i.compute(15, { count: 1, readable: true, days: [] });
    return { day: r.touch.day, conf: r.confidence, behind: /BEHIND/.test(r.reason) };
  }, { day: 7, conf: 'reconciled', behind: true });

check('AHEAD: day 4 with 2 already sent -> next is day 8, not a third send of day 4',
  i => {
    const r = i.compute(4, { count: 2, readable: true, days: [] });
    return { day: r.touch.day, ahead: /AHEAD/.test(r.reason) };
  }, { day: 8, ahead: true });

check('FAR BEHIND is still reconciled, never refused — the brief\'s primary case',
  i => {
    // Day 82 with one touch sent is 15 touches behind. Ordinary neglect, not bad data.
    const r = i.compute(82, { count: 1, readable: true, days: [] });
    return { day: r.touch ? r.touch.day : null, conf: r.confidence };
  }, { day: 7, conf: 'reconciled' });

check('REFUSED: implausibly AHEAD selects nothing — that is what over-counting looks like',
  i => {
    // Day 4 allows only the day-4 touch. Claiming 8 sends means replies are being counted.
    const r = i.compute(4, { count: 8, readable: true, days: [] });
    return { touch: r.touch, conf: r.confidence, saysWhy: /no touch is safer/i.test(r.reason) };
  }, { touch: null, conf: 'refused', saysWhy: true });

check('...and being MODERATELY ahead is allowed — agents legitimately run early',
  i => i.compute(4, { count: 2, readable: true, days: [] }).touch.day, 8);

check('unreadable history falls back to day-count and SAYS it did',
  i => {
    const r = i.compute(28, { count: 0, readable: false, days: [] });
    return { day: r.touch.day, conf: r.confidence };
  }, { day: 28, conf: 'day-count only (outbound history unreadable)' });

// ── The edges ─────────────────────────────────────────────────────────────────
console.log('\nthe edges the document defines:');

check('before day 4 selects nothing — first-touch has its own task',
  i => { const r = i.compute(1, { count: 0, readable: true, days: [] });
         return { touch: r.touch, why: /first LP-commanded touch/.test(r.reason) }; }, { touch: null, why: true });

check('past day 90 is the monthly nurture register, not a numbered touch',
  i => { const r = i.compute(120, { count: 8, readable: true, days: [] });
         return { touch: r.touch, why: /monthly nurture/.test(r.reason) }; }, { touch: null, why: true });

check('all 15 sent means the cadence register is over',
  i => { const r = i.compute(85, { count: 15, readable: true, days: [] });
         return { touch: r.touch, why: /already sent/.test(r.reason) }; }, { touch: null, why: true });

check('an unknown lead age selects nothing rather than guessing day 2',
  i => i.compute(0, { count: 0, readable: true, days: [] }).touch, null);

// ── Manual paste wins ─────────────────────────────────────────────────────────
console.log('\nadditive — a human paste always wins, and the computed value is still logged:');

check('a pasted cadence block overrides, and nothing is injected on top of it',
  i => {
    const r = i.cadence({ leadAgeDays: 8, agentLPCommands: ['value'],
                          contextText: txn([['08/01','Text Message']]), flagOn: true });
    return { manual: r.manual, injected: r.inject.length, stillComputed: r.touch ? r.touch.day : null };
  }, { manual: true, injected: 0, stillComputed: 7 });

check('a bare ROLE tag IS the cadence paste — this is what the live cadence actually pastes',
  i => ['value', 'curiosity', 'soft', '[LP: value]'].map(c =>
    i.cadence({ leadAgeDays: 8, agentLPCommands: [c], contextText: txn([['08/01','Text Message']]), flagOn: false }).manual),
  [true, true, true, true]);

check('...but an agent CONTENT command does not suppress it — different slots',
  i => i.cadence({ leadAgeDays: 8, agentLPCommands: ['Need POI, how much down'],
                   contextText: txn([['08/01','Text Message']]), flagOn: false }).manual, false);

// ── The diagnostic ────────────────────────────────────────────────────────────
console.log('\nthe diagnostic ships with full visibility from day one:');

check('it reports age, prior count, selection, confidence, reasoning, override and injection',
  i => {
    const r = i.cadence({ leadAgeDays: 15, agentLPCommands: [], contextText: txn([['08/01','Text Message']]), flagOn: false });
    const d = i.diag(r);
    return {
      age:      /age:15d/.test(d),
      prior:    /prior touches:1/.test(d),
      selected: /selected:day-7 curiosity text/.test(d),
      conf:     /confidence:reconciled/.test(d),
      why:      /why: reconciled to prior-touch-count/.test(d),
      manual:   /manual paste:no/.test(d),
      injected: /injected:no/.test(d)
    };
  }, { age: true, prior: true, selected: true, conf: true, why: true, manual: true, injected: true });

check('an override is reported as an override, not silently',
  i => {
    const r = i.cadence({ leadAgeDays: 8, agentLPCommands: ['value'],
                          contextText: '', flagOn: true });
    return /manual paste:YES — OVERRIDES the computed value/.test(i.diag(r));
  }, true);

check('the diagnostic fires even when nothing is selected — silence is never the answer',
  i => i.diag(i.cadence({ leadAgeDays: 1, agentLPCommands: [], contextText: '', flagOn: true })).indexOf('[LP CADENCE DIAG]') === 0, true);

// ── Containment ───────────────────────────────────────────────────────────────
console.log('\ncontainment:');

check('the cadence code sits OUTSIDE inlineScraper — the v9.7.455/228 scope trap',
  i => {
    const c = i.src.indexOf('\nfunction _lpCadence(');
    const s = i.src.search(/\n\s*function inlineScraper/);
    return c > 0 && s > 0 && c < s;
  }, true);

// (v9.7.578) These two used to pin the TAG-injection site. That site is gone — the block the
// prompt now receives is the situation read (arc-state.test.js owns it), and the cadence position
// enters it as one observed fact. Asserting the old site would re-pin the design this replaced.
check('the tag-injection site is GONE — no journey-position directive is appended',
  i => (i.code.match(/SCHEDULED TOUCH — JOURNEY POSITION/g) || []).length, 0);

check('the cadence is called with flagOn hard-wired false — it can only inform, never instruct',
  i => /flagOn:\s*false\b/.test(i.code), true);

check('...and its computed position reaches the situation read as a fact',
  i => /cadence:\s*\(_cad && _cad\.touch\)/.test(i.code), true);

check('Phase 2 is NOT built — no auto-sourcing of the VALUE FACT anywhere',
  i => /_lpAutoValueFact|autoValueFact|VALUE_FACT_SOURCE/.test(i.code), false);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
