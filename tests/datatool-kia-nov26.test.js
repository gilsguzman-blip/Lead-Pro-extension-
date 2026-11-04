#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('datatool-kia-nov26.test.js');
// datatool/index.html, 11/4. Kia's November offers page (Kia Baytown 6190) read card by card (ipChunkKiaOffers). The file the
// old chunker produced (134 lines) filed the Hybrid, Plug-in Hybrid, Hatchback and Carnival Hybrid offers under the base model
// ("Sorento -- $3,500 Customer Cash" is the Plug-in Hybrid's), dropped every lease's trim, published Bonus Cash on specially
// tagged vehicles and Retail Bonus Cash as "Customer Cash" (merging the 2026 Sportage's two $750s), lost the Carnival cash
// trims, dropped the EV3 and invented "Telluride -- 0.90% APR for 24 mos", and read the EV6's rate tiers as one range.
// Owner-approved 11/4 ("fix the Kia parsing"). Runs the SHIPPED parseManufacturerPage in Chromium on the page's visible
// text (tests/fixtures/kia-offers-nov26-visible-text.txt), with the page's own "valid through" date.
//
// Usage: node tests/datatool-kia-nov26.test.js [datatool/index.html]
const fs = require('fs'), path = require('path');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
const TOOL_ARG = process.argv.slice(2).find(a => /\.html$/.test(a)) || path.join(__dirname, '..', 'datatool', 'index.html');
const FX = path.join(__dirname, 'fixtures', 'kia-offers-nov26-visible-text.txt');
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const KIA = '<html><body><div>' + esc(fs.readFileSync(FX, 'utf8')) + '</div></body></html>';
// Same offer, two values: a model, year, term and trim note (or cash label) with more than one price, rate or amount.
function conflicts(rows) {
  const g = {};
  rows.forEach(r => {
    const m = r.match(/^(\d{4}) (.+?) — (.*)$/); if (!m) return;
    let k, v, x;
    if ((x = m[3].match(/^\$([\d,]+)\/mo (\d+) mo (.*)$/))) { k = 'lease|' + m[2] + '|' + m[1] + '|' + x[2] + '|' + x[3]; v = x[1]; }
    else if ((x = m[3].match(/^([\d.]+)% APR for (\d+) mos(.*)$/))) { k = 'apr|' + m[2] + '|' + m[1] + '|' + x[2] + '|' + x[3]; v = x[1]; }
    else if ((x = m[3].match(/^\$([\d,]+) (.*)$/))) { k = 'cash|' + m[2] + '|' + m[1] + '|' + x[2]; v = x[1]; }
    else return;
    (g[k] = g[k] || new Set()).add(v);
  });
  return Object.keys(g).filter(k => g[k].size > 1);
}

(async () => {
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }).catch(() => chromium.launch());
  const page = await br.newPage();
  await page.clock.install({ time: new Date('2026-11-04T12:00:00-06:00').getTime() });
  await page.route('**/*', r => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
  await page.goto('file://' + path.resolve(TOOL_ARG));
  const run = (html, mfr, dealer, manual) => page.evaluate(([h, m, d, man]) => {
    try { const r = parseManufacturerPage(h, m, d, man); return { rows: r.rows.map(x => x.year + ' ' + x.line), models: r.rows.map(x => x.category), warnings: r.warnings }; }
    catch (e) { return { rows: [], models: [], warnings: ['THREW ' + e.message] }; } }, [html, mfr, dealer, manual || null]);
  const has = (rows, l) => rows.includes(l);

  console.log('\nKia Baytown (6190), November page:');
  const k = await run(KIA, 'Kia', '6190', '2027-01-04');
  check('every one of the page\'s 162 offer cards is one line, and no offer has two prices', [k.rows.length, conflicts(k.rows)], [162, []]);
  check('the Hybrid and Plug-in Hybrid are their own models: the gas Sorento\'s cash is $2,750, the Plug-in Hybrid\'s $3,500', [
    has(k.rows, '2026 Sorento — $2,750 Customer Cash'), has(k.rows, '2026 Sorento Hybrid — $2,750 Customer Cash'),
    has(k.rows, '2026 Sorento Plug-in Hybrid — $3,500 Customer Cash'), k.rows.some(r => /^2026 Sorento — \$3,500/.test(r))], [true, true, true, false]);
  check('Hatchback, Carnival Hybrid, Sportage Plug-in Hybrid and Telluride Hybrid are named as such', [
    has(k.rows, '2026 K4 Hatchback — 2.90% APR for 48 mos'), has(k.rows, '2026 Carnival Hybrid — $459/mo 36 mo lease ($3,999 due at signing) — applies to LXS FWD'),
    has(k.rows, '2026 Sportage Plug-in Hybrid — $359/mo 36 mo lease ($3,999 due at signing) — applies to X-Line AWD'),
    has(k.rows, '2027 Telluride — 3.49% APR for 48 mos'), has(k.rows, '2027 Telluride Hybrid — 3.99% APR for 48 mos')], [true, true, true, true, true]);
  check('every lease says the trim and drivetrain it is for (2026 Sorento: LX FWD $339, S FWD $379, S AWD $399 at 36 months)', [
    has(k.rows, '2026 Sorento — $339/mo 36 mo lease ($3,999 due at signing) — applies to LX FWD'),
    has(k.rows, '2026 Sorento — $379/mo 36 mo lease ($3,999 due at signing) — applies to S FWD'),
    has(k.rows, '2026 Sorento — $399/mo 36 mo lease ($3,999 due at signing) — applies to S AWD'),
    k.rows.filter(r => / mo lease /.test(r) && !/ — applies to /.test(r)).length], [true, true, true, 0]);
  check('Bonus Cash on specially tagged vehicles says so, beside the regular Customer Cash (2026 Sportage: both $750)', [
    has(k.rows, '2026 Sportage — $750 Customer Cash'), has(k.rows, '2026 Sportage — $750 Bonus Cash (specially tagged vehicles only)'),
    has(k.rows, '2026 K5 — $750 Bonus Cash (specially tagged vehicles only)')], [true, true, true]);
  check('Retail Bonus Cash is not "Customer Cash"', [has(k.rows, '2026 Carnival — $750 Retail Bonus Cash'), has(k.rows, '2026 Sorento Plug-in Hybrid — $750 Retail Bonus Cash')], [true, true]);
  check('the Carnival\'s cash says the trims it is for: $2,000 SX Prestige, $1,500 LX, LXS, EX, SX', [
    has(k.rows, '2026 Carnival — $2,000 Customer Cash — applies to SX Prestige'), has(k.rows, '2026 Carnival — $1,500 Customer Cash — applies to LX, LXS, EX, SX')], [true, true]);
  check('the EV3\'s four offers are read; the Telluride has no 0.90% rate', [
    k.rows.filter(r => /^2027 EV3 — /.test(r)), k.rows.some(r => /Telluride.*0\.90%/.test(r))],
    [['2027 EV3 — $1,500 Customer Cash', '2027 EV3 — $359/mo 36 mo lease ($3,999 due at signing) — applies to Wind FWD', '2027 EV3 — 0.90% APR for 48 mos',
      '2027 EV3 — $409/mo 36 mo lease ($3,999 due at signing) — applies to Wind AWD'], false]);
  check('the EV6\'s rate tiers are spelled out by term; the EV APR bonus cash is said', [
    has(k.rows, '2026 EV6 — 0% APR for up to 60 mos, 0.99% APR for up to 66 mos, 1.49% APR for up to 72 mos, 2.49% APR for up to 84 mos'),
    has(k.rows, '2026 Niro EV — 0% APR for 72 mos (includes $3,500 APR Bonus Cash)'), has(k.rows, '2026 EV9 — 0% APR for 60 mos (includes $5,000 APR Bonus Cash)')], [true, true, true]);
  check('the Telluride\'s owner and conquest bonuses say who they are for', [
    has(k.rows, '2027 Telluride — $750 Owner Loyalty Bonus (current Kia owners)'), has(k.rows, '2027 Telluride — $750 Competitive Bonus (conquest; qualified owners of another brand)')], [true, true]);
  check('the row\'s model is the variant ("Sorento Plug-in Hybrid", "Carnival Hybrid", "K4 Hatchback"; never "Carnival MPV")', [
    k.models.includes('Sorento Plug-in Hybrid'), k.models.includes('Carnival Hybrid'), k.models.includes('K4 Hatchback'), k.models.some(m => /MPV/.test(m))], [true, true, true, false]);
  check('control: the Military Program ("Additional Offer") is not published', k.rows.some(r => /Military/i.test(r)), false);
  check('control: with no "valid through" date, only the two EV6 cards that print their own date (01/04/2027) are published', (await run(KIA, 'Kia', '6190')).rows,
    ['2026 EV6 — $5,000 Customer Cash', '2026 EV6 — 0% APR for up to 60 mos, 0.99% APR for up to 66 mos, 1.49% APR for up to 72 mos, 2.49% APR for up to 84 mos']);
  const plain = '<html><body><div>Kia offers this month for Texas shoppers. ' + 'Browse the lineup and current programs. '.repeat(12)
    + ' 2026 K5 $750 Customer Cash available toward purchase. Offer ends 01/04/2027.</div></body></html>';
  check('control: a Kia page without offer cards still goes through the old reader', (await run(plain, 'Kia', '6190')).rows, ['2026 K5 — $750 Customer Cash']);

  await br.close();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
