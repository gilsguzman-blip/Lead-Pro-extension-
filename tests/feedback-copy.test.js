#!/usr/bin/env node
'use strict';
// (v9.7.597) Registered BEFORE anything can throw. A suite that dies during module
// evaluation prints nothing, and nothing reads exactly like 'asserted nothing wrong'.
// See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('feedback-copy.test.js');

/**
 * feedback-copy.test.js — regression tests for v9.7.549 / v9.7.548.
 *
 * Two defects, found while investigating Konye Brown (Community Honda Lafayette, lead
 * 2068417329, 8/15) — a lead where VinSolutions shows a real outbound SMS at 8:31 AM carrying
 * the canonical stacked signature enforceSmsSig appends (so it was demonstrably an LP draft),
 * while the feedback rows for that morning show no copy anywhere.
 *
 *   A. PHANTOM 'incomplete' ROW PER PANEL LOAD. The module-init _lpFeedbackReset() minted a real
 *      generationId, which defeated the flush guard on the very next generate — so every panel
 *      session POSTed one row for a session that never existed, with no meta and therefore no
 *      store. log111 is the proof: build loads at line 9, first "Generating" at line 213, and
 *      between them
 *        [LP FEEDBACK] incomplete | no_interaction | trigger: superseded | regens: 0 | chips: none
 *      with no prior generation in the file to account for it.
 *
 *   B. A HAND-MADE COPY LEFT NO SIGNAL. Only the Copy button set hasCopied. An agent who selected
 *      the draft and pressed Ctrl+C sent a real message and recorded nothing — and because both
 *      negative legs of _lpFeedbackDeriveRating are guarded on !hasCopied, that session then
 *      flushed as 'down' on the next generate. A used draft recorded as a rejected one.
 *
 * The state machine is sliced out of each shipped popup.js and driven for real: init → generate →
 * regen → regen → regen → copy, exactly the sequence reported on this lead.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2);
if (!BUILDS.length) { console.error('usage: feedback-copy.test.js <popup.js> [popup.js...]'); process.exit(2); }

function fnSrc(src, decl, file) {
  const i = src.indexOf(decl);
  if (i < 0) throw new Error('missing ' + decl + ' in ' + file);
  let d = src.indexOf('{', i), depth = 0, j = d;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(i, j + 1);
}

function build(file) {
  const src = fs.readFileSync(file, 'utf8');
  const ctx = { console: { log() {}, warn() {} } };
  vm.createContext(ctx);

  vm.runInContext(
    'var sent = [];\n' +
    // the real state object literal, verbatim
    'var ' + (function () {
      const i = src.indexOf('var _lpFeedback = {');
      const j = src.indexOf('\n};', i);
      return src.slice(i + 4, j + 3);
    })() + '\n' +
    fnSrc(src, 'function _lpFeedbackDeriveRating()', file) + '\n' +
    fnSrc(src, 'function _lpFeedbackDeriveSignalType()', file) + '\n' +
    fnSrc(src, 'function _lpFeedbackFlush(', file) + '\n' +
    fnSrc(src, 'function _lpFeedbackReset(', file) + '\n' +
    // stand-in for the real send: same guards as the shipped one, records instead of POSTing.
    'function _lpFeedbackSend(triggerReason, isFlush) {\n' +
    '  var rating = _lpFeedbackDeriveRating();\n' +
    '  if (isFlush && !rating) rating = (typeof isFlush === "string" ? isFlush : "abandoned");\n' +
    '  if (!rating || !_lpFeedback.generationId) return;\n' +
    '  sent.push({ rating: rating, signal: _lpFeedbackDeriveSignalType(), trigger: triggerReason,\n' +
    '              hasMeta: !!(_lpFeedback.meta && Object.keys(_lpFeedback.meta).length) });\n' +
    '}\n' +
    // the shipped native-copy listener body, lifted out of the forEach that binds it
    'function manualCopy(_cpPane) {\n' +
    '  var _cpField = { value: "a draft" };\n' +
    (function () {
      const a = src.indexOf('      if (!_cpField.value) return;');
      const b = src.indexOf("    } catch (e) { /* never let feedback break a copy */ }", a);
      if (a < 0 || b < 0) throw new Error('missing the native copy listener in ' + file);
      return src.slice(a, b);
    })() +
    '}\n' +
    // the Copy BUTTON path, in the three lines the shipped handler uses
    'function buttonCopy(pane) {\n' +
    '  _lpFeedback.hasCopied       = true;\n' +
    '  _lpFeedback.copiedAfterChip = _lpFeedback.chipCount > 0;\n' +
    '  _lpFeedback.copiedAfterRegen= _lpFeedback.regenCount > 0;\n' +
    '  _lpFeedbackSend("copy_" + pane);\n' +
    '}\n' +
    // generate == the shipped call site: reset, then bump regen if the strip is already visible,
    // then capture meta once the response lands.
    'function generate(isRegen, succeeds) {\n' +
    '  _lpFeedbackReset();\n' +
    '  if (isRegen) _lpFeedback.regenCount++;\n' +
    '  if (succeeds !== false) _lpFeedback.meta = { store: "Community Honda Lafayette", autoLeadId: "2068417329" };\n' +
    '}\n' +
    'function chip(label) { _lpFeedback.chipCount++; _lpFeedback.chipsUsed.push(label); }\n' +
    'function boot() { _lpFeedbackReset(true); }\n' +
    'function panelClose() { _lpFeedbackFlush("panel_closed"); }\n',
    ctx);

  return {
    name: path.basename(path.dirname(file)),
    run(script) {
      vm.runInContext('sent = []; _lpFeedback = { generationId: null, regenCount: 0, chipCount: 0,' +
        ' chipsUsed: [], hasCopied: false, manualCopiedPanes: [], copiedAfterChip: false,' +
        ' copiedAfterRegen: false, explicitRating: null, meta: {} };', ctx);
      vm.runInContext(script, ctx);
      return vm.runInContext('sent', ctx);
    }
  };
}

// (v9.7.597) Extraction failure is a REPORTED failure, not a fatal one — see
// tests/lib/guarded-impls.js. Pointed at a build that predates the code under test,
// this suite now runs every assertion and fails loudly instead of printing nothing.
const guardedImpls = require('./lib/guarded-impls.js');
const impls = guardedImpls(BUILDS, build);
let pass = 0, fail = 0;
function eq(name, script, want) {
  const results = impls.map(i => { try { return JSON.stringify(i.run(script)); } catch (e) { return 'THREW: ' + e.message; } });
  const agree = results.every(r => r === results[0]);
  const ok = agree && results[0] === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; console.log('  FAIL ' + name);
    if (!agree) impls.forEach((i, n) => console.log('        ' + i.name + ' -> ' + results[n]));
    else console.log('        expected ' + JSON.stringify(want) + '\n        got      ' + results[0]);
  }
}
const row = (rating, signal, trigger, hasMeta) => ({ rating, signal, trigger, hasMeta });

console.log('\nv9.7.549 — no phantom row on panel load; a hand-made copy is still a copy');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

console.log('A. THE PHANTOM ROW — every panel load emitted one:');
eq('panel loads, agent generates once: exactly ONE session, and it is not a phantom',
  'boot(); generate(false, true);', []);
eq('...and closing the panel without touching the draft reports that ONE session honestly',
  'boot(); generate(false, true); panelClose();',
  [row('abandoned', 'no_interaction', 'panel_closed', true)]);
eq('panel loads and the agent never generates at all — nothing is reported',
  'boot(); panelClose();', []);
eq('two generates in a row still flush exactly one superseded session, not two',
  'boot(); generate(false, true); generate(false, true);',
  [row('abandoned', 'no_interaction', 'superseded', true)]);
eq('a genuinely failed generate (no meta) is still reported as incomplete',
  'boot(); generate(false, false); generate(false, true);',
  [row('incomplete', 'no_interaction', 'superseded', false)]);

console.log('\nB. THE KONYE BROWN SEQUENCE — generate, three regens, then copy and send:');
// NOTE ON THE FIRST ROW, because it is easy to expect wrongly: the regen counter belongs to the
// session the regen CREATES, not the one it replaces (the shipped call site does
// `_lpFeedbackReset(); if (_isRegenSession) _lpFeedback.regenCount++;`). So the opening draft
// flushes as 'abandoned' — produced, never used — and only the sessions that were themselves
// regenerated read as 'down'. That is the pre-existing semantics and this build does not change it.
eq('the final copy is attributed, and the discarded drafts are each recorded',
  'boot(); generate(false, true); generate(true, true); generate(true, true); generate(true, true); buttonCopy("sms");',
  [ row('abandoned', 'no_interaction', 'superseded', true),
    row('down', 'implicit_regen_no_copy', 'superseded', true),
    row('down', 'implicit_regen_no_copy', 'superseded', true),
    row('neutral', 'implicit_regen_copy', 'copy_sms', true) ]);
eq('...and the same sequence ending in a HAND-MADE Ctrl+C is no longer lost',
  'boot(); generate(false, true); generate(true, true); generate(true, true); generate(true, true); manualCopy("sms");',
  [ row('abandoned', 'no_interaction', 'superseded', true),
    row('down', 'implicit_regen_no_copy', 'superseded', true),
    row('down', 'implicit_regen_no_copy', 'superseded', true),
    row('neutral', 'implicit_regen_copy', 'copy_sms_manual', true) ]);
eq('...and the copied session is NOT then re-reported as abandoned when the panel closes',
  'boot(); generate(false, true); generate(true, true); manualCopy("sms"); panelClose();',
  [ row('abandoned', 'no_interaction', 'superseded', true),
    row('neutral', 'implicit_regen_copy', 'copy_sms_manual', true) ]);
eq('...nor when the agent generates again afterwards',
  'boot(); generate(false, true); manualCopy("sms"); generate(false, true);',
  [ row('up', 'implicit_copy', 'copy_sms_manual', true) ]);

console.log('\n   a clean first-try hand copy reads as a clean first-try:');
eq('no regen, no chip, manual copy → up / implicit_copy',
  'boot(); generate(false, true); manualCopy("sms");',
  [row('up', 'implicit_copy', 'copy_sms_manual', true)]);
eq('chip then manual copy → weak_up / implicit_chip_copy',
  'boot(); generate(false, true); chip("lead-distance"); manualCopy("email");',
  [row('weak_up', 'implicit_chip_copy', 'copy_email_manual', true)]);

console.log('\n   the manual path is deduped and cannot fabricate volume:');
eq('copying the same pane three times is ONE signal',
  'boot(); generate(false, true); manualCopy("sms"); manualCopy("sms"); manualCopy("sms");',
  [row('up', 'implicit_copy', 'copy_sms_manual', true)]);
eq('copying two different panes records each once',
  'boot(); generate(false, true); manualCopy("sms"); manualCopy("email");',
  [ row('up', 'implicit_copy', 'copy_sms_manual', true),
    row('up', 'implicit_copy', 'copy_email_manual', true) ]);
eq('a new generation re-arms the dedupe',
  'boot(); generate(false, true); manualCopy("sms"); generate(true, true); manualCopy("sms");',
  [ row('up', 'implicit_copy', 'copy_sms_manual', true),
    row('neutral', 'implicit_regen_copy', 'copy_sms_manual', true) ]);
eq('a copy before anything was generated is ignored',
  'boot(); manualCopy("sms");', []);

console.log('\n   the copy BUTTON path is unchanged:');
eq('button copy, no regen → up / implicit_copy / copy_sms',
  'boot(); generate(false, true); buttonCopy("sms");',
  [row('up', 'implicit_copy', 'copy_sms', true)]);
eq('button then manual on the same pane does not double-count the manual leg',
  'boot(); generate(false, true); buttonCopy("sms"); manualCopy("sms");',
  [ row('up', 'implicit_copy', 'copy_sms', true),
    row('up', 'implicit_copy', 'copy_sms_manual', true) ]);

console.log('\n   pre-existing rejection recording is intact:');
eq('regen then abandon still reports down on the regenerated session',
  'boot(); generate(false, true); generate(true, true); panelClose();',
  [ row('abandoned', 'no_interaction', 'superseded', true),
    row('down', 'implicit_regen_no_copy', 'panel_closed', true) ]);
eq('chip then abandon still reports down',
  'boot(); generate(false, true); chip("no-appt"); panelClose();',
  [row('down', 'implicit_chip_no_copy', 'panel_closed', true)]);
eq('an explicit thumb still wins over everything',
  'boot(); generate(false, true); _lpFeedback.explicitRating = "down"; panelClose();', []);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
