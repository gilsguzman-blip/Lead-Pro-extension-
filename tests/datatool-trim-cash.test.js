#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('datatool-trim-cash.test.js');
// datatool/index.html, 10/1. Gil, checking the October Toyota and Audi incentive files: "the BZ offers are TFS lease cash.
// The Q7's are premium and premium plus. Is this a gathering issue?" It was:
//  (1) Toyota's 2027 bZ and bZ Woodland cards carry cash.label "Cash" -- the word printed under the amount -- while the
//      program is the offer's title, offerTitle "TFS Lease Cash". The tool wrote "bZ — $2,250 Cash".
//  (2) Audi's page has two Q7 leases ("Q7 45 TFSI quattro Premium" $629, "Q7 S line 55 TFSI quattro Premium Plus" $739)
//      and the line kept only "Q7". Toyota's leases name their trim too ("Applies to SR5") and it was dropped.
// Now a bare "Cash" takes the offer's title, and a line names the trim the page says it applies to (" — applies to ...").
// The line still opens with the model, which is what the extension matches on (_lpModelLine).
// Runs the SHIPPED parseManufacturerPage in Chromium on synthetic pages shaped like the real October ones.
//
// Usage: node tests/datatool-trim-cash.test.js
const fs = require('fs'), path = require('path');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
const TOOL = path.join(__dirname, '..', 'datatool', 'index.html');
const TOOL_ARG = process.argv.slice(2).find(a => /\.html$/.test(a)) || TOOL;
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const end = { fullYear: '2026', month: '11', day: '2' };
const offer = (type, model, year, extra) => Object.assign({ type, series: [{ name: [model], year }], endDate: end }, extra);
const SSR = { page: { offersByType: [
  offer('cash', 'bZ', '2027', { cash: { cashAmount: '2250', label: 'Cash' }, offerTitle: 'TFS Lease Cash', trimLabel: 'Applies to 5 trims' }),
  offer('cash', 'bZ', '2026', { cash: { cashAmount: '3250', label: 'TFS Lease Cash' }, offerTitle: 'TFS Lease Cash', trimLabel: 'Applies to 5 trims' }),
  offer('cash', 'Tundra', '2026', { cash: { cashAmount: '1000', label: 'Customer Cash on Gas trims' }, offerTitle: 'Customer Cash' }),
  offer('cash', 'Camry', '2026', { cash: { cashAmount: '500', label: 'Cash' }, offerTitle: 'Bonus' }),
  offer('lease', 'Tundra', '2026', { lease: { monthlyPayment: '399', duration: '36', dueAtSigning: '4999' }, offerTitle: 'Lease', includedTrim: 'SR5', trimLabel: 'Applies to SR5' }),
  offer('apr', 'RAV4', '2026', { apr: { rate: '4.99', duration: '48' }, offerTitle: 'APR', trimLabel: 'Applies to 6 trims' })
] } };
const TOYOTA = '<html><body><div>Toyota offers</div><script>window.__SSR_STATE__ = ' + JSON.stringify(SSR) + ';</script></body></html>';
const audiCard = (desc, msrp, pay, due) => '<div>Lease Offer 2026 Audi ' + desc + ' MSRP starts from $' + msrp + ' $' + pay + ' *Monthly payment 36 Months $' + due
  + ' Due at Signing Excludes tax, title, license, options, and dealer fees. $0 security deposit. Offer ends November 2, 2026 *View offer details View inventory Contact dealer</div>';
const AUDI = '<html><body><h1>Audi Lafayette offers</h1>' + '<p>' + 'Offers for every model in the Audi lineup this month. '.repeat(12) + '</p>'
  + audiCard('Q7 45 TFSI quattro Premium', '67,395', '629', '6,999') + audiCard('Q7 S line 55 TFSI quattro Premium Plus', '78,440', '739', '7,999')
  + audiCard('Q3 quattro Base', '41,000', '499', '5,499') + '</body></html>';

(async () => {
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }).catch(() => chromium.launch());
  const page = await br.newPage();
  await page.route('**/*', r => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
  await page.goto('file://' + path.resolve(TOOL_ARG));
  const run = (html, mfr, dealer) => page.evaluate(([h, m, d]) => { try { return parseManufacturerPage(h, m, d, '2026-11-02').rows.map(r => r.year + ' ' + r.line); } catch (e) { return 'THREW ' + e.message; } }, [html, mfr, dealer]);

  console.log('\nToyota:');
  const t = await run(TOYOTA, 'Toyota', '6189');
  check('2027 bZ: a bare "Cash" label takes the offer title -> "$2,250 TFS Lease Cash"', Array.isArray(t) && t.includes('2027 bZ — $2,250 TFS Lease Cash'), true);
  check('a lease names its trim: "Tundra — $399/mo ... — applies to SR5"', Array.isArray(t) && t.includes('2026 Tundra — $399/mo 36 mo lease ($4,999 due at signing) — applies to SR5'), true);
  check('control: a specific label is kept as it was ("TFS Lease Cash", "Customer Cash on Gas trims")', Array.isArray(t) && [t.includes('2026 bZ — $3,250 TFS Lease Cash'), t.includes('2026 Tundra — $1,000 Customer Cash on Gas trims')], [true, true]);
  check('a bare "Cash" whose title names no cash program reads "Customer Cash", not "Cash"', Array.isArray(t) && t.includes('2026 Camry — $500 Customer Cash'), true);
  check('control: "Applies to 6 trims" names no trim and adds nothing', Array.isArray(t) && t.includes('2026 RAV4 — 4.99% APR for 48 mos'), true);

  console.log('\nAudi:');
  const a = await run(AUDI, 'Audi', '21135');
  check('the two Q7 leases say which is which: Premium and Premium Plus', Array.isArray(a) && [
    a.includes('2026 Q7 — $629/mo 36 mo lease ($6,999 due at signing) — applies to Q7 45 TFSI quattro Premium'),
    a.includes('2026 Q7 — $739/mo 36 mo lease ($7,999 due at signing) — applies to Q7 S line 55 TFSI quattro Premium Plus')], [true, true]);
  check('every line still opens with the model, which is what the extension matches on', Array.isArray(a) && Array.isArray(t) && a.concat(t).every(l => /^\d{4} [A-Za-z0-9 -]+ — /.test(l)), true);
  await br.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
