#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('names-pages-848.test.js');
// (v9.7.848) FROM 11/2. (1) Honda Lafayette lead 2107319795: the customer's first name is two letters, and the drafts opened
// "<first> <last>," in the text and "Hi <first> <last>," in the email (10/30, both rejected; one such text went out). The opener
// check could not tell, and it found a two-letter name inside "Thanks" or "that", so a text with no name passed as named.
// (2) Kia Baytown lead 2108537212 (Click & Go): the text and email opened "Since you reached the Review page after building your
// payment"; Gil: "drop the review page wording." Executes the prompt through the shipped panel payload, the Click & Go block,
// _lpHouseGuard and the opener guard. Placeholder data only.
//
// Usage: node tests/names-pages-848.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: names-pages-848.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const SIG = '\nAgent\nTest Store\n(555) 010-0100';
const E = (time, tag, title, body) => '[10/30/2026 ' + time + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = '[10/29/2026 2:27 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const NOTE = E('2:22 PM', 'AGENT', 'Outbound Text Message', 'Ab, how is the vehicle shopping going?');
const LSD = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Ab Testbuyer', firstName: 'Ab', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2024 Honda CR-V LX',
  condition: 'Used', stockNum: 'TEST0H1', dealerId: '24399', store: 'Community Honda Lafayette', leadSource: 'Dealers WebSite', convState: 'active-follow-up', leadAgeDays: 3,
  hasOutbound: true, hasCustomerReply: false, totalNoteCount: 7, phone: '(555) 010-0199', email: '', lastInboundMsg: '',
  relationshipSignals: { unansweredQuestions: [] }, history: NOTE + MARK, conversationBrief: NOTE + MARK }, x || {});

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const built = (lsd) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {};
    try { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(lsd);
      return String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: run('leadContext') }))); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const guard = (text, ch, lsd) => { run('lastScrapedData = ' + JSON.stringify(lsd || { name: 'Ab Testbuyer', store: 'Community Honda Lafayette', dealerId: '24399' }) + ';');
    const ol = sb.console.log; const logs = []; sb.console.log = (...a) => logs.push(a.join(' ')); try { return { out: run('_lpHouseGuard')(text, ch), log: logs.join('\n') }; } finally { sb.console.log = ol; } };

  console.log(' 1. the first name, alone:');
  const p = built(LSD());
  check('the prompt gives the first name on its own line, and says never the full name', () =>
    /^First name: Ab  ← address them by this first name alone \(the text opens with it, the email greets with it\)\. Never the full name, even when the first name is short\.$/m.test(p), true);
  check('control: a one-word name gets no extra line', () => /^First name:/m.test(built(LSD({ name: 'Ab', firstName: 'Ab' }))), false);
  const t = guard('Ab Testbuyer, take the time you need with the CR-V. No pressure.' + SIG, 'sms');
  check('lead 2107319795: "<first> <last>, take the time you need" -> "<first>, take the time you need"', () => t.out, 'Ab, take the time you need with the CR-V. No pressure.' + SIG);
  check('and the email\'s "Hi <first> <last>," -> "Hi <first>," (the subject line above it is left alone)', () =>
    guard('Subject: Your CR-V\n\nHi Ab Testbuyer,\n\nTake the time you need.\n\nAgent Name', 'email').out, 'Subject: Your CR-V\n\nHi Ab,\n\nTake the time you need.\n\nAgent Name');
  check('the console names it', () => /\[LP HOUSE GUARD\] sms: removed full name as the greeting: "Ab Testbuyer"/.test(t.log), true);
  check('control: the full name later in the message is left alone; "Ab," is left alone', () => {
    const a = 'Ab, the paperwork will say Ab Testbuyer, so bring your license.' + SIG; return [guard(a, 'sms').out === a, guard('Ab, no pressure.' + SIG, 'sms').out === 'Ab, no pressure.' + SIG]; }, [true, true]);
  const oa = src.indexOf('    // Light-touch SMS opener check'), ob = src.indexOf('\n    })();', oa);
  const opener = (sms, name) => { const box = { String, RegExp, rawSms: sms, lastScrapedData: { name: name, agent: 'Agent Name' }, console: { log() {} } };
    vm.createContext(box); vm.runInContext(src.slice(oa, ob + '\n    })();'.length), box); return box.rawSms; };
  check('a two-letter first name is not found inside "Thanks": the name is added', () =>
    opener('Thanks for your patience with the CR-V.', 'An Testbuyer'), 'An, thanks for your patience with the CR-V.');
  check('control: "An, thanks ..." already carries it', () => opener('An, thanks for your patience.', 'An Testbuyer'), 'An, thanks for your patience.');

  console.log(' 2. never where in the online tool they were (Gil: "drop the review page wording"):');
  const cg = built(LSD({ name: 'Test Buyer', firstName: 'Test', leadSource: 'Gubagoo - Virtual Retailing', dealerId: '6190', store: 'Community Kia Baytown', vehicle: '2021 Kia Telluride S',
    vrPaymentSelected: true, vrDroppedOff: true, vrDroppedOffPage: 'Review', vrPayType: 'Finance', vrCreditAppNotStarted: true }));
  check('the Click & Go block no longer names the page they stopped on, and says not to', () =>
    [/Review page|stopped on the/.test(cg.replace(/no "since you reached the Review page"/g, '')), /stopped before finishing/.test(cg),
     /Never tell them which page or screen of the tool they reached or stopped on/.test(cg)], [false, true, true]);
  check('lead 2108537212: "Since you reached the Review page after building your payment, the next step can be simple." -> "The next step can be simple."', () =>
    guard('Hi Test,\n\nSince you reached the Review page after building your payment, the next step can be simple. I can send the credit application.\n\nAgent Name', 'email').out,
    'Hi Test,\n\nThe next step can be simple. I can send the credit application.\n\nAgent Name');
  check('a sentence only about it goes: "You stopped on the Financing page." ', () =>
    guard('Test, you stopped on the Financing page. Want me to send the credit application?' + SIG, 'sms').out, 'Test, want me to send the credit application?' + SIG);
  check('control: "the payment you built" stays; "the next step" stays', () => {
    const a = 'Test, I’m following up on the payment you built for the Telluride. The next step is the credit application.' + SIG; return guard(a, 'sms').out === a; }, true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
