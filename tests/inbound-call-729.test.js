#!/usr/bin/env node
'use strict';
// (v9.7.729) Gil, 9/25, on a Kia Baytown lead whose only inbound note reads "Inbound phone call -- Auto generated
// from adding customer": "An inbound call should not count as a missed call. A lot of times that's used to input
// a lead into the system and at times it's an actual call. We should [not] assume it was missed unless an agent
// documents outcome of call activity." The draft opened "Sorry we missed your call": the PHONE LEAD block offered
// "good speaking with you / continue from where the call left off", the call-only block said the team called
// "with no answer", and the second-touch block's example was "sorry we missed your call earlier".
// Now what we say about the customer's call follows what its note records: missed, documented, or nothing.
// (v9.7.730) Gil: "Thanks for calling" can mislead too -- with nothing recorded, the call is not mentioned at all,
//     and it does not drive the SECOND TOUCH block.
// Executes the shipped _lpInboundCallOutcome, populateFromData, buildUserPrompt, and the scraper's
// newest-customer-signal loop against stub notes.
//
// Usage: node tests/inbound-call-729.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: inbound-call-729.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const call = (body) => 'CONVERSATION TRANSCRIPT (newest first):\n---\n[09/25/2026 8:53 AM] [AGENT] Outbound phone call (Machine)\n  By: Agent Name Left message\n'
  + '[09/25/2026 8:51 AM] [CUSTOMER] Inbound phone call\n  ' + body + '\n---\n';
const AUTO = 'Auto generated from adding customer.', MISSED = 'By: Agent Name Customer called, no answer, left a voicemail.',
  TALKED = 'By: Agent Name Spoke with her, wants a Sorento EX, coming in Saturday morning.';

for (const f of BUILDS) {
  const src = fs.readFileSync(f, 'utf8');
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const sb = loadPopup(f, { withAuth: true });
  const oc = (b) => vm.runInContext('_lpInboundCallOutcome', sb)(b);

  console.log(' 1. what the note on the customer\'s call records:');
  check('"Auto generated from adding customer." -> unknown (not missed)', () => oc(call(AUTO)), 'unknown');
  check('only the author line -> unknown', () => oc(call('By: Agent Name')), 'unknown');
  check('the note says no answer / voicemail -> missed', () => oc(call(MISSED)), 'missed');
  check('the note records what was discussed -> documented', () => oc(call(TALKED)), 'documented');
  check('no inbound call on the transcript -> ""', () => oc('---\n[09/25/2026 8:53 AM] [AGENT] Outbound phone call (Machine)\n  Left message\n---\n'), '');

  console.log(' 2. the PHONE LEAD block says only what the note supports:');
  const phone = (body) => {
    vm.runInContext('activeFlags = new Set(); leadContext = "";', sb); sb.__logs.length = 0;
    sb.populateFromData({ name: 'Test Buyer', agent: 'Agent Name', vehicle: '', dealerId: '6190', store: 'Community Kia Baytown', leadSource: 'Repeat Customer',
      leadTypeName: 'Phone', convState: 'first-touch', leadAgeDays: 0, totalNoteCount: 2, hasOutbound: false, hasCustomerReply: false, relationshipSignals: {},
      history: '', context: '', conversationBrief: call(body) });
    return (vm.runInContext('leadContext', sb).match(/☎ PHONE LEAD[^\n]*/) || [''])[0];
  };
  const pu = phone(AUTO);
  // (v9.7.730) Gil: "Thanks for calling can be deceiving as it may have just been us adding the lead into the system
  // ... just ignore it and pick up the convo to move it forward." Nothing recorded -> the call is not mentioned at all.
  check('v9.7.730 nothing recorded: the call is not mentioned at all ("thanks for calling" included); pick up and move forward', () =>
    [/Do NOT mention a call at all: no "thanks for calling", no "good speaking with you", no "sorry we missed your call"\. Pick up from here and move the conversation forward/.test(pu),
     /Acknowledge the call itself/.test(pu)], [true, false]);
  check('v9.7.730 ...and the block no longer asserts the customer CALLED the store', () =>
    [/^☎ PHONE LEAD — this lead was entered as a phone lead, not a web form\./.test(pu), /this customer CALLED the store/.test(pu)], [true, false]);
  check('documented miss: "sorry we missed your call" is the acknowledgment', () => /note on their call says it did not connect, so acknowledge that plainly \("sorry we missed your call"\)/.test(phone(MISSED)), true);
  check('control: a call note with what was discussed keeps the original wording', () => /Acknowledge the call itself — "thanks for calling", "good speaking with you", or simply continue from where the call left off/.test(phone(TALKED)), true);

  console.log(' 3. the second-touch block and the call-only block:');
  const second = (desc) => {
    vm.runInContext('leadContext = "";', sb);
    return sb.__lp.buildUserPrompt({ name: 'Test Buyer', agent: 'Agent Name', vehicle: '2026 Kia Sorento EX', dealerId: '6190', store: 'Community Kia Baytown',
      leadSource: 'Kia Digital', convState: 'active-follow-up', leadAgeDays: 6, totalNoteCount: 6, hasOutbound: true, hasCustomerReply: false,
      relationshipSignals: {}, context: call(AUTO), hasFreshCustomerSignal: true, newestCustomerSignalType: 'call', newestCustomerSignalDesc: desc, lastInboundMsg: '' });
  };
  const UNKNOWN_DESC = 'An inbound call is logged, but nothing records what happened on it: it may have been answered, or it may only be how the customer was entered into the system. Do NOT mention the call at all (not "thanks for calling", not "sorry we missed your call", not a conversation).';
  check('an unrecorded call reaching the block (an older scrape): do NOT mention the call, no "sorry we missed your call earlier" example', () => {
    const p = second(UNKNOWN_DESC);
    return [/- Do NOT mention the call: nothing records what happened on it/.test(p), /e\.g\. "sorry we missed your call earlier"/.test(p)]; }, [true, false]);
  check('control: a documented miss keeps the "sorry we missed your call earlier" example', () =>
    /e\.g\. "sorry we missed your call earlier"/.test(second('Customer called the dealership but did not connect (missed / short call), per the note on the call.')), true);
  check('the call-only block says those are OUR calls, not one the customer made', () =>
    /These are OUR calls to them \(v9\.7\.729\): they say nothing about a call the customer made to us/.test(src), true);

  console.log(' 4. the scraper\'s newest-customer-signal description:');
  const a = src.indexOf("    var newestCustomerSignalType = '';"), b = src.indexOf('    // (v9.7.271) FRESH vs the last SUBSTANTIVE outbound', a);
  const signal = (body) => {
    if (a < 0 || b < 0) throw new Error('signal loop not found');
    const el = { getAttribute: () => 'inbound', querySelector: (sel) => ({ innerText: /title/.test(sel) ? 'Inbound phone call' : /content/.test(sel) ? body : /date/.test(sel) ? '09/25/2026 8:51 AM' : '' }) };
    const s = { noteEls: [el], transcriptCutoffMs: 0, vehicle: '', _inboundBody: (x) => x, Date, String };
    vm.createContext(s); vm.runInContext(src.slice(a, b), s); return s.newestCustomerSignalDesc;
  };
  const fresh = (body) => {
    const b2 = src.indexOf('    // (v9.7.192) STALE-PRE-VISIT FACT', a);
    const el = { getAttribute: () => 'inbound', querySelector: (sel) => ({ innerText: /title/.test(sel) ? 'Inbound phone call' : /content/.test(sel) ? body : /date/.test(sel) ? '09/25/2026 8:51 AM' : '' }) };
    const s = { noteEls: [el], transcriptCutoffMs: 0, vehicle: '', _inboundBody: (x) => x, Date, String, lastSubstantiveOutboundMs: 0 };
    vm.createContext(s); vm.runInContext(src.slice(a, b2), s); return s.hasFreshCustomerSignal;
  };
  check('the 9/25 Kia Baytown shape (auto-generated call note) -> "nothing records what happened on it", not "Customer called the dealership."', () => /^An inbound call is logged, but nothing records what happened on it/.test(signal('By: Agent Name\nAuto generated from adding customer.')), true);
  check('a documented miss -> did not connect', () => /did not connect \(missed \/ short call\), per the note on the call/.test(signal(MISSED)), true);
  check('v9.7.730 an unrecorded call is not a fresh customer action (the SECOND TOUCH block stands down)', () => fresh('By: Agent Name\nAuto generated from adding customer.'), false);
  check('control: a documented miss is still a fresh customer action', () => fresh(MISSED), true);
  check('a documented conversation -> the note is quoted', () => /^Customer called the dealership\. The note on the call says: "Spoke with her, wants a Sorento EX/.test(signal(TALKED)), true);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
