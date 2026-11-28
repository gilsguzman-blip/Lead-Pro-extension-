#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('pitch-follow-817.test.js');
// (v9.7.817) THE MAIN PROMPT STOPPED PITCHING; THE TEXT REWRITE DID NOT. Kia Baytown lead 2103538959 (log350, v9.7.816): the
// email, the voicemail and the first draft of the text all opened "[Rep] has tried reaching you by phone" -- and the rewrite
// shipped "[Customer], the 2024 GMC Sierra 1500 AT4 is the one you were looking at ... [Rep] has tried reaching you by phone." Its
// own WRITE THE TEXT block still said "lead on the thing in that email that earns a reply" and "give them the actual reason this
// visit is worth making"; its in-stock block said "the email says it is here"; its close-out block said "replied 0.9d ago" of a
// STOP. The main prompt still carried "If the customer is engaged and available, close with an appointment" and "honor" our
// promise to have the truck ready when they arrive. Now, under the PITCH ALREADY OUT rule: the rewrite's job is the follow-up;
// a rewrite that buries "trying to reach you" does not ship; both leftovers stand down; a STOP is not a reply to the close-out
// gate; and after a STOP the main prompt asks for a call back or an email reply, never a text.
// Builds prompts through the shipped populateFromData and panel payload, and executes the shipped _lpBuildSmsRefinePrompt,
// _lpRefineSms (worker stubbed), _lpApplyVisitDecision and _lpCloseOutEligible. Placeholder data only.
//
// Usage: node tests/pitch-follow-817.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: pitch-follow-817.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) {
  let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const H = 3600000, NOW = Date.now();
const fmt = (ms) => { const f = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  .formatToParts(new Date(ms)).reduce((o, p) => (o[p.type] = p.value, o), {}); return f.month + '/' + f.day + '/' + f.year + ' ' + f.hour + ':' + f.minute + ' ' + f.dayPeriod.toUpperCase(); };
const E = (ms, tag, title, body) => '[' + fmt(ms) + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (ms) => '[' + fmt(ms) + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const T0 = NOW - 20 * H;
const PITCH = 'Test, the Summit White 2024 GMC Sierra 1500 AT4 is here and ready for you to see. Would 9:15 AM or 10:30 AM Wednesday work better? Agent';
const CONFIRM = 'You have successfully been removed from Test Auto Group text messages.';
const HIST = (o) => (o.calls ? E(T0 + 14 * H + 4 * 60000, 'AGENT', 'Outbound phone call (Machine)', 'By: Rep Name\n  Left message') + E(T0 + 14 * H, 'AGENT', 'Outbound phone call (Machine)', 'By: Rep Name\n  Left message') : '')
  + E(T0 + 3 * 60000, 'AGENT', 'Outbound Text Message', CONFIRM) + E(T0 + 2 * 60000, 'CUSTOMER', 'Inbound Text Message', o.reply || 'Stop')
  + E(T0, 'AGENT', 'Outbound Text Message', 'By: Agent Name\n  ' + PITCH) + MARK(T0 - 60000);
const LEAD = (o) => { o = o || {}; const h = HIST(o); return Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name',
  vehicle: '2024 GMC Sierra 1500 AT4', condition: 'Pre-Owned', stockNum: 'P0001', _lpInvConfirmedAvailable: true, dealerId: '6190', store: 'Test Kia', leadSource: 'Internet',
  convState: 'active-follow-up', leadAgeDays: 1, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 12, phone: '(555) 010-0199', email: 'test@example.com',
  customerZip: '00000', relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 0.9, totalOutboundCount: 4 },
  lastInboundMsg: o.reply || 'Stop', lastSubstantiveOutboundMsg: PITCH, history: h, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + h + '---',
  outboundSends: [{ title: 'outbound text message', ms: T0, body: PITCH }] }, o.x || {}); };
const PASS1 = 'Test, Rep has tried reaching you by phone, so I wanted to make it easy to reach us. Is a quick call or an email easier for you?\nAgent\nTest Kia\n(555) 010-0100';
const BURIED = 'Test, the 2024 GMC Sierra 1500 AT4 is the one you were looking at. Is there a feature or question you are weighing? Rep has tried reaching you by phone. You can call me or email me, whichever is easier.\nAgent';
const KEPT = 'Test, Rep and I have been trying to reach you about the Sierra AT4. Would a quick call or an email be easier?\nAgent';
const EMAIL = 'Subject: A question about the Sierra AT4\n\nTest,\n\nRep has tried reaching you by phone, and I wanted to leave an easy way to continue by email. Is there a particular question you are weighing?\n\nAgent Name';

(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  run('_lpValueFactCache')['6190'] = { inv: { units: [{ stock: 'P0001', stockNum: 'P0001', vin: 'TESTVINP0001', vehicle: '2024 GMC Sierra 1500 AT4', year: 2024, make: 'GMC', model: 'Sierra 1500 AT4',
    condition: 'used', certified: false, class: 'Truck', body: 'Crew Cab', color: 'Summit White', odometer: 20000, daysOnLot: 10, price: 58067 }] }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true };
  const viaPanel = (lsd) => quiet(() => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(lsd);
    return sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: run('leadContext') })); });

  console.log(' 1. the text rewrite (lead 2103538959, log350):');
  const rp = (x) => String(quiet(() => run('_lpBuildSmsRefinePrompt')(PASS1, EMAIL, LEAD(x))));
  const r = rp({ calls: true });
  check('WRITE THE TEXT is the follow-up: "trying to reach them" right after their name; no "lead on what earns a reply", no "reason this visit is worth making"',
    () => [/━━━ WRITE THE TEXT ━━━\nThis text is the follow-up to our calls\. Right after their name, say we have been trying to reach them/.test(r),
      /Lead on the thing in that email that earns a reply/.test(r), /the actual reason this visit is worth making/.test(r)], [true, false, false]);
  check('the in-stock block does not say "the email says it is here"; the pitch block puts the follow-up first and lifts the general "reason to come in" rule',
    () => [/the email says it is here/.test(r), /━━━ THE VEHICLE IS STILL OURS ━━━/.test(r), /it is the reason for this text, and it comes first, right after their name/.test(r),
      /The general rule about giving them the reason to come in does not apply to this text/.test(r)], [false, true, true, true]);
  check('the close-out block no longer calls the STOP a reply ("replied 0.9d ago")', () => [/DO NOT OFFER TO CLOSE THIS LEAD OUT/.test(r), /replied 0\.9d ago/.test(r), /never replied, 1d old/.test(r)], [true, false, true]);
  const rNo = rp({ calls: true, reply: 'Is it still available? What is the best price?' });
  check('control: a real reply keeps the usual rewrite (lead on what earns a reply, in stock and in the email)',
    () => [/Lead on the thing in that email that earns a reply/.test(rNo), /the email says it is here/.test(rNo), /This text is the follow-up/.test(rNo)], [true, true, false]);
  const rNc = rp({});
  check('no calls since: no "trying to reach" job, but no pitch either', () => [/Our earlier message already made the case to come in/.test(rNc), /This text is the follow-up to our calls/.test(rNc)], [true, false]);

  console.log(' 2. a rewrite that buries "trying to reach you" does not ship (worker stubbed):');
  const refine = async (reply, x, p1) => { const logs = []; sb.__reply = reply; sb.__d = LEAD(x);
    run('window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Test Kia" };'
      + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpActiveProhibitions = [];'
      + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
      + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
      + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };');
    const ol = sb.console.log; sb.console.log = (...a) => logs.push(a.join(' '));
    let out; try { out = await run('_lpRefineSms(' + JSON.stringify(p1 || PASS1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)'); } catch (e) { out = 'THREW ' + e.message; }
    sb.console.log = ol; return [out === null ? null : 'shipped', logs.some(l => /kept the first pass — it opened on "we have been trying to reach you" and the rewrite did not/.test(l))]; };
  await acheck('log350: the rewrite opened on the truck and moved "tried reaching you" to its third sentence -> the first pass ships, logged', () => refine(BURIED, { calls: true }), [null, true]);
  await acheck('control: a rewrite that keeps it first ships', () => refine(KEPT, { calls: true }), ['shipped', false]);
  await acheck('control: a first pass that asked a STOP customer to "reply here" is not kept over the rewrite',
    () => refine(BURIED, { calls: true }, 'Test, Rep has tried reaching you by phone, so I wanted to make it easy to reply here. Any questions?\nAgent'), ['shipped', false]);

  console.log(' 3. the main prompt:');
  const p = viaPanel(LEAD({ calls: true }));
  check('"trying to reach them" comes first in every format; after a STOP, a call back or an email reply -- never a text',
    () => [/in every format it comes first, right after their name/.test(p), /a call back, or a reply by email \(they turned texts off, so never ask them to reply by text\)/.test(p),
      /a reply to this email/.test(p)], [true, true, false]);
  const vd = (t) => quiet(() => run('_lpApplyVisitDecision')(t));
  const BODY = '- Read the conversation and use judgment. If the customer is engaged and available, close with an appointment. If the customer has signaled they are unavailable, do not force appointment times.\n'
    + 'OPEN THREADS:\n  - Agent committed to do something: "I’ll have the truck ready when you arrive so you can focus on the drive" (10/20/2026 6:48 PM). Check if this commitment was fulfilled in subsequent outbound. If not, address it or honor it before asking for anything new.\n'
    + '  - Agent committed to do something: "I will send the window sticker tonight" (10/20/2026 6:48 PM). Check if this commitment was fulfilled in subsequent outbound. If not, address it or honor it before asking for anything new.';
  const v = vd('OUR PITCH IS ALREADY OUT AND UNANSWERED: on 10/20 our message told them the car is here and offered times.\n' + BODY);
  check('under the pitch rule: no "close with an appointment"; the "ready when you arrive" promise is not reopened; the window-sticker promise still is',
    () => [/close with an appointment\./.test(v.text), /do not close with an appointment ask in this message/.test(v.text), /That promise was part of our pitch and is kept when they come in/.test(v.text),
      /"I will send the window sticker tonight" \([^)]*\)\. Check if this commitment was fulfilled/.test(v.text)], [false, true, true, true]);
  check('control: without the pitch rule both lines stand', () => vd(BODY).text === BODY, true);

  console.log(' 4. the close-out gate: a STOP is not a reply:');
  const co = (x) => { const r = quiet(() => run('_lpCloseOutEligible')(LEAD(x))); return [r.replied, r.reason]; };
  check('the only customer message is a STOP: not replied', () => [co({ calls: true })[0], /^never replied, 1d old/.test(co({ calls: true })[1])], [false, true]);
  check('control: a real reply is still a reply', () => co({ reply: 'What is the best price?' }), [true, 'replied 0.9d ago — under the 30d quiet window']);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
