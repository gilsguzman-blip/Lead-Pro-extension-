#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('quoted-color-743.test.js');
// (v9.7.743) Community Kia Baytown lead 2086487722, 9/29 (log266, dump b154f2e7, page dump feb47adc). The customer
// replied at 4:37 "We are bit off on the Drive out price, It this your final price? Regards From: <agent> ... Sent: ...
// Subject: Subject:Black 2026 Sorento S availability". The "Black" is OUR 4:25 subject line quoted back by their mail
// client. The colour detector read it as a fresh ask, newer than our reply naming Panthera Metal, so the colour the
// v9.7.741/742 settlement had closed reopened and the draft offered a black S again. Gil: "customer replied back and
// the Drive out is in the conversation but the response is still dwelling on the Black option." The detector now
// reads only the customer-authored part (_lpCustomerAuthoredPart, the cutter the other customer-text readers use).
// Executes the shipped detector slice with the shipped _lpCustomerAuthoredPart. Placeholder data only.
//
// Usage: node tests/quoted-color-743.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), vm = require('vm'), path = require('path');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: quoted-color-743.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
function ago(days, hm) {
  const d = new Date(Date.now() - days * 86400000);
  return (d.getMonth() + 1 + '').padStart(2, '0') + '/' + (d.getDate() + '').padStart(2, '0') + '/' + d.getFullYear() + ' ' + hm;
}
const SW = { fromStock: 'TEST001A', toStock: 'TEST002A', fromColor: 'Midnight Lake Blue', fromInterior: 'Black', toColor: 'Panthera Metal', toInterior: 'Gray' };
const ASK   = '[' + ago(1, '10:16 AM') + '] [CUSTOMER] Email reply from prospect\n  Hello, I am looking for a new 2026 Sorento S. Black exterior and white interior.';
const LINK  = '[' + ago(1, '3:48 PM') + '] [CUSTOMER] Email reply from prospect\n  Hi Below is what I am interested in https://www.example-kia.com/auto/new-2026-kia-sorento-s/100000001/ regards';
const NAMED = '[' + ago(1, '4:25 PM') + '] [AGENT] Email reply to prospect\n  Subject: Black 2026 Sorento S availability By: Agent Name Hi Test, I see the Sorento you are interested in is actually Panthera Metal with a Gray interior.';
const QUOTED = '[' + ago(1, '4:37 PM') + '] [CUSTOMER] Email reply from prospect\n  We are bit off on the Drive out price, It this your final price? Regards From: Agent Name agent@example.com Sent: Tuesday, September 29, 2026 4:25 PM To: test@example.com Subject: Subject:Black 2026 Sorento S availability';
const AGAIN  = '[' + ago(1, '4:37 PM') + '] [CUSTOMER] Email reply from prospect\n  Thanks, but I still want the black one. Regards From: Agent Name agent@example.com Sent: Tuesday, September 29, 2026 4:25 PM To: test@example.com';

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  const between = (a, b) => { const i = src.indexOf(a); if (i < 0) throw new Error('not found: ' + a.slice(0, 40)); return src.slice(i, src.indexOf(b, i) + b.length); };
  const cutter = between('    function _lpCustomerAuthoredPart(raw) {', '\n    }\n');
  const detector = between('      var _lpColorRx = ', "acknowledge availability honestly.');\n      }");
  const scan = (lines, sw) => {
    const sb = { String, Date, Array, RegExp, concernScanLines: lines, allTranscriptText: lines.join(' '), _fricQuote: '', _fricState: '',
      customerConcerns: [], color: 'Panthera Metal', vin: '', _voiSwap: sw, _lpD() {} };
    vm.createContext(sb); vm.runInContext(cutter + '\n' + detector, sb); const c = sb.customerConcerns.join('\n');
    return [/SETTLED ON THE UNIT ON THE LEAD/.test(c), /MOVED OFF THE UNIT ON THE LEAD/.test(c)];
  };

  console.log(' 1. our email quoted under their reply is not them asking for a colour:');
  check('log266 shape: their price question with our "Black ... availability" subject quoted under it -> still SETTLED', () => scan([ASK, LINK, NAMED, QUOTED], SW), [true, false]);
  check('...and without the vehicle change, the listing link alone still settles it', () => scan([ASK, LINK, NAMED, QUOTED], null), [true, false]);
  check('control: before that reply arrived (the log265 state) -> SETTLED', () => scan([ASK, LINK, NAMED], SW), [true, false]);
  check('control: they write "I still want the black one" above the quote -> MOVED OFF, their colour leads again', () => scan([ASK, LINK, NAMED, AGAIN], SW), [false, true]);
  check('control: the first ask, with nothing after it -> MOVED OFF as before', () => scan([ASK], null), [false, true]);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
