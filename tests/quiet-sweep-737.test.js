#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('quiet-sweep-737.test.js');
// (v9.7.737) Audi Lafayette lead 2049511947, 9/29 (log260, capture dcb48525). Four builds in, the customer 76 days
// quiet, and the draft opened "Click & Go gives us a useful starting point for finding the right Corolla to match
// your payment" -- the Click & Go block said "ACKNOWLEDGE THEM" and "LEAD WITH WHAT THEY ALREADY DID ... the
// substance of this message", and v9.7.736's quiet line sat below it. Gil: "build the full sweep ... This has
// taken too many builds to resolve." Every block in the lead's full prompt was read; each one that pointed at
// the past or pushed a booking is gated on one clock, _lpQuietDays (the customer's newest message 14+ days old),
// and one owner rule at the top of the prompt states the job. Executes the shipped code. Placeholders only.
//
// Usage: node tests/quiet-sweep-737.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: quiet-sweep-737.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const topic = () => ({ count: 0, mentions: [] });
const sig = (age) => ({
  consecutiveOutboundNoReply: 20, lastInboundAgeDays: age, totalInboundCount: 9, totalOutboundCount: 39, leadOutboundCount: 39,
  priorAppointmentsTotal: 0, priorNoShows: 0, frustrationSignals: [], priorPricingObjections: [{ sentence: 'that is a little out of the price range', date: '' }],
  topicMentions: { trade: topic(), financing: { count: 3, mentions: [] }, configuration: topic(), distance: topic(), useCase: topic(), competitor: topic() },
  customerCommitments: [], agentCommitments: [], unansweredQuestions: [], personalContext: [],
  channelFatigue: true, hasNoShowHistory: false, hasFrustrationHistory: false, hasPricingFriction: true,
  hasRecurringTopic: true, hasOpenCommitments: false, hasUnansweredQuestions: false, hasPersonalContext: false });
const SIMILAR = '🚙 SIMILAR VEHICLES IN STOCK (secondary-touch angle — real, in stock, do NOT quote price): 2025 Toyota Corolla SE (Blueprint); 2026 Toyota Camry SE (Dark Cosmos). Use this ONLY if it genuinely helps this specific touch.';
const BRIEF = 'CONVERSATION TRANSCRIPT (newest first):\n---\n'
  + '[08/31/2026 12:32 PM] [AGENT] Outbound Text Message\n  Test, checking in on the Corolla.\n'
  + '[07/15/2026 1:02 PM] [CUSTOMER] Email reply from prospect\n  I will email you later today about rescheduling. What time works?\n'
  + '[07/14/2026 8:02 PM] [AGENT] Email reply to prospect\n  We can look at financing options.\n'
  + '[07/09/2026 8:44 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n---\n';
const lead = (age, over) => Object.assign({ name: 'Test Buyer', agent: 'Agent Name', salesRep: 'Rep Name', phone: '(555) 010-0199', email: 'test@example.com',
  vehicle: '2017 Toyota Corolla SE', dealerId: '21135', store: 'Audi Lafayette', leadSource: 'Gubagoo - Online Dr', convState: 'active-follow-up',
  leadAgeDays: age + 5, hasOutbound: true, isContacted: true, hasCustomerReply: true, totalNoteCount: 60, relationshipSignals: sig(age),
  vrPaymentSelected: true, vrDroppedOff: true, vrDroppedOffPage: 'Payments', vrMonthlyPayment: '$300.00/mo', vrDownPayment: '$3000',
  conversationBrief: BRIEF, context: BRIEF + '\n' + SIMILAR, lastInboundMsg: 'I will email you later today about rescheduling.' }, over || {});

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const sb = loadPopup(f, { withAuth: true });
  const qd = (d) => vm.runInContext('_lpQuietDays', sb)(d);
  const up = (age, over) => { vm.runInContext('leadContext = ""; window._lpNoApptLeadId = ""; window._leadProMentionsCashOrOffer = true;', sb); return sb.__lp.buildUserPrompt(lead(age, over)); };

  console.log(' 1. one clock: the customer\'s newest message, 14+ days old:');
  check('76 days after they wrote -> 76; 5 days -> 0; never wrote -> 0', () =>
    [qd({ hasCustomerReply: true, relationshipSignals: { lastInboundAgeDays: 75.9 } }), qd({ hasCustomerReply: true, relationshipSignals: { lastInboundAgeDays: 5 } }),
     qd({ hasCustomerReply: false, relationshipSignals: { lastInboundAgeDays: null } })], [76, 0, 0]);
  check('the current reason comes from the in-stock alternatives the vehicle block surfaced', () =>
    [vm.runInContext('_lpQuietFreshReason', sb)(SIMILAR), vm.runInContext('_lpQuietFreshReason', sb)('nothing listed')],
    ['2025 Toyota Corolla SE (Blueprint); 2026 Toyota Camry SE (Dark Cosmos)', '']);

  console.log(' 2. the owner rule, first in the prompt:');
  const p76 = up(76);
  check('it opens the prompt, right after DATE and LEAD AGE, and outranks what follows', () =>
    /^DATE: [^\n]*\nLEAD AGE: [^\n]*\n\n⏳ THIS CUSTOMER LAST WROTE 76 DAYS AGO, AND 20 OF OUR MESSAGES HAVE GONE UNANSWERED SINCE\. THIS RULE OUTRANKS ANY BLOCK BELOW/.test(p76), true);
  check('it names the current reason and the easy close, with no appointment times at 30+ days', () =>
    [/The current reason on this lead: we have 2025 Toyota Corolla SE \(Blueprint\); 2026 Toyota Camry SE \(Dark Cosmos\) in stock now\. Offer ONE as an extra option alongside the vehicle they asked about/.test(p76),
     /close with one easy question they can answer in a word — no appointment times in this message\./.test(p76)], [true, true]);
  check('no alternative listed: ask whether they are still looking', () =>
    /ask simply whether they are still looking, tied to what they were shopping for/.test(up(76, { context: '' })), true);

  console.log(' 3. the Click & Go session is background:');
  check('no "ACKNOWLEDGE THEM", no "LEAD WITH WHAT THEY ALREADY DID", no session figures; one background line', () =>
    [/ACKNOWLEDGE THEM/.test(p76), /LEAD WITH WHAT THEY ALREADY DID/.test(p76), /WHAT THE CUSTOMER BUILT IN THEIR CLICK & GO SESSION/.test(p76),
     /BACKGROUND ONLY: when the lead came in, their Click & Go session recorded: built a payment; stopped on the Payments page\. The customer has been quiet 76 days since/.test(p76)],
    [false, false, false, true]);
  check('control: 2 days quiet, the session block leads as before', () => {
    const p = up(2); return [/ACKNOWLEDGE THEM/.test(p), /LEAD WITH WHAT THEY ALREADY DID/.test(p)]; }, [true, true]);

  console.log(' 4. no booking push on a customer quiet 30+ days:');
  check('times withheld, no urgency script, status line keeps the hours only', () =>
    [/SUGGESTED APPOINTMENT TIMES/.test(p76), /APPOINTMENT TIMES WITHHELD: the customer has not written in 76 days/.test(p76),
     /Convey that today is better than waiting|great availability today|comfortable window remaining today/i.test(p76), /OFFER THE SOONEST REAL OPENING FIRST/.test(p76)], [false, true, false, false]);
  check('20 days quiet: the owner rule without the no-times clause, and times still offered', () => {
    const p = up(20); return [/⏳ THIS CUSTOMER LAST WROTE 20 DAYS AGO/.test(p), /no appointment times in this message/.test(p), /SUGGESTED APPOINTMENT TIMES/.test(p)]; }, [true, false, true]);
  check('control: 2 days quiet, no owner rule and times offered', () => {
    const p = up(2); return [/THIS CUSTOMER LAST WROTE/.test(p), /SUGGESTED APPOINTMENT TIMES/.test(p)]; }, [false, true]);

  console.log(' 5. the other blocks that answered July:');
  check('rules: old questions are background; engagement: no "THAT is the live conversation — respond to it"', () =>
    [/1\. Questions from before the customer went quiet are background/.test(p76), /1\. Answer every unanswered customer question above/.test(p76),
     /THAT is the live conversation — respond to it/.test(p76)], [true, false, false]);
  check('control: 2 days quiet, both read as before', () => {
    const p = up(2); return [/1\. Answer every unanswered customer question above/.test(p), /THAT is the live conversation — respond to it/.test(p)]; }, [true, true]);
  const rr = (age) => { vm.runInContext('window._leadProMentionsCashOrOffer = true;', sb); return vm.runInContext('renderRelationshipReading', sb)(lead(age)); };
  check('relationship reading: no "Pricing is an open friction point", no "recurring thread ... Addressing it directly"', () => {
    const t = rr(76); return [/Pricing is an open friction point/.test(t), /has been a recurring thread/.test(t)]; }, [false, false]);
  check('control: 2 days quiet, both interpretations fire', () => {
    const t = rr(2); return [/Pricing is an open friction point/.test(t), /has been a recurring thread/.test(t)]; }, [true, true]);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
