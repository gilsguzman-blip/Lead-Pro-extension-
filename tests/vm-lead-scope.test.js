#!/usr/bin/env node
'use strict';
// (v9.7.604) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('vm-lead-scope.test.js');

/**
 * vm-lead-scope.test.js — v9.7.604 / v9.7.648. ONE CUSTOMER'S VOICEMAIL UNDER ANOTHER'S NAME.
 *
 * (v9.7.648) IT RECURRED ON 9/9, AND THE HELPER WAS NOT THE PART THAT WAS WRONG. Lead 2080819975,
 * Community Honda Baytown, a Click & Go lead submitted that same day, carried a `final` voicemail
 * saying "I'm going to stop reaching out about the Hybrid options." The lead is a Civic Hatchback
 * Sport, not a hybrid, and that lead's own prompt forbids the phrase "I will stop reaching out"
 * outright — its close-out gate needs 21 days and 5 outreaches and the lead was 0 days old. So the
 * voicemail could not have come from this lead, and a regrab confirmed it: pressing VM on the same
 * lead produced a correct, on-lead script.
 *
 * THE QUESTION WAS WRONG, NOT THE ANSWER. _lpFeedbackCaptureMeta stamps the row's autoLeadId at
 * GENERATION time. _lpFeedbackFlush runs later, and clearFields() — which runs on every grab and
 * on the Clear button — sets lastScrapedData to null and blanks output-sms and output-email while
 * never touching output-vm. The flush was asking _lpVmForLead about lastScrapedData, so after a
 * grab it asked about the empty string, and the old guard `!stamp || (want && stamp !== want)`
 * short-circuits on an empty `want`: every stamped voicemail came back, whoever it belonged to.
 *
 * Both halves are fixed and both are asserted by execution below: the flush now asks about
 * meta.autoLeadId (the field whose job is to say which lead the row describes), and the helper
 * treats an unknown requested lead as unable to attribute rather than as permission.
 *
 * LIVE, 8/29. Four feedback captures carried a "final" voicemail belonging to a different lead,
 * and three of the four named the WRONG ROOFTOP:
 *
 *   lead 2075621339  Audi Lafayette, A4 Premium Plus, stock P7352
 *     → "Hi, this is Jolette with Community Honda Lafayette. I saw your Capital One
 *        pre-qualification come through ... what new Honda you're shopping for"
 *
 *   lead 2075587581  Community Honda Lafayette, 2021 Kia Rio LX
 *     → "this is Jolette with Community Toyota Baytown ... application through Click & Go
 *        ... what new Toyota you're shopping for"
 *
 *   lead 2075679374  Community Honda Lafayette, KBB trade on a 2010 GMC Sierra
 *     → "this is Jolette with Community Honda Baytown ... confirm your appointment Monday
 *        ... the higher trim with the sensors you wanted"
 *
 *   lead 2074243216  Community Toyota Baytown, Tacoma TRD Sport, 4.99% for 60 months
 *     → a 2026 4Runner script quoting 4.99% for 48 months
 *
 * CAUSE. output-vm was written in exactly two places — cleared at the top of generateVoicemail()
 * and filled at its end. Nothing else ever cleared it: not GRAB LEAD, not generateAll(). A
 * voicemail therefore survived every subsequent grab until another was generated.
 *
 * This was not confined to telemetry. output-vm is a visible textarea with a copy button, so the
 * previous customer's script sat on screen under the new customer's record, ready to send.
 *
 * FIX. The field carries the lead it was written for. A mismatch clears it on the next grab, and
 * both telemetry captures read it through _lpVmForLead so a missed path still cannot file one
 * lead's voicemail under another's id. Stamped rather than blind-cleared so that re-grabbing the
 * SAME lead — an ordinary thing to do — does not silently destroy the agent's voicemail.
 *
 * Drives the SHIPPED helper. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: vm-lead-scope.test.js <popup.js> [popup.js...]'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('function _lpVmLeadStamp(el) {');
  if (a < 0) throw new Error('_lpVmLeadStamp not found');
  const endMark = '  } catch (e) { return \'\'; }\n}';
  const b = src.indexOf(endMark, src.indexOf('function _lpVmForLead(leadId) {'));
  if (b < 0) throw new Error('_lpVmForLead end not found');
  return { name: path.basename(path.dirname(file)), src, code: src.slice(a, b + endMark.length) };
}

// A DOM stand-in carrying only what the helper touches.
function mkCtx(impl, fieldValue, stamp) {
  const el = { value: fieldValue, dataset: stamp === null ? undefined : { lpLeadId: stamp } };
  const warns = [];
  const sb = {
    String, document: { getElementById: id => (id === 'output-vm' ? el : null) },
    console: { warn: (...x) => warns.push(x.join(' ')), log() {} }
  };
  vm.createContext(sb);
  vm.runInContext(impl.code, sb);
  return { sb, warns, el };
}
const readFor = (impl, fieldValue, stamp, leadId) => {
  const c = mkCtx(impl, fieldValue, stamp);
  return { got: vm.runInContext('_lpVmForLead', c.sb)(leadId), warns: c.warns };
};

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
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const AUDI_VM = 'Hi, this is Jolette with Community Honda Lafayette. I saw your Capital One '
              + 'pre-qualification come through, and I would like to learn what new Honda you are shopping for.';

console.log('\nv9.7.604 — a voicemail belongs to the lead it was written for');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);
console.log('');

// ── THE FOUR REAL CAPTURES ──────────────────────────────────────────────────
console.log('the 8/29 captures — a foreign voicemail is never returned as this lead\'s draft:');

check('the Audi A4 lead does not get the Cap One Honda script',
  i => readFor(i, AUDI_VM, '2075630449', '2075621339').got, '');

check('...and the mismatch is reported with BOTH lead ids, not silently dropped',
  i => { const w = readFor(i, AUDI_VM, '2075630449', '2075621339').warns.join(' ');
         return /LP VM SCOPE/.test(w) && w.indexOf('2075630449') > 0 && w.indexOf('2075621339') > 0; }, true);

check('the Kia Rio lead does not get the Toyota Click & Go script',
  i => readFor(i, 'this is Jolette with Community Toyota Baytown ... Click & Go',
       '2075504933', '2075587581').got, '');

check('the Tacoma lead does not get the 4Runner script',
  i => readFor(i, 'your 2026 4Runner question is about the 4.99% APR for 48 months',
       '9999999999', '2074243216').got, '');

// ── THE FIELD IS STILL USABLE FOR ITS OWN LEAD ──────────────────────────────
// The risk of this change is over-suppression: an agent losing a voicemail they just made.
console.log('\nthe agent keeps the voicemail they actually generated:');

check('a matching stamp returns the voicemail unchanged',
  i => readFor(i, 'Hi Dean, this is Jolette with Community Honda Lafayette.',
       '2075679374', '2075679374').got, 'Hi Dean, this is Jolette with Community Honda Lafayette.');

check('...and says nothing in the log when it matches',
  i => readFor(i, 'Hi Dean, this is Jolette.', '2075679374', '2075679374').warns.length, 0);

check('re-grabbing the SAME lead does not lose it — this is why it is stamped, not blind-cleared',
  i => readFor(i, 'a voicemail for this very lead', '2043865698', '2043865698').got,
  'a voicemail for this very lead');

// ── EDGES ───────────────────────────────────────────────────────────────────
console.log('\nthe absent and unknown cases:');

check('an unstamped field is treated as foreign, not assumed to match',
  i => readFor(i, AUDI_VM, '', '2075621339').got, '');

check('a field with no dataset at all cannot throw',
  i => readFor(i, AUDI_VM, null, '2075621339').got, '');

check('an empty field returns empty and logs nothing',
  i => { const r = readFor(i, '   ', '2075621339', '2075621339'); return [r.got, r.warns.length]; }, ['', 0]);

// (v9.7.648) THIS ASSERTION USED TO EXPECT THE OPPOSITE, and the reversal is deliberate rather
// than a flipped expectation. v9.7.604 asserted "a stamped voicemail with an UNKNOWN active lead
// is still returned, not destroyed", reasoning that over-suppression would cost an agent the
// voicemail they just made. That reasoning belongs to a reader that CLEARS THE PANEL —
// populateFromData, which does its own inline stamp check and is untouched. _lpVmForLead is used
// only by the two TELEMETRY captures, where the cost of refusing is one empty field and the cost
// of allowing is one lead's script filed under another lead's id. Recording requires attribution.
check('an UNKNOWN requested lead cannot attribute, so nothing is recorded',
  i => readFor(i, 'stamped draft', '2075621339', '').got, '');

check('...and the warning says the requested lead is unknown, naming the stamp it did have',
  i => { const w = readFor(i, 'stamped draft', '2075621339', '').warns.join(' ');
         return /LP VM SCOPE/.test(w) && /\(unknown\)/.test(w) && w.indexOf('2075621339') > 0; }, true);

check('a null requested lead is refused the same way',
  i => readFor(i, 'stamped draft', '2075621339', null).got, '');

// The panel-clearing path is a DIFFERENT reader and keeps the conservative rule. Asserted so a
// later build cannot "unify" the two and start destroying an agent's work on an unknown lead.
check('populateFromData still clears only on a MISMATCH, not on an unknown lead',
  i => /if \(!_vmStamp \|\| \(_vmNow && _vmStamp !== _vmNow\)\)/.test(strip(i.src)), true);

// ── THE WIRING, NOT JUST THE HELPER ─────────────────────────────────────────
// v9.7.561's lesson: a function can be exhaustively correct and never be handed anything.
console.log('\nthe helper is actually wired into all three sites:');

check('generateVoicemail stamps the field when it writes one',
  i => /vmField\.dataset\.lpLeadId = String\(\(lastScrapedData && lastScrapedData\.autoLeadId\)/.test(strip(i.src)), true);

check('populateFromData clears a foreign voicemail on grab',
  i => /clearing a voicemail written for lead/.test(strip(i.src)), true);

check('the feedback FINAL capture reads through _lpVmForLead',
  i => /voicemail:_lpScrubPII\(_lpVmForLead\(/.test(strip(i.src)), true);

check('the PRIOR draft capture reads through it too',
  i => /voicemail: _lpVmForLead\(/.test(strip(i.src)), true);

check('no capture site reads output-vm raw any more',
  i => (strip(i.src).match(/_g\('output-vm'\)/g) || []).length, 0);

// ── (v9.7.648) WHICH LEAD THE FLUSH ASKS ABOUT ──────────────────────────────
// The helper was always correct about a MISMATCH. What was wrong is the question it was handed.
// _lpFeedbackCaptureMeta stamps meta.autoLeadId at generation time; _lpFeedbackFlush runs later,
// and clearFields() nulls lastScrapedData in between on every grab. These execute the shipped
// _vmWant expression against the exact state clearFields leaves behind.
function liftWant(impl, mutate) {
  const m = strip(impl.src).match(/var _vmWant = [\s\S]*?;\n/);
  if (!m) throw new Error('_vmWant expression not found');
  return mutate ? mutate(m[0]) : m[0];
}
function wantFor(impl, meta, lastScraped, mutate) {
  const sb = { _lpFeedback: { meta: meta }, lastScrapedData: lastScraped, __out: null };
  vm.createContext(sb);
  vm.runInContext(liftWant(impl, mutate) + '__out = _vmWant;', sb);
  return sb.__out;
}
const META = { autoLeadId: '2080819975' };

console.log('\nthe flush asks about the row\'s own lead, not the panel\'s:');

check('a CLEARED panel still names the row\'s lead — the 9/9 state exactly',
  i => wantFor(i, META, null), '2080819975');

check('a panel that moved to another lead does not override the row',
  i => wantFor(i, META, { autoLeadId: '2080711265' }), '2080819975');

check('with no meta at all it falls back to the panel',
  i => wantFor(i, {}, { autoLeadId: '2080711265' }), '2080711265');

check('with neither, it asks about nothing — which the helper now refuses',
  i => wantFor(i, {}, null), '');

// End to end: the real question handed to the real helper, on a cleared panel holding a foreign
// voicemail. This is the 9/9 row, and it must come back empty.
console.log('\nend to end — the 9/9 row cannot pick up a foreign voicemail:');
const HYBRID_VM = 'Samantha Gonzalez at Community Honda Baytown. I know you’ve needed some room, '
                + 'so I’m going to stop reaching out about the Hybrid options.';

check('cleared panel + foreign stamped voicemail records nothing',
  i => readFor(i, HYBRID_VM, '2069979169', wantFor(i, META, null)).got, '');

check('...and the same panel on the lead it BELONGS to still records it',
  i => readFor(i, HYBRID_VM, '2069979169', wantFor(i, { autoLeadId: '2069979169' }, null)).got, HYBRID_VM);

// ── NON-VACUITY ─────────────────────────────────────────────────────────────
// Each neuter restores one half of the v9.7.648 fix in the CURRENT build and must cost real
// assertions. Together they reproduce v9.7.647 exactly.
console.log('\nnon-vacuity (restoring each half of the fix):');
const OLD_GUARD_FORM = c => c.replace('!stamp || !want || stamp !== want', '!stamp || (want && stamp !== want)');
const OLD_WANT_FORM  = w => 'var _vmWant = (lastScrapedData && lastScrapedData.autoLeadId) || \'\';\n';

function readWith(impl, code, fieldValue, stamp, leadId) {
  const el = { value: fieldValue, dataset: { lpLeadId: stamp } };
  const warns = [];
  const sb = { String, document: { getElementById: id => (id === 'output-vm' ? el : null) },
               console: { warn: (...x) => warns.push(x.join(' ')), log() {} } };
  vm.createContext(sb);
  vm.runInContext(code, sb);
  return vm.runInContext('_lpVmForLead', sb)(leadId);
}

check('A: the old guard alone lets a foreign voicemail through on an unknown lead',
  i => readWith(i, OLD_GUARD_FORM(i.code), HYBRID_VM, '2069979169', ''), HYBRID_VM);

check('A (control): the shipped guard refuses the same input',
  i => readWith(i, i.code, HYBRID_VM, '2069979169', ''), '');

check('B: the old call site asks about nothing once the panel is cleared',
  i => wantFor(i, META, null, OLD_WANT_FORM), '');

check('B (control): the shipped call site still names the row\'s lead',
  i => wantFor(i, META, null), '2080819975');

check('A+B together reproduce the 9/9 defect — the foreign voicemail is filed as this row\'s draft',
  i => readWith(i, OLD_GUARD_FORM(i.code), HYBRID_VM, '2069979169', wantFor(i, META, null, OLD_WANT_FORM)),
  HYBRID_VM);

check('A+B (control): the shipped pair records nothing instead',
  i => readWith(i, i.code, HYBRID_VM, '2069979169', wantFor(i, META, null)), '');

// The neuters must be real edits, not no-ops that pass by accident.
check('neuter A actually changed the shipped guard', i => OLD_GUARD_FORM(i.code) !== i.code, true);
check('neuter B actually changed the shipped call site', i => OLD_WANT_FORM() !== liftWant(i), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
