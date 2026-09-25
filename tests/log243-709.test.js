#!/usr/bin/env node
'use strict';
// (v9.7.709) log243, Community Honda Baytown (capture 57e67434, dump 037f879b). A remote buyer
// negotiating a used BMW asked "Just to confirm your offer now is 41,019? Is that correct?" and the
// draft said "Yes, $41,019 is the current proposal". We never quoted $41,019. The same prompt told the
// model the customer wanted a TRADE value (they had said "I won't be trading in my old vehicle"), that
// they had DESCRIBED their trade, that they had DISCLOSED CREDIT DIFFICULTIES (from "AutoCheck report"),
// and that they had VERBALLY CONFIRMED an appointment (from our own text "we will be here").
// Runs shipped code: the popup helpers and buildUserPrompt / populateFromData on the whole popup.js,
// and the scraper's concern block and verbal-confirm condition lifted verbatim. Fixtures are synthetic
// in the shape of the capture; the phone number is a placeholder.
//
// Usage: node tests/log243-709.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: log243-709.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const ent = (date, tag, title, body) => '[' + date + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const NO_TRADE = ent('08/24/2026 10:54 AM', 'CUSTOMER', 'Inbound Text Message', 'I won’t be trading in my old vehicle though. Long story');
const LIEN = ent('08/24/2026 4:48 PM', 'CUSTOMER', 'Inbound Text Message', 'It does Three quick things: 1) a short video 2) the service visits and 3) the title/lien payoff timeline. Those last three things and we can honestly move pretty fast');
const REPORT = ent('08/27/2026 3:42 PM', 'CUSTOMER', 'Inbound Text Message', 'If you think a 59k-mile car with a disabling collision on the report nets more than that, you should run it. The AutoCheck report shows it.');
const OUR_4435 = ent('08/26/2026 4:08 PM', 'AGENT', 'Outbound Text Message', 'I’ve chatted with my manager and our internet price is our best price. The bottom line is $44,358.34.');
const OUR_39907 = ent('08/27/2026 2:55 PM', 'AGENT', 'Outbound Text Message', 'The price of the BMW is 39907, being at 36500 is below what auction would bring in.');
const THEIR_MATH = ent('08/27/2026 2:20 PM', 'CUSTOMER', 'Inbound Text Message', 'I ran your sheet. You are taxing a base of $42,019. Here is where I am: $36,500 vehicle price.');
const OUR_1000 = ent('09/23/2026 1:25 PM', 'AGENT', 'Outbound Text Message', 'The proposal is the same from the last time however the price is reduced by $1,000.');
const ASK = 'Received from: (555) 010-0199 Received by: Rep Name After reading this thread, I think we are still far apart. Just to confirm your offer now is 41,019? Is that correct?';
const ASK_ENT = ent('09/23/2026 3:43 PM', 'CUSTOMER', 'Inbound Text Message', 'After reading this thread, I think we are still far apart. Just to confirm your offer now is 41,019? Is that correct?');
const THREAD = ASK_ENT + OUR_1000 + REPORT + OUR_39907 + THEIR_MATH + OUR_4435 + LIEN + NO_TRADE;

for (const f of BUILDS) {
  const src = fs.readFileSync(f, 'utf8');
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const D = (extra) => Object.assign({ name: 'Test Buyer', agent: 'Agent Name', phone: '(555) 010-0199', email: 'test@example.com',
    vehicle: '2024 BMW 4 Series M440i xDrive', stockNum: 'TA000001A', dealerId: '6191', store: 'Community Honda Baytown', leadSource: 'Website',
    convState: 'active-follow-up', hasOutbound: true, hasCustomerReply: true, relationshipSignals: {}, context: THREAD, conversationBrief: '',
    lastInboundMsg: ASK }, extra || {});

  console.log(' 1. a figure we never quoted:');
  check('the customer\'s 41,019 is flagged, and the figures we DID send are what it was checked against',
    () => { const r = sb._lpUnquotedFigure(D()); return r && [r.figure, r.ours.indexOf(44358) > -1, r.ours.indexOf(39907) > -1, r.ours.indexOf(42019)]; },
    ['41,019', true, true, -1]);
  check('...their phone number in the CRM header is not money', () => sb._lpMoneyFigures(ASK).map(x => x.value), [41019]);
  check('a figure we DID write (36,500, which we answered in our own text) is not flagged',
    () => sb._lpUnquotedFigure(D({ lastInboundMsg: 'So 36,500 works for you now? Is that correct?' })), null);
  check('no question, no guard ("41,019 works for me.")', () => sb._lpUnquotedFigure(D({ lastInboundMsg: '41,019 works for me.' })), null);
  const prompt = (extra) => { const d = D(extra); vm.runInContext('leadContext = ' + JSON.stringify(d.context) + ';', sb); sb.__logs.length = 0;
    return { p: sb.__lp.buildUserPrompt(d), logs: sb.__logs.slice() }; };
  check('buildUserPrompt tells the model not to answer "yes" to it, and logs why', () => { const r = prompt();
    return [/THEY ARE ASKING YOU TO CONFIRM 41,019, AND WE NEVER QUOTED THAT FIGURE/.test(r.p), /Do NOT answer "yes"/.test(r.p),
            r.logs.some(l => /^\[LP UNQUOTED FIGURE DIAG\] customer asks us to confirm 41,019/.test(l))]; }, [true, true, true]);
  check('control: asking about a figure we sent gets no such line', () => /WE NEVER QUOTED THAT FIGURE/.test(prompt({ lastInboundMsg: 'So the bottom line is still $44,358.34? Is that right?' }).p), false);

  console.log(' 2. no trade:');
  check('"I won\'t be trading in my old vehicle" is a no-trade statement', () => sb._lpCustomerDeclinedTrade(D()), 'won’t be trading in');
  check('...which a NEWER message raising their own trade lifts', () => sb._lpCustomerDeclinedTrade(D({ lastInboundMsg: 'Actually what would you give me for my trade-in? I still owe 12k' })), '');
  check('"I don\'t know what my trade is worth" is not a no-trade statement',
    () => sb._lpCustomerDeclinedTrade(D({ context: ent('09/01/2026 9:00 AM', 'CUSTOMER', 'Inbound Text Message', 'I don’t know what my trade is worth'), lastInboundMsg: 'x' })), '');
  check('the "TRADE is worth" directive no longer fires off "title/lien payoff" on this lead',
    () => /what their TRADE is worth/.test(prompt().p), false);
  check('...and not off a lien payoff alone either (no no-trade statement in the thread)',
    () => /what their TRADE is worth/.test(prompt({ context: ASK_ENT + LIEN }).p), false);
  check('control: a real trade-value ask still gets it',
    () => /what their TRADE is worth/.test(prompt({ context: ent('09/23/2026 3:43 PM', 'CUSTOMER', 'Inbound Text Message', 'What would you give me for my trade-in?'),
      lastInboundMsg: 'What would you give me for my trade-in?' }).p), true);

  console.log(' 3. the scraper\'s concern block, lifted verbatim:');
  const a = src.indexOf('      var _tradeRx  ='), b = src.indexOf('      if(/co.?sign|cosign', a);
  const concerns = (lines, allText) => {
    const said = lines.map((t, i) => ({ text: t, ms: 1000 + i }));
    const out = [];
    new Function('_lpCustomerSaid', '_lpD', 'customerConcerns', 'allTranscriptText', 'customerOnlyText', src.slice(a, b))(
      () => said, () => {}, out, allText || lines.join(' '), lines.join(' '));
    return out.map(c => c.split(':')[0]);
  };
  const L243 = ['I won’t be trading in my old vehicle though. Long story',
    'It does Three quick things: 3) the title/lien payoff timeline. Those last three things and we can honestly move pretty fast',
    'Flexible, if financing through you helps get to my number I am open to it.',
    'If you think a 59k-mile car with a disabling collision on the report nets more than that you should run it. The AutoCheck report shows it.'];
  check('log243: no TRADE-IN CONCERN and no CREDIT CHALLENGE (financing is real, so FINANCING stays)', () => concerns(L243), ['FINANCING CONCERN']);
  check('control: a customer asking about their own trade still gets TRADE-IN CONCERN',
    () => concerns(['What would you give me for my trade-in? I still owe 12k on it']).indexOf('TRADE-IN CONCERN') > -1, true);
  check('control: "I have bad credit" and "they repo\'d my last car" are still credit challenges',
    () => [concerns(['I have bad credit']).indexOf('CREDIT CHALLENGE DISCLOSED') > -1, concerns(['they repo’d my last car']).indexOf('CREDIT CHALLENGE DISCLOSED') > -1], [true, true]);
  check('the scraper\'s no-trade and lien patterns are the popup\'s, character for character', () => {
    const m1 = src.match(/var _tradeNoRx = (\/.*\/i);/), m2 = src.match(/var _tradeLienRx = (\/.*\/gi);/);
    return [!!m1 && m1[1] === String(vm.runInContext('LP_NO_TRADE_RE', sb)), !!m2 && m2[1] === String(vm.runInContext('LP_TRADE_LIEN_RE', sb))]; }, [true, true]);

  console.log(' 4. "customer verbally confirmed":');
  const vi = src.indexOf("apptEvent = 'Call note: customer verbally confirmed");
  const ei = src.lastIndexOf('else if (', vi);
  const cond = src.slice(ei + 'else if ('.length, src.lastIndexOf(') {', vi));
  const vc = (dir, title, content) => new Function('anDir', 'anTitle', 'anContent', 'return (' + cond + ');')(dir, title, content);
  check('our own TEXT "If anything changes, we will be here" is not a verbal confirmation',
    () => vc('outbound', 'outbound text message', 'Sent to: (555) 010-0199 Thank you for giving us the opportunity. If anything changes, we will be here.'), false);
  check('control: a call note saying the customer will be here Monday still is',
    () => vc('outbound', 'outbound phone call', 'By: Rep spoke with customer, confirmed appointment monday at 10, she will be here'), true);

  console.log(' 5. the TRADE DISCUSSED guard (populateFromData):');
  const guard = (ctx, voiName) => {
    vm.runInContext('activeFlags = new Set(); leadContext = "";', sb); sb.__logs.length = 0;
    sb.populateFromData({ name: 'Test Buyer', agent: 'Agent Name', vehicle: voiName || '2024 BMW 4 Series M440i xDrive', stockNum: 'TA000001A', dealerId: '6191',
      store: 'Community Honda Baytown', leadSource: 'Website', convState: 'active-follow-up', leadAgeDays: 31, totalNoteCount: 10, hasOutbound: true,
      hasCustomerReply: true, pdPresent: true, pdTradeCount: 0, hasTrade: false, relationshipSignals: {},
      leadIntakeReq: 'Subject: 2024 BMW M440i — Stock TA000001A — Availability + window sticker',
      lastInboundMsg: 'Is it still there?', history: ctx, context: ctx });
    const c = vm.runInContext('leadContext', sb);
    return /customer HAS described their trade/.test(c) ? 'described' : /⚠ NO TRADE:/.test(c) ? 'no-trade' : /No trade vehicle has been named/.test(c) ? 'none-named' : 'no-guard';
  };
  const TRADE_ASK = ent('08/24/2026 10:50 AM', 'CUSTOMER', 'Inbound Text Message', 'Do you take a trade-in?');
  check('"2024 BMW M440i" in the inquiry subject is the vehicle of interest, not a named trade', () => guard(TRADE_ASK), 'none-named');
  check('a customer who said they are not trading gets the NO TRADE line instead', () => guard(NO_TRADE + TRADE_ASK), 'no-trade');
  check('control: a real, different vehicle in the thread is still a named trade',
    () => guard(ent('08/24/2026 10:50 AM', 'CUSTOMER', 'Inbound Text Message', 'Do you take a trade-in? I have a 2019 Toyota Camry')), 'described');
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
