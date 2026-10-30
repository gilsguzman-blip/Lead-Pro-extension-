#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('powertrain-845.test.js');
// (v9.7.845) THE POWERTRAIN OF THE VEHICLE ON THE LEAD, FROM VINSOLUTIONS' RECORD, WHEN WHAT THEY RAISED IS ABOUT IT. Honda
// Lafayette lead 2107308865 (log386): she test-drove the Passport, "does not want a CVT or a turbo", and "said the passport has some
// low speed hesitation, and bumpy shifts"; both drafts repeated that back and answered none of it. The record of the unit says
// "Regular Gasoline V-6 3.5 L/212" and "10-Speed Automatic w/OD". Gil: "it would be smart if we can trust the facts when we have them.
// in those cases". Executes the shipped scraper span (as drivetrain-797 does), _lpPowertrain, and the prompt through the shipped
// panel payload. Placeholder data only.
//
// Usage: node tests/powertrain-845.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: powertrain-845.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const E = (date, time, tag, title, body) => '[' + date + ' ' + time + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const NOTES = E('10/29/2026', '4:08 PM', 'NOTE', 'General Note', 'By: Rep Name\n  Said the passport has some low speed hesitation, and bumpy shifts')
  + E('10/29/2026', '1:59 PM', 'NOTE', 'General Note', 'By: Rep Name\n  Came in and test drove a passport. She does not want a CVT or a turbo. She likes the passport and she will let me know after she does further research.');
const V6 = { voiEngine: 'Regular Gasoline V-6 3.5 L/212', voiTransmission: '10-Speed Automatic w/OD' };
const CRV = { vehicle: '2026 Honda CR-V EX', voiEngine: 'Intercooled Turbo Regular Unleaded I-4 1.5 L/91', voiTransmission: 'Continuously Variable w/OD' };
const LSD = (x, hist) => { const h = hist === undefined ? NOTES : hist;
  return Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Honda Passport RTL Towing',
    stockNum: 'TEST0P1', dealerId: '24399', store: 'Community Honda Lafayette', leadSource: 'Dealers WebSite', convState: 'pause', leadAgeDays: 1,
    hasOutbound: false, isContacted: true, hasCustomerReply: false, totalNoteCount: 8, phone: '(555) 010-0199', email: '', lastInboundMsg: '', isShowroomFollowUp: true,
    relationshipSignals: { unansweredQuestions: [] }, history: h, conversationBrief: h }, x || {}); };

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };

  console.log(' 1. the scraper reads the engine and transmission off the record of the vehicle on the lead:');
  const a = src.indexOf('    // (v9.7.797) THE DRIVETRAIN OF THE VEHICLE ON THE LEAD.'), b = src.indexOf('    // ── (v9.7.480/475 — STAGE 2)', a);
  const scrape = (lv, x) => { const box = Object.assign({ _pdH_V: lv || {}, _voiSwap: null, autoLeadId: '2107308865', _pdLeadIdH: '2107308865', _lpD: () => {}, String,
      document: { getElementById: () => null } }, x || {});
    vm.createContext(box); vm.runInContext(src.slice(a, b), box); return [vm.runInContext('typeof _voiEngine === "string" ? _voiEngine : "(none)"', box), vm.runInContext('typeof _voiTrans === "string" ? _voiTrans : "(none)"', box)]; };
  check('lead 2107308865: "Regular Gasoline V-6 3.5 L/212" and "10-Speed Automatic w/OD"', () =>
    scrape({ EngineName: 'Regular Gasoline V-6 3.5 L/212', TransmissionName: '10-Speed Automatic w/OD', DriveTrain: 'AWD' }), ['Regular Gasoline V-6 3.5 L/212', '10-Speed Automatic w/OD']);
  check('control: a record that belongs to another lead is not read (the drivetrain\'s own rule)', () =>
    scrape({ EngineName: 'Regular Gasoline V-6 3.5 L/212', TransmissionName: '10-Speed Automatic w/OD' }, { _pdLeadIdH: '1111111111' }), ['', '']);
  check('the scrape returns them as voiEngine and voiTransmission', () =>
    [/voiEngine: \(typeof _voiEngine === 'string'\) \? _voiEngine : ''/.test(src), /voiTransmission: \(typeof _voiTrans === 'string'\) \? _voiTrans : ''/.test(src)], [true, true]);

  console.log(' 2. what the record says, in words:');
  const pt = (x) => { const fn = run('_lpPowertrain'); return fn ? fn(x) : '(none)'; };
  check('V6 automatic -> "3.5L V6", "10-speed automatic", not a CVT, no turbo', () => { const r = pt(V6); return r && [r.engine, r.trans, r.cvt, r.turbo]; }, ['3.5L V6', '10-speed automatic', false, false]);
  check('a turbocharged four with a CVT -> "1.5L 4-cylinder", "CVT", turbo', () => { const r = pt(CRV); return r && [r.engine, r.trans, r.cvt, r.turbo]; }, ['1.5L 4-cylinder', 'CVT', true, true]);

  console.log(' 3. the prompt states it when what they raised is about it:');
  const built = (lsd) => { const ol = sb.console.log, ow = sb.console.warn; const logs = []; sb.console.log = (...q) => logs.push(q.join(' ')); sb.console.warn = () => {};
    try { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(lsd);
      return { p: String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: run('leadContext') }))), logs }; } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const blk = (p) => (p.match(/^.*THE POWERTRAIN OF THIS UNIT.*$/m) || ['(no block)'])[0];
  const p1 = built(LSD(V6));
  check('lead 2107308865: the record, the note, and "the Passport has the 3.5L V6 with a 10-speed automatic, so no CVT and no turbo"', () => {
    const l = blk(p1.p); return [/VinSolutions' own record of it, so it is a fact you may state: engine: 3\.5L V6 \(no turbo\); transmission: 10-speed automatic \(not a CVT\)\./.test(l),
      /She does not want a CVT or a turbo\./.test(l), /e\.g\. "the Passport has the 3\.5L V6 with a 10-speed automatic, so no CVT and no turbo\."/.test(l)]; }, [true, true, true]);
  check('the drive feel: no cause, no promise; someone can go over it; no other powertrain detail', () => {
    const l = blk(p1.p); return [/do not explain the cause or promise it is normal or fixed; you may offer to have someone go over it with them\./.test(l), /Never state any other engine, transmission or powertrain detail\./.test(l)]; }, [true, true]);
  check('the console says what was raised and what the record answers', () => p1.logs.some(l => /^\[LP POWERTRAIN DIAG\] raised \(our note 10\/29\):.*\| record: engine: 3\.5L V6 \(no turbo\); transmission: 10-speed automatic \(not a CVT\) \| answers: no CVT, no turbo$/.test(l)), true);
  check('the record conflicts (a CR-V with a CVT and a turbo, and they do not want either) -> not claimed, not raised', () =>
    /The record does NOT avoid what they raised: do not say it does, and do not bring the powertrain up yourself\./.test(blk(built(LSD(CRV)).p)), true);
  check('control: nothing raised about the engine or transmission -> no block (the facts stay background)', () =>
    blk(built(LSD(V6, E('10/29/2026', '1:59 PM', 'NOTE', 'General Note', 'By: Rep Name\n  Came in and liked the color. Will let me know.'))).p), '(no block)');
  check('control: only our own text mentions the transmission -> no block', () =>
    blk(built(LSD(V6, E('10/29/2026', '5:00 PM', 'AGENT', 'Outbound Text Message', 'Test, the Passport has a smooth transmission. Agent'))).p), '(no block)');
  check('control: no record of the engine or transmission -> no block (nothing is guessed)', () => blk(built(LSD()).p), '(no block)');
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
