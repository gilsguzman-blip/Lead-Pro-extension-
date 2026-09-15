#!/usr/bin/env node
'use strict';
// (v9.7.611) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('stock-color.test.js');

/**
 * stock-color.test.js — v9.7.660. "CONFIRMED IN STOCK" IS NOT AN ANSWER TO "IS IT BLACK".
 *
 * LIVE, 9/14. Vershima Tachia, Community Honda Baytown, lead 2080928005. He totalled his Civic,
 * he wants a BLACK 2026 Prelude, and a manager told him on 9/10 that a black one could be brought
 * in against a deposit. What went out:
 *
 *   "I understand Yvonne told you a black Prelude could be shipped after submitting a down
 *    payment. The 2026 Honda Prelude is currently here, so shipping would not be necessary."
 *
 * We do not have a black one. The two on the lot are Meteorite Gray Metallic and Winter Frost
 * Pearl, and both were in that same prompt. Gil: "It has the facts but missed on the correct
 * availability."
 *
 * Nothing in the prompt was false. The confirmation said stock P4886 is present: true. The colour
 * check reported customerStated:black voiColor:Black mismatch:false: also true, and useless — the
 * VOI colour records what the CUSTOMER asked for, so it can only ever agree with what the customer
 * asked for. The colour of the CAR was never in the comparison.
 *
 * Drives the SHIPPED capture, the SHIPPED _lpCleanColor and the SHIPPED directive block.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: stock-color.test.js <popup.js> [popup.js...]'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const span = (mark, what, end) => {
    const a = src.indexOf(mark);
    if (a < 0) throw new Error(what + ' not found');
    const b = src.indexOf(end, a);
    if (b < 0) throw new Error(what + ' end not found');
    return src.slice(a, b + end.length);
  };
  // The colour scrubber travels with the block — the block calls it, and a unit whose feed colour
  // is a factory code must produce no claim at all.
  // (v9.7.661) The agreement gate calls _lpColorWords, so it travels too. Supplied from the SAME
  // shipped file rather than stubbed — the v9.7.613 harness lesson: a stub more generous than
  // production passes assertions the real code would fail.
  const clean = span('function _lpCleanColor(c){', '_lpCleanColor', '\n}\n')
    + '\n' + span('function _lpColorWords(s){', '_lpColorWords', 'return set; }\n');
  // The capture. Its whole point is that the matched RECORD survives, not just a boolean.
  const capture = span('  var _lpInvUnit = null;', 'the unit capture', '\n  } catch (eInvCk) {}');
  // The directive block, from the confirmation branch to the start of the Audi policy branch.
  // Ends at the Audi-policy branch; the ' else if (' tail is dropped so the slice closes cleanly.
  const block = span('  if (_lpInvConfirmedAvailable) {\n    // ── (v9.7.660)', 'the confirmation block',
    '\n  } else if (_audiAllAvail').replace(/ else if \(_audiAllAvail$/, '');
  return { name: path.basename(path.dirname(file)), src, clean, capture, block };
}

// ── THE FEED ────────────────────────────────────────────────────────────────
// Field spelling is the feed's own, as the sold-pivot diagnostic prints it:
// stock,vin,vehicle,year,make,model,condition,certified,class,body,color,odometer,daysOnLot,price
const LOT = [
  { stock: 'P4881', vehicle: '2026 Honda Civic Sport', color: 'Crystal Black Pearl' },
  { stock: 'P4886', vehicle: '2026 Honda Prelude Base', color: 'Winter Frost Pearl' },
  { stock: 'P4890', vehicle: '2026 Honda Prelude Base', color: 'Meteorite Gray Metallic' },
];

// Runs the SHIPPED capture against a feed.
function capture(impl, stockNum, units, opts) {
  const sb = {
    String,
    d: { dealerId: '6191', stockNum: stockNum },
    _lpValueFactCache: { '6191': { inv: { units: units } } },
    _lpInvConfirmedAvailable: false,
  };
  vm.createContext(sb);
  vm.runInContext(opts && opts.mutate ? opts.mutate(impl.capture) : impl.capture, sb);
  const u = vm.runInContext('_lpInvUnit', sb);
  return { found: vm.runInContext('_lpInvConfirmedAvailable', sb), unit: u, color: u ? u.color : null };
}

// Runs the SHIPPED directive block.
function block(impl, unit, said, opts) {
  const logs = [];
  const sb = {
    String,
    _lpInvConfirmedAvailable: true,
    _lpInvUnit: unit,
    Object,
    // `lead` is the CRM's own Color: field, which v9.7.660 proved is a different fact from the
    // paint on the car. Defaults to matching the unit, the ordinary case.
    d: { stockNum: 'P4886', color: (opts && 'lead' in opts) ? opts.lead : (unit ? unit.color : ''), customerStatedColor: said },
    vehicleExtras: [],
    console: { log: (...x) => logs.push(x.join(' ')) },
  };
  vm.createContext(sb);
  const body = opts && opts.mutate ? opts.mutate(impl.block) : impl.block;
  vm.runInContext(impl.clean + '\n' + body, sb);
  const lines = vm.runInContext('vehicleExtras', sb);
  return { lines: lines, text: lines.join('\n'), logs: logs.join(' ') };
}
const CONFIRM = /CONFIRMED IN TODAY.S LIVE INVENTORY LOAD/;
const PAINT   = /WHAT COLOUR THAT CONFIRMED UNIT ACTUALLY IS/;

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

console.log('\nv9.7.660 — the feed says what colour the car is');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);

// ── (1) THE CAPTURE ─────────────────────────────────────────────────────────
console.log('\n(1) the match keeps the unit, not just the answer:');

check('P4886 is found and its record survives',
  i => { const r = capture(i, 'P4886', LOT); return [r.found, r.color]; },
  [true, 'Winter Frost Pearl']);

check('the availability verdict is unchanged for a unit that is present',
  i => capture(i, 'P4890', LOT).found, true);
check('...and for one that is not',
  i => { const r = capture(i, 'NOPE1', LOT); return [r.found, r.unit]; }, [false, null]);
check('the stock match is still case-insensitive',
  i => capture(i, 'p4886', LOT).color, 'Winter Frost Pearl');
check('an empty feed finds nothing and cannot throw',
  i => capture(i, 'P4886', []).found, false);

// ── (2) VERSHIMA ────────────────────────────────────────────────────────────
console.log('\n(2) the lead that produced this build:');

const V = i => block(i, { color: 'Winter Frost Pearl' }, 'black');

check('the paint is stated as a fact', i => PAINT.test(V(i).text), true);
check('...naming the actual colour', i => /stock P4886 is Winter Frost Pearl/.test(V(i).text), true);
check('...and the colour he asked for', i => /This customer asked for black/.test(V(i).text), true);

// The defect was that one fact stood in for the other.
check('it says the lead-details colour is a different fact',
  i => /NOT the same fact as the "Color:" line in the lead details/.test(V(i).text), true);
check('...and that the two agreeing proves nothing',
  i => /the two agreeing proves nothing about what is on the lot/.test(V(i).text), true);

// The sentence he actually received, forbidden by name.
check('it forbids saying the car they want is here',
  i => /do NOT write that the car they want is here/.test(V(i).text), true);
check('it forbids the shipping-is-unnecessary move he received',
  i => /do NOT say that ordering it, shipping it or bringing one in is unnecessary because we have it/.test(V(i).text), true);
check('it forbids the in-stock line standing in for a colour confirmation',
  i => /do NOT let the in-stock confirmation above stand in for a confirmation of their colour/.test(V(i).text), true);

console.log('\n(3) the matching is left to the model, on purpose:');
check('it asks the model to judge the match rather than asserting one',
  i => /Work out for yourself whether Winter Frost Pearl IS black/.test(V(i).text), true);
check('it gives the reason a paint name usually answers it',
  i => /"Crystal Black Pearl" is black, "Platinum White Pearl" is white/.test(V(i).text), true);
// A colour table would call Winter Frost Pearl a non-match for white. It IS white.
check('no colour table ships with the block',
  i => /winterfrost|frost.*=.*white|COLOR_SYNONYMS|colou?rMap/i.test(i.block), false);
check('the block never decides the match itself',
  i => /indexOf\(\s*_lpSaidColor|_lpSaidColor\s*\)\s*===?\s*-1/.test(i.block), false);

console.log('\n(4) the colour half of the pivot ban is released, the availability half is not:');
check('a closer unit may be named when colour is the question',
  i => /if a unit on the SIMILAR VEHICLES list is closer to what they asked for you may name it/.test(V(i).text), true);
check('the ban now reads "a different unit on availability grounds"',
  i => /pivot to a different unit on availability grounds/.test(V(i).text), true);
check('...and no longer bans pivoting on colour',
  i => /alternate colors\/units on availability grounds/.test(V(i).text), false);
check('sold, moved and unavailable are still forbidden',
  i => /Do not say or imply it sold, moved, is no longer available/.test(V(i).text), true);

// ── (5) NOT ESCALATED WHEN NOTHING IS WRONG ─────────────────────────────────
// v9.7.613 established this discipline: shouting at the model on a lead where nothing is wrong is
// the risk a change like this introduces.
console.log('\n(5) silent where it has nothing to say:');

const SILENT = 'ok — the confirmation line alone, unchanged';
function silentCase(i, unit, said, opts) {
  const r = block(i, unit, said, opts);
  if (r.lines.length !== 1) return 'emitted ' + r.lines.length + ' line(s)';
  if (!CONFIRM.test(r.lines[0])) return 'the one line is not the confirmation';
  if (!/alternate colors\/units on availability grounds\.$/.test(r.lines[0])) return 'the wording changed';
  return SILENT;
}

// (v9.7.661) "No colour asked for" is NO LONGER silent — the settled branch below now speaks on
// that lead, deliberately. What stays silent is every case where the feed gives us no paint to
// state, plus the case where the lead colour and the feed colour disagree (section 8).
check('the feed carries no colour for this unit', i => silentCase(i, { color: '' }, 'black'), SILENT);
check('a factory colour CODE is not a colour', i => silentCase(i, { color: '08x8' }, 'black'), SILENT);
check('neither known', i => silentCase(i, {}, ''), SILENT);
check('a missing unit record cannot throw', i => silentCase(i, null, 'black'), SILENT);

console.log('\n(6) the diagnostic says which case it is:');
check('the asked-about-colour branch', i => /branch:asked-about-colour/.test(V(i).logs), true);
check('asked but no colour in the feed',
  i => /the feed carries none for this unit, so nothing is asserted either way/.test(block(i, { color: '' }, 'black').logs), true);
check('nothing in the feed at all',
  i => /branch:no unit colour/.test(block(i, { color: '' }, '').logs), true);
check('the lead colour is reported too, since the two can differ',
  i => /leadColor:Black/.test(block(i, { color: 'Winter Frost Pearl' }, 'black', { lead: 'Black' }).logs), true);

// ── (7) THE SCRAPER EXPORT ──────────────────────────────────────────────────
// The detector is v9.7.613's and is not re-implemented. What this build adds is that its answer
// leaves inlineScraper, since the inventory it must be compared against lives popup-side.
console.log('\n(7) the stated colour leaves the scraper:');
const SCRAPER = i => {
  const a = i.src.indexOf('\n  function inlineScraper() {');
  const b = i.src.indexOf('\n  } // end inlineScraper');
  return i.src.slice(a, b);
};
check('the export is inside inlineScraper, where the detector runs',
  i => /customerStatedColor:\s*\(typeof _statedColor === 'string'/.test(SCRAPER(i)), true);
check('it reads the shipped detector rather than a second one',
  i => (i.src.match(/var _statedColor = /g) || []).length, 1);
check('the popup reads the exported field',
  i => /d\.customerStatedColor/.test(i.block), true);

// ── (8) THE COLOUR NOBODY ASKED ABOUT ───────────────────────────────────────
// LIVE, 9/15. Sheldon Williamson picked a specific Accord Hybrid Touring off our website an hour
// earlier, stock TA055487 confirmed present, two outreaches already sent. The voicemail came back
// asking him to "confirm whether that color is the one you're looking for". Gil: "messaging is
// trying to confirm color rather than the push ahead."
console.log('\n(8) a confirmed colour is a detail, not a question (v9.7.661):');

const S = i => block(i, { color: 'Meteorite Gray Metallic' }, '');
const SETTLED = /THE COLOUR IS ALREADY SETTLED/;

check('the settled line is emitted alongside the confirmation',
  i => [S(i).lines.length, SETTLED.test(S(i).text)], [2, true]);
check('it names the paint',
  i => /the unit confirmed above is Meteorite Gray Metallic/.test(S(i).text), true);
check('it says nothing about the build is open',
  i => /None of it is an open question/.test(S(i).text), true);

// The move Sheldon received, forbidden by name.
check('it forbids asking whether that colour is the one they want',
  i => /Do NOT ask whether that colour is the one they want/.test(S(i).text), true);
check('it forbids asking them to confirm the trim or build',
  i => /do NOT ask them to confirm the trim or the build/.test(S(i).text), true);
check('it forbids making the specification the point of the message',
  i => /do NOT make confirming the specification the point of this message/.test(S(i).text), true);
check('it says why, in the terms the agent would',
  i => /reads as though we are not sure what they asked for/.test(S(i).text), true);

// A rule stated elsewhere loses to the line the model is reading — v9.7.496, .504, .507.
check('it overturns the qualify-on-colour suggestion out loud',
  i => /written for a unit we CANNOT confirm/.test(S(i).text), true);
check('...and points the new-angle requirement somewhere useful',
  i => /take one that moves them toward the visit/.test(S(i).text), true);
check('the colour is offered as a detail to use',
  i => /Use the colour as a DETAIL/.test(S(i).text), true);

console.log('\n(9) it says nothing when the colour is not actually settled:');
// The lead's Color: field is not always the paint. When they disagree, this build asserts nothing.
check('a disagreeing lead colour withholds the line',
  i => silentCase(i, { color: 'Winter Frost Pearl' }, '', { lead: 'Black' }), SILENT);
check('...and logs why, marked as observed rather than built',
  i => /The colour is NOT settled, so nothing is asserted either way — observed, deliberately not built/
        .test(block(i, { color: 'Winter Frost Pearl' }, '', { lead: 'Black' }).logs), true);
check('a lead with no colour at all is not a disagreement',
  i => SETTLED.test(block(i, { color: 'Meteorite Gray Metallic' }, '', { lead: '' }).text), true);
check('identical paint names agree even with no basic colour word in them',
  i => SETTLED.test(block(i, { color: 'Winter Frost Pearl' }, '', { lead: 'Winter Frost Pearl' }).text), true);
check('a shared colour word is enough when the names differ',
  i => SETTLED.test(block(i, { color: 'Modern Steel Metallic Gray' }, '', { lead: 'Gray' }).text), true);
check('the asked-about-colour branch still wins when they HAVE asked',
  i => [SETTLED.test(V(i).text), PAINT.test(V(i).text)], [false, true]);

// ── NON-VACUITY ─────────────────────────────────────────────────────────────
console.log('\nnon-vacuity (v9.7.660 and v9.7.661):');

// A: put back the boolean-only match and the paint has nothing to come from.
const DISCARD = c => c.replace(
  /if \(u\.stock && String\(u\.stock\)\.toUpperCase\(\) === String\(d\.stockNum\)\.toUpperCase\(\)\) \{ _lpInvUnit = u; return true; \}/,
  'if (u.stock && String(u.stock).toUpperCase() === String(d.stockNum).toUpperCase()) { return true; }');
check('neuter A actually discards the unit', i => DISCARD(i.capture) !== i.capture, true);
check('A: the match still succeeds but the record is gone',
  i => { const r = capture(i, 'P4886', LOT, { mutate: DISCARD }); return [r.found, r.unit]; }, [false, null]);
check('A (control): the shipped capture keeps it',
  i => capture(i, 'P4886', LOT).color, 'Winter Frost Pearl');

// B: with no unit colour the prompt returns to exactly what Vershima's carried.
check('B: no paint stated, and the pivot ban covers colour again',
  i => { const r = block(i, null, 'black');
         return [r.lines.length, /alternate colors\/units on availability grounds/.test(r.text), PAINT.test(r.text)]; },
  [1, true, false]);
check('B (control): with the unit in hand both flip',
  i => { const r = V(i);
         return [r.lines.length, /alternate colors\/units on availability grounds/.test(r.text), PAINT.test(r.text)]; },
  [2, false, true]);

// C: drop the settled branch and Sheldon's prompt says nothing about whether the colour is open.
const NO_SETTLED = c => c.replace(/\} else if \(_lpStockColor\) \{/, '} else if (false) {');
check('neuter C actually removed the settled branch', i => NO_SETTLED(i.block) !== i.block, true);
check('C: the prompt goes quiet on a colour that is not in question',
  i => { const r = block(i, { color: 'Meteorite Gray Metallic' }, '', { mutate: NO_SETTLED });
         return [r.lines.length, SETTLED.test(r.text)]; },
  [1, false]);
check('C (control): the shipped block speaks',
  i => [S(i).lines.length, SETTLED.test(S(i).text)], [2, true]);

// D: the agreement gate is what keeps it off an unsettled lead.
const NO_GATE = c => c.replace('if (_lcSame) {', 'if (true) {');
check('neuter D actually removed the agreement gate', i => NO_GATE(i.block) !== i.block, true);
check('D: without it, a lead recording black is told the colour is settled at Winter Frost Pearl',
  i => SETTLED.test(block(i, { color: 'Winter Frost Pearl' }, '', { lead: 'Black', mutate: NO_GATE }).text), true);
check('D (control): the shipped gate withholds it',
  i => SETTLED.test(block(i, { color: 'Winter Frost Pearl' }, '', { lead: 'Black' }).text), false);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
