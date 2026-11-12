#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('chip-feedback-equity-871.test.js');
// (v9.7.871) OWNER-APPROVED 11/12 ("build 871, all three"), from the 11/11 report:
//  (a) Add Appt carried the email's time question into a text that already had the times, written without AM/PM
//      (Toyota Baytown lead 2110460414: "...at 4:30 or 5:15. Would either work? ...at 4:30 PM or 5:15 PM. Would either time work?").
//  (b) Feedback: a chip press was counted on the draft it replaced, so chip-then-send read as a rejection and "chip helped" never
//      happened (all six Add Appt presses on 11/11).
//  (c) The payoff-to-value gap in dollars: "there's about a $6,000 gap between your Sorento's payoff and assessed value"
//      (Kia Baytown lead 2112768568, both drafts thrown away).
// Executes the build's own code: _lpChipTimesBoth and _lpFinanceGuard; the chip handler's feedback block and generateAll's
// feedback lines lifted from the file and run against the shipped _lpFeedbackReset / rating / signal functions; buildUserPrompt
// through the panel payload for the prompt rule. Placeholder data only.
//
// Usage: node tests/chip-feedback-equity-871.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: chip-feedback-equity-871.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const slice = (src, a, b) => { const i = src.indexOf(a); if (i < 0) throw new Error('anchor not found: ' + a.slice(0, 50)); const j = src.indexOf(b, i + a.length); if (j < 0) throw new Error('end not found: ' + b.slice(0, 50)); return src.slice(i, j); };

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  const fn = (n) => run('typeof ' + n + ' === "function" ? ' + n + ' : null');
  const quiet = (g) => { const ol = sb.console.log; sb.console.log = () => {}; try { return g(); } finally { sb.console.log = ol; } };

  // ---------------------------------------------------------------------------------------------------------------------
  console.log(' (a) Add Appt: a time without AM/PM is a time:');
  const ctb = fn('_lpChipTimesBoth');
  run('window._lpAddApptLeadId = "TEST001A"; window._activeLeadId = "TEST001A"; window._lpAddApptAt = Date.now();');
  const D = { autoLeadId: 'TEST001A', agent: 'Agent Name', conversationBrief: '', history: '' };
  const SIG = '\nAgent\nInternet Sales Coordinator | Community Toyota Baytown\n(555) 010-0100';
  const ESIG = '\n\nAgent Name\nInternet Sales Coordinator\nCommunity Toyota Baytown\n(555) 010-0100';
  const SMS_BARE = 'Test, I know we haven’t connected yet, and Rep has tried reaching you by phone. I can have everything ready for you to stop by today at 4:30 or 5:15. Would either work?' + SIG;
  const EM_TIMES = 'Subject: Camry visit today\n\nTest,\n\nWe haven’t connected yet. I can have everything ready for you to stop by today at 4:30 PM or 5:15 PM. Would either time work?' + ESIG;
  const SMS_NONE = 'Test, Rep has tried reaching you by phone about the Camry. What is the easiest way to connect?' + SIG;
  const EM_NONE = 'Subject: Your Camry\n\nTest,\n\nRep has tried reaching you by phone about the Camry. What is the easiest way to connect?' + ESIG;
  check('the 11/11 shape: the text has "4:30 or 5:15", the email "4:30 PM or 5:15 PM" -> nothing carried, the text sent as written',
    () => quiet(() => ctb(SMS_BARE, EM_TIMES, D)), null);
  check('the text has no time at all -> the email\'s question is still carried in (865 unchanged)',
    () => { const r = quiet(() => ctb(SMS_NONE, EM_TIMES, D)); return r && [r.sms.split('\n')[0].endsWith('today at 4:30 PM or 5:15 PM. Would either time work?'), r.email === EM_TIMES]; }, [true, true]);
  check('the email has no time and the text\'s times have no AM/PM -> the text\'s question goes into the email, above the signature',
    () => { const r = quiet(() => ctb(SMS_BARE, EM_NONE, D)); return r && [r.sms === SMS_BARE, /What is the easiest way to connect\?\n\nI can have everything ready for you to stop by today at 4:30 or 5:15\. Would either work\?\n\nAgent Name/.test(r.email)]; }, [true, true]);
  check('our phone number and the model year are not times: a text with neither gets the email\'s question',
    () => { const r = quiet(() => ctb('Test, the 2027 Camry is here. Is it still on your list?' + SIG, EM_TIMES, D)); return !!(r && /Would either time work\?$/.test(r.sms.split('\n')[0])); }, true);
  check('both formats with times -> nothing changes', () => quiet(() => ctb('Test, would 4:30 PM or 5:15 PM work today?' + SIG, EM_TIMES, D)), null);
  run('window._lpAddApptLeadId = "";');
  check('control: the chip is off -> nothing carried', () => quiet(() => ctb(SMS_NONE, EM_TIMES, D)), null);
  run('window._lpAddApptLeadId = "TEST001A";');

  // ---------------------------------------------------------------------------------------------------------------------
  console.log(' (b) feedback: the chip belongs to the draft it produces:');
  let chipBlock = '', genBlock = '', copyBlock = '';
  try {
    chipBlock = slice(src, '    // Feedback: track chip usage\n', '    // Visual feedback');
    genBlock = slice(src, '  // Track if this is a regen (output already exists) for feedback signal\n', '  const endpoint = getEndpoint();');
    copyBlock = slice(src, '    // Feedback: record copy interaction\n', '    // Send implicit signal');
  } catch (e) { console.log('  FAIL lift: ' + e.message); fail++; }
  sb.__rows = [];
  run('_lpFeedbackFlush = function () { if (!_lpFeedback.generationId || _lpFeedback.hasCopied) return; '
    + '__rows.push([_lpFeedbackDeriveRating() || "abandoned", _lpFeedbackDeriveSignalType(), _lpFeedback.chipsUsed.slice()]); };');
  sb.__strip = false;
  const fakeDoc = '({ getElementById: function () { return { classList: { contains: function () { return __strip; } } }; } })';
  const generate = () => { run('(function (document) { _lpFeedbackReset();\n' + genBlock + '\n})(' + fakeDoc + ')'); sb.__strip = true; };
  const chip = (key) => { run('(function (key) {\n' + chipBlock + '\n})(' + JSON.stringify(key) + ')'); generate(); };
  const regen = () => generate();
  const copy = () => { run('(function () {\n' + copyBlock + '\n})()'); return [run('_lpFeedbackDeriveRating()'), run('_lpFeedbackDeriveSignalType()'), run('_lpFeedback.chipsUsed.slice()')]; };
  const fresh = () => { run('_lpFeedbackReset(true); window._lpPendingChipKey = "";'); sb.__rows = []; sb.__strip = false; };   // reset first: it flushes the last scenario's session

  fresh(); generate(); chip('add-appt'); let live = copy();
  check('generate -> Add Appt -> copy: the sent draft reads "chip helped" (weak_up / implicit_chip_copy, chips [add-appt])', () => live, ['weak_up', 'implicit_chip_copy', ['add-appt']]);
  check('... and the draft it replaced is not a rejection: it flushes as abandoned / no_interaction', () => sb.__rows.map(r => r.slice(0, 2)), [['abandoned', 'no_interaction']]);
  fresh(); generate(); chip('add-appt'); sb.__strip = false; generate();
  check('generate -> chip -> move on with nothing sent: the chip\'s draft still reads "chipped, never copied"', () => sb.__rows.map(r => r.slice(0, 3)),
    [['abandoned', 'no_interaction', []], ['down', 'implicit_chip_no_copy', ['add-appt']]]);
  fresh(); generate(); regen(); live = copy();
  check('generate -> regenerate -> copy: unchanged, neutral / implicit_regen_copy', () => [live, sb.__rows.map(r => r[0])], [['neutral', 'implicit_regen_copy', []], ['abandoned']]);
  fresh(); generate(); regen(); regen();
  check('generate -> regenerate -> regenerate: the middle draft is still a rejection (down / implicit_regen_no_copy)', () => sb.__rows.map(r => r.slice(0, 2)), [['abandoned', 'no_interaction'], ['down', 'implicit_regen_no_copy']]);
  fresh(); generate(); regen(); chip('shorter'); live = copy();
  check('generate -> regenerate -> Shorter -> copy: the regenerated draft is the rejection, the chip\'s draft "chip helped"', () => [sb.__rows.map(r => r[1]), live[0]], [['no_interaction', 'implicit_regen_no_copy'], 'weak_up']);
  check('a chip whose generate never ran is cleared when the chip settles, so it cannot land on a later plain regenerate',
    () => /window\._lpRegenChipKey = '';\n\s+window\._lpPendingChipKey = '';/.test(src), true);

  // ---------------------------------------------------------------------------------------------------------------------
  console.log(' (c) the payoff-to-value gap, never in dollars:');
  const fg = fn('_lpFinanceGuard');
  const G = (t) => quiet(() => fg(t, 'sms'));
  check('the 11/11 opener: "about a $6,000 gap between your Sorento\'s payoff and assessed value" -> "a gap between..."',
    () => G('Test, there’s about a $6,000 gap between your Sorento’s payoff and assessed value. Rep can go over the assessment with you.'),
    'Test, there’s a gap between your Sorento’s payoff and assessed value. Rep can go over the assessment with you.');
  check('the first draft: "that roughly $6,000 gap between your Sorento\'s payoff and value" -> "that gap"',
    () => G('Test, that roughly $6,000 gap between your Sorento\'s payoff and value can make selling it tough.'), 'Test, that gap between your Sorento\'s payoff and value can make selling it tough.');
  check('"a gap of about $6,000 between what you owe and its value" -> "a gap between..."',
    () => G('There is a gap of about $6,000 between what you owe and its value.'), 'There is a gap between what you owe and its value.');
  check('"you owe about $6,000 more than it\'s worth" -> "you owe more than it\'s worth"',
    () => G('Right now you owe about $6,000 more than it’s worth, and we can talk through options.'), 'Right now you owe more than it’s worth, and we can talk through options.');
  check('"6k" and a sentence-opening amount: "About a 6k difference sits between the payoff and our offer." -> "A difference sits..."',
    () => G('About a 6k difference sits between the payoff and our offer. Want to go over it?'), 'A difference sits between the payoff and our offer. Want to go over it?');
  check('control: a price difference between two listings keeps its number (no payoff, owe or equity in the sentence)',
    () => G('I can send the itemized proposal showing the $500 difference between the CarGurus and dealership listings.'), 'I can send the itemized proposal showing the $500 difference between the CarGurus and dealership listings.');
  check('control: rebate money and a down payment keep their numbers, even next to the word payoff',
    () => G('There is $1,000 customer cash on it. With $2,000 down, we can look at your payoff together.'), 'There is $1,000 customer cash on it. With $2,000 down, we can look at your payoff together.');
  check('the 431 patterns still work: "the $10k upside-down situation" loses its number',
    () => /\$10k/.test(G('We can talk about the $10k upside-down situation in person.')), false);

  // ---------------------------------------------------------------------------------------------------------------------
  console.log(' (d) the prompt rule fires on a payoff note and says it:');
  const prompt = (ctxText) => quiet(() => {
    const lsd = { name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Kia Sorento LX', condition: 'New', dealerId: '6190',
      store: 'Community Kia Baytown', leadSource: 'Showroom', convState: 'call-followup', leadAgeDays: 1, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 6,
      phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '', relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 1 },
      conversationBrief: ctxText, history: ctxText, context: ctxText };
    try { run('activeFlags = new Set();'); sb.__L = lsd; run('lastScrapedData = globalThis.__L;'); return String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd, context: ctxText }))); }
    catch (e) { return 'THREW ' + e.message; }
  });
  const NOTE = (b) => '[11/11/2026 05:02 PM] [NOTE] Showroom visit\n  ' + b + '\n';
  const pPay = prompt(NOTE('Customer came in on the Sorento. Payoff 24k, our number 18k on the trade. Wants to think it over.'));
  check('"Payoff 24k, our number 18k" -> the SENSITIVE FINANCE RULE is in the prompt, with the gap example',
    () => [/SENSITIVE FINANCE RULE/.test(pPay), /not "a \$6,000 gap between your payoff and its value" but "the gap between your payoff and its value"/.test(pPay)], [true, true]);
  check('"owes more than it is worth" -> the rule fires', () => /SENSITIVE FINANCE RULE/.test(prompt(NOTE('Customer owes more than the car is worth. Wants to think it over.'))), true);
  check('control: a showroom note with no credit or equity talk -> no rule', () => /SENSITIVE FINANCE RULE/.test(prompt(NOTE('Customer came in on the Sorento and drove it. Wants to think it over.'))), false);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
