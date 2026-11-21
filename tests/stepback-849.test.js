#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('stepback-849.test.js');
// (v9.7.849) THE STEP-BACK, AGREED WITH GIL 11/2. Honda Lafayette lead 2107319795: four days old, the customer said on the phone
// she would let us know when she can come in, and three friendly texts since went unanswered. The draft: "I've reached out a few
// times about the 2024 CR-V LX, so I'll give you some space. Would you like me to check back another time?" Giving room on a pause
// is right; counting our messages and asking whether to keep following up is not -- that belongs to a lead 21+ days old with 5+
// outreaches and no reply, or one where the customer declined. Executes _lpStepBackAllowed, the prompt through the shipped panel
// payload, _lpBuildSmsRefinePrompt, _lpRefineSms and _lpHouseGuard. Placeholder data only.
//
// Usage: node tests/stepback-849.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: stepback-849.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const SIG = '\nAgent\nTest Store\n(555) 010-0100';
const E = (d, time, tag, title, body) => '[' + d + '/2026 ' + time + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const HIST = E('11/01', '1:22 PM', 'AGENT', 'Outbound Text Message', 'Test! How is the search going?')
  + E('10/31', '2:22 PM', 'AGENT', 'Outbound Text Message', 'Test, thank you for talking with me a couple days ago.')
  + E('10/30', '2:22 PM', 'AGENT', 'Outbound Text Message', 'How are you today Test? How is the vehicle shopping going?')
  + '[10/29/2026 2:27 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n'
  + E('10/29', '2:27 PM', 'NOTE', 'General Note', 'By: Rep Name Called on the phone asking about the preowned CR-V, will let me know when she can come in');
const PAUSE = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2024 Honda CR-V LX',
  condition: 'Used', stockNum: 'TEST0H1', dealerId: '24399', store: 'Community Honda Lafayette', leadSource: 'Dealers WebSite', convState: 'pause', hasPauseSignal: true,
  leadAgeDays: 4, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 7, phone: '(555) 010-0199', email: '', lastInboundMsg: '',
  relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 4, totalOutboundCount: 4 }, history: HIST, conversationBrief: 'PAUSE SIGNAL: customer needs more time.\n' + HIST }, x || {});
const OLD = (x) => PAUSE(Object.assign({ convState: 'stalled', hasPauseSignal: false, hasCustomerReply: false, leadAgeDays: 30,
  relationshipSignals: { unansweredQuestions: [], totalOutboundCount: 9 } }, x || {}));
const DRAFT = 'Test, I’ve reached out a few times about the 2024 CR-V LX, so I’ll give you some space. Would you like me to check back another time?' + SIG;

(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };

  console.log(' 1. when the step-back is allowed:');
  const allowed = run('_lpStepBackAllowed');
  check('lead 2107319795 (a pause, 4 days old): not allowed -- giving room is, asking whether to keep following up is not', () => allowed && allowed(PAUSE()), false);
  check('30 days, 9 outreaches, never replied: allowed; a customer who declined: allowed', () => allowed && [allowed(OLD()), allowed(PAUSE({ convState: 'exit', hasExitSignal: true }))], [true, true]);
  check('a never-replied lead 10 days old: not allowed', () => allowed && allowed(OLD({ leadAgeDays: 10 })), false);

  console.log(' 2. the prompt:');
  const built = (lsd) => quiet(() => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(lsd);
    return String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: run('leadContext') }))); });
  const p = built(PAUSE());
  check('the pause block: no counting our messages, no asking whether to check back, one useful line and the door', () =>
    /A respectful message that gives them room and asks nothing is the win here\. Do not point out how many times we have reached out \("I've reached out a few times", "I know I've sent a few messages"\), and do not ask whether to check back later or keep following up: the open door needs no question\./.test(p), true);
  const sys = src.slice(src.indexOf("'ONE-SIDED CONVERSATIONS:"), src.indexOf("\n", src.indexOf("'ONE-SIDED CONVERSATIONS:")));
  check('the system prompt no longer offers "an honest \\"should we step back\\"" to every one-sided lead, and says when it belongs', () =>
    [/should we step back/.test(sys), /Never count or point out our own messages/.test(sys), /belongs only to a lead 21\+ days old with 5\+ outreaches and no reply/.test(sys)], [false, true, true]);

  console.log(' 3. the text rewrite:');
  const P1 = 'Test, no rush at all. The certified CR-V is here whenever you are ready.' + SIG;
  const EMAIL = 'Hi Test,\n\nNo rush at all. The certified 2024 Honda CR-V LX is here whenever you are ready to pick things back up, and I am here to help.\n\nAgent Name';
  check('on a pause the rewrite is told: no question, do not count our messages', () => {
    const r = quiet(() => run('_lpBuildSmsRefinePrompt')(P1, EMAIL, PAUSE({ _lpInvConfirmedAvailable: true })));
    return /They asked for room. Give it: one useful line and an open door, and NO question -- not whether to check back or keep following up/.test(r); }, true);
  const refine = async (lsd, reply) => { const logs = []; sb.__reply = reply; sb.__d = lsd;
    run('_lpLastVisitDecision = { level: 3, owner: "the PAUSE rule (not ready)" }; window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Test Store" };'
      + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpAddApptLeadId = ""; window._lpActiveProhibitions = [];'
      + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
      + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
      + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };');
    const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...q) => logs.push(q.join(' ')); sb.console.warn = () => {};
    let out; try { out = await run('_lpRefineSms(' + JSON.stringify(P1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)'); } finally { sb.console.log = ol; sb.console.warn = ow; }
    return [out === null ? null : 'shipped', logs.some(l => /kept the first pass — the rewrite (?:counted our messages|asked whether to check back)/.test(l))]; };
  await acheck('lead 2107319795: the rewrite that counted our messages and asked to check back -> the first pass ships', () => refine(PAUSE(), DRAFT), [null, true]);
  await acheck('control: the same rewrite on a 30-day, 9-outreach lead ships (that is the step-back point)', async () => (await refine(OLD(), DRAFT))[0], 'shipped');

  console.log(' 4. before render:');
  const guard = (text, ch, lsd) => { run('lastScrapedData = ' + JSON.stringify(lsd) + ';'); const ol = sb.console.log; const logs = []; sb.console.log = (...a) => logs.push(a.join(' '));
    try { return { out: run('_lpHouseGuard')(text, ch), log: logs.join('\n') }; } finally { sb.console.log = ol; } };
  const g = guard(DRAFT, 'sms', PAUSE());
  check('lead 2107319795: -> "Test, I’ll give you some space." (the count and the check-back question go)', () => g.out, 'Test, I’ll give you some space.' + SIG);
  check('the console names both', () => [/our count: "I’ve reached out a few times/.test(g.log), /check-back ask: "Would you like me to check back another time\?"/.test(g.log)], [true, true]);
  check('the email: "I know I’ve sent a few messages since your website inquiry ..., so I’ll give you some space." -> "I’ll give you some space."', () =>
    guard('Hi Test,\n\nI know I’ve sent a few messages since your website inquiry about the 2024 Honda CR-V LX, so I’ll give you some space. Whenever you’re ready, I’m here to help.\n\nAgent Name', 'email', PAUSE()).out,
    'Hi Test,\n\nI’ll give you some space. Whenever you’re ready, I’m here to help.\n\nAgent Name');
  check('control: at the step-back point (30 days, 9 outreaches) the same text is left alone', () => guard(DRAFT, 'sms', OLD()).out === DRAFT, true);
  check('control: "we have been trying to reach you" (Gil, 816) and "Would you like to see it Saturday?" are left alone', () => {
    const a = 'Test, we have been trying to reach you about the CR-V. Would you like to see it Saturday?' + SIG; return guard(a, 'sms', PAUSE()).out === a; }, true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
