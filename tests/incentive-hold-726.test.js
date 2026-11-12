#!/usr/bin/env node
'use strict';
// (v9.7.726) log251, Community Kia Baytown, 9/25: the BD agent had written on 9/23; on 9/24 the customer
// replied with trade photos, a finance application and the trim they want, and the virtual assistant
// answered a minute later. The agent's next draft answered all of it AND added "$750 Conquest Cash and $750
// Owner Loyalty Cash through September 30". Gil agreed the rule:
//  1. A proactive incentive is for a follow-up the customer has NOT answered, or for a customer who asked
//     about price, payment or deals. While the customer's latest message is newer than our last message
//     from a PERSON, the draft answers them and the incentive waits. The automated assistant's instant
//     reply does not count as having answered them.
//  2. Program fit: owner loyalty is for current owners of the store's brand, conquest for owners of another
//     brand. When the trade's make is known, the prompt says which one fits.
// Executes the shipped _lpCustomerAwaitingHuman and populateFromData. Incentive lines are placeholders.
//
// Usage: node tests/incentive-hold-726.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: incentive-hold-726.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
// Dated relative to the run's clock so the lead never ages into a different state (see log244-710).
const DAY = 86400000, NOW = Date.now();
const fmt = (ms) => { const f = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  .formatToParts(new Date(ms)).reduce((o, p) => (o[p.type] = p.value, o), {}); return f.month + '/' + f.day + '/' + f.year + ' ' + f.hour + ':' + f.minute + ' ' + f.dayPeriod.toUpperCase(); };
const ent = (ms, tag, title, body) => '[' + fmt(ms) + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const T_AGENT = NOW - 1.8 * DAY, T_CUST = NOW - 0.9 * DAY, T_BOT = T_CUST + 60000;
const AGENT_TXT = 'Sent to: (555) 010-0199 Sent by: Agent Name Test, I can verify the Telluride configuration. Are you planning to finance?';
const BOT_TXT = 'Sent to: (555) 010-0199 Sent by: Vinessa Virtual Assistant Community Kia Great news, you can get started with your finance application.';
const CUST = 'I can send photos of my trade in and fill out a finance application. Looking for light trim captain seats in the back';
const brief = (custBody, extra) => 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + (extra || '')
  + ent(T_BOT, 'AGENT', 'Outbound Text Message', 'Great news, you can get started with your finance application.')
  + ent(T_CUST, 'CUSTOMER', 'Inbound Text Message', custBody)
  + ent(T_AGENT, 'AGENT', 'Outbound Text Message', 'Test, I can verify the Telluride configuration. Are you planning to finance?')
  + '[' + fmt(T_AGENT - 300000) + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n---\n';
const SENDS = (list) => list.map(([ms, body]) => ({ title: 'outbound text message', ms, body }));
const VF = { incentives: [{ model: 'Telluride', line: '$750 Conquest Cash', expires: '2099-09-30' }, { model: 'Telluride', line: '$750 Owner Loyalty Cash', expires: '2099-09-30' }] };

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const sb = loadPopup(f, { withAuth: true });
  const run = (extra) => {
    const d = Object.assign({ name: 'Test Buyer', agent: 'Agent Name', vehicle: '2027 Kia Telluride LX FWD', condition: 'New', dealerId: '6190', store: 'Community Kia Baytown',
      leadSource: 'Truecar', convState: 'active-follow-up', leadAgeDays: 2, totalNoteCount: 12, hasOutbound: true, hasCustomerReply: true, relationshipSignals: {},
      history: '', context: '', conversationBrief: brief(CUST), lastInboundMsg: CUST, tradeDescription: '2016 Lincoln Navigator Select RWD\n\t101,000 miles', hasTrade: true,
      outboundSends: SENDS([[T_BOT, BOT_TXT], [T_AGENT, AGENT_TXT]]) }, extra || {});
    sb.__vf = VF;
    vm.runInContext('activeFlags = new Set(); leadContext = ""; _lpValueFactCache["6190"] = { vf: globalThis.__vf };', sb);
    sb.__logs.length = 0;
    sb.populateFromData(d);
    const c = vm.runInContext('leadContext', sb);
    return { c, inc: /Conquest Cash|Owner Loyalty Cash/.test(c), logs: sb.__logs.slice() };
  };
  const live = (d) => vm.runInContext('_lpCustomerAwaitingHuman', sb)(d).live;

  console.log(' 1. the customer is waiting on a person -> the draft answers them, no incentive:');
  const r = run();
  check('log251 shape: no incentive line, and the diag says why', () => [r.inc, r.logs.some(l => /^\[LP INCENTIVE DIAG\] suppressed — the customer's latest message .* is newer than our last message from a person/.test(l))], [false, true]);
  check('the assistant\'s instant reply does not count as having answered them', () => live({ conversationBrief: brief(CUST), outboundSends: SENDS([[T_BOT, BOT_TXT], [T_AGENT, AGENT_TXT]]) }), true);
  check('...but a PERSON answering after them does', () => live({ conversationBrief: brief(CUST), outboundSends: SENDS([[T_CUST + 3600000, AGENT_TXT], [T_AGENT, AGENT_TXT]]) }), false);
  check('the customer who ASKED about deals still gets the incentive while waiting on us', () => {
    const q = 'any specials on the Telluride? I can send photos of my trade in';
    return run({ conversationBrief: brief(q), lastInboundMsg: q }).inc; }, true);

  console.log(' 2. a follow-up they have not answered -> the incentive is available, as before:');
  const f1 = run({ outboundSends: SENDS([[T_CUST + 3600000, AGENT_TXT], [T_AGENT, AGENT_TXT]]),
    conversationBrief: brief(CUST, ent(T_CUST + 3600000, 'AGENT', 'Outbound Text Message', 'Test, send the photos whenever you are ready.')) });
  check('our person wrote after their reply and they have not answered -> incentive lines present', () => f1.inc, true);
  check('control: no customer entry at all -> not "waiting on us"', () => live({ conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + ent(T_AGENT, 'AGENT', 'Outbound Text Message', 'hi') + '---\n', outboundSends: SENDS([[T_AGENT, AGENT_TXT]]) }), false);
  check('control: no visible send from a person -> not decided here (the v9.7.658 assistant-only rule owns that case)', () => live({ conversationBrief: brief(CUST), outboundSends: SENDS([[T_BOT, BOT_TXT]]) }), false);

  console.log(' 3. program fit, when the incentive is shown:');
  const fit = (trade) => { const c = run({ tradeDescription: trade, outboundSends: SENDS([[T_CUST + 3600000, AGENT_TXT]]),
    conversationBrief: brief(CUST, ent(T_CUST + 3600000, 'AGENT', 'Outbound Text Message', 'Test, send the photos whenever you are ready.')) }).c;
    const m = c.match(/🏷 PROGRAM FIT:[^\n]*/); return m ? m[0] : ''; };
  check('a Lincoln trade at a Kia store: no loyalty cash; conquest is the one', () => {
    const t = fit('2016 Lincoln Navigator Select RWD\n\t101,000 miles');
    return [/their trade is a 2016 Lincoln Navigator Select RWD, not a Kia/.test(t), /do NOT offer the loyalty cash unless they tell you there is a Kia in the household/.test(t), /their Lincoln likely qualifies/.test(t), /\n|101,000/.test(t)]; }, [true, true, true, false]);
  check('a Kia trade: conquest does not fit; loyalty is the one', () => /CONQUEST cash is for owners of ANOTHER brand, so do NOT offer it to them; the OWNER LOYALTY cash is the one that fits/.test(fit('2019 Kia Sorento LX')), true);
  check('control: no trade on the lead -> no program-fit line', () => fit(''), '');
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
