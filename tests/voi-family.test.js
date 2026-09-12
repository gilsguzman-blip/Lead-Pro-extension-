#!/usr/bin/env node
'use strict';
// (v9.7.616) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('voi-family.test.js');

/**
 * voi-family.test.js — v9.7.616. LEAD PRO PICKED A CAR THE CUSTOMER NEVER ASKED FOR, AND LOCKED IT.
 *
 * LIVE, 9/4. Sharon Pierre, Community Kia Baytown, lead 2078254326. Her PageData, read straight
 * out of the VinSolutions dump Gil captured at 10:18:54:
 *
 *   Lead.LeadCreatedUTC      2026-09-04T01:46:00      (8:46 PM Central, 9/3)
 *   VehiclesOfInterest[0]    YearName 2026 | Make Kia | Model Sorento  | ModelTrim "LX FWD"
 *                            CreatedUTC 2026-09-04T05:02:00 | CreatedByUserID -189
 *   LeadVehicle              YearName 2026 | Make Kia | Model Sportage | TrimName  "EX"
 *
 * The lead arrived "with no comments" on a SORENTO. Three hours later something repinned it to a
 * SPORTAGE -- 05:02 UTC is 12:02 AM Central, the exact minute of the CRM's own note "Primary
 * vehicle changed from 2026 Kia Sorento LX FWD to 2026 Kia Sportage EX", and CreatedByUserID -189
 * is negative, which is VinSolutions' marker for an automated actor. Sharon has never written a
 * word to us; she did not ask for the swap.
 *
 * WHAT SHIPPED TO THE MODEL: "Vehicle: 2026 Kia Sportage EX <- THIS IS THE VEHICLE FOR THIS LEAD.
 * Do not substitute or reference other vehicles from the conversation history." The word "Sorento"
 * appears ZERO times in that 32,673-character prompt and ZERO times in log164. Only the COUNT of
 * VehiclesOfInterest ever reached the popup (v9.7.480/475 graduated it as an authoritative
 * empty/count and stopped there), so the second vehicle was invisible -- and LP did not merely
 * fail to mention it, it instructed the model not to.
 *
 * THE FIX IS NOT TO PICK THE OTHER CAR. Which one Sharon wants is exactly what nobody here knows.
 * The prompt already contains the correct instruction for this shape, in the AGENT CONTEXT block:
 * "Do NOT assert either one as the settled answer either. Ask ONE direct question naming both
 * distinctly so the customer tells you which." That rule never fired, because [LP VOI CONFLICT
 * DIAG] compares only YEAR and CONDITION parsed out of notes -- on Sharon it logged
 * {"hasConflict":false,"voiYear":"2026","voiCond":null,"noteYear":null,"noteCond":null}, a
 * comparison with nothing on the other side. It has never compared MODEL, and never looked at the
 * VehiclesOfInterest panel at all.
 *
 * So: read the array as content, compare model families, and when two are present hand the model
 * the question instead of a verdict. Model only -- "Sportage EX" vs "Sportage LX" is one
 * conversation; "Sportage" vs "Sorento" is two.
 *
 * Executes the SHIPPED helper and the SHIPPED directive text. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: voi-family.test.js <popup.js> [popup.js...]'); process.exit(2); }

function slice(src, a, b, what) {
  const i = src.indexOf(a);
  if (i < 0) throw new Error(what + ' start not found');
  const j = src.indexOf(b, i);
  if (j < 0) throw new Error(what + ' end not found');
  return src.slice(i, j + b.length);
}

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  // The comparator, module scope, lifted whole.
  const helper = slice(src, 'function _lpVoiFamilyMismatch(leadVehText, voiList) {',
                            '  return out;\n}', 'mismatch helper');
  // The three-branch vehicle line, exactly as the prompt builder evaluates it. Wrapped as an
  // assignment so the suite reads the SHIPPED string rather than a paraphrase of it.
  const line = 'var VEHLINE = ' + slice(src, '(data.vehicle && _voiMis.length)',
                                             "unless it is listed here.'", 'vehicle line') + ';';
  // NOT named `code`: guarded-impls.js substitutes the WHOLE FILE for a missing `code`
  // (so source-scan assertions still work), which would make a pre-fix run report
  // "window is not defined" instead of naming what was absent. A distinct key gets the
  // labelled 'NOT IN THIS BUILD' error the non-vacuity check is supposed to print.
  // The gate that decides whether the question fires at all — lifted whole, because from v9.7.619
  // it is the behaviour, not the directive text.
  const gate = slice(src, '  var _voiMisRaw = _lpVoiFamilyMismatch(data.vehicle, data.pdVoiList);',
                          '  } catch (_eVfd) {}', 'voi gate');
  return { name: path.basename(path.dirname(file)), src, helper, line, gate };
}

function mismatch(impl, leadVeh, voiList) {
  const sb = { String, RegExp, Array, Object };
  vm.createContext(sb);
  vm.runInContext(impl.helper, sb);
  sb.LV = leadVeh; sb.VL = voiList;
  return vm.runInContext('_lpVoiFamilyMismatch(LV, VL)', sb);
}

// (v9.7.619) `arc` is the conversation text. The two-vehicle question is now gated on the other
// nameplate actually appearing there, so every call must say what the conversation contained —
// which is the whole behaviour under test.
function vehLine(impl, leadVeh, voiList, arc) {
  const sb = { String, RegExp, Array, Object, console: { log(){} } };
  vm.createContext(sb);
  vm.runInContext(impl.helper, sb);
  // The shipped gate reads data.pdVoiList and data.context — hand it the real shape, not a
  // convenient one, or the suite tests a path production never takes.
  sb.data = { vehicle: leadVeh, pdVoiList: voiList, context: arc || '',
              conversationBrief: '', lastInboundMsg: '' };
  vm.runInContext(impl.gate, sb);
  vm.runInContext(impl.line, sb);
  return vm.runInContext('VEHLINE', sb);
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

// Sharon's real records, field for field out of the dump's PageData.
const SPORTAGE = '2026 Kia Sportage EX';
const SORENTO  = { desc: '2026 Kia Sorento LX FWD', model: 'Sorento', year: '2026', cond: 'New', bySystem: true };
// The same VOI as a human would have entered it — used to prove the automated-actor sentence is
// evidence-driven and not boilerplate welded to the directive.
const SORENTO_BY_PERSON = Object.assign({}, SORENTO, { bySystem: false });
// (v9.7.619) A conversation in which the Sorento genuinely came up — the only condition under
// which the question is allowed to fire.
const RAISED = '[09/04/2026 10:12 AM] [CUSTOMER] actually I was looking at the Sorento';
const NOT_RAISED = '[09/04/2026 9:20 AM] [AGENT] Good morning Ms Sharon please confirm you are getting my message on the Kia Sportage';

console.log('\nv9.7.616 — two vehicles on a lead is a question, not a verdict');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);
console.log('');

// ── SHARON'S EXACT CASE ─────────────────────────────────────────────────────
console.log("Sharon Pierre, 9/4 — the lead came in on a Sorento and was repinned to a Sportage:");

check('the Sorento is detected as a second model family',
  i => mismatch(i, SPORTAGE, [SORENTO]).map(v => v.desc), ['2026 Kia Sorento LX FWD']);

check('the do-not-substitute lock is GONE from the vehicle line',
  i => /Do not substitute or reference other vehicles/.test(vehLine(i, SPORTAGE, [SORENTO], RAISED)), false);

check('...and the pinned car is described as pinned, not as what she asked for',
  i => /THIS IS THE VEHICLE CURRENTLY PINNED TO THE LEAD/.test(vehLine(i, SPORTAGE, [SORENTO], RAISED)), true);

check('BOTH vehicles are named in the directive',
  i => { const t = vehLine(i, SPORTAGE, [SORENTO], RAISED);
         return /2026 Kia Sportage EX/.test(t) && /2026 Kia Sorento LX FWD/.test(t); }, true);

check('the model is told to ask ONE direct question rather than choose',
  i => /Name BOTH distinctly in ONE direct question and let the customer tell you which/
        .test(vehLine(i, SPORTAGE, [SORENTO], RAISED)), true);

check('...and is explicitly forbidden from settling it itself',
  i => /Do NOT assert either one as the settled answer/.test(vehLine(i, SPORTAGE, [SORENTO], RAISED)), true);

check('the automated swap is stated as evidence, since the record carries it',
  i => /the change was made by an automated process rather than by a person/
        .test(vehLine(i, SPORTAGE, [SORENTO], RAISED)), true);

check('...and is NOT claimed when a person made the change',
  i => /automated process/.test(vehLine(i, SPORTAGE, [SORENTO_BY_PERSON], RAISED)), false);

check('...though a human-set second vehicle still raises the question',
  i => /TWO DIFFERENT VEHICLES ARE ON THIS LEAD/.test(vehLine(i, SPORTAGE, [SORENTO_BY_PERSON], RAISED)), true);

check('the worked example names the real pair, not a placeholder',
  i => /are you looking at the 2026 Kia Sportage EX, or the 2026 Kia Sorento LX FWD\?/
        .test(vehLine(i, SPORTAGE, [SORENTO], RAISED)), true);

check('every format is bound by it — a short SMS is not an excuse to drop one car',
  i => /applies identically to the SMS, the email AND the voicemail/.test(vehLine(i, SPORTAGE, [SORENTO], RAISED)), true);

check('the rest of the prompt is reframed as the CRM record, not a customer decision',
  i => /describing the CRM record, not a customer decision/.test(vehLine(i, SPORTAGE, [SORENTO], RAISED)), true);

check('the condition is carried through when the record has one',
  i => /"2026 Kia Sorento LX FWD" \(New\)/.test(vehLine(i, SPORTAGE, [SORENTO], RAISED)), true);

// ── THE ORDINARY LEAD MUST BE UNTOUCHED ─────────────────────────────────────
// This is the whole risk of the build: an over-eager comparator would put a confusing
// two-vehicle question on every clean lead in the fleet.
console.log('\nthe ordinary lead is byte-for-byte what it was before:');

const PLAIN = 'Vehicle:    2026 Kia Sportage EX  ← THIS IS THE VEHICLE FOR THIS LEAD. Do not substitute or reference other vehicles from the conversation history.';

check('no VOI records at all → the original lock, unchanged',
  i => vehLine(i, SPORTAGE, []), PLAIN);
check('a null VOI list (older scrape, field absent) → the original lock',
  i => vehLine(i, SPORTAGE, null), PLAIN);
check('an undefined VOI list → the original lock',
  i => vehLine(i, SPORTAGE, undefined), PLAIN);
check('the SAME model on both sides is not a conflict',
  i => mismatch(i, SPORTAGE, [{ desc: '2026 Kia Sportage LX', model: 'Sportage' }]).length, 0);
check('...so a trim difference alone leaves the lock in place',
  i => vehLine(i, SPORTAGE, [{ desc: '2026 Kia Sportage LX', model: 'Sportage' }]), PLAIN);
check('a different YEAR of the same model is not a conflict either',
  i => mismatch(i, SPORTAGE, [{ desc: '2025 Kia Sportage EX', model: 'Sportage' }]).length, 0);
check('case does not matter',
  i => mismatch(i, '2026 KIA SPORTAGE EX', [{ desc: 'x', model: 'sportage' }]).length, 0);
check('no vehicle on the lead at all → the no-vehicle branch, unchanged',
  i => /NO VEHICLE IS ATTACHED TO THIS LEAD/.test(vehLine(i, '', [SORENTO])), true);

// ── TRICIA, THE SAME DAY, AS THE CONTROL ────────────────────────────────────
// Her PageData reported vois:0 — a genuinely single-vehicle lead an hour earlier at the same
// store. If the comparator fired here it would be firing on nothing.
console.log('\nTricia Green, 9/4, same store, vois:0 — nothing to ask about:');
check('a lead with an empty VOI array is silent',
  i => mismatch(i, '2023 Kia EV6 Wind', []).length, 0);
check('...and keeps the original vehicle line',
  i => /THIS IS THE VEHICLE FOR THIS LEAD/.test(vehLine(i, '2023 Kia EV6 Wind', [])), true);

// ── ROBUSTNESS — THE COMPARATOR MUST NEVER THROW INTO THE PROMPT BUILD ──────
// It runs one line above the LEAD block; an exception here kills the whole prompt.
console.log('\nnothing here can throw into the prompt build:');
check('a VOI record with no model is skipped, not crashed on',
  i => mismatch(i, SPORTAGE, [{ desc: 'junk', model: '' }]).length, 0);
check('a null entry inside the list is survived',
  i => mismatch(i, SPORTAGE, [null, SORENTO]).map(v => v.desc), ['2026 Kia Sorento LX FWD']);
check('a model containing regex metacharacters cannot blow up the matcher',
  i => mismatch(i, SPORTAGE, [{ desc: 'weird', model: 'A+(B)[C]*' }]).length, 1);
check('a non-string lead vehicle yields no mismatch rather than throwing',
  i => mismatch(i, null, [SORENTO]).length, 0);
check('a non-array VOI list yields no mismatch rather than throwing',
  i => mismatch(i, SPORTAGE, 'nonsense').length, 0);

// ── A NAMEPLATE MUST MATCH AS A WORD ────────────────────────────────────────
// "Niro" inside "Niro EV" is a real Kia case; a substring match would call these two families.
console.log('\nnameplates match as words, not substrings:');
check('"Niro" against a pinned "2026 Kia Niro EV" is the same family',
  i => mismatch(i, '2026 Kia Niro EV', [{ desc: '2026 Kia Niro', model: 'Niro' }]).length, 0);
check('"Niro EV" is still distinguishable from a pinned plain Niro by model string',
  i => mismatch(i, '2026 Kia Niro', [{ desc: '2026 Kia Niro EV', model: 'Niro EV' }]).length, 1);
check('a nameplate embedded in a longer word does not count as present',
  i => mismatch(i, '2026 Kia Sportageous', [{ desc: 'x', model: 'Sportage' }]).length, 1);

// ── THE FRAME MERGE — WHAT v9.7.616 SHIPPED AND THIS SUITE DID NOT CATCH ────
// Every assertion above passed on v9.7.616, and the feature still did nothing in production:
// [LP VOI FAMILY DIAG] reported voiRecords:0 on Sharon's 11:52 grab while PageData on the lead
// frame said vois:1. The helper was correct and was never handed the data. A VinSolutions grab
// yields several frames — one real, the rest empty shells — and they collapse through
// `if (!m[k] && d[k]) m[k] = d[k];`. An EMPTY ARRAY IS TRUTHY, so a shell's [] won and locked the
// real record out permanently. Testing the helper in isolation could never see that; these
// assertions execute the SHIPPED merge line against the SHIPPED emit convention.
console.log('\nthe frame merge — a shell must not outvote the frame that has the data:');

const MERGE = (frames) => {                       // the shipped rule, verbatim
  const m = {};
  frames.forEach(d => { ['pdVoiList'].forEach(k => { if (!m[k] && d[k]) m[k] = d[k]; }); });
  return m;
};
// What the shipped scraper emits per frame: null when it has no VOI records, the array when it does.
const emitFor = (impl, records) => {
  const src = impl.src;
  if (src.indexOf('if (!_pdVoiList.length) _pdVoiList = null;') < 0)
    throw new Error('empty-is-null normalisation missing — a shell frame will win the merge');
  return records.length ? records : null;
};

check('the scraper normalises an empty VOI list to null, so absence loses the merge',
  i => emitFor(i, []), null);
check('SHARON: a shell frame first, the real frame second — the Sorento still arrives',
  i => (MERGE([{ pdVoiList: emitFor(i, []) }, { pdVoiList: emitFor(i, [SORENTO]) }]).pdVoiList || []).map(v => v.desc),
  ['2026 Kia Sorento LX FWD']);
check('...and the mismatch is therefore still detected after the merge',
  i => mismatch(i, SPORTAGE, MERGE([{ pdVoiList: emitFor(i, []) },
                                    { pdVoiList: emitFor(i, [SORENTO]) }]).pdVoiList).length, 1);
check('four shells ahead of it, the real frame last — Sharon\'s actual frame shape',
  i => mismatch(i, SPORTAGE, MERGE([{ pdVoiList: emitFor(i, []) }, { pdVoiList: emitFor(i, []) },
                                    { pdVoiList: emitFor(i, []) }, { pdVoiList: emitFor(i, []) },
                                    { pdVoiList: emitFor(i, [SORENTO]) }]).pdVoiList).length, 1);
check('all shells and nothing else merges to nothing, not to a phantom conflict',
  i => mismatch(i, SPORTAGE, MERGE([{ pdVoiList: emitFor(i, []) }, { pdVoiList: emitFor(i, []) }]).pdVoiList).length, 0);
// The bug, stated as an assertion so it cannot come back by someone "tidying" null to [].
check('an EMPTY ARRAY would have won that merge — which is exactly what v9.7.616 shipped',
  i => { const m = {}; [[], [SORENTO]].forEach(v => { if (!m.k && v) m.k = v; }); return m.k.length; }, 0);

// ── IS IT WIRED? THE QUESTION NEITHER v9.7.616 NOR v9.7.617 ASKED ──────────
// buildUserPrompt does not receive the merged scrape — it receives a HAND-BUILT OBJECT LITERAL.
// v9.7.616 added pdVoiList to the scraper's return and read data.pdVoiList in the prompt builder,
// and nothing joined them, so voiRecords:0 shipped twice while the scraper produced the Sorento
// record correctly all along. Every assertion above passed through both of those builds.
console.log('\nthe field must actually reach the prompt builder:');

check('pdVoiList is passed into the buildUserPrompt object literal',
  i => { const call = i.src.indexOf('buildUserPrompt({');
         const wire = i.src.indexOf('pdVoiList:                 lastScrapedData');
         return call > 0 && wire > call; }, true);

check('...sourced from the scrape, defaulting to null rather than undefined',
  i => /pdVoiList:\s*lastScrapedData \? \(lastScrapedData\.pdVoiList \|\| null\) : null/.test(i.src), true);

check('the scraper still emits it on its return object, so both ends exist',
  i => /pdVoiList: _pdVoiList/.test(i.src), true);

// ── (v9.7.619) THE PRIMARY VOI GOVERNS UNLESS THE OTHER CAR CAME UP IN THE CONVERSATION ────
// Gil's rule, and it corrects the default v9.7.616 shipped rather than refining it. Asking the
// question off the CRM list alone produced a WORSE message on Sharon than the bug did: the whole
// SMS became "are you looking at the 2026 Kia Sportage EX or the 2026 Kia Sorento LX FWD? Reply
// Sportage or Sorento." — an interrogation, as the first thing a customer who has never spoken to
// us receives, and it discarded the availability and both live Sportage programs already in the
// prompt. The record also reads the other way from how I read it: the Sorento row was CREATED at
// the moment of the swap, so that list is the lead's history, not a competing ask.
console.log('\nSHARON, THE REAL CASE — CRM-only second vehicle, never mentioned to anyone:');

check('the question does NOT fire when the Sorento appears only in the CRM',
  i => /TWO DIFFERENT VEHICLES ARE ON THIS LEAD/.test(vehLine(i, SPORTAGE, [SORENTO], NOT_RAISED)), false);

check('...the pinned vehicle keeps its ordinary line, byte for byte',
  i => vehLine(i, SPORTAGE, [SORENTO], NOT_RAISED), PLAIN);

check('...so the Sorento is never named to a customer who never mentioned it',
  i => /Sorento/.test(vehLine(i, SPORTAGE, [SORENTO], NOT_RAISED)), false);

check('an empty conversation cannot raise anything',
  i => vehLine(i, SPORTAGE, [SORENTO], ''), PLAIN);

check('our own outbound naming only the Sportage does not raise the Sorento',
  i => vehLine(i, SPORTAGE, [SORENTO],
        '[AGENT] please confirm you are getting my message on the Kia Sportage'), PLAIN);

console.log('\n...but when the customer DOES raise it, the question still fires:');

check('a customer naming the other model fires it',
  i => /TWO DIFFERENT VEHICLES ARE ON THIS LEAD/.test(
        vehLine(i, SPORTAGE, [SORENTO], '[CUSTOMER] actually I was looking at the Sorento')), true);

check('an AGENT NOTE recording what the customer wants fires it too — same evidence the prompt already trusts',
  i => /TWO DIFFERENT VEHICLES ARE ON THIS LEAD/.test(
        vehLine(i, SPORTAGE, [SORENTO], '[NOTE] By: Robert Staten — called, she wants the Sorento not the Sportage')), true);

check('the nameplate must match as a word, not inside another one',
  i => /TWO DIFFERENT VEHICLES ARE ON THIS LEAD/.test(
        vehLine(i, SPORTAGE, [SORENTO], '[CUSTOMER] I saw a Sorentoish thing online')), false);

check('the diagnostic distinguishes "other family exists" from "raised in conversation"',
  i => { const logs = []; const sb = { String, RegExp, Array, Object, console: { log: m => logs.push(m) } };
         vm.createContext(sb); vm.runInContext(i.helper, sb);
         sb.data = { vehicle: SPORTAGE, pdVoiList: [SORENTO], context: NOT_RAISED,
                     conversationBrief: '', lastInboundMsg: '' };
         vm.runInContext(i.gate, sb);
         return /otherFamilies:1 \| raisedInConversation:0/.test(logs.join(' '))
             && /CRM-ONLY, never raised in the conversation/.test(logs.join(' ')); }, true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
