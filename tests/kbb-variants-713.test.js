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
    for (const ls of LABELS.filter(l => !/toyota/i.test(l))) await check('"' + ls + '"', () => reading(ls), [true, 'Kelley Blue Book', true, true, true]);
    // (v9.7.714) Gil: "KBB on Toyota.com would be the most correct." Still the KBB scenario; its own
    // name, its own NAMED SOURCE wording, and never "came through Kelley Blue Book".
    await check('v9.7.714: "Toyota.Com-Kbb Trade-In" is the KBB scenario, named "KBB on Toyota.com"', () => {
      const r = reading('Toyota.Com-Kbb Trade-In');
      vm.runInContext('leadContext = "";', sb);
      const p = sb.__lp.buildUserPrompt(lead('Toyota.Com-Kbb Trade-In'));
      return [r[0], r[1], r[2], /NAMED SOURCE — KBB ON TOYOTA\.COM:/.test(p), /MUST mention "KBB on Toyota\.com" once/.test(p),
        /HOW THIS LEAD REACHED US: you may say the customer came through KBB on Toyota\.com/.test(p), /customer came (?:in )?through Kelley Blue Book/.test(p)]; },
      [true, 'KBB on Toyota.com', true, true, true, true, false]);
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
    // (v9.7.714) On the Toyota.com source, "KBB on Toyota.com", a bare "KBB" and a bare "Toyota.com"
    // are all mentions the rewrite may not drop.
    const refineT = async (pass1) => { sb.__p2 = P2;
      return vm.runInContext('_lpRefineSms', sb)(pass1, EMAIL, { leadSource: 'Toyota.Com-Kbb Trade-In', relationshipSignals: {} }); };
    for (const form of ['KBB on Toyota.com', 'KBB', 'Toyota.com']) {
      await check('v9.7.714: Toyota.com source, first draft says "' + form + '", rewrite drops it -> the first draft ships',
        () => refineT('Test, thanks for getting a value with ' + form + ' on your 2015 Accord Sport. What are you shopping for?'), null);
    }
    await check('v9.7.714: the refine prompt names it as "KBB on Toyota.com"',
      () => /The first draft names KBB on Toyota\.com/.test(vm.runInContext('_lpBuildSmsRefinePrompt', sb)('Test, your KBB value on Toyota.com is in.', EMAIL, { leadSource: 'Toyota.Com-Kbb Trade-In' })), true);
    await check('control: "blue" alone is not a mention (a blue Accord)', async () => {
      const ack = vm.runInContext('_lpSourceAckPhrase', sb)('Kbb Ico Kelley Blue Book');
      return [ack.rx.test('the blue Accord you asked about'), ack.rx.test('a book value')]; }, [false, false]);
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
