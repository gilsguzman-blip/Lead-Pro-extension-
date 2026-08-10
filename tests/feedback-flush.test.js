#!/usr/bin/env node
'use strict';
/**
 * feedback-flush.test.js — regression tests for the v9.7.540 feedback flush.
 *
 * Before this fix _lpFeedbackSend had two call sites (copy, thumb), both implying
 * hasCopied/explicitRating, so the two negative legs of _lpFeedbackDeriveRating —
 * guarded on !hasCopied — were unreachable. These tests assert the rejection signals
 * now land, that positives are unchanged, and that nothing reports twice.
 *
 * The rating/signal/flush functions are sliced out of each shipped popup.js and run
 * against a fake session state. Both builds must agree on every case.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2);
if (!BUILDS.length) { console.error('usage: feedback-flush.test.js <popup.js> [popup.js...]'); process.exit(2); }

function fnSrc(src, decl, file) {
  const i = src.indexOf(decl);
  if (i < 0) throw new Error('missing ' + decl + ' in ' + file);
  // walk braces from the first { after the declaration
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
    'var _lpFeedback = {};\n' +
    fnSrc(src, 'function _lpFeedbackDeriveRating()', file) + '\n' +
    fnSrc(src, 'function _lpFeedbackDeriveSignalType()', file) + '\n' +
    fnSrc(src, 'function _lpFeedbackFlush(', file) + '\n' +
    // stand-in for the real send: applies the same flush-rating rule the shipped send uses,
    // then records instead of POSTing.
    'function _lpFeedbackSend(triggerReason, isFlush) {\n' +
    '  var rating = _lpFeedbackDeriveRating();\n' +
    '  if (isFlush && !rating) rating = "abandoned";\n' +
    '  if (!rating || !_lpFeedback.generationId) return;\n' +
    '  sent.push({ rating: rating, signal: _lpFeedbackDeriveSignalType(), trigger: triggerReason });\n' +
    '}\n', ctx);

  return {
    name: path.basename(path.dirname(file)),
    run(state, action) {
      ctx._lpFeedback = Object.assign({
        generationId: 'gen_test', regenCount: 0, chipCount: 0, chipsUsed: [],
        hasCopied: false, copiedAfterChip: false, copiedAfterRegen: false,
        explicitRating: null, meta: {}
      }, state);
      vm.runInContext('sent = [];', ctx);
      if (action === 'copy')  vm.runInContext('_lpFeedbackSend("copy_sms");', ctx);
      if (action === 'thumb') vm.runInContext('_lpFeedbackSend("explicit_thumb");', ctx);
      if (action === 'flush') vm.runInContext('_lpFeedbackFlush("superseded");', ctx);
      if (action === 'copy_then_flush') {
        vm.runInContext('_lpFeedbackSend("copy_sms");', ctx);
        vm.runInContext('_lpFeedbackFlush("superseded");', ctx);
      }
      if (action === 'thumb_then_flush') {
        vm.runInContext('_lpFeedbackSend("explicit_thumb");', ctx);
        vm.runInContext('_lpFeedbackFlush("superseded");', ctx);
      }
      return vm.runInContext('JSON.parse(JSON.stringify(sent))', ctx);
    }
  };
}

const impls = BUILDS.map(build);
let pass = 0, fail = 0;

function check(name, state, action, expect) {
  const results = impls.map(i => { try { return JSON.stringify(i.run(state, action)); } catch (e) { return 'THREW: ' + e.message; } });
  const agree = results.every(r => r === results[0]);
  const ok = agree && results[0] === JSON.stringify(expect);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; console.log('  FAIL ' + name);
    if (!agree) impls.forEach((i, n) => console.log('        ' + i.name + ' -> ' + results[n]));
    else console.log('        expected ' + JSON.stringify(expect) + '\n        got      ' + results[0]);
  }
}

console.log('\nv9.7.540 — feedback flush');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

console.log('previously UNREACHABLE rejection signals must now land:');
check('regenerated, then abandoned', { regenCount: 1 }, 'flush',
  [{ rating: 'down', signal: 'implicit_regen_no_copy', trigger: 'superseded' }]);
check('chipped, then abandoned', { chipCount: 1, chipsUsed: ['shorter'] }, 'flush',
  [{ rating: 'down', signal: 'implicit_chip_no_copy', trigger: 'superseded' }]);
check('regenned AND chipped, then abandoned', { regenCount: 1, chipCount: 2 }, 'flush',
  [{ rating: 'down', signal: 'implicit_regen_no_copy', trigger: 'superseded' }]);
check('generated, never touched (the denominator)', {}, 'flush',
  [{ rating: 'abandoned', signal: 'no_interaction', trigger: 'superseded' }]);

console.log('\nmust NOT double-report a session already sent:');
check('copied, then superseded', { hasCopied: true }, 'copy_then_flush',
  [{ rating: 'up', signal: 'implicit_copy', trigger: 'copy_sms' }]);
check('thumbed down, then superseded', { explicitRating: 'down' }, 'thumb_then_flush',
  [{ rating: 'down', signal: 'explicit', trigger: 'explicit_thumb' }]);
check('thumbed up, then superseded', { explicitRating: 'up' }, 'thumb_then_flush',
  [{ rating: 'up', signal: 'explicit', trigger: 'explicit_thumb' }]);

console.log('\nexisting positive paths unchanged:');
check('copied as-is', { hasCopied: true }, 'copy',
  [{ rating: 'up', signal: 'implicit_copy', trigger: 'copy_sms' }]);
check('chip helped, then copied', { hasCopied: true, chipCount: 1, copiedAfterChip: true }, 'copy',
  [{ rating: 'weak_up', signal: 'implicit_chip_copy', trigger: 'copy_sms' }]);
check('regen helped, then copied', { hasCopied: true, regenCount: 1, copiedAfterRegen: true }, 'copy',
  [{ rating: 'neutral', signal: 'implicit_regen_copy', trigger: 'copy_sms' }]);

console.log('\nflush must be inert when there is nothing to report:');
check('module init — no generation yet', { generationId: null }, 'flush', []);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
