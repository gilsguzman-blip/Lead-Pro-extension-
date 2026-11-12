#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('datatool-nov26.test.js');
// datatool/index.html, 11/3. Gil's November incentives file checked against the four pages it came from (Toyota, Honda
// Baytown, Honda Lafayette, Audi). Owner-approved fixes:
//  (1) Toyota leases name the drivetrain their payment is for, from the disclaimer's lease example ("applies to 4WD SR5"):
//      the 2WD and 4WD SR5 leases read as two prices for one truck.
//  (2) Two rates for one model, year and term (the 2026 Tundra's 1.99% and 2.99%) name the grades each excludes.
//  (3) Toyota cash is labeled by the program its disclaimer opens with: "Targeted Certificate" (proof of eligibility) and
//      "TFS Lease Cash" (lease only) both published as "Customer Cash".
//  (4) Offers for another state's residents only (California's CARB cash) are not published for a Texas store.
//  (5) Honda's "Featured Special Loyalty Lease" says it is for current Honda owners.
//  (6) Honda's "Loyalty/Conquest Offer" is labeled as both, not "Loyalty Cash".
//  (7) Audi's "Bonus Offer" cards (Customer Bonus, and the Loyalty Bonus for current Audi owners) are read; the 2027 Q9 and
//      SQ9 are in the model list.
// Runs the SHIPPED parseManufacturerPage in Chromium on fixtures cut from the real 11/3 pages (tests/fixtures/*-nov26-*).
//
// Usage: node tests/datatool-nov26.test.js [datatool/index.html]
const fs = require('fs'), path = require('path');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
const TOOL = path.join(__dirname, '..', 'datatool', 'index.html');
const TOOL_ARG = process.argv.slice(2).find(a => /\.html$/.test(a)) || TOOL;
const FX = path.join(__dirname, 'fixtures');
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const TOYOTA = '<html><body><div>Toyota offers</div><script>window.__SSR_STATE__ = '
  + JSON.stringify({ page: { offersByType: JSON.parse(fs.readFileSync(path.join(FX, 'toyota-offers-nov26-ssr.json'), 'utf8')).offersByType } }) + ';</script></body></html>';
const page_ = (f) => '<html><body><div>' + esc(fs.readFileSync(path.join(FX, f), 'utf8')) + '</div></body></html>';
const HONDA = page_('honda-offers-nov26-visible-text.txt'), AUDI = page_('audi-offers-nov26-visible-text.txt');
// Same offer, two values: a model, year, term (and due at signing / trim note) with more than one price, rate or amount.
function conflicts(rows) {
  const g = {};
  rows.forEach(r => {
    const m = r.match(/^(\d{4}) (.+?) — (.*)$/); if (!m) return;
    let k, v, x;
    if ((x = m[3].match(/^\$([\d,]+)\/mo (\d+) mo (.*)$/))) { k = 'lease|' + m[2] + '|' + m[1] + '|' + x[2] + '|' + x[3]; v = x[1]; }
    else if ((x = m[3].match(/^([\d.]+)% APR for ([\d-]+) mos(.*)$/))) { k = 'apr|' + m[2] + '|' + m[1] + '|' + x[2] + '|' + x[3]; v = x[1]; }
    else if ((x = m[3].match(/^\$([\d,]+) (.*)$/))) { k = 'cash|' + m[2] + '|' + m[1] + '|' + x[2]; v = x[1]; }
    else return;
    (g[k] = g[k] || new Set()).add(v);
  });
  return Object.keys(g).filter(k => g[k].size > 1);
}

(async () => {
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }).catch(() => chromium.launch());
  const page = await br.newPage();
  await page.clock.install({ time: new Date('2026-11-03T12:00:00-06:00').getTime() });   // the day the pages were saved
  await page.route('**/*', r => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
  await page.goto('file://' + path.resolve(TOOL_ARG));
  const run = (html, mfr, dealer, manual) => page.evaluate(([h, m, d, man]) => {
    try { const r = parseManufacturerPage(h, m, d, man); return { rows: r.rows.map(x => x.year + ' ' + x.line), warnings: r.warnings }; }
    catch (e) { return { rows: [], warnings: ['THREW ' + e.message] }; } }, [html, mfr, dealer, manual || null]);
  const has = (rows, l) => rows.includes(l);

  console.log('\nToyota Baytown (6189):');
  const t = await run(TOYOTA, 'Toyota', '6189');
  check('the 2WD and 4WD SR5 leases say which is which (36 mo: $279 2WD, $319 4WD)', [
    has(t.rows, '2026 Tacoma — $279/mo 36 mo lease ($3,999 due at signing) — applies to 2WD SR5'),
    has(t.rows, '2026 Tacoma — $319/mo 36 mo lease ($3,999 due at signing) — applies to 4WD SR5')], [true, true]);
  check('the 2026 bZ XLE: $489 2WD, $529 4WD', [
    has(t.rows, '2026 bZ — $489/mo 36 mo lease ($3,999 due at signing) — applies to 2WD XLE'),
    has(t.rows, '2026 bZ — $529/mo 36 mo lease ($3,999 due at signing) — applies to 4WD XLE')], [true, true]);
  check('the Tundra\'s two rates name the grades each excludes', [
    has(t.rows, '2026 Tundra — 1.99% APR for 60 mos — excludes SR, SR5, Limited'),
    has(t.rows, '2026 Tundra — 2.99% APR for 60 mos — excludes Platinum, 1794')], [true, true]);
  check('control: one rate for one term is left alone (the Tacoma\'s two 3.99% offers stay one plain line)', [
    has(t.rows, '2026 Tacoma — 3.99% APR for 48 mos'), t.rows.filter(r => /^2026 Tacoma — 3\.99% APR for 48 mos/.test(r)).length], [true, 1]);
  check('cash is labeled by its program: a targeted certificate and lease-only cash are not "Customer Cash"', [
    has(t.rows, '2026 bZ — $2,500 Targeted Certificate (eligible customers only, proof of eligibility required)'),
    has(t.rows, '2026 bZ — $1,500 TFS Lease Cash (lease only)'),
    has(t.rows, '2027 bZ — $500 TFS Lease Cash (lease only)'),
    t.rows.filter(r => /^20\d\d (?:bZ|bZ Woodland|C-HR) — \$[\d,]+ Customer Cash$/.test(r)).length], [true, true, true, 0]);
  check('control: real Customer Cash keeps its label (Tundra $1,000)', has(t.rows, '2026 Tundra — $1,000 Customer Cash'), true);
  check('California residents\' CARB cash is not published for a Texas store, and the tool says why', [
    t.rows.filter(r => /residents only|CARB/i.test(r)).length, t.warnings.some(w => /another state's residents only/.test(w))], [0, true]);
  check('no offer is left with two prices for one configuration', conflicts(t.rows), []);
  check('189 lines (the 195 published, less the 6 California-only)', t.rows.length, 189);
  const st = await page.evaluate(() => typeof ipResidentsOnlyElsewhere !== 'function' ? 'no helper' : [ipResidentsOnlyElsewhere('$1,750 CARB Cash (California residents only)', '6189'),
    ipResidentsOnlyElsewhere('Texas residents only', '6189'), ipResidentsOnlyElsewhere('Louisiana residents only', '24399'), ipResidentsOnlyElsewhere('no limit', '6189')]);
  check('the state check: another state\'s offer is named, the store\'s own state is not', st, ['California', '', '', '']);

  console.log('\nHonda (6191; Baytown and Lafayette carry the same offers):');
  const h = await run(HONDA, 'Honda', '6191', '2027-01-04');
  check('the Accord\'s loyalty lease says it is for current Honda owners; the regular lease is unchanged', [
    has(h.rows, '2026 Accord — $209/mo 36 mo loyalty lease (current Honda owners) ($3,999 due at signing) — applies to FWD LX'),
    has(h.rows, '2026 Accord — $229/mo 36 mo lease ($3,999 due at signing) — applies to FWD LX')], [true, true]);
  check('the Prologue\'s Loyalty/Conquest offer is labeled as both', has(h.rows, '2026 Prologue — $2,000 Loyalty/Conquest Cash (current owners, or owners switching from another brand) — shown on AWD Touring'), true);
  check('control: plain loyalty and conquest cash are unchanged', [
    has(h.rows, '2026 Accord — $750 Loyalty Cash — shown on FWD LX'), has(h.rows, '2027 CR-V — $750 Conquest Cash — shown on AWD EX')], [true, true]);
  check('no offer is left with two prices for one configuration; still 52 lines', [conflicts(h.rows), h.rows.length], [[], 52]);

  console.log('\nAudi Lafayette (21135):');
  const a = await run(AUDI, 'Audi', '21135');
  check('the Customer Bonus cards are read', [
    has(a.rows, '2026 Q3 — $1,500 Customer Bonus'), has(a.rows, '2026 Q7 — $6,000 Customer Bonus'), has(a.rows, '2026 A8 — $15,000 Customer Bonus'),
    has(a.rows, '2026 S3 — $3,500 Customer Bonus')], [true, true, true, true]);
  check('the Loyalty Bonus says it is for current Audi owners', [
    has(a.rows, '2026 Q3 — $750 Loyalty Bonus (current Audi owners)'), has(a.rows, '2027 Q7 — $1,500 Loyalty Bonus (current Audi owners)')], [true, true]);
  check('the 2027 Q9 and SQ9 rates are read', [has(a.rows, '2027 Q9 — 4.99% APR for 60 mos'), has(a.rows, '2027 SQ9 — 4.99% APR for 60 mos')], [true, true]);
  check('control: the leases and rates already published are all still there', [
    has(a.rows, '2026 Q7 — $629/mo 36 mo lease ($6,999 due at signing) — applies to Q7 45 TFSI quattro Premium'),
    has(a.rows, '2026 Q7 — $739/mo 36 mo lease ($7,999 due at signing) — applies to Q7 S line 55 TFSI quattro Premium Plus'),
    has(a.rows, '2026 A8 — 3.99% APR for 60 mos'), has(a.rows, '2027 SQ7 — 4.99% APR for 60 mos')], [true, true, true, true]);
  check('no offer is left with two prices for one configuration; 56 lines (23 before)', [conflicts(a.rows), a.rows.length], [[], 56]);

  await br.close();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
