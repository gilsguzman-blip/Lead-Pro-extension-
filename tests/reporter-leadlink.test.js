#!/usr/bin/env node
'use strict';
// (v9.7.597) Registered BEFORE anything can throw. A suite that dies during module
// evaluation prints nothing, and nothing reads exactly like 'asserted nothing wrong'.
// See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('reporter-leadlink.test.js');

/**
 * reporter-leadlink.test.js — regression tests for the Rejected Sessions LEAD column (reporter v1.12).
 *
 * The feature request assumed the IDs were top-level fields on the KV entry (`e.autoLeadId`).
 * They are not. The proxy's POST /feedback writes
 *   { id, ts, rating, signal, trigger, regenCount, chipCount, chipsUsed, meta, drafts? }
 * and extension v9.7.489/484 put autoLeadId / customerId / stockNum / vin / dealerId inside
 * `meta` — the same bundle the reporter already reads store/leadSource/scenario/convState from.
 * Reading `e.autoLeadId` would have produced an empty column on every row and thrown nothing,
 * so this suite asserts the row is populated from real entry shapes rather than that it renders.
 *
 * Both blocks are sliced out of the shipped reporter file.
 *
 *   usage: reporter-leadlink.test.js <reporter.js>
 */
const fs = require('fs');
const vm = require('vm');

const FILE = process.argv[2];
if (!FILE) { console.error('usage: reporter-leadlink.test.js <reporter.js>'); process.exit(2); }
const src = fs.readFileSync(FILE, 'utf8');

function cut(from, to, what) {
  const a = src.indexOf(from), b = src.indexOf(to, a + 1);
  if (a < 0 || b < 0 || b <= a) { require('./lib/fatal-guard.js').bail('reporter-leadlink.test.js', 'could not locate ' + what); }
  return src.slice(a, b);
}

const ctx = { console: { log() {} } };
vm.createContext(ctx);

// The URL helper, verbatim.
vm.runInContext(cut('const VIN_BASE =', '\n// Module-scope singletons', 'the vinLeadUrl helper'), ctx);
const vinLeadUrl = vm.runInContext('vinLeadUrl', ctx);

// ctHM is needed by the row renderer. Stop the slice at the v1.12 helper block, which now sits
// between the CT helpers and the singletons — otherwise VIN_BASE is declared twice.
vm.runInContext(cut('const _CT_FMT = new Intl.DateTimeFormat', '\n// (v1.12) VinSolutions deep link', 'the CT helpers'), ctx);

// The downSessions push, exercised exactly as the aggregation loop does — one raw entry in,
// one row out — so a row can never be paired with another entry's ID.
const pushRow = vm.runInContext(
  '(function(e){ const downSessions = [];\n' +
  '  if (e.rating === "down") downSessions.push({\n' +
  cut("            ts: e.ts || '', signal: e.signal || '', regenCount: e.regenCount || 0,",
      '          });', 'the downSessions push') +
  '  });\n  return downSessions[0] || null; })', ctx);

// The row renderer for the table.
const renderRows = vm.runInContext(
  '(function(downSessions){ const fd = { downSessions };\n' +
  '  const tr = (cells) => "<tr>" + cells.map(c => "<td>" + c + "</td>").join("") + "</tr>";\n' +
  '  const downRows = ' +
  cut('(fd.downSessions || [])\n      .slice().sort', "      ])).join('');").replace(/^\s*const downRows = /, '') +
  "      ])).join('');\n  return downRows; })", ctx);

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name);
         console.log('        expected ' + JSON.stringify(want) + '\n        got      ' + JSON.stringify(got)); }
}
function truthy(name, got) { eq(name, !!got, true); }

// Real 8/13 rejected sessions, in the shape the proxy actually stores them.
const entry = (o) => Object.assign({
  id: 'gen_' + Math.random().toString(36).slice(2), ts: '2026-08-13T20:40:49.000Z',
  rating: 'down', signal: 'explicit', regenCount: 0, chipCount: 0, chipsUsed: [], meta: {}
}, o);

const BROUSSARD = entry({
  ts: '2026-08-13T15:31:00.000Z', signal: 'explicit', regenCount: 1,
  meta: { autoLeadId: '2067692473', customerId: '1440099537', stockNum: 'P7471', dealerId: '21135',
          store: 'Audi Lafayette', leadSource: 'Audi Partner Lead - Used/Cpo',
          scenario: 'oem', convState: 'first-touch', persona: 'bdc' }
});
const KAMAKEAWONG = entry({
  ts: '2026-08-13T20:40:49.000Z', signal: 'implicit_regen_no_copy', regenCount: 2,
  meta: { autoLeadId: '2067899945', customerId: '1440262683', stockNum: 'TB011755A', dealerId: '6191',
          store: 'Community Honda Baytown', leadSource: 'Cars.Com Finance Intent',
          scenario: 'standard', convState: 'first-touch', persona: 'bdc' }
});

console.log('\nreporter v1.12 — Rejected Sessions LEAD column');
console.log('file under test: ' + FILE + '\n');

console.log('THE THING THE REQUEST GOT WRONG — the IDs are on e.meta, not on e:');
eq('autoLeadId is read from meta and populated', pushRow(BROUSSARD).autoLeadId, '2067692473');
eq('customerId is read from meta and populated', pushRow(BROUSSARD).customerId, '1440099537');
eq('stockNum rides along for vehicle-side questions', pushRow(BROUSSARD).stockNum, 'P7471');
eq('a top-level e.autoLeadId is NOT what feeds the row (proves the meta read)',
  pushRow(Object.assign({}, BROUSSARD, { autoLeadId: 'WRONG-9999999', meta: Object.assign({}, BROUSSARD.meta, { autoLeadId: '2067692473' }) })).autoLeadId,
  '2067692473');
eq('...and an entry carrying ONLY a top-level id yields an empty cell, not a wrong link',
  pushRow(entry({ autoLeadId: '2067692473', meta: { store: 'Audi Lafayette' } })).autoLeadId, '');

console.log('\nthe existing columns are untouched:');
eq('store keeps its "Community " strip', pushRow(KAMAKEAWONG).store, 'Honda Baytown');
eq('leadSource', pushRow(KAMAKEAWONG).leadSource, 'Cars.Com Finance Intent');
eq('scenario', pushRow(KAMAKEAWONG).scenario, 'standard');
eq('convState', pushRow(KAMAKEAWONG).convState, 'first-touch');
eq('regenCount', pushRow(KAMAKEAWONG).regenCount, 2);
eq('signal', pushRow(KAMAKEAWONG).signal, 'implicit_regen_no_copy');

console.log('\nthe URL — the pattern the extension documents at the capture site:');
eq('both IDs present',
  vinLeadUrl('2067692473', '1440099537'),
  'https://vinsolutions.app.coxautoinc.com/vinconnect/#/CarDashboard/Pages/LeadManagement/logcall.aspx?AutoLeadID=2067692473&GlobalCustomerID=1440099537');
eq('customerId missing — AutoLeadID alone still lands on the lead',
  vinLeadUrl('2067692473', ''),
  'https://vinsolutions.app.coxautoinc.com/vinconnect/#/CarDashboard/Pages/LeadManagement/logcall.aspx?AutoLeadID=2067692473');
eq('no lead id — no URL at all rather than a broken one', vinLeadUrl('', '1440099537'), '');
eq('ids are URL-encoded', vinLeadUrl('a b&c', 'x=y'),
  'https://vinsolutions.app.coxautoinc.com/vinconnect/#/CarDashboard/Pages/LeadManagement/logcall.aspx?AutoLeadID=a%20b%26c&GlobalCustomerID=x%3Dy');

console.log('\nrendering — a real day\'s rows:');
const rows = renderRows([BROUSSARD, KAMAKEAWONG].map(pushRow));
truthy('Broussard\'s row links to HIS lead', rows.includes('AutoLeadID=2067692473&GlobalCustomerID=1440099537'));
truthy('Kamakeawong\'s row links to HERS', rows.includes('AutoLeadID=2067899945&GlobalCustomerID=1440262683'));
truthy('links open in a new tab, safely', rows.includes('rel="noopener"'));
eq('exactly two links for two rows', (rows.match(/<a href=/g) || []).length, 2);

console.log('\n   THE IDENTITY GATE — no row may carry another row\'s lead:');
const pairs = [...rows.matchAll(/AutoLeadID=(\d+)&GlobalCustomerID=(\d+)/g)].map(m => m[1] + '/' + m[2]);
eq('each lead id is paired with its own customer id', pairs, ['2067692473/1440099537', '2067899945/1440262683']);
// Order the table by time and confirm the ids travel with their own rows rather than the index.
const reordered = renderRows([KAMAKEAWONG, BROUSSARD].map(pushRow));
eq('sorting by time does not shuffle ids between rows',
  [...reordered.matchAll(/AutoLeadID=(\d+)&GlobalCustomerID=(\d+)/g)].map(m => m[1] + '/' + m[2]),
  ['2067692473/1440099537', '2067899945/1440262683']);
truthy('the row with the EARLIER timestamp renders first (Broussard 15:31 before 20:40)',
  reordered.indexOf('2067692473') < reordered.indexOf('2067899945'));

console.log('\n   pre-v9.7.489 rows degrade honestly:');
const LEGACY = entry({ meta: { store: 'Community Toyota Baytown', leadSource: 'Cargurus',
                               scenario: 'cargurus', convState: 'active-follow-up', persona: 'bdc' } });
const legacyRows = renderRows([pushRow(LEGACY)]);
truthy('no anchor tag is emitted', !legacyRows.includes('<a href='));
truthy('an em-dash is shown instead', legacyRows.includes('—'));
truthy('the rest of the row still renders', legacyRows.includes('Toyota Baytown'));

console.log('\n   an empty-meta row cannot reach this table at all:');
eq('an incomplete session is not rating "down", so it produces no row',
  pushRow(entry({ rating: 'incomplete', meta: {} })), null);

console.log('\nthe table header carries the new column:');
truthy("header is ['Time CT','Store','Lead Source','Scenario','State','Regens','Signal','Lead']",
  src.includes("['Time CT','Store','Lead Source','Scenario','State','Regens','Signal','Lead']"));
eq('header column count matches the cells each row emits',
  8, pushRow(BROUSSARD) ? renderRows([pushRow(BROUSSARD)]).split('<td>').length - 1 : -1);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
