#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('winner-780.test.js');
// (v9.7.780) Honda Lafayette, 10/9, a BD agent's PC: the vindebug marker had not rendered, so ECCS alone named lead
// 2097030012 -- marked DUPLICATE_LEAD/BAD by the CRM, no lead panel, no notes -- while the lead page on screen was
// 2096976782 on the same customer record. Its frames were rejected as "autoLeadId mismatch" and the grab came back with a
// name and a store only (no BD agent, VOI or source). On another PC the marker rendered and the grab was right.
// Executes the shipped correction (lifted from the grab's merge, as appt-booked-727 lifts the appointment block) on
// frames shaped like that log, and the shipped _lpDumpPrompt placeholder. Placeholder data only.
//
// Usage: node tests/winner-780.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: winner-780.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const DUP = '2000000001', PANEL = '2000000003', OTHER = '2000000002';
const dupFrame = (st) => ({ result: { autoLeadId: DUP, isLeadFrame: true, _voiFromPanel: false, _pdDiag: { present: false, di: { leadId: DUP, status: st || 'DUPLICATE_LEAD', statusType: st ? 'ACTIVE' : 'BAD' } } } });
const bareDup = () => ({ result: { autoLeadId: DUP, isLeadFrame: true, _voiFromPanel: false, _pdDiag: { present: false } } });
const panelFrame = (lid, grid) => ({ result: { autoLeadId: lid, isLeadFrame: true, _voiFromPanel: true, vehicle: '2026 Honda Accord Sedan SE', agent: 'Agent Name',
  _leadSelectorIds: grid, _pdDiag: { present: true, leadIdMatch: true } } });

for (const f of BUILDS) {
  const src = fs.readFileSync(f, 'utf8');
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const a = src.indexOf("          // (v9.7.780) THE CRM'S \"ACTIVE LEAD\" WAS A DUPLICATE"), b = src.indexOf('          var _aid = window._activeLeadId || \'\';', a);
  const run = (winner, eccsOnly, sorted) => {
    if (a < 0 || b < 0) return '(not in this build)';
    const ctx = { window: { _activeLeadId: winner, _lpEccsOnlyWinner: eccsOnly ? winner : '' }, sorted, console: { log() {} }, String, Array, Object, JSON };
    vm.createContext(ctx); vm.runInContext(src.slice(a, b), ctx); return ctx.window._activeLeadId;
  };
  console.log(' 1. the 10/9 shape:');
  const FR = () => [dupFrame(), bareDup(), bareDup(), panelFrame(PANEL, [DUP, OTHER, PANEL])];
  check('(new helper) ECCS-only duplicate/BAD lead with no page, one other lead page on the same record -> that lead', () => run(DUP, true, FR()), PANEL);
  console.log(' 2. when it must not switch:');
  check('(new helper) the vindebug marker agreed with ECCS (not ECCS-only) -> kept', () => run(DUP, false, FR()), DUP);
  check('(new helper) the ECCS lead is not marked duplicate or bad (an active lead still loading) -> kept', () => run(DUP, true, [dupFrame('NEW_LEAD'), panelFrame(PANEL, [DUP, PANEL])]), DUP);
  check('(new helper) the ECCS lead has its own page -> kept', () => run(DUP, true, [dupFrame(), panelFrame(DUP, [DUP, PANEL]), panelFrame(PANEL, [DUP, PANEL])]), DUP);
  check('(new helper) two other leads have a page -> kept (no guessing)', () => run(DUP, true, [dupFrame(), panelFrame(PANEL, [DUP, PANEL, OTHER]), panelFrame(OTHER, [DUP, PANEL, OTHER])]), DUP);
  check('(new helper) the other page\'s lead grid does not list the ECCS lead (another customer) -> kept', () => run(DUP, true, [dupFrame(), panelFrame(PANEL, [PANEL])]), DUP);
  console.log(' 3. the wiring:');
  check('the pre-scrape records an ECCS-only winner, and clears it at the start of each grab', () =>
    [/window\._lpEccsOnlyWinner = _dualConfirmed \? '' : String\(window\._activeLeadId \|\| ''\);/.test(src), /window\._lpEccsOnlyWinner = '';[^\n]*\n\s*console\.log\('\[Lead Pro\] Pre-scrape: eccs='/.test(src)], [true, true]);
  check('the correction runs before frames are filtered by the winner', () => a > 0 && b > a && src.indexOf("Frame rejected — autoLeadId mismatch", b) > b, true);
  console.log(' 4. _lpDumpPrompt() before any generation:');
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  check('(new helper) it exists from load and says to generate first', () => {
    const fn = vm.runInContext('typeof window._lpDumpPrompt === "function" ? window._lpDumpPrompt : null', sb);
    if (!fn) return 'missing';
    const logs = []; const ol = sb.console.log; sb.console.log = (...x) => logs.push(x.join(' '));
    let r; try { r = fn(); } finally { sb.console.log = ol; }
    return [r, logs.some(l => /nothing captured yet -- generate a response in this Lead Pro panel first/.test(l))]; }, [false, true]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
