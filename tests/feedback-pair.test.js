#!/usr/bin/env node
'use strict';
// Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('feedback-pair.test.js');

/**
 * feedback-pair.test.js — v9.7.644. THE REJECTED-DRAFT PAIR WAS A COPY OF ITSELF.
 *
 * Gil's 9/5 feedback export, Kia Baytown lead 2079186130. Three generations 19 seconds apart,
 * then a send — and the CRM proves the ending: the 11:11 AM outbound text is verbatim the third
 * draft. But the two rows the agent moved off carry
 *
 *     "final": { "sms": "...2.90% APR for 48 months or the $239/month lease program..." }
 *     "prior": { "sms": "...2.90% APR for 48 months or the $239/month lease program..." }
 *
 * byte-identical. The one row flushed by the COPY handler carries a correct pair. So the defect
 * is not in the capture — it is in WHEN the capture runs, and it lands on exactly the rows the
 * feature exists for: the rejected ones.
 *
 * CAUSE, and it is one ordering. _lpFeedbackFlush lives INSIDE _lpFeedbackReset ("Flush BEFORE
 * the wipe"), and generateAll ran
 *
 *     window._leadProPriorDraft = { ...on-screen draft... };   // snapshot
 *     _lpFeedbackReset();                                      // ...which flushes the OUTGOING row
 *
 * The outgoing row reads `final` from the output fields and `prior` from _leadProPriorDraft — and
 * the snapshot had just overwritten _leadProPriorDraft with those same fields. The row was handed
 * its own draft as the draft it replaced. v9.7.312's header says the snapshot "survives
 * _lpFeedbackReset", which it does; what it did not survive is being read by the flush inside it.
 *
 * THIS SUITE EXECUTES THE ORDER THE FILE ACTUALLY HAS. The two statements are lifted from
 * generateAll IN SOURCE ORDER and run against the verbatim pair-capture expression lifted out of
 * _lpFeedbackSend, driving Kevin Dyson's real three-generation chain. A source-position assertion
 * alone would have been satisfied by either order with a comment moved, which is the v9.7.563
 * false-green shape; the ordering is therefore PROVED BY ITS OUTPUT, and the position check is
 * kept only as a second, cheaper tripwire.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: feedback-pair.test.js <popup.js> [popup.js...]'); process.exit(2); }

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const bail = (m) => require('./lib/fatal-guard.js').bail('feedback-pair.test.js', m);

// ── Kevin Dyson's three drafts, from the export. Scrubbed exactly as shipped ([NAME]/[PHONE]). ──
const G1 = 'I can verify the exact match, and for qualified buyers there are current K4 programs '
         + 'including a 36-month lease from $239/month or 2.90% APR for 48 months.';
const G2 = 'I will confirm the exact match and can also review the current qualified-buyer offers, '
         + 'including 2.90% APR for 48 months or the $239/month lease program.';
const G3 = 'I can confirm the exact match and have everything ready for a visit today at 1:15 PM or 2:00 PM';

function load(file) {
  const src = fs.readFileSync(file, 'utf8');

  // (1) The two statements, lifted IN FILE ORDER. Whichever comes first in the file comes first
  //     in the region, so the region IS the ordering under test.
  const A_SNAP  = '  // (v9.7.312) PAIR CAPTURE';
  const A_RESET = '  // Reset feedback tracking for this generation session';
  const iSnap = src.indexOf(A_SNAP), iReset = src.indexOf(A_RESET);
  if (iSnap < 0)  bail('PAIR CAPTURE block not in ' + file + ' — THE SUITE DID NOT LOAD');
  if (iReset < 0) bail('reset call site not in ' + file + ' — THE SUITE DID NOT LOAD');
  if (src.indexOf(A_SNAP, iSnap + 1) >= 0)   bail('PAIR CAPTURE anchor is not unique in ' + file);
  if (src.indexOf(A_RESET, iReset + 1) >= 0) bail('reset anchor is not unique in ' + file);
  const endSnap  = src.indexOf('})();\n', iSnap) + '})();\n'.length;
  const endReset = src.indexOf('_lpFeedbackReset();\n', iReset) + '_lpFeedbackReset();\n'.length;
  if (endSnap <= iSnap || endReset <= iReset) bail('statement ends not found in ' + file);
  const prelude = src.slice(Math.min(iSnap, iReset), Math.max(endSnap, endReset));
  if (!/_lpFeedbackReset\(\);/.test(prelude) || !/_leadProPriorDraft/.test(prelude)) {
    bail('lifted prelude is missing one of the two statements in ' + file);
  }

  // (2) The pair capture, verbatim out of _lpFeedbackSend. This is the expression whose two
  //     halves collapsed, so it is executed rather than re-typed.
  const pStart = src.indexOf('      var _g = function(id){ var el = document.getElementById(id);');
  if (pStart < 0) bail('pair-capture block not found in ' + file);
  const pAnchor = src.indexOf('prior: _scrub3(window._leadProPriorDraft', pStart);
  if (pAnchor < 0) bail('pair-capture prior half not found in ' + file);
  const pEnd = src.indexOf('      };\n', pAnchor);
  if (pEnd < 0) bail('pair-capture block end not found in ' + file);
  const capture = src.slice(pStart, pEnd + '      };\n'.length);
  if (!/payload\.drafts = \{/.test(capture)) bail('lifted capture does not assign payload.drafts in ' + file);

  return { src, prelude, capture };
}

/**
 * Runs the SHIPPED prelude (both statements, in file order) against a fake panel.
 *   state.visible      — is the regen strip showing (what the snapshot gates on)
 *   state.fields       — the output textareas
 *   state.generationId — null means "nothing generated yet", the flush's real early-return
 *   seed               — what window._leadProPriorDraft carried in from the previous generate
 * Returns the row the flush inside _lpFeedbackReset produced, and the snapshot left behind.
 */
function runPrelude(B, state, seed) {
  const rows = [];
  const sb = {
    console: { log() {}, warn() {} },
    document: {
      getElementById(id) {
        if (id === 'regenStrip') return { classList: { contains: (c) => c === 'visible' && !!state.visible } };
        return { value: state.fields[id] === undefined ? '' : state.fields[id] };
      }
    },
    lastScrapedData: { autoLeadId: '2079186130' },
    _lpScrubPII: (s) => String(s === undefined || s === null ? '' : s),
    _lpVmForLead: () => state.vm || '',
    __row: { drafts: null }
  };
  sb.window = sb;
  sb._leadProPriorDraft = seed === undefined ? null : seed;
  // Stands in for the shipped reset, doing the ONE thing that matters here: the flush it performs
  // before the wipe, using the shipped capture expression unmodified.
  sb._lpFeedbackReset = function () {
    if (!state.generationId) return;          // the real guard: nothing generated yet
    sb.__row = { drafts: null };
    vm.runInContext('(function(){ var payload = __row; ' + B.capture + ' })();', sb, { filename: 'capture' });
    rows.push({ id: state.generationId, drafts: sb.__row.drafts });
  };
  vm.createContext(sb);
  vm.runInContext('(function(){\n' + B.prelude + '\n})();', sb, { filename: 'prelude' });
  return { rows, priorAfter: sb.window._leadProPriorDraft };
}

// The copy/thumb path: the capture alone, with no generate in front of it. This path never ran
// the prelude, so it was correct before this build and must be identical after it.
function captureOnly(B, fields, seed) {
  const sb = {
    console: { log() {} },
    document: { getElementById: (id) => ({ value: fields[id] === undefined ? '' : fields[id] }) },
    lastScrapedData: { autoLeadId: '2079186130' },
    _lpScrubPII: (s) => String(s === undefined || s === null ? '' : s),
    _lpVmForLead: () => '',
    __row: { drafts: null }
  };
  sb.window = sb;
  sb._leadProPriorDraft = seed;
  vm.createContext(sb);
  vm.runInContext('(function(){ var payload = __row; ' + B.capture + ' })();', sb, { filename: 'capture' });
  return sb.__row.drafts;
}

for (const file of BUILDS) {
  const B = load(file);
  console.log('\n' + path.relative(process.cwd(), file) + ' — a rejected pair is two different drafts');

  // ── KEVIN DYSON'S CHAIN, EXACTLY AS IT HAPPENED ────────────────────────────
  // 11:10:29 gen1 -> 11:10:39 gen2 (plain regen) -> 11:10:48 gen3 (add-urgency) -> sent 11:11.
  console.log('\nlead 2079186130 — three generations, 19 seconds, then a send:');

  // Grab + first Generate. The regen strip is hidden and nothing has been generated yet.
  // Grab never blanks the output fields, so the PREVIOUS lead's draft is sitting in them.
  const open = runPrelude(B,
    { visible: false, fields: { 'output-sms': 'PREVIOUS LEAD DRAFT' }, generationId: null },
    { sms: 'PREVIOUS LEAD DRAFT', email: '', voicemail: '' });
  check('the opening generate flushes no row', open.rows.length, 0);
  check('  ...and prior is null on a fresh generation — it replaced nothing', open.priorAfter, null);
  check('  ...which is also the v9.7.312 guard: no leftover draft from the previous lead',
    open.priorAfter === null, true);

  // gen1 renders; the regen strip appears. Agent hits regen — this flush is GEN1's row.
  const s1 = runPrelude(B,
    { visible: true, fields: { 'output-sms': G1, 'output-email': G1 }, generationId: 'gen1' },
    open.priorAfter);
  const row1 = s1.rows[0];
  check('gen1 flushed a row', !!row1, true);
  check('  gen1.final is the draft that was on screen', row1 && row1.drafts.final.sms, G1);
  check('  gen1.prior is null — the first draft of a chain replaced nothing',
    row1 && row1.drafts.prior, null);
  check('  ...and the snapshot left behind for gen2 is gen1\'s draft', s1.priorAfter && s1.priorAfter.sms, G1);

  // gen2 renders over it. Agent presses add-urgency — this flush is GEN2's row.
  const s2 = runPrelude(B,
    { visible: true, fields: { 'output-sms': G2, 'output-email': G2 }, generationId: 'gen2' },
    s1.priorAfter);
  const row2 = s2.rows[0];
  check('gen2 flushed a row', !!row2, true);
  check('  gen2.final is gen2\'s draft', row2 && row2.drafts.final.sms, G2);
  check('  gen2.prior is GEN1 — the draft it actually replaced', row2 && row2.drafts.prior.sms, G1);
  check('  ...THE REGRESSION: prior is not a copy of final',
    row2 && row2.drafts.prior.sms === row2.drafts.final.sms, false);
  check('  ...and the snapshot left behind for gen3 is gen2\'s draft', s2.priorAfter && s2.priorAfter.sms, G2);

  // ── THE HALF THAT WAS ALWAYS RIGHT MUST STAY RIGHT ─────────────────────────
  console.log('\nthe copy path (gen3 — the draft that was actually sent) is unchanged:');
  const copyRow = captureOnly(B, { 'output-sms': G3, 'output-email': G3 }, s2.priorAfter);
  check('  gen3.final is the sent draft', copyRow.final.sms, G3);
  check('  gen3.prior is gen2', copyRow.prior.sms, G2);
  check('  ...and the two halves still differ', copyRow.prior.sms === copyRow.final.sms, false);

  // ── EVERY ROW IN A CHAIN, NOT JUST THE ONE THAT BROKE ──────────────────────
  // The export's shape is what is asserted here: across a whole session, no row may pair a draft
  // with itself. A future edit that collapses a DIFFERENT row fails on this line rather than on
  // a fixture that happens to name gen2.
  console.log('\nno row anywhere in the chain pairs a draft with itself:');
  const allRows = [row1, row2, { id: 'gen3', drafts: copyRow }];
  const collapsed = allRows.filter(r => r && r.drafts.prior && r.drafts.prior.sms === r.drafts.final.sms)
                           .map(r => r.id);
  check('  collapsed rows', collapsed, []);

  // ── POSITION, AS A SECOND TRIPWIRE ─────────────────────────────────────────
  // Comment-stripped: this file's build headers quote its own code, which has produced seven
  // false greens since v9.7.563.
  console.log('\nand the reset still precedes the snapshot in source:');
  const code = B.src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const cReset = code.indexOf('_lpFeedbackReset();');
  const cSnap  = code.indexOf('window._leadProPriorDraft = {');
  check('  both statements found', cReset >= 0 && cSnap >= 0, true);
  check('  _lpFeedbackReset() comes first', cReset < cSnap, true);
}

if (BUILDS.length > 1) {
  console.log('\ndev === comm on the lifted regions:');
  const regions = BUILDS.map(f => { const b = load(f); return b.prelude + ' ' + b.capture; });
  check('  the prelude and the capture are byte-identical in both builds',
    regions.every(r => r === regions[0]), true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
