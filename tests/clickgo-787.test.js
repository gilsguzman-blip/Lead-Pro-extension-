#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('clickgo-787.test.js');
// (v9.7.787) Click & Go, Gil 10/10: "I think the appointment is OK on Click & Go if we pose it as you've taken [the] step --
// customer can come in and go over options", and "make sure the Click & Go branding is sticking. I saw it miss on a lead earlier."
//  1. Each progress angle ties what they did online to the visit: the first step is taken, come in and go over options.
//  2. The no-vehicle angle is re-checked against the vehicle, stock and VIN (lead 2097743287's email paired "the K4 is here" with
//     "help you find the right vehicle to go along with the step you've already taken").
//  3. The brand: the follow-up arm -- the one nearly every Click & Go lead takes -- had no rule to name it, and the generic
//     source block forbade naming it again once a message had. Now the follow-up arm names it once, in passing, in both formats,
//     the source block stands aside for Click & Go, and the text rewrite keeps it (v9.7.697's source guard, executed here).
// Executes the shipped buildUserPrompt and _lpRefineSms (worker stubbed). Placeholder data only.
//
// Usage: node tests/clickgo-787.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: clickgo-787.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const pad = n => String(n).padStart(2, '0');
const D = (h) => { const d = new Date(Date.now() - h * 3600000); return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear() + ' ' + ((d.getHours() % 12) || 12) + ':' + pad(d.getMinutes()) + ' ' + (d.getHours() < 12 ? 'AM' : 'PM'); };
const SENT = 'Hi Test, thanks for starting your deal on Click & Go! I can have everything ready for you.';
const CG = (x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '2026 Kia K4 LX', stockNum: 'TE000001', vin: '3KPFT4DE0TE000001',
  dealerId: '6190', store: 'Community Kia Baytown', leadSource: 'Gubagoo - Virtual Retailing', convState: 'first-touch', leadAgeDays: 0, hasOutbound: true, isContacted: false,
  totalNoteCount: 4, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '', relationshipSignals: { unansweredQuestions: [] },
  vrPaymentSelected: true, outboundSends: [{ body: SENT, ms: Date.now() - 3600000 }],
  context: '[' + D(1) + '] [AGENT] Outbound Text Message\n  ' + SENT + '\n[' + D(1.2) + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n' }, x || {});

(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const logs = [];
  const quiet = (fn) => { const ol = sb.console.log, ow = sb.console.warn; logs.length = 0; sb.console.log = (...a) => logs.push(a.join(' ')); sb.console.warn = () => {}; try { return fn(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  vm.runInContext('activeFlags = new Set();', sb);
  const up = (d) => quiet(() => sb.__lp.buildUserPrompt(d));

  console.log(' 1. the brand sticks on a follow-up:');
  const p = up(CG());
  // (v9.7.840) Our text already named it, so the brand line now asks for it in the email only -- see clickgo-840.
  check('a Click & Go follow-up (our text already said "Click & Go") carries BRAND: name it once in the email, in passing', () =>
    /- BRAND: name Click & Go once in the EMAIL, in passing -- "the deal you started on Click & Go"/.test(p), true);
  check('and nothing in the prompt forbids naming it again (the generic source block stands aside for Click & Go)', () =>
    [/YOU HAVE ALREADY SAID SO TO THIS CUSTOMER/.test(p), logs.some(l => /SKIPPED-click-and-go/.test(l))], [false, true]);
  check('control: a dealer-website follow-up that already said "our website" is still told not to re-announce it', () => {
    const q = up(CG({ leadSource: 'Dealers WebSite', vrPaymentSelected: false, outboundSends: [{ body: 'Hi Test, thanks for your request through our website.', ms: Date.now() - 3600000 }] }));
    return [/YOU HAVE ALREADY SAID SO TO THIS CUSTOMER/.test(q), /- BRAND: name Click & Go/.test(q)]; }, [true, false]);

  console.log(' 2. the step is the reason to come in:');
  // the follow-up arm (the one production takes) carries the angle whenever the session recorded steps
  const ang = (x) => { const q = up(CG(Object.assign({ vrPaymentSelected: false }, x))); return (q.match(/^- (?:You|With)[^\n]*come in and we will[^\n]*$/m) || ['(none)'])[0]; };
  check('credit application: "you have taken the first step — come in and we will go over your options, with financing ready"', () =>
    /With your application already in, you have taken the first step — come in and we will go over your options, with financing ready before you arrive/.test(ang({ vrCreditApp: true })), true);
  check('vehicle on the lead: "taken the first step online, and the vehicle is here — come in and we will go over your options"', () =>
    /You have already taken the first step online, and the vehicle is here — come in and we will go over your options/.test(ang({ vrPaymentSelected: true })), true);
  check('no vehicle at all: "come in and we will go over your options and find the right vehicle for you"', () =>
    /come in and we will go over your options and find the right vehicle for you/.test(ang({ vehicle: '', stockNum: '', vin: '', noVehicleAtAll: true, vrPaymentSelected: true })), true);

  console.log(' 3. "no vehicle" is re-checked against the vehicle on the lead:');
  check('lead 2097743287 shape: noVehicleAtAll left true by the scrape, but a K4 and its stock are on the lead -> the vehicle angle, not "find the right vehicle"', () => {
    const a = ang({ noVehicleAtAll: true, vrPaymentSelected: true }); return [/find the right vehicle/.test(a), /the vehicle is here/.test(a)]; }, [false, true]);

  console.log(' 4. the text rewrite keeps the brand:');
  const PASS1 = 'Test, the K4 LX is here, and since you started your deal on Click & Go we can go over your options in person. Would 12:30 or 1:15 work?\nAgent\nInternet Sales Coordinator | Community Kia Baytown\n(555) 010-0100';
  const EMAIL = 'Subject: Your K4\n\nHi Test,\n\nSince you started your deal on Click & Go, we can go over your options in person. Would 12:30 or 1:15 work?\n\nAgent Name';
  const refine = async (reply) => { const out = []; sb.__reply = reply; sb.__d = CG();
    vm.runInContext('window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Community Kia Baytown" };'
      + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpActiveProhibitions = [];'
      + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
      + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
      + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };', sb);
    const ol = sb.console.log; sb.console.log = (...a) => out.push(a.join(' '));
    let r; try { r = await vm.runInContext('_lpRefineSms(' + JSON.stringify(PASS1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)', sb); } catch (e) { r = 'THREW ' + e.message; }
    sb.console.log = ol; return [r === null ? null : 'shipped', out.some(l => /kept the first pass — it named where the customer came from \("Click & Go"\)/.test(l))]; };
  await acheck('a rewrite that drops "Click & Go" does not ship -- the first pass does, logged', () =>
    refine('Test, the K4 LX is here and we can go over your options in person. Would 12:30 or 1:15 work?\nAgent'), [null, true]);
  await acheck('control: a rewrite that keeps it ships', () =>
    refine('Test, since you started on Click & Go, the K4 LX is here to go over in person. Would 12:30 or 1:15 work?\nAgent'), ['shipped', false]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
