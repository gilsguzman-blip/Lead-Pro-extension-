#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('datatool-expiry-m5.test.js');
// datatool/index.html, audit M-5 (11/3). ipDetectExpiration returned the FIRST date it found and gave a yearless date this
// year, so a range expired on its start date and "Expires Jan 4" on a December page was already past. Expiry is the kill
// switch. Now the date after through / thru / ends / expires / until / to / a dash is preferred, else the latest date, and a
// yearless month-day more than 60 days before now rolls to next year. The fixture table is the audit's four strings plus the
// two historic misreads the comments record ("APR 24-60", "APR 72"). Executes the shipped functions sliced from the page.
//
// Usage: node tests/datatool-expiry-m5.test.js [datatool/index.html]
const fs = require('fs'), path = require('path'), vm = require('vm');
const FILE = process.argv.slice(2).find(a => /\.html$/.test(a)) || path.join(__dirname, '..', 'datatool', 'index.html');
const html = fs.readFileSync(FILE, 'utf8');
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
function fnSrc(name) {
  const m = new RegExp('function\\s+' + name + '\\s*\\(').exec(html); if (!m) return '';
  let i = html.indexOf('{', m.index), d = 0;
  for (let j = i; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && --d === 0) return html.slice(m.index, j + 1); }
  return '';
}
const line = (re) => (html.match(re) || [''])[0];
const box = { Date, Math, String, parseInt, isNaN };
vm.createContext(box);
vm.runInContext([line(/const IP_MONTHS = \{[^}]*\};/), fnSrc('ipPad2'), fnSrc('ipStripNoise'), line(/const IP_EXPIRY_MARKER = [^\n]*;/), fnSrc('ipDetectExpiration')].join('\n'), box);
const D = (text, nowIso) => box.ipDetectExpiration(text, undefined, new Date(nowIso || '2026-11-03T12:00:00Z'));

console.log(' the audit\'s four strings, read on 11/3/2026:');
check('"Offer valid 10/1/2026 - 11/2/2026" -> the END of the range, 2026-11-02 (was the start, 2026-10-01)', () => D('Offer valid 10/1/2026 - 11/2/2026'), '2026-11-02');
check('"Valid Oct 1 through Nov 30, 2026" -> 2026-11-30 (was 2026-10-01)', () => D('Valid Oct 1 through Nov 30, 2026'), '2026-11-30');
check('"Expires Jan 4" -> 2027-01-04 (was 2026-01-04, already past)', () => D('Expires Jan 4'), '2027-01-04');
check('control: "Offers through 1/4/2027" -> 2027-01-04', () => D('Offers through 1/4/2027'), '2027-01-04');
console.log(' the two historic misreads stay fixed:');
check('control: "3.99% APR 24-60 mos ... Offer ends Nov 30, 2026" -> 2026-11-30, not April 24', () => D('Accord 3.99% APR 24-60 mos. Offer ends Nov 30, 2026'), '2026-11-30');
check('control: "4.99% APR 72 months ... Offer ends December 1, 2026" -> 2026-12-01 (APR 72 does not stop the search)', () => D('Q5 4.99% APR 72 months. Offer ends December 1, 2026'), '2026-12-01');
check('control: "APR 24-60 mos" alone -> no date', () => D('3.99% APR 24-60 mos'), null);
console.log(' the rules around them:');
check('no marker: the latest date wins ("Program 10/1/2026 and 11/30/2026")', () => D('Program 10/1/2026 and 11/30/2026'), '2026-11-30');
check('control: a marked date wins over a later unmarked one ("Ends 11/30/2026 ... model year 12/31/2026 build")', () => D('Lease ends 11/30/2026. 12/31/2026 build date'), '2026-11-30');
check('a December page: "Valid Dec 1, 2026 through Jan 4" -> 2027-01-04', () => D('Valid Dec 1, 2026 through Jan 4', '2026-12-10T12:00:00Z'), '2027-01-04');
check('control: a yearless date within the last 60 days stays this year (the caller then drops it as expired): "Ends Oct 15" -> 2026-10-15', () => D('Ends Oct 15'), '2026-10-15');
check('an en dash counts as a range: "Oct 1 – Nov 30, 2026" -> 2026-11-30', () => D('Oct 1 – Nov 30, 2026'), '2026-11-30');
check('control: the caller still calls it with the text alone (now defaults to the clock)', () => /let expires = ipDetectExpiration\(chunk\.text\);/.test(html), true);
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
