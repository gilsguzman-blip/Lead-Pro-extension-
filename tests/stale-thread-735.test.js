#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('stale-thread-735.test.js');
// (v9.7.735) Audi Lafayette lead 2049511947, 9/29 (log258, capture faeb4120, dump 7d489fc3). The customer last
// wrote 76 days ago and 20 of our messages followed, yet the text that shipped opened "no worries about this
// afternoon" (his 7/15 postponement) and said "I don't have an AM or PM appointment time to confirm yet" (our
// own 7/14 question, quoted under his reply). Gil: "a lot of nothing has gone by since last contact but the
// message reads from an exchange back in July." Four causes, each executed here against the shipped code:
//   1. _lpOtdFigureSent read "your $16,000 drive-out target" (his number, said back) as a price we sent, and
//      a price we did send 77 days ago as one just received;
//   2. the deal-condition trigger fired on a 76-day-old "if you can beat ..." and forbade the visit ask;
//   3. the SMS rewrite got his last message with no date on it;
//   4. the open-question collector read our quoted email as his question, and pushed July questions on a
//      customer who has gone quiet.
// Placeholder names and numbers only.
//
// Usage: node tests/stale-thread-735.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: stale-thread-735.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const ago = (days, hm) => { const t = new Date(Date.now() - days * 86400000);
  return String(t.getMonth() + 1).padStart(2, '0') + '/' + String(t.getDate()).padStart(2, '0') + '/' + t.getFullYear() + ' ' + hm; };
const brief = (ours, oursDays, cust) => 'CONVERSATION TRANSCRIPT (newest first):\n---\n'
  + '[' + ago(oursDays, '10:22 AM') + '] [AGENT] Email reply to prospect\n  ' + ours + '\n'
  + '[' + ago(oursDays + 1, '10:17 PM') + '] [CUSTOMER] Email reply from prospect\n  ' + cust + '\n'
  + '[' + ago(oursDays + 3, '8:44 PM') + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n---\n';
const THEIRS = 'I would be a buyer if you could keep the price out the door around $16,000.';

// the open-question collector, sliced out of the shipped scraper and run on a fake DOM
const HEAD = '      (function detectUnansweredQuestions() {', TAIL = '\n      })();';
const item = (dir, date, body) => ({ getAttribute: k => (k === 'data-direction' ? dir : null),
  querySelector: sel => sel === '.notes-and-history-item-content' ? { innerText: body } : sel === '.notes-and-hsitory-item-date' ? { innerText: date } : null });

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  const sb = loadPopup(f, { withAuth: true });
  const sent = (b) => { const r = vm.runInContext('_lpOtdFigureSent', sb)({ conversationBrief: b, context: '' }); return r ? r.figure : null; };

  console.log(' 1. an out-the-door figure is ours only if we quoted it, and only while it is recent:');
  check('"your $16,000 drive-out target" (his number said back) is not a figure we sent', () =>
    sent(brief('I am having Carlos review the Corolla against your $16,000 drive-out target again.', 3, THEIRS)), null);
  check('"the target you mentioned (around $16,000 drive-out)" is not either', () =>
    sent(brief('I wanted to reconnect on the pricing target you mentioned (around $16,000 drive-out).', 3, THEIRS)), null);
  check('control: accepting their number ("36,800 out the door works") still counts', () =>
    sent(brief('Good news, 36,800 out the door works on the Sorento.', 3, 'Can you do 36,800 out the door?')), '36,800');
  check('a price we quoted 20 days ago is not one they just received', () =>
    sent(brief('Final pricing is $16,500 drive out using your zipcode.', 20, THEIRS)), null);
  check('control: the same price 3 days ago counts', () =>
    sent(brief('Final pricing is $16,500 drive out using your zipcode.', 3, THEIRS)), '16,500');

  console.log(' 2. a deal condition is live only while the customer is:');
  const deal = (age) => {
    vm.runInContext('leadContext = ""; window._lpNoApptLeadId = "";', sb);
    const p = sb.__lp.buildUserPrompt({ name: 'Test Buyer', agent: 'Agent Name', phone: '(555) 010-0199', email: 'test@example.com',
      vehicle: '2025 Kia Sorento EX', dealerId: '6190', store: 'Community Kia Baytown', leadSource: 'Cargurus', convState: 'active-follow-up',
      leadAgeDays: age + 3, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 12, relationshipSignals: { lastInboundAgeDays: age },
      conversationBrief: '', context: '', lastInboundMsg: 'If you can beat $31,000 out the door I am in.' });
    return /RESPOND TO WHAT THE CUSTOMER ACTUALLY ASKED/.test(p);
  };
  check('the customer last wrote 76 days ago: the condition is background, no hard rule', () => deal(76), false);
  check('control: 2 days ago, the hard rule fires as before', () => deal(2), true);

  console.log(' 3. the SMS rewrite is told how old their last message is:');
  const rf = (age) => vm.runInContext('_lpBuildSmsRefinePrompt', sb)('Test, first draft.', 'Hi Test,\n\nThis is the email body, long enough to derive a text from it.\n\nAgent Name',
    { lastInboundMsg: 'Hey, I need to postpone coming up there this afternoon.', relationshipSignals: { lastInboundAgeDays: age } });
  check('76 days: shown as background with its age, and not to be answered', () => {
    const t = rf(76); return [/WHAT THE CUSTOMER LAST SAID — 76 DAYS AGO, BACKGROUND ONLY/.test(t), /do NOT answer it, do NOT refer to its day or time words/.test(t)]; }, [true, true]);
  check('control: 2 days, the original header', () => /WHAT THE CUSTOMER LAST SAID, IN THEIR OWN WORDS/.test(rf(2)), true);

  console.log(' 4. the open-question collector:');
  const a = src.indexOf(HEAD), b = src.indexOf(TAIL, a);
  const uq = (els, age) => {
    const sig = { unansweredQuestions: [], lastInboundAgeDays: age }, diag = [];
    const box = { noteEls: els, sig, parseNoteDate: s => Date.parse(s) || 0, _lpD: m => diag.push(m) };
    vm.createContext(box); vm.runInContext(src.slice(a, b + TAIL.length), box);
    return { open: sig.unansweredQuestions.map(q => q.question), diag: diag.join(' ') };
  };
  const QUOTED = 'Received from: test@example.com\nMy son gets home about 12:00 tomorrow so we would be around 1:30pm.'
    + 'On Tue, Jul 14, 2026 at 8:32PM agent@example.com wrote: Sure. What time were you thinking? AM appt or PM appt?';
  const ASK = 'Received from: test@example.com\nIs there anything mechanical going on with the car?';
  check('our question quoted under their reply ("On ... wrote:") is not their question', () =>
    uq([item('Inbound', ago(1, '8:33 PM'), QUOTED)], 1).open, []);
  check('...nor after an "<address> wrote:" header', () =>
    uq([item('Inbound', ago(1, '8:33 PM'), 'Received from: test@example.com\nSounds good.\nagent@example.com wrote: Would 2 PM work for you?')], 1).open, []);
  check('control: the same question typed by the customer is still found', () =>
    uq([item('Inbound', ago(1, '8:33 PM'), 'Received from: test@example.com\nWhat time were you thinking? AM appt or PM appt?')], 1).open.some(q => /AM appt or PM appt\?/.test(q)), true);
  check('the customer has been quiet 76 days: their old question is background, logged STALE', () => {
    const r = uq([item('Inbound', ago(76, '6:30 PM'), ASK)], 76); return [r.open.length, /STALE-14d\+/.test(r.diag)]; }, [0, true]);
  check('control: they wrote 2 days ago -> the same question is open', () => uq([item('Inbound', ago(2, '6:30 PM'), ASK)], 2).open.length, 1);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
