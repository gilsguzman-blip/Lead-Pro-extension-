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
const NO_REPLY = { reply: 'Sent to: ' + PH + '\nSent by: Kristen Willis\nAntonio, let me know what works for you.' };

check('with the reply neutered, the note still closes it',
  i => run(i, antonio(NO_REPLY)).open, []);

check('...and the diagnostic says the NOTE is what closed it',
  i => /CLOSED-by-note/.test(run(i, antonio(NO_REPLY)).diag), true);

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

check('a later customer message on another topic does close it',
  i => run(i, [
    item('Inbound', '09/10/2026 11:00 AM', 'Received by: Kristen Willis\nWhat time do you close today'),
    item('Inbound', '09/09/2026 9:00 AM', 'Received by: Kristen Willis\nIt is priced above the range even with the recent price reduction.')
  ]).open.length, 0);

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
check('C: and one of them is the URL fragment the model was shown',
  i => run(i, [item('Inbound', '09/06/2026 5:38 PM', CARGURUS_BODY)], NO_APOS).open.some(q => /1y864y/.test(q)), true);
check('C (control): the shipped resolver produces none',
  i => run(i, [item('Inbound', '09/06/2026 5:38 PM', CARGURUS_BODY)]).open.length, 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
