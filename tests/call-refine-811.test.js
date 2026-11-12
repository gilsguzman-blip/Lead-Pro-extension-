#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('call-refine-811.test.js');
// (v9.7.811) TOYOTA BAYTOWN LEAD 2103463134, 10/21 (log341): THE TEXT REWRITE THREW AWAY THE CALL. v9.7.810 got the main draft
// right -- "Test, did the photos Rep sent over come through? I'd be glad to walk you through the 2024 Land Cruiser 1958 in person
// this afternoon. Would 4:00 PM work?" -- and the rewrite, never told about the call and told to give "the reason this visit is
// worth making", shipped "Test, I can have the 2024 Land Cruiser 1958 ready for you to see this afternoon. Would 4:00 PM work?",
// the day before's text again. The rewrite is now told about the call and to keep the question; a rewrite that drops a
// question about something we sent does not ship.
// Executes the shipped _lpSentAsk, _lpBuildSmsRefinePrompt and _lpRefineSms (worker stubbed). Placeholder data only.
//
// Usage: node tests/call-refine-811.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: call-refine-811.test.js <popup.js> [popup.js...]'); process.exit(2); }
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
const SIG = '\nAgent\nTest Toyota\n(555) 010-0100';
const PASS1 = 'Test, did the photos Rep sent over come through? I’d be glad to walk you through the 2024 Land Cruiser 1958 in person this afternoon. Would 4:00 PM work?' + SIG;
const EMAIL = 'Subject: Photos of the 2024 Land Cruiser\n\nHi Test,\n\nDid the photos Rep sent over come through? If you’d like a closer look at the 2024 Toyota Land Cruiser 1958, I can have it ready for you to see this afternoon. Would 4:00 PM work?\n\nAgent Name\nTest Toyota\n(555) 010-0100';
const DROPPED = 'Test, I can have the 2024 Land Cruiser 1958 ready for you to see this afternoon. Would 4:00 PM work?' + SIG;
const KEPT = 'Test, did Rep’s photos of the Land Cruiser 1958 come through? Happy to have it ready this afternoon if you want a closer look. Would 4:00 PM work?' + SIG;
const E = (when, tag, title, body) => '[' + when + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = '[10/20/2026 2:36 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const HIST = E('10/20/2026 3:46 PM', 'CALL NOTE', 'Outbound phone call (Contacted)', 'By: Rep Name\n  sent over pics')
  + E('10/20/2026 2:39 PM', 'AGENT', 'Outbound Text Message', 'Test, the black 2024 Land Cruiser you viewed is here and available to see. Would 4:45 or 5:30 work better? Agent') + MARK;
const LEAD = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2024 Toyota Land Cruiser',
  condition: 'Pre-Owned', dealerId: '6189', store: 'Test Toyota', leadSource: 'Internet', convState: 'call-followup', leadAgeDays: 1, hasOutbound: true, hasCustomerReply: false,
  phone: '(555) 010-0199', relationshipSignals: {}, history: HIST, context: '' }, x || {});

(async () => {
for (const f of BUILDS) {
  const src = fs.readFileSync(f, 'utf8');
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (expr) => vm.runInContext(expr, sb);
  const sentAsk = (t) => run("typeof _lpSentAsk === 'function' ? _lpSentAsk : function () { return ''; }")(t);

  console.log(' 1. a question about something we sent (new helper):');
  check('"did the photos Rep sent over come through?", "Did you get the video?", "a chance to look over the numbers", "what you thought of the pictures"',
    () => ['Test, did the photos Rep sent over come through?', 'Did you get the video I sent?', 'Have you had a chance to look over the numbers?', 'Curious what you thought of the pictures.'].map(t => !!sentAsk(t)), [true, true, true, true]);
  check('control: a visit offer, a photo offer, or "did that time work" is not one', () =>
    [DROPPED, 'Want me to send over a few more photos?', 'Did 4:00 PM work for you?', 'The video walkaround is on our website.'].map(t => !!sentAsk(t)), [false, false, false, false]);

  console.log(' 2. the rewrite is told about the call:');
  const rp = (x, p1) => { const ol = sb.console.log; sb.console.log = () => {}; try { return String(run('_lpBuildSmsRefinePrompt')(p1 || PASS1, EMAIL, LEAD(x))); } finally { sb.console.log = ol; } };
  check('log341: the teammate reached them on 10/20, and the question about the photos is the reason for the text -- kept, first, the visit after it',
    () => { const t = rp(); return [/━━━ THE CALL THIS TEXT FOLLOWS ━━━\nRep, your teammate, reached them by phone on 10\/20\./.test(t),
      /The first draft asks about what was sent to them \("Test, did the photos Rep sent over come through\?"\)\. That question is the reason for this text: keep it, right after their name/.test(t),
      /Any visit offer comes after it, never instead of it/.test(t)]; }, [true, true, true]);
  check('control: a first touch is not told about a call; a first draft with no such question is not told to keep one',
    () => [/THE CALL THIS TEXT FOLLOWS/.test(rp({ convState: 'first-touch' })), /That question is the reason for this text/.test(rp({}, DROPPED))], [false, false]);

  console.log(' 3. a rewrite that drops the question does not ship (worker stubbed):');
  const refine = async (reply, x) => { const logs = []; sb.__reply = reply; sb.__d = LEAD(x);
    run('window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Test Toyota" };'
      + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpActiveProhibitions = [];'
      + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
      + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
      + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };');
    const ol = sb.console.log; sb.console.log = (...a) => logs.push(a.join(' '));
    let out; try { out = await run('_lpRefineSms(' + JSON.stringify(PASS1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)'); } catch (e) { out = 'THREW ' + e.message; }
    sb.console.log = ol; return [out === null ? null : 'shipped', logs.some(l => /kept the first pass — it asked about what we sent \("Test, did the photos Rep sent over come through\?"\) and the rewrite dropped it/.test(l))]; };
  await acheck('log341: "I can have the 2024 Land Cruiser 1958 ready for you to see this afternoon" -> the first pass ships, logged', () => refine(DROPPED), [null, true]);
  await acheck('control: a rewrite that keeps the question in its own words ships', () => refine(KEPT), ['shipped', false]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
