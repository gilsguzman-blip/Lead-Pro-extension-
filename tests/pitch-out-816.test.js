#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('pitch-out-816.test.js');
// (v9.7.816) OUR PITCH WENT UNANSWERED, AND THREE BLOCKS STILL ORDERED IT AGAIN. Kia Baytown lead 2103538959 (log349, v9.7.815): our
// 10/20 text, email and voicemail said the truck was here, 9:15 or 10:30; the customer's only reply was "Stop"; the salesperson
// called twice the next morning and left voicemails. The don't-restate block fired -- and the same prompt said "Say 'we have it
// here'", "REQUIRED in EVERY format: one specific reason the visit is worth their time ... pre-fill most of the paperwork",
// "Confirm it is available and encourage the soonest workable time", and offered 9:15 / 10:30 with a scripted text; its facts said
// "Last customer reply was 0.9 days ago ... the customer replied today". The draft re-pitched. Gil: "Message should be a follow up
// we've been trying to reach you." Now: one rule (the PITCH ALREADY OUT hold, through the visit decision) takes the pitch out
// everywhere; unanswered calls since our last text or email make the message "we have been trying to reach you"; the facts count
// a STOP as no reply. A message of ours that offered no times does not withhold times.
// Builds prompts through the shipped populateFromData and panel payload (the visit decision runs on the finished prompt), executes
// the shipped _lpBuildSmsRefinePrompt, and lifts the shipped arc-facts step from the generation. Placeholder data only.
//
// Usage: node tests/pitch-out-816.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: pitch-out-816.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
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
const PITCH_NO_TIMES = 'Test, the Summit White 2024 GMC Sierra 1500 AT4 is here and ready for you to see. Agent';
const CONFIRM = 'You have successfully been removed from Test Auto Group text messages.';
const HIST = (o) => (o.calls ? E(T0 + 14 * H + 4 * 60000, 'AGENT', 'Outbound phone call (Machine)', 'By: Rep Name\n  Left message') + E(T0 + 14 * H, 'AGENT', 'Outbound phone call (Machine)', 'By: Rep Name\n  Left message') : '')
  + E(T0 + 3 * 60000, 'AGENT', 'Outbound Text Message', CONFIRM) + E(T0 + 2 * 60000, 'CUSTOMER', 'Inbound Text Message', o.reply || 'Stop')
  + E(T0, 'AGENT', 'Outbound Text Message', 'By: Agent Name\n  ' + (o.pitch || PITCH)) + MARK(T0 - 60000);
const LEAD = (o) => { o = o || {}; const h = HIST(o); return Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name',
  vehicle: '2024 GMC Sierra 1500 AT4', condition: 'Pre-Owned', stockNum: 'P0001', _lpInvConfirmedAvailable: true, dealerId: '6190', store: 'Test Kia', leadSource: 'Internet',
  convState: 'active-follow-up', leadAgeDays: 1, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 12, phone: '(555) 010-0199', email: 'test@example.com',
  customerZip: '00000', relationshipSignals: { unansweredQuestions: [] },
  lastInboundMsg: o.reply || 'Stop', lastSubstantiveOutboundMsg: o.pitch || PITCH, history: h, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + h + '---',
  outboundSends: [{ title: 'outbound text message', ms: T0, body: o.pitch || PITCH }] }, o.x || {}); };

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

  console.log(' 1. lead 2103538959: our pitch with times, unanswered, then two calls:');
  const p = viaPanel(LEAD({ calls: true }));
  check('the PITCH ALREADY OUT rule owns the visit: no suggested times, no scripted next-day text', () => [/VISIT DECISION FOR THIS MESSAGE: no specific appointment times[^\n]*the PITCH ALREADY OUT rule/.test(p),
    /SUGGESTED APPOINTMENT TIMES/.test(p), /TIMING — NEXT-DAY/.test(p)], [true, false, false]);
  check('...and the pitch is gone everywhere: no "say we have it here", no required visit reason or paperwork script, no "confirm it is available"',
    () => [/Say "we have it here"/.test(p), /Our earlier message already told them it is here; do not say it again/.test(p), /REQUIRED in EVERY format: One specific reason/.test(p),
      /pre-fill most of the paperwork/.test(p), /Confirm it is available and encourage the soonest workable time/.test(p)], [false, true, false, false, false]);
  check('"WE HAVE BEEN TRYING TO REACH THEM": Rep, their salesperson, called 2 times and left voicemails -- say so warmly, one easy way to reply, one simple question',
    () => [/WE HAVE BEEN TRYING TO REACH THEM: since our last text or email, Rep, their salesperson, called 2 times \([^)]*\) and left voicemails, with no answer/.test(p),
      /say warmly and plainly that we have been trying to reach them \(you may say Rep has been trying to reach them by phone\)/.test(p)], [true, true]);
  const rf = String(quiet(() => sb._lpBuildSmsRefinePrompt('Test, Rep and I have been trying to reach you about the Sierra AT4. Is a quick call or email easier?', 'Subject: Sierra\n\nTest,\n\nWe have been trying to reach you.\n\nAgent Name', LEAD({ calls: true }))));
  check('the text rewrite: no "here", no time, no reason to come in put back; "trying to reach you" is the reason for the text',
    () => [/━━━ OUR PITCH IS ALREADY OUT ━━━/.test(rf), /if the first draft says we have been trying to reach them, keep that/.test(rf)], [true, true]);

  console.log(' 2. controls:');
  const pNoCalls = viaPanel(LEAD({}));
  check('no calls since: the pitch rule, but no "trying to reach them"', () => [/OUR PITCH IS ALREADY OUT AND UNANSWERED/.test(pNoCalls), /WE HAVE BEEN TRYING TO REACH THEM/.test(pNoCalls)], [true, false]);
  const pNoTimes = viaPanel(LEAD({ pitch: PITCH_NO_TIMES }));
  check('our message offered no times: no re-pitch, but times are not withheld', () => [/^OUR PITCH IS ALREADY OUT: /m.test(pNoTimes), /VISIT DECISION FOR THIS MESSAGE/.test(pNoTimes),
    /Say "we have it here"/.test(pNoTimes)], [true, false, false]);
  check('a real reply after our pitch: no pitch rule', () => /OUR PITCH IS ALREADY OUT/.test(viaPanel(LEAD({ reply: 'Is it still available? What is the best price?' }))), false);

  console.log(' 3. the facts: a STOP is not a dated reply:');
  const a = src.indexOf('      var _arcStopOnly = false'), b = src.indexOf('      _lpCadenceDiag(_cad);', a);
  const SIG = { unansweredQuestions: [], lastInboundAgeDays: 0.9, totalInboundCount: 11, totalOutboundCount: 16, consecutiveOutboundNoReply: 3 };
  const arc = (lsd) => { if (a < 0 || b < 0) return '(no arc step)'; lsd.relationshipSignals = SIG; sb.__lsd = lsd; return quiet(() => run('(function (lastScrapedData, userPrompt) {\n' + src.slice(a, b) + '\n return _lpRenderArcState(_arc); })(globalThis.__lsd, "")')); };
  const facts = arc(LEAD({ calls: true }));
  check('no "Last customer reply was 0.9 days ago", no whole-record "11 inbound"; the outbound run on this lead, and no dated reply on file',
    () => [/Last customer reply was/.test(facts), /Exchange so far: 11 inbound/.test(facts), /outbound in a row with no answer\. No dated customer reply is on file for this lead/.test(facts)], [false, false, true]);
  check('control: a real reply still reads as one', () => /Last customer reply was 0\.9 days ago/.test(arc(LEAD({ reply: 'What is the best price?' }))), true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
