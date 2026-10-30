#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('pitch-context-820.test.js');
// (v9.7.820) THE PITCH RULE'S REWRITE STRIPPED THE TEXT TO A BARE QUESTION. Honda Baytown lead 2079723069 (log355, v9.7.819): the first
// draft read "[Customer], it's been quiet since the team reached out about your Yukon appraisal. How would you prefer we handle future
// contact: text, email, or not at all?"; the rewrite shipped "[Customer], would you prefer we contact you by text, email, or not at all?"
// Gil: "First text was too short, chip helped on second pass." The v9.7.817 instruction "no restating the car or its details" cost the
// context, and that branch had dropped "do not strip it to a receipt". Now the pitch rule forbids re-sending the pitch, not naming what
// we reached out about; the rewrite keeps where things stand; and a rewrite cut down to the first draft's question alone does not ship.
// Executes the shipped _lpBuildSmsRefinePrompt and _lpRefineSms (worker stubbed). Placeholder data only.
//
// Usage: node tests/pitch-context-820.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: pitch-context-820.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const H = 3600000, NOW = Date.now();
const fmt = (ms) => { const f = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  .formatToParts(new Date(ms)).reduce((o, p) => (o[p.type] = p.value, o), {}); return f.month + '/' + f.day + '/' + f.year + ' ' + f.hour + ':' + f.minute + ' ' + f.dayPeriod.toUpperCase(); };
const E = (ms, tag, title, body) => '[' + fmt(ms) + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (ms) => '[' + fmt(ms) + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const T0 = NOW - 30 * H;
const PITCH = 'Test, your appraisal is ready to go. Would 9:15 AM or 10:30 AM Thursday work better? Agent';
const HIST = (o) => (o.reply ? E(T0 + 3 * H, 'CUSTOMER', 'Inbound Text Message', o.reply) : '') + E(T0, 'AGENT', 'Outbound Text Message', 'By: Agent Name\n  ' + PITCH) + MARK(T0 - 60000);
const LEAD = (o) => { o = o || {}; const h = HIST(o); return { autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '',
  dealerId: '6191', store: 'Test Honda', leadSource: 'Internet', convState: 'active-follow-up', leadAgeDays: 45, hasOutbound: true, hasCustomerReply: !!o.reply, totalNoteCount: 20,
  phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: o.reply || '', relationshipSignals: { unansweredQuestions: [] }, history: h,
  conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + h + '---', outboundSends: [{ title: 'outbound text message', ms: T0, body: PITCH }] }; };
const PASS1 = 'Test, it\'s been quiet since the team reached out about your trade appraisal. How would you prefer we handle future contact: text, email, or not at all?\nAgent\nTest Honda\n(555) 010-0100';
const EMAIL = 'Subject: How would you prefer we reach you?\n\nTest,\n\nIt\'s been quiet since the team reached out about your trade. How would you prefer we handle future contact: text, email, or not at all?\n\nAgent Name';
const BARE = 'Test, would you prefer we contact you by text, email, or not at all?\nAgent';
const KEPT = 'Test, it has been quiet since we reached out about your trade appraisal. Text, email, or not at all -- what works best?\nAgent';

(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };

  console.log(' 1. the pitch rule\'s rewrite keeps the context:');
  const rp = String(quiet(() => sb._lpBuildSmsRefinePrompt(PASS1, EMAIL, LEAD())));
  check('log355: no "no restating the car or its details"; the pitch is what is not re-sent, and naming what we reached out about is fine',
    [/no restating the car or its details/.test(rp), /do not re-send it \(that it is here, a time, a reason to come in\) and make no visit ask\. Naming what we reached out about -- the car, their trade, the appraisal -- is fine\./.test(rp)], [false, true]);
  check('...and it keeps where things stand, not stripped to a bare question',
    /Keep what the first draft says about where things stand -- who reached out, and about what\. LENGTH IS YOURS TO JUDGE: do not pad it, and do not strip it to a bare question/.test(rp), true);

  console.log(' 2. a rewrite cut down to the question does not ship (worker stubbed):');
  const refine = async (reply, lead) => { const logs = []; sb.__reply = reply; sb.__d = lead;
    run('window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Test Honda" };'
      + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpActiveProhibitions = [];'
      + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
      + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
      + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };');
    const ol = sb.console.log; sb.console.log = (...x) => logs.push(x.join(' '));
    let out; try { out = await run('_lpRefineSms(' + JSON.stringify(PASS1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)'); } catch (e) { out = 'THREW ' + e.message; }
    sb.console.log = ol; return [out === null ? null : 'shipped', logs.some(l => /kept the first pass — (?:under the pitch rule )?the rewrite cut it to a bare question/.test(l))]; };
  check('log355: "[Customer], would you prefer we contact you by text, email, or not at all?" -> the first pass ships, logged', await refine(BARE, LEAD()), [null, true]);
  check('control: a rewrite that keeps where things stand ships', await refine(KEPT, LEAD()), ['shipped', false]);
  // (v9.7.821) the catch now holds on every lead, so the old "no pitch rule" control is the same verdict (see bare-question-821)
  check('(v9.7.821) no pitch rule (they replied) -> the bare-question catch holds there too', await refine(BARE, LEAD({ reply: 'What would you give me for it?' })), [null, true]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
