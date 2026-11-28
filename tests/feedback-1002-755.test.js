#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('feedback-1002-755.test.js');
// (v9.7.755) The 10/2 feedback export, item by item. No dumps were taken, so each fix is tested at the code that made
// the draft, with placeholder data:
//  (1) lead 2093398081 (Honda Baytown, TrueCar/Lifecare, 2013 Civic LX, in that day's feed): every text said "the
//      2013 Civic you asked about is gone" while the email and voicemail said "here and available". The rewrite is
//      now told the unit is in stock, a "gone" rewrite loses, and the agent is warned if the text still says gone.
//  (2) drafts narrated our rules to the customer: "rather than assuming it's available", "so I can't say it's
//      approved", "without sharing her credit information in writing". Both system prompts now say: follow silently.
//  (3) lead 2093797981 (Honda Baytown chat): asked about lease offers on "an affordable, reliable four-door sedan",
//      no model on file, four drafts said "I'll check the current lease offers". The store's sedan lease lines now go in.
//  (4) the same lead's voicemail said "this is Melanie at Community Auto Group": the voicemail now signs the lead's store.
//  (5) lead 2093389062 (Toyota, CarGurus, no phone on file): the TEXT asked "What's the best number to reach you?".
//  (6) a translated email kept "Internet Sales Coordinator" in English under Spanish text.
// Executes the shipped _lpBuildSmsRefinePrompt, _lpRefineSms (worker stubbed), buildSystemPrompt,
// buildSystemPromptSmsRefine, _lpOfferAskByBody, _lpOffersForBody, populateFromData and buildSystemPromptVoicemailOnly.
//
// Usage: node tests/feedback-1002-755.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: feedback-1002-755.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const SIG = '\nAgent';
const EXP = (() => { const d = new Date(Date.now() + 20 * 86400000); return d.toISOString().slice(0, 10); })();
const INC = [
  { model: 'Accord', year: '2026', line: 'Accord — $229/mo 36 mo lease ($3,999 due at signing) — applies to FWD LX', expires: EXP },
  { model: 'Accord', year: '2026', line: 'Accord — 3.99% APR for 24-60 mos, 4.99% APR for 61-72 mos', expires: EXP },
  { model: 'Civic Sedan Hybrid', year: '2026', line: 'Civic Sedan Hybrid — $259/mo 39 mo lease ($3,999 due at signing) — applies to 2WD Sport Hybrid', expires: EXP },
  { model: 'Civic Hatchback', year: '2026', line: 'Civic Hatchback — $249/mo 39 mo lease ($3,999 due at signing) — applies to FWD Sport', expires: EXP },
  { model: 'CR-V', year: '2026', line: 'CR-V — $279/mo 39 mo lease ($4,899 due at signing) — applies to AWD LX', expires: EXP }
];
const CHAT = 'Does Honda currently have any lease offers? Looking for an affordable, reliable four-door sedan for my daughter, 2-3 year lease, at least 10,000 miles a year.';

(async () => {
  for (const f of BUILDS) {
    console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
    const src = fs.readFileSync(f, 'utf8');
    const sb = loadPopup(f, { withAuth: true });

    console.log(' 1. a unit confirmed in stock is not "gone" in the text:');
    const CIVIC = { name: 'Test Buyer', vehicle: '2013 Honda Civic LX', stockNum: 'TEST001A', dealerId: '6191', phone: '(555) 010-0199', _lpInvConfirmedAvailable: true, relationshipSignals: {} };
    const EMAIL = 'Subject: Your Civic\n\nHi Test,\n\nYour TrueCar inquiry was for the 2013 Honda Civic LX, and it is here and available to see. We are open until 8 PM today.\n\nAgent Name';
    const PASS1 = 'Test, the 2013 Civic LX you asked about is here and available to see. Want to stop by before 8 tonight?' + SIG;
    const GONE = 'Test, the 2013 Civic you asked about is gone. Would you like me to help find another Civic?' + SIG;
    const rp = (d) => { sb.__d = d; return vm.runInContext('_lpBuildSmsRefinePrompt(' + JSON.stringify(PASS1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)', sb); };
    check('the rewrite is told: "THE VEHICLE IS IN STOCK ... do NOT say it is gone"', () => /THE VEHICLE IS IN STOCK[\s\S]{0,200}do NOT say it is gone/.test(rp(CIVIC)), true);
    check('control: not confirmed -> no such block', () => /THE VEHICLE IS IN STOCK/.test(rp(Object.assign({}, CIVIC, { _lpInvConfirmedAvailable: false }))), false);
    const refine = async (d, reply) => {
      const logs = []; sb.__reply = reply; sb.__d = d;
      vm.runInContext('window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Test Store" };'
        + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpActiveProhibitions = [];'
        + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
        + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
        + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };', sb);
      const oldLog = sb.console.log; sb.console.log = (...x) => { logs.push(x.join(' ')); };
      let out; try { out = await vm.runInContext('_lpRefineSms(' + JSON.stringify(PASS1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)', sb); } catch (e) { out = 'THREW ' + e.message; }
      sb.console.log = oldLog;
      return { out, logged: logs.some(l => /kept the first pass — the rewrite says the vehicle is gone/.test(l)) };
    };
    await acheck('lead 2093398081 shape: a "gone" rewrite of a confirmed unit -> the first pass ships, logged', async () => { const r = await refine(CIVIC, GONE); return [r.out, r.logged]; }, [null, true]);
    await acheck('control: the same rewrite on a unit NOT confirmed ships (the sold path is not touched)', async () => (await refine(Object.assign({}, CIVIC, { _lpInvConfirmedAvailable: false }), GONE)).out, GONE);
    check('the agent is warned when the text that ships still says gone (render-time notice)', () =>
      /lastScrapedData\._lpInvConfirmedAvailable && LP_GONE_RX\.test\(_gSms\) && !LP_GONE_RX\.test\(_gEm\)\)\s*_ooMsgs\.push\('⚠ The text says the vehicle is gone/.test(src), true);

    console.log(' 2. rules are followed silently, not explained to the customer:');
    check('main system prompt: "RULES ARE FOR YOU, NOT FOR THE CUSTOMER"', () => /RULES ARE FOR YOU, NOT FOR THE CUSTOMER: follow every rule in this prompt silently/.test(sb.__lp.buildSystemPrompt('bdc')), true);
    check('the text rewrite\'s system prompt says it too', () => /RULES ARE FOR YOU, NOT FOR THE CUSTOMER\. Follow them silently/.test(sb.buildSystemPromptSmsRefine('Agent', 'Test Store', '(555) 010-0100')), true);

    console.log(' 3. offers asked about by body type, with no model on file:');
    const ask = sb._lpOfferAskByBody ? sb._lpOfferAskByBody(CHAT) : null;
    check('lead 2093797981 shape: "lease offers ... four-door sedan" -> sedan, lease', () => ask && [ask.body, ask.kind], ['sedan', 'lease']);
    check('...the store\'s sedan LEASE lines: Accord and Civic Sedan Hybrid, not the hatchback, not the CR-V, not the APR line', () =>
      sb._lpOffersForBody(ask, INC, 'test').map(x => x.model + ':' + /lease/.test(x.line)), ['Accord:true', 'Civic Sedan Hybrid:true']);
    check('control (new helper): "looking for a sedan" with no offer asked -> nothing', () => sb._lpOfferAskByBody('looking for a reliable sedan for my daughter'), null);
    check('control (new helper): "any lease deals on an SUV?" -> the CR-V', () => sb._lpOffersForBody(sb._lpOfferAskByBody('any lease deals on an SUV?'), INC, 'test').map(x => x.model), ['CR-V']);
    const pfd = (extra) => {
      sb.__vf = { incentives: INC };
      vm.runInContext('_lpValueFactCache["6191"] = { vf: globalThis.__vf, inv: null, fetchedAt: Date.now(), invSettledAt: Date.now(), pending: false };', sb);
      const d = Object.assign({ name: 'Test Buyer', agent: 'Agent Name', vehicle: '', dealerId: '6191', store: 'Community Honda Baytown',
        leadSource: 'Hds Chat-Text Leads - Gubagoo - Chat Gubagoo - M-Chat', convState: 'first-touch', leadAgeDays: 0, totalNoteCount: 3, hasOutbound: false,
        hasCustomerReply: false, relationshipSignals: {}, conversationBrief: '[CUSTOMER CHAT SUMMARY] ' + CHAT, history: '', context: '', lastInboundMsg: CHAT,
        pdPresent: true, pdHasLeadVehicle: false, pdVoiCount: 0 }, extra);
      vm.runInContext('activeFlags = new Set(); leadContext = "";', sb);
      sb.populateFromData(d);
      return vm.runInContext('leadContext', sb);
    };
    const c1 = pfd({});
    check('populateFromData: "STORE OFFERS FOR WHAT THEY DESCRIBED" with the Accord lease, on the first touch', () =>
      [/STORE OFFERS FOR WHAT THEY DESCRIBED \(no model is on file; they asked about lease offers on a sedan\)/.test(c1), /Accord — \$229\/mo/.test(c1), /Do NOT say you will "check the offers"/.test(c1)], [true, true, true]);
    const c2 = pfd({ lastInboundMsg: 'Is anyone available to talk this afternoon?', conversationBrief: '' });
    check('control: no offer question -> no block', () => /STORE OFFERS FOR WHAT THEY DESCRIBED/.test(c2), false);

    console.log(' 4. the voicemail signs the lead\'s store:');
    check('dealer 6191 with an agent-level "Community Auto Group" context -> "Community Honda Baytown"', () => {
      vm.runInContext('lastScrapedData = { dealerId: "6191" }; window._leadProResolvedContext = { storeName: "Community Auto Group" }; window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" };', sb);
      const p = sb.buildSystemPromptVoicemailOnly('bdc', 'Agent', '', '(555) 010-0100');
      return [/Community Honda Baytown/.test(p.slice(-3000)), /with Community Auto Group|at Community Auto Group/.test(p)]; }, [true, false]);
    check('...and generateVoicemail asks DEALER_ID_MAP first', () => /const vmStoreName  = \(lastScrapedData && lastScrapedData\.dealerId && typeof DEALER_ID_MAP === 'object' && DEALER_ID_MAP\[String\(lastScrapedData\.dealerId\)\]\)/.test(src), true);

    console.log(' 5. no phone on file: the number is asked for in the email, never the text:');
    check('the rewrite is told not to ask for the number in the text', () => /NO PHONE NUMBER ON FILE[\s\S]{0,160}Your text must NOT ask for it/.test(rp(Object.assign({}, CIVIC, { phone: '' }))), true);
    check('control: phone on file -> no such block', () => /NO PHONE NUMBER ON FILE/.test(rp(CIVIC)), false);
    check('the main prompt\'s NO PHONE line says the same', () => /NO PHONE ON FILE:[^\n]*Do NOT ask for their number in the SMS/.test(src), true);

    console.log(' 6. a translation translates the job title too:');
    check('the translate prompt names the title', () => /Translate the job title in the signature too/.test(src), true);
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
