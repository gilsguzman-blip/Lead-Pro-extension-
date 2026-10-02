#!/usr/bin/env node
'use strict';
// (v9.7.712) log245, Community Honda Lafayette (capture 3d7bf33d): a KBB Trade-In Advisor lead.
//  1. The first-pass SMS opened "thanks for using KBB to value your 2015 Accord Sport", as the prompt's
//     NAMED SOURCE block required. The SMS refine pass rewrote it without KBB and ITS version shipped:
//     the v9.7.697 keep-the-source guard and the refine prompt's KEEP WHERE THEY CAME FROM block both
//     looked only for the display name "kelley blue book", so neither saw the mention to protect.
//  2. The prompt said "LIVE CONVERSATION: Customer replied within the last few hours" on a lead the
//     customer never replied to: the automated assistant had emailed (hasOutbound) and the "inbound"
//     was the KBB lead arriving (hasCustomerReply:false).
// Executes the shipped _lpRefineSms (network stubbed), _lpBuildSmsRefinePrompt and populateFromData.
//
// Usage: node tests/log245-712.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: log245-712.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
async function check(name, fn, want) {
  let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const KBB = 'Kbb Ico Kelley Blue Book';
const EMAIL = 'Keisha,\n\nThanks for using Kelley Blue Book to value your 2015 Honda Accord Sport. I would like to get a real appraisal so you know what we can actually pay for it.\n\nWhat are you shopping for?';
const P1_KBB  = 'Keisha, thanks for using KBB to value your 2015 Accord Sport. What are you shopping for? I can have the trade appraisal ready so we can confirm its value when you visit.';
const P2_NONE = 'Keisha, I can have a real appraisal ready for your 2015 Accord Sport so you’ll know what we can actually pay. What are you shopping for?';
const P2_FULL = 'Keisha, thanks for valuing your 2015 Accord Sport on Kelley Blue Book. I can have a real appraisal ready. What are you shopping for?';
const P1_PLAIN = 'Keisha, I can have the trade appraisal ready for your 2015 Accord Sport. What are you shopping for?';

(async () => {
  for (const f of BUILDS) {
    console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
    const sb = loadPopup(f, { withAuth: true });
    const refine = async (pass1, pass2, src) => {
      sb.__pass2 = pass2;
      vm.runInContext('getEndpoint = function(){ return { url: "https://proxy.test/generate" }; };'
        + 'fetch = function(){ return Promise.resolve({ json: function(){ return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__pass2 }) }] } }] }); } }); };', sb);
      sb.__logs.length = 0;
      const r = await vm.runInContext('_lpRefineSms', sb)(pass1, EMAIL, { leadSource: src || KBB, relationshipSignals: {} });
      return { r, logs: sb.__logs.slice() };
    };

    console.log(' 1. the source the first draft named survives the rewrite:');
    await check('first draft says "KBB", rewrite drops it -> the first draft ships (refine returns null)',
      async () => (await refine(P1_KBB, P2_NONE)).r, null);
    await check('...and the diag names the source it protected',
      async () => (await refine(P1_KBB, P2_NONE)).logs.some(l => /kept the first pass — it named where the customer came from \("Kelley Blue Book"\)/.test(l)), true);
    await check('control: the rewrite keeps it as "Kelley Blue Book" -> the rewrite ships',
      async () => (await refine(P1_KBB, P2_FULL)).r, P2_FULL);
    await check('control: a first draft that never named the source cannot lose it -> the rewrite ships',
      async () => (await refine(P1_PLAIN, P2_NONE)).r, P2_NONE);
    await check('the refine prompt tells the rewrite to keep it when the first draft wrote "KBB"',
      () => /KEEP WHERE THEY CAME FROM[\s\S]*The first draft names Kelley Blue Book/.test(vm.runInContext('_lpBuildSmsRefinePrompt', sb)(P1_KBB, EMAIL, { leadSource: KBB })), true);
    await check('control: no such block when the first draft never named it',
      () => /KEEP WHERE THEY CAME FROM/.test(vm.runInContext('_lpBuildSmsRefinePrompt', sb)(P1_PLAIN, EMAIL, { leadSource: KBB })), false);

    console.log(' 2. "customer replied" only when the customer replied:');
    const pfd = (extra) => {
      vm.runInContext('activeFlags = new Set(); leadContext = "";', sb);
      sb.populateFromData(Object.assign({ name: 'Test Buyer', agent: 'Agent Name', vehicle: '', dealerId: '24399',
        store: 'Community Honda Lafayette', leadSource: KBB, convState: 'first-touch', leadAgeDays: 0, totalNoteCount: 3,
        isLiveConversation: true, relationshipSignals: {}, history: '', context: '' }, extra));
      const c = vm.runInContext('leadContext', sb);
      return [/LIVE CONVERSATION: Customer replied/.test(c), /AND THEY HAVE NOT REPLIED/.test(c), /nobody has written to them yet/.test(c)];
    };
    await check('the assistant wrote, the customer did not reply -> NOT "Customer replied"', () => pfd({ hasOutbound: true, hasCustomerReply: false }), [false, true, false]);
    await check('control: the customer did reply -> LIVE CONVERSATION', () => pfd({ hasOutbound: true, hasCustomerReply: true }), [true, false, false]);
    await check('control: nobody has written -> the original FRESH INQUIRY', () => pfd({ hasOutbound: false, hasCustomerReply: false }), [false, false, true]);
    await check('control: hasCustomerReply absent keeps the old two-way reading', () => pfd({ hasOutbound: true }), [true, false, false]);
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
