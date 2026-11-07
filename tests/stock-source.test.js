#!/usr/bin/env node
'use strict';
// (v9.7.696) WHEN PAGEDATA DESCRIBES THIS LEAD, IT OWNS THE UNIT IDENTITY.
//
// Live, 9/23 (Toyota Baytown): Brandy Mooney's VOI was a generic "2024 Toyota Tundra (Used)" from a
// website chat, Mike Stewart's a generic "2022 Toyota RAV4 (New)". PageData was present for both
// leads with NO stock and NO VIN on the LeadVehicle — yet the page-wide "Stock #" regex found stock
// text elsewhere on the page (TT069306B, TE152985A), and both drafts told the customer the car was
// here. The regex fallback now only runs when PageData is ABSENT for the lead.
//
// Executes the SHIPPED scraper lines that choose stockNum and the VIN override.
const fs = require('fs');
const path = require('path');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: stock-source.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };

function chooser(src) {
  const a = src.indexOf('    const _rgxStock = (stockNumRaw && stockNumRaw.length < 15) ? stockNumRaw : \'\';');
  const b = src.indexOf('\n', src.indexOf('    const stockNum = ', a));
  const v = src.indexOf('    if (LP_PD_PRIMARY && _pdVinH) vin = _pdVinH;');
  const ve = src.indexOf('\n', src.indexOf('\n', v) + 1);
  if (a < 0 || b < 0 || v < 0) throw new Error('stock/vin choosers NOT FOUND — extraction failed');
  const stockBody = src.slice(a, b);
  let vinBody = src.slice(v, ve);
  if (!/^\s*else if \(_pdOwnsUnit\)/m.test(vinBody.split('\n')[1] || '')) vinBody = vinBody.split('\n')[0];   // older builds: one line
  return (x) => new Function('x',
    'var LP_PD_PRIMARY = true, stockNumRaw = x.rgxStock, _pdStockH = x.pdStock, _pdVinH = x.pdVin,' +
    ' _pdHoist = x.pd ? {} : null, _pdLeadIdH = x.pd ? "2088322429" : "", autoLeadId = x.aid || "", vin = x.rgxVin;\n' +
    stockBody + '\n' + vinBody + '\nreturn { stock: stockNum, vin: vin };')(x);
}

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  let run; try { run = chooser(src); } catch (e) { ok(false, e.message); continue; }
  const brandy = run({ pd: true, pdStock: '', pdVin: '', rgxStock: 'TT069306B', rgxVin: '', aid: '2088322429' });
  ok(brandy.stock === '', "Brandy's shape: PageData present with no stock → the page-text stock TT069306B is REFUSED");
  const mike = run({ pd: true, pdStock: '', pdVin: '', rgxStock: 'TE152985A', rgxVin: '', aid: '2088322429' });
  ok(mike.stock === '', "Mike's shape: same → TE152985A refused");
  const q6 = run({ pd: true, pdStock: '', pdVin: '', rgxStock: 'SA023556', rgxVin: 'WAU2EAGH9SA023556', aid: '2088322429' });
  ok(q6.stock === '' && q6.vin === '', 'the 8/18 Audi shape: a customer-typed VIN and its suffix-stock are both refused when PageData owns the unit');
  const real = run({ pd: true, pdStock: 'TA047502', pdVin: '1HGCY2F7XTA047502', rgxStock: 'TA047502', rgxVin: '', aid: '2088322429' });
  ok(real.stock === 'TA047502' && real.vin === '1HGCY2F7XTA047502', 'control: a real PageData unit is kept, stock and VIN');
  const nopd = run({ pd: false, pdStock: '', pdVin: '', rgxStock: 'P4886', rgxVin: '', aid: '' });
  ok(nopd.stock === 'P4886', 'control: with PageData ABSENT the regex fallback still runs');
  const other = run({ pd: true, pdStock: '', pdVin: '', rgxStock: 'P4886', rgxVin: '', aid: '9999999999' });
  ok(other.stock === 'P4886', 'PageData for a DIFFERENT lead (id conflict) does not own this lead\'s unit → regex fallback');
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
