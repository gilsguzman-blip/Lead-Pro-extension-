#!/usr/bin/env node
'use strict';
// (v9.7.611) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('regen-guard.test.js');

/**
 * regen-guard.test.js — proxy v7.75. THE REPAIR THAT MADE IT WORSE.
 *
 * LIVE, 9/11, request 7e0d2e6b. Roy Ballard, Audi Lafayette, agent Jordyn Guzman. Gil: "Very short
 * response for this agent." The worker trace:
 *
 *   PRIMARY OK  gpt-5.6-luna 4641ms finish=STOP
 *   CLASSIFY    sms=NO email=YES phoneOnFile=true
 *   REGEN       triggered (email flagged)
 *   REGEN OK    gpt-5.6-luna 4526ms
 *   FINAL       regenerated=true flagged=true classifyFailed=false
 *
 * The email asked for a phone number already on file. The regen prompt says to remove ONLY that and
 * keep every other field and sentence identical. The model gutted both fields, and the worker took
 * it, because the only condition on the swap was regenResult.ok.
 *
 * CLASSIFY reads sms=NO, so the text draft was NOT degenerate at primary. It was degenerate after.
 * That is the proof the regen caused it rather than the model returning a short draft.
 *
 * Executes the SHIPPED regenGuard. The final drafts below are verbatim from the extension's
 * [LP RAW DIAG] lines on that generation; the primaries are reconstructed at ordinary length,
 * because the worker logs character counts and never the text (the v9.7.489 posture).
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const FILES = process.argv.slice(2).filter(a => /\.js$/.test(a));
if (!FILES.length) { console.error('usage: regen-guard.test.js <cloudflare-worker.js>'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('const REGEN_MIN_CHARS');
  if (a < 0) throw new Error('regenGuard constants not found');
  const endMark = '\n  return { ok: true, why: \'\' };\n}';
  const b = src.indexOf(endMark, a);
  if (b < 0) throw new Error('regenGuard end not found');
  // safeJsonParse sits just above and the guard calls it, so it travels too.
  const pa = src.indexOf('function safeJsonParse(text) {');
  const pb = src.indexOf('\n}\n', pa);
  return {
    name: path.basename(file), src,
    code: src.slice(pa, pb + 2) + '\n' + src.slice(a, b + endMark.length),
  };
}

function guard(impl, primary, regen, flags) {
  const sb = { JSON, Math, __out: null };
  vm.createContext(sb);
  vm.runInContext(impl.code, sb);
  sb.__p = primary; sb.__r = regen; sb.__f = flags || {};
  vm.runInContext('__out = regenGuard(__p, __r, __f);', sb);
  return sb.__out;
}
const verdict = (impl, p, r, f) => guard(impl, p, r, f).ok;
const why     = (impl, p, r, f) => guard(impl, p, r, f).why;

const guardedImpls = require('./lib/guarded-impls.js');
const impls = guardedImpls(FILES, extract);
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

// ── THE 9/11 SHAPES ─────────────────────────────────────────────────────────
const SIG_SMS   = '\nJordyn\nAudi Lafayette\n337-901-8079';
const SIG_EMAIL = '\n\nJordyn Guzman\nAudi Concierge\nAudi Lafayette\n337-901-8079';

// Verbatim from [LP RAW DIAG] on request 7e0d2e6b.
const GUTTED_SMS   = 'Roy,' + SIG_SMS;
const GUTTED_EMAIL = 'Hi Roy,\n\nWe have the 2023 Ram 1500 Lone Star here.' + SIG_EMAIL;

// An ordinary draft of the kind the primary was: the classifier read sms=NO on it, so the text
// was intact, and the email carried the phone ask the regen was asked to remove.
const GOOD_SMS   = 'Roy, the 2023 Ram 1500 Lone Star is still here and I can have it ready whenever you want to see it. No rush on my end.' + SIG_SMS;
const GOOD_EMAIL = 'Hi Roy,\n\nThe 2023 Ram 1500 Lone Star you asked about is still on the ground and I can have everything staged before you arrive so nothing is waiting on paperwork.\n\nIf it helps I can put together the numbers ahead of time. What is the best number to reach you on?' + SIG_EMAIL;
const GOOD_VM    = 'Roy, this is Jordyn at Audi Lafayette about the 2023 Ram 1500 Lone Star. It is still here and I wanted you to know. Give me a call back at 337-901-8079. That is 337-901-8079.';

// The repair the regen was SUPPOSED to return: one sentence gone, everything else intact.
const REPAIRED_EMAIL = GOOD_EMAIL.replace(' What is the best number to reach you on?', '');

const J = o => JSON.stringify(o);
const PRIMARY  = J({ sms: GOOD_SMS,   email: GOOD_EMAIL,    voicemail: GOOD_VM, subject: 'The Ram 1500 Lone Star is still here' });
const INCIDENT = J({ sms: GUTTED_SMS, email: GUTTED_EMAIL,  voicemail: GOOD_VM, subject: '2023 Ram 1500 Lone Star' });
const REPAIRED = J({ sms: GOOD_SMS,   email: REPAIRED_EMAIL, voicemail: GOOD_VM, subject: 'The Ram 1500 Lone Star is still here' });
const EMAIL_FLAGGED = { sms: false, email: true };

console.log('\nproxy v7.75 — a regen cannot replace a good draft with a worse one');
console.log('file under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);

// ── (1) THE INCIDENT ────────────────────────────────────────────────────────
console.log('\n(1) request 7e0d2e6b, 9/11:');

check('the regen that shipped is rejected', i => verdict(i, PRIMARY, INCIDENT, EMAIL_FLAGGED), false);

// The SMS was NOT flagged, so it should have come back identical. It is the stronger signal and
// the guard should name it first.
check('...and the reason names the SMS, the field that was never flagged',
  i => /^sms /.test(why(i, PRIMARY, INCIDENT, EMAIL_FLAGGED)), true);

check('the gutted SMS alone is enough, with the email left correct',
  i => verdict(i, PRIMARY, J({ sms: GUTTED_SMS, email: REPAIRED_EMAIL, voicemail: GOOD_VM, subject: 'x' }), EMAIL_FLAGGED), false);

check('the gutted EMAIL alone is enough, with the SMS left correct',
  i => verdict(i, PRIMARY, J({ sms: GOOD_SMS, email: GUTTED_EMAIL, voicemail: GOOD_VM, subject: 'x' }), EMAIL_FLAGGED), false);

// The SMS is 39 characters, so the absolute FLOOR fires before the ratio does — which is the
// right order and the more legible message. The ratio wording is asserted in section 3, where a
// field is long enough to reach it.
check('the reason states the measurement rather than a verdict word',
  i => why(i, PRIMARY, INCIDENT, EMAIL_FLAGGED), 'sms collapsed to 39 chars (floor 60)');

// ── (2) THE REPAIR IT MUST KEEP ACCEPTING ───────────────────────────────────
// Rejecting a good regen means shipping the phone ask, so the false-positive direction matters.
console.log('\n(2) the repair the regen exists to produce:');

check('one sentence removed from the flagged field is accepted',
  i => verdict(i, PRIMARY, REPAIRED, EMAIL_FLAGGED), true);

check('...with no reason recorded', i => why(i, PRIMARY, REPAIRED, EMAIL_FLAGGED), '');

check('an identical regen is accepted', i => verdict(i, PRIMARY, PRIMARY, EMAIL_FLAGGED), true);

check('a regen that only reflows whitespace is accepted',
  i => verdict(i, PRIMARY, J({ sms: GOOD_SMS + '\n', email: GOOD_EMAIL, voicemail: GOOD_VM, subject: 'x' }), EMAIL_FLAGGED), true);

check('a flagged field losing a third is accepted — that is a long phone sentence',
  i => verdict(i, J({ sms: 'x'.repeat(300) }), J({ sms: 'x'.repeat(200) }), { sms: true }), true);

check('a slightly LONGER regen is accepted — rewording is not a defect',
  i => verdict(i, PRIMARY, J({ sms: GOOD_SMS + ' Happy to help.', email: REPAIRED_EMAIL, voicemail: GOOD_VM, subject: 'x' }), EMAIL_FLAGGED), true);

// ── (3) THE TOLERANCES ARE ASYMMETRIC ON PURPOSE ────────────────────────────
// A flagged field is expected to lose a sentence. An unflagged one was told to come back identical.
console.log('\n(3) flagged and unflagged are held to different bars:');

const half = { before: 'y'.repeat(300), after: 'y'.repeat(150) };   // exactly 50%
check('a 50% loss on a FLAGGED field passes',
  i => verdict(i, J({ email: half.before }), J({ email: half.after }), { email: true }), true);
check('the same loss on an UNFLAGGED field is rejected',
  i => verdict(i, J({ email: half.before }), J({ email: half.after }), { email: false }), false);
check('...and the reason says which bar was applied',
  i => /unflagged floor 60%/.test(why(i, J({ email: half.before }), J({ email: half.after }), { email: false })), true);

check('an absent flags object is treated as unflagged, which is the safer bar',
  i => verdict(i, J({ email: half.before }), J({ email: half.after }), null), false);

check('voicemail is never flagged and so always gets the stricter bar',
  i => verdict(i, J({ voicemail: half.before }), J({ voicemail: half.after }), { sms: true, email: true }), false);

// ── (4) THE ABSOLUTE FLOOR ──────────────────────────────────────────────────
// The name-and-signature shape is short whatever the primary was, so the ratio alone is not enough.
console.log('\n(4) the floor catches a collapse the ratio could miss:');

check('a short primary gutted to a greeting is still caught',
  i => verdict(i, J({ sms: 'z'.repeat(70) }), J({ sms: 'Roy,' }), { sms: true }), false);
check('...and the reason names the floor',
  i => /collapsed to 4 chars \(floor 60\)/.test(why(i, J({ sms: 'z'.repeat(70) }), J({ sms: 'Roy,' }), { sms: true })), true);

check('a field the classifier itself ignores (<=20 chars) is not length-checked',
  i => verdict(i, J({ sms: 'short', email: GOOD_EMAIL }), J({ sms: 'tiny', email: REPAIRED_EMAIL }), EMAIL_FLAGGED), true);

// ── (5) PRESENCE ────────────────────────────────────────────────────────────
console.log('\n(5) a field that carried something must still carry something:');

check('an emptied SMS is rejected',
  i => verdict(i, PRIMARY, J({ sms: '', email: REPAIRED_EMAIL, voicemail: GOOD_VM, subject: 'x' }), EMAIL_FLAGGED), false);
check('an emptied voicemail is rejected',
  i => verdict(i, PRIMARY, J({ sms: GOOD_SMS, email: REPAIRED_EMAIL, voicemail: '', subject: 'x' }), EMAIL_FLAGGED), false);
check('a dropped subject is rejected — it is checked for presence though not for length',
  i => verdict(i, PRIMARY, J({ sms: GOOD_SMS, email: REPAIRED_EMAIL, voicemail: GOOD_VM }), EMAIL_FLAGGED), false);
check('a whitespace-only field counts as empty',
  i => verdict(i, PRIMARY, J({ sms: '   \n  ', email: REPAIRED_EMAIL, voicemail: GOOD_VM, subject: 'x' }), EMAIL_FLAGGED), false);
check('a field the primary never had is not required',
  i => verdict(i, J({ sms: GOOD_SMS }), J({ sms: GOOD_SMS }), {}), true);

// ── (6) IT FAILS TOWARD THE PRIMARY ─────────────────────────────────────────
// Keeping the primary may ship the phone ask, which is a small defect where an empty draft is a
// total one. The one exception is a primary with no baseline to compare against.
console.log('\n(6) which way it fails when it cannot tell:');

check('an unparseable regen is rejected', i => verdict(i, PRIMARY, 'not json at all', EMAIL_FLAGGED), false);
check('...and says so', i => why(i, PRIMARY, 'not json at all', EMAIL_FLAGGED), 'regen did not parse as JSON');
check('an empty regen string is rejected', i => verdict(i, PRIMARY, '', EMAIL_FLAGGED), false);

check('an unparseable PRIMARY accepts the regen — there is no baseline, and a repair beats nothing',
  i => verdict(i, 'not json', INCIDENT, EMAIL_FLAGGED), true);
check('...and records why it could not judge',
  i => /no baseline to compare against/.test(why(i, 'not json', INCIDENT, EMAIL_FLAGGED)), true);

check('a non-string field on either side does not throw',
  i => verdict(i, J({ sms: 42, email: GOOD_EMAIL }), J({ sms: null, email: REPAIRED_EMAIL }), EMAIL_FLAGGED), true);
check('both sides empty objects', i => verdict(i, '{}', '{}', {}), true);

// ── (7) THE WIRING ──────────────────────────────────────────────────────────
// The guard is only worth anything if the acceptance point consults it, and only reportable if the
// log distinguishes a rejected regen from one that never ran.
console.log('\n(7) the acceptance point and the log:');

const code = i => i.src.split('\n').filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');

check('the swap is gated on the verdict, not on regenResult.ok alone',
  i => /if \(regenResult\.ok && !regenVerdict\.ok\)/.test(code(i)), true);

check('the rejection is logged with the reason',
  i => /REGEN REJECTED .* \$\{regenVerdict\.why\} \(keeping primary output\)/.test(code(i)), true);

check('FINAL distinguishes a rejected regen from one that never ran',
  i => /regenRejected=/.test(code(i)), true);

check('a rejected regen is excluded from the clean-generation cache gate',
  i => /!regenerated && !flagged && !classifyFailed && !regenRejected/.test(code(i)), true);

check('the guard is consulted with the per-field flags, not a bare boolean',
  i => /regenGuard\(result\.text, regenResult\.text, \{ sms: smsFlag, email: emailFlag \}\)/.test(code(i)), true);

// ── NON-VACUITY ─────────────────────────────────────────────────────────────
console.log('\nnon-vacuity (v7.75):');

const NO_RATIO = c => c.replace('if (after.length < before.length * floor) {', 'if (false) {');
check('neuter A actually removed the ratio test', i => NO_RATIO(i.code) !== i.code, true);
check('A: the incident is accepted again',
  i => verdict({ code: NO_RATIO(i.code) }, PRIMARY,
        J({ sms: GOOD_SMS, email: GUTTED_EMAIL, voicemail: GOOD_VM, subject: 'x' }), EMAIL_FLAGGED), true);
check('A (control): the shipped guard rejects it',
  i => verdict(i, PRIMARY, J({ sms: GOOD_SMS, email: GUTTED_EMAIL, voicemail: GOOD_VM, subject: 'x' }), EMAIL_FLAGGED), false);

const NO_FLOOR = c => c.replace('if (after.length < REGEN_MIN_CHARS) {', 'if (false) {');
check('neuter B actually removed the floor', i => NO_FLOOR(i.code) !== i.code, true);
check('B: a short primary gutted to a greeting slips through',
  i => verdict({ code: NO_FLOOR(i.code) }, J({ sms: 'z'.repeat(70) }), J({ sms: 'Roy,' + 'z'.repeat(25) }), { sms: true }), true);
check('B (control): the shipped guard catches it',
  i => verdict(i, J({ sms: 'z'.repeat(70) }), J({ sms: 'Roy,' + 'z'.repeat(25) }), { sms: true }), false);

const SAME_BAR = c => c.replace('const REGEN_KEEP_UNFLAGGED   = 0.60;', 'const REGEN_KEEP_UNFLAGGED   = 0.40;');
check('neuter C actually collapsed the two bars into one', i => SAME_BAR(i.code) !== i.code, true);
check('C: an unflagged field losing half is accepted, which is the asymmetry gone',
  i => verdict({ code: SAME_BAR(i.code) }, J({ email: half.before }), J({ email: half.after }), { email: false }), true);
check('C (control): the shipped bars keep it rejected',
  i => verdict(i, J({ email: half.before }), J({ email: half.after }), { email: false }), false);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
