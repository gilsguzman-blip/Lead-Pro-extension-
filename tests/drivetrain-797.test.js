#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('drivetrain-797.test.js');
// (v9.7.797) DRIVETRAIN: SAY IT FOR THE VEHICLE ON THE LEAD WHEN WE HAVE IT, NEVER FOR ONE WE DO NOT.
//   Toyota Baytown lead 2099028967 (log318): the customer asked "Is it awd" about a 2026 RAV4 LE offered as an alternative.
//   Nothing Lead Pro holds carries that unit's drivetrain (the inventory feed has none), and both drafts said "yes -- the 2026
//   RAV4 LE is AWD". It is FWD. Gil, 10/13: "we'll be nebulous in the response" for a suggested unit.
//   Honda Lafayette lead 2099028490 (log319): VinSolutions' record of the lead's vehicle carries "DriveTrain":"FWD", and the
//   Lead Info panel reads "FWD 4dr Car (4 Door)" -- Lead Pro read past both.
// Now the scraper carries the vehicle on the lead's drivetrain (voiDrivetrain), the prompt states it, a drivetrain question
// gets a line that forbids naming one we do not have, and a text rewrite that adds one does not ship.
// Executes the scraper's drivetrain block (lifted), populateFromData, _lpBuildSmsRefinePrompt and _lpRefineSms (worker
// stubbed). Placeholder data only.
//
// Usage: node tests/drivetrain-797.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: drivetrain-797.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const LEAD = (x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '2026 Honda Civic Sedan Sport', condition: 'New', dealerId: '6191',
  stockNum: 'TEST001A', vin: 'TESTVIN0000000001', store: 'Community Honda Baytown', leadSource: 'Dealer Website', convState: 'active-follow-up', leadAgeDays: 0,
  hasOutbound: true, hasCustomerReply: true, totalNoteCount: 6, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: 'Is it awd',
  relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 0.01 }, history: '', context: '' }, x || {});
const SIG = '\nAgent\nTest Store\n(555) 010-0100';
const EMAIL = 'Hi Test,\n\nThanks for asking about the drivetrain. Let me confirm it on the 2026 RAV4 LE for you, and I can have it ready if you would like to see it this afternoon.\n\nAgent Name\nTest Store\n(555) 010-0100';

(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  const quiet = (fn) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return fn(); } finally { sb.console.log = ol; sb.console.warn = ow; } };

  console.log(' 1. the scraper reads the vehicle on the lead\'s drivetrain:');
  const a = src.indexOf('    // (v9.7.797) THE DRIVETRAIN OF THE VEHICLE ON THE LEAD.'), b = src.indexOf('    // ── (v9.7.480/475 — STAGE 2)', a);
  const scrape = (lv, panel, x) => { if (a < 0 || b < 0) return '(no drivetrain block)';
    const box = Object.assign({ _pdH_V: lv || {}, _voiSwap: null, autoLeadId: '2099028490', _pdLeadIdH: '2099028490', _lpD: () => {}, String,
      document: { getElementById: (id) => /m_VehicleDetails/.test(id) && panel ? { innerText: panel } : null } }, x || {});
    vm.createContext(box); vm.runInContext(src.slice(a, b), box); return vm.runInContext('_voiDrive', box); };
  check('lead 2099028490: VinSolutions\' record says DriveTrain "FWD" -> FWD', () => scrape({ DriveTrain: 'FWD', DriveLine: 'FWD' }, 'FWD 4dr Car (4 Door)\nStock #:TEST001A'), 'FWD');
  check('a spelled-out record ("All Wheel Drive") -> AWD; no record, the panel line "AWD 4dr Car" -> AWD', () =>
    [scrape({ DriveTrain: 'All Wheel Drive' }), scrape({}, 'AWD 4dr Car (4 Door)\nStock #:TEST001A')], ['AWD', 'AWD']);
  check('(new helper) control: the store changed the vehicle on the lead, or nothing anywhere -> not stated (lead 2099028967\'s in-transit RAV4)', () =>
    [scrape({ DriveTrain: 'FWD' }, 'FWD 4dr Car', { _voiSwap: { fromStock: 'A', toStock: 'B' } }), scrape({ DriveTrain: null, DriveLine: null }, 'VIN:')], ['', '']);
  check('(new helper) control: the record belongs to another lead (identity conflict) -> not read from it', () =>
    scrape({ DriveTrain: 'AWD' }, '', { _pdLeadIdH: '1111111111' }), '');

  console.log(' 2. the prompt states it, and a drivetrain question cannot be answered with a guess:');
  const ctx = (x) => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); quiet(() => sb.populateFromData(LEAD(x))); return run('leadContext'); };
  const c1 = ctx({ voiDrivetrain: 'FWD' });
  check('the vehicle on the lead is FWD and they asked "Is it awd" -> it is stated, and answered with FWD', () =>
    [/\nDRIVETRAIN: FWD \(front-wheel drive\) -- VinSolutions' own record of this unit\./.test(c1),
     /DRIVETRAIN QUESTION: They asked about the drivetrain\. The 2026 Honda Civic Sedan Sport on this lead is FWD \(front-wheel drive\)[^\n]*answer with that\. For any OTHER vehicle[^\n]*do not say it is AWD, FWD, RWD or 4WD/.test(c1)], [true, true]);
  const c2 = ctx({ vehicle: '2026 Toyota RAV4', voiDrivetrain: '' });
  check('lead 2099028967: nothing on record and they asked -> no drivetrain stated for ANY vehicle; offer to confirm', () =>
    [/\nDRIVETRAIN: /.test(c2), /DRIVETRAIN QUESTION: They asked about the drivetrain\. For any vehicle -- an alternative, a comparable, an inventory suggestion, or the vehicle on this lead -- we do NOT have its drivetrain on record: do not say it is AWD, FWD, RWD or 4WD\. Say you will confirm it/.test(c2)], [false, true]);
  check('control: not asked -> the fact is stated, no question line; an old question (20 days) -> no question line', () =>
    [/DRIVETRAIN QUESTION/.test(ctx({ voiDrivetrain: 'FWD', lastInboundMsg: 'what time do you close?' })),
     /DRIVETRAIN QUESTION/.test(ctx({ voiDrivetrain: 'FWD', relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 20 } }))], [false, false]);

  console.log(' 3. the text rewrite does not add a drivetrain:');
  check('they asked -> the rewrite is told the same rule', () =>
    /━━━ THE DRIVETRAIN ━━━\nThey asked about the drivetrain\.[^\n]*do not add a drivetrain the first draft does not state\./.test(
      quiet(() => run('_lpBuildSmsRefinePrompt')('Test, I will confirm that for you.' + SIG, 'email', LEAD({ vehicle: '2026 Toyota RAV4', voiDrivetrain: '' })))), true);
  const refine = async (pass1, reply) => { const logs = []; sb.__reply = reply; sb.__d = LEAD({ vehicle: '2026 Toyota RAV4', voiDrivetrain: '' });
    run('window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Test Store" };'
      + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpActiveProhibitions = [];'
      + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
      + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
      + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };');
    const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...x) => logs.push(x.join(' ')); sb.console.warn = () => {};
    let out; try { out = await run('_lpRefineSms(' + JSON.stringify(pass1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)'); } catch (e) { out = 'THREW ' + e.message; }
    sb.console.log = ol; sb.console.warn = ow;
    return [out === null ? null : 'shipped', logs.some(l => /kept the first pass — the rewrite named a drivetrain/.test(l))]; };
  const P1 = 'Test, let me confirm the drivetrain on the LE for you. Would you like to see it this afternoon?' + SIG;
  await acheck('log318: the first draft said nothing of it, the rewrite says "the 2026 RAV4 LE is AWD" -> the first draft ships', () =>
    refine(P1, 'Test, yes, the 2026 RAV4 LE is AWD. Would you like to see it this afternoon?' + SIG), [null, true]);
  await acheck('control: a rewrite that keeps it unconfirmed ships', () =>
    refine(P1, 'Test, I will confirm the drivetrain on the LE. Want to see it this afternoon?' + SIG), ['shipped', false]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
