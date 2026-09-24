#!/usr/bin/env node
'use strict';
// (v9.7.713) EVERY KBB VARIANT, BOTH KINDS. Gil, after log245: "What about all the KBB variations?"
//  A. THE SOURCE LABELS. Ten distinct KBB lead-source strings appear across the uploaded logs, captures
//     and dumps (ICO, ICO - Mobile, the (Internet) suffixes, Toyota.com-KBB Trade-In, Kelley Blue Book
//     Trade-In, KBB ICO on the dealer website, KBB ICO Lead). Each must get the same treatment: the
//     KBB scenario, the NAMED SOURCE block and "Kelley Blue Book" as the one name the prompt allows.
//     All ten already did on v9.7.712 -- these are pinned so a new label cannot silently fall out.
//  B. THE WAYS IT GETS WRITTEN. The v9.7.712 refine guard recognises a draft's mention with the source
//     table's pattern, which knew "KBB" and "Kelley Blue Book" only. "Kelly Blue Book" (a customer in
//     the corpus wrote exactly that), "Blue Book" and "K.B.B." were not mentions, so a rewrite could
//     drop them unguarded; the scenario classifier and the trade scans were narrower still.
// Executes the shipped classifyScenario, _lpSourceAckPhrase, buildUserPrompt and _lpRefineSms.
//
// Usage: node tests/kbb-variants-713.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: kbb-variants-713.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
async function check(name, fn, want) {
  let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const LABELS = ['Kbb Ico Kelley Blue Book', 'Kbb Ico Kelley Blue Book - Mobile', 'Kbb Ico Kelley Blue Book - Mobile (Internet)',
  'Kbb Ico Kelley Blue Book (Internet)', 'Toyota.Com-Kbb Trade-In', 'Kelley Blue Book - Trade In', 'Kelley Blue Book Trade-In',
  'Kbb Ico Dealer Website - Mobile', 'KBB ICO Lead', 'KBB ICO - Internet'];
const EMAIL = 'Test,\n\nThanks for valuing your 2015 Honda Accord Sport. I would like to get a real appraisal so you know what we can actually pay for it.\n\nWhat are you shopping for?';
const P2 = 'Test, I can have a real appraisal ready for your 2015 Accord Sport. What are you shopping for?';

(async () => {
  for (const f of BUILDS) {
    console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
    const sb = loadPopup(f, { withAuth: true });
    const lead = (ls) => ({ name: 'Test Buyer', agent: 'Agent Name', phone: '(555) 010-0199', email: 'test@example.com', vehicle: '',
      dealerId: /toyota/i.test(ls) ? '6190' : '24399', store: /toyota/i.test(ls) ? 'Community Toyota Baytown' : 'Community Honda Lafayette',
      leadSource: ls, convState: 'first-touch', leadAgeDays: 0, hasOutbound: false, hasCustomerReply: false, totalNoteCount: 2,
      relationshipSignals: {}, hasTrade: true, context: '', lastInboundMsg: '' });
    const reading = (ls) => {
      const sc = vm.runInContext('classifyScenario', sb)(lead(ls));
      const ack = vm.runInContext('_lpSourceAckPhrase', sb)(ls);
      vm.runInContext('leadContext = "";', sb);
      const p = sb.__lp.buildUserPrompt(lead(ls));
      return [!!sc.isKBB, ack && ack.name, /TASK: KBB Trade-In Advisor lead/.test(p), /NAMED SOURCE — KBB:/.test(p),
        /HOW THIS LEAD REACHED US: you may say the customer came through Kelley Blue Book/.test(p)];
    };
    console.log(' A. every KBB source label seen in the field gets the KBB treatment:');
    for (const ls of LABELS) await check('"' + ls + '"', () => reading(ls), [true, 'Kelley Blue Book', true, true, true]);
    await check('a source spelled "Kelly Blue Book Trade-In" is KBB too', () => reading('Kelly Blue Book Trade-In'), [true, 'Kelley Blue Book', true, true, true]);
    await check('control: AutoTrader-KBB stays an AutoTrader purchase lead (v9.7 rule)', () => !!vm.runInContext('classifyScenario', sb)(lead('AutoTrader KBB')).isKBB, false);

    console.log(' B. a draft that names it in any common form keeps it through the SMS rewrite:');
    const refine = async (pass1) => {
      sb.__p2 = P2;
      vm.runInContext('getEndpoint = function(){ return { url: "https://proxy.test/generate" }; };'
        + 'fetch = function(){ return Promise.resolve({ json: function(){ return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__p2 }) }] } }] }); } }); };', sb);
      return vm.runInContext('_lpRefineSms', sb)(pass1, EMAIL, { leadSource: 'Kbb Ico Kelley Blue Book - Mobile', relationshipSignals: {} });
    };
    for (const form of ['KBB', 'Kelley Blue Book', 'KBB.com', 'Kelly Blue Book', 'Blue Book', 'K.B.B.']) {
      const p1 = 'Test, thanks for getting a ' + form + ' value on your 2015 Accord Sport. What are you shopping for?';
      await check('first draft says "' + form + '", rewrite drops it -> the first draft ships', () => refine(p1), null);
    }
    await check('control: a first draft with no mention -> the rewrite ships', () => refine('Test, what are you shopping for next?'), P2);
    await check('control: "blue" alone is not a mention (a blue Accord)', async () => {
      const ack = vm.runInContext('_lpSourceAckPhrase', sb)('Kbb Ico Kelley Blue Book');
      return [ack.rx.test('the blue Accord you asked about'), ack.rx.test('a book value')]; }, [false, false]);
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
