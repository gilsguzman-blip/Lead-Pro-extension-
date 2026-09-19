#!/usr/bin/env node
'use strict';
// (v9.7.631) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('fact-arbitration.test.js');

/**
 * fact-arbitration.test.js — v9.7.631. WHEN TWO OF OUR OWN DIRECTIVES DISAGREE ABOUT A FACT.
 *
 * LIVE, and it is Bobby Terrazas again (Toyota Baytown, 2018 Ford Expedition, 9/4). His
 * [LP SOLD SCAN DIAG] reads vehicleSold:true with authoritativeMarker:true — the unit is genuinely
 * gone, established from the inventory snapshot, not from prose. So his prompt carried:
 *
 *     🔴 VEHICLE STATUS: SOLD — this specific unit is no longer available.
 *     - CONTEXT: Customer is interested in the 2018 Ford Expedition. Confirm it is available
 *       and encourage the soonest workable time so the trip is worth it.
 *
 * One prompt, one car, opposite instructions — and the second is the more actionable, because it
 * names a next step. On a DISTANCE lead the cost is not an awkward sentence: it is a customer
 * driving 30-60+ minutes to see a car we have already sold.
 *
 * WHY v9.7.627's RULE COULD NOT ARBITRATE IT. That rule ranks the customer's MESSAGES above our
 * readings of them, and explicitly EXEMPTS live inventory and stock status as facts the thread
 * cannot overrule. Both directives here are ours, and both are about that exempt fact. Neither
 * paragraph reaches the case.
 *
 * THE PRINCIPLE THIS BUILD ADDS: the directive that OWNS a fact beats the one that merely ASSUMES
 * it. VEHICLE STATUS is computed from the inventory cache, PageData status, the inventory warning
 * and what an agent already told the customer. The distance block does not determine availability
 * at all — it assumes it on the way to asking for a visit. An assumption is not evidence.
 *
 * AND THE SPLIT IS THE v9.7.611 SPLIT, deliberately: the clause that collides yields, the half
 * that does not is untouched. A distance buyer must never feel they might drive far for nothing,
 * sold unit or not — so the justification requirement SURVIVES and is merely re-anchored.
 *
 * Executes the SHIPPED distance block. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: fact-arbitration.test.js <popup.js> [popup.js...]'); process.exit(2); }

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const bail = (m) => require('./lib/fatal-guard.js').bail('fact-arbitration.test.js', m);

function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf("  if (flags.includes('distance')) {");
  if (a < 0) bail('distance block not in ' + file);
  const b = src.indexOf("  if (flags.includes('loyalty')) {", a);
  if (b < 0) bail('distance block end not found in ' + file);
  const block = src.slice(a, b);
  if (block.indexOf('_dbSoldUnit') < 0) bail('distance block carries no arbitration in ' + file);

  const logs = [];
  const sb = { String, RegExp, parseFloat, console: { log: (...x) => logs.push(x.map(String).join(' ')) } };
  vm.createContext(sb);
  // The block reads `flags`, `data`, `sc`, `lines`, and three vars set upstream. Supplied as
  // parameters so every run is explicit about what it was given.
  vm.runInContext(
    'function _distance(data, sc, opts){\n'
    + '  var lines = [];\n'
    + '  var flags = { includes: function(f){ return (opts.flags || []).indexOf(f) !== -1; } };\n'
    + '  var _bpLocalVeto = !!opts.localVeto, _geoOutOfState = !!opts.outOfState, _inStateFar = !!opts.inStateFar;\n'
    + '  var _hasCustomerReplied = function(){ return !!opts.replied; };\n'
    // Supplied as a controlled INPUT, not a stub that guesses at production behaviour — the
    // v9.7.616 lesson, where a stub more generous than the shipped code passed an assertion the
    // real code would have failed. It defaults to '' and every remote case below is driven by the
    // geo flag instead, so this can never be what makes an assertion pass.
    + '  var _lpCustomerText = function(){ return opts.customerText || ""; };\n'
    + block
    + '\n  return lines.filter(function(l){ return l !== undefined && l !== ""; }).join("\\n"); }', sb);

  return { src, logs, distance: vm.runInContext('_distance', sb) };
}

const VEHICLE = '2018 Ford Expedition Platinum';
const run = (B, sold, opts) => B.distance(
  { vehicle: VEHICLE, leadAgeDays: 0, activeFlags: [] },
  { vehicleSold: sold },
  Object.assign({ flags: ['distance'] }, opts || {}));

for (const file of BUILDS) {
  const B = load(file);
  console.log('\n' + path.relative(process.cwd(), file) + ' — the directive that owns the fact wins');

  // ── BOBBY'S PROMPT, BEFORE AND AFTER ───────────────────────────────────────
  console.log("\nBobby's lead — sold unit, distance flag:");
  B.logs.length = 0;
  const sold = run(B, true);
  check('the availability claim is gone', /Confirm it is available/.test(sold), false);
  check('...and so is the trip push that depended on it',
    /encourage the soonest workable time/.test(sold), false);
  check('the model is told the unit is sold', /is SOLD/.test(sold), true);
  check('...and pointed at the directive that owns the fact',
    /see VEHICLE STATUS above, which is the authoritative reading of stock/.test(sold), true);
  check('it must not imply availability', /Do NOT say or imply it is available/.test(sold), true);
  check('...and must not ask them to drive in for it', /do NOT ask them to come in for it/.test(sold), true);
  check('a confirmed alternative comes before any timing',
    /name a comparable unit you can actually confirm FIRST/.test(sold), true);
  check('the distance fact still shapes the message',
    /a wasted drive costs them more than most/.test(sold), true);

  console.log('\nthe same lead with the unit in stock is untouched:');
  const avail = run(B, false);
  check('the original context line is intact',
    /Customer is interested in the 2018 Ford Expedition Platinum\. Confirm it is available and encourage the soonest workable time/.test(avail), true);
  check('...including the do-not-hold clause',
    /do NOT promise to hold or set aside an in-stock unit/.test(avail), true);
  check('...and the in-transit clause', /securing it before arrival is appropriate/.test(avail), true);
  check('no sold language leaks onto an available unit', /is SOLD/.test(avail), false);

  // ── THE HALF THAT MUST SURVIVE ─────────────────────────────────────────────
  // v9.7.611's split. The justification is the whole point of the distance treatment.
  console.log('\nthe justification requirement survives a sold unit — re-anchored, not dropped:');
  check('it is still REQUIRED in every format', /REQUIRED in EVERY format/.test(sold), true);
  check('...and now names where it must be anchored',
    /anchored on a CONFIRMED alternative, never on the sold unit/.test(sold), true);
  check('the SMS sentence is still MANDATORY', /MANDATORY/.test(sold), true);
  check('...but no longer promises this car is waiting',
    /I will have everything ready when you arrive/.test(sold), false);
  check('...and offers a line that is actually true',
    /I have a comparable one on the ground I can get ready for you/.test(sold), true);
  check('the never-drive-far-for-nothing rule is untouched',
    /Never make the distance buyer feel like they might drive far for nothing/.test(sold), true);
  check('the no-casual-ask rule is untouched',
    /NEVER say "stop by", "swing by", or "come see us"/.test(sold), true);
  check('efficiency and trade-value examples are untouched — they never named the car',
    /pre-fill most of the paperwork/.test(sold) && /trade-in numbers ready/.test(sold), true);

  console.log('\n...and on an available unit those same lines are exactly as v9.7.630 wrote them:');
  check('the vehicle-confirmation example is intact',
    /I will have everything ready when you arrive — you will not be waiting/.test(avail), true);
  check('...with its stock caveat', /Only promise the vehicle itself is ready to see if its stock is confirmed/.test(avail), true);
  check('no confirmed-alternative language appears', /Confirmed alternative/.test(avail), false);

  // ── THE REMOTE BRANCH GETS THE SAME CORRECTION ─────────────────────────────
  // distanceContext is emitted by BOTH branches. A remote buyer is not being asked to drive, but
  // "confirm it is available" is still a false statement about a car we sold.
  console.log('\nthe remote/out-of-state branch carries the correction too:');
  const remoteSold = run(B, true, { outOfState: true });
  check('it took the remote branch', /REMOTE \/ OUT-OF-STATE BUYER/.test(remoteSold), true);
  check('...and still drops the availability claim', /Confirm it is available/.test(remoteSold), false);
  check('...and still says the unit is sold', /is SOLD/.test(remoteSold), true);
  const remoteAvail = run(B, false, { outOfState: true });
  check('an available remote lead is unchanged', /Confirm it is available/.test(remoteAvail), true);

  // ── THE CREDIT BRANCH TAKES PRECEDENCE, AS IT ALWAYS DID ───────────────────
  // Scope discipline: this build did not touch the credit branch, and must not have.
  console.log('\nthe credit branch is untouched in both states:');
  const creditSold = run(B, true, { flags: ['distance', 'credit'] });
  check('credit + distance still wins the branch',
    /credit sensitivity AND is a distance buyer/.test(creditSold), true);
  check('...and no sold context is injected there', /is SOLD/.test(creditSold), false);

  // ── OBSERVABILITY ──────────────────────────────────────────────────────────
  console.log('\nthe arbitration says what it did, either way:');
  B.logs.length = 0; run(B, true);
  check('a resolved conflict is reported',
    /DISTANCE FACT ARBITRATION.*vehicleSold:true/.test(B.logs.join('|')), true);
  check('...naming which directive owns the fact',
    /VEHICLE STATUS owns availability and says SOLD/.test(B.logs.join('|')), true);
  B.logs.length = 0; run(B, false);
  check('a lead with no conflict says so rather than going silent',
    /no conflict; the distance block asks for the visit as normal/.test(B.logs.join('|')), true);

  // ── IT READS THE AUTHORITATIVE FLAG, IT DOES NOT RECOMPUTE IT ──────────────
  // Recomputing would let this drift from the directive it is deferring to — and sc.vehicleSold
  // already folds in the Audi all-available policy, loyalty leads and the in-transit override.
  console.log('\nit defers to sc.vehicleSold rather than deriving its own verdict:');
  check('the verdict is read from sc', /var _dbSoldUnit = !!\(sc && sc\.vehicleSold\);/.test(B.src), true);
  check('...and no second sold regex was added to this block',
    /_dbSoldUnit = .*(?:test\(|indexOf\()/.test(B.src), false);
  // The exemptions it therefore inherits, asserted at their source so a future change is visible.
  check('sc.vehicleSold still exempts the Audi all-available policy', /!_audiAllAvail/.test(B.src), true);
  check('...loyalty and lease-maturity leads', /!s\.isLoyalty && !_isLeaseMatureEarly/.test(B.src), true);
  check('...in-transit units and the inventory-cache override',
    /!_inTransitNow && !data\._lpInvConfirmedAvailable/.test(B.src), true);
  check('a missing sc does not throw', typeof B.distance({ vehicle: 'x' }, null, { flags: ['distance'] }), 'string');
  check('...and falls back to the available wording',
    /Confirm it is available/.test(B.distance({ vehicle: 'x' }, null, { flags: ['distance'] })), true);
  check('the diagnostic is wrapped', /catch \(eDbF\) \{\}/.test(B.src), true);

  // ── THE RULE IN THE PROMPT ─────────────────────────────────────────────────
  console.log('\nthe general rule is stated where the v9.7.627 rule already lives:');
  check('it names the fact-owner principle',
    /WHEN TWO OF OUR OWN DIRECTIVES DISAGREE ABOUT ONE OF THOSE FACTS, the one that OWNS the/.test(B.src), true);
  check('...and names the owners by name',
    /VEHICLE STATUS, PRESENCE LANGUAGE, the inventory lines or the calendar/.test(B.src), true);
  check('...says an assumption is not evidence',
    /merely assumes a fact on its way to telling you to do something else is not evidence/.test(B.src), true);
  check('...forbids resolving by emphasis',
    /Never settle a factual disagreement by picking/.test(B.src), true);
  check('...and forbids hedging the two together', /never average them into a hedge/.test(B.src), true);
  // It must EXTEND the messages rule, not replace it.
  // MEASURED ON CODE, NOT ON PROSE. These three phrases also appear in the build header at the top
  // of the file, which is a comment — so an ordering check against the raw source found the
  // HEADER's copy first and reported the rule as preceding a paragraph it actually follows. The
  // v9.7.563 lesson exactly: a comment naming a symbol failed a check that claims to measure code.
  // Line comments are stripped before the positions are taken.
  const code = B.src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const iMsg = code.indexOf('THE MESSAGES ARE THE RECORD');
  const iFact = code.indexOf('WHEN TWO OF OUR OWN DIRECTIVES DISAGREE');
  const iExempt = code.indexOf('does NOT govern facts you cannot see in the thread');
  check('all three paragraphs are present in executable code',
    iMsg > -1 && iFact > -1 && iExempt > -1, true);
  check('the messages rule still comes first', iFact > iMsg, true);
  check('...and the outside-facts exemption still sits between them',
    iExempt > iMsg && iExempt < iFact, true);
}

if (BUILDS.length > 1) {
  console.log('\nboth builds arbitrate identically:');
  const region = (f, o, c) => {
    const s = fs.readFileSync(f, 'utf8');
    const a = s.indexOf(o), b = s.indexOf(c, a);
    if (a < 0 || b < 0) bail('parity region not found in ' + f);
    return s.slice(a, b);
  };
  check('the distance block is identical',
    region(BUILDS[0], "  if (flags.includes('distance')) {", "  if (flags.includes('loyalty')) {")
    === region(BUILDS[1], "  if (flags.includes('distance')) {", "  if (flags.includes('loyalty')) {"), true);
  check('the precedence rule is identical',
    region(BUILDS[0], "'overrule them.',", 'return _out.join')
    === region(BUILDS[1], "'overrule them.',", 'return _out.join'), true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
