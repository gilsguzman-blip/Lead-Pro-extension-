#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('imx-link-786.test.js');
// (v9.7.786) Honda Lafayette lead 2097663640 (IdentityMax "Pre-owned and Certified Vehicles under $25,000!", 10/10, on 785, the
// customer had not written). The text went out: "I'll take the $25,000 figure to my manager and get back to you with an answer.
// You can browse the pre-owned and certified vehicles under $25,000 here, ..." -- with no link.
//  (1) The lead's inquiry line (claimed the website offer "...under $25,000!") is the newest "customer message" on such a lead;
//      "$25,000" beside "offer" read as their number, and any priced message of ours made it a counter (v9.7.748's "take their
//      number to your manager"). Only a customer who actually wrote back can push back or counter.
//  (2) The prompt said to put the store's search link in the SMS on its own line before the signature. enforceSmsSig's
//      store-key safety net matched "community" inside www.communityhondalafayette.com once the signature was off and deleted
//      the link line. A line with a URL is never stripped. The text rewrite also keeps a link the first draft carried.
// Executes the shipped _lpPricePushback, buildUserPrompt, enforceSmsSig (lifted, as step5-700 does), _lpBuildSmsRefinePrompt
// and _lpRefineSms (worker stubbed). Placeholder data only.
//
// Usage: node tests/imx-link-786.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: imx-link-786.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const pad = n => String(n).padStart(2, '0');
const D = (h) => { const d = new Date(Date.now() - h * 3600000); return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear() + ' ' + ((d.getHours() % 12) || 12) + ':' + pad(d.getMinutes()) + ' ' + (d.getHours() < 12 ? 'AM' : 'PM'); };
const URL = 'https://www.communityhondalafayette.com/search/used/?pr=469:25000&tp=used';
const Q = 'claimed the website offer "Pre-owned and Certified Vehicles under $25,000!"';
const OURS = '[' + D(3) + '] [AGENT] Email reply to prospect\n  Hi Test, our certified pre-owned start at $18,500 this week.\n';
const MARK = '[' + D(3.5) + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n';
const IMX = (x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '', condition: 'Used', dealerId: '24399', store: 'Community Honda Lafayette',
  leadSource: 'Identitymax', convState: 'first-touch', leadAgeDays: 0, hasOutbound: true, hasCustomerReply: false, totalNoteCount: 6, phone: '(555) 010-0199', email: 'test@example.com',
  lastInboundMsg: Q, relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 0 },
  context: '[' + D(3.4) + '] [CUSTOMER REQUEST FROM INQUIRY] ' + Q + '\n' + OURS + MARK }, x || {});
const REPLY = (x) => IMX(Object.assign({ hasCustomerReply: true, lastInboundMsg: 'Can you do $25,000 out the door on one of them?',
  context: '[' + D(1) + '] [CUSTOMER] Inbound Text Message\n  Can you do $25,000 out the door on one of them?\n' + OURS + MARK }, x || {}));
const SIG = '\nAgent\nInternet Sales Coordinator | Community Honda Lafayette\n(555) 010-0100';
const PASS1 = 'Test, you claimed our offer on pre-owned and certified vehicles under $25,000. You can browse them here:\n' + URL + SIG;
const EMAIL = 'Subject: Pre-owned under $25,000\n\nHi Test,\n\nYou claimed our offer on pre-owned and certified vehicles under $25,000. You can browse them here: ' + URL + '\n\nAgent Name';

(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const quiet = (fn) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return fn(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  vm.runInContext('activeFlags = new Set();', sb);
  const PP = vm.runInContext('_lpPricePushback', sb);

  console.log(' 1. a lead form is not a counter-offer:');
  check('lead 2097663640 shape: the claimed-offer line + a priced message of ours -> no pushback, no counter', () => PP(IMX()), null);
  check('a customer who never replied cannot counter, whatever the text says', () => PP(IMX({ lastInboundMsg: 'Can you do $25,000 out the door?' })), null);
  check('the prompt carries no "THEY COUNTERED" block and no "take it to your manager" step on that lead', () => {
    const p = quiet(() => sb.__lp.buildUserPrompt(IMX())); return [/THEY COUNTERED WITH THEIR OWN NUMBER/.test(p), /taking their \$25,000 to your manager/.test(p)]; }, [false, false]);
  check('control: a real reply countering our $18,500 with $25,000 still counts as a counter', () => { const r = PP(REPLY()); return r && [r.counter, r.counterText]; }, [true, '25,000']);

  console.log(' 2. the link survives the signature step:');
  const src = fs.readFileSync(f, 'utf8'); const sa = src.indexOf('  function enforceSmsSig(sms) {'); const sigFn = src.slice(sa, src.indexOf('\n  }\n', sa) + 4);
  const sig = new Function('window', 'lastScrapedData', 'DEALER_ID_MAP', 'selectedStore', 'lookupPhone', 'console', sigFn + '\nreturn enforceSmsSig;')(
    { _leadProResolvedSigner: { firstName: 'Agent', name: 'Agent Name', title: 'Internet Sales Coordinator', phone: '(555) 010-0100' } },
    { dealerId: '24399', totalNoteCount: 2, leadAgeDays: 0 }, { '24399': 'Community Honda Lafayette' }, '', () => '', { log() {} });
  check('lead 2097663640 shape: "browse them here:" + the search link on its own line + signature -> the link is still there', () => sig(PASS1).indexOf(URL) > -1, true);
  check('control: a stray store-name signature line is still stripped, not doubled', () => (sig('Test, the Accord is here.\nCommunity Honda Lafayette\n(555) 010-0100').match(/Community Honda Lafayette/g) || []).length, 1);

  console.log(' 3. the text rewrite keeps the link:');
  check('the rewrite prompt says THE LINK STAYS, with the link', () =>
    /━━━ THE LINK STAYS ━━━\nThe first draft gives them this link: https:\/\/www\.communityhondalafayette\.com\/search\/used\/\?pr=469:25000&tp=used -- keep it in the text exactly as written/.test(
      quiet(() => vm.runInContext('_lpBuildSmsRefinePrompt', sb)(PASS1, EMAIL, IMX()))), true);
  const refine = async (reply) => { const logs = []; sb.__reply = reply; sb.__d = IMX();
    vm.runInContext('window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Community Honda Lafayette" };'
      + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpActiveProhibitions = [];'
      + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
      + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
      + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };', sb);
    const ol = sb.console.log; sb.console.log = (...a) => logs.push(a.join(' '));
    let out; try { out = await vm.runInContext('_lpRefineSms(' + JSON.stringify(PASS1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)', sb); } catch (e) { out = 'THREW ' + e.message; }
    sb.console.log = ol; return [out === null ? null : 'shipped', logs.some(l => /kept the first pass — it carried a link \(https:\/\/www\.communityhondalafayette\.com/.test(l))]; };
  await acheck('a rewrite that says "here" and drops the link -> the first pass ships, logged', () =>
    refine('Test, you can browse our pre-owned and certified vehicles under $25,000 here. What size or features should I look for?' + SIG), [null, true]);
  await acheck('control: a rewrite that keeps the link ships', () =>
    refine('Test, here are our pre-owned and certified vehicles under $25,000:\n' + URL + '\nWhat size or features should I look for?' + SIG), ['shipped', false]);

  console.log(' 4. the agent\'s "no appointment" override owns the visit decision:');
  const AV = vm.runInContext('_lpApplyVisitDecision', sb);
  const ov = '\ud83d\udeab AGENT OVERRIDE \u2014 NO APPOINTMENT ASK IN THIS MESSAGE: The agent has explicitly chosen to send this message WITHOUT asking for an appointment.';
  const st = 'STORE STATUS RIGHT NOW: OPEN. Closes at 7 PM (9h 0m remaining today). OFFER THE SOONEST REAL OPENING FIRST. There is still usable time TODAY, so today is the default: lead with a today time, or today plus tomorrow.';
  check('with the override, the store-status "lead with a today time" goes (time-of-day independent; imx-noappt-720 failed before 3 PM on this)', () => {
    const r = quiet(() => AV([st, ov].join('\n'))); return [r.level, r.owner, /lead with a today time/.test(r.text)]; }, [3, 'the agent\'s NO APPOINTMENT override', false]);
  check('control: without the override the today default stays', () => /lead with a today time/.test(quiet(() => AV(st)).text), true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
