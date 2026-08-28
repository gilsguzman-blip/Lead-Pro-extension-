#!/usr/bin/env node
'use strict';
/**
 * off-franchise.test.js — v9.7.555.
 *
 * NOTE ON PROVENANCE: the v9.7.483 changelog records "VERIFIED 21/21" for this guard, but that
 * harness was a one-off and never landed in tests/. There was no committed off-franchise suite
 * before this file. The cases below reconstruct that coverage from the incidents the changelog
 * names (Halie Bott, Monique Meaux) and add the v9.7.555 regressions on top.
 *
 * LIVE INCIDENT — Hayden N, Community Honda Lafayette, dealerId 24399, lead 2070578764, 8/20.
 * A CarGurus PHONE lead. No chat transcript. No Ram in the call notes, the agent notes, the
 * panel, or anywhere else on the record. Lead Pro asked him twice:
 *
 *     "Are you calling about the Civic, or were you specifically looking for a Ram?"
 *
 * log118 lines 1278 and 1477: [LP OFF-FRANCHISE DIAG] "ram" (make ram) vs honda store.
 *
 * TWO INDEPENDENT DEFECTS STACKED, and either one alone is sufficient to produce it:
 *
 *  1. _lpCustomerText prepended d.lastInboundMsg as customer speech with no gate at all, unlike
 *     every other source it reads (which requires a real [CUSTOMER] tag). On a phone lead with
 *     no transcript, lastInboundMsg is the provider's call record, not words a person said.
 *     Hayden's, verbatim: "Phone Lead from CarGurus. Caller Id: None, Duration: 6 minutes,
 *     51 seconds Likelihood to buy: Standard Timeframe: 2 weeks. Show Less"
 *
 *  2. _lpChatVehicleCandidates built its make alternation with no \b on either side, so "ram"
 *     matched inside "Timef(ram)e". Same defect class as _lpCmdTermHit in v9.7.554, where "poi"
 *     matched inside "appointment".
 *
 * Both are fixed, and the suite asserts EACH ONE ALONE stops the incident — a layered fix is
 * only worth the name if each layer is load-bearing on its own.
 *
 * Every block is sliced out of the SHIPPED popup.js of each build. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2);
if (!BUILDS.length) { console.error('usage: off-franchise.test.js <popup.js> [popup.js...]'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');

  // Make map + candidate scanner, as shipped.
  const ca = src.indexOf('var _LP_STORE_BRAND =');
  const cb = src.indexOf('// (v9.7.236) Customer-name sanity guard');
  if (ca < 0 || cb < 0 || cb <= ca) throw new Error('could not locate the make helpers in ' + file);

  // Metadata gate + _lpCustomerText, as shipped.
  const ma = src.indexOf('// (v9.7.555) IS THIS A PROVIDER METADATA BLOB');
  const mb = src.indexOf("// ── (v9.7.552) LEAD PRO'S OWN SCAFFOLD");
  if (ma < 0 || mb < 0 || mb <= ma) throw new Error('could not locate _lpCustomerText in ' + file);

  // The off-franchise guard itself.
  const ga = src.indexOf('    var _ofBrand = _LP_STORE_BRAND[String(d.dealerId)]');
  const gb = src.indexOf('  } catch (eOf) {}', ga);
  if (ga < 0 || gb < 0 || gb <= ga) throw new Error('could not locate the off-franchise guard in ' + file);

  const logs = [];
  const sandbox = { console: { log: (...a) => logs.push(a.join(' ')) } };
  vm.createContext(sandbox);
  vm.runInContext(src.slice(ca, cb), sandbox);
  vm.runInContext(src.slice(ma, mb), sandbox);

  const cand = vm.runInContext('(function(t){ return _lpChatVehicleCandidates(t); })', sandbox);
  const meta = vm.runInContext('(function(s){ return _lpIsSystemMetadataLine(s); })', sandbox);
  const custText = vm.runInContext(
    '(function(d){ _lpCustTextLastRejected = ""; return _lpCustomerText(d); })', sandbox);
  // Non-resetting, so the once-per-distinct-string dedupe is actually observable.
  const custTextRaw = vm.runInContext('(function(d){ return _lpCustomerText(d); })', sandbox);
  const resetDedupe = vm.runInContext('(function(){ _lpCustTextLastRejected = ""; })', sandbox);

  // The guard reads d, _lpValueFactCache and pushes onto vehicleExtras. Supply exactly that.
  const guard = vm.runInContext(
    '(function(d, cache){\n' +
    '  var vehicleExtras = [];\n' +
    '  var _lpValueFactCache = cache || {};\n' +
    '  _lpCustTextLastRejected = "";\n' +
    '  try {\n' + src.slice(ga, gb) + '  } catch (eOf) {}\n' +
    '  return vehicleExtras; })', sandbox);

  return {
    name: path.basename(path.dirname(file)),
    cand, meta, custText,
    dedupeProbe: (msg, times) => {
      logs.length = 0; resetDedupe();
      for (let n = 0; n < times; n++) custTextRaw({ lastInboundMsg: msg });
      return logs.filter(x => /CUSTOMER-TEXT DIAG/.test(x)).length;
    },
    guard: (d, cache) => { logs.length = 0; const out = guard(d, cache); return { extras: out, logs: logs.slice() }; }
  };
}

// (v9.7.597) Extraction failure is a REPORTED failure, not a fatal one — see
// tests/lib/guarded-impls.js. Pointed at a build that predates the code under test,
// this suite now runs every assertion and fails loudly instead of printing nothing.
const guardedImpls = require('./lib/guarded-impls.js');
const impls = guardedImpls(BUILDS, extract);
let pass = 0, fail = 0;

function check(name, fn, want) {
  const results = impls.map(i => { try { return JSON.stringify(fn(i)); } catch (e) { return 'THREW: ' + e.message; } });
  const agree = results.every(r => r === results[0]);
  const ok = agree && results[0] === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; console.log('  FAIL ' + name);
    if (!agree) impls.forEach((i, n) => console.log('        ' + i.name + ' -> ' + results[n]));
    else console.log('        expected ' + JSON.stringify(want) + '\n        got      ' + results[0]);
  }
}

const fires = r => r.extras.some(e => /OFF-FRANCHISE REQUEST/.test(e));

// ── The real captures ──────────────────────────────────────────────────────────
// Hayden's lastInboundMsg, byte for byte out of the delivered prompt (line 326) and log118.
const HAYDEN_META = 'Phone Lead from CarGurus. Caller Id: None, Duration: 6 minutes, 51 seconds '
  + 'Likelihood to buy: Standard Timeframe: 2 weeks. Show Less';
// Halie Bott's own inbound text, verbatim from the v9.7.483 changelog.
const HALIE = 'we are planning to purchase a new chevy silverado in a couple weeks. Do you have any in dark red?';
// Monique Meaux, same rooftop, per the v9.7.483 changelog.
const MONIQUE = 'ready to move on a 2022+ Ford F-150 XLT';

const HONDA_LAF = 24399;

// THE LIVE CACHE SHAPE, and it matters. log118 reports "inStockOfMake:0", which means the
// inventory cache WAS loaded — that is what made the guard fire, via the
// `_ofSaidNew || (_ofUnits && _ofMatch.length === 0)` branch. Running these cases with an EMPTY
// cache would make them pass without any fix at all, because a missing cache suppresses the
// guard on its own. Every Hayden case below uses this loaded, Ram-free cache so the assertion
// is load-bearing. Confirmed against the previous build: with this cache the v9.7.554 bytes emit
// [LP OFF-FRANCHISE DIAG] "ram" (make ram) vs honda store | saidNew:false | inStockOfMake:0 —
// byte-identical to log118 line 1278.
const HONDA_INV = { 24399: { inv: { units: [
  { make: 'Honda', model: 'Civic', year: 2026, stock: 'TH356197' },
  { make: 'Honda', model: 'CR-V',  year: 2026, stock: 'TH1' }
] } } };

console.log('\nv9.7.555 — a call-metadata line is not customer speech, and "ram" is not in "timeframe"');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

console.log('Hayden N — the live incident, his REAL lastInboundMsg:');

check('the string is recognised as provider call metadata',
  i => i.meta(HAYDEN_META), true);

check('_lpCustomerText refuses it — nothing of it reaches any consumer',
  i => i.custText({ lastInboundMsg: HAYDEN_META, leadSource: 'CarGurus (Phone)' }).trim(), '');

check('the refusal is logged, naming the source and the value',
  i => {
    const l = [];
    const r = i.guard({ dealerId: HONDA_LAF, lastInboundMsg: HAYDEN_META, leadSource: 'CarGurus (Phone)' }, HONDA_INV);
    return r.logs.some(x => /CUSTOMER-TEXT DIAG.*REFUSED as customer speech/.test(x))
        && r.logs.some(x => /Phone Lead from CarGurus/.test(x));
  }, true);

check('the string yields zero vehicle candidates',
  i => i.cand(HAYDEN_META), []);

check('the off-franchise guard stays silent — no Ram directive',
  i => fires(i.guard({ dealerId: HONDA_LAF, lastInboundMsg: HAYDEN_META, leadSource: 'CarGurus (Phone)' }, HONDA_INV)),
  false);

check('and it emits no [LP OFF-FRANCHISE DIAG] line at all',
  i => i.guard({ dealerId: HONDA_LAF, lastInboundMsg: HAYDEN_META }, HONDA_INV).logs
        .some(x => /OFF-FRANCHISE DIAG/.test(x)),
  false);

// THE ANTI-VACUITY CONTROL. Same rooftop, same loaded cache, same guard — the ONLY difference
// is that this text is something a person actually said. It must fire, which proves the two
// assertions above are silence caused by the fix and not by the fixture.
check('CONTROL — the same cache and rooftop DO fire on real prose naming a Ram',
  i => i.guard({ dealerId: HONDA_LAF, lastInboundMsg: 'do you have a Ram 1500' }, HONDA_INV).logs
        .filter(x => /OFF-FRANCHISE DIAG/.test(x)).length,
  1);

// ── Each layer alone must stop it ──────────────────────────────────────────────
console.log('\neach fix alone is load-bearing — neither is decoration:');

check('layer 2 alone: even if the metadata reached the scanner, "ram" no longer matches',
  i => i.cand(' ' + HAYDEN_META + ' '), []);

check('layer 1 alone: even if "ram" still matched, the metadata never reaches the scanner',
  i => i.custText({ lastInboundMsg: HAYDEN_META }).indexOf('Timeframe'), -1);

// ── The genuine cases must still fire ──────────────────────────────────────────
console.log('\ngenuine off-brand requests in real customer text still fire:');

check('Halie Bott — "a new chevy silverado" at a Honda rooftop',
  i => fires(i.guard({ dealerId: HONDA_LAF, lastInboundMsg: HALIE }, {})), true);

check('Halie — the directive names the make correctly (chevy normalised to Chevrolet)',
  i => /franchise: we CANNOT sell, order, locate, or dealer-trade for a new Chevrolet/
        .test(i.guard({ dealerId: HONDA_LAF, lastInboundMsg: HALIE }, {}).extras.join(' ')),
  true);

check('Halie — saidNew is detected, so it fires on structural certainty with no inventory cache',
  i => i.guard({ dealerId: HONDA_LAF, lastInboundMsg: HALIE }, {}).logs
        .filter(x => /OFF-FRANCHISE DIAG/.test(x)).map(x => /saidNew:true/.test(x)),
  [true]);

check('Halie — her own Dodge Durango trade is NOT what trips it',
  i => i.guard({ dealerId: HONDA_LAF, lastInboundMsg: HALIE,
                 tradeDescription: '2019 Dodge Durango GT Plus, 87,360 mi' }, {}).logs
        .filter(x => /OFF-FRANCHISE DIAG/.test(x)).map(x => /make chevrolet/.test(x)),
  [true]);

check('Monique Meaux — "a 2022+ Ford F-150 XLT" still produces the candidate',
  i => i.cand(MONIQUE), ['Ford F-150 XLT']);

check('a genuine Ram request in real prose still fires',
  i => fires(i.guard({ dealerId: HONDA_LAF, lastInboundMsg: 'I want a new Ram 1500 Laramie, do you have any?' }, {})),
  true);

check('a genuine Ram request survives even beside the word that caused the bug',
  i => i.cand('my timeframe is 2 weeks and I want a Ram 1500'), ['Ram 1500']);

// ── Precision guards that must be unchanged ────────────────────────────────────
console.log('\nthe existing precision guards are untouched:');

check('the house brand never fires — a Honda request at a Honda store',
  i => fires(i.guard({ dealerId: HONDA_LAF, lastInboundMsg: 'looking at a new Honda Pilot' }, HONDA_INV)), false);

check('their own trade alone never fires',
  i => fires(i.guard({ dealerId: HONDA_LAF, lastInboundMsg: 'I have a Dodge Durango to trade',
                       tradeDescription: '2019 Dodge Durango GT Plus' }, HONDA_INV)), false);

check('an agent note cannot trigger it — customer words only',
  i => fires(i.guard({ dealerId: HONDA_LAF, lastInboundMsg: '',
                       context: '[08/20/2026] [NOTE] General Note\n  By: Roslynn wants a new Ram 1500' }, HONDA_INV)),
  false);

check('an off-brand unit genuinely IN stock stays silent when they did not say NEW',
  i => fires(i.guard({ dealerId: HONDA_LAF, lastInboundMsg: 'do you have a Lexus RX' },
                     { 24399: { inv: { units: [{ make: 'Lexus', model: 'RX', year: 2021, stock: 'A1' }] } } })),
  false);

check('...but explicit NEW fires even with a used one on the lot, and surfaces the real unit',
  i => {
    const r = i.guard({ dealerId: HONDA_LAF, lastInboundMsg: 'I want a new Lexus RX' },
                      { 24399: { inv: { units: [{ make: 'Lexus', model: 'RX', year: 2021, stock: 'A1' }] } } });
    return fires(r) && /1 used Lexus unit\(s\) in stock/.test(r.extras.join(' '));
  }, true);

check('an unknown rooftop has no franchise and never fires',
  i => fires(i.guard({ dealerId: 99999, lastInboundMsg: HALIE }, {})), false);

check('a Kia rooftop fires on a Honda request',
  i => fires(i.guard({ dealerId: 6190, lastInboundMsg: 'looking for a new Honda Pilot' }, {})), true);

// ── The boundary rule, isolated ────────────────────────────────────────────────
console.log('\nmake tokens no longer hide inside ordinary words:');

const trap = [
  ['timeframe', 'our timeframe is short'],
  ['programs',  'ask about our finance programs'],
  ['dramatic',  'nothing dramatic here'],
  ['Kiawah',    'we visited Kiawah Island last summer'],
  ['minivan',   'do you have any minivans'],
  ['benzene',   'a benzene smell in the cabin'],
];
trap.forEach(([word, sentence]) =>
  check('"' + word + '" produces no candidate', i => i.cand(sentence), []));

const real = [
  ['Ram 1500',        'I want a Ram 1500'],
  ['Kia Telluride',   'looking at a Kia Telluride'],
  ['GMC Sierra',      'how about a GMC Sierra'],
  ['Honda Civic Sport', 'a 2026 Honda Civic Sport'],
  ['Mini Cooper',     'a Mini Cooper please'],
];
real.forEach(([want, sentence]) =>
  check('"' + want + '" still matches at a real word start', i => i.cand(sentence), [want]));

// ── The metadata gate, isolated ────────────────────────────────────────────────
console.log('\nthe metadata gate is shape-based, so the next provider is covered too:');

check('an unseen provider\'s "Phone Lead from" blob is refused',
  i => i.meta('Phone Lead from SomeNewVendor. Caller Id: None'), true);
check('two call-record labels alone are enough',
  i => i.meta('Caller Id: 555-1212, Duration: 2 minutes'), true);
check('ONE label is not enough — the bar is deliberately two',
  i => i.meta('Duration: 3 minutes'), false);
check('a real sentence containing "duration" is not metadata',
  i => i.meta('I called about the duration of the warranty'), false);
check('a CarGurus canned inquiry is not metadata',
  i => i.meta('Is this still available?'), false);
check('Halie\'s real inbound is not metadata',
  i => i.meta(HALIE), false);
check('empty is not metadata',
  i => i.meta(''), false);
check('a customer using the word "timeframe" is not metadata and keeps their text',
  i => i.custText({ lastInboundMsg: 'my timeframe is 2 weeks and I want a Ram 1500' }).trim(),
  'my timeframe is 2 weeks and I want a Ram 1500');

// _lpCustomerText runs five times per generation; the log must not run five times with it.
check('five calls with the same rejected string log exactly once',
  i => i.dedupeProbe(HAYDEN_META, 5), 1);

check('a call with clean text logs nothing at all',
  i => i.dedupeProbe('I want a Ram 1500', 5), 0);

// ── (v9.7.576) THE GATE — A FRANCHISE CONSTRAINT IS ABOUT NEW CARS ─────────────────────────
// 8/24 produced two DISAGREE-COMPREHENSION-ONLY rows and BOTH were false positives where the
// regex was correctly silent. Both were USED cars sitting in the store's own inventory:
//   • lead 2049868669, Audi Lafayette — "Is your Used 2025 Hyundai Sonata SEL listed for
//     $23,448.00 still available?"  Asking about OUR listed unit, at OUR price.
//   • lead 2072414751, Honda Baytown — VOI is a 2024 BMW 4 Series M440i xDrive (Pre-Owned),
//     confirmed in stock, Stock #TA035651A.
// A Honda store cannot sell a NEW BMW; it sells used ones off its own lot constantly.
//
// A VOI-MAKE COMPARISON WOULD HAVE FIXED ONLY ONE OF THEM. The Hyundai lead carries NO VOI at all
// — [LP VOI DIAG] parsed:"" on every frame — so the gate must be inventory-and-condition aware.
const _devSrc  = fs.readFileSync(BUILDS[0], 'utf8');
const _devCode = _devSrc.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');

const _gateBox = (() => {
  const a  = _devSrc.indexOf('function _lpOffFranchiseGate');
  const nb = _devSrc.indexOf('function _lpNormMake');
  const nm = _devSrc.slice(nb, _devSrc.indexOf('\n}', nb) + 2);
  // _LP_MAKE_ALIAS must be in scope: _lpNormMake reads it, and without it the gate's own
  // try/catch swallows the ReferenceError into fires:false — a harness gap that reads
  // exactly like the feature working.
  const sb = { console: { log() {} }, String, RegExp, Object, Array, Math,
               _LP_MAKE_ALIAS: { chevy:'chevrolet', vw:'volkswagen', benz:'mercedes', 'mercedes-benz':'mercedes' },
               _lpValueFactCache: {} };
  vm.createContext(sb);
  vm.runInContext(nm + '\n' + _devSrc.slice(a, nb), sb);
  return sb;
})();
function gate(make, text, units) {
  _gateBox._lpValueFactCache = (units === null) ? {} : { '99': { inv: { units: units } } };
  return vm.runInContext('_lpOffFranchiseGate', _gateBox)(make, text, '99', _gateBox._lpValueFactCache);
}
function one(name, fn, want) {
  let got; try { got = JSON.stringify(fn()); } catch (e) { got = 'THREW: ' + e.message; }
  if (got === JSON.stringify(want)) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + JSON.stringify(want) + '\n        got      ' + got); }
}

const HONDA_LOT = [{ make: 'BMW', model: '4 Series', year: 2024, stock: 'TA035651A' },
                   { make: 'Honda', model: 'Accord', year: 2025 }];
const AUDI_LOT  = [{ make: 'Hyundai', model: 'Sonata', year: 2025 },
                   { make: 'Audi', model: 'Q5', year: 2024 }];

console.log("\nv9.7.576 — the gate, driven from 8/24's two false positives:");

one('CASEY (8/24): a used BMW that is ON the Honda lot does NOT fire',
  () => { const g = gate('BMW', 'Is the 2024 BMW 4 Series M440i xDrive still available?', HONDA_LOT);
          return { fires: g.fires, units: g.units.length }; }, { fires: false, units: 1 });

one('LOLITA (8/24): a used Hyundai ON the Audi lot does NOT fire — and that lead has NO VOI',
  () => gate('Hyundai', 'Is your Used 2025 Hyundai Sonata SEL listed for $23,448.00 still available?',
             AUDI_LOT).fires, false);

one('THE CASE IT MUST STILL CATCH: a NEW off-brand ask fires even when we hold used ones',
  () => { const g = gate('BMW', 'do you have a new BMW 4 Series?', HONDA_LOT);
          return { fires: g.fires, saidNew: g.saidNew }; }, { fires: true, saidNew: true });

one('the Gladiator shape still fires — an off-brand we hold NONE of',
  () => { const g = gate('Jeep', 'do you have any Jeep Gladiators', HONDA_LOT);
          return { fires: g.fires, why: /zero/.test(g.reason) }; }, { fires: true, why: true });

one('UNKNOWN inventory does NOT fire — a failed feed must not manufacture a directive',
  () => { const g = gate('BMW', 'is the BMW available', null);
          return { fires: g.fires, known: g.inventoryKnown }; }, { fires: false, known: false });

one('"new" must sit NEAR the make — a stray "new" elsewhere is not a new-car request',
  () => gate('BMW', 'I am new to the area. Is the BMW 4 Series still available?', HONDA_LOT).fires, false);

one('chevy/vw/benz aliases resolve, so "new Chevy" is caught as chevrolet',
  () => gate('Chevrolet', 'looking for a new Chevy Tahoe', HONDA_LOT).saidNew, true);

console.log('\nONE definition — the two readers cannot drift apart:');

one('the gate is defined exactly once',
  () => (_devCode.match(/function _lpOffFranchiseGate/g) || []).length, 1);

one('the REGEX path calls it rather than keeping its own copy — and HANDS IT the cache',
  () => /_lpOffFranchiseGate\(_ofHit\.make, _ofText, d\.dealerId, _lpValueFactCache\)/.test(_devCode), true);

one('...and the old inline duplicate is gone',
  () => /_ofSaidNew \|\| \(_ofUnits && _ofMatch\.length === 0\)/.test(_devCode), false);

one('the COMPREHENSION path calls it too, from fired()',
  () => /_lpOffFranchiseGate\(p\.make,/.test(_devCode), true);

one('fired() actually receives opts — without them the gate has no dealerId and no text',
  () => /det\.fired\(parsed, deps\.opts \|\| \{\}\)/.test(_devCode), true);

one('the opts carry dealerId and the SAME customer text the probe read',
  () => /dealerId: String\(data\.dealerId \|\| ''\), gateText: ofText/.test(_devCode), true);

one('the gate lives OUTSIDE inlineScraper — the v9.7.455/228 scope trap',
  () => {
    const g = _devSrc.indexOf('\nfunction _lpOffFranchiseGate');
    const st = _devSrc.search(/\n\s*function inlineScraper/);
    return g > 0 && st > 0 && g < st;
  }, true);

one('the regex-side gate log uses console.log, not _lpD — _lpD is inlineScraper-only',
  () => {
    const i = _devCode.indexOf("[LP OFF-FRANCHISE GATE] make:' + _ofHit.make");
    return i > 0 && /console\.log/.test(_devCode.slice(Math.max(0, i - 250), i));
  }, true);

one('both readers log their verdict AND the reason, so a suppression is never silent',
  () => (_devCode.match(/reader:regex|reader:comprehension/g) || []).length, 2);

one('the probe PROMPT states the rule too — the model is asked the right question, not just filtered',
  () => /ASKING ABOUT A USED CAR OF ANOTHER MAKE IS NORMAL/.test(_devSrc), true);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
