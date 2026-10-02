#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('color-settled-741.test.js');
// (v9.7.741) Community Kia Baytown lead 2086487722, 9/29 (log265). The customer asked for a Black S with a white
// interior, then sent the store's listing for the unit they wanted, and the agent replied that that car is Panthera
// Metal with a Gray interior, with its price. The v9.7.613 detector still read "Black" as the ask, so the prompt said
// the Panthera Metal unit is "NOT what they are asking for now ... never fall back to it", and the draft offered a
// black S. Gil: "The customer was incorrect that it was Black with white. The model didn't pick up on the change in
// the arc and kept the Black track."
// The colour ask is SETTLED when, after the customer named the colour, they sent a listing link AND our reply names
// the lead unit's paint, and they have named no colour since. Our reply alone does not settle it (the v9.7.613 case:
// an agent re-pitching the lead's unit to a customer who asked for another colour).
// Executes the shipped scraper detector slice and the shipped popup colour block. Placeholder data only.
//
// Usage: node tests/color-settled-741.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), vm = require('vm'), path = require('path');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: color-settled-741.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
// Dates relative to the clock, in the transcript's own format.
function ago(days, hm) {
  const d = new Date(Date.now() - days * 86400000);
  return (d.getMonth() + 1 + '').padStart(2, '0') + '/' + (d.getDate() + '').padStart(2, '0') + '/' + d.getFullYear() + ' ' + hm;
}
const ASK   = '[' + ago(1, '10:16 AM') + '] [CUSTOMER] Email reply from prospect\n  Hello, I am looking for a new 2026 Sorento S. Black exterior and white interior. Please send a drive out price.';
const WHITE = '[' + ago(1, '3:36 PM') + '] [AGENT] Email reply to prospect\n  Test, White is not an interior option in the Sorento. Are you looking for FWD or AWD?';
const LINK  = '[' + ago(1, '3:48 PM') + '] [CUSTOMER] Email reply from prospect\n  Hi Below is what I am interested in https://www.example-kia.com/auto/new-2026-kia-sorento-s/100000001/ regards';
const NAMED = '[' + ago(1, '4:25 PM') + '] [AGENT] Email reply to prospect\n  Test, thanks for sending the link. I see the Sorento you are interested in is actually Panthera Metal with a Gray interior.';
const AGAIN = '[' + ago(0, '9:05 AM') + '] [CUSTOMER] Email reply from prospect\n  I really want the black one though.';
const EARLY = '[' + ago(3, '9:25 AM') + '] [AGENT] Outbound Text Message\n  Test, the Panthera Metal 2026 Sorento S is here.';

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  const a = src.indexOf('      var _lpColorRx = ');
  const endMark = "acknowledge availability honestly.');\n      }";
  const detector = src.slice(a, src.indexOf(endMark, a) + endMark.length);
  const scan = (lines) => {
    const logs = [];
    const sb = { String, Date, Array, RegExp, concernScanLines: lines, allTranscriptText: lines.join(' '), _fricQuote: '', _fricState: '',
      customerConcerns: [], color: 'Panthera Metal', vin: '', _lpD: (...x) => logs.push(x.join(' ')) };
    vm.createContext(sb); vm.runInContext(detector, sb);
    const c = sb.customerConcerns.join('\n');
    return { moved: /MOVED OFF THE UNIT ON THE LEAD/.test(c), settled: /SETTLED ON THE UNIT ON THE LEAD/.test(c),
      out: vm.runInContext('typeof _colorSettled !== "undefined" && _colorSettled ? _colorSettled.asked : ""', sb), concerns: c, logs: logs.join('\n') };
  };

  console.log(' 1. the colour ask is settled by the arc:');
  const r = scan([ASK, WHITE, LINK, NAMED]);
  check('log265 shape: Black asked, listing sent, our reply names Panthera Metal -> SETTLED, not MOVED OFF', () => [r.settled, r.moved, r.out], [true, false, 'Black']);
  check('...the concern works the lead unit and closes Black, the diag says why', () =>
    [/The Panthera Metal unit on the lead IS the car/.test(r.concerns), /do NOT say a Black one is here or offer to look for one/.test(r.concerns),
     /SETTLED — since naming it they sent a listing/.test(r.logs)], [true, true, true]);
  check('control: our reply names Panthera Metal but they sent no listing (the v9.7.613 re-pitch) -> MOVED OFF as before', () => { const x = scan([ASK, NAMED]); return [x.moved, x.settled]; }, [true, false]);
  check('control: they sent a listing but our reply does not name the lead unit\'s paint -> MOVED OFF as before', () => { const x = scan([ASK, WHITE, LINK]); return [x.moved, x.settled]; }, [true, false]);
  check('control: after all that they ask for black again -> MOVED OFF as before', () => { const x = scan([ASK, WHITE, LINK, NAMED, AGAIN]); return [x.moved, x.settled]; }, [true, false]);
  check('control: we named Panthera Metal only BEFORE they asked for black -> MOVED OFF as before', () => { const x = scan([EARLY, ASK, LINK]); return [x.moved, x.settled]; }, [true, false]);

  console.log(' 2. the scraper hands the popup a settled colour, not the ask:');
  check('customerStatedColor is blanked and colorAskSettled carries the old ask', () =>
    [/customerStatedColor: \(typeof _statedColor === 'string' && !\(typeof _colorSettled !== 'undefined' && _colorSettled\) \? _statedColor : ''\)/.test(src),
     /colorAskSettled: \(typeof _colorSettled !== 'undefined' && _colorSettled\) \? _colorSettled\.asked : ''/.test(src)], [true, true]);

  console.log(' 3. the popup colour line says how it was settled:');
  const span = (mark, end) => { const i = src.indexOf(mark); return src.slice(i, src.indexOf(end, i) + end.length); };
  const clean = span('function _lpCleanColor(c){', '\n}\n') + '\n' + span('function _lpColorWords(s){', 'return set; }\n');
  const block = span('  if (_lpInvConfirmedAvailable) {\n    // ── (v9.7.660)', '\n  } else if (_audiAllAvail').replace(/ else if \(_audiAllAvail$/, '');
  const paint = (settled) => {
    const sb = { String, Object, _lpInvConfirmedAvailable: true, _lpInvUnit: { stock: 'TEST001A', color: 'Panthera Metal' },
      d: { stockNum: 'TEST001A', color: 'Panthera Metal', customerStatedColor: '', colorAskSettled: settled }, vehicleExtras: [], console: { log() {} } };
    vm.createContext(sb); vm.runInContext(clean + '\n' + block, sb); return sb.vehicleExtras.join('\n');
  };
  const p = paint('Black');
  check('settled: "the colour question is closed", names the old ask, and does not claim colour never came up', () =>
    [/THE COLOUR IS ALREADY SETTLED/.test(p), /the colour question is closed: they first asked for Black, then sent us the listing for this car, and our reply told them it is Panthera Metal/.test(p),
     /do not offer or look for a Black one/.test(p), /has not raised colour/.test(p)], [true, true, true, false]);
  check('control: nothing settled -> the original "has not raised colour" line', () => { const q = paint(''); return [/has not raised colour, trim or configuration/.test(q), /question is closed/.test(q)]; }, [true, false]);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
