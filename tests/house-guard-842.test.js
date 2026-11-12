#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('house-guard-842.test.js');
// (v9.7.842) FROM THE 10/30 REPORT: STORE HOURS NOBODY ASKED FOR, OUR NOTES, THEIR BROWSING -- AND A 6-DAY-OLD LEAD OFFERED A PAUSE.
// Cars.com lead 2107725373 shipped "We're open Monday through Saturday."; Tradepending lead 2104804008's email said "The last note I
// have from you is the inbound call on Monday." and its drafts asked "Would you prefer that I pause follow-up for now?" (rejected
// three times; the lead is not eligible to be closed out); Fullpath lead 2107879658 said "the 2026 Toyota bZ offer you viewed on
// our website". Executes _lpHouseGuard, the close-out ban text, LP_WITHDRAW_RX and _lpRefineSms; checks the render chain calls the
// guard for every format. Placeholder data only.
//
// Usage: node tests/house-guard-842.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: house-guard-842.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const E = (date, time, tag, title, body) => '[' + date + ' ' + time + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = '[10/24/2026 9:00 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';

(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const guard = (text, ch, lsd) => { run('lastScrapedData = ' + JSON.stringify(lsd || { lastInboundMsg: '', history: '' }) + ';'); const fn = run('_lpHouseGuard'); if (typeof fn !== 'function') return 'no _lpHouseGuard';
    const ol = sb.console.log; const logs = []; sb.console.log = (...a) => logs.push(a.join(' ')); try { return { out: fn(text, ch), log: logs.find(l => /\[LP HOUSE GUARD\]/.test(l)) || '' }; } finally { sb.console.log = ol; } };

  console.log(' 1. store hours nobody asked for:');
  const SMS = 'Test, the Phantom Black 2024 Santa Fe SEL is here and available to see. I got your Cars.com inquiry. Would you like to come take a look? We’re open Monday through Saturday.\nAgent\nTest Store\n(555) 010-0100';
  const g1 = guard(SMS, 'sms');
  check('lead 2107725373: "We’re open Monday through Saturday." is removed; the rest and the signature stay', () => g1.out,
    'Test, the Phantom Black 2024 Santa Fe SEL is here and available to see. I got your Cars.com inquiry. Would you like to come take a look?\nAgent\nTest Store\n(555) 010-0100');
  const EM = 'Hi Test,\n\nThe Phantom Black one is here and available to see. Would you like to come take a look?\n\nWe’re open Monday through Saturday. If you have a particular feature you’re comparing, let me know.\n\nAgent Name\nTest Store';
  check('in an email paragraph only that sentence goes', () => guard(EM, 'email').out,
    'Hi Test,\n\nThe Phantom Black one is here and available to see. Would you like to come take a look?\n\nIf you have a particular feature you’re comparing, let me know.\n\nAgent Name\nTest Store');
  check('the console names what was removed', () => /^\[LP HOUSE GUARD\] sms: removed hours: "We’re open Monday through Saturday\."/.test(g1.log), true);
  check('control: the customer asked about hours -> kept', () => guard(SMS, 'sms', { lastInboundMsg: 'what are your hours on saturday?', history: '' }).out, SMS);
  check('control: "we’re open until 7 tonight" with a time offer is not a list of hours -> kept', () => {
    const t = 'Test, we’re open until 7 tonight, so would 5:30 or 6:15 work?\nAgent'; return guard(t, 'sms').out === t; }, true);

  console.log(' 2. our notes:');
  const EM2 = 'Hi Test,\n\nThe last note I have from you is the inbound call on Monday. I know the follow-up since then has been a lot, so I’ll keep this simple.\n\nAgent Name';
  check('lead 2104804008: "The last note I have from you..." is removed, the next sentence stays', () => guard(EM2, 'email').out,
    'Hi Test,\n\nI know the follow-up since then has been a lot, so I’ll keep this simple.\n\nAgent Name');
  check('control: "I noted your color preference" is not about our notes -> kept', () => { const t = 'Test, I noted your color preference.\nAgent'; return guard(t, 'sms').out === t; }, true);

  console.log(' 3. their browsing:');
  check('lead 2107879658: "the 2026 Toyota bZ offer you viewed on our website" -> "the 2026 Toyota bZ offer on our website"', () =>
    guard('Test, the 2026 Toyota bZ offer you viewed on our website includes $3,250 TFS Lease Cash.\nAgent', 'sms').out, 'Test, the 2026 Toyota bZ offer on our website includes $3,250 TFS Lease Cash.\nAgent');
  check('control: "the offer on our website" and "you asked about" are left alone', () => {
    const t = 'Test, the bZ you asked about is here, and the offer on our website still applies.\nAgent'; return guard(t, 'sms').out === t; }, true);
  check('the render chain runs the guard on the text, the email and the voicemail', () =>
    ["_lpHouseGuard(((typeof _lpAmericanSpelling === 'function') ? _lpAmericanSpelling(cleanOutput(rawSms, true)) : cleanOutput(rawSms, true)), 'sms')",
     "_lpHouseGuard(((typeof _lpAmericanSpelling === 'function') ? _lpAmericanSpelling(cleanOutput(rawEmail, false)) : cleanOutput(rawEmail, false)), 'email')",
     "_lpHouseGuard(((typeof _lpAmericanSpelling === 'function') ? _lpAmericanSpelling(vmText) : vmText), 'voicemail')"].map(x => src.indexOf(x) > 0), [true, true, true]);

  console.log(' 4. a lead that is not eligible to be closed out is not offered a pause:');
  check('the ban now names "would you prefer that I pause follow-up" and "or would you rather leave it for now"', () => {
    const t = run('_lpCloseOutBanText')('6d old'); return [/"would you prefer that I pause follow-up"/.test(t), /"or would you rather leave it for now"/.test(t)]; }, [true, true]);
  check('lead 2104804008\'s wordings are withdrawals; a plain question is not', () => ['Would you prefer that I pause follow-up for now?', 'Would you like me to follow up on that, or leave it for now?',
    'I can hold off on reaching out until next week.', 'Would a quick call about the appraisal be helpful?'].map(t => run('LP_WITHDRAW_RX').test(t)), [true, true, true, false]);
  const SIG = '\nAgent\nTest Store\n(555) 010-0100';
  const EMAIL = 'Hi Test,\n\nI can go over how we confirm the trade value on your Rio. Would a quick call be helpful?\n\nAgent Name\nTest Store\n(555) 010-0100';
  const H = E('10/26/2026', '10:00 AM', 'AGENT', 'Outbound Text Message', 'Test, about your Rio appraisal. Agent') + E('10/25/2026', '10:00 AM', 'AGENT', 'Email reply to prospect', 'Hi Test, the appraisal. Agent') + MARK;
  const D = { autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', dealerId: 'TST1', store: 'Test Store', leadSource: 'Tradepending', convState: 'active-follow-up',
    leadAgeDays: 6, hasOutbound: true, hasCustomerReply: false, totalNoteCount: 6, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '', relationshipSignals: { unansweredQuestions: [] }, history: H, conversationBrief: H };
  await acheck('a rewrite that asks "Would you prefer that I pause follow-up for now?" on a 6-day-old lead -> the first pass ships', async () => {
    const logs = []; sb.__reply = 'Test, we’ve been reaching out about your trade. Would you prefer that I pause follow-up for now? A yes or no is fine.' + SIG; sb.__d = D;
    run('_lpLastVisitDecision = { level: 0, owner: "" }; window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Test Store" };'
      + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpAddApptLeadId = ""; window._lpActiveProhibitions = [];'
      + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
      + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
      + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };');
    const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...q) => logs.push(q.join(' ')); sb.console.warn = () => {};
    let out; try { out = await run('_lpRefineSms(' + JSON.stringify('Test, I can go over how we confirm the trade value on your Rio. Would a quick call about it help?' + SIG) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)'); }
    finally { sb.console.log = ol; sb.console.warn = ow; }
    return [out, logs.some(l => /kept the first pass — the rewrite offered to stop or close out \("pause follow-up"\)/.test(l))]; }, [null, true]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
