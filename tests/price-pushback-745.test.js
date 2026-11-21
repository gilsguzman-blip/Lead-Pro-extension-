#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('price-pushback-745.test.js');
// (v9.7.745) Community Kia Baytown lead 2086487722, 9/29 (log267). Our 4:25 email gave a breakdown ending "Drive Out
// with all Incentives $33,998.74"; the customer answered "We are bit off on the Drive out price, It this your final
// price?"; the draft said "I can't confirm $33,998.74 as your final drive-out price yet ... I'll review the figures
// with my manager". Gil: "yes build the stronger price reply rule. I think we'd be better served to push before
// passing to a manager or sales." When the customer's own words push back on price and one of our messages from the
// last 14 days carries a figure, the prompt now says: stand behind our number, name what depends on them from the
// breakdown we sent, and ask where they need to be, with no handoff in this message.
// Executes the shipped _lpPricePushback and buildUserPrompt. Placeholder names, numbers and stock numbers only.
//
// Usage: node tests/price-pushback-745.test.js <dev popup.js> <commercial popup.js>
const path = require('path');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: price-pushback-745.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
function ago(days, hm) {
  const d = new Date(Date.now() - days * 86400000);
  return (d.getMonth() + 1 + '').padStart(2, '0') + '/' + (d.getDate() + '').padStart(2, '0') + '/' + d.getFullYear() + ' ' + hm;
}
const BREAKDOWN = 'Hi Test, Thanks for sending the link. MSRP 37,100 Price Discount -3100 Available Manufacture Rebates* -$3,000.00 Community Value Price $31,000.00 '
  + 'Sales & VIT Tax $2,084.74 Remaining Balance $34,748.74 Community Repeat Customer^ -$250.00 Community Trade-In-Assistance+ -$500.00 Drive Out with all Incentives $33,998.74 '
  + '*Must finance with Kia Finance ^Repeat Customer, Must have purchased from Community Autogroup +Trade in Assistance customers with Retail ready trade ins Would 9:15 AM or 10:30 AM Wednesday work? Agent Name';
const ours = (days, body) => '[' + ago(days, '4:25 PM') + '] [AGENT] Email reply to prospect\n  ' + body;
const theirs = (days, body) => '[' + ago(days, '4:37 PM') + '] [CUSTOMER] Email reply from prospect\n  ' + body;
const PUSH = 'We are bit off on the Drive out price, It this your final price? Regards From: Agent Name agent@example.com Sent: Tuesday 4:25 PM To: test@example.com Subject: Sorento';

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const sb = loadPopup(f, { withAuth: true });
  const lead = (last, entries, over) => Object.assign({ name: 'Test Buyer', agent: 'Agent Name', phone: '(555) 010-0199', vehicle: '2026 Kia Sorento S', condition: 'New',
    dealerId: '6190', store: 'Community Kia Baytown', leadSource: 'Internet', convState: 'active-follow-up', leadAgeDays: 10,
    hasOutbound: true, hasCustomerReply: true, totalNoteCount: 12, relationshipSignals: { lastInboundAgeDays: 0 }, history: '', context: '',
    conversationBrief: entries.join('\n'), lastInboundMsg: last }, over || {});
  const pp = (d) => sb._lpPricePushback(d);
  const prompt = (d) => { try { return sb.__lp.buildUserPrompt(d); } catch (e) { return 'THREW ' + e.message; } };

  console.log(' 1. the log267 shape:');
  const d267 = lead(PUSH, [theirs(0, PUSH), ours(0, BREAKDOWN)]);
  check('it reads their own words (the quoted thread cut off), our drive-out, and the conditional items', () => { const r = pp(d267); return r && [r.said, r.otd, r.items]; },
    ['We are bit off on the Drive out price, It this your final price? Regards', '$33,998.74',
     ['Available Manufacture Rebates (-$3,000.00)', 'Community Repeat Customer (-$250.00)', 'Community Trade-In-Assistance (-$500.00)']]);
  const p = prompt(d267);
  check('the prompt: stand behind it, no manager or salesperson in this message, name the conditions, one ask for their number', () =>
    [/THEY PUSHED BACK ON THE PRICE WE SENT/.test(p), /gave them a drive-out of \$33,998\.74/.test(p), /STAND BEHIND OUR NUMBER/.test(p),
     /do NOT pass them to a manager, the desk or a salesperson in this message/.test(p), /Community Trade-In-Assistance \(-\$500\.00\)/.test(p),
     /ONE ASK: where do they need to be\?/.test(p)], [true, true, true, true, true, true]);
  check('no trade on the lead -> the trade item is said as a statement, not a second question', () => /No trade-in is recorded on this lead: say the trade item applies only with a trade/.test(p), true);
  check('...and with a trade on the lead that line is not there', () => /No trade-in is recorded/.test(prompt(lead(PUSH, [theirs(0, PUSH), ours(0, BREAKDOWN)], { vrTradeIn: true }))), false);
  check('a clear ask needs no price word: "Can you do better?"', () => !!pp(lead('Can you do better?', [theirs(0, 'Can you do better?'), ours(1, BREAKDOWN)])), true);

  console.log(' 2. controls, where it must not fire:');
  check('control (new helper): they push back but we never sent a figure', () => pp(lead(PUSH, [theirs(0, PUSH), ours(0, 'Hi Test, the Sorento is here. Would 9:15 AM work?')])), null);
  check('control (new helper): our figure is 20 days old', () => pp(lead(PUSH, [theirs(0, PUSH), ours(20, BREAKDOWN)])), null);
  check('control (new helper): the push-back words are only in the thread quoted under their reply', () =>
    pp(lead('Thanks, see you Wednesday. From: Agent Name Sent: Tuesday To: test@example.com is this your final price', [theirs(0, 'Thanks'), ours(0, BREAKDOWN)])), null);
  check('control (new helper): "a bit off" with no price word ("the color is a bit off")', () => pp(lead('The color is a bit off from the photos.', [theirs(0, 'x'), ours(0, BREAKDOWN)])), null);
  check('control (new helper): they have been quiet 20 days', () => pp(lead(PUSH, [theirs(20, PUSH), ours(0, BREAKDOWN)], { relationshipSignals: { lastInboundAgeDays: 20 } })), null);
  check('control: no push-back at all -> no block in the prompt', () => /THEY PUSHED BACK/.test(prompt(lead('Sounds good, see you Wednesday.', [theirs(0, 'Sounds good'), ours(0, BREAKDOWN)]))), false);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
