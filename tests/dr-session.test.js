#!/usr/bin/env node
'use strict';
// (v9.7.621) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('dr-session.test.js');

/**
 * dr-session.test.js — v9.7.649. THE CUSTOMER FILLED OUT A CREDIT APPLICATION AND NOBODY SAW IT.
 *
 * REPORTED 9/10. Patricia Galvan regenerated lead 2080959688 seven times between 8:49 and 8:52 AM
 * and sent none of them; asked what was wrong she said Lead Pro gave "too short" a response. Gil's
 * read: the store's AI had already reached out, and the draft never addressed the credit app the
 * customer completed through Click & Go — something the AI does not cover, because it only pushes
 * the appointment. That read was right in every particular, and three separate things had to fail.
 *
 * (1) THE DR NOTE WAS NEVER RECOGNISED. The twelve vr* fields are read only from a lead-received
 * note whose CONTENT matched /gubagoo|virtual retail/. Brennan Mitchell's note reads, in full,
 * "By: System Dynamic Credit App Visitor: No Chats: 0 Previous ..." — the vendor word lives in the
 * SOURCE FIELD, not in the note. The enumeration trap: a list of the shapes seen so far.
 *
 * (2) NOTHING LOGGED THE MISS. Twelve fields, six opening variants and a deal block, with no
 * diagnostic anywhere, so a miss left no trace at all.
 *
 * (3) AND THE ONE THAT MATTERS MOST: "what did they do online" and "have we reached out" were on
 * ONE SWITCH. `clickGoHasOutreach ? follow-up : vrCreditApp ? HIGH-INTENT : first-contact`. The
 * store's AI answers a Click & Go lead within minutes — Brennan had SIX outreaches on a lead
 * thirteen hours old — so the credit-app arm was dead in production, not rare. The arm production
 * does take carried two rules where its siblings carry six and eight, and one of the ones it
 * lacked is the SMS quality bar. The agent's "too short" is that missing line.
 *
 * This suite EXECUTES the shipped recognition test, the shipped step-block builder and the shipped
 * follow-up rules arm, against Brennan's real note text and Bonnie June's real 9/9 deal fields.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: dr-session.test.js <popup.js> [popup.js...]'); process.exit(2); }

const bail = (m) => require('./lib/fatal-guard.js').bail('dr-session.test.js', m);

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const grab = (startMark, endMark, label) => {
    const a = src.indexOf(startMark);
    if (a < 0) bail(label + ' start not found in ' + file);
    const b = src.indexOf(endMark, a);
    if (b < 0) bail(label + ' end not found in ' + file);
    return src.slice(a, b + endMark.length);
  };
  return {
    name: path.basename(path.dirname(file)),
    src,
    // the DR-note recognition expression, verbatim
    isDrNote: grab('var _isDrNote = /gubagoo|virtual retail/i.test(c)', '/verified credit score/i.test(c);', 'recognition'),
    // the step list and the block built from it
    steps: grab('var drSteps = [];', "      : '';", 'step block'),
    // the follow-up arm of scenarioRules
    followUp: grab("['- Follow-up: read the transcript and continue naturally", ".join('\\n')", 'follow-up arm'),
  };
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

// ── runners over the SHIPPED spans ──────────────────────────────────────────
function recognises(impl, noteContent, code) {
  const sb = { c: noteContent, __out: null };
  vm.createContext(sb);
  vm.runInContext((code || impl.isDrNote) + '\n__out = _isDrNote;', sb);
  return sb.__out;
}
function stepsFor(impl, data, code) {
  const sb = { data: data, __steps: null, __block: null };
  vm.createContext(sb);
  vm.runInContext((code || impl.steps) + '\n__steps = drSteps; __block = drSessionBlock;', sb);
  return { steps: sb.__steps, block: sb.__block };
}
function followUpRules(impl, drSteps, vrProgress, code) {
  const sb = { drSteps: drSteps, vrProgress: vrProgress, __out: null };
  vm.createContext(sb);
  vm.runInContext('__out = ' + (code || impl.followUp) + ';', sb);
  return sb.__out;
}

// ── the real artefacts ──────────────────────────────────────────────────────
// Brennan Mitchell, Community Honda Lafayette, lead 2080959688, 9/9 — the whole note.
const BRENNAN_NOTE = 'By: System Dynamic Credit App Visitor: No Chats: 0 Previous Visits: 0';
// Bonnie June, Community Honda Baytown, 9/9 — the fields her prompt actually carried.
const BONNIE = { vrCreditApp: false, vrPaymentSelected: true, vrTradeIn: true, vrCompleted: false,
                 vrDroppedOff: true, vrDroppedOffPage: 'Financing', noVehicleAtAll: false };
const BRENNAN = { vrCreditApp: true, vrPaymentSelected: false, vrTradeIn: false, vrCompleted: false,
                  vrDroppedOff: false, vrDroppedOffPage: '', noVehicleAtAll: true };

console.log('\nv9.7.649 — the DR session is a fact, not a branch of the outreach question');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);

console.log('\n(1) the note is recognised by what it carries:');

check('Brennan\'s real note is recognised — the reported miss',
  i => recognises(i, BRENNAN_NOTE), true);

check('the old vendor-word notes still are', i => recognises(i,
  'By: System Lead received Gubagoo Virtual Retailing Payment: $469.35/month'), true);

check('a completed VR deal is recognised without the vendor word',
  i => recognises(i, 'By: System Customer completed VR deal Term: 60 mo'), true);

check('so is a drop-off', i => recognises(i, 'By: System Dropped off on Financing page'), true);

check('so is a verified credit score', i => recognises(i, 'By: System Verified Credit Score: 712'), true);

// The over-reach direction. A third-party lead note can carry "Payment:" or "Trade-In Vehicle:"
// without being a DR session at all, and a false DR note is worse than a missed one — it would
// tell a customer they did something they never did.
console.log('\n...and NOT by a field name any lead note might carry:');

check('a plain payment line does not make a note a DR session',
  i => recognises(i, 'By: System CUSTOMER INSIGHTS- Payment: $400/month Preferred Contact: Text'), false);

check('neither does a trade-in line',
  i => recognises(i, 'By: System Trade-In Vehicle: 2013 Volkswagen Beetle'), false);

check('nor an empty lead-received note',
  i => recognises(i, 'By: System Lead received with no comments.'), false);

console.log('\n(2) the steps become facts, on their own footing:');

check('Brennan: the credit application is named',
  i => stepsFor(i, BRENNAN).steps, ['SUBMITTED A CREDIT APPLICATION']);

check('...and the block says a submitted application is the strongest signal',
  i => /STRONGEST SIGNAL ON THIS LEAD/.test(stepsFor(i, BRENNAN).block), true);

check('...and forbids the numbers behind it in the same breath',
  i => /do not quote a rate, a payment or a credit tier/i.test(stepsFor(i, BRENNAN).block), true);

check('...and tells the model not to ask him to start what he already started',
  i => /already started/i.test(stepsFor(i, BRENNAN).block), true);

check('Bonnie: every step she took is listed, in order',
  i => stepsFor(i, BONNIE).steps,
  ['built a payment', 'entered a trade-in', 'stopped on the Financing page']);

check('...and her block carries no credit-application language',
  i => /CREDIT APPLICATION/.test(stepsFor(i, BONNIE).block), false);

check('a session with nothing recorded emits nothing at all',
  i => stepsFor(i, { vrCreditApp: false, vrPaymentSelected: false, vrTradeIn: false,
                     vrCompleted: false, vrDroppedOff: false }).block, '');

check('a completed deal reads as completed end to end',
  i => stepsFor(i, { vrCompleted: true }).steps, ['completed their deal online end to end']);

check('a drop-off with no page still says they stopped',
  i => stepsFor(i, { vrDroppedOff: true, vrDroppedOffPage: '' }).steps, ['stopped before finishing']);

check('the steps are presented as recorded actions, never as the customer\'s words',
  i => /recorded by the tool/.test(stepsFor(i, BRENNAN).block), true);

console.log('\n(3) the follow-up arm carries the substance:');

const PROGRESS = 'With your application already in, we can match you to the right vehicle';

check('with steps recorded, the SMS quality bar reaches the arm production takes',
  i => /SMS quality bar is the same as email/.test(followUpRules(i, ['SUBMITTED A CREDIT APPLICATION'], PROGRESS)), true);

check('...and it is told to lead with what they already did',
  i => /LEAD WITH WHAT THEY ALREADY DID/.test(followUpRules(i, ['SUBMITTED A CREDIT APPLICATION'], PROGRESS)), true);

check('...and the progress angle is carried through verbatim',
  i => followUpRules(i, ['x'], PROGRESS).indexOf(PROGRESS) > 0, true);

check('...and the figures stay banned on this arm too',
  i => /Name the step, never the figures/.test(followUpRules(i, ['x'], PROGRESS)), true);

check('...and "do not re-introduce" is not read as "there is nothing to say"',
  i => /it does not mean there is nothing new to say/.test(followUpRules(i, ['x'], PROGRESS)), true);

// The no-regression direction: a Click & Go lead whose session recorded nothing must come out of
// this arm exactly as it did before the build.
check('with NO steps, the arm is the v9.7.648 pair and nothing more',
  i => followUpRules(i, [], PROGRESS),
  '- Follow-up: read the transcript and continue naturally from where things left off.\n'
  + '- Never say Gubagoo, virtual retailing platform, digital retailing, or "dynamic credit app".');

check('the vendor name stays forbidden in every case',
  i => /Never say Gubagoo/.test(followUpRules(i, ['x'], PROGRESS)), true);

console.log('\n(4) source shape — the ordering and the wiring:');
const strip = s => s.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

check('the no-vehicle credit-app progress line is reachable — it now precedes the bare one',
  i => strip(i.src).indexOf('data.noVehicleAtAll && data.vrCreditApp') <
       strip(i.src).indexOf("else if (data.vrCreditApp) vrProgress"), true);

check('the step block is emitted on BOTH arms, not inside the ternary',
  i => strip(i.src).indexOf('var drSessionBlock') <
       strip(i.src).indexOf('var clickGoHasOutreach'), true);

check('the directive carries the step block',
  i => /scenarioDirective = \(clickGoHasOutreach[\s\S]{0,900}?drSessionBlock/.test(strip(i.src)), true);

// Comment-stripped, and this is not fussiness: the build header quotes the removed line verbatim
// while explaining why it was removed, so an unstripped scan matches this file's own prose. Same
// hazard v9.7.630 recorded — a source-position assertion has to read code, not commentary.
check('the deal-figure block no longer tells the model to ignore credit',
  i => /reference APR\/credit unless customer brought it up/.test(strip(i.src)), false);

check('...but never quoting a figure is stated harder than before',
  i => /NEVER quote, repeat or hint at any number below/.test(strip(i.src)), true);

check('the detector logs on every grab',
  i => /\[LP DR SESSION DIAG\] note:/.test(strip(i.src)), true);

check('the diagnostic reports figure PRESENCE, never a figure',
  i => /figures present — payment:' \+ \(!!vrMonthlyPayment\)/.test(strip(i.src)), true);

check('Click & Go is labelled in feedback so the branch is measurable',
  i => /if \(sc\.isClickAndGo\)\s+s\.push\('clickAndGo'\);/.test(strip(i.src)), true);

check('the intake refusal is untouched — machine text is still not the customer\'s words',
  i => /REFUSED ' \+ _lir\.length \+ ' chars — reads as machine-generated/.test(i.src), true);

// ── NON-VACUITY ─────────────────────────────────────────────────────────────
// Each neuter restores one part of the pre-v9.7.649 behaviour in the CURRENT build.
console.log('\nnon-vacuity (restoring each defect):');

const OLD_RECOGNITION = c => c.replace(
  /var _isDrNote = [\s\S]*?\/verified credit score\/i\.test\(c\);/,
  'var _isDrNote = /gubagoo|virtual retail/i.test(c);');
const OLD_FOLLOWUP = c => c.replace(/\.concat\(drSteps\.length \? \[[\s\S]*?\] : \[\]\)/, '');

check('neuter A actually changed the recognition span',
  i => OLD_RECOGNITION(i.isDrNote) !== i.isDrNote, true);

check('A: with the vendor-word gate, Brennan\'s note is not a DR note — the reported bug',
  i => recognises(i, BRENNAN_NOTE, OLD_RECOGNITION(i.isDrNote)), false);

check('A (control): the shipped test recognises it',
  i => recognises(i, BRENNAN_NOTE), true);

check('neuter B actually changed the follow-up arm',
  i => OLD_FOLLOWUP(i.followUp) !== i.followUp, true);

check('B: without the substance rules the arm loses the SMS quality bar — the "too short" report',
  i => /SMS quality bar/.test(followUpRules(i, ['SUBMITTED A CREDIT APPLICATION'], PROGRESS, OLD_FOLLOWUP(i.followUp))), false);

check('B (control): the shipped arm carries it',
  i => /SMS quality bar/.test(followUpRules(i, ['SUBMITTED A CREDIT APPLICATION'], PROGRESS)), true);

check('A+B: the 9/10 lead reproduced — no DR note, and a two-rule follow-up arm',
  i => [recognises(i, BRENNAN_NOTE, OLD_RECOGNITION(i.isDrNote)),
        followUpRules(i, [], PROGRESS, OLD_FOLLOWUP(i.followUp)).split('\n').length],
  [false, 2]);

check('A+B (control): the shipped pair recognises the note and carries six rules',
  i => [recognises(i, BRENNAN_NOTE),
        followUpRules(i, stepsFor(i, BRENNAN).steps, PROGRESS).split('\n').length],
  [true, 6]);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
