#!/usr/bin/env node
'use strict';
// (v9.7.597) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('consent-and-stock.test.js');

/**
 * consent-and-stock.test.js — v9.7.597. THREE THINGS ONE PROMPT GOT WRONG ABOUT AMBER CARBERRY.
 *
 * Lead 2042363543, Community Honda Baytown, 8/28, on v9.7.596.
 *
 * ── (1) THE SUMMARY INVERTED HER CONSENT ──────────────────────────────────────────────────
 * She wrote, in the Gubagoo chat that created the lead:
 *
 *     "Price on the 2022 ford escape? I do not want to speak to anyone over the phone.
 *      I am just looking for a price. It would be a cash sale."
 *
 * The prompt carried:
 *
 *     [CUSTOMER CHAT SUMMARY] want to speak to anyone over the phone. I am just looking for
 *     a price. It would be a cash sale.. want to speak to anyone over the phone. ...
 *
 * The match STARTED at the keyword — /(?:Asked|Looking|Want|...)[^\n]{10,400}/ — so "I do not"
 * fell outside it and the sentence reversed meaning. Her record also carries a formal
 * "Privacy Settings Changed — Phone calls disabled by Gil Guzman" entry, so the prompt asserted
 * the opposite of a preference the CRM had recorded as a setting.
 *
 * Same class as "ram" matching inside "Timeframe" (v9.7.555): a bare token matched inside a
 * larger construction. Worse here, because the construction is a NEGATION — a false positive
 * produces noise, an inverted negation produces a confident statement of the reverse.
 *
 * It also duplicated: the same sentence appears twice in the note (chat SUBJECT and Guest turn)
 * and the matches were joined without dedupe.
 *
 * ── (2) "CONFIRMED IN STOCK" ON A SOLD CAR ────────────────────────────────────────────────
 * The same prompt, thirteen lines apart:
 *
 *     line 190  TASK: The specific vehicle of interest has been sold.
 *     line 478  VEHICLE ON LEAD: 2024 Nissan Sentra SV — confirmed in stock.
 *     line 491  🔴 VEHICLE STATUS: SOLD — this specific unit is no longer available.
 *
 * Her Sentra carries "Warning: This vehicle is no longer in your active inventory", PageData
 * Status "I", and the inventory cache returned confirmedAvailable:false. Every signal said gone.
 * That one line gated on nothing but the existence of a stock number.
 *
 * The correct predicate already existed FIFTEEN LINES BELOW, as _confirmedPresent guarding the
 * presence-language block. The claim simply never asked it. Hoisted so both consumers share one
 * computation and cannot disagree.
 *
 * ── (3) THE GUARD THAT REFUSED A NUMBER AND THEN USED IT ──────────────────────────────────
 * v9.7.596 shipped a store-phone guard. Its own log line, from this run:
 *
 *     [LP STORE PHONE GUARD] ... 281-837-3382 ... is gil guzman's personal directory number
 *     — REFUSED. Using 281-837-3382 instead.
 *
 * It read STORE_PHONE_FALLBACK for the replacement — the table the dealer-config loader had
 * already overwritten with the admin-panel values, i.e. with the number being refused. Silent
 * substitution with the diagnostic printed above the substitution.
 *
 * And the exposure is wider than that guard: lookupPhone() reads the same table for any agent
 * missing from PHONE_DIR, so a poisoned entry reaches the MAIN signature path. That is the
 * v9.7.469 incident exactly. Refusing the WRITE fixes every reader at once.
 *
 * Driven against the SHIPPED code with Amber's real note text. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: consent-and-stock.test.js <popup.js> [popup.js...]'); process.exit(2); }

function blk(src, kw, name) {
  const h = src.indexOf(kw + ' ' + name);
  if (h < 0) throw new Error(name + ' not found');
  let d = 0, st = false, e = -1;
  for (let i = h; i < src.length; i++) {
    if (src[i] === '{') { d++; st = true; }
    else if (src[i] === '}') { d--; if (st && d === 0) { e = i + 1; break; } }
  }
  return src.slice(h, e);
}

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');

  // ── the chat-summary block, lifted and wrapped ──
  const a = src.indexOf('        // (v9.7.597) THIS SUMMARY INVERTED A CUSTOMER');
  if (a < 0) throw new Error('chat-summary block not found in ' + file);
  const mark = "          transcript.push('[CUSTOMER CHAT SUMMARY] ' + fullSummary);";
  const b = src.indexOf(mark, a);
  if (b < 0) throw new Error('chat-summary push not found in ' + file);
  const body = src.slice(a, b) + mark + '\n        }\n';

  // ── the phone tables + the config loop, so the guard runs end to end ──
  const cfgA = src.indexOf('    (data.stores || []).forEach(function(s) {');
  const cfgB = src.indexOf('    });', cfgA) + '    });'.length;

  const sb = { String, RegExp, Object, console: { log() {} } };
  vm.createContext(sb);
  vm.runInContext('function summarise(content){ var transcript = [];\n' + body + '\n return transcript; }', sb);
  vm.runInContext(blk(src, 'const', 'PHONE_DIR') + ';', sb);
  vm.runInContext(blk(src, 'var', 'STORE_PHONE_FALLBACK') + ';', sb);
  vm.runInContext('var _LP_BUILTIN_STORE_PHONE = Object.freeze(Object.assign({}, STORE_PHONE_FALLBACK));', sb);
  vm.runInContext(blk(src, 'function', '_lpPersonalNumberOwner(phone)'), sb);
  vm.runInContext('function applyConfig(data){\n' + src.slice(cfgA, cfgB) + '\n}', sb);

  return {
    name: path.basename(path.dirname(file)),
    src,
    summarise: c => vm.runInContext('summarise', sb)(c).join(' '),
    // (v9.7.600) The stock claim was covered by SOURCE SCANS only. That is precisely the coverage
    // that let the v9.7.596 subject ladder read the wrong object for three builds: the shape was
    // right, the binding was wrong, and no regex over source can tell those apart. Executed now.
    stockClaim: d => {
      const a2 = src.indexOf('  if (d.stockNum) {');
      if (a2 < 0) throw new Error('NOT IN THIS BUILD: stock claim');
      const marker = "      + ' inTransit:'";
      const m2 = src.indexOf(marker, a2);
      if (m2 < 0) throw new Error('NOT IN THIS BUILD: stock claim diag');
      const b2 = src.indexOf('  }\n', m2) + 4;
      const s2 = { String, console: { log() {} } };
      vm.createContext(s2);
      vm.runInContext('function stockClaim(d){ var vehicleExtras=[];\n' + src.slice(a2, b2)
        + '\n return vehicleExtras.join(" "); }', s2);
      return vm.runInContext('stockClaim', s2)(d);
    },
    applyConfig: stores => vm.runInContext('applyConfig', sb)({ stores: stores }),
    fallback: id => vm.runInContext('STORE_PHONE_FALLBACK', sb)[id],
    builtin: id => vm.runInContext('_LP_BUILTIN_STORE_PHONE', sb)[id]
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
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

// Amber's lead-received note, verbatim from the 8/28 DOM dump.
const AMBER = [
  'CUSTOMER INSIGHTS- ; CustomerComment : Click for Lead Info: dealer.gubagoo.com%2fl%2f0014a...',
  'Customer Contact preference: email', '', 'Lead Type: m-chat',
  'Department: Used Vehicle Sales', 'Visitor Score: 0/10',
  'Subject: Price on the 2022 ford escape? I do not want to speak to anyone over the phone. I am just looking for a price. It would be a cash sale.',
  '', 'Guest (06/25/26 17:55:55 pm):',
  'Price on the 2022 ford escape? I do not want to speak to anyone over the phone. I am just looking for a price. It would be a cash sale.',
  'Mia (06/25/26 17:55:55 pm):', 'Hi my name is Mia. I would be happy to help you with that!',
  'Guest (06/25/26 17:56:15 pm):', 'Amber'
].join('\n');

console.log('\nv9.7.597 — her consent, the stock claim, and a guard that refused nothing');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);
console.log('');

// ── (1) CONSENT ─────────────────────────────────────────────────────────────
console.log("Amber's real note — she said she does NOT want a phone call:");

check('the negation survives into the summary',
  i => /I do not want to speak to anyone over the phone/i.test(i.summarise(AMBER)), true);

check('...and the inverted claim is gone',
  i => /(?:^|[^t] )want to speak to anyone over the phone/i.test(i.summarise(AMBER)), false);

// The same utterance appears twice in the note — chat SUBJECT and Guest turn — and the old code
// joined both. Dedupe is keyed on the text with those prefixes stripped, so they collapse to one.
check('the summary is not duplicated',
  i => (i.summarise(AMBER).match(/cash sale/gi) || []).length, 1);

// A first pass at this fix split on SENTENCES, which kept the negation but discarded "It would be
// a cash sale" — no intent word in it — so a cash buyer stopped being visible. Splitting on lines
// keeps the customer's whole turn. Asserted so that regression cannot come back quietly.
check('...and the rest of her turn survives — she is a cash buyer',
  i => /cash sale/i.test(i.summarise(AMBER)), true);

check('her actual ask still reaches the model',
  i => /looking for a price/i.test(i.summarise(AMBER)), true);

// The general rule, not just her sentence.
console.log('\nnegation is preserved for any customer, not just this one:');
for (const [text, mustKeep] of [
  ['I do not want a call, just text me the price.',        'do not want a call'],
  ['I am not looking for financing, this is a cash deal.', 'not looking for financing'],
  ['Please do not need anything under 30k miles.',         'do not need anything'],
  ['I never asked for a trade appraisal.',                 'never asked for a trade']
]) {
  check('  "' + text.slice(0, 40) + '..."',
    i => i.summarise('Lead Type: m-chat\n' + text).indexOf(mustKeep) >= 0, true);
}

check('a genuine positive intent is still captured',
  i => /looking for something under 50k miles/i.test(
        i.summarise('Lead Type: m-chat\nI am looking for something under 50k miles with a backup camera.')), true);

check('a sentence with no intent word is not pulled in',
  i => i.summarise('Lead Type: m-chat\nThe weather is fine today and nothing else matters here.'), '');

// ── (2) THE STOCK CLAIM ─────────────────────────────────────────────────────
console.log('\n"confirmed in stock" now answers to the same predicate as the presence guard:');

check('the claim is no longer unconditional on a stock number',
  i => /_stkName \+ ' — confirmed in stock\. Name it/.test(strip(i.src)), false);

check('it is chosen by _confirmedPresent',
  i => /var _stkStatus = _confirmedPresent/.test(strip(i.src)), true);

check('...and the NOT-confirmed branch tells the model plainly not to claim it is here',
  i => /NOT confirmed available[\s\S]{0,120}Do NOT tell the customer it is here/.test(strip(i.src)), true);

check('_confirmedPresent is computed BEFORE the claim that uses it',
  i => {
    const s = strip(i.src);
    return s.indexOf('var _confirmedPresent') < s.indexOf('var _stkStatus');
  }, true);

check('the presence-language block still has its own copy — one computation, two consumers',
  i => (strip(i.src).match(/var _confirmedPresent = !!d\.stockNum/g) || []).length, 2);

check('[LP STOCK CLAIM DIAG] reports every input to the decision',
  i => {
    const t = (strip(i.src).match(/\[LP STOCK CLAIM DIAG\][\s\S]{0,320}/) || [''])[0];
    return { confirmed: /confirmedPresent/.test(t), warn: /inventoryWarning/.test(t),
             pending: /pendingSale/.test(t), transit: /inTransit/.test(t) };
  }, { confirmed: true, warn: true, pending: true, transit: true });

// The predicate itself, run rather than described — Amber's signals vs a healthy unit.
const confirmed = d => !!d.stockNum && !d.isInTransit && !d.inventoryWarning && !d.vehiclePendingSale && !d.agentSaidNotAvail;
console.log('\nwhat that predicate says about the units in play:');
check('  Amber\'s Sentra (inventoryWarning:true) -> NOT confirmed',
  () => confirmed({ stockNum: 'P4804', inventoryWarning: true }), false);
check('  a healthy in-stock unit -> confirmed',
  () => confirmed({ stockNum: 'TA047502' }), true);
check('  an in-transit unit -> NOT confirmed',
  () => confirmed({ stockNum: 'X1', isInTransit: true }), false);
check('  a unit with a pending sale -> NOT confirmed',
  () => confirmed({ stockNum: 'X1', vehiclePendingSale: true }), false);
check('  one an agent already said we do not have -> NOT confirmed',
  () => confirmed({ stockNum: 'X1', agentSaidNotAvail: true }), false);

// ── (2b) THE STOCK CLAIM, EXECUTED ──────────────────────────────────────────
// (v9.7.600) Added during the pre-publish sweep. This block was asserted only by source scan,
// the same coverage that hid the subject-ladder binding bug for three builds. Running it is the
// only way to prove `d` is the lead rather than some other object in scope.
console.log('\nthe stock claim, run against real signals:');

check("Amber's sold Sentra is NOT called confirmed in stock",
  i => /confirmed in stock/.test(i.stockClaim({ stockNum: 'P4804', vehicle: '2024 Nissan Sentra SV', inventoryWarning: true })), false);

check('...and it tells the model plainly not to claim the car is here',
  i => /Do NOT tell the customer it is here/.test(
        i.stockClaim({ stockNum: 'P4804', vehicle: '2024 Nissan Sentra SV', inventoryWarning: true })), true);

check('a healthy unit IS still called confirmed in stock',
  i => /— confirmed in stock/.test(
        i.stockClaim({ stockNum: 'TA047502', vehicle: '2026 Honda Accord Hybrid Sport-L' })), true);

check('every suppressing signal is honoured, not just inventoryWarning',
  i => ['inventoryWarning', 'vehiclePendingSale', 'isInTransit'].map(flag => {
        const d = { stockNum: 'X1', vehicle: '2026 Civic' }; d[flag] = true;
        return /— confirmed in stock/.test(i.stockClaim(d));
      }), [false, false, false]);

check('the block reads a real lead object — the vehicle name reaches the output',
  i => /2024 Nissan Sentra SV/.test(
        i.stockClaim({ stockNum: 'P4804', vehicle: '2024 Nissan Sentra SV', inventoryWarning: true })), true);

// ── (3) THE STORE-PHONE GUARD ───────────────────────────────────────────────
// This is the part v9.7.596 got wrong, so it is driven end to end: poison the config the way the
// admin panel actually does, then read the table every consumer reads.
console.log('\nthe dealer-config write is refused, not merely logged:');

check("Gil's personal line is NOT written into the fallback table",
  i => { i.applyConfig([{ crmDealerId: '6191', phone: '281-837-3382' }]); return i.fallback('6191'); },
  '281-837-3687');

check('...and the built-in copy is untouched, so there is always something to fall back TO',
  i => { i.applyConfig([{ crmDealerId: '6191', phone: '281-837-3382' }]); return i.builtin('6191'); },
  '281-837-3687');

check('a genuine store line from the panel IS accepted',
  i => { i.applyConfig([{ crmDealerId: '6190', phone: '281-555-0100' }]); return i.fallback('6190'); },
  '281-555-0100');

check('every rooftop is protected, not just 6191',
  i => {
    i.applyConfig([{ crmDealerId: '6189', phone: '281-837-3382' },
                   { crmDealerId: '6190', phone: '281-837-3381' },
                   { crmDealerId: '6191', phone: '281-837-3382' }]);
    return ['6189', '6190', '6191'].map(id => i.fallback(id));
  }, ['281-837-3687', '281-837-3687', '281-837-3687']);

check('the v9.7.596 bug is gone: the prompt-site guard reads the PRISTINE copy',
  i => /_psReal = \(typeof _LP_BUILTIN_STORE_PHONE === 'object'/.test(strip(i.src)), true);

check('...and no longer reads the table the config overwrites',
  i => /_psReal = \(typeof STORE_PHONE_FALLBACK === 'object'/.test(strip(i.src)), false);

check('the write-site guard names the owner, the dealer and the remedy',
  i => {
    // The owner is interpolated BEFORE the "NOT WRITTEN" text, so the window has to look both
    // ways round the marker rather than only forward.
    const s2 = strip(i.src);
    const at = s2.indexOf('NOT WRITTEN');
    const t = at < 0 ? '' : s2.slice(Math.max(0, at - 300), at + 300);
    return { owner: /_cfgOwner/.test(t), dealer: /_cfgKey/.test(t),
             builtin: /_LP_BUILTIN_STORE_PHONE/.test(t), remedy: /FIX THE ADMIN PANEL/.test(t) };
  }, { owner: true, dealer: true, builtin: true, remedy: true });

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
