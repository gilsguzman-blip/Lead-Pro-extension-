#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('voi-swap-742.test.js');
// (v9.7.742) Community Kia Baytown lead 2086487722, 9/29 (log265, page dump fe3da16e). PageData's LeadVehicle holds
// the unit on the lead now (DealerStockNum, ExternalColorName, InteriorColorName) and the unit the lead came in on
// (StockNumber, Color, InteriorColor). The store had changed it from a Midnight Lake Blue Sorento S to the Panthera
// Metal one; Lead Pro read only the current one, so the prompt carried our 9/19 "the Midnight Lake Blue ... is here"
// as a commitment with nothing saying the vehicle had changed. Gil: "Isn't the change inferred? when the agent
// emailed the customer with the correct color scheme and then the color changed as the customer's VOI on the lead."
// Now: the swap is detected, told to the model, our claims about the old unit are marked, and a swap plus our reply
// naming the new paint settles the customer's earlier colour ask (v9.7.741 needed their listing link for that).
// Executes the shipped scraper slices and the shipped popup block. Placeholder data only.
//
// Usage: node tests/voi-swap-742.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), vm = require('vm'), path = require('path');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: voi-swap-742.test.js <popup.js> [popup.js...]'); process.exit(2); }
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
const SWAPPED = { DealerStockNum: 'TEST002A', StockNumber: 'TEST001A', ExternalColorName: 'Panthera Metal', InteriorColorName: 'Gray', Color: 'Midnight Lake Blue', InteriorColor: 'Black' };
const ASK   = '[' + ago(1, '10:16 AM') + '] [CUSTOMER] Email reply from prospect\n  Hello, I am looking for a new 2026 Sorento S. Black exterior and white interior.';
// The swap as the scraper reports it, written out so sections 2 and 3 do not depend on section 1's slice.
const SW = { fromStock: 'TEST001A', toStock: 'TEST002A', fromColor: 'Midnight Lake Blue', fromInterior: 'Black', toColor: 'Panthera Metal', toInterior: 'Gray' };
const NAMED = '[' + ago(1, '4:25 PM') + '] [AGENT] Email reply to prospect\n  Test, the Sorento S we have for you is Panthera Metal with a Gray interior.';

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  const between = (a, b) => { const i = src.indexOf(a); if (i < 0) throw new Error('not found: ' + a.slice(0, 40)); const j = src.indexOf(b, i); return src.slice(i, j + b.length); };

  console.log(' 1. the scraper sees the store changed the vehicle:');
  const swap = (v) => { const sb = { String, _pdH_V: v, _lpD() {} }; vm.createContext(sb);
    vm.runInContext(between('    var _voiSwap = null;', '} catch (eSw) { _voiSwap = null; }'), sb); return vm.runInContext('_voiSwap', sb); };
  check('two stock numbers -> the old and new unit, with colours', () => swap(SWAPPED),
    { fromStock: 'TEST001A', toStock: 'TEST002A', fromColor: 'Midnight Lake Blue', fromInterior: 'Black', toColor: 'Panthera Metal', toInterior: 'Gray' });
  check('control (new slice): same stock number in both fields -> no swap', () => swap(Object.assign({}, SWAPPED, { StockNumber: 'TEST002A' })), null);
  check('control (new slice): no original stock number (the lead came in without a unit) -> no swap', () => swap(Object.assign({}, SWAPPED, { StockNumber: '' })), null);
  check('it is exported to the popup', () => /voiSwap: \(typeof _voiSwap !== 'undefined' && _voiSwap\) \? _voiSwap : null/.test(src), true);

  console.log(' 2. a swap plus our reply naming the new paint settles the colour ask, with no link needed:');
  const endMark = "acknowledge availability honestly.');\n      }";
  const detector = between('      var _lpColorRx = ', endMark);
  const scan = (lines, sw) => {
    const sb = { String, Date, Array, RegExp, concernScanLines: lines, allTranscriptText: lines.join(' '), _fricQuote: '', _fricState: '',
      customerConcerns: [], color: 'Panthera Metal', vin: '', _voiSwap: sw, _lpD() {} };
    vm.createContext(sb); vm.runInContext(detector, sb); const c = sb.customerConcerns.join('\n');
    return [/SETTLED ON THE UNIT ON THE LEAD/.test(c), /MOVED OFF THE UNIT ON THE LEAD/.test(c), /the store changed the vehicle on this lead to the Panthera Metal unit/.test(c)];
  };
  check('Black asked, vehicle swapped to Panthera Metal, our reply names it -> SETTLED, and says the store changed it', () => scan([ASK, NAMED], SW), [true, false, true]);
  check('control: the same arc with no swap and no link (the v9.7.613 re-pitch) -> MOVED OFF as before', () => scan([ASK, NAMED], null), [false, true, false]);
  check('control (new behaviour, needs the swap input): swapped, but no reply of ours names the new paint -> MOVED OFF as before', () => scan([ASK], SW), [false, true, false]);

  console.log(' 3. the popup tells the model and marks what we said about the old unit:');
  const pop = (sw, claim) => { const block = between('  // (v9.7.742) THE STORE CHANGED THE VEHICLE ON THIS LEAD', '  } catch (eScB) {}'); const sb = { String, RegExp, Object, vehicleExtras: [], console: { log() {} },
      d: { vehicle: '2026 Kia Sorento S', voiSwap: sw, selfClaims: { available: { text: claim, date: ago(10, '').trim(), ms: 1 } } } };
    vm.createContext(sb); vm.runInContext(block, sb); return sb.vehicleExtras.join('\n'); };
  const OLD = 'Test, the Midnight Lake Blue 2026 Kia Sorento S is here, and I can have everything ready.';
  const p = (() => { try { return pop(SW, OLD); } catch (e) { return 'THREW: ' + e.message; } })();
  check('the change is stated: came in on the Midnight Lake Blue (Black interior), now the Panthera Metal (Gray interior), work the current one', () =>
    [/THE STORE CHANGED THE VEHICLE ON THIS LEAD: it came in on a Midnight Lake Blue \(Black interior\) 2026 Kia Sorento S, and the vehicle on the lead now is the Panthera Metal \(Gray interior\) one/.test(p),
     /do not present the Midnight Lake Blue one as their car/.test(p)], [true, true]);
  check('our "Midnight Lake Blue ... is here" claim is marked as about the original vehicle', () => /is here, and I can have everything ready\." — ABOUT THE ORIGINAL VEHICLE/.test(p), true);
  check('control (new block): a claim about the current unit is not marked', () => /ABOUT THE ORIGINAL VEHICLE/.test(pop(SW, 'Test, the Panthera Metal Sorento S is here.')), false);
  check('control (new block): no swap -> no change line, the claim is unmarked', () => { const q = pop(null, OLD); return [/THE STORE CHANGED/.test(q), /ABOUT THE ORIGINAL VEHICLE/.test(q), /WE SAID IT WAS AVAILABLE/.test(q)]; }, [false, false, true]);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
