#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('quiet-customer-736.test.js');
// (v9.7.736) Audi Lafayette lead 2049511947, 9/29 (log259, capture d90b6e6c). v9.7.735's four gates all fired and
// the draft still opened on the customer's $16,000 July target and offered two times today. Four more places fed
// July in, none of them aware the customer last wrote 76 days ago:
//   1. RELATIONSHIP READING, FRICTION: "lead with their stated number as the goal";
//   2. OPEN THREADS: his 7/15 "I will email you later today", and an August "commitment" of ours;
//   3. the Lafayette OTD policy's "when a customer asks for OTD" steps (explain the parish, two times);
//   4. nothing said plainly how old the conversation was.
// Gil: "Still a bad miss." Executes the shipped renderRelationshipReading and buildUserPrompt. Placeholders only.
//
// Usage: node tests/quiet-customer-736.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: quiet-customer-736.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const ago = (days, hm) => { const t = new Date(Date.now() - days * 86400000);
  return String(t.getMonth() + 1).padStart(2, '0') + '/' + String(t.getDate()).padStart(2, '0') + '/' + t.getFullYear() + ' ' + hm; };
const topic = () => ({ count: 0, mentions: [] });
const sig = (age) => ({
  consecutiveOutboundNoReply: 20, lastInboundAgeDays: age, totalInboundCount: 9, totalOutboundCount: 39, leadOutboundCount: 39,
  priorAppointmentsTotal: 0, priorNoShows: 0, frustrationSignals: [], priorPricingObjections: [],
  topicMentions: { trade: topic(), financing: topic(), configuration: topic(), distance: topic(), useCase: topic(), competitor: topic() },
  customerCommitments: [{ date: ago(age, '1:02 PM'), sentence: 'I will email you later today about rescheduling' }],
  agentCommitments: [{ date: ago(Math.max(age - 30, 0.5), '10:06 AM'), sentence: 'I will have the manager review the numbers and get back to you' }],
  unansweredQuestions: [], personalContext: [],
  channelFatigue: true, hasNoShowHistory: false, hasFrustrationHistory: false, hasPricingFriction: false,
  hasRecurringTopic: false, hasOpenCommitments: true, hasUnansweredQuestions: false, hasPersonalContext: false });
const lead = (age, over) => Object.assign({ name: 'Test Buyer', agent: 'Agent Name', salesRep: 'Rep Name', phone: '(555) 010-0199', email: 'test@example.com',
  vehicle: '2017 Toyota Corolla SE', dealerId: '21135', store: 'Audi Lafayette', leadSource: 'Gubagoo - Online Dr', convState: 'active-follow-up',
  leadAgeDays: age + 5, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 60, relationshipSignals: sig(age),
  conversationBrief: '', context: '', lastInboundMsg: 'I would be a buyer if you could keep the price out the door around $16,000.' }, over || {});

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const sb = loadPopup(f, { withAuth: true });
  const rr = (age) => { vm.runInContext('window._leadProMentionsCashOrOffer = true;', sb); return vm.runInContext('renderRelationshipReading', sb)(lead(age)); };
  const up = (age, over) => { vm.runInContext('leadContext = ""; window._lpNoApptLeadId = ""; window._leadProMentionsCashOrOffer = true;', sb); return sb.__lp.buildUserPrompt(lead(age, over)); };

  console.log(' 1. relationship reading, friction:');
  check('quiet 76 days: no "lead with their stated number"; the target is background', () => {
    const t = rr(76); return [/lead with their stated number as the goal/.test(t), /It is background from a conversation that stalled, not this message's subject: do NOT lead with their number/.test(t)]; }, [false, true]);
  check('control: quiet 2 days, "lead with their stated number" as before', () => /lead with their stated number as the goal/.test(rr(2)), true);

  console.log(' 2. open threads:');
  check('quiet 76 days: the July "I will email you later today" and the old commitment of ours are not listed', () => {
    const t = rr(76); return [/I will email you later today/.test(t), /I will have the manager review/.test(t)]; }, [false, false]);
  check('control: quiet 2 days, both are listed', () => {
    const t = rr(2); return [/I will email you later today/.test(t), /I will have the manager review/.test(t)]; }, [true, true]);

  console.log(' 3. the Lafayette OTD policy:');
  check('quiet 76 days: the short form -- nobody is asking now, do not raise it; no parish steps, no two times', () => {
    const p = up(76); return [/The customer has not written in 76 days, so nobody is asking for one now: do NOT raise out-the-door pricing/.test(p),
      /\(2\) Explain: The exact total depends on the parish/.test(p), /\(5\) Close with two specific appointment times/.test(p)]; }, [true, false, false]);
  check('control: quiet 2 days, the full policy', () => /\(2\) Explain: The exact total depends on the parish/.test(up(2)), true);

  console.log(' 4. one plain line on how old the conversation is:');
  // (v9.7.737) The line moved to the top of the prompt as the quiet-customer owner rule (quiet-sweep-737).
  check('quiet 76 days: the owner rule says they last wrote 76 days ago and what came before is background', () => {
    const p = up(76); return [/⏳ THIS CUSTOMER LAST WROTE 76 DAYS AGO/.test(p), /Everything from before they went quiet is BACKGROUND/.test(p)]; }, [true, true]);
  check('control: quiet 2 days, no such line', () => /THIS CUSTOMER LAST WROTE/.test(up(2)), false);
  check('control: a customer who never wrote gets no such line', () => /THIS CUSTOMER LAST WROTE/.test(up(76, { hasCustomerReply: false, lastInboundMsg: '' })), false);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
