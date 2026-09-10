#!/usr/bin/env node
'use strict';
// (v9.7.621) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('first-touch-register.test.js');

/**
 * first-touch-register.test.js — v9.7.650. THREE BLOCKS WROTE AS IF MEETING THE CUSTOMER TODAY.
 *
 * Gil, 9/10, on the v9.7.649 dev capture: "Now it seems to read as a first touch rather than
 * having some reach out already." The build did what it was asked — the DR detector fired, the
 * steps reached the prompt, and the draft finally named the credit application — and the register
 * was wrong: "Brennan, I saw your Click & Go credit application came through ... Which model are
 * you shopping for?" That is touch seven, and his own thread already carried that question twice.
 *
 * Three separate blocks, none of which asked whether this was a first meeting:
 *
 *   THE STEPS BLOCK said "ACKNOWLEDGE THEM" unconditionally, so the model announced them. This is
 *   the v9.7.645 shape exactly — a persona block that mandated a self-introduction unconditionally,
 *   fixed by branching on data.hasOutbound because the phase block owns that fact.
 *
 *   THE SOURCE ACKNOWLEDGMENT carried its first-meeting example verbatim ("I saw your Click & Go
 *   request come through") into a prompt where the agent's own 8:52 AM text and 8:53 AM email had
 *   each already said "through Click & Go" to that customer. Its early-touch gate is an OR, so a
 *   0-day lead passes it however many times we have written.
 *
 *   THE QUALIFYING QUESTION was a lever nothing tracked. Every rule that should have caught the
 *   third asking was present and firing; none of them knew, because LP_ARC_ANGLES had eight angles
 *   and the opening question was not one of them.
 *
 * Everything below EXECUTES the shipped spans against the real 9/10 sends.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: first-touch-register.test.js <popup.js> [popup.js...]'); process.exit(2); }

const bail = (m) => require('./lib/fatal-guard.js').bail('first-touch-register.test.js', m);

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const grab = (a0, b0, label) => {
    const a = src.indexOf(a0);
    if (a < 0) bail(label + ' start not found in ' + file);
    const b = src.indexOf(b0, a);
    if (b < 0) bail(label + ' end not found in ' + file);
    return src.slice(a, b + b0.length);
  };
  return {
    name: path.basename(path.dirname(file)),
    src,
    steps: grab('var drSteps = [];', "      : '';", 'steps block'),
    // The end marker must be the THIRD arm's tail, not the first arm's: all three end with the same
    // sentence, and grabbing to the first match lifts only the scan plus one branch — which is
    // exactly the mistake that made three of this suite's own assertions fail on the first run.
    ack:   grab('var _ackSaid = false;', "+ 'label, a vendor name, or anything you see in the notes or lead history.');\n    }", 'source acknowledgment'),
    angles: grab('var LP_ARC_ANGLES = [', '\n];', 'angle table'),
    // (v9.7.651)
    asked: grab('function _lpQualifyingAsked(d) {', '\n  return false;\n}', 'qualifying-asked helper'),
    crm:   grab('vehicleExtras.push(_lpQualifyingAsked(d)', 'the vehicle you asked about."\');', 'CRM-CONFIRMS branch'),
    noveh: grab('(_lpQualifyingAsked(data)', "Ask what they are looking for instead.'),", 'no-vehicle constraint'),
    subj:  grab('...((!data.vehicle && !hasCustomerReply)', "none of the banned openers.']\n      : []),", 'subject directive'),
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

// ── runners ─────────────────────────────────────────────────────────────────
function stepBlock(impl, data, code) {
  const sb = { data: data, __block: null };
  vm.createContext(sb);
  vm.runInContext((code || impl.steps) + '\n__block = drSessionBlock;', sb);
  return sb.__block;
}
function ackLine(impl, data, ackName, code) {
  const sb = { data: data, _ackName: ackName, ageBlock: [],
               _ackP: { ex1: 'I saw your ' + ackName + ' request come through...',
                        ex2: 'Thanks for starting this on ' + ackName + '...' } };
  vm.createContext(sb);
  vm.runInContext(code || impl.ack, sb);
  return sb.ageBlock.join('\n');
}
function angleFor(impl, key, code) {
  const sb = {};
  vm.createContext(sb);
  vm.runInContext((code || impl.angles) + '\nvar __t = LP_ARC_ANGLES;', sb);
  const t = vm.runInContext('__t', sb);
  const row = t.filter(r => r[0] === key)[0];
  if (!row) bail('angle "' + key + '" not in the shipped table');
  return row[1];
}

// ── the real 9/10 artefacts ─────────────────────────────────────────────────
const SENT_TEXT  = 'Brennan, what Honda are you shopping for through Click & Go? Patricia Internet Sales Coordinator | Community Honda Lafayette 337-205-8323 Reply STOP to cancel.';
const SENT_EMAIL = 'Hi Brennan, What Honda are you shopping for through Click & Go? Send me the model, and I will point you in the right direction.';
const SENT_CHASSICA = 'Brennan This is Chassica Vincent with Community Honda Lafayette. How is your vehicle search going?';
const CREDIT_APP = { vrCreditApp: true, vrPaymentSelected: false, vrTradeIn: false, vrCompleted: false,
                     vrDroppedOff: false, vrDroppedOffPage: '', noVehicleAtAll: true };

console.log('\nv9.7.650 — a fact the customer already knows is not a discovery');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);

console.log('\n(1) the steps block, once outreach has gone out:');

const OUT  = Object.assign({}, CREDIT_APP, { hasOutbound: true });
const COLD = Object.assign({}, CREDIT_APP, { hasOutbound: false });

check('the steps still reach the prompt — this is not suppression',
  i => /SUBMITTED A CREDIT APPLICATION/.test(stepBlock(i, OUT)), true);

check('...but announcing them is forbidden by name',
  i => /no "I saw your credit application come through"/.test(stepBlock(i, OUT)), true);

check('...and the instruction becomes what the step MEANS',
  i => /Open on what the step MEANS for the next move/.test(stepBlock(i, OUT)), true);

check('a genuine first contact keeps the discovery framing',
  i => /OUTREACH HAS ALREADY GONE OUT/.test(stepBlock(i, COLD)), false);

check('...and is otherwise byte-identical to the v9.7.649 block',
  i => stepBlock(i, COLD).indexOf('STEPS THIS CUSTOMER ALREADY TOOK') > 0, true);

check('a session with no steps emits nothing on either footing',
  i => [stepBlock(i, { hasOutbound: true }), stepBlock(i, { hasOutbound: false })], ['', '']);

console.log('\n(2) the source acknowledgment, against the arc that owns the answer:');

const SAID = { hasOutbound: true, outboundSends: [{ body: SENT_TEXT }, { body: SENT_EMAIL }] };
const OUT_UNSAID = { hasOutbound: true, outboundSends: [{ body: SENT_CHASSICA }] };
const FIRST = { hasOutbound: false, outboundSends: [] };

check('already said to them — the block says so outright',
  i => /YOU HAVE ALREADY SAID SO TO THIS CUSTOMER/.test(ackLine(i, SAID, 'Click & Go')), true);

check('...and forbids the exact opener the model produced',
  i => /no "I saw your Click & Go request come through"/.test(ackLine(i, SAID, 'Click & Go')), true);

check('...and names it a restate',
  i => /Repeating it is a restate/.test(ackLine(i, SAID, 'Click & Go')), true);

check('outreach out but source never named — one mention allowed, not as an announcement',
  i => /may name the source once if it fits naturally, but NOT as an opening/.test(ackLine(i, OUT_UNSAID, 'Click & Go')), true);

check('...and that arm does not claim we already said it',
  i => /ALREADY SAID SO/.test(ackLine(i, OUT_UNSAID, 'Click & Go')), false);

check('a true first contact keeps the v9.7.636 wording exactly',
  i => /Reference it naturally in your opening so the customer knows you have their context/.test(ackLine(i, FIRST, 'Click & Go')), true);

check('the matching is case-insensitive — "click & go" in a send still counts',
  i => /ALREADY SAID SO/.test(ackLine(i, { hasOutbound: true, outboundSends: [{ body: 'started on click & go today' }] }, 'Click & Go')), true);

check('a send that does not name the source does not trip it',
  i => /ALREADY SAID SO/.test(ackLine(i, { hasOutbound: true, outboundSends: [{ body: 'How is your search going?' }] }, 'Click & Go')), false);

check('every arm still forbids the raw CRM label',
  i => [SAID, OUT_UNSAID, FIRST].every(d => /never a CRM routing label/.test(ackLine(i, d, 'Click & Go'))), true);

console.log('\n(3) the qualifying question is a lever the arc can see:');

check('the 8:52 AM text is read as a qualifying ask',
  i => angleFor(i, 'qualifying').test(SENT_TEXT), true);

check('the 8:53 AM email too',
  i => angleFor(i, 'qualifying').test(SENT_EMAIL), true);

check('and Chassica\'s 9:40 AM search question',
  i => angleFor(i, 'qualifying').test(SENT_CHASSICA), true);

// The over-reach direction. A statement that names a model is not an ask, and a false SPENT
// suppresses a legitimate first qualifying question on some later lead.
check('an availability statement naming a model is NOT a qualifying ask',
  i => angleFor(i, 'qualifying').test('The CR-V you are shopping for is here and available to see.'), false);

check('a price statement is not either',
  i => angleFor(i, 'qualifying').test('MSRP on the model is listed at 29,545.'), false);

check('nor is a time close',
  i => angleFor(i, 'qualifying').test('Would 2:00 PM or 2:45 PM work for you today?'), false);

check('nor an incentive line',
  i => angleFor(i, 'qualifying').test('Current program on the Civic Hatchback is $249/mo for 39 months.'), false);

check('the eight legacy angles are all still present and none renamed',
  i => { const sb = {}; vm.createContext(sb); vm.runInContext(impls[0].angles, sb);
         return vm.runInContext('LP_ARC_ANGLES', sb).map(r => r[0]); },
  ['availability', 'price', 'payment', 'trade', 'incentive', 'appointment', 'manager', 'stepback', 'qualifying']);

// ── NON-VACUITY ─────────────────────────────────────────────────────────────
console.log('\nnon-vacuity (restoring each register):');

const OLD_STEPS = c => c.replace(/\+ \(data\.hasOutbound[\s\S]*?: ''\)\n/, '');
const OLD_ACK   = c => c.replace('if (_ackSaid) {', 'if (false) {')
                        .replace('} else if (data && data.hasOutbound) {', '} else if (false) {');
const OLD_ANGLES = c => c.replace(/,\n\s*\/\/ \(v9\.7\.650\)[\s\S]*?\['qualifying',[\s\S]*?\/i\]/, '');

check('neuter A actually changed the steps block', i => OLD_STEPS(i.steps) !== i.steps, true);
check('A: without the branch the steps read as discovery on touch seven',
  i => /OUTREACH HAS ALREADY GONE OUT/.test(stepBlock(i, OUT, OLD_STEPS(i.steps))), false);
check('A (control): the shipped block carries the branch', i => /OUTREACH HAS ALREADY GONE OUT/.test(stepBlock(i, OUT)), true);

check('neuter B actually changed the acknowledgment', i => OLD_ACK(i.ack) !== i.ack, true);
check('B: with one arm, an already-named source is announced again — the reported bug',
  i => /Reference it naturally in your opening/.test(ackLine(i, SAID, 'Click & Go', OLD_ACK(i.ack))), true);
check('B (control): the shipped block refuses to re-announce it',
  i => /Reference it naturally in your opening/.test(ackLine(i, SAID, 'Click & Go')), false);

check('neuter C actually changed the angle table', i => OLD_ANGLES(i.angles) !== i.angles, true);
check('C: without the angle the table is back to eight',
  i => { const sb = {}; vm.createContext(sb); vm.runInContext(OLD_ANGLES(impls[0].angles), sb);
         return vm.runInContext('LP_ARC_ANGLES', sb).length; }, 8);
check('C: and the question that was asked twice reads as unused',
  i => { const sb = {}; vm.createContext(sb); vm.runInContext(OLD_ANGLES(i.angles), sb);
         return vm.runInContext('LP_ARC_ANGLES', sb).some(r => r[1].test(SENT_TEXT) && r[0] === 'qualifying'); }, false);

// ── (v9.7.651) THE NO-VEHICLE BLOCKS READ THE ARC INSTEAD OF ASSUMING ───────────────────────
// v9.7.650's lever fired and the draft asked anyway, because the arc block is an OBSERVATION and
// it was up against two INSTRUCTIONS. These execute the shipped helper and both shipped branches.
function askedFor(impl, sends) {
  const sb = { LP_ARC_ANGLES: null, d: { outboundSends: sends }, __out: null, String: String };
  vm.createContext(sb);
  vm.runInContext(impl.angles + '\n' + impl.asked + '\n__out = _lpQualifyingAsked(d);', sb);
  return sb.__out;
}
function crmLine(impl, asked, code) {
  const out = [];
  const sb = { vehicleExtras: { push: (x) => out.push(x) }, _lpQualifyingAsked: () => asked, d: {} };
  vm.createContext(sb);
  vm.runInContext(code || impl.crm, sb);
  return out[0];
}
function noVehLine(impl, asked) {
  const sb = { _lpQualifyingAsked: () => asked, data: {}, __out: null };
  vm.createContext(sb);
  vm.runInContext('__out = ' + impl.noveh.replace(/,\s*$/, '') + ';', sb);
  return sb.__out;
}
function subjLines(impl, data, hasReply) {
  const sb = { data: data, hasCustomerReply: hasReply, __out: null };
  vm.createContext(sb);
  // The lifted span is a SPREAD member. Strip the leading dots and evaluate the ternary itself —
  // wrapping it in another array made length always 1 and hid two real cases on the first run.
  vm.runInContext('__out = ' + impl.subj.replace(/^\.\.\./, '').replace(/,\s*$/, '') + ';', sb);
  return sb.__out;
}

console.log('\n(4) the helper reads the one table that owns the answer:');

check('Brennan\'s three real sends make it true',
  i => askedFor(i, [{ body: SENT_TEXT }, { body: SENT_EMAIL }, { body: SENT_CHASSICA }]), true);

check('the 8:52 text alone is enough',
  i => askedFor(i, [{ body: SENT_TEXT }]), true);

check('sends that never asked leave it false',
  i => askedFor(i, [{ body: 'The CR-V is here and available to see.' },
                    { body: 'Would 2:00 PM or 2:45 PM work today?' }]), false);

check('no sends at all is false, not a throw',
  i => askedFor(i, []), false);

check('a malformed send cannot throw it',
  i => askedFor(i, [null, { }, { body: null }]), false);

console.log('\n(5) both no-vehicle blocks branch on it:');

check('CRM-CONFIRMS, first asking — the v9.7.650 wording, byte for byte',
  i => crmLine(i, false),
  'CRM CONFIRMS: no vehicle of interest is on file for this lead (authoritative record, not a display failure). Ask directly and confidently what they are shopping for — do not reference or hedge about "the vehicle you asked about."');

check('CRM-CONFIRMS, already asked — names it the restate failure',
  i => /Asking a third time in different words is the restate failure/.test(crmLine(i, true)), true);

check('...and still states the authoritative fact that there is no vehicle',
  i => /no vehicle of interest is on file for this lead \(authoritative record/.test(crmLine(i, true)), true);

check('...and offers the two real ways out: a smaller ask, or another lever',
  i => /make the ask far smaller/.test(crmLine(i, true)) && /lever that has not been used yet/.test(crmLine(i, true)), true);

check('hard constraint, first asking — unchanged',
  i => noVehLine(i, false),
  '- NEVER mention a specific vehicle model, trim, or name that does not appear in this prompt. If no vehicle of interest is listed on the lead, do NOT invent one. Ask what they are looking for instead.');

check('hard constraint, already asked — drops the ask, keeps the prohibition',
  i => /NEVER mention a specific vehicle model/.test(noVehLine(i, true))
    && /Do NOT simply ask what they are looking for either/.test(noVehLine(i, true)), true);

check('the prohibition on naming an absent vehicle is on BOTH arms',
  i => [true, false].every(a => /do NOT invent one/.test(noVehLine(i, a))), true);

console.log('\n(6) the subject directive fires on the shape that has no anchors:');

check('no vehicle and no customer message — the directive is emitted',
  i => subjLines(i, { vehicle: '' }, false).length, 1);

check('...and it forbids stating a fact back at them, with the real example',
  i => /Your application is already submitted/.test(subjLines(i, { vehicle: '' }, false)[0]), true);

check('...and points at what is new to the reader instead',
  i => /Anchor on what is NEW to them/.test(subjLines(i, { vehicle: '' }, false)[0]), true);

check('...and keeps the length and the bans from the system rules',
  i => /4-8 words/.test(subjLines(i, { vehicle: '' }, false)[0])
    && /none of the banned openers/.test(subjLines(i, { vehicle: '' }, false)[0]), true);

check('a lead WITH a vehicle gets nothing — the rules already have an anchor',
  i => subjLines(i, { vehicle: '2026 Honda Civic Hatchback Sport' }, false).length, 0);

check('a customer who has written to us gets nothing — they said something to quote',
  i => subjLines(i, { vehicle: '' }, true).length, 0);

// The cached prefix must not have moved: the SUBJECT LINE RULES stay in the system prompt above
// the breakpoint, untouched. A per-lead subject rule up there would re-cost the prefix every
// generation, and the daily report reads that number.
check('the SUBJECT LINE RULES are still above the cache breakpoint and unbranched',
  i => { const s = i.src; const r = s.indexOf("'SUBJECT LINE RULES:'");
         const b = s.indexOf("'⟦LP_CACHE_BREAKPOINT⟧'");
         return r > 0 && b > 0 && r < b; }, true);

// Read the actual span rather than a bounded lazy regex: a length guess is not a measurement,
// and a lazy match with no bound would run to the first hit anywhere in the file.
check('...and nothing per-lead was added to them',
  i => { const s = i.src;
         const a = s.indexOf("'SUBJECT LINE RULES:'");
         const b = s.indexOf("'⟦LP_CACHE_BREAKPOINT⟧'", a);
         const span = s.slice(a, b);
         // Identifiers only. An earlier version of this line also tested /data\./ and failed on the
         // span's own English -- "without confirmation in the lead data." -- which is the prose-match
         // hazard (v9.7.630) inside the suite that exists to catch it.
         return !/_lpQualifyingAsked|hasCustomerReply/.test(span); }, true);

// The stronger property behind that one: this span is a list of STATIC strings, so the cached
// prefix is byte-identical on every lead. Any string concatenation in here would make it per-lead.
check('...and the whole rules block is static — no interpolation in the cached prefix',
  i => { const s = i.src;
         const a = s.indexOf("'SUBJECT LINE RULES:'");
         const b = s.indexOf("'⟦LP_CACHE_BREAKPOINT⟧'", a);
         return (s.slice(a, b).match(/' \+ | \+ '/g) || []).length; }, 0);

console.log('\nnon-vacuity (v9.7.651 branches):');
const OLD_CRM   = c => c.replace('_lpQualifyingAsked(d)', 'false');
const OLD_NOVEH = c => c.replace('_lpQualifyingAsked(data)', 'false');
const OLD_SUBJ  = c => c.replace('(!data.vehicle && !hasCustomerReply)', 'false');

check('neuter D actually changed the CRM branch', i => OLD_CRM(i.crm) !== i.crm, true);
check('D: pinned to "not asked", the third asking is instructed again — the reported bug',
  i => /Ask directly and confidently what they are shopping for/.test(crmLine(i, true, OLD_CRM(i.crm))), true);

check('neuter E actually changed the constraint', i => OLD_NOVEH(i.noveh) !== i.noveh, true);
check('E: pinned to "not asked", the constraint tells it to ask again',
  i => { const sb = { _lpQualifyingAsked: () => true, data: {}, __out: null };
         vm.createContext(sb);
         vm.runInContext('__out = ' + OLD_NOVEH(i.noveh).replace(/,\s*$/, '') + ';', sb);
         return /Ask what they are looking for instead/.test(sb.__out); }, true);

check('neuter F actually changed the subject gate', i => OLD_SUBJ(i.subj) !== i.subj, true);
check('F: with the gate off, the anchorless lead gets no subject guidance',
  i => { const sb = { data: { vehicle: '' }, hasCustomerReply: false, __out: null };
         vm.createContext(sb);
         vm.runInContext('__out = ' + OLD_SUBJ(i.subj).replace(/^\.\.\./, '').replace(/,\s*$/, '') + ';', sb);
         return sb.__out.length; }, 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
