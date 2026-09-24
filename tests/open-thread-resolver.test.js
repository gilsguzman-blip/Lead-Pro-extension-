#!/usr/bin/env node
'use strict';
// (v9.7.611) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('open-thread-resolver.test.js');

/**
 * open-thread-resolver.test.js — v9.7.654. AN ANSWERED QUESTION THAT COULD NOT BE CLOSED.
 *
 * LIVE, 9/10. Antonio Cadena, Community Kia Baytown, lead 2079566626, CarGurus, 2022 Ram 1500
 * Laramie. Kristen, after the grab: "Seems like it missed the salesperson notes. would have built
 * a better response with that info in the mix."
 *
 * The note reached the model three times — the arc spine, the AGENT CONTEXT preamble and the
 * transcript. What ignored it was THIS resolver, which shipped:
 *
 *   OPEN THREADS:
 *     - Customer asked question(s) that may not have been answered:
 *       "us%2f1y864y (no login required) | I?" (09/06/2026 5:38 PM)
 *       / "m interested in this 2022 RAM 1500 and I?" (09/06/2026 5:38 PM)
 *       / "So you have a video of this vehicle by any chance ?" (09/07/2026 9:52 AM)
 *   INTERPRETATION FOR THIS RESPONSE:
 *     - ...addressing them is the highest-leverage move this message can make.
 *
 * Kristen answered the video question 48 minutes after he asked it, and Alyssa's 3:48 PM note
 * records that the pictures and videos went out and that he loves the truck. Three defects
 * stacked:
 *
 *   1. A NOTE COULD NEVER CLOSE A THREAD — the answered-check required an item carrying a
 *      data-direction flag, and a General Note carries none.
 *   2. THE OVERLAP BAR WAS OUT OF REACH — two shared content words, on a question that has three,
 *      answered by a reply that named the truck rather than repeating "vehicle". And a question of
 *      one or two content words could never reach two at all.
 *   3. A CORRUPTED APOSTROPHE IS NOT A SENTENCE BOUNDARY — VinSolutions stores the CarGurus lead
 *      body with its curly quotes mangled into question marks, so I?m / I?d / it?s each split the
 *      line. Two of the three "questions" above are fragments of one sentence; one is a URL.
 *
 * THE ASYMMETRY THAT SETS THE DIRECTION, because the looser bar is a real risk: a false close
 * drops a nudge, a false open INSTRUCTS the model to re-ask something the customer already got.
 *
 * Executes the SHIPPED resolver against Antonio's real 27-item CRM shape, rebuilt from the dump
 * with contact data replaced. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: open-thread-resolver.test.js <popup.js> [popup.js...]'); process.exit(2); }

const HEAD = '      (function detectUnansweredQuestions() {';
const TAIL = '\n      })();';
function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf(HEAD);
  if (a < 0) throw new Error('detectUnansweredQuestions not found');
  const b = src.indexOf(TAIL, a);
  if (b < 0) throw new Error('resolver end not found');
  return { name: path.basename(path.dirname(file)), src, code: src.slice(a, b + TAIL.length) };
}

// ── THE FAKE DOM ────────────────────────────────────────────────────────────
// The resolver reads exactly three things off each item: data-direction, the content div's
// innerText and the date div's innerText. The date div's class carries VinSolutions' own typo
// ("hsitory"), which is reproduced here because the shipped selector depends on it.
function item(dir, date, body) {
  return {
    getAttribute: k => (k === 'data-direction' ? dir : null),
    querySelector: sel => {
      if (sel === '.notes-and-history-item-content') return { innerText: body };
      if (sel === '.notes-and-hsitory-item-date') return { innerText: date };
      return null;
    }
  };
}

function run(impl, noteEls, mutate) {
  const diag = [];
  const sig = { unansweredQuestions: [] };
  const code = mutate ? mutate(impl.code) : impl.code;
  const sb = {
    noteEls, sig,
    parseNoteDate: s => Date.parse(s) || 0,
    _lpD: function () { diag.push(Array.prototype.join.call(arguments, ' ')); }
  };
  vm.createContext(sb);
  vm.runInContext(code, sb);
  return { open: sig.unansweredQuestions.map(q => q.question), diag: diag.join(' ') };
}

// ── ANTONIO'S LEAD, NEWEST FIRST, INDICES MATCHING THE DUMP ─────────────────
// Contact data replaced: the real phone and email are not committed to this repo. Everything
// else is the visible text as captured at 4:49 PM on 9/10, one minute before the prompt.
const PH = '(555) 010-0199';
const EM = 'redacted@example.com';
const VIDEO_Q = 'So you have a video of this vehicle by any chance ?';
const ALYSSA_NOTE = 'By: Alyssa Williams\nTexting on cell. Said he will let me know when he can come down. '
  + 'Sent a bunch of pictures and videos and he loves the truck';
const KRISTEN_VIDEO_REPLY = 'Sent to: ' + PH + '\nSent by: Kristen Willis\n'
  + 'Antonio, yes—we can send you a quick video walkaround of the 2022 Ram 1500 Laramie. '
  + 'Since you are pre-approved with Capital One, would you rather I send it now or would you like to come by? '
  + 'If you want to swing by, we are open Monday through Saturday 9AM to 8PM. Kristen';
// The lead body exactly as VinSolutions stores it — every apostrophe corrupted into a '?'.
const CARGURUS_BODY = 'By: System\nView Shopper Signals: cargur.us%2f1y864y (no login required) | '
  + 'I?m interested in this 2022 RAM 1500 and I?d like to know if it?s still available. '
  + '(CarGurus IMV: $35,927 / Deal Rating: Good Deal / Is From Shippable Listing: No) | '
  + 'Likelihood to buy: Standard\nTimeframe: 2 weeks.';

function antonio(over) {
  over = over || {};
  const els = [
    item('', '09/10/2026 3:48 PM', over.note === undefined ? ALYSSA_NOTE : over.note),
    item('', '09/10/2026 3:45 PM', 'By: Daniel Schatte\nSales Rep Changed From Damien Brooks to Alyssa Williams'),
    item('Outbound', '09/10/2026 3:44 PM', 'By: Damien Brooks\nNo answer'),
    item('Outbound', '09/10/2026 3:43 PM', 'By: System\nhttps://www.callmeasurement.com/review_x.cfm?cid=6001682758717&lid=153575'),
    item('', '09/10/2026 3:42 PM', 'By: Daniel Schatte\nSales Rep Changed From Alyssa Williams to Damien Brooks'),
    item('', '09/10/2026 3:42 PM', 'By: Daniel Schatte\nService Rep Changed From Sticky_Round_Robin to System'),
    item('', '09/10/2026 3:42 PM', 'By: Daniel Schatte\nCSI Agent Changed From Sticky_Round_Robin to System'),
    item('Inbound', '09/10/2026 3:22 PM', 'Received from: ' + PH + '\nReceived by: Daniel Schatte\nCredit score 590 I only have the 10% down because I do have a mortgage payment'),
    item('Outbound', '09/10/2026 12:34 PM', 'Sent to: ' + PH + '\nSent by: Daniel Schatte\nAntonio, this is Daniel, Sales Manager at Community Kia'),
    item('Outbound', '09/10/2026 8:57 AM', 'Sent to: ' + PH + '\nSent by: Daniel Schatte\nAntonio, this is Daniel, Sales Manager at Community Kia'),
    item('Outbound', '09/09/2026 11:32 AM', 'Sent to: ' + PH + '\nSent by: Alyssa Williams\nAntonio, Alyssa again. No pressure - I just want to make sure you have what you need'),
    item('', '09/07/2026 12:39 PM', 'Antonio Cadena and Name Unknown were merged. By: Kristen Willis'),
    item('Inbound', '09/07/2026 12:38 PM', 'By: Samantha Gonzalez\ntransferred to Alyssa'),
    item('Inbound', '09/07/2026 10:53 AM', 'Received from: ' + PH + '\nReceived by: Kristen Willis\nYou can text it to me sure'),
    item('Outbound', '09/07/2026 10:40 AM', over.reply === undefined ? KRISTEN_VIDEO_REPLY : over.reply),
    item('', '09/07/2026 10:38 AM', 'By: Kristen Willis\nDUPE ON NAME BUT NOTHING ACTIVE..... NO DUPE ON NUMBER OR EMAIL..... Antonio Cadena Cell: ' + PH + ' ' + EM),
    item('Inbound', '09/07/2026 9:52 AM', 'Received from: ' + PH + '\nReceived by: Kristen Willis\nLive in San Antonio'),
    item('Inbound', '09/07/2026 9:52 AM', 'Received from: ' + PH + '\nReceived by: Kristen Willis\n' + VIDEO_Q + ' Thxs I have a pre approval from capital one'),
    item('', '09/07/2026 9:30 AM', 'By: Kristen Willis\nSubmitNEW LEAD Dismiss Edit Assigned To: Alyssa Williams ALSO SENT MESSAGE IN NEXT UP'),
    item('Outbound', '09/07/2026 9:30 AM', 'Subject: The 2022 Ram 1500 Laramie is here\nBy: Kristen Willis\nHi Antonio, The 2022 Ram 1500 Laramie from your CarGurus inquiry is here and available to see'),
    item('Outbound', '09/07/2026 9:29 AM', 'Sent to: ' + PH + '\nSent by: Kristen Willis\nAntonio, the 2022 Ram 1500 Laramie from your CarGurus inquiry is here and available to see today'),
    item('Outbound', '09/07/2026 9:29 AM', 'By: Kristen Willis\nNOT A GOOD NUMBER....'),
    item('Outbound', '09/07/2026 7:38 AM', 'Sent to: ' + PH + '\nSent by: Kristen Willis\nHello Antonio! This is Kristen here with Community Kia'),
    item('', '09/07/2026 7:38 AM', 'By: Kristen Willis\n' + PH + ' SMS status has been manually changed to: Opt-In by Kristen Willis'),
    item('Outbound', '09/06/2026 5:39 PM', 'Subject: Your 2022 RAM 1500 Awaits\nBy: Vinessa Virtual Assistant Community Kia\nHi Antonio, I am Vinessa, the Internet Sales Coordinator at Community Kia'),
    item('Outbound', '09/06/2026 5:38 PM', 'Sent to: ' + PH + '\nSent by: Vinessa Virtual Assistant Community Kia\nWelcome to Community Kia. Reply YES to receive text messages'),
    item('Inbound', '09/06/2026 5:38 PM', CARGURUS_BODY)
  ];
  return els;
}

const guardedImpls = require('./lib/guarded-impls.js');
const impls = guardedImpls(BUILDS, extract);
let pass = 0, fail = 0;
function report(name, results, want) {
  const agree = results.every(r => r === results[0]);
  const ok = agree && results[0] === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; console.log('  FAIL ' + name);
    if (!agree) impls.forEach((i, n) => console.log('        ' + i.name + ' -> ' + results[n]));
    else console.log('        expected ' + JSON.stringify(want) + '\n        got      ' + results[0]);
  }
}
const check = (name, fn, want) =>
  report(name, impls.map(i => { try { return JSON.stringify(fn(i)); } catch (e) { return 'THREW: ' + e.message; } }), want);

console.log('\nv9.7.654 — the open-threads resolver stops flagging an answered question');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);

// ── (1) THE FIXTURE IS THE INCIDENT ─────────────────────────────────────────
console.log('\n(1) the fixture carries no contact data and reproduces the incident shape:');

check('no ten-digit phone-shaped run other than the placeholder',
  () => JSON.stringify(antonio().map((_, n) => n)).length > 0
     && !/\b(?!555)\d{3}[-. )]?\d{3}[-. ]?\d{4}\b/.test([ALYSSA_NOTE, KRISTEN_VIDEO_REPLY, CARGURUS_BODY, PH].join(' ')), true);

check('no real email address in the fixture text',
  () => /@example\.com$/.test(EM) && !/@(gmail|yahoo|hotmail|outlook|aol)\./i.test([ALYSSA_NOTE, KRISTEN_VIDEO_REPLY, CARGURUS_BODY, EM].join(' ')), true);

check('the lead body still carries the three corrupted apostrophes the CRM stores',
  () => (CARGURUS_BODY.match(/[A-Za-z]\?[a-z]/g) || []).length, 3);

check('27 items, matching the CRM entry count on the capture',
  () => antonio().length, 27);

// ── (2) THE INCIDENT, ON THE SHIPPED CODE ───────────────────────────────────
console.log('\n(2) Antonio Cadena, 9/10 — what the model is told is open:');

check('nothing is reported open at all',
  i => run(i, antonio()).open, []);

check('the video question specifically is not reported open',
  i => run(i, antonio()).open.some(q => /video of this vehicle/.test(q)), false);

check('the URL fragment is gone',
  i => run(i, antonio()).open.some(q => /1y864y/.test(q)), false);

check('the mid-contraction fragment is gone',
  i => run(i, antonio()).open.some(q => /^m interested/.test(q)), false);

check('on the full lead it is the OUTBOUND that closes it — the reply came first',
  i => /CLOSED-by-outbound/.test(run(i, antonio()).diag), true);

// ── (3) THE NOTE PATH, ISOLATED ─────────────────────────────────────────────
// Kristen's reply is neutered so the scan has to reach Alyssa's note at index 0. This is the
// defect Kristen actually felt: a General Note carries no direction flag, so before this build
// nothing an agent wrote could ever close a thread.
console.log('\n(3) a dated General Note can close a thread:');
// (v9.7.680) Antonio answered Kristen at 10:53 — "You can text it to me sure" — and wrote again on
// 09/10. Either of those now closes the thread on its own, BEFORE the walk can reach Alyssa's note
// three days later. That is correct, and section (7) asserts it directly. But it shadows the NOTE
// path, which still has to be testable in isolation, so these variants replace both later inbounds
// with an agent-typed entry: a lead where nobody heard from the customer again, which is precisely
// the arc a fulfilment note exists to close. It is also the shape the speaker check must skip —
// inbound-tagged, attributed "By: <name>", not one word of it from the customer.
const NO_REPLY = { reply: 'Sent to: ' + PH + '\nSent by: Kristen Willis\nAntonio, let me know what works for you.' };

check('with the reply neutered, the note still closes it',
  i => run(i, antonio({ reply: NO_REPLY.reply })).open, []);

check('...and the diagnostic says the NOTE is what closed it',
  i => /CLOSED-by-note/.test(run(i, antonio({ reply: NO_REPLY.reply })).diag), true);

check('a note that records a PLAN rather than a fulfilment does not close it',
  i => run(i, antonio({ reply: NO_REPLY.reply, note: 'By: Alyssa Williams\nWill send him the video tomorrow' })).open.length, 1);

check('...and "said he will let me know" alone is not a fulfilment either',
  i => run(i, antonio({ reply: NO_REPLY.reply, note: 'By: Alyssa Williams\nSaid he will let me know when he can come down' })).open.length, 1);

check('a fulfilment verb with no shared subject does not close it',
  i => run(i, antonio({ reply: NO_REPLY.reply, note: 'By: Alyssa Williams\nSent him the finance application' })).open.length, 1);

// ── (4) THE GENERIC-NOUN MATCH ──────────────────────────────────────────────
// He asked about "this vehicle"; every human on the lead calls it the truck. Answering more
// specifically than the question asked was being scored as not answering.
console.log('\n(4) a generic vehicle noun is answered by any other generic vehicle noun:');

check('a note naming the truck closes a question that said "vehicle"',
  i => run(i, antonio({ reply: NO_REPLY.reply, note: 'By: Alyssa Williams\nSent him pictures of the truck' })).open, []);

check('a note naming an unrelated subject does not',
  i => run(i, antonio({ reply: NO_REPLY.reply, note: 'By: Alyssa Williams\nSent him the service coupon' })).open.length, 1);

// ── (5) THE SHORT-QUESTION BAR ──────────────────────────────────────────────
// Two shared words was unreachable for a two-word question, so every one of them has been
// permanently open since v9.7.81. These are built as small standalone leads so the bar is the
// only thing under test.
console.log('\n(5) a short question can now be closed at all:');
function shortLead(replyBody) {
  return [
    item('Outbound', '09/10/2026 10:00 AM', 'Sent by: Kristen Willis\n' + replyBody),
    item('Inbound', '09/09/2026 9:00 AM', 'Received by: Kristen Willis\nDo you have it in Patriot Blue ?')
  ];
}

check('a two-content-word question closes on one shared word',
  i => run(i, shortLead('The Patriot one is on the ground now')).open, []);

check('...and stays open when nothing later mentions it',
  i => run(i, shortLead('I have your paperwork started')).open, ['Do you have it in Patriot Blue ?']);

check('the diagnostic reports the bar that was applied',
  i => /need:1 words:2/.test(run(i, shortLead('I have your paperwork started')).diag), true);

check('a long question still needs two shared words',
  i => run(i, [
    item('Outbound', '09/10/2026 10:00 AM', 'Sent by: Kristen Willis\nThe warranty paperwork is ready'),
    item('Inbound', '09/09/2026 9:00 AM', 'Received by: Kristen Willis\nCan you tell me about the warranty coverage mileage limits transfer rules ?')
  ]).open.length, 1);

check('...and closes once two of them appear',
  i => run(i, [
    item('Outbound', '09/10/2026 10:00 AM', 'Sent by: Kristen Willis\nThe warranty runs to 100k miles and the coverage transfers'),
    item('Inbound', '09/09/2026 9:00 AM', 'Received by: Kristen Willis\nCan you tell me about the warranty coverage mileage limits transfer rules ?')
  ]).open, []);

// ── (6) THE CORRUPTED APOSTROPHE ────────────────────────────────────────────
console.log('\n(6) a question mark tight between letters is an apostrophe, not a boundary:');

check('the CarGurus lead body alone yields no questions at all',
  i => run(i, [item('Inbound', '09/06/2026 5:38 PM', CARGURUS_BODY)]).open, []);

check('a genuine question in the same body still surfaces',
  i => run(i, [item('Inbound', '09/06/2026 5:38 PM', CARGURUS_BODY + '\nCan you send me the Patriot Blue photos ?')]).open,
  ['Can you send me the Patriot Blue photos ?']);

check('an uppercase letter after the mark is left alone — that shape is a real typo',
  i => run(i, [item('Inbound', '09/06/2026 5:38 PM', 'Received by: Kristen\nIs the Patriot Blue one still there?Thanks')]).open.length, 1);

// ── (7) THE OBJECTION PATH IS UNTOUCHED ─────────────────────────────────────
// v9.7.354: an objection clears only when the CUSTOMER moves off it, never when an agent replies.
// The note path must not become a back door into that rule.
console.log('\n(7) an objection still needs the customer to move off it:');
const objLead = tail => [
  item('', '09/10/2026 11:00 AM', 'By: Kristen Willis\n' + (tail || 'Sent him the price breakdown and the numbers')),
  item('Outbound', '09/10/2026 10:00 AM', 'Sent by: Kristen Willis\nThe price reflects the recent reduction'),
  item('Inbound', '09/09/2026 9:00 AM', 'Received by: Kristen Willis\nIt is priced above the range even with the recent price reduction.')
];

check('a note claiming the price was explained does NOT close the objection',
  i => run(i, objLead()).open.length, 1);

check('...and the diagnostic says the bar is a customer reply',
  i => /need:customer-reply/.test(run(i, objLead()).diag), true);

// (v9.7.666) CHANGED DELIBERATELY. This asserted open.length === 0, and that was only true because
// the collector was blind to "What time do you close today" — a real question with no question
// mark. The objection IS still closed by her later message, which is what this case tests; what
// also changed is that her newer question is now correctly OPEN. Both halves are asserted.
const objThenAsk = [
  item('Inbound', '09/10/2026 11:00 AM', 'Received by: Kristen Willis\nWhat time do you close today'),
  item('Inbound', '09/09/2026 9:00 AM', 'Received by: Kristen Willis\nIt is priced above the range even with the recent price reduction.')
];
check('a later customer message on another topic closes the objection',
  i => run(i, objThenAsk).open.some(q => /priced above the range/.test(q)), false);
check('...and her later question is now open, which the old collector could not see',
  i => run(i, objThenAsk).open.some(q => /What time do you close today/.test(q)), true);

// ── (8) THE RESOLVER IS NO LONGER SILENT ────────────────────────────────────
console.log('\n(8) one diagnostic row per question, with the verdict and the bar:');

check('the diagnostic fires on Antonio',
  i => /\[LP OPEN THREAD DIAG\]/.test(run(i, antonio()).diag), true);

check('it reports how many questions were examined',
  i => /1 inbound question\(s\) examined/.test(run(i, antonio()).diag), true);

check('it names the question text',
  i => /video of this vehicle/.test(run(i, antonio()).diag), true);

check('an OPEN verdict is reported as OPEN',
  i => /\bOPEN\b/.test(run(i, shortLead('I have your paperwork started')).diag), true);

check('a lead with no inbound questions still logs, rather than logging nothing',
  i => /\[LP OPEN THREAD DIAG\] 0 inbound question\(s\) examined \| \(none\)/.test(
        run(i, [item('Outbound', '09/10/2026 10:00 AM', 'Sent by: Kristen\nHello')]).diag), true);

// ── (9) ROBUSTNESS ──────────────────────────────────────────────────────────
console.log('\n(9) the resolver cannot throw on a degenerate lead:');

check('an empty note list', i => run(i, []).open, []);
check('an item with no content div', i => run(i, [{ getAttribute: () => 'Inbound', querySelector: () => null }]).open, []);
check('an item whose direction attribute is missing entirely',
  i => run(i, [{ getAttribute: () => null, querySelector: () => ({ innerText: 'Sent him the video ?' }) }]).open, []);

// ── (7) v9.7.680: THE ANSWERS THAT CARRY NO WORDS ───────────────────────────
// Carlos, 9/17 capture (Community Kia Baytown). The resolver examined five questions and returned
// FOUR open. His own transcript answers three of those four, and not one answer shares a content
// word with its question:
//
//   3:09p "When you get a chance can you send me a cost breakdown."
//   5:46p  an image link          5:47p "Msrp was 33,050 we discounted to $32,238.67"
//   5:26p "Can u get the car we're looking at? White with red interior"
//   5:32p "Yes, just let us know if you are ready to move forward..."
//   11:59a "Can u send over the credit app?"
//   12:01p https://www.communitykia.com/finance-application/      -- TWO MINUTES LATER
//
// A link, a number and a plain "Yes" are how this BDC answers, and vocabulary overlap cannot see
// any of them. The prompt therefore told the model all three were open, and the draft offered
// Carlos a cost breakdown and a credit app he had already been sent. What closes them is his own
// next message: he wrote again on 9/17 and did not ask for any of it again.
console.log('\n(7) v9.7.680 — a link, a number and a bare "Yes" are answers:');

const CARLOS_PH = '(555) 010-0143';
function carlos(over) {
  over = over || {};
  return [
    item('Inbound', '09/17/2026 11:02 AM', over.last === undefined
      ? ('Received from: ' + CARLOS_PH + '\nReceived by: Daniel Schatte\nStill in the market. Just trying '
         + 'to decide if wife wants to go with the 27\u2019s since it\u2019s so late in the year. Thanks for checking in on me.')
      : over.last),
    item('Outbound', '09/02/2026 12:01 PM', 'Sent to: ' + CARLOS_PH
      + '\nSent by: Samantha Gonzalez\nhttps://www.communitykia.com/finance-application/'),
    item('Inbound', '09/02/2026 11:59 AM', 'Received from: ' + CARLOS_PH
      + '\nReceived by: Samantha Gonzalez\nCan u send over the credit app?'),
    item('Outbound', '09/01/2026 5:32 PM', 'Sent to: ' + CARLOS_PH + '\nSent by: Samantha Gonzalez\nYes, just let '
      + 'us know if you are ready to move forward and we can send you the credit app. We can get it here tomorrow.'),
    item('Inbound', '09/01/2026 5:26 PM', 'Received from: ' + CARLOS_PH
      + '\nReceived by: Samantha Gonzalez\nCan u get the car we\u2019re looking at? White with red interior'),
    item('Outbound', '08/29/2026 5:47 PM', 'Sent to: ' + CARLOS_PH
      + '\nSent by: Jocelyne Martinez\nMsrp was 33,050 we discounted to $32,238.67'),
    item('Inbound', '08/29/2026 3:09 PM', 'Received from: ' + CARLOS_PH
      + '\nReceived by: Jocelyne Martinez\nWhen you get a chance can you send me a cost breakdown.')
  ];
}

// One question and the reply that answered it, built explicitly so each shape stands alone and a
// regression in any one of them is visible on its own.
function oneAsk(question, reply) {
  const rows = [];
  if (reply !== null) rows.push(item('Outbound', '09/02/2026 12:01 PM',
    'Sent to: ' + CARLOS_PH + '\nSent by: Samantha Gonzalez\n' + reply));
  rows.push(item('Inbound', '09/02/2026 11:59 AM',
    'Received from: ' + CARLOS_PH + '\nReceived by: Samantha Gonzalez\n' + question));
  return rows;
}

check('all three of his answered questions are now closed',
  i => run(i, carlos()).open, []);
check('...and each one is credited to the REPLY that answered it, not to his silence',
  i => (run(i, carlos()).diag.match(/CLOSED-by-handover/g) || []).length, 3);
check('...and the log names the shapes, with a count',
  i => /3 closed by a link, a price or a bare "Yes" — v9\.7\.681/.test(run(i, carlos()).diag), true);
// Each of the three shapes is doing the work on its own question, so no one of them carries all
// three and a regression in any single shape is visible.
check('the bare link closes the credit-app ask',
  i => run(i, oneAsk('Can u send over the credit app?',
    'https://www.communitykia.com/finance-application/')).open, []);
check('the plain "Yes" closes the can-you-get-it ask',
  i => run(i, oneAsk('Can u get the car we\u2019re looking at? White with red interior',
    'Yes, just let us know if you are ready to move forward. We can get it here tomorrow.')).open, []);
check('and the price line closes the cost-breakdown ask',
  i => run(i, oneAsk('When you get a chance can you send me a cost breakdown.',
    'Msrp was 33,050 we discounted to $32,238.67')).open, []);
check('an ordinary prose reply that shares no word still does NOT close it',
  i => run(i, oneAsk('Can u send over the credit app?',
    'I have a few people in front of me, give me an hour and I will take care of it.')).open.length, 1);
check('...and with no reply at all it stays open, which is the guard',
  i => run(i, oneAsk('Can u send over the credit app?', null)).open.length, 1);

console.log('\n    the guard: a customer who was NOT answered asks again, and that keeps it open:');
check('a re-ask about the same thing does not close it',
  i => run(i, carlos({ last: 'Received from: ' + CARLOS_PH
    + '\nReceived by: Daniel Schatte\nDid you ever send over that credit app?' })).open.length > 0, true);
check('...while a message on a different subject does close it',
  i => run(i, carlos({ last: 'Received from: ' + CARLOS_PH
    + '\nReceived by: Daniel Schatte\nWe are still thinking it over. Thanks.' })).open, []);
// TORI (Community Honda Lafayette, 9/17) — THE LEAD v9.7.680 GOT WRONG THE SAME DAY IT SHIPPED.
// She asked "did i get pre approved". Her most recent message is "i'm willing to be $2,500 down",
// and v9.7.680 read that as moving on and closed the thread. She had not moved on; she is offering
// more money to get the answer she is still waiting for, and the CRM agrees — that lead's
// [LP DR SESSION DIAG] reads creditApp:true completed:false with lender:false creditTier:false.
// No lender response exists. Her question must stay open, and a link cannot close it either.
const TORI_PH = '(555) 010-0167';
function tori(over) {
  over = over || {};
  return [
    item('Inbound', '09/17/2026 8:58 AM', 'Received from: ' + TORI_PH
      + '\nReceived by: Colby Landry\ni\u2019m willing to be $2,500 down'),
    item('Outbound', '09/16/2026 2:10 PM', 'Sent to: ' + TORI_PH + '\nSent by: Noelia Diaz\n'
      + (over.reply === undefined ? 'Let me check with the lender and get right back to you.' : over.reply)),
    item('Inbound', '09/14/2026 9:59 AM', 'Received from: ' + TORI_PH
      + '\nReceived by: Noelia Diaz\ndid i get pre approved')
  ];
}
check('Tori: her pre-approval question stays OPEN — she offered more down, she did not move on',
  i => run(i, tori()).open, ['did i get pre approved']);
check('...and nothing is credited as having closed it',
  i => /CLOSED-by/.test(run(i, tori()).diag), false);
check('a status question can never take the handover path — a link does not answer it',
  i => run(i, tori({ reply: 'https://www.communitykia.com/finance-application/' })).open.length, 1);
check('...nor does a bare "Yes", which is the shape most likely to look like an answer here',
  i => run(i, tori({ reply: 'Yes' })).open.length, 1);
check('the gate is the QUESTION\'s subject: hers asks what happened TO her, not for something FROM us',
  i => [/\b(?:can|could|will|would|u|you)\b[^?]{0,40}\b(?:send|get|provide|text|email|show|forward)\b/i
          .test('did i get pre approved'),
        /\b(?:can|could|will|would|u|you)\b[^?]{0,40}\b(?:send|get|provide|text|email|show|forward)\b/i
          .test('Can u send over the credit app?')], [false, true]);

// THE INTERVENING OUTBOUND IS THE GUARD THAT MAKES THIS SAFE. Carlos sent two messages one minute
// apart on 9/01 — "...out the door cost without dealer fees" and then "* dealer add on fees",
// correcting himself before anyone had replied. A correction is not an answer, and nothing in it
// says he was helped; without the outbound requirement it would close a live question.
// His first of the two was phrased as a statement and so is not a thread the collector holds at
// all; it is put here as the question he would have had to ask for one to exist, because the
// timing is the thing under test and a statement gives it nothing to act on.
console.log('\n    a self-correction before anyone replied must NOT close anything:');
function selfCorrect() {
  return [
    item('Inbound', '09/01/2026 2:25 PM', 'Received from: ' + CARLOS_PH
      + '\nReceived by: Samantha Gonzalez\n* dealer add on fees'),
    item('Inbound', '09/01/2026 2:25 PM', 'Received from: ' + CARLOS_PH + '\nReceived by: Samantha Gonzalez\nCan '
      + 'u send the out the door cost without dealer fees?')
  ];
}
check('his question stays open — we had not replied yet',
  i => run(i, selfCorrect()).open.length, 1);
check('...and nothing was credited to him as having closed it',
  i => /customer-moved-on/.test(run(i, selfCorrect()).diag), false);

// Bionca (9/17): she told us she had already done the thing she had asked about. Her request could
// never close by vocabulary either — her own message shares one word with it and the bar was two.
console.log('\n    and the other half of it: "I already did that":');
const BIONCA_PH = '(555) 010-0177';
function bionca(over) {
  over = over || {};
  return [
    item('Inbound', '09/17/2026 9:14 AM', over.last === undefined
      ? ('Received from: ' + BIONCA_PH + '\nReceived by: Brad White\ncorrect. '
         + 'i am traveling and cannot answer but i have submitted the application')
      : over.last),
    // A plain prose reply on purpose: it is neither a link, an affirmative nor figures, so the
    // handover path cannot fire and her own statement is the only thing left that can close this.
    item('Outbound', '09/16/2026 4:02 PM', 'Sent to' + ': ' + BIONCA_PH
      + '\nSent by: Rotaxlyn Hudson\nI will get that started on my end for you.'),
    item('Inbound', '09/16/2026 3:55 PM', 'Received from: ' + BIONCA_PH + '\nReceived by: Rotaxlyn Hudson\nCan I '
      + 'fill out an application or send over my info so we can see what my options are?')
  ];
}
check('her request is closed by her telling us she had done it',
  i => run(i, bionca()).open, []);
check('...by the customer path, which is now the ONLY thing her own message can do',
  i => /CLOSED-by-customer-did-it/.test(run(i, bionca()).diag), true);
check('an inbound-tagged entry the STORE typed cannot speak for her (v9.7.560)',
  i => run(i, bionca({ last: 'By: Rotaxlyn Hudson\ntransferred to Brad' })).open.length, 1);
check('...and neither can a message of hers that claims no such thing',
  i => run(i, bionca({ last: 'Received from: ' + BIONCA_PH
    + '\nReceived by: Brad White\ni am willing to put $2,000 down' })).open.length, 1);
check('and the old vocabulary bar could never have closed it — one shared word against a bar of two',
  i => /need:2/.test(run(i, bionca()).diag), true);

// ── NON-VACUITY ─────────────────────────────────────────────────────────────
// Each neuter is applied to THIS build's shipped code and paired with a control on the shipped
// form, so a passing assertion is attributable to the change rather than to absent code.
console.log('\nnon-vacuity (v9.7.654):');

const OUTBOUND_ONLY = c => c.replace(
  "if (odir !== 'outbound' && !(_isNote && _fulfilRe.test(obody))) continue;",
  "if (odir !== 'outbound') continue;");
check('neuter A actually restored the outbound-only rule', i => OUTBOUND_ONLY(i.code) !== i.code, true);
check('A: the note can no longer close the video thread',
  i => run(i, antonio(NO_REPLY), OUTBOUND_ONLY).open.length, 1);
check('A (control): the shipped resolver closes it',
  i => run(i, antonio(NO_REPLY)).open.length, 0);

const TWO_WORDS = c => c.replace('var _need = qWords.length <= 3 ? 1 : 2;', 'var _need = 2;');
check('neuter B actually restored the two-word bar', i => TWO_WORDS(i.code) !== i.code, true);
// With the note neutralised the outbound reply is the only thing that can close it, which is the
// path the bar governs. Left as-is the note closes it even under the old bar (it carries BOTH
// "videos" and "truck"), and that is worth pinning on its own: what hid Alyssa's note for months
// was the direction flag, not the overlap count.
const FLAT_NOTE = { note: 'By: Alyssa Williams\nTexting on cell.' };
check('B: with the note neutral, the outbound reply no longer clears the bar',
  i => run(i, antonio(FLAT_NOTE), TWO_WORDS).open.length, 1);
check('B (control): the shipped resolver closes it on that same lead',
  i => run(i, antonio(FLAT_NOTE)).open.length, 0);
check('B: the note itself clears even the OLD bar — the direction flag is what hid it',
  i => /CLOSED-by-note/.test(run(i, antonio(NO_REPLY), TWO_WORDS).diag), true);
check('B: and a two-word question becomes unclosable again, as it was for months',
  i => run(i, shortLead('The Patriot one is on the ground now'), TWO_WORDS).open.length, 1);

const NO_APOS = c => c.replace(/\n\s*qbody = qbody\.replace\([^\n]*\n/, '\n');
check('neuter C actually removed the apostrophe repair', i => NO_APOS(i.code) !== i.code, true);
check('C: the CarGurus body manufactures questions again',
  i => run(i, [item('Inbound', '09/06/2026 5:38 PM', CARGURUS_BODY)], NO_APOS).open.length > 0, true);
// (v9.7.711) Was "one of them is the URL fragment": since v9.7.711 links are cut before the split,
// independently of the apostrophe repair, so the fragment stays out even with the repair removed.
check('C: v9.7.711 — even then, the URL fragment is not among them (links are cut first)',
  i => run(i, [item('Inbound', '09/06/2026 5:38 PM', CARGURUS_BODY)], NO_APOS).open.some(q => /1y864y/.test(q)), false);
check('C (control): the shipped resolver produces none',
  i => run(i, [item('Inbound', '09/06/2026 5:38 PM', CARGURUS_BODY)]).open.length, 0);

// ── (9b) A WEB ADDRESS IS NOT A QUESTION (v9.7.711) ─────────────────────────
// LIVE, 9/20, a Toyota lead (captures 67173f32, bf740cfc): OPEN THREADS told the model the customer
// had asked "com%2fsearch/one-owner-used/?" and was waiting for an answer. The customer had pasted
// a listing link; its query string supplied the '?' and its domain the '.'.
console.log('\n(9b) a pasted link is not a question (v9.7.711):');
const LINK_BODY = 'Received from: (555) 010-0199\nhttps://www.example.com/used/2023-toyota-rav4-hybrid-for-sale/?utm=x example.com%2fsearch/one-owner-used/?sort=price';
const NO_LINKCUT = c => c.replace(/\n\s*\/\/ \(v9\.7\.711\) A WEB ADDRESS IS NOT A QUESTION[\s\S]*?\.replace\(\/\\b\[\\w-\]\+[^\n]*\n/, '\n');
check('neuter 9b actually removed the link cut', i => NO_LINKCUT(i.code) !== i.code, true);
check('9b: with the link cut removed, the link becomes an "unanswered question" again',
  i => run(i, [item('Inbound', '09/20/2026 11:58 AM', LINK_BODY)], NO_LINKCUT).open.some(q => /%2fsearch|one-owner-used/.test(q)), true);
check('9b (shipped): no open thread from a pasted link',
  i => run(i, [item('Inbound', '09/20/2026 11:58 AM', LINK_BODY)]).open.length, 0);
check('9b (control): a real question beside a link is still caught',
  i => run(i, [item('Inbound', '09/20/2026 11:58 AM', 'https://www.example.com/used/x/?a=1 Is this one still available?')]).open.some(q => /still available/.test(q)), true);

// ── (10) A QUESTION WITHOUT A QUESTION MARK (v9.7.666) ──────────────────────
// LIVE, 9/16. Aimee Williams, Community Kia Baytown. She had just been sent an exterior photo and
// wrote "Can I see the inside". The resolver reported 0 questions examined, and both drafts
// answered with "1:15 PM or 2:00 PM today?" — a time close in reply to a request for photos.
console.log('\n(10) she asked without typing a "?" (v9.7.666):');

const asked = (i, text) => run(i, [
  item('Inbound', '09/16/2026 11:02 AM', 'Received by: Vinessa Virtual Assistant Community Kia\n' + text)
]).open;

check('her exact line is now an open thread',
  i => asked(i, 'Can I see the inside').some(q => /Can I see the inside/.test(q)), true);
check('...and the diagnostic says it carried no question mark',
  i => /carried NO question mark/.test(run(i, [
        item('Inbound', '09/16/2026 11:02 AM', 'Received by: V\nCan I see the inside')]).diag), true);

// The rest of her thread, verbatim. Most of it is NOT a question and must stay quiet.
check('her other messages are not turned into questions',
  i => ['Yes or sportage', 'Something bigger', 'I need to know im approved', 'Nice I love it',
        'Everything sent', 'Application done', 'Navy federal',
        '1000 down think im upside down not sure'].filter(t => asked(i, t).length).length, 0);
check('...while her earlier real request is caught',
  i => asked(i, 'Can you send me a application to fill out to see if I qualify').length, 1);
// Corrected to what the resolver actually does, and the reason is pre-existing and sound: it
// tracks a question by its CONTENT WORDS so it can tell whether a later message answered it.
// "How much" is all stopwords, so there is nothing to match against and it is dropped by the
// `qWords.length === 0` gate that has always been there. A real limitation, recorded not forced.
check('a wh-question with no content word is still dropped — nothing to match a reply against',
  i => asked(i, 'How much').length, 0);
check('...but the same question with one content word is caught',
  i => asked(i, 'How much is the payment').length, 1);

// Auxiliary + SUBJECT is a question. Auxiliary + anything else is not. This is the whole
// discriminator, and it is grammar rather than a list of things customers have said.
console.log('\n(11) the inversion test, not a word list:');
check('auxiliary followed by a verb is not a question',
  i => asked(i, 'Will call you later when I get off work').length, 0);
check('auxiliary followed by an article is not a question',
  i => asked(i, 'Have a good day and thanks again').length, 0);
check('a first-person statement is not a question',
  i => asked(i, 'I can do that tomorrow afternoon').length, 0);
check('a negative imperative is not a question',
  i => asked(i, 'Do not call me before noon please').length, 0);
check('auxiliary followed by a subject IS a question',
  i => [asked(i, 'Is the car still there').length, asked(i, 'Do you have it in black').length], [1, 1]);

check('a question that DOES carry a mark is not counted twice',
  i => asked(i, 'Is the car still available?').length, 1);

// ── (v9.7.677) A QUESTION THAT SITS INSIDE A SENTENCE ──────────────────────
// Gil, 9/17, on Thomas Lilley: the tint question went unanswered and the row read "0 inbound
// question(s) examined". He wrote it in one unbroken run with no '?' and no full stop, so the
// whole thing is ONE segment and v9.7.666 tests only a segment's START.
console.log('\n(12) a question embedded mid-sentence (v9.7.677):');

const THOMAS = '2 more questions and that is I am going to tint the windows darker than what will '
  + 'come on the car so do you have any that does n';

check("Thomas's tint question is found at all \u2014 it was invisible before this build",
  i => asked(i, THOMAS).length, 1);
// MY FIRST DRAFT SLICED FROM THE INVERSION ONWARD AND THIS SUITE REJECTED IT. "do you have any
// that does n" has no content word of four letters or more, so the pre-existing qWords gate — the
// same one that drops a bare "How much" — threw it away and the thread stayed invisible. The topic
// sits BEFORE the inversion, which is how run-on sentences work, so the whole segment is kept.
check('...and what is captured carries the TOPIC, not just the inverted tail',
  i => /tint the windows darker/i.test(asked(i, THOMAS)[0]), true);
check('...and the inversion that identified it is in there too',
  i => /do you have any/i.test(asked(i, THOMAS)[0]), true);
check('...so it survives the content-word gate that killed the sliced version',
  i => asked(i, 'do you have any that does n').length, 0);

console.log('\n    other run-ons a customer actually writes:');
check('a question after a coordinator is found',
  i => asked(i, 'I looked at the website and can you tell me if it has the sunroof').length, 1);
check('a question after a comma is found',
  i => asked(i, 'thanks for that, do you know what the payment would be').length, 1);

console.log('\n    and the false opens this nearly shipped, each one pinned:');
// My own 14-line corpus passed the wide subject set. THIS suite's existing fixture caught it:
// "do that" is a verb phrase, not an inversion, and that sentence is an agreement.
check('"I can do that tomorrow afternoon" is still an agreement, not a question',
  i => asked(i, 'I can do that tomorrow afternoon').length, 0);
check('"I will do it when I can" is not a question',
  i => asked(i, 'I will do it when I can').length, 0);
check('"sure I could do that" is not a question',
  i => asked(i, 'sure I could do that').length, 0);
check('a linking verb mid-sentence is not an inversion \u2014 the set excludes them on purpose',
  i => asked(i, 'I did not build a payment because it was just a program I had to go through').length, 0);

console.log('\n    the anchored branch is untouched, so no existing verdict moved:');
check('a segment-initial "Is there" still works, though the mid-sentence set excludes it',
  i => asked(i, 'Is there a way to get it in black').length, 1);
check('...and the same words mid-sentence are deliberately NOT caught, which is the stated hole',
  i => asked(i, 'I was wondering is there a way to get it in black').length, 0);

console.log('\nnon-vacuity (v9.7.666):');
// Pin the interrogative test false and her line goes back to being invisible.
const NO_SHAPE = c => c.replace('_qInvRe.test(sn)', 'false');
check('neuter D actually disabled the shape test', i => NO_SHAPE(i.code) !== i.code, true);
check('D: this is exactly what v9.7.665 shipped — she asked and nothing saw it',
  i => run(i, [item('Inbound', '09/16/2026 11:02 AM', 'Received by: V\nCan I see the inside')], NO_SHAPE).open.length, 0);
check('D (control): the shipped resolver sees it',
  i => asked(i, 'Can I see the inside').length, 1);

console.log('\nnon-vacuity (v9.7.681):');

// Remove the handover path and Carlos's three answered questions come straight back — which is
// the state the 9/17 prompt actually shipped in, and what put a stale re-offer in his text.
const NO_HANDOVER = c => c.replace(
  'if (_qHandoverRe.test(iq.question) && _uqIsHandover(obody)) {', 'if (false) {');
check('neuter C actually disabled the handover path',
  i => NO_HANDOVER(i.code) !== i.code, true);
check('C: all three of Carlos\'s answered questions are reported open again',
  i => run(i, carlos(), NO_HANDOVER).open.length, 3);
check('C (control): the shipped resolver closes all three',
  i => run(i, carlos()).open.length, 0);

// Remove the SUBJECT gate and Tori's status question starts accepting answers that do not answer
// it. This is the guard that keeps v9.7.681 from repeating v9.7.680.
const NO_SUBJECT_GATE = c => c.replace(
  'if (_qHandoverRe.test(iq.question) && _uqIsHandover(obody)) {', 'if (_uqIsHandover(obody)) {');
check('neuter D actually removed the subject gate',
  i => NO_SUBJECT_GATE(i.code) !== i.code, true);
check('D: a bare link now "answers" whether she was pre-approved',
  i => run(i, tori({ reply: 'https://www.communitykia.com/finance-application/' }), NO_SUBJECT_GATE).open.length, 0);
check('D (control): the shipped resolver leaves her question open',
  i => run(i, tori({ reply: 'https://www.communitykia.com/finance-application/' })).open.length, 1);

// Remove the completion requirement and v9.7.680 is back: any later message closes the thread,
// and Tori's "$2,500 down" closes her own pre-approval question.
const NO_DID_IT = c => c
  .replace('                if (!_custDidItRe.test(obody)) continue;                  // not "I already did it"\n', '')
  .replace('                if (!_uqShares(obody, qWords)) continue;                  // and not about this\n', '');
check('neuter E actually removed the completion requirement',
  i => NO_DID_IT(i.code) !== i.code, true);
check('E: this is exactly v9.7.680 — her own next message closes it and she is never answered',
  i => run(i, tori(), NO_DID_IT).open.length, 0);
check('E (control): the shipped resolver keeps it open',
  i => run(i, tori()).open.length, 1);
check('E: and the path still works where it belongs — Bionca closes on the shipped form',
  i => run(i, bionca()).open, []);

// The speaker check, still load-bearing on the path that remains.
const NO_SPEAKER = c => c.replace("                if (obody.indexOf('received from:') < 0) continue;\n", '');
check('neuter F actually removed the speaker check',
  i => NO_SPEAKER(i.code) !== i.code, true);
// First person, because that is the shape that actually threatens this path: an agent
// typing "i have submitted the application for her" into an inbound-tagged entry reads as
// the CUSTOMER saying she did it. A third-person note would never have matched.
check('F: a store-typed entry written in the first person now speaks for her',
  i => run(i, bionca({ last: 'By: Rotaxlyn Hudson\ni have submitted the application for her' }), NO_SPEAKER).open.length, 0);
check('F (control): the shipped resolver refuses it',
  i => run(i, bionca({ last: 'By: Rotaxlyn Hudson\ni have submitted the application for her' })).open.length, 1);


console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
