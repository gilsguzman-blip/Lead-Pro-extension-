#!/usr/bin/env node
'use strict';
// (v9.7.621) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('incentive-year-capture.test.js');

/**
 * incentive-year-capture.test.js — datatool/index.html. THE ENUMERATION TRAP, AGAIN.
 *
 * Reported 9/9 off two real normalized exports: 11 lines per store carried NO year — Accord,
 * Accord Hybrid, CR-V x2, CR-V Hybrid x2, HR-V, Odyssey x2, Ridgeline x2 — identical on Honda
 * Baytown 6191 and Honda Lafayette 24399. Every one of them a Loyalty Cash / Customer Cash line.
 * Featured Special Lease and Special APR lines on the SAME page were dated correctly, which is
 * what pointed at the card type rather than the page.
 *
 * ROOT CAUSE. ipChunkByModelNames dates a chunk by looking BACKWARD from the model name (Toyota
 * and Kia print "2025 Tundra"), and falls forward only when that finds nothing. Honda prints the
 * year AFTER the label, so Honda always takes the forward path — and the forward pattern was
 *
 *     /\b(?:Finance|Lease)\s+(20\d{2})\b/
 *
 * which enumerates the LABEL WORDS. Honda's page is completely uniform: every card reads
 * "<model> See All Offers <label> <year>". Only the label varies. So the moment a card's label
 * was neither Finance nor Lease — "Special Program" — it walked straight through and the line
 * shipped undated. The page never omitted the year; the pattern declined to look at it. Shape,
 * not vocabulary: the fix matches the "See All Offers" card header that Honda's own chunk filter
 * already depends on, and keeps the old alternation behind it so nothing previously dated moves.
 *
 * NOT A MISSING "2026". CR-V, CR-V Hybrid and HR-V run 2027 Special Program cards ALONGSIDE their
 * 2026 ones. A hardcoded year, or "just take the first year on the page," would have put the wrong
 * model year on a dollar figure that goes to a customer. The fixtures pin all three 2027s.
 *
 * THE ALL-TRIMS CARDS STAY UNDATED, and that is correct: Honda's two "All Vehicles" Special
 * Program cards (Military Appreciation / Graduate, the cross-model offers) carry no year on the
 * page at all, and the Honda branch of ipNormalize drops "All Vehicles" chunks outright. Expiry
 * handling on those is out of scope by instruction — managed by monthly republishing, not code.
 *
 * FIXTURES are the extracted visible text of the two real 9/9 offer pages, sliced to the offer
 * region. No phone number, no email, no contact data of any kind (asserted below, not assumed).
 *
 * Executes the SHIPPED function. Non-vacuity neuters the specific match arms in the CURRENT file.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const FILE = process.argv.slice(2).find(a => /\.html$/.test(a)) ||
             path.join(__dirname, '..', 'datatool', 'index.html');
const src = fs.readFileSync(FILE, 'utf8');

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

// ─── lift the shipped function ───────────────────────────────────────────────
// Anchored on the CODE line. The file's own comment blocks quote these names in prose, so an
// indexOf on the bare identifier can land in a comment and lift the wrong span.
const FN_ANCHOR = '\nfunction ipChunkByModelNames(fullText, models) {';
if (src.split(FN_ANCHOR).length !== 2) {
  require('./lib/fatal-guard.js').bail('incentive-year-capture.test.js',
    'ipChunkByModelNames definition not found exactly once in ' + FILE);
}
function liftFn(text, anchor) {
  const a = text.indexOf(anchor) + 1;
  let depth = 0, seen = false;
  for (let i = a; i < text.length; i++) {
    const c = text[i];
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') { depth--; if (seen && depth === 0) return text.slice(a, i + 1); }
  }
  return null;
}
const FN_SRC = liftFn(src, FN_ANCHOR);
if (!FN_SRC) {
  require('./lib/fatal-guard.js').bail('incentive-year-capture.test.js', 'could not brace-match ipChunkByModelNames');
}

const listStart = src.indexOf('  Honda: [');
const HONDA_SRC = src.slice(listStart + '  Honda: '.length, src.indexOf('],', listStart) + 1);
if (!/^\[[\s\S]*\]$/.test(HONDA_SRC.trim())) {
  require('./lib/fatal-guard.js').bail('incentive-year-capture.test.js', 'Honda model list not liftable');
}

function runChunker(fnSrc, fullText) {
  const box = { console: { log() {} }, RegExp, String, Math, Array, Object, JSON };
  vm.createContext(box);
  vm.runInContext(fnSrc + '\nconst __HONDA = ' + HONDA_SRC + ';', box);
  box.__t = fullText;
  return vm.runInContext('ipChunkByModelNames(__t, __HONDA)', box);
}

// The Honda branch of ipNormalize keeps exactly these: a real card, and not the cross-model one.
const isOffer = c => /See All Offers/i.test(c.text);
const isKept  = c => isOffer(c) && c.model !== 'All Vehicles';
const labelOf = c => (c.text.match(/See All Offers\s+([A-Za-z ]+?)\s+(?:20\d{2}|undefined|\$)/) || [])[1] || '?';

const FIXTURES = [
  ['6191  Honda Baytown',  path.join(__dirname, 'fixtures', 'honda-offers-6191-visible-text.txt')],
  ['24399 Honda Lafayette', path.join(__dirname, 'fixtures', 'honda-offers-24399-visible-text.txt')],
];

// The 11 lines the export shipped undated, with the year the page actually shows for each.
// Order is page order. The three 2027s are the reason this is a list and not a constant.
const SPECIAL_PROGRAM_EXPECTED = [
  ['Accord', '2026'],
  ['Accord Hybrid', '2026'],
  ['CR-V', '2026'],
  ['CR-V', '2027'],
  ['CR-V Hybrid', '2026'],
  ['CR-V Hybrid', '2027'],
  ['HR-V', '2027'],
  ['Odyssey', '2026'],
  ['Odyssey', '2026'],
  ['Ridgeline', '2026'],
  ['Ridgeline', '2026'],
];

console.log('\nfixtures carry no contact data');
for (const [label, file] of FIXTURES) {
  const t = fs.readFileSync(file, 'utf8');
  check(label + ' — no phone-shaped digits', /\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}/.test(t), false);
  check(label + ' — no email-shaped token', /[\w.]+@[\w.]+\.\w+/.test(t), false);
}

const perStore = {};

for (const [label, file] of FIXTURES) {
  console.log('\n' + label);
  const fullText = fs.readFileSync(file, 'utf8');
  const chunks = runChunker(FN_SRC, fullText);
  const offers = chunks.filter(isOffer);
  perStore[label] = offers.map(c => [c.model, labelOf(c), c.year]);

  check('offer cards found', offers.length, 61);

  // (1) THE REPORTED BUG. Every model-specific card carries a year — nothing ships undated.
  const undated = offers.filter(c => c.model !== 'All Vehicles' && !c.year);
  check('model cards with no year', undated.map(c => c.model + ' / ' + labelOf(c)), []);

  // (2) The Special Program cards specifically, model AND year, in page order.
  const sp = offers.filter(c => isKept(c) && /Special Program/i.test(labelOf(c)));
  check('Special Program cards (model, year)', sp.map(c => [c.model, c.year]), SPECIAL_PROGRAM_EXPECTED);
  check('Special Program card count', sp.length, 11);

  // (3) The two card types that were ALREADY correct must still be correct — this is the
  //     regression half. If the new arm ever mis-dates one of these, it fails here.
  const lease = offers.filter(c => isKept(c) && /Featured Special Lease/i.test(labelOf(c)));
  const apr   = offers.filter(c => isKept(c) && /^Finance$/i.test(labelOf(c)));
  check('Featured Special Lease count', lease.length, 36);
  check('Featured Special Lease all dated', lease.every(c => /^20\d{2}$/.test(c.year || '')), true);
  check('Special APR (Finance) count', apr.length, 12);
  check('Special APR all dated', apr.every(c => /^20\d{2}$/.test(c.year || '')), true);

  // (4) The cross-model all-trims cards. The page shows no year; they must not acquire one, and
  //     the Honda filter drops them before a line is ever built.
  const allVeh = offers.filter(c => c.model === 'All Vehicles');
  check('All Vehicles cards present on page', allVeh.length, 2);
  check('All Vehicles cards carry no year', allVeh.map(c => c.year), [null, null]);
  check('All Vehicles cards are dropped by the Honda filter', chunks.filter(isKept).some(c => c.model === 'All Vehicles'), false);

  // (5) Two model years live at once. Prove the chunker discriminates rather than picking one.
  const crv = sp.filter(c => c.model === 'CR-V').map(c => c.year);
  const hrv = sp.filter(c => c.model === 'HR-V').map(c => c.year);
  check('CR-V Special Program runs both years', crv, ['2026', '2027']);
  check('HR-V Special Program is 2027 only', hrv, ['2027']);

  // (6) No year on the page is outside the plausible band — catches a match that reached into
  //     an unrelated number deeper in the card body.
  check('all captured years in band', offers.every(c => c.year === null || (+c.year >= 2024 && +c.year <= 2030)), true);

  // (7) The four card types must exhaust the page. A fifth label slipping through unlabelled and
  //     therefore unasserted is exactly how the Special Program gap survived this long.
  check('the four card types account for every offer card',
    lease.length + apr.length + sp.length + allVeh.length, offers.length);
}

console.log('\nboth rooftops agree');
check('6191 and 24399 produce identical offer tables',
  JSON.stringify(perStore['6191  Honda Baytown']) === JSON.stringify(perStore['24399 Honda Lafayette']), true);

// ─── source shape ────────────────────────────────────────────────────────────
// Build-header prose in this file quotes its own code, so assert against comment-stripped source.
const CODE = FN_SRC.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
console.log('\nsource shape');
check('structural arm present', /See All Offers\\s\+\(\?:\[A-Za-z\]\+\\s\+\)\{0,4\}\?\(20\\d\{2\}\)/.test(CODE), true);
check('old alternation kept as second arm', /\\b\(\?:Finance\|Lease\)\\s\+\(20\\d\{2\}\)\\b/.test(CODE), true);
check('structural arm is tried FIRST',
  CODE.indexOf('See All Offers\\s+') < CODE.indexOf('(?:Finance|Lease)'), true);
check('forward fallback still runs only when the backward lookback failed',
  /if \(!yearM\) \{[\s\S]{0,400}?forwardM/.test(CODE), true);
check('a missing year is still null, never a guess', /year: yearM \? yearM\[1\] : null/.test(CODE), true);

// ─── other makes are untouched ───────────────────────────────────────────────
// Gil asked whether the same card-type gap exists on Toyota, Kia or Audi. Answered structurally,
// against the shipped routing — not by eyeballing an export that happened to look complete.
console.log('\nother makes');
const AUDI_SRC = liftFn(src, '\nfunction ipChunkAudiOffers(fullText, models) {');
check('Audi has its own chunker', !!AUDI_SRC, true);
const AUDI_CODE = (AUDI_SRC || '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
check('Audi never consults the Honda forward fallback', /See All Offers|Finance\|Lease/.test(AUDI_CODE), false);
check('Audi dates by its own backward lookback', /\(20\\d\{2\}\)\\s\+Audi\\s\*\$/.test(AUDI_CODE), true);
// Toyota's live path is the structured SSR blob, where the year is a field, not a regex target.
check('Toyota reads year as a field, not a pattern', /const year = s\.year \|\| null;/.test(src), true);
check('Toyota is routed to the SSR parser first', /if \(manufacturer === 'Toyota'\)[\s\S]{0,120}?parseToyotaSSRStateOffers/.test(src), true);
// Kia shares ipChunkByModelNames, and its page prints "2026 K5 LXS FWD" — the BACKWARD lookback
// answers first, and the forward fallback is unreachable whenever it does. So a change to the
// forward arm cannot move a Kia line either direction.
check('Kia has a model list and no chunker of its own', /Kia: \[/.test(src) && !/function ipChunkKia/.test(src), true);
const KIA_ROUTE = /chunks = ipChunkByModelNames\(fullText, models\);/.test(src);
check('Kia routes through the shared chunker', KIA_ROUTE, true);
check('backward lookback is attempted before any forward arm',
  CODE.indexOf('yearLookback.match') < CODE.indexOf('forwardM'), true);

// ─── non-vacuity ─────────────────────────────────────────────────────────────
// Each neuter breaks ONE specific thing in the CURRENT file and must cost real assertions.
console.log('\nnon-vacuity (neuters of the shipped function)');
const fixtureText = fs.readFileSync(FIXTURES[0][1], 'utf8');

function undatedSpecialPrograms(fnSrc) {
  const offers = runChunker(fnSrc, fixtureText).filter(isOffer);
  return offers.filter(c => c.model !== 'All Vehicles' && /Special Program/i.test(labelOf(c)) && !c.year).length;
}

// A. Remove the structural arm — back to the shipped-before behaviour. All 11 go dark.
const neuterA = FN_SRC.replace(
  /const forwardM = chunkText\.match\(\/See All Offers[\s\S]*?\|\| chunkText\.match\(/,
  'const forwardM = chunkText.match(');
check('neuter A actually changed the source', neuterA !== FN_SRC, true);
check('A: without the structural arm, all 11 Special Program lines lose their year',
  undatedSpecialPrograms(neuterA), 11);

// B. Keep the structural arm but forbid ANY label words between the header and the year. The
//    {0,4} gap is load-bearing: "Special Program" is two words.
const neuterB = FN_SRC.replace('{0,4}?', '{0,0}?');
check('neuter B actually changed the source', neuterB !== FN_SRC, true);
check('B: with a zero-word gap the Special Program lines lose their year again',
  undatedSpecialPrograms(neuterB), 11);

// C. Point the structural arm at a header token that does not exist on the page. Proves the
//    assertions above are reading THIS match and not some other path that happens to date them.
const neuterC = FN_SRC.replace('See All Offers\\s+', 'See Every Offer\\s+');
check('neuter C actually changed the source', neuterC !== FN_SRC, true);
check('C: a wrong header token loses the same 11 lines', undatedSpecialPrograms(neuterC), 11);

// D. The intact function must not be moved by any of it — the control.
check('D (control): the shipped function leaves none undated', undatedSpecialPrograms(FN_SRC), 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
