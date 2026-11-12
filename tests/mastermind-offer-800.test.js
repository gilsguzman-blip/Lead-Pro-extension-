#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('mastermind-offer-800.test.js');
// (v9.7.800) AN OFFER THEY WERE SELECTED FOR, NOT AN INQUIRY. Audi Lafayette Automotive Mastermind lead 2099714300 (log324):
// the voicemail never named the offer ("the offer details"), the prompt told the model the lead came through "your online
// inquiry" four times over (the source acknowledgement and HOW THIS LEAD REACHED US both treated the mailer as a web form),
// and the text rewrite wrote "your Audi-owner incentive is tied to the 2027 Q7 Premium". Gil, 10/14: "it's not an inquiry
// it's an offer they were selected for". Now: the source acknowledgement stands aside for Mastermind; HOW THIS LEAD REACHED
// US names the GM Private Incentive they were selected for as a current Audi owner; every Mastermind arm carries the
// not-an-inquiry and do-not-tie-it-to-a-vehicle rules, and the outreach touches say the offer is the reason in every format,
// voicemail included; the text rewrite is told the same, and a rewrite that ties the offer to a vehicle does not ship.
// Executes buildUserPrompt, _lpBuildSmsRefinePrompt and _lpRefineSms (worker stubbed). Placeholder data only.
//
// Usage: node tests/mastermind-offer-800.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: mastermind-offer-800.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const SIG = '\nAgent\nAudi Lafayette\n(555) 010-0100';
const EMAIL = 'Hi Test,\n\nAs a current Audi owner you were selected for the GM Private Incentive, and I would be glad to go over it with you. We have the 2027 Q7 Premium available in Merapi Gray, and it is one of the ways you could put the offer to use.\n\nAgent Name\nAudi Lafayette\n(555) 010-0100';
const U = (stock, color) => ({ stock, stockNum: stock, vin: 'TESTVIN' + stock, vehicle: '2027 Audi Q7 Premium quattro', year: 2027, make: 'Audi', model: 'Q7 Premium quattro',
  condition: 'new', certified: false, class: 'SUV', body: '4D Sport Utility', color, odometer: 5, daysOnLot: 10, price: null });
const LEAD = (x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '2027 Audi Q7 Premium quattro', condition: 'New',
  stockNum: '', vin: '', dealerId: '21135', store: 'Audi Lafayette', leadSource: 'Automotive Mastermind', convState: 'first-touch', leadAgeDays: 0,
  hasOutbound: false, hasCustomerReply: false, totalNoteCount: 3, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '',
  relationshipSignals: { unansweredQuestions: [] }, history: '', context: '[10/14/2026 9:10 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n' }, x || {});
const OTHER = { leadSource: 'Audi Partner Lead' };
const P_CLEAN = 'Test, as a current Audi owner you were selected for the GM Private Incentive. We have the 2027 Q7 Premium available if you would like to see it.' + SIG;
const R_TIED = 'Test, your Audi-owner incentive is tied to the 2027 Q7 Premium, and we have it available in Merapi Gray.' + SIG;
const R_CLEAN = 'Test, you were selected for the GM Private Incentive as a current Audi owner. The 2027 Q7 Premium is here if you want to see it.' + SIG;

(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  const quiet = (fn) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return fn(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  run('_lpValueFactCache')['21135'] = { inv: { units: [U('A001', 'Merapi Gray Metallic'), U('A002', 'Glacier White Metallic')] }, vf: { incentives: [] },
    fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true };
  run('activeFlags = new Set(); window._lpGrabStartedAt = 0;');
  const up = (x) => quiet(() => sb.__lp.buildUserPrompt(LEAD(x)));
  const rules = (p) => [/^- THIS IS AN OFFER THEY WERE SELECTED FOR, NOT AN INQUIRY\./m.test(p), /^- THE OFFER IS THE REASON IN EVERY FORMAT -- SMS, email AND voicemail/m.test(p),
    /^- DO NOT TIE THE OFFER TO A VEHICLE\./m.test(p)];
  const inquiryOutsideRules = (p) => p.split('\n').filter(l => /online inquiry/i.test(l) && !/Never (?:call it|write)/.test(l)).length;

  console.log(' 1. the prompt calls it an offer they were selected for:');
  const p1 = up();
  check('lead 2099714300: HOW THIS LEAD REACHED US is the GM Private Incentive they were selected for as a current Audi owner, not an inquiry', () =>
    /^- HOW THIS LEAD REACHED US: the GM Private Incentive offer they received as a current Audi owner -- an offer they were selected for, NOT an inquiry they made\./m.test(p1), true);
  check('"online inquiry" appears only inside the rules that forbid it -- no acknowledgement or source line calls the mailer an inquiry', () => inquiryOutsideRules(p1), 0);
  check('first touch: not-an-inquiry, the offer as the reason in every format (voicemail included), and do-not-tie-it-to-a-vehicle are all there', () => rules(p1), [true, true, true]);
  check('the voicemail example opens on the offer and is never just "the offer details"', () =>
    /In the voicemail it is the reason to call back, said first, e\.g\. "Hi \[Name\], it's \[you\] at Audi Lafayette\. As a current Audi owner you were selected for the GM Private Incentive/.test(p1)
      && /never just "the offer details"/.test(p1), true);
  const pAct = up({ convState: 'active', hasOutbound: true, hasCustomerReply: true, lastInboundMsg: 'what does the offer cover?',
    context: '[10/14/2026 10:02 AM] [CUSTOMER] what does the offer cover?\n[10/14/2026 9:10 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n' });
  check('active conversation (they replied): not-an-inquiry and do-not-tie stay; the outreach-only "every format" line does not', () => rules(pAct), [true, false, true]);
  const pOther = up(OTHER);
  check('control: an Audi Lafayette lead from another source has none of the three rules and no offer framing', () =>
    [rules(pOther), /HOW THIS LEAD REACHED US: the GM Private Incentive/.test(pOther)], [[false, false, false], false]);
  check('control: a Mastermind-labelled lead at another store is not Mastermind', () =>
    rules(up({ store: 'Community Honda Lafayette', dealerId: '24399', vehicle: '2026 Honda Pilot EX-L' })), [false, false, false]);

  console.log(' 2. the text rewrite keeps the offer as the reason and off the vehicle:');
  const RP = (x) => quiet(() => run('_lpBuildSmsRefinePrompt')(P_CLEAN, EMAIL, LEAD(x)));
  check('Mastermind: the rewrite prompt carries THE OWNER OFFER -- selected for, not an inquiry, not tied to a vehicle', () => {
    const r = RP(); return [/━━━ THE OWNER OFFER ━━━\nThey were selected for the GM Private Incentive as a current Audi owner -- an offer, not an inquiry\./.test(r),
      /never call it an online inquiry; and do not tie the offer to a vehicle/.test(r)]; }, [true, true]);
  check('control: another source gets no OWNER OFFER section', () => /THE OWNER OFFER/.test(RP(OTHER)), false);

  console.log(' 3. a rewrite that ties the offer to a vehicle does not ship:');
  const refine = async (pass1, reply, x) => { const logs = []; sb.__reply = reply; sb.__d = LEAD(x);
    run('window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Audi Lafayette" };'
      + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpActiveProhibitions = [];'
      + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
      + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
      + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };');
    const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...a) => logs.push(a.join(' ')); sb.console.warn = () => {};
    let out; try { out = await run('_lpRefineSms(' + JSON.stringify(pass1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)'); } catch (e) { out = 'THREW ' + e.message; }
    sb.console.log = ol; sb.console.warn = ow;
    return [out === null ? null : 'shipped', logs.some(l => /kept the first pass — the rewrite tied the owner offer to a vehicle/.test(l))]; };
  await acheck('lead 2099714300: a clean first draft, a rewrite saying "your Audi-owner incentive is tied to the 2027 Q7 Premium" -> the first draft ships', () => refine(P_CLEAN, R_TIED), [null, true]);
  await acheck('control: a rewrite that names the offer and the vehicle separately ships', () => refine(P_CLEAN, R_CLEAN), ['shipped', false]);
  await acheck('control: the same wording on a non-Mastermind lead is not this guard\'s business, and ships', () => refine(P_CLEAN, R_TIED, OTHER), ['shipped', false]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
