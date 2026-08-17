#!/usr/bin/env node
'use strict';
/**
 * arc-bound.test.js — regression tests for v9.7.544.
 *
 *  A. SPLIT-FRAME vehicle adoption must refuse when the ACTIVE lead's own panel
 *     rendered with no vehicle (VOI-less) rather than being absent (no panel).
 *  B. The conversation arc must be built from the transcript fences, so the
 *     scaffold block sitting between the agent-context notes and the transcript
 *     can never be absorbed into the last dated entry.
 *
 * Both are sliced out of each shipped popup.js. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2);
if (!BUILDS.length) { console.error('usage: arc-bound.test.js <popup.js> [popup.js...]'); process.exit(2); }

function build(file) {
  const src = fs.readFileSync(file, 'utf8');
  const ctx = { console: { log() {} } };
  vm.createContext(ctx);

  // ── A: the active-panel-empty discriminator, verbatim from the shipped block ──
  const a0 = src.indexOf('              var _sfActivePanelEmpty = false;');
  // (v9.7.551) the refusal now carries three reasons, so the branch is keyed on _sfRefuseReason;
  // slice up to it and keep testing _sfActivePanelEmpty, which is still the discriminator this
  // suite is about.
  const a1 = src.indexOf('              // (v9.7.551/550) THE THIRD GATE');
  if (a0 < 0 || a1 < 0) throw new Error('could not locate the split-frame guard in ' + file);
  const refuses = vm.runInContext(
    '(function(sorted, _aid){\n' + src.slice(a0, a1) + '\nreturn _sfActivePanelEmpty; })', ctx);

  // ── B: the transcript-fence bounding, verbatim from the shipped block ──
  const b0 = src.indexOf("    var _ctxRaw = data.context || '';");
  const b1 = src.indexOf('    var ctxEntries = ctx_full.split(');
  if (b0 < 0 || b1 < 0) throw new Error('could not locate the arc bounding in ' + file);
  const bound = vm.runInContext(
    '(function(data){\n' + src.slice(b0, b1) + '\nreturn ctx_full; })', ctx);

  return { name: path.basename(path.dirname(file)), refuses, bound };
}

const impls = BUILDS.map(build);
let pass = 0, fail = 0;
function eq(name, fn, want) {
  const results = impls.map(i => { try { return JSON.stringify(fn(i)); } catch (e) { return 'THREW: ' + e.message; } });
  const agree = results.every(r => r === results[0]);
  const ok = agree && results[0] === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; console.log('  FAIL ' + name);
    if (!agree) impls.forEach((i, n) => console.log('        ' + i.name + ' -> ' + results[n]));
    else console.log('        expected ' + JSON.stringify(want) + '\n        got      ' + results[0]);
  }
}

const frame = (leadId, vehicle, panelText, rawLen) =>
  ({ result: { autoLeadId: leadId, vehicle: vehicle, _voiDiag: { panelText: panelText, rawLen: rawLen } } });

console.log('\nv9.7.544 — VOI adoption guard + arc bounding');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── A ─────────────────────────────────────────────────────────────────────────
console.log('A. split-frame adoption — refuse when the lead is genuinely VOI-less:');
eq('Maci Alvarado: active panel rendered "(New)" with no vehicle → REFUSE',
  i => i.refuses([frame('2019154122', '', '(New)', 5), frame(null, '2017 KIA SOUL', '2017 KIA SOUL', 13)], '2019154122'),
  true);
eq('active panel rendered a full stub with no year/make/model → REFUSE',
  i => i.refuses([frame('2019154122', '', '(New) Stock #: t6144553 Style: -- None --', 41), frame(null, '2019 Kia Soul', '2019 Kia Soul', 13)], '2019154122'),
  true);

console.log('\n   …and still adopt in the case the guard was built for:');
eq('active frame has NO panel element at all → allow adoption',
  i => i.refuses([frame('2019154122', '', '(no panel element)', 0), frame(null, '2026 Kia Carnival', '2026 Kia Carnival', 17)], '2019154122'),
  false);
eq('active frame rendered a panel AND supplied its own vehicle → not the empty case',
  i => i.refuses([frame('2019154122', '2026 Kia Carnival', '2026 Kia Carnival (New)', 23), frame(null, '2017 KIA SOUL', '2017 KIA SOUL', 13)], '2019154122'),
  false);
eq('no frame carries the active lead id → guard inert, prior logic governs',
  i => i.refuses([frame(null, '2017 KIA SOUL', '2017 KIA SOUL', 13)], '2019154122'),
  false);
eq('active frame present but _voiDiag missing → guard inert (cannot prove empty)',
  i => i.refuses([{ result: { autoLeadId: '2019154122', vehicle: '' } }, frame(null, '2017 KIA SOUL', '2017 KIA SOUL', 13)], '2019154122'),
  false);

// ── B ─────────────────────────────────────────────────────────────────────────
console.log('\nB. arc bounding — scaffold between the two dated sections is excluded:');

const REAL_SHAPE =
  'AGENT CONTEXT — READ THIS FIRST. These notes may reflect events that happened AFTER...\n' +
  '[08/06/2026 11:34 AM] [NOTE] General Note\n  By: Rotaxlyn Hudson *Sales rep was alerted*\n' +
  '[05/15/2026 11:06 AM] [CALL NOTE] Outbound phone call (Machine)\n  By: JOSE AREVALO\n  Left message\n' +
  'EXIT SIGNAL: customer has declined or is no longer interested. Acknowledge it and write a gracious close only.\n' +
  'Total CRM entries: 25\n' +
  'MOST RECENT CUSTOMER MESSAGE [sent TODAY]: "Not needed. Already purchased another vehicle"\n' +
  'CONVERSATION TRANSCRIPT (newest first — read the full thread before responding):\n---\n' +
  '[08/12/2026 11:12 AM] [CUSTOMER] Inbound Text Message\n  Not needed. Already purchased another vehicle\n' +
  '[08/12/2026 10:49 AM] [AGENT] Outbound Text Message\n  No problem! What day would you like to reschedule?\n' +
  '[05/15/2026 11:06 AM] [CALL NOTE] Outbound phone call (Machine)\n  By: JOSE AREVALO Left message\n---\n' +
  '\n\nVEHICLE/LEAD DETAILS:\n⚠ CUSTOMER NAME SOURCE: use ONLY the customer name given to you above';

const bounded = impls[0].bound({ context: REAL_SHAPE });
eq('the EXIT SIGNAL directive is outside the bounded arc',
  () => /EXIT SIGNAL/.test(bounded), false);
eq('the AGENT CONTEXT header is outside', () => /AGENT CONTEXT/.test(bounded), false);
eq('Total CRM entries scaffold is outside', () => /Total CRM entries/.test(bounded), false);
eq('the appended VEHICLE/LEAD DETAILS block is outside',
  () => /VEHICLE\/LEAD DETAILS/.test(bounded), false);
eq('the real customer message survives',
  () => /Not needed\. Already purchased another vehicle/.test(bounded), true);
eq('the real agent message survives',
  () => /What day would you like to reschedule/.test(bounded), true);
eq('CALL NOTE entries inside the transcript survive (nothing lost)',
  () => /\[CALL NOTE\] Outbound phone call \(Machine\)/.test(bounded), true);
eq('the JOSE AREVALO note appears ONCE, not twice (duplicate removed)',
  () => (bounded.match(/JOSE AREVALO/g) || []).length, 1);

console.log('\n   fallback when the fences are absent:');
const NO_FENCE = '[08/12/2026 11:12 AM] [CUSTOMER] Inbound Text Message\n  hello there';
eq('no CONVERSATION TRANSCRIPT marker → whole context returned unchanged',
  i => i.bound({ context: NO_FENCE }), NO_FENCE);
eq('empty context → unchanged', i => i.bound({ context: '' }), '');
eq('marker present but body empty → falls back rather than emptying the arc',
  i => i.bound({ context: 'CONVERSATION TRANSCRIPT (newest first):\n---\n\n---\n' }),
  'CONVERSATION TRANSCRIPT (newest first):\n---\n\n---\n');

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
