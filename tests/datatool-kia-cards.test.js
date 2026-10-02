#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('datatool-kia-cards.test.js');
// datatool/index.html, 10/2. Kia's October page (Kia_Offers_Oct26.html) went live as 110 lines that merged every
// Hybrid and Plug-in Hybrid into its gas model: one "Sorento" with twelve unlabeled leases and $3,000 AND $3,500
// cash, a 2027 Sportage at 1.99% AND 0.90%, the Carnival's SX-Prestige-only $2,500 as every Carnival's, no trim on
// any lease, no EV3 at all, and "Telluride — 0.90% APR for 24 mos", which Kia's page does not carry. Every Kia card
// reads "<TYPE> <year> <vehicle and trim> <offer>", so the tool now reads each card whole.
// Runs the SHIPPED page in Chromium on a synthetic page shaped like October's.
//
// Usage: node tests/datatool-kia-cards.test.js [datatool/index.html]
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
const tail = { CASH: ' available toward purchase', LEASE: ' Due at Signing for Qualified Lessees', FINANCE: ' for Qualified Customers' };
const card = (type, vehicle, offer, extra) => '<div><p>' + type + '</p><p>' + vehicle + '</p><p>' + offer + '</p><p>'
  + (extra || '') + (type === 'LEASE' ? '' : tail[type]) + '</p><a>Offer details.</a><a>Get A Quote</a><a>View Inventory</a></div>';
const lease = (vehicle, pay, mo, das) => card('LEASE', vehicle, '$' + pay + '/month ' + mo + ' Months', '$' + das + tail.LEASE);
const KIA = '<html><body><nav>Seltos $24,990 starting MSRP Sportage $28,990 starting MSRP Sorento Telluride</nav>'
  + '<p>' + 'Results for Special Offers on New Models. '.repeat(14) + '</p>'
  + '<h3>Sorento (6 Matching)</h3>' + card('CASH', '2026 Sorento', '$3,000 Customer Cash')
  + lease('2026 Sorento LX FWD', 329, 24, '3,999') + card('FINANCE', '2026 Sorento', '0% APR 48 Months')
  + lease('2026 Sorento S AWD', 399, 36, '3,999')
  + '<div>Cash Offer 2026 Sorento $3,000 Customer Cash available toward purchase. Must take delivery by 11/02/2026.</div>'
  + '<h3>Sorento Hybrid (6 Matching)</h3>' + card('CASH', '2026 Sorento Hybrid', '$3,000 Customer Cash')
  + lease('2026 Sorento Hybrid EX FWD', 409, 24, '3,999')
  + '<h3>Sorento Plug-in Hybrid</h3>' + card('CASH', '2026 Sorento Plug-in Hybrid', '$3,500 Customer Cash')
  + '<h3>Sportage</h3>' + card('FINANCE', '2027 Sportage', '1.99% APR 48 Months')
  + card('FINANCE', '2027 Sportage Hybrid', '0.90% APR 48 Months')
  + '<h3>Carnival</h3>' + card('CASH', '2026 Carnival MPV SX Prestige', '$2,500 Customer Cash')
  + card('CASH', '2026 Carnival MPV', '$1,500 Customer Cash') + lease('2026 Carnival MPV Hybrid LXS FWD', 459, 36, '3,999')
  + '<h3>Niro EV</h3>' + card('FINANCE', '2026 Niro EV', '0% APR 72 Months, Including $3,500 APR Bonus Cash')
  + '<h3>Telluride</h3>' + card('CASH', '2027 Telluride', '$750 Owner Loyalty Bonus For Qualified Customers', '').replace(tail.CASH, '')
  + card('CASH', '2027 Telluride', '$750 Competitive Bonus Program For Qualified Customers', '').replace(tail.CASH, '')
  + card('FINANCE', '2027 Telluride', '3.99% APR 48 Months') + lease('2027 Telluride S AWD', 469, 24, '3,999')
  + '<h3>EV3</h3>' + lease('2027 EV3 Wind FWD', 359, 36, '3,999')
  + '<h3>Military Program</h3><p>Additional Offer</p><p>Military Program</p><p>$500 Military Program For Qualified Customers</p>'
  + '</body></html>';

(async () => {
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }).catch(() => chromium.launch());
  const page = await br.newPage();
  await page.route('**/*', r => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
  await page.goto('file://' + path.resolve(TOOL_ARG));
  const out = await page.evaluate(h => { try { const o = parseManufacturerPage(h, 'Kia', '6190', '2026-11-02'); return { rows: o.rows.map(r => r.year + ' ' + r.line), models: o.rows.map(r => r.category), source: o.source }; } catch (e) { return { rows: 'THREW ' + e.message }; } }, KIA);
  const rows = out.rows;
  const has = l => Array.isArray(rows) && rows.includes(l);
  console.log('\nKia:');
  check('read card by card, not by model-name proximity', out.source, 'kia-cards');
  check('a Sorento lease names its trim', has('2026 Sorento — $329/mo 24 mo lease ($3,999 due at signing) — applies to LX FWD'), true);
  check('the Hybrid lease is the Sorento Hybrid\'s, not the Sorento\'s', [has('2026 Sorento Hybrid — $409/mo 24 mo lease ($3,999 due at signing) — applies to EX FWD'),
    Array.isArray(rows) && rows.some(l => /^2026 Sorento — \$409/.test(l))], [true, false]);
  check('$3,500 cash is the Plug-in Hybrid\'s only (was "Sorento — $3,000" AND "$3,500")', [has('2026 Sorento Plug-in Hybrid — $3,500 Customer Cash'),
    Array.isArray(rows) && rows.some(l => /^2026 Sorento — \$3,500/.test(l))], [true, false]);
  check('2027 Sportage 1.99% and Sportage Hybrid 0.90% stay apart', [has('2027 Sportage — 1.99% APR for 48 mos'), has('2027 Sportage Hybrid — 0.90% APR for 48 mos'),
    has('2027 Sportage — 0.90% APR for 48 mos')], [true, true, false]);
  check('Carnival $2,500 applies to SX Prestige; the $1,500 is every Carnival\'s', [has('2026 Carnival — $2,500 Customer Cash — applies to SX Prestige'), has('2026 Carnival — $1,500 Customer Cash')], [true, true]);
  check('"Carnival MPV Hybrid" is the Carnival Hybrid', has('2026 Carnival Hybrid — $459/mo 36 mo lease ($3,999 due at signing) — applies to LXS FWD'), true);
  check('APR Bonus Cash stays on the 0% line', has('2026 Niro EV — 0% APR for 72 mos, including $3,500 APR Bonus Cash'), true);
  check('Telluride bonuses keep Kia\'s printed names', [has('2027 Telluride — $750 Owner Loyalty Bonus'), has('2027 Telluride — $750 Competitive Bonus Program')], [true, true]);
  check('Telluride carries only the rate its card prints (no 0.90%/24)', Array.isArray(rows) && rows.filter(l => /^2027 Telluride — .*APR/.test(l)), ['2027 Telluride — 3.99% APR for 48 mos']);
  check('the Telluride S AWD 24-month lease is kept', has('2027 Telluride — $469/mo 24 mo lease ($3,999 due at signing) — applies to S AWD'), true);
  check('EV3 is read', has('2027 EV3 — $359/mo 36 mo lease ($3,999 due at signing) — applies to Wind FWD'), true);
  check('the "Cash Offer" detail overlay does not add a second copy', Array.isArray(rows) && rows.filter(l => l === '2026 Sorento — $3,000 Customer Cash').length, 1);
  check('control: the Military Program card is still left out', Array.isArray(rows) && rows.some(l => /Military/.test(l)), false);
  check('control: no MSRP becomes cash', Array.isArray(rows) && rows.some(l => /24,990|28,990/.test(l)), false);
  check('every line opens with its model, which is what the extension matches on', Array.isArray(rows) && rows.length > 0 && rows.every((l, i) => l.startsWith(l.slice(0, 5) + out.models[i] + ' — ')), true);
  await br.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
