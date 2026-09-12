#!/usr/bin/env node
'use strict';
// (v9.7.621) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('incentive-expiry.test.js');

/**
 * incentive-expiry.test.js — v9.7.621. THE KILL-SWITCH GUARDED ONE DOOR OF TWO.
 *
 * The Data Tool's UI promises that Lead Pro "stops using any line after its expires date," and
 * calls expiry the kill-switch. v9.7.530 made that true — before it, `expires` appeared in exactly
 * three executable places, all inside the _daysLeft urgency branch, where a NEGATIVE _daysLeft (an
 * offer that already ended) failed the >= 0 test, fell to the else, and was injected labelled "real
 * & current". An incentive 181 days expired reached that branch, by execution, not by argument.
 *
 * v9.7.530 wrapped the MAIN store-incentive gate with _lpExpiryFilterIncentives and stopped there.
 * THE SOLD-PIVOT PAIRING KEPT CALLING _lpYearFilterIncentives ALONE. So the same stale line the
 * main gate now refuses could still be quoted by the pivot — and the pivot is the path that LEADS
 * with the offer, the most prominent place in the message to be wrong.
 *
 * Found 9/4, checking why two Honda rooftops read 39 live lines against a month-old publish date.
 * The proxy and the extension use OPPOSITE rules for an undated line — GET /valuefact drops one
 * only when `expires` is present AND past, so an undated line passes; _lpExpiryFilterIncentives
 * drops it, matching the publish rule. That divergence is why a store can serve 39 lines and quote
 * none of them, and why the filter has to be applied at every read site rather than at one.
 *
 * Until this suite the filter itself had NO COVERAGE ANYWHERE. It is the mechanism that decides
 * whether an expired dollar figure reaches a customer.
 *
 * Executes the SHIPPED filter and asserts the SHIPPED wiring at both read sites. Both builds must
 * agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: incentive-expiry.test.js <popup.js> [popup.js...]'); process.exit(2); }

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const START = 'function _lpExpiryFilterIncentives(incentives, storeLabel){';
  const END = '  return kept;\n}';
  const a = src.indexOf(START);
  const b = src.indexOf(END, a);
  if (a < 0 || b < 0) {
    require('./lib/fatal-guard.js').bail('incentive-expiry.test.js', 'expiry filter not found in ' + file);
  }
  const logs = [];
  const sb = { console: { log: m => logs.push(String(m)) }, String, Date, RegExp };
  vm.createContext(sb);
  vm.runInContext(src.slice(a, b + END.length), sb);
  return { src, logs, filter: vm.runInContext('_lpExpiryFilterIncentives', sb) };
}

// The filter reads today from the real clock, so dates are expressed relative to it.
const iso = d => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

for (const file of BUILDS) {
  const B = load(file);
  const names = a => a.map(x => x.model);

  console.log('\n' + path.relative(process.cwd(), file) + ' — expiry is the kill-switch, at every door');

  // ── THE FILTER ─────────────────────────────────────────────────────────────
  console.log('\nthe filter keeps exactly the current lines:');
  const mixed = [
    { model: 'Future',    expires: iso(30) },
    { model: 'Today',     expires: iso(0)  },   // expiring today is still current
    { model: 'Yesterday', expires: iso(-1) },
    { model: 'LongGone',  expires: iso(-181) }, // the v9.7.530 reproduction
    { model: 'Undated' },
    { model: 'NullDate',  expires: null },
    { model: 'EmptyDate', expires: '' },
    { model: 'Sloppy',    expires: '2026-8-6' },  // not zero-padded — sorts ABOVE a real date
    { model: 'Vague',     expires: 'soon' }
  ];
  check('future, and today, survive', names(B.filter(mixed, 'S')), ['Future', 'Today']);
  check('...so yesterday is dropped',        names(B.filter(mixed, 'S')).indexOf('Yesterday'), -1);
  check('...and the 181-days-expired case',  names(B.filter(mixed, 'S')).indexOf('LongGone'), -1);

  // A missing date is NOT publishable — the same rule the Data Tool applies at publish time, and
  // the opposite of what GET /valuefact does. Both halves matter: the proxy will serve these.
  console.log('\nan undated line is not publishable — the proxy disagrees, and the extension wins:');
  ['Undated', 'NullDate', 'EmptyDate'].forEach(m =>
    check('  ' + m + ' is dropped', names(B.filter(mixed, 'S')).indexOf(m), -1));

  // Lexicographic compare is only meaningful on zero-padded ISO. "2026-8-6" and "soon" both sort
  // ABOVE a real date and would survive as current if the format were not validated FIRST.
  console.log('\nmalformed dates are dropped BEFORE the string compare, not after:');
  check('"2026-8-6" does not survive as current', names(B.filter(mixed, 'S')).indexOf('Sloppy'), -1);
  check('"soon" does not survive as current',     names(B.filter(mixed, 'S')).indexOf('Vague'), -1);
  check('a string that sorts high is not a date', B.filter([{ model: 'X', expires: 'zzzz' }], 'S').length, 0);

  console.log('\nit fails safe, never loudly:');
  check('null input yields no lines, no throw',      B.filter(null, 'S').length, 0);
  check('undefined input yields no lines, no throw', B.filter(undefined, 'S').length, 0);
  check('an empty array stays empty',                B.filter([], 'S').length, 0);
  check('a store of only current lines is untouched',
    names(B.filter([{ model: 'A', expires: iso(5) }, { model: 'B', expires: iso(6) }], 'S')), ['A', 'B']);

  console.log('\nit says out loud when a store has gone dark:');
  B.logs.length = 0;
  B.filter(mixed, 'Honda Baytown');
  const diag = B.logs.filter(l => l.indexOf('[LP INCENTIVE EXPIRY DIAG]') === 0);
  check('a drop is reported', diag.length, 1);
  check('...naming the store', diag[0].indexOf('Honda Baytown') > -1, true);
  // 2 expired (Yesterday, LongGone) and 5 undated/malformed — the two malformed dates are counted
  // as UNDATED, not expired, which is the honest reading: nothing was compared, the format failed.
  check('...splitting expired from undated', /2 expired, 5 undated\/malformed/.test(diag[0]), true);
  B.logs.length = 0;
  B.filter([{ model: 'A', expires: iso(-1) }], 'Honda Baytown');
  check('a store left with NOTHING says so explicitly',
    /NO CURRENT LINES REMAIN/.test(B.logs.join(' ')), true);
  B.logs.length = 0;
  B.filter([{ model: 'A', expires: iso(5) }], 'Honda Baytown');
  check('a healthy store is silent', B.logs.length, 0);

  // ── BOTH READ SITES ────────────────────────────────────────────────────────
  // The defect was never in the filter. It was that only one caller used it. Asserted against the
  // source, because that is where the omission lived and where it would come back.
  console.log('\nEVERY incentive read applies it — the thing that was actually wrong:');
  const sites = B.src.split('\n')
    .map((l, i) => ({ n: i + 1, l }))
    .filter(o => /_lpMatchByModel\(/.test(o.l) && /incentives|Inc\b|_soldIncCur|_vfc/.test(o.l)
                 && !/function _lpMatchByModel/.test(o.l));
  check('two incentive read sites are wired', sites.length, 2);
  sites.forEach(o => check('  line ' + o.n + ' feeds from an expiry-filtered list',
    /_lpExpiryFilterIncentives|_soldIncCur/.test(o.l), true));
  check('the sold-pivot no longer reads _soldVfc.incentives directly into the matcher',
    /_lpMatchByModel\([^\n]*_lpYearFilterIncentives\([^\n]*_soldVfc\.incentives/.test(B.src), false);
  check('the sold-pivot filters ONCE, outside the comparable loop',
    (B.src.match(/var _soldIncCur = _lpExpiryFilterIncentives\(/g) || []).length, 1);
  check('...and skips the loop entirely when nothing is current',
    /!_soldPivotInc && _soldIncCur\.length/.test(B.src), true);
  check('...saying so rather than reporting "no match"',
    /are expired or undated — no CURRENT offer to pair/.test(B.src), true);
  check('the "none matched" count reports CURRENT lines, not everything cached',
    /none matched any of ' \+ _soldIncCur\.length \+ ' CURRENT incentive line\(s\)/.test(B.src), true);
}

// ── dev === comm ─────────────────────────────────────────────────────────────
if (BUILDS.length > 1) {
  console.log('\nboth builds ship the same wiring:');
  const cut = f => {
    const s = fs.readFileSync(f, 'utf8');
    const i = s.indexOf('var _soldIncCur = _lpExpiryFilterIncentives(');
    return s.slice(i, s.indexOf('if (_soldPivotInc) {', i));
  };
  check('dev and commercial pair incentives identically', cut(BUILDS[0]) === cut(BUILDS[1]), true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
