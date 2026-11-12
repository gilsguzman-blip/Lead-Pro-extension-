#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('current-arc-794.test.js');
// (v9.7.794) Kia Baytown lead 2082559456, 10/13 (log313). The customer's newest message (10/9) was about the rate: he buys at
// 0% or 1%, and "when it does go down to 0 or 1.9, I will rekindle my interest in the K5". Only the automated assistant had
// written since. The matte gray K5 he built had sold, and the store carried 1.90% APR on the K5 the pivot offered. The text
// that shipped opened "I can help with the darker window tint question" -- a 9/16 question answered on 9/17 -- and said
// nothing about the rate. Four parts of the prompt pulled away from his newest message:
//   (1) the sold-car rule dropped his rate message as "about the vehicle that has SOLD ... moot", in both passes;
//   (2) the tint question stayed OPEN (our reply shared one word against a bar of two) and was called "the highest-leverage
//       move this message can make", though he had written six times since;
//   (3) "IDENTIFIED CUSTOMER CONCERNS - lead with these" put the sold car's colour ahead of him;
//   (4) CONVERSATION STATE said nobody had replied, then "Do NOT re-answer ... Re-engage with a genuinely different angle".
// Executes the shipped detectUnansweredQuestions (lifted, as open-thread-resolver does), _lpMootSoldQuestions,
// renderRelationshipReading, _lpBuildSmsRefinePrompt and populateFromData. Placeholder data only.
//
// Usage: node tests/current-arc-794.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: current-arc-794.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

// ── the open-question detector, lifted ──────────────────────────────────────
function detector(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('      (function detectUnansweredQuestions() {'), b = src.indexOf('\n      })();', a);
  if (a < 0 || b < 0) throw new Error('detectUnansweredQuestions not found');
  return src.slice(a, b + '\n      })();'.length);
}
const item = (dir, date, body, title) => ({ getAttribute: k => (k === 'data-direction' ? dir : null), querySelector: sel =>
  sel === '.notes-and-history-item-content' ? { innerText: body } : sel === '.notes-and-hsitory-item-date' ? { innerText: date }
  : sel === '.legacy-notes-and-history-title' ? { innerText: title || '' } : null });
function detect(code, els) {
  const newest = els.find(e => e.getAttribute('data-direction') === 'Inbound');
  const diag = [], sig = { unansweredQuestions: [], lastInboundAgeDays: 4 };
  const sb = { noteEls: els, sig, parseNoteDate: s => Date.parse(s) || 0, _lpD: function () { diag.push([].join.call(arguments, ' ')); },
    lastInboundTs: Date.parse(newest.querySelector('.notes-and-hsitory-item-date').innerText), console: { log: (...x) => diag.push(x.join(' ')) } };
  vm.createContext(sb); vm.runInContext(code, sb);
  return { open: sig.unansweredQuestions.map(q => [q.question.slice(0, 30), !!q.older]), diag: diag.join(' ') };
}
const TINT_Q = 'Subject: Re:A different financing path\nBy: Agent Name\nThanks, sorry I am late getting back to you. 2 more questions and that is I am going to tint the windows darker than what will come on the car so do you have any that does n';
const TINT_A = 'Subject: Your tint question\nBy: Agent Name\nTest, no problem at all. I can confirm the factory tint on the comparable K5 options is the standard light shade.';
const RATE = 'Subject: Re:What I can do\nBy: Agent Name\nI think my biggest issue is I have never bought a car with an interest rate. When it does go down to 0 or 1.9, I will rekindle my interest.';
// newest first, as the CRM lists them
const THREAD = (after) => [
  item('Outbound', '10/12/2026 11:49 AM', 'Subject: Your K5 awaits\nBy: Virtual Assistant\nHi Test, would you like to come in today?', 'Email reply to prospect'),
  item('Inbound', '10/09/2026 10:26 AM', RATE, 'Email reply from prospect'),
  item('Outbound', '10/07/2026 11:46 AM', 'Subject: What I can do\nBy: Agent Name\nTest, here are the numbers on the K5.', 'Email reply to prospect'),
  ...after,
  item('Outbound', '09/17/2026 11:36 AM', TINT_A, 'Email reply to prospect'),
  item('Inbound', '09/16/2026 9:54 PM', TINT_Q, 'Email reply from prospect'),
  item('Outbound', '09/14/2026 11:09 AM', 'Subject: A different financing path\nBy: Agent Name\nTest, here is another way to finance it.', 'Email reply to prospect') ];
const PAST_TWO = [item('Inbound', '09/22/2026 3:14 PM', 'Subject: Re:Community Kia\nBy: Agent Name\nThank you for the honest price breakdown. I will keep in touch.', 'Email reply from prospect'),
  item('Inbound', '09/20/2026 6:17 PM', 'Subject: Re:Saturday\nBy: Agent Name\nI did not make it Saturday. It is an hour drive for me.', 'Email reply from prospect')];

// ── the rest of the lead, for the prompt builders ───────────────────────────
const SIG = (uq, x) => Object.assign({ agentCommitments: [], agentLPCommandSuperseded: false, channelFatigue: false, consecutiveOutboundNoReply: 1, customerCommitments: [],
  frustrationSignals: [], hasFrustrationHistory: false, hasNoShowHistory: false, hasOpenCommitments: false, hasPersonalContext: false, hasPricingFriction: false,
  hasRecurringTopic: false, hasUnansweredQuestions: uq.length > 0, lastInboundAgeDays: 4.1, leadAgeDaysForFatigue: 31, leadConsecutiveOutboundNoReply: 1,
  leadOutboundCount: 28, personalContext: [], priorAppointmentsTotal: 0, priorNoShows: 0, priorPricingObjections: [], topicMentions: {}, totalInboundCount: 11,
  totalOutboundCount: 28, unansweredQuestions: uq }, x || {});
const SOLD_CTX = '🔴 VEHICLE STATUS: SOLD — this specific unit is no longer available. Do not work it, quote it, or re-run its numbers.';
const RATE_MSG = 'I think my biggest issue is I have never bought a car with an interest rate since 2007. But when it does go down to 0 or 1.9, I will rekindle my interest in the K5.';
const U = (stock, vehicle, model, color, price) => ({ stock, stockNum: stock, vin: 'TESTVIN' + stock, vehicle, year: 2026, make: 'Kia', model, condition: 'new',
  certified: false, class: 'Car, Intermediate', body: '4D Sedan', color, odometer: 5, daysOnLot: 10, price });
const UNITS = [U('TEST001A', '2026 Kia K5 GT-Line', 'K5 GT-Line', 'Wolf Gray', 31990), U('TEST002B', '2026 Kia K5 GT-Line', 'K5 GT-Line', 'Yacht Blue', 32135)];
const VF = { incentives: [{ model: 'K5', line: '$750 Customer Cash', expires: '2099-12-31', year: 2026 },
  { model: 'K5', line: '1.90% APR for 48 mos', expires: '2099-12-31', year: 2026 }, { model: 'K5', line: '2.90% APR for 60 mos', expires: '2099-12-31', year: 2026 }] };
const HIST = (last) => '[10/13/2026 9:10 AM] [NOTE] General Note\n  By: Rep Name Stock #:TEST001A has been sold\n'
  + '[10/12/2026 11:49 AM] [AGENT] Email reply to prospect\n  By: Virtual Assistant Hi Test, would you like to come in today?\n'
  + '[10/09/2026 10:26 AM] [CUSTOMER] Email reply from prospect\n  ' + last + '\n'
  + '[09/12/2026 12:11 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n';
const LEAD = (last, x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Kia K5 GT-Line', condition: 'New',
  stockNum: 'TEST001A', vin: 'TESTVINTEST001A', dealerId: '6190', store: 'Community Kia Baytown', leadSource: 'Dealer Website', convState: 'active-follow-up',
  leadAgeDays: 31, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 40, inventoryWarning: true, inventoryWarningFromNotes: true, daysOnLot: 10,
  phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: last, history: HIST(last), conversationBrief: '',
  relationshipSignals: SIG([]) }, x || {});

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, code; try { sb = loadPopup(f, { withAuth: true }); code = detector(f); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  const quiet = (fn) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return fn(); } finally { sb.console.log = ol; sb.console.warn = ow; } };

  console.log(' 1. a question our reply took up, that they have written past twice, is closed:');
  check('lead 2082559456\'s shape: tint answered 9/17 (one shared word), two later messages that never mention it -> closed', () => {
    const r = detect(code, THREAD(PAST_TWO)); return [r.open.filter(q => /tint/.test(q[0])).length, /CLOSED-by-reply-then-moved-on[^|]*2 more questions/.test(r.diag)]; }, [0, true]);
  check('control: only one later message (his newest) -> still open', () => detect(code, THREAD([])).open.filter(q => /2 more/.test(q[0])).length, 1);
  check('control: our reply never took it up (no shared word; the v9.7.681 credit-approval case) -> still open after two messages', () => {
    const els = THREAD(PAST_TWO); els[els.length - 3] = item('Outbound', '09/17/2026 11:36 AM', 'Subject: Checking in\nBy: Agent Name\nTest, are you free Saturday?', 'Email reply to prospect');
    return detect(code, els).open.filter(q => /2 more/.test(q[0])).length; }, 1);
  check('(new helper) a question asked before their newest message is marked older; their newest message\'s question is not', () => {
    const r = detect(code, THREAD([])); return r.open.map(q => [/2 more/.test(q[0]) ? 'tint' : /go down/.test(q[0]) ? 'rate' : q[0], q[1]]); }, [['tint', true], ['rate', false]]);

  console.log(' 2. a rate question is not the sold car\'s numbers:');
  const MOOT = (qs) => quiet(() => run('_lpMootSoldQuestions')(qs, { context: SOLD_CTX }));
  check('"when it does go down to 0 or 1.9" and "when the incentives get more aggressive" stay open on a sold lead', () =>
    MOOT([{ date: '10/09/2026 10:26 AM', question: 'when it does go down to 0 or 1.9' }, { date: '10/09/2026 10:26 AM', question: 'when the incentives get a little more aggressive' }]).dropped.length, 0);
  check('control (v9.7.760): the sold car\'s fee breakdown is still moot, and a rate question asked beside it stays', () => {
    const r = MOOT([{ date: '10/05/2026 1:00 PM', question: 'Can you itemize the 832 in fees?' }, { date: '10/05/2026 1:00 PM', question: 'and what APR would I get?' }]);
    return [r.dropped.map(q => q.question), r.keep.map(q => q.question)]; }, [['Can you itemize the 832 in fees?'], ['and what APR would I get?']]);

  console.log(' 3. the text rewrite reads his newest message as his, and older questions as older:');
  // (v9.7.819) the rewrite carries only the questions the email or the first draft took up: these emails take them up
  const RP = (d, em) => quiet(() => run('_lpBuildSmsRefinePrompt')('pass1 text', em || 'email text', d));
  const rp = RP(LEAD(RATE_MSG, { context: SOLD_CTX, relationshipSignals: SIG([{ date: '10/09/2026 10:26 AM', question: 'when it does go down to 0 or 1.9' },
    { date: '10/09/2026 10:26 AM', question: 'when the incentives get a little more aggressive' }]) }));
  check('his rate message is shown IN HIS OWN WORDS -- not "about the vehicle that has since sold, background only"', () =>
    [/WHAT THE CUSTOMER LAST SAID, IN THEIR OWN WORDS/.test(rp), /ABOUT THE VEHICLE THAT HAS SINCE SOLD/.test(rp), /THE VEHICLE THEY ASKED ABOUT HAS SOLD ━━━\nTheir earlier questions/.test(rp)], [true, false, false]);
  const rp2 = RP(LEAD(RATE_MSG, { relationshipSignals: SIG([{ date: '09/16/2026 9:54 PM', question: 'do you have any that does not have tint', older: true }]) }), 'On the rate: I will watch it. And I am checking for one that does not have tint.');
  check('a question from before his newest message is listed as EARLIER, never as the opening', () =>
    [/QUESTIONS OF THEIRS THAT ARE STILL OPEN/.test(rp2), /EARLIER QUESTIONS, ASKED BEFORE THEIR MOST RECENT MESSAGE ━━━\n  - "do you have any that does not have tint" \(09\/16\/2026\)\nOnly if still open, and only after the text answers their most recent message/.test(rp2)], [false, true]);
  check('control: a question in his newest message is still the open question', () =>
    /QUESTIONS OF THEIRS THAT ARE STILL OPEN ━━━\n  - "when can I come in"/.test(RP(LEAD('when can I come in', { relationshipSignals: SIG([{ date: '10/09/2026 10:26 AM', question: 'when can I come in', older: false }]) }), 'You can come in Thursday.')), true);

  console.log(' 4. the relationship reading does not put an older question ahead of his newest message:');
  const RR = (uq) => quiet(() => run('renderRelationshipReading')({ convState: 'active-follow-up', relationshipSignals: SIG(uq) }));
  const rr = RR([{ date: '09/16/2026 9:54 PM', question: 'do you have any that does not have tint', older: true }]);
  check('older question -> "Earlier question(s) ... their most recent message comes first", and no "highest-leverage move"', () =>
    [/Earlier question\(s\), asked BEFORE their most recent message, that may not have been answered: "do you have any that does not have tint"/.test(rr),
     /highest-leverage move/.test(rr), /Their most recent message is what this one answers/.test(rr)], [true, false, true]);
  check('control: a question in the newest message keeps the original line and the highest-leverage reading', () => {
    const r = RR([{ date: '10/09/2026 10:26 AM', question: 'when can I come in', older: false }]);
    return [/Customer asked question\(s\) that may not have been answered: "when can I come in"/.test(r), /highest-leverage move/.test(r)]; }, [true, true]);

  console.log(' 5. the replacement car\'s rate programs reach the prompt when his newest message is about the rate:');
  run('_lpValueFactCache')['6190'] = { inv: { store: 'Community Kia Baytown', count: UNITS.length, units: UNITS }, vf: VF, fetchedAt: Date.now() - 1000, invSettledAt: Date.now(), _settled: true };
  const ctx = (x) => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); quiet(() => sb.populateFromData(x)); return run('leadContext'); };
  const c5 = ctx(LEAD(RATE_MSG));
  check('the sold pivot is there, and so are the K5\'s APR programs, as an answer to his rate question', () =>
    [/SOLD/.test(c5), /THEIR MOST RECENT MESSAGE IS ABOUT THE RATE — the store's current APR programs on the 2026 Kia K5 GT-Line \(Yacht Blue\)/.test(c5), /1\.90% APR for 48 mos/.test(c5)], [true, true, true]);
  check('control: a newest message that is not about the rate -> no APR line', () =>
    /THEIR MOST RECENT MESSAGE IS ABOUT THE RATE/.test(ctx(LEAD('Is the blue one still there?'))), false);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
