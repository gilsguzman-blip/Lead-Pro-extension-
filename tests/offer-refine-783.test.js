#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('offer-refine-783.test.js');
// (v9.7.783) log306, Honda Lafayette lead 2097428117 on v9.7.782. The customer said yes to a video of a unit that then sold. The
// first draft told them it sold, named the closest comparable and asked "Would you like a video of that one instead?"; the text
// rewrite shipped "I'll send you a video of the Certified Pre-Owned 2024 Accord LX ... The EX-L 2.0T you asked about has sold" --
// a promise they never accepted, ahead of the news, with nothing to answer, while the email still asked. Now: the rewrite is told
// to say the vehicle sold first and to keep the offer a question, and a rewrite that turns the first pass's offer into a promise
// and asks no question at all does not ship. Executes the shipped _lpBuildSmsRefinePrompt, _lpRefineSms (worker stubbed) and the
// patterns. Placeholder data only.
//
// Usage: node tests/offer-refine-783.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: offer-refine-783.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const LEAD = (x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2018 Honda Accord Sedan EX-L 2.0T', dealerId: '24399',
  store: 'Community Honda Lafayette', leadSource: 'Cargurus', convState: 'active-follow-up', leadAgeDays: 0, hasOutbound: true, totalNoteCount: 11,
  phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: 'Yes that would be great!', relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 0 } }, x || {});
const SIG = '\nAgent\nTest Store\n(555) 010-0100';
const PASS1 = 'Test, I’m glad a video would help. The Accord EX-L 2.0T has sold, but we do have a Certified Pre-Owned 2024 Honda Accord LX in Platinum White Pearl as a comparable option. Would you like a video of that one instead?' + SIG;
const EMAIL = 'Subject: A comparable Accord to consider\n\nHi Test,\n\nI’m glad a video would be helpful. I need to let you know the Accord EX-L 2.0T you asked about has sold. A comparable option we have in stock is a Certified Pre-Owned 2024 Honda Accord LX in Platinum White Pearl.\n\nWould you like me to send you a video of that Accord?\n\nAgent Name\nTest Store';
const PROMISED = 'Test, I’ll send you a video of the Certified Pre-Owned 2024 Accord LX in Platinum White Pearl. The EX-L 2.0T you asked about has sold, but this is a comparable option we have in stock.\n' + SIG;
const KEPT = 'Test, the EX-L 2.0T you asked about has sold, I’m sorry. We do have a Certified Pre-Owned 2024 Accord LX in Platinum White Pearl. Want a video of that one?' + SIG;
const PROMISE_ASK = 'Test, the EX-L 2.0T has sold. I’ll send a video of the 2024 Accord LX CPO if that helps -- or would the 2025 SE suit you better?' + SIG;
const PLAIN1 = 'Test, the Accord is here and ready. Does Saturday at 10 AM work for a look?' + SIG;
const PLAIN_EMAIL = 'Subject: Saturday\n\nHi Test,\n\nThe Accord is here. Does Saturday at 10 AM work?\n\nAgent Name\nTest Store';

(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (expr) => vm.runInContext(expr, sb);
  const rp = (p1, em) => { const ol = sb.console.log; sb.console.log = () => {}; try { return run('_lpBuildSmsRefinePrompt')(p1, em, LEAD()); } finally { sb.console.log = ol; } };

  console.log(' 1. the rewrite is told:');
  const R = rp(PASS1, EMAIL);
  check('log306 shape: the vehicle sold -> say so FIRST, before naming another vehicle', () =>
    /━━━ THE VEHICLE THEY ASKED ABOUT HAS SOLD ━━━\nThe email tells them it sold\. The text tells them too, FIRST and plainly, before it names any other vehicle/.test(R), true);
  check('log306 shape: the offer stays a question, quoting the first draft\'s own ask', () =>
    /━━━ AN OFFER STAYS AN OFFER ━━━\nThe first draft ASKS whether they want something \(Would you like a video of that one instead\?\)\. The text asks too\. Do not turn it into "I'll send you\.\.\."/.test(R), true);
  check('control: a plain appointment question with nothing sold -> neither section', () =>
    [/THE VEHICLE THEY ASKED ABOUT HAS SOLD/.test(rp(PLAIN1, PLAIN_EMAIL)), /AN OFFER STAYS AN OFFER/.test(rp(PLAIN1, PLAIN_EMAIL))], [false, false]);

  console.log(' 2. a rewrite that turns the offer into a promise does not ship (worker stubbed):');
  const refine = async (p1, reply) => { const logs = []; sb.__reply = reply; sb.__d = LEAD();
    run('window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Test Store" };'
      + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpActiveProhibitions = [];'
      + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
      + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
      + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };');
    const ol = sb.console.log; sb.console.log = (...a) => logs.push(a.join(' '));
    let out; try { out = await run('_lpRefineSms(' + JSON.stringify(p1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)'); } catch (e) { out = 'THREW ' + e.message; }
    sb.console.log = ol; return [out === null ? null : 'shipped', logs.some(l => /kept the first pass — it asked whether they want it \("Would you like a video[^"]*"\) and the rewrite promised it \("I.ll send"\) with no question/.test(l))]; };
  await acheck('log306: "I\'ll send you a video of the ... 2024 Accord LX", no question -> the first pass ships, logged', () => refine(PASS1, PROMISED), [null, true]);
  await acheck('control: a rewrite that keeps the offer a question ships', () => refine(PASS1, KEPT), ['shipped', false]);
  await acheck('control: a rewrite that promises but still asks them something ships', () => refine(PASS1, PROMISE_ASK), ['shipped', false]);
  await acheck('control: a first pass that already promised the video -> the rewrite\'s promise ships', () =>
    refine('Test, I’ll send a video of the 2024 Accord LX CPO this afternoon. The EX-L 2.0T has sold.' + SIG, PROMISED), ['shipped', false]);

  console.log(' 3. the patterns:');
  const ASK = run("typeof LP_OFFER_ASK_RX !== 'undefined' ? LP_OFFER_ASK_RX : /(?!)/"), PROM = run("typeof LP_OFFER_PROMISE_RX !== 'undefined' ? LP_OFFER_PROMISE_RX : /(?!)/");
  check('(new helper) an offer asked: would you like / want me to / should I send / would a video help -- not "does Saturday work?"', () =>
    ['Would you like a video of that one instead?', 'Want me to send photos of the SE?', 'Should I send you the numbers?', 'Would a video be helpful?', 'Does Saturday at 10 AM work?', 'What color did you want?', 'What color do you want?', 'Sounds good, do you want the LX or the SE?']
      .map(s => ASK.test(s)), [true, true, true, true, false, false, false, true]);
  check('(new helper) a promise: I\'ll send / I will get / I’m sending -- not "I\'d be happy to send" or "you\'ll get"', () =>
    ['I\'ll send you a video.', 'I will get you the numbers.', 'I’m sending it now.', 'I\'d be happy to send a video.', 'You\'ll get it today.']
      .map(s => PROM.test(s)), [true, true, true, false, false]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
