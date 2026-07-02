// Punch-list verification harness.
// Loads BASELINE (pristine v9.7.364 from git) and PATCHED (working tree) builds of
// popup.js into stubbed-DOM vm contexts and exercises the exact code paths the
// Section 1 fixes touch. Run:  node audit-tests/run-tests.js
'use strict';
const fs = require('fs');
const vm = require('vm');
const { execSync } = require('child_process');
const path = require('path');
const { buildContext, makeNote } = require('./stub-env');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'leadpro_COMMERCIAL_v9.7.364');
const BASELINE_REF = process.env.BASELINE_REF || 'baseline'; // resolved below

function gitShow(ref, file) {
  return execSync(`git show ${ref}:leadpro_COMMERCIAL_v9.7.364/${file}`, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString();
}

// Resolve the baseline commit: first commit that added the pristine source.
function resolveBaselineRef() {
  const out = execSync(`git log --format=%H --diff-filter=A -- leadpro_COMMERCIAL_v9.7.364/popup.js`, { cwd: ROOT }).toString().trim().split('\n');
  return out[out.length - 1];
}

// lead-source-registry.js / onboarding.js were removed in the Option B cleanup;
// load them (from git if no longer on disk) only for builds that still reference them.
const SUPPORT_FILES = ['config.js', 'lead-source-registry.js', 'dealer-config.js', 'dealer-setup.js', 'onboarding.js', 'auth.js'];

function readSupportFile(f) {
  const p = path.join(SRC_DIR, f);
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  return gitShow(resolveBaselineRef(), f); // deleted file — pull from the pristine baseline
}

function loadBuild(popupSource, ctxOpts) {
  const ctx = buildContext(ctxOpts || {});
  for (const f of SUPPORT_FILES) {
    const needed = fs.existsSync(path.join(SRC_DIR, f)) || popupSource.indexOf('LEADPRO_REGISTRY.loadRegistry') !== -1;
    if (!needed) continue;
    vm.runInContext(readSupportFile(f), ctx, { filename: f });
  }
  vm.runInContext(popupSource, ctx, { filename: 'popup.js' });
  return ctx;
}

// Extract the injected inlineScraper function text so it can be run against a fake DOM.
function extractInlineScraper(source) {
  const start = source.indexOf('function inlineScraper()');
  const end = source.indexOf('} // end inlineScraper');
  if (start === -1 || end === -1) throw new Error('inlineScraper markers not found');
  return source.slice(start, end + 1); // include closing brace
}

// Extract the PASS-2 merge loop (recovery block + loop) for the Section 2 gate test.
function extractPass2(source) {
  const start = source.indexOf('// RECOVERY (v9.7.45): If PASS 1 didn\'t capture _activeCustomerId');
  const end = source.indexOf('// Set best store after all frames processed');
  if (start === -1 || end === -1) throw new Error('PASS 2 markers not found');
  return source.slice(start, end);
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

(function main() {
  const baselineRef = resolveBaselineRef();
  const basePopup = gitShow(baselineRef, 'popup.js');
  const patchPopup = fs.readFileSync(path.join(SRC_DIR, 'popup.js'), 'utf8');
  console.log('baseline commit: ' + baselineRef.slice(0, 10));

  // ── Fix 1: velocity-response crash in populateFromData ────────────────────
  console.log('\n[Fix 1] velocity-response branch (agentFirst ReferenceError)');
  const velocityLead = {
    name: 'Test Customer', agent: 'Carly Osuna', dealerId: '6189',
    leadSource: 'Dealer Website', vehicle: '2025 Toyota Camry',
    isVelocityResponse: true, hasOutbound: false, totalNoteCount: 1, leadAgeDays: 0,
  };
  function runPopulate(src) {
    const ctx = loadBuild(src);
    try {
      const filled = vm.runInContext('populateFromData', ctx)(Object.assign({}, velocityLead));
      return { ok: true, filled };
    } catch (e) { return { ok: false, err: e.message }; }
  }
  const p1base = runPopulate(basePopup);
  const p1patch = runPopulate(patchPopup);
  check('baseline throws ReferenceError (confirms the bug was real)', !p1base.ok && /agentFirst/.test(p1base.err), JSON.stringify(p1base));
  check('patched populateFromData completes', p1patch.ok, JSON.stringify(p1patch));
  if (p1patch.ok) {
    const ctx = loadBuild(patchPopup);
    vm.runInContext('populateFromData', ctx)(Object.assign({}, velocityLead));
    const lc = vm.runInContext('leadContext', ctx);
    check('patched velocity directive renders agent first name', /this is Carly with \[Store\]/.test(lc), lc.slice(0, 200));
  }

  // ── Fix 2: System-note opt-out scan in inlineScraper ─────────────────────
  console.log('\n[Fix 2] System-note opt-out detection (inlineScraper scope bug)');
  function runScraper(src, notes, bodyText) {
    const ctx = buildContext({ notes, bodyText });
    const fnText = '(' + extractInlineScraper(src) + ')()';
    return vm.runInContext(fnText, ctx, { filename: 'inlineScraper.js' });
  }
  // A System-authored opt-out note whose text deliberately does NOT match the
  // separate fullScanText regexes (title and content split across lines), so the
  // ONLY path that can catch it is the hasSystemOptOutNote scan under test.
  const optOutNotes = [
    makeNote({ date: '06/30/2026 10:00 AM', title: 'SMS Status', content: 'Status has been changed to Opt-Out', direction: '' }),
    makeNote({ date: '06/29/2026 09:00 AM', title: 'Outbound Text Message', content: 'Hi there, checking in about the Camry.', direction: 'outbound' }),
  ];
  const s2base = runScraper(basePopup, optOutNotes, 'Community Toyota Baytown');
  const s2patch = runScraper(patchPopup, optOutNotes, 'Community Toyota Baytown');
  check('baseline misses the System opt-out note (bug reproduced)', s2base.isSmsOptOutOnly === false, 'isSmsOptOutOnly=' + s2base.isSmsOptOutOnly);
  check('patched detects it (isSmsOptOutOnly=true)', s2patch.isSmsOptOutOnly === true, 'isSmsOptOutOnly=' + s2patch.isSmsOptOutOnly);
  // Regression: a lead with no opt-out note must not trip the flag.
  const cleanNotes = [makeNote({ date: '06/30/2026 10:00 AM', title: 'Outbound Text Message', content: 'Hi, the Camry is here.', direction: 'outbound' })];
  const s2clean = runScraper(patchPopup, cleanNotes, 'Community Toyota Baytown');
  check('patched: clean lead does not trip opt-out', s2clean.isSmsOptOutOnly === false, 'isSmsOptOutOnly=' + s2clean.isSmsOptOutOnly);

  // ── Fix 3: isLeaseMature read-before-assignment ───────────────────────────
  console.log('\n[Fix 3] vehicleSold vs lease-mature ordering');
  function classify(src, data) {
    const ctx = loadBuild(src);
    return vm.runInContext('classifyScenario', ctx)(data);
  }
  const tfsLead = {
    leadSource: 'Csc-Off Lease Financing-Tfs', store: 'Community Toyota Baytown', dealerId: '6189',
    context: '[06/28/2026] [AGENT] Outbound Text Message\n  unfortunately that one is no longer available at the moment',
    convState: 'active-follow-up', hasOutbound: true, relationshipSignals: {},
  };
  const c3base = classify(basePopup, Object.assign({}, tfsLead));
  const c3patch = classify(patchPopup, Object.assign({}, tfsLead));
  check('baseline wrongly fires vehicleSold on TFS off-lease lead (bug reproduced)', c3base.vehicleSold === true, 'vehicleSold=' + c3base.vehicleSold);
  check('patched suppresses vehicleSold on TFS off-lease lead', c3patch.vehicleSold === false, 'vehicleSold=' + c3patch.vehicleSold);
  // Regression: genuinely sold vehicle on a normal source still fires.
  const soldLead = {
    leadSource: 'Cargurus', store: 'Community Honda Baytown', dealerId: '6191',
    context: 'VEHICLE STATUS: SOLD — this specific unit is no longer available.',
    convState: 'first-touch', relationshipSignals: {},
  };
  check('patched: normal sold lead still fires vehicleSold', classify(patchPopup, soldLead).vehicleSold === true);
  // Semantic preservation: isLeaseMature unchanged across a spread of sources.
  const srcs = ['Csc-Off Lease Financing-Tfs', 'AFS off lease in 3 months', 'Kia LUV Program', 'KMF - Kia Motors Finance', 'Cargurus', 'KFA In-Equity Program', 'TradePending', 'Toyota Financial Services'];
  let lmSame = true, lmDetail = '';
  for (const s of srcs) {
    const d = { leadSource: s, store: 'Community Toyota Baytown', dealerId: '6189', context: '', relationshipSignals: {} };
    const a = !!classify(basePopup, Object.assign({}, d)).isLeaseMature;
    const b = !!classify(patchPopup, Object.assign({}, d)).isLeaseMature;
    if (a !== b) { lmSame = false; lmDetail += s + ': ' + a + '->' + b + '; '; }
  }
  check('isLeaseMature value preserved for all test sources', lmSame, lmDetail);

  // ── Fix 4: CarFax naming reconciliation ───────────────────────────────────
  console.log('\n[Fix 4] CarFax source-mention vs never-say-Carfax');
  const cfLead = {
    name: 'Jane Doe', agent: 'Carly Osuna', store: 'Community Honda Baytown', dealerId: '6191',
    leadSource: 'CarFax - New Car Listings', vehicle: '2024 Honda CR-V', context: '',
    convState: 'first-touch', leadAgeDays: 0, relationshipSignals: {}, activeFlags: [],
  };
  const ctx4 = loadBuild(patchPopup);
  const prompt4 = vm.runInContext('buildUserPrompt', ctx4)(Object.assign({}, cfLead));
  check('patched prompt contains NAMED SOURCE — CARFAX block', prompt4.indexOf('NAMED SOURCE — CARFAX') !== -1);
  check('patched prompt contains the reconciliation NOTE', prompt4.indexOf('REPORT PRODUCT') !== -1);
  const sys4 = vm.runInContext('buildSystemPrompt', ctx4)('bdc');
  check('system prompt still carries the never-say-Carfax product rule', sys4.indexOf('Do not say "Carfax"') !== -1);

  // ── Section 2 (item 5): PASS-2 conversation-field gate ────────────────────
  console.log('\n[Item 5] PASS-2 anti-bleed gate for history/boolean fields');
  function runPass2(src, opts) {
    const block = extractPass2(src);
    const fn = new Function('sorted', 'm', 'historyFields', '_activeCustomerId', '_pass1HadActiveFrame', 'bestStore', 'console', block + '\nreturn m;');
    const historyFields = new Set(['totalNoteCount', 'history', 'conversationBrief', 'convState', 'hasExitSignal', 'hasPauseSignal', 'lastInboundMsg', 'lastInboundMs', 'lastOutboundMsg', 'lastSubstantiveOutboundMsg', 'noReplySinceLastOutbound', 'newestCustomerSignalType', 'newestCustomerSignalDesc', 'hasFreshCustomerSignal', 'isContacted', 'hasOutbound']);
    return fn(opts.sorted, opts.m || {}, historyFields, opts.activeCustomerId || '', opts.pass1HadActiveFrame, '', { log() {} });
  }
  const staleFrame = { result: { autoLeadId: '', customerId: '', conversationBrief: 'STALE BRIEF FROM OLD LEAD', lastInboundMsg: 'old customer msg', hasCustomerReply: true, hasExitSignal: true, convState: 'exit' } };
  // Baseline: stale ID-less frame bleeds transcript+flags even when PASS 1 owned the lead.
  const m5base = runPass2(basePopup, { sorted: [staleFrame], activeCustomerId: '999', pass1HadActiveFrame: true });
  check('baseline: stale ID-less frame bleeds conversationBrief (bug reproduced)', m5base.conversationBrief === 'STALE BRIEF FROM OLD LEAD', JSON.stringify(m5base));
  check('baseline: stale ID-less frame bleeds hasExitSignal (bug reproduced)', m5base.hasExitSignal === true);
  // Patched: blocked when PASS 1 had the active frame.
  const m5patch = runPass2(patchPopup, { sorted: [staleFrame], activeCustomerId: '999', pass1HadActiveFrame: true });
  check('patched: transcript blocked from unverified frame', m5patch.conversationBrief === undefined, JSON.stringify(m5patch));
  check('patched: exit/reply flags blocked from unverified frame', m5patch.hasExitSignal === undefined && m5patch.hasCustomerReply === undefined);
  // Patched: still merges when no PASS-1 active frame existed (AI-signal path preserved).
  const m5ai = runPass2(patchPopup, { sorted: [staleFrame], activeCustomerId: '', pass1HadActiveFrame: false });
  check('patched: AI-signal path (no PASS-1 frame) still merges transcript', m5ai.conversationBrief === 'STALE BRIEF FROM OLD LEAD', JSON.stringify(m5ai));
  // Patched: customerId-verified frame still merges even with PASS-1 active.
  const verifiedFrame = { result: { autoLeadId: '', customerId: '999', conversationBrief: 'VERIFIED BRIEF', hasCustomerReply: true } };
  const m5ver = runPass2(patchPopup, { sorted: [verifiedFrame], activeCustomerId: '999', pass1HadActiveFrame: true });
  check('patched: customerId-verified frame still merges', m5ver.conversationBrief === 'VERIFIED BRIEF' && m5ver.hasCustomerReply === true, JSON.stringify(m5ver));
  // Patched: PASS-1-supplied values are never overwritten either way.
  const m5keep = runPass2(patchPopup, { sorted: [verifiedFrame], m: { conversationBrief: 'PASS1 BRIEF' }, activeCustomerId: '999', pass1HadActiveFrame: true });
  check('patched: PASS-1 brief not overwritten by PASS-2 frame', m5keep.conversationBrief === 'PASS1 BRIEF');

  console.log('\n============================');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  process.exit(fail ? 1 : 0);
})();
