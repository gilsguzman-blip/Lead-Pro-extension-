#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('managers-883.test.js');
// (v9.7.883) THE STORES' MANAGERS. Owner, 11/18, with the roster by store (GM and GSM marked; the rest are Sales Managers), after lead
// 2096450291, where a Honda Lafayette manager who is not the lead's assigned Manager sent the service records and the prompt called him
// "your teammate". Executes _lpManagerRole and _lpQuoteWho with a placeholder roster swapped into the sandbox (no staff names here),
// and reads the shipped roster's shape. Placeholder data only.
//
// Usage: node tests/managers-883.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: managers-883.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const shipped = run('typeof STORE_MANAGERS === "object" ? JSON.parse(JSON.stringify(STORE_MANAGERS)) : null');
  check('the shipped roster: all five stores, 15 entries, 2 GM and 4 GSM entries (one GSM covers two stores)', () => shipped && [Object.keys(shipped).sort(), Object.values(shipped).reduce((n, l) => n + l.length, 0),
    Object.values(shipped).flat().filter(m => m[1] === 'GM').length, Object.values(shipped).flat().filter(m => m[1] === 'GSM').length], [['21135', '24399', '6189', '6190', '6191'], 15, 2, 4]);
  run('STORE_MANAGERS = { "24399": [["mgr gsm", "GSM"], ["mgr one", ""], ["mgr two", ""]], "21135": [["mgr gm", "GM"]] };');
  const who = (by, x) => run('_lpQuoteWho')({ by, first: by.split(' ')[0] }, Object.assign({ agent: 'Agent Name', salesRep: 'Rep Name', manager: 'Mgr Two', dealerId: '24399' }, x || {}));
  console.log(' who sent it:');
  check('lead 2096450291\'s shape: a store manager who is not the lead\'s Manager -> "one of our sales managers"', () => who('Mgr One'), 'Mgr, one of our sales managers,');
  check('the lead\'s assigned Manager -> "the sales manager on this lead"', () => who('Mgr Two'), 'Mgr, the sales manager on this lead,');
  check('the GSM -> "our general sales manager"', () => who('Mgr Gsm'), 'Mgr, our general sales manager,');
  check('the GM at another store -> "our general manager"', () => who('Mgr Gm', { dealerId: '21135', manager: '' }), 'Mgr, our general manager,');
  check('a lead Manager not on the roster -> "the manager on this lead"', () => who('Other Boss', { manager: 'Other Boss' }), 'Other, the manager on this lead,');
  check('control: the signer is "you", the Sales Rep "their salesperson", anyone else "your teammate"', () => [who('Agent Name'), who('Rep Name'), who('Some Body')], ['you', 'Rep, their salesperson,', 'Some, your teammate,']);
  check('control: a manager at another store is not one of ours here', () => who('Mgr Gm'), 'Mgr, your teammate,');
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
