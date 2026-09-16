#!/usr/bin/env node
'use strict';
// (v9.7.611) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('sms-hook-order.test.js');

/**
 * sms-hook-order.test.js — v9.7.668. THE TEXT HAS ONE OPENING AND ANOTHER BLOCK WAS TAKING IT.
 *
 * Gil, 9/16: "again the email hits, the text misses."
 *
 * The SMS format rule says: "Open on something THEY said or want, never on what YOU are going to
 * do — 'the one you said you loved' beats 'I can have it ready for you'."
 *
 * The DISTANCE BUYER block says: 'SMS: 1 sentence justifying the trip is MANDATORY. Example:
 * "I will have everything ready when you arrive."'
 *
 * Those are the same sentence. One block forbids it as an opener; the other hands it over as a
 * copyable worked example and calls it MANDATORY. The mandate is channel-scoped, worded as a
 * requirement, and sits inside a flag block — and it won, four times out of four:
 *
 *   log205  Aimee  "Aimee, I can have the Sportage ready for you today and have finance review
 *                   your application while we appraise your 2022 Seltos..."
 *   log204  Aimee  "The Glacial White Pearl 2026 Kia Sportage LX is here, and I can have it ready
 *                   while we appraise your 2022 Seltos..."
 *   log204  Aimee  "...is here, and I can have the interior ready for you to see today while..."
 *   log204  Allie  "Allie, I can review the $25,988 offer... I'll have the Crystal Black Pearl
 *                   HR-V Sport ready so you won't be waiting; would 1:00 PM or 2:30 PM..."
 *
 * distanceBlockRendered:true on all four, across two leads and two stores. Three of the four also
 * carry a semicolon or a "while" clause — the two constructions the rule's own read-back test
 * names — because the model is welding a mandatory sentence onto the hook sentence when it only
 * has room for one.
 *
 * WHY THE EMAIL KEEPS LANDING: an email can carry three things, so it satisfies the hook AND the
 * distance mandate AND the trade line. The SMS has one slot, and the only MANDATORY channel-scoped
 * directive competing for it was the distance one. So the hook is what got cut — which is exactly
 * what the format rule says must never happen.
 *
 * THE OWNERSHIP RULE (v9.7.631), twelfth instance. Whose job is it to decide what opens the text?
 * The SMS format rule. The distance block owns "make the trip worth their time" — a requirement
 * about CONTENT. It does not determine sentence order, it assumes it on the way to stating a
 * requirement. An assumption is not evidence, however forcefully worded, and it yields.
 *
 * Executes the SHIPPED distance block and the SHIPPED hook diagnostic. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: sms-hook-order.test.js <popup.js> [popup.js...]'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');

  // The distance block, lifted the same way distance-appt-gate.test.js lifts it, so the two
  // suites cannot certify different copies of one region.
  const a = src.indexOf('    var _dbApptOff = (function () {');
  if (a < 0) throw new Error('_dbApptOff gate not found');
  const endMark = "        '');";
  const b = src.indexOf(endMark, src.indexOf("'- Never make the distance buyer feel", a));
  if (b < 0) throw new Error('distance block end not found');

  const span = (mark, what) => {
    const a2 = src.indexOf(mark);
    if (a2 < 0) throw new Error(what + ' not found');
    const b2 = src.indexOf('\n}\n', a2);
    if (b2 < 0) throw new Error(what + ' end not found');
    return src.slice(a2, b2 + 2);
  };

  // The SMS format rule, as one source line.
  const smsRule = (src.match(/'SMS: A REAL TEXT MESSAGE[^\n]*'/) || [''])[0];

  // The observational hook row.
  const ha = src.indexOf('      // (v9.7.668) OBSERVATIONAL ONLY.');
  if (ha < 0) throw new Error('the hook diagnostic not found');
  const hEnd = src.indexOf('} catch (eHk) {}', ha);
  if (hEnd < 0) throw new Error('the hook diagnostic end not found');

  return {
    name: path.basename(path.dirname(file)), src,
    code: src.slice(a, b + endMark.length),
    holds: span('function _lpTouchHold(d) {', '_lpTouchHold')
      + '\n' + span('function _lpApptEngineOff(d) {', '_lpApptEngineOff'),
    smsRule: smsRule,
    hook: src.slice(ha, hEnd + '} catch (eHk) {}'.length)
  };
}

// Run the shipped distance block and collect the lines it pushes.
function build(impl, data, opts) {
  opts = opts || {};
  const sb = {
    String, parseFloat, JSON,
    data: data,
    lines: [],
    _inStateFar: opts.inStateFar === undefined ? true : !!opts.inStateFar,
    _dbSoldUnit: !!opts.soldUnit,
    distanceContext: opts.distanceContext || '',
    _hasCustomerReplied: opts.replied === undefined ? undefined : () => !!opts.replied,
    console: { log: () => {} }
  };
  vm.createContext(sb);
  vm.runInContext(impl.holds, sb);
  vm.runInContext((opts.mutate ? opts.mutate(impl.code) : impl.code), sb);
  return vm.runInContext('lines', sb).filter(Boolean).join('\n');
}

// Run the shipped hook row against a draft and read back what it reported.
function hook(impl, sms, firstName) {
  const logs = [];
  const sb = {
    String, RegExp,
    rawSms: sms,
    firstName: firstName === undefined ? '' : firstName,
    console: { log: (...x) => logs.push(x.join(' ')) }
  };
  vm.createContext(sb);
  vm.runInContext(impl.hook, sb);
  return logs.join(' ');
}
const reaches = out => (out.match(/reaches for: (US|THEM|neither)/) || [, 'NONE'])[1];

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

// ── THE FOUR REAL DRAFTS ────────────────────────────────────────────────────
const D_205  = 'Aimee, I can have the Sportage ready for you today and have finance review your application while we appraise your 2022 Seltos, so you get a real answer on approval. Would 2:00 PM or 2:45 PM today work better?';
const D_204a = 'The Glacial White Pearl 2026 Kia Sportage LX is here, and I can have it ready while we appraise your 2022 Seltos and get finance to confirm your approval. Can you make it at 1:30 PM or 2:15 PM today? I’ll have everything ready so you are not waiting.';
const D_204c = 'The Glacial White Pearl 2026 Kia Sportage LX is here, and I can have the interior ready for you to see today while we appraise your 2022 Seltos and review approval options. Would 1:45 PM or 2:30 PM work?';
const D_ALLIE = 'Allie, I can review the $25,988 offer and work toward the strongest complete price we can provide. I’ll have the Crystal Black Pearl HR-V Sport ready so you won’t be waiting; would 1:00 PM or 2:30 PM tomorrow work?';
// The shape the corrected prompt is asking for: her question first, our logistics folded in behind.
const D_WANT = 'Aimee, you asked to see the inside — I can have the Glacial White Pearl one ready to look through today. Does 2:00 or 2:45 work?';

const LIVE = { leadAgeDays: 5, _isStalled: false, _neverReplied: false };
const EXIT = { leadAgeDays: 5, hasExitSignal: true };

console.log('\nv9.7.668 — a required sentence gets a sentence, not the opening');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);

// ── (1) THE COLLISION IS GONE AT THE SOURCE ─────────────────────────────────
console.log('\n(1) the distance block no longer hands over a copyable opener:');

check('the SMS mandate no longer carries "Example:" at all',
  i => /- SMS: 1 sentence justifying the trip is MANDATORY[^\n]*Example:/.test(build(i, LIVE)), false);
check('...and the sentence the four drafts copied is no longer offered as the SMS example',
  i => /MANDATORY\. Example: "I will have everything ready when you arrive\."/.test(build(i, LIVE)), false);
check('the mandate itself SURVIVES — this is a position fix, not a removal',
  i => /- SMS: 1 sentence justifying the trip is MANDATORY/.test(build(i, LIVE)), true);
check('...and says in so many words that it is not the opening sentence',
  i => /MANDATORY, AND IT IS NOT THE OPENING SENTENCE/.test(build(i, LIVE)), true);
check('it names what DOES open the text',
  i => /If the customer has said or asked anything of their own, THAT opens the text/.test(build(i, LIVE)), true);
check('the replacement example is shown in the NON-opening position, as a clause',
  i => /frequently as a clause rather than a sentence of its own/.test(build(i, LIVE)), true);
check('the zero-reply lead is handled honestly — it CAN open there, since there is no hook to lose',
  i => /It opens the text ONLY on a lead where the customer has never said anything/.test(build(i, LIVE)), true);

// The justification CONTENT must not have been weakened while moving it.
check('"REQUIRED in EVERY format" is untouched — the trip is still justified',
  i => /- REQUIRED in EVERY format: One specific reason the visit is worth their time/.test(build(i, LIVE)), true);
check('the vehicle-confirmation bullet still carries the phrase, because there it is correct',
  i => /I will have everything ready when you arrive — you will not be waiting/.test(build(i, LIVE)), true);
check('"never make the distance buyer feel like they might drive far for nothing" survives',
  i => /Never make the distance buyer feel like they might drive far for nothing/.test(build(i, LIVE)), true);

// ── (2) THE SOLD ARM GETS THE SAME CORRECTION ───────────────────────────────
console.log('\n(2) the sold-unit arm has the same shape and gets the same fix:');

check('its own example is still there — v9.7.631 needs it',
  i => /I have a comparable one on the ground I can get ready for you/.test(build(i, LIVE, { soldUnit: true })), true);
check('...and it, too, is now told it is not the opener',
  i => /IT IS NOT THE OPENING SENTENCE EITHER/.test(build(i, LIVE, { soldUnit: true })), true);
check('the sold arm still refuses to promise this vehicle is waiting',
  i => /must not promise this vehicle is waiting/.test(build(i, LIVE, { soldUnit: true })), true);
check('and the sold arm still never offers the available-unit promise',
  i => /I will have everything ready when you arrive/.test(build(i, LIVE, { soldUnit: true })), false);

// ── (3) EXIT STILL WITHHOLDS THE WHOLE APPARATUS (v9.7.655 regression) ──────
console.log('\n(3) v9.7.655 is not disturbed — an exit lead gets no visit pitch at all:');

check('no SMS mandate on an exit lead, new wording included',
  i => /1 sentence justifying the trip is MANDATORY|IT IS NOT THE OPENING SENTENCE/.test(build(i, EXIT)), false);
check('no justification requirement on an exit lead',
  i => /REQUIRED in EVERY format/.test(build(i, EXIT)), false);

// ── (4) THE FORMAT RULE NOW STATES THE ORDERING ─────────────────────────────
console.log('\n(4) the SMS format rule says who gets the opening, as a shape and not a list:');

check('the rule was actually extracted — an empty slice passes every negative test',
  i => i.smsRule.length > 400, true);
check('a required sentence gets a sentence, not the first one',
  i => /REQUIRES A SENTENCE IN THE TEXT, IT GETS ONE — IT DOES NOT GET THE FIRST ONE/.test(i.smsRule), true);
check('it says a worked example is showing the sentence, not the opening line',
  i => /a worked example it hands you is showing you that sentence, not your opening line/.test(i.smsRule), true);
check('it names the symptom the four drafts all had',
  i => /IF THE TEXT OPENS ON SOMETHING WE ARE GOING TO DO, A REQUIRED SENTENCE HAS TAKEN THE OPENING/.test(i.smsRule), true);
check('it NAMES NO BLOCK — the next mandate is covered too, not just the distance one',
  i => /distance|DISTANCE|trade-in flag|OTD/.test(i.smsRule), false);
check('the new clause sits ABOVE the LP-command carve-out, so that still outranks it',
  i => i.smsRule.indexOf('IT DOES NOT GET THE FIRST ONE') < i.smsRule.indexOf('ONE EXCEPTION, AND IT OUTRANKS EVERYTHING ABOVE'), true);
check('the hook is still put out of reach of the cut',
  i => /THE HOOK IS NEVER WHAT GETS CUT/.test(i.smsRule), true);
check('the rule still names no vehicle, so it cannot be copied onto the wrong lead',
  i => /Sportage|Seltos|Accord|Prelude|CR-V|HR-V/.test(i.smsRule), false);

// ── (5) THE OBSERVATIONAL ROW, RUN ON ALL FOUR REAL DRAFTS ──────────────────
console.log('\n(5) the hook row, executed against every draft that produced this build:');

check('log205 Aimee — reaches for US',       i => reaches(hook(i, D_205,   'Aimee')), 'US');
check('log204 Aimee gen 1 — reaches for US', i => reaches(hook(i, D_204a,  'Aimee')), 'US');
check('log204 Aimee gen 3 — reaches for US', i => reaches(hook(i, D_204c,  'Aimee')), 'US');
check('log204 Allie — reaches for US',       i => reaches(hook(i, D_ALLIE, 'Allie')), 'US');
check('the shape the corrected prompt asks for reads THEM',
  i => reaches(hook(i, D_WANT, 'Aimee')), 'THEM');

// A sentence-subject test would have scored the two vehicle-first drafts as clean. That is the
// reason this row measures pronoun ORDER instead, and it is worth pinning so it is not "simplified"
// back into a subject test later.
check('the two vehicle-first drafts do NOT begin with a first-person pronoun',
  i => [/^(?:I|we)\b/i.test(D_204a), /^(?:I|we)\b/i.test(D_204c)], [false, false]);
check('...yet the shipped row still catches both, which a subject test would not',
  i => [reaches(hook(i, D_204a, 'Aimee')), reaches(hook(i, D_204c, 'Aimee'))], ['US', 'US']);

check('the name is stripped before the measurement, so the opener guard cannot skew it',
  i => /firstPersonAt:0/.test(hook(i, D_205, 'Aimee')), true);
check('...and it still measures correctly when no name was prepended',
  i => reaches(hook(i, 'I can have it ready for you today.', '')), 'US');

console.log('\n    the read-back shapes, reported on the same row:');
check('log205 carries a "while" clause',      i => /"while" clause:true/.test(hook(i, D_205, 'Aimee')), true);
check('Allie carries a semicolon',            i => /semicolon:true/.test(hook(i, D_ALLIE, 'Allie')), true);
check('the wanted shape carries neither',
  i => /semicolon:false/.test(hook(i, D_WANT, 'Aimee')) && /"while" clause:false/.test(hook(i, D_WANT, 'Aimee')), true);

console.log('\n    it decides nothing — the row must never become a guard:');
check('the draft is returned unmodified whatever the row says',
  i => { const sb = { String, RegExp, rawSms: D_205, firstName: 'Aimee', console: { log: () => {} } };
         vm.createContext(sb); vm.runInContext(i.hook, sb); return vm.runInContext('rawSms', sb); }, D_205);
check('it says so on the row itself',
  i => /observational only, nothing branches on this row/.test(hook(i, D_205, 'Aimee')), true);
check('an empty draft cannot throw',  i => reaches(hook(i, '', 'Aimee')), 'neither');
check('a null draft cannot throw',    i => reaches(hook(i, null, 'Aimee')), 'neither');
check('a name with regex metacharacters cannot throw',
  i => reaches(hook(i, D_205, 'A(i)m*ee')), 'US');

// ── NON-VACUITY ─────────────────────────────────────────────────────────────
console.log('\nnon-vacuity (v9.7.668):');

// Put the old mandate back and the block hands the copyable opener over again.
const OLD_MANDATE = c => c.replace(
  /'- SMS: 1 sentence justifying the trip is MANDATORY, AND IT IS NOT THE OPENING SENTENCE\.[^']*'/,
  '\'- SMS: 1 sentence justifying the trip is MANDATORY. Example: "I will have everything ready when you arrive."\'');

check('neuter A actually restored the old mandate',
  i => OLD_MANDATE(i.code) !== i.code, true);
check('A: the block hands back the exact sentence the four drafts copied',
  i => /MANDATORY\. Example: "I will have everything ready when you arrive\."/.test(build(i, LIVE, { mutate: OLD_MANDATE })), true);
check('A: and says nothing about where it goes — which is the whole defect',
  i => /NOT THE OPENING SENTENCE/.test(build(i, LIVE, { mutate: OLD_MANDATE })), false);
check('A (control): the shipped block does neither',
  i => [/MANDATORY\. Example: "I will have everything ready when you arrive\."/.test(build(i, LIVE)),
        /NOT THE OPENING SENTENCE/.test(build(i, LIVE))], [false, true]);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
