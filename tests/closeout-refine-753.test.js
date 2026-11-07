#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('closeout-refine-753.test.js');
// (v9.7.753) Two drafts from the 10/1 feedback export, fixed from the code since no dump could be taken.
//  (1) Community Honda Lafayette lead 2090131196, 5 days old, never eligible to be closed out (21 days AND 5 outreaches).
//      The text that shipped: "I'll stop reaching out. If you decide you'd like to continue, we can assess your Tacoma
//      in person..." The email from the SAME generation: "Would a quick call or a text be easier for you to continue?"
//      Only the text is rewritten (_lpRefineSms), and that pass was never told the close-out ban -- it lived only in the
//      main prompt. Two more places offered the move to the model: the arc state listed "stepback" as an angle "not
//      raised with this customer yet", and stalled rung 4 carried "Should I keep this on my radar or close it out?".
//  (2) Lead 2079616544 (Facebook, bouncing address): the text said "I'll step back rather than keep filling your inbox"
//      -- an inbox that has not been receiving our emails -- and an email was drafted to the dead address with no word
//      to the agent that it would not arrive.
// Executes the shipped _lpCloseOutEligible, _lpBuildSmsRefinePrompt, _lpRefineSms (worker stubbed), _lpBuildArcState and
// buildUserPrompt. Placeholder data only.
//
// Usage: node tests/closeout-refine-753.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: closeout-refine-753.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const SIG = '\nAgent';
const lead = (age, outN, extra) => Object.assign({ name: 'Test Buyer', agent: 'Agent Name', phone: '(555) 010-0199', email: 'test@example.com',
  vehicle: '2024 Honda Accord Sedan LX', stockNum: 'TEST001A', dealerId: '24399', store: 'Community Honda Lafayette', leadSource: 'Gubagoo - Drs',
  convState: 'active-follow-up', hasOutbound: true, hasCustomerReply: false, totalNoteCount: 9, autoLeadId: '2000000001', leadAgeDays: age,
  context: '', lastInboundMsg: '', outboundSends: [], relationshipSignals: { totalOutboundCount: outN, lastInboundAgeDays: null, unansweredQuestions: [] } }, extra);
const YOUNG = lead(5, 6), OLD = lead(30, 8);
const PASS1 = 'Test, the Accord is here and available to see. We can appraise your Tacoma in about 10 minutes. Would a quick call or a text be easier to continue?' + SIG;
const WITHDRAWN = 'Test, I’ll stop reaching out. If you decide you’d like to continue, we can assess your Tacoma in person, and you can see the Accord here.' + SIG;
const EMAIL = 'Subject: Your Tacoma and the Accord\n\nHi Test,\n\nThe Accord is here and available to see, and we can appraise your Tacoma in person. Would a quick call or a text be easier for you to continue?\n\nAgent Name';

(async () => {
  for (const f of BUILDS) {
    console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
    const sb = loadPopup(f, { withAuth: true });
    check('precondition: the 5-day lead is not eligible for a close-out, the 30-day one is', () => [sb._lpCloseOutEligible(YOUNG).eligible, sb._lpCloseOutEligible(OLD).eligible], [false, true]);

    console.log(' 1. the text rewrite is told the close-out ban, in the main prompt\'s words:');
    const rp = (d, p1) => vm.runInContext('_lpBuildSmsRefinePrompt(globalThis.__p1, globalThis.__em, globalThis.__d)', Object.assign(sb, { __d: d, __p1: p1 || PASS1, __em: EMAIL }));
    check('lead 2090131196 shape (5 days): "DO NOT OFFER TO CLOSE THIS LEAD OUT" with "I will stop reaching out" named', () => {
      const p = rp(YOUNG); return [/DO NOT OFFER TO CLOSE THIS LEAD OUT/.test(p), /"I will stop reaching out"/.test(p)]; }, [true, true]);
    check('control: a lead eligible for it (30 days, 8 outreaches) -> no ban in the rewrite', () => /DO NOT OFFER TO CLOSE THIS LEAD OUT/.test(rp(OLD)), false);
    check('the main prompt carries the same words (one wording, two places)', () => {
      vm.runInContext('leadContext = ""; window._lpSuppressApptChip = false; window._lpNoApptLeadId = "";', sb);
      const p = sb.__lp.buildUserPrompt(YOUNG);
      const i = p.indexOf('DO NOT OFFER TO CLOSE THIS LEAD OUT:');
      return i > -1 && p.slice(i, i + 700).indexOf('Several outreaches in a few days is OUR cadence running') > -1; }, true);

    console.log(' 2. a rewrite that withdraws on a lead not eligible for it loses to the first pass:');
    const refine = async (d, reply) => {
      const logs = [];
      sb.__reply = reply; sb.__d = d;
      vm.runInContext('window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Test Store" };'
        + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpActiveProhibitions = [];'
        + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
        + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
        + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };', sb);
      const oldLog = sb.console.log; sb.console.log = (...x) => { logs.push(x.join(' ')); };
      let out; try { out = await vm.runInContext('_lpRefineSms(' + JSON.stringify(PASS1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)', sb); } catch (e) { out = 'THREW ' + e.message; }
      sb.console.log = oldLog;
      return { out, logged: logs.some(l => /kept the first pass — the rewrite offered to stop or close out/.test(l)) };
    };
    await acheck('lead 2090131196: "I’ll stop reaching out. If you decide you’d like to continue..." -> the first pass ships, logged',
      async () => { const r = await refine(YOUNG, WITHDRAWN); return [r.out, r.logged]; }, [null, true]);
    await acheck('control: the same rewrite on a lead eligible for a close-out ships', async () => (await refine(OLD, WITHDRAWN)).out, WITHDRAWN);
    const CLEAN = 'Test, the Accord is here. We can appraise your Tacoma in about 10 minutes. Text or a quick call, whichever is easier?' + SIG;
    await acheck('control: a rewrite with no withdrawal ships on the young lead', async () => (await refine(YOUNG, CLEAN)).out, CLEAN);

    console.log(' 3. "step back" is not offered as an untried angle on a lead that may not withdraw:');
    const arc = (d) => (sb._lpBuildArcState(d, { totalInbound: 0, totalOutbound: 6 }).lines.find(l => /^Not raised with this customer yet/.test(l)) || '');
    check('5-day lead: the "not raised yet" list has no stepback', () => [/stepback/.test(arc(YOUNG)), /appointment/.test(arc(YOUNG))], [false, true]);
    check('control: the eligible lead still lists it', () => /stepback/.test(arc(OLD)), true);

    console.log(' 4. a bouncing address: no inbox talk, and the agent is told the email will not arrive:');
    const BOUNCE = Object.assign({}, YOUNG, { emailBounce: { count: 2, lastDate: '09/20/2026' } });
    check('the LEAD line says they have not been receiving our emails -- no inbox, in text or email', () => {
      vm.runInContext('leadContext = "";', sb); const p = sb.__lp.buildUserPrompt(BOUNCE);
      return /BOUNCING[^\n]*do not mention their inbox, filling it, or our emails reaching them/.test(p); }, true);
    check('...and the text rewrite is told the same when it keeps the email ask', () =>
      /Keep that ask in your version\. They have not been receiving our emails, so do not mention their inbox/.test(rp(BOUNCE, 'Test, what is a good email address for you?' + SIG)), true);
    const src = fs.readFileSync(f, 'utf8');
    check('the agent sees "the email draft will not reach them" on a bouncing lead (new notice)', () =>
      /lastScrapedData\.emailBounce && lastScrapedData\.emailBounce\.count\) _ooMsgs\.push\('⚠ This customer\\'s email address is bouncing — the email draft will not reach them/.test(src), true);
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
