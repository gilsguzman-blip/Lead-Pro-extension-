#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('hold-quiet-798.test.js');
// (v9.7.798) THE HOLD POLICY IS FOR WHEN THEY ASK. Honda Baytown lead 2099028490 (log321, on 797): a confirmed in-stock Civic,
// a Saturday visit on the books, and nobody had asked to hold anything -- both drafts still told the customer "It's still
// available to other buyers until sold, so I can't set it aside ahead of your visit". The system prompt's VEHICLE
// AVAILABILITY policy ("we do NOT hold, reserve, or set it aside ... in-stock units stay available first-come until sold")
// was narrated to the customer unprompted. Now: the policy says it is raised only when they ask to hold, reserve or put a
// deposit down; the text rewrite is told to leave it out when the first draft carried it and they never asked; and a
// rewrite that adds it does not ship. Also: [LP DRIVETRAIN CLAIM DIAG] no longer reads "confirm whether the RAV4 LE is AWD"
// as a claim (log320). Executes buildSystemPrompt, _lpBuildSmsRefinePrompt, _lpRefineSms (worker stubbed) and the shipped
// claim reader (lifted). Placeholder data only.
//
// Usage: node tests/hold-quiet-798.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: hold-quiet-798.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const SIG = '\nAgent\nTest Store\n(555) 010-0100';
const EMAIL = 'Hi Test,\n\nThe 2026 Honda Civic Sedan Sport is here, and I have your visit set for Saturday at 10 AM. I will have the car ready for you to see when you arrive.\n\nAgent Name\nTest Store\n(555) 010-0100';
const LEAD = (x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '2026 Honda Civic Sedan Sport', condition: 'New', dealerId: '6191',
  stockNum: 'TEST001A', store: 'Community Honda Baytown', leadSource: 'Dealer Website', convState: 'call-followup', leadAgeDays: 0, hasOutbound: true,
  phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: 'interested in civic sport in white / will be here saturday at 10',
  relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 0.01 }, history: '', context: '' }, x || {});
const P_HOLD = 'Test, the white Civic Sport is here, and I will have it ready Saturday at 10. It is still available to other buyers until sold, so I can\'t set it aside ahead of your visit.' + SIG;
const P_CLEAN = 'Test, the white Civic Sport is here, and I will have it ready for you Saturday at 10. See you then.' + SIG;

(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  const quiet = (fn) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return fn(); } finally { sb.console.log = ol; sb.console.warn = ow; } };

  console.log(' 1. the policy says it is for when they ask:');
  const sys = quiet(() => sb.__lp.buildSystemPrompt(LEAD()));
  check('the VEHICLE AVAILABILITY policy is still there, and now says to raise it only when they ask to hold, reserve or put a deposit down', () =>
    [/we do NOT hold, reserve, or set it aside for a customer/.test(sys),
     /THIS POLICY IS FOR WHEN THEY ASK\. Raise it only if the customer asks to hold, reserve, save or set aside the car, or offers a deposit to keep it\. If they have not asked, do NOT mention holding at all/.test(sys)], [true, true]);

  console.log(' 2. the text rewrite leaves it out unless they asked:');
  const RP = (p1, x) => quiet(() => run('_lpBuildSmsRefinePrompt')(p1, EMAIL, LEAD(x)));
  check('lead 2099028490: the first draft carried "I can\'t set it aside" and they never asked -> NOTHING ABOUT HOLDING THE CAR', () =>
    /━━━ NOTHING ABOUT HOLDING THE CAR ━━━\nThey have not asked to hold or reserve it\./.test(RP(P_HOLD)), true);
  check('control: they asked "can you hold it till Saturday?" -> no such section; a clean first draft -> no section', () =>
    [/NOTHING ABOUT HOLDING/.test(RP(P_HOLD, { lastInboundMsg: 'can you hold it till Saturday?' })), /NOTHING ABOUT HOLDING/.test(RP(P_CLEAN))], [false, false]);

  console.log(' 3. a rewrite that adds it does not ship:');
  const refine = async (pass1, reply, x) => { const logs = []; sb.__reply = reply; sb.__d = LEAD(x);
    run('window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Test Store" };'
      + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpActiveProhibitions = [];'
      + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
      + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
      + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };');
    const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...a) => logs.push(a.join(' ')); sb.console.warn = () => {};
    let out; try { out = await run('_lpRefineSms(' + JSON.stringify(pass1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)'); } catch (e) { out = 'THREW ' + e.message; }
    sb.console.log = ol; sb.console.warn = ow;
    return [out === null ? null : 'shipped', logs.some(l => /kept the first pass — the rewrite raised the hold policy/.test(l))]; };
  const R_HOLD = 'Test, the white Civic Sport is here for Saturday at 10. It\'s still available to other buyers until sold, so I can\'t set it aside.' + SIG;
  await acheck('a clean first draft, a rewrite that adds "available to other buyers until sold" -> the first draft ships', () => refine(P_CLEAN, R_HOLD), [null, true]);
  await acheck('control: they asked to hold it -> the rewrite may answer it, and ships', () => refine(P_CLEAN, R_HOLD, { lastInboundMsg: 'can you hold it for me till Saturday?' }), ['shipped', false]);
  await acheck('control: a rewrite with nothing about holding ships', () => refine(P_CLEAN, 'Test, the white Civic Sport will be ready for you Saturday at 10.' + SIG), ['shipped', false]);

  console.log(' 4. the drivetrain claim reader (log320):');
  const line = src.split('\n').find(l => /var _dvClaim = function \(t\)/.test(l));
  const claim = (t) => { if (!line) return '(no reader)'; const box = { String }; vm.createContext(box); vm.runInContext(line, box); return box._dvClaim(t); };
  check('"I\'ll confirm whether the RAV4 LE is AWD" is not a claim; "the 2026 RAV4 LE is AWD" is', () =>
    [claim('Test, I’ll confirm whether the RAV4 LE is AWD and get back to you.'), claim('Yes, the 2026 RAV4 LE is AWD.')], ['', 'AWD']);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
