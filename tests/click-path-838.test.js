#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('click-path-838.test.js');
// (v9.7.838) A LATER INQUIRY IS SOMETHING THEY TOLD US; THE EXTRA VEHICLE IS ADDED, NOT OPTIONAL; THE YES SURVIVES THE REWRITE. Honda
// Lafayette lead 2106212974 on v9.7.837 (log379): the CR-V suggestion was "you may add" and both generations left it out; the second
// generation's rewrite dropped the "yes" ("<name>, yes--we have new Accord Sedans here right now..." -> "<name>, I can send you a few new
// Accord Sedan options..."). Gil: "the additional unit should automatically be added with the right messaging as a suggestion and not
// a spy situation. Now in this case the path shows lead submitted on the CR-V. We can see this .... right??" -- yes: the 10/29 session
// ends "Lead Submitted - <another lead>", so the CR-V is an inquiry he sent, and can be named as one. Executes _lpClickLater,
// _lpClickPathLines and _lpRefineSms. Placeholder data only.
//
// Usage: node tests/click-path-838.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: click-path-838.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
// As on the real page: the 10/29 CR-V session submitted another lead.
const CP = (later, leads) => ({ ok: true, sessions: [
  { date: 'Tuesday, October 27, 2026', leads: ['1'], current: true, pages: [], vehicles: [{ kind: 'model', name: 'New Honda Accord Sedan' }] },
  { date: 'Thursday, October 29, 2026', leads: leads, current: false, pages: [], vehicles: [{ kind: 'model', name: later }] }] });
const U = (v, c, s, cond) => ({ vehicle: v, color: c, stock: s, stockNum: s, condition: cond, type: cond === 'new' ? 'New' : 'Used' });
const LEAD = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '', condition: '',
  dealerId: 'TST1', store: 'Test Store', leadSource: 'Contact Us', convState: 'active-follow-up', leadAgeDays: 2, hasOutbound: true, hasCustomerReply: false,
  totalNoteCount: 6, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: 'still on the lot?', relationshipSignals: { unansweredQuestions: [] },
  history: '', conversationBrief: '' }, x || {});
const CRVS = [U('2026 Honda Accord SE', 'Crystal Black Pearl', 'TEST0A1', 'new')].concat([1, 2, 3, 4, 5].map(i => U('2026 Honda CR-V EX', 'Meteorite Gray Metallic', 'TEST0C' + i, 'new')));

(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const stock = (units) => { run('_lpValueFactCache')['TST1'] = { inv: { units: units }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, ttlMs: 600000 }; };
  const quiet = (g) => { const ol = sb.console.log; const logs = []; sb.console.log = (...a) => logs.push(a.join(' ')); try { return { v: g(), logs }; } finally { sb.console.log = ol; } };
  const lines = (cp) => { const fn = run('_lpClickPathLines'); if (typeof fn !== 'function') return { v: 'no _lpClickPathLines', logs: [] }; return quiet(() => fn(LEAD({ clickPath: cp })).join('\n')); };

  console.log(' 1. the later session submitted a lead: it is their inquiry, named as one:');
  stock(CRVS);
  const a = lines(CP('New Honda CR-V', ['204951716']));
  check('lead 2106212974: "THEY ALSO SENT US AN INQUIRY ABOUT THE CR-V", added (not optional), in the email and the text, with "plenty of those"', () =>
    [/^- THEY ALSO SENT US AN INQUIRY ABOUT THE CR-V \(Thursday, October 29, 2026\): they filled out a form on our site about it, so it is something they told us\./m.test(a.v),
     /ADD one line acknowledging it as their inquiry, in the email and the text -- e\.g\. "and I see you also asked about the CR-V; we have plenty of those here too, so I can line up both\."/.test(a.v)], [true, true]);
  check('never as browsing: they asked or reached out; never looked at, viewed or browsed; never "shifted", "now" or "still"', () =>
    /Say they asked or reached out about it; NEVER say they looked at it, viewed or browsed it, and never "your search has shifted", "now" or "still"\./.test(a.v), true);
  check('the console flags the second inquiry so the agent can look for it in the CRM', () =>
    a.logs.some(l => /\[LP CLICK PATH DIAG\] they sent another inquiry from the store site \(204951716, CR-V, Thursday, October 29, 2026\) -- it may be a second lead in the CRM or on a duplicate customer/.test(l)), true);
  stock([U('2026 Honda Accord SE', 'Crystal Black Pearl', 'TEST0A1', 'new')]);
  check('an inquiry with none in stock is still named -- honestly: "we do not have one in stock right now, but I can check what is coming in"', () =>
    /and I see you also asked about the CR-V; we do not have one in stock right now, but I can check what is coming in\./.test(lines(CP('New Honda CR-V', ['204951716'])).v), true);
  stock([U('2026 Honda Ridgeline RTL', 'Sonic Gray Pearl', 'TEST0R1', 'new')]);
  check('an inquiry is named even when it is not a natural pairing (they told us): an Accord, then a Ridgeline inquiry', () =>
    /THEY ALSO SENT US AN INQUIRY ABOUT THE RIDGELINE/.test(lines(CP('New 2026 Honda Ridgeline', ['204951799'])).v), true);

  console.log(' 2. browsed only: the suggestion is now added, not optional:');
  stock(CRVS);
  const b = lines(CP('New Honda CR-V', []));
  check('a browse-only CR-V visit, in stock -> "ADD ONE line offering the CR-V ... framed as OUR suggestion, in the email and the text"', () =>
    [/ADD ONE line offering the CR-V as something we can show them too \(we have 5 in stock\), framed as OUR suggestion, in the email and the text/.test(b.v), /INQUIRY/.test(b.v)], [true, false]);
  check('control: a browse-only visit that is not a natural pairing still gets only the general line', () => {
    stock([U('2026 Honda Ridgeline RTL', 'Sonic Gray Pearl', 'TEST0R1', 'new')]); const l = lines(CP('New 2026 Honda Ridgeline', [])).v; return [/Ridgeline/.test(l), /THEY MAY BE OPEN TO OTHER OPTIONS/.test(l)]; }, [false, true]);

  console.log(' 3. the text rewrite keeps the yes and the extra vehicle:');
  const SIG = '\nAgent\nTest Store\n(555) 010-0100';
  const EMAIL = 'Hi Test,\n\nYes, we have new Accord Sedans here right now, and I can send you a few to compare. And I see you also asked about the CR-V; we have plenty of those here too, so I can line up both.\n\nAgent Name\nTest Store\n(555) 010-0100';
  const refine = async (d, pass1, reply) => { const logs = []; sb.__reply = reply; sb.__d = d; stock(CRVS);
    run('_lpLastVisitDecision = { level: 0, owner: "" }; window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Test Store" };'
      + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpAddApptLeadId = ""; window._lpActiveProhibitions = [];'
      + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
      + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
      + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };');
    const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...q) => logs.push(q.join(' ')); sb.console.warn = () => {};
    let out; try { out = await run('_lpRefineSms(' + JSON.stringify(pass1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)'); } catch (e) { out = 'THREW ' + e.message; }
    sb.console.log = ol; sb.console.warn = ow;
    return [out === null ? null : 'shipped', (logs.find(l => /kept the first pass — it (?:answered yes|named the CR-V)/.test(l)) || '').replace(/^.*kept the first pass — /, '').replace(/ \|.*$/, '')]; };
  const P1 = 'Test, yes, we have new Accord Sedans here right now. I see you also asked about the CR-V, so I can line up both.' + SIG;
  const D = LEAD({ clickPath: CP('New Honda CR-V', ['204951716']) });
  await acheck('log379: the rewrite drops the "yes" -> the first draft ships', () => refine(D, P1, 'Test, I can send you a few new Accord Sedan options, and I see you also asked about the CR-V.' + SIG), [null, 'it answered yes and the rewrite dropped it']);
  await acheck('the rewrite drops the CR-V inquiry -> the first draft ships', () => refine(D, P1, 'Test, yes, we have new Accord Sedans here right now. Which trim would you like to see?' + SIG), [null, 'it named the CR-V (inquiry) and the rewrite dropped it']);
  await acheck('control: a rewrite that keeps both ships', () => refine(D, P1, 'Test, yes, we have new Accord Sedans here now, and since you also asked about the CR-V, I can line up both.' + SIG), ['shipped', '']);
  await acheck('control: the same dropped yes on a lead with no click path ships (the rule is for click-path leads)', () => refine(LEAD(), P1, 'Test, I can send you a few new Accord Sedan options.' + SIG), ['shipped', '']);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
