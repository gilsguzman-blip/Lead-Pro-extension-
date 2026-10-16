#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('datatool-honda-trim.test.js');
// datatool/index.html, 10/1. Two faults Gil found the same afternoon:
//  (1) Honda's October pages (Baytown and Lafayette, identical but for the ZIP) name a trim on every lease and Special
//      Program card -- "CR-V See All Offers Featured Special Lease 2026 AWD LX $279/mo for 39 mos $4,899 due at signing"
//      -- and the tool wrote only "CR-V — $279/mo ...", so the AWD LX ($4,899 due) and 2WD LX ($4,199 due) leases read
//      as two prices for one car. It also wrote Honda's "Sales Credit" as "Customer Cash", and kept only the first rate
//      of "3.99% APR 24-60 mos 4.99% APR 61-72 mos", so a 72-month buyer read 3.99%.
//  (2) "when I launch the site from Cloudflare the page shows stale incentives." The page source was recovered (9/4)
//      from a browser Save As taken after an August session, so the August results -- "Audi AUG26.html · 15 offers",
//      "Uploaded to Lead Pro ✓", 107 rows, Toyota 14 lines to 2026-08-31 -- were frozen into the HTML and shown on
//      every load, whatever had been uploaded since.
// Runs the SHIPPED page in Chromium: a fresh load, and parseManufacturerPage on a synthetic page shaped like October's.
//
// Usage: node tests/datatool-honda-trim.test.js [datatool/index.html]
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
const card = (model, label, body) => '<div><h3>' + model + '</h3><a>See All Offers</a><p>' + label + '</p><p>' + body + '</p></div>';
const HONDA = '<html><body><nav>Current Offers 77520 Models SUVS &amp; CROSSOVERS CR-V HR-V Pilot SEDANS Accord Sedan</nav>'
  + '<p>' + 'Shop current Honda offers near you this month. '.repeat(12) + '</p>'
  + card('Accord Sedan', 'Finance', '2026 3.99% APR 24-60 mos¹ 4.99% APR 61-72 mos')
  + card('CR-V', 'Featured Special Lease', '2026 AWD LX $279/mo for 39 mos $4,899 due at signing¹')
  + card('CR-V', 'Featured Special Lease', '2026 2WD LX $279/mo for 39 mos $4,199 due at signing¹')
  + card('CR-V', 'Special Program', '2026 AWD EX-L $750¹ Honda Loyalty Appreciation Offer')
  + card('Odyssey', 'Special Program', '2026 FWD Touring $2,000¹ Sales Credit')
  + card('Pilot', 'Finance', '2026 2.99% APR 24-36 mos¹')
  + card('All Vehicles', 'Special Program', 'undefined null undefined $500¹ Honda Military Appreciation Offer')
  + '</body></html>';

(async () => {
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }).catch(() => chromium.launch());
  const page = await br.newPage();
  await page.route('**/*', r => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
  await page.goto('file://' + path.resolve(TOOL_ARG));

  console.log('\nA fresh load shows no earlier session\'s incentives:');
  const fresh = await page.evaluate(() => ({
    rows: document.querySelectorAll('#inc-rows tr').length,
    shown: document.getElementById('inc-summary').classList.contains('show'),
    text: ['inc-msg', 'inc-page-msg', 'inc-page-filelist', 'inc-filelist', 'inc-statline'].map(id => document.getElementById(id).textContent.trim()).join(''),
    goOff: document.getElementById('inc-go').disabled,
  }));
  check('no store table rows and no results panel on load (was Toyota 14 lines to 2026-08-31 ...)', [fresh.rows, fresh.shown], [0, false]);
  check('no "Uploaded to Lead Pro ✓", no "Audi AUG26.html" chip, no 107-row stats', fresh.text, '');
  check('Normalize waits for a file, as the inventory tab does', fresh.goOff, true);

  const rows = await page.evaluate(h => { try { return parseManufacturerPage(h, 'Honda', '6191', '2026-11-02').rows.map(r => r.year + ' ' + r.line); } catch (e) { return 'THREW ' + e.message; } }, HONDA);
  const has = l => Array.isArray(rows) && rows.includes(l);
  console.log('\nHonda:');
  check('the AWD and 2WD LX leases say which is which', [has('2026 CR-V — $279/mo 39 mo lease ($4,899 due at signing) — applies to AWD LX'),
    has('2026 CR-V — $279/mo 39 mo lease ($4,199 due at signing) — applies to 2WD LX')], [true, true]);
  check('a Special Program card names the trim it pictures without limiting the offer to it ("shown on")', has('2026 CR-V — $750 Loyalty Cash — shown on AWD EX-L'), true);
  check('Honda\'s "Sales Credit" keeps its name (was "Customer Cash")', has('2026 Odyssey — $2,000 Sales Credit — shown on FWD Touring'), true);
  check('both rate tiers are kept: "3.99% APR for 24-60 mos, 4.99% APR for 61-72 mos"', has('2026 Accord — 3.99% APR for 24-60 mos, 4.99% APR for 61-72 mos'), true);
  check('control: a single-tier finance card is as before, with no trim', has('2026 Pilot — 2.99% APR for 24-36 mos'), true);
  check('control: the all-vehicle Military card is still left out', Array.isArray(rows) && rows.some(l => /Military|All Vehicles/.test(l)), false);
  check('every line still opens with the model, which is what the extension matches on', Array.isArray(rows) && rows.length > 0 && rows.every(l => /^\d{4} [A-Za-z0-9 -]+ — /.test(l)), true);
  await br.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
