#!/usr/bin/env node
'use strict';
// (v9.7.611) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('feedback-onscreen.test.js');

/**
 * feedback-onscreen.test.js — v9.7.674. AN EMPTY DRAFT IN THE EXPORT IS NOT AN EMPTY GENERATION.
 *
 * Gil, 9/16, on four rows in that day's export whose captured drafts are entirely empty:
 * "I really don't think those gens are empty though. There's a disconnect somewhere down the line
 * in the reporting. I've never seen a non Gen at any time."
 *
 * He is right, and this file proved it once already. v9.7.605 settled the same question with
 * worker timestamps: a row POSTed at 16:23:31 as "down | implicit_regen_no_copy | +drafts"
 * condemned a generation that did not START until 16:23:33, finished at 16:23:39, and was COPIED
 * at 16:23:50 as "up | implicit_copy". The drafts were fine. The row is a SUPERSEDED FLUSH — it
 * fires when the NEXT generate begins and describes the session before — and on these rows it
 * reads the output fields after something has cleared them.
 *
 * v9.7.605 printed the three field lengths to the console and declined to guess at which path
 * empties them, which still stands. THE DEFECT FIXED HERE IS NARROWER AND CERTAIN: those lengths
 * never leave the console, so nobody reading a row can tell a cleared panel from a generation
 * that produced nothing. That reading turned four artefacts into four "rejections" in the 9/16
 * numbers — half the day's reported rejections.
 *
 * Executes the SHIPPED _lpFeedbackSend against a faked DOM. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: feedback-onscreen.test.js <popup.js> [popup.js...]'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('function _lpFeedbackSend(triggerReason, isFlush) {');
  if (a < 0) throw new Error('_lpFeedbackSend not found');
  const b = src.indexOf('\n}\n', a);
  if (b < 0) throw new Error('_lpFeedbackSend end not found');
  return { name: path.basename(path.dirname(file)), src, send: src.slice(a, b + 2) };
}

// Run the shipped sender with a faked panel and capture what it would POST.
function send(impl, opts) {
  opts = opts || {};
  const fields = {
    'output-sms':   opts.sms   === undefined ? 'Aimee, the Sportage is here.' : opts.sms,
    'output-email': opts.email === undefined ? 'Subject: x\n\nHi Aimee,'      : opts.email
  };
  const posted = [];
  const logs = [];
  const sb = {
    String, JSON, Date, Math, Object, RegExp,
    document: { getElementById: id => (id in fields ? { value: fields[id] } : null) },
    window: { _leadProPriorDraft: opts.prior === undefined ? { sms: 'old', email: 'old email', voicemail: '' } : opts.prior,
              _leadProConfig: { workerUrl: 'https://example.invalid/' } },
    _lpFeedback: Object.assign({
      generationId: 'gen_test_1', regenCount: 1, chipCount: 0, chipsUsed: [],
      hasCopied: false, explicitRating: null, workerRequestId: 'req-abc-123',
      meta: { autoLeadId: '2082290355', store: 'Community Honda Baytown' }
    }, opts.fb || {}),
    _lpFeedbackDeriveRating: () => opts.rating === undefined ? 'down' : opts.rating,
    _lpFeedbackDeriveSignalType: () => opts.signal || 'implicit_regen_no_copy',
    _lpScrubPII: t => String(t || ''),
    _lpVmForLead: () => opts.vm === undefined ? '' : opts.vm,
    _lpAttachLicense: p => p,
    lastScrapedData: { autoLeadId: '2082290355' },
    fetch: (url, init) => { posted.push(JSON.parse(init.body)); return { catch: () => {} }; },
    console: { log: (...x) => logs.push(x.map(String).join(' ')) }
  };
  vm.createContext(sb);
  vm.runInContext(impl.send + '\n_lpFeedbackSend(' + JSON.stringify(opts.trigger || 'superseded')
    + ', ' + JSON.stringify(opts.isFlush === undefined ? 'abandoned' : opts.isFlush) + ');', sb);
  return { row: posted[0] || null, logs: logs.join(' ‖ ') };
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

console.log('\nv9.7.674 — a row now says whether the panel was empty when it was written');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);

// ── (1) THE ARTEFACT, REPRODUCED ────────────────────────────────────────────
console.log('\n(1) the 9/16 shape: empty drafts, and now a row that explains itself:');

check('a cleared panel produces the empty drafts the export showed',
  i => { const d = send(i, { sms: '', email: '' }).row.drafts;
         return [d.final.sms, d.final.email, d.final.voicemail]; }, ['', '', '']);
check('...and onScreen says all three fields were EMPTY when the row was built',
  i => send(i, { sms: '', email: '' }).row.drafts.onScreen,
  { sms: 0, email: 0, vm: 0, builtBy: 'flush:abandoned' });
check('...so the artefact is separable from a real empty generation, which is the whole point',
  i => { const o = send(i, { sms: '', email: '' }).row.drafts.onScreen;
         return o.sms === 0 && o.email === 0 && o.vm === 0; }, true);
check('the prior still holds the draft the agent actually saw — the row was never about nothing',
  i => send(i, { sms: '', email: '' }).row.drafts.prior.sms, 'old');

console.log('\n    a healthy row reads the opposite way:');
check('a populated panel reports real lengths',
  i => send(i).row.drafts.onScreen,
  { sms: 28, email: 21, vm: 0, builtBy: 'flush:abandoned' });
// The harness defaults isFlush to 'abandoned', so `undefined` cannot express "live" — it has to
// be passed explicitly as false, which is what the copy and thumb handlers actually pass.
check('...and a live (non-flush) row is labelled as such',
  i => send(i, { isFlush: false }).row.drafts.onScreen.builtBy, 'live');
check('a voicemail length is counted when one is on screen',
  i => send(i, { vm: 'Hi, this is Jordyn.' }).row.drafts.onScreen.vm, 19);

// ── (2) LENGTHS, NEVER CONTENT (v9.7.489) ───────────────────────────────────
console.log('\n(2) lengths never carry content — the v9.7.489 posture:');

const SECRET = 'Call Aimee at 936-776-1049 or aimee16546@hotmail.com about stock P2950';
check('every onScreen value is a number or the builtBy label',
  i => { const o = send(i, { sms: SECRET }).row.drafts.onScreen;
         return ['sms','email','vm'].every(k => typeof o[k] === 'number'); }, true);
check('no digit, address or stock number from the draft appears anywhere in onScreen',
  i => /936|776|1049|hotmail|P2950|Aimee/.test(JSON.stringify(send(i, { sms: SECRET }).row.drafts.onScreen)), false);
check('the length itself is right, so it is a real measurement',
  i => send(i, { sms: SECRET }).row.drafts.onScreen.sms, SECRET.length);

// ── (3) IT CANNOT BREAK THE ROW IT RIDES ON ─────────────────────────────────
console.log('\n(3) it must never cost a feedback row:');

check('final and prior are unchanged in shape',
  i => Object.keys(send(i).row.drafts).sort(), ['final', 'onScreen', 'prior']);
check('a null prior still serialises',
  i => send(i, { prior: null }).row.drafts.prior, null);
check('the row still carries workerRequestId, which the proxy has stored since v7.58',
  i => send(i).row.workerRequestId, 'req-abc-123');
check('...and signal and trigger, which are what separate a flush from a real thumb-down',
  i => [send(i).row.signal, send(i).row.trigger], ['implicit_regen_no_copy', 'superseded']);

console.log('\n    drafts ride only on rows that earned them (v9.7.311), unchanged:');
check('a clean first-try copy carries no drafts and therefore no onScreen',
  i => send(i, { rating: 'up', fb: { regenCount: 0, chipCount: 0 } }).row.drafts, undefined);
check('an explicit thumb-down carries them even with no regen',
  i => typeof send(i, { rating: 'down', fb: { regenCount: 0, chipCount: 0 } }).row.drafts.onScreen, 'object');

console.log('\n    the console line now carries the join key:');
check('reqId is printed so a console can be tied to a stored row',
  i => /reqId: req-abc-123/.test(send(i).logs), true);
check('...and reads "(none)" rather than blank when the proxy returned none',
  i => /reqId: \(none\)/.test(send(i, { fb: { workerRequestId: '' } }).logs), true);

// ── NON-VACUITY ─────────────────────────────────────────────────────────────
console.log('\nnon-vacuity (v9.7.674):');

const NO_ONSCREEN = c => c.replace(/\n\s*onScreen: \{[^]*?\n\s*\}\n/, '\n');
check('neuter A actually removed the onScreen block',
  i => { const m = NO_ONSCREEN(i.send); return [m !== i.send, /onScreen/.test(m)]; }, [true, false]);
check('A: without it the row is exactly what the 9/16 export showed — empty, unexplained',
  i => {
    const mutated = { ...i, send: NO_ONSCREEN(i.send) };
    const d = send(mutated, { sms: '', email: '' }).row.drafts;
    return [Object.keys(d).sort(), d.final.sms, d.onScreen === undefined];
  }, [['final', 'prior'], '', true]);
check('A (control): the shipped build explains the same row',
  i => send(i, { sms: '', email: '' }).row.drafts.onScreen.builtBy, 'flush:abandoned');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
