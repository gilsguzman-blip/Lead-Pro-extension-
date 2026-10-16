#!/usr/bin/env node
'use strict';
// (v9.7.611) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('feedback-scenario-label.test.js');

/**
 * feedback-scenario-label.test.js — v9.7.656. A LABEL THAT READ A GLOBAL NOTHING EVER WROTE.
 *
 * Gil's 9/01–9/10 feedback export: 243 rows, 243 of them scenario "standard". No exceptions, ten
 * days, every rooftop, including 40 rows whose source is a Gubagoo or digital-retail label. The
 * reporter's own summary agrees — byScenario {standard: 237, unknown: 6}.
 *
 * _lpFeedbackCaptureMeta opened with:
 *
 *     var sc = window._leadProLastScenario || {};
 *
 * and that global was assigned NOWHERE in the repository. Two reads, one per build, zero writes,
 * since 8/10. So sc was always {}, every sc.isX test was undefined, and the list always fell
 * through to its default.
 *
 * The read fails soft BY DESIGN, which is correct and is also exactly why a month of constant
 * data went unremarked. This suite drives the real wiring — the publish statement lifted out of
 * classifyScenario, the read lifted out of the capture, and the shipped label builder — so the
 * assertion is "a classification reaches the label", not "the label builder has the right ifs".
 *
 * It also carries the structural guard that would have caught this on the day it landed: every
 * read of the global must have a matching write.
 *
 * Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: feedback-scenario-label.test.js <popup.js> [popup.js...]'); process.exit(2); }

const PUBLISH = "  try { if (typeof window !== 'undefined') window._leadProLastScenario = s; } catch (_lsE) {}";
const READ    = '  var sc = window._leadProLastScenario || {};';

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  if (src.indexOf(PUBLISH) < 0) throw new Error('the publish statement is not in this build');
  if (src.indexOf(READ) < 0) throw new Error('the capture read is not in this build');

  const a = src.indexOf('    scenario:        (function() {');
  if (a < 0) throw new Error('scenario label builder not found');
  const endMark = '\n    })()';
  const b = src.indexOf(endMark, a);
  if (b < 0) throw new Error('scenario label builder end not found');
  // Drop the property name so the remainder is a bare IIFE expression.
  const label = src.slice(a + '    scenario:        '.length, b + endMark.length);

  const ca = src.indexOf('    contactedAgeDays: (function () {');
  if (ca < 0) throw new Error('contactedAgeDays not found');
  const cb = src.indexOf('    })(),', ca);
  if (cb < 0) throw new Error('contactedAgeDays end not found');
  const age = src.slice(ca + '    contactedAgeDays: '.length, cb + '    })()'.length);

  return { name: path.basename(path.dirname(file)), src, label, age };
}

// ── THE REAL WIRING: publish -> read -> label ───────────────────────────────
// `s` is the object classifyScenario builds and returns. Shaped here rather than produced by
// running the classifier, which needs the whole lead pipeline; the drift risk that shortcut
// creates is closed separately below, by asserting every flag this builder tests is one the
// classifier actually assigns.
function labelFor(impl, s, scraped, opts) {
  opts = opts || {};
  const sb = { window: {}, s, lastScrapedData: scraped || {}, __out: null };
  vm.createContext(sb);
  if (!opts.noPublish) vm.runInContext(impl.publishStmt || PUBLISH, sb);
  vm.runInContext(READ, sb);
  vm.runInContext('__out = ' + (opts.label || impl.label) + ';', sb);
  return sb.__out;
}

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
const check = (name, fn, want) =>
  report(name, impls.map(i => { try { return JSON.stringify(fn(i)); } catch (e) { return 'THREW: ' + e.message; } }), want);

console.log('\nv9.7.656 — the scenario label reaches the row');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);

// ── (1) THE STRUCTURAL GUARD THAT WOULD HAVE CAUGHT THIS ────────────────────
console.log('\n(1) the global has a writer:');

check('at least one read of _leadProLastScenario exists',
  i => (i.src.match(/=\s*window\._leadProLastScenario/g) || []).length >= 1, true);

check('...and at least one WRITE — this is the assertion that was missing',
  i => (i.src.match(/window\._leadProLastScenario\s*=/g) || []).length >= 1, true);

check('the write lives in classifyScenario, not at a call site',
  i => {
    const fnAt = i.src.indexOf('function classifyScenario(data) {');
    const wAt  = i.src.indexOf(PUBLISH);
    const nextFn = i.src.indexOf('\nfunction ', fnAt + 1);
    return fnAt > -1 && wAt > fnAt && wAt < nextFn;
  }, true);

// ── (2) THE INCIDENT ────────────────────────────────────────────────────────
// The shape that has been shipping since 8/10: an empty object, because nothing published.
console.log('\n(2) Gil\'s export, reproduced and then fixed:');

const CLICKGO = { isClickAndGo: true, isDistanceBuyer: true };
const CARGURUS = { isCarGurus: true };
const PLAIN = { isStandard: true };

check('with nothing published, every lead reads as its default — 243 of 243',
  i => [labelFor(i, CLICKGO, {}, { noPublish: true }),
        labelFor(i, CARGURUS, {}, { noPublish: true }),
        labelFor(i, PLAIN, {}, { noPublish: true })],
  ['standard', 'standard', 'standard']);

check('a Click & Go lead now labels as one',
  i => labelFor(i, CLICKGO, {}), 'clickAndGo,distance');

check('a CarGurus lead now labels as one — this was never a Click & Go problem',
  i => labelFor(i, CARGURUS, {}), 'cargurus');

check('a genuinely unremarkable lead still reads standard, which is correct',
  i => labelFor(i, PLAIN, {}), 'standard');

// ── (3) THE DUPLICATE I ADDED IN v9.7.649 ───────────────────────────────────
// Asserted on the builder's OUTPUT rather than its source: the question is whether a row carries
// the label twice, and counting pushes in the source answers a different question.
console.log('\n(3) the label appears once, not twice:');

check('a Click & Go row carries clickAndGo exactly once',
  i => (labelFor(i, CLICKGO, {}).match(/clickAndGo/g) || []).length, 1);

check('...and with the DR credit-app fact it carries both, each once',
  i => labelFor(i, { isClickAndGo: true }, { vrCreditApp: true }), 'clickAndGo,drCreditApp');

check('drCreditApp is independent of the source branch — it reads what the customer did',
  i => labelFor(i, { isCarGurus: true }, { vrCreditApp: true }), 'cargurus,drCreditApp');

check('no credit-app fact, no label',
  i => labelFor(i, { isClickAndGo: true }, { vrCreditApp: false }), 'clickAndGo');

// ── (4) THE DRIFT THE FIXTURE SHORTCUT COULD HIDE ───────────────────────────
// The shapes above are hand-built. If the classifier ever renames a flag, those fixtures would
// keep passing while production went quiet again — the same failure in a new costume. Every flag
// name this builder tests must be one classifyScenario actually assigns.
console.log('\n(4) every flag the builder tests is one the classifier assigns:');

function builderFlags(impl) {
  return Array.from(new Set((impl.label.match(/sc\.(is[A-Za-z]+)/g) || []).map(m => m.slice(3))));
}
function classifierFlags(impl) {
  const fnAt = impl.src.indexOf('function classifyScenario(data) {');
  const end  = impl.src.indexOf('\n}\n', impl.src.indexOf('\n  return s;', fnAt));
  const body = impl.src.slice(fnAt, end);
  return new Set((body.match(/\bs\.(is[A-Za-z]+)\s*=/g) || []).map(m => m.match(/is[A-Za-z]+/)[0]));
}

check('the builder tests a substantial number of flags, so this is not vacuous',
  i => builderFlags(i).length >= 20, true);

check('every one of them is assigned by classifyScenario',
  i => builderFlags(i).filter(f => !classifierFlags(i).has(f)), []);

// ── (5) THE FIELD THE ORIGINAL QUESTION NEEDED ──────────────────────────────
// isStaleClickAndGo demotes a digital-retail lead out of its own branch at contactedAgeDays >= 14,
// or on a live conversation at >= 1 day. The export carried no age, so it could be described and
// not counted.
console.log('\n(5) contactedAgeDays reaches the row:');

function ageFor(impl, scraped) {
  const sb = { parseFloat, isFinite, lastScrapedData: scraped, __out: null };
  vm.createContext(sb);
  vm.runInContext('__out = ' + impl.age + ';', sb);
  return sb.__out;
}

check('a fresh same-day contact', i => ageFor(i, { contactedAgeDays: 0.1 }), 0.1);
check('the 14-day demotion boundary', i => ageFor(i, { contactedAgeDays: 14 }), 14);
check('a string from the scrape is coerced', i => ageFor(i, { contactedAgeDays: '3.5' }), 3.5);
check('zero is kept, not turned into null — 0 is a real answer',
  i => ageFor(i, { contactedAgeDays: 0 }), 0);
check('absent reads null rather than 0, so "never contacted" is distinguishable',
  i => ageFor(i, {}), null);
check('nonsense reads null', i => ageFor(i, { contactedAgeDays: 'soon' }), null);

// ── (6) THE LABEL BUILDER ITSELF, ON REAL COMBINATIONS ──────────────────────
console.log('\n(6) the branches that have all been reporting standard:');

check('a distance buyer', i => labelFor(i, { isDistanceBuyer: true }, {}), 'distance');
check('a missed appointment', i => labelFor(i, { isMissedAppt: true }, {}), 'missedAppt');
check('a sold-and-delivered customer', i => labelFor(i, { isSoldDelivered: true }, {}), 'sold');
check('a KBB lead', i => labelFor(i, { isKBB: true }, {}), 'kbb');
check('a Facebook lead', i => labelFor(i, { isFacebook: true }, {}), 'facebook');
check('a chat lead', i => labelFor(i, { isChatLead: true }, {}), 'chat');
check('a pause lead', i => labelFor(i, { isPauseSignal: true }, {}), 'pause');
check('an exit lead', i => labelFor(i, { isExitSignal: true }, {}), 'exit');
check('a showroom follow-up', i => labelFor(i, { isShowroomFollowUp: true }, {}), 'showroom');
check('CarGurus Digital Deal wins over plain CarGurus, as the else-if intends',
  i => labelFor(i, { isCarGurusDD: true, isCarGurus: true }, {}), 'cargurusDD');
check('several at once stack in the builder\'s own push order',
  i => labelFor(i, { isClickAndGo: true, isPauseSignal: true, isDistanceBuyer: true }, {}),
  'clickAndGo,pause,distance');

// ── (7) IT CANNOT THROW ON A DEGENERATE SNAPSHOT ────────────────────────────
console.log('\n(7) the capture survives a missing or odd snapshot:');

check('an empty object', i => labelFor(i, {}, {}), 'standard');
check('a null publish falls back to the default rather than throwing',
  i => labelFor(i, null, {}), 'standard');
check('missing lastScrapedData fields do not throw',
  i => labelFor(i, { isClickAndGo: true }, {}), 'clickAndGo');

// ── (8) THE DIAGNOSTIC ──────────────────────────────────────────────────────
console.log('\n(8) a default label is never silent again:');

// THE PROSE-MATCH HAZARD (v9.7.630), and it caught me again writing this suite: the build header
// quotes this file's own code, so a position assertion that scans raw source finds the HEADER
// first and reads as though the diagnostic sits at the top of the file. Line comments are
// stripped before any source-position claim.
const code = i => i.src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

check('the capture reports whether the snapshot was present',
  i => /\[LP FEEDBACK SCENARIO DIAG\] snapshot:/.test(code(i)), true);

check('...and says plainly what a missing one means',
  i => /MISSING — every label will read as its default/.test(code(i)), true);

check('the diagnostic sits inside the capture, above the first use of sc',
  i => {
    const c = code(i);
    const cap = c.indexOf('function _lpFeedbackCaptureMeta() {');
    const dg  = c.indexOf('[LP FEEDBACK SCENARIO DIAG]', cap);
    const use = c.indexOf('sc.isClickAndGo', cap);
    return cap > -1 && dg > cap && use > dg;
  }, true);

// ── NON-VACUITY ─────────────────────────────────────────────────────────────
console.log('\nnon-vacuity (v9.7.656):');

check('neuter A: without the publish, a Click & Go lead reports standard again',
  i => labelFor(i, CLICKGO, {}, { noPublish: true }), 'standard');
check('A (control): with it, the label is correct',
  i => labelFor(i, CLICKGO, {}), 'clickAndGo,distance');
check('A: and so does every other branch, which is the month of data Gil exported',
  i => [CARGURUS, { isKBB: true }, { isMissedAppt: true }, { isSoldDelivered: true }]
        .map(s => labelFor(i, s, {}, { noPublish: true })),
  ['standard', 'standard', 'standard', 'standard']);

const DUP = l => l.replace("      if (lastScrapedData && lastScrapedData.vrCreditApp) s.push('drCreditApp');",
  "      if (sc.isClickAndGo)     s.push('clickAndGo');\n      if (lastScrapedData && lastScrapedData.vrCreditApp) s.push('drCreditApp');");
check('neuter B actually restored the v9.7.649 second push', i => DUP(i.label) !== i.label, true);
check('B: a Click & Go row carries the label twice again',
  i => (labelFor(i, CLICKGO, {}, { label: DUP(i.label) }).match(/clickAndGo/g) || []).length, 2);
check('B (control): the shipped builder carries it once',
  i => (labelFor(i, CLICKGO, {}).match(/clickAndGo/g) || []).length, 1);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
