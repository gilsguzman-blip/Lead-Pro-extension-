#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('call-wants-804.test.js');
// (v9.7.804) WHAT THEY SAID ON THE CALL IS WHAT THEY WANT. Honda Baytown lead 2097505088 (log329, on 803): a Facebook lead on a
// 2027 CR-V Hybrid TrailSport; the customer never wrote, but the 10/12 connected call's note read "Wife wants a used
// landcruiser, told them about the one at Toyota but they don't want black" and a 10/16 note "In market for Land Cruiser".
// The draft pushed the Ash Green CR-V: the pivot detector reads only the customer's own messages, and the Vehicle line said
// "THIS IS THE VEHICLE FOR THIS LEAD. Do not substitute". Gil, 10/16: offer to set up the visit at the sister store -- the
// salesperson can cross-sell there and go with them. Executes _lpCallWants, _lpCallWantsUnits, populateFromData,
// buildUserPrompt, _lpBuildSmsRefinePrompt and _lpRefineSms (worker stubbed). Placeholder data only.
//
// Usage: node tests/call-wants-804.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: call-wants-804.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const E = (when, tag, title, body) => '[' + when + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = '[10/09/2026 5:16 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const CALL = E('10/12/2026 2:00 PM', 'AGENT', 'Outbound phone call (Contacted)', "By: Rep Name Wife wants a used landcruiser, told them about the one at Toyota but they don't want black");
const NOCONTACT = E('10/16/2026 12:48 PM', 'AGENT', 'Outbound phone call (No Contact)', 'By: Rep Name In market for Land Cruiser');
const TEXT = E('10/09/2026 5:20 PM', 'AGENT', 'Outbound Text Message', 'Test, the 2027 CR-V Hybrid TrailSport is here and showing available.');
const H = (...e) => e.join('') + MARK;
const LEAD = (x) => { const d = Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2027 Honda CR-V Hybrid TrailSport',
  condition: 'New', stockNum: '', vin: '', dealerId: '6191', store: 'Community Honda Baytown', leadSource: 'Facebook', convState: 'active-follow-up', leadAgeDays: 6,
  hasOutbound: true, hasCustomerReply: false, totalNoteCount: 9, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '', relationshipSignals: { unansweredQuestions: [] },
  history: H(NOCONTACT, CALL, TEXT) }, x || {}); if (!('conversationBrief' in (x || {}))) d.conversationBrief = 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + d.history + '---'; return d; };
const LC = (st, y, col, cond, make) => ({ stock: st, stockNum: st, vin: 'TESTVIN' + st, vehicle: y + ' ' + (make || 'Toyota') + ' Land Cruiser', year: y, make: make || 'Toyota', model: 'Land Cruiser',
  condition: cond, certified: false, color: col, price: null });
const SIG = '\nAgent\nCommunity Honda Baytown\n(555) 010-0100';
const EMAIL = 'Hi Test,\n\nI can set up a time for you to see the used Land Cruiser at our sister store, Community Toyota Baytown, and Rep can meet you there.\n\nAgent Name\nCommunity Honda Baytown\n(555) 010-0100';

(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  const fn = (name) => { try { return run(name); } catch (e) { return null; } };
  const cache = run('_lpValueFactCache');
  const feeds = (honda, toyota) => { cache['6191'] = { inv: { units: honda || [] }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true };
    cache['6189'] = { inv: { units: toyota || [] }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true };
    cache['24399'] = { inv: { units: [] }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true }; };
  const TOY = [LC('T1', 2023, 'Midnight Black Metallic', 'used'), LC('T2', 2022, 'Ice Cap', 'used'), LC('T3', 2026, 'Heritage Blue', 'new')];
  feeds([], TOY);
  const prompt = (x) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {};
    try { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); const d = LEAD(x); sb.populateFromData(d); const ctx = run('leadContext');
      return sb.__lp.buildUserPrompt(Object.assign({}, d, { context: ctx })); } finally { sb.console.log = ol; sb.console.warn = ow; } };

  console.log(' 1. what they said on the call (new helper):');
  const cw = fn('_lpCallWants');
  check('lead 2097505088: the 10/12 call -> a used Land Cruiser, not black, backed by the 10/16 note; the lead was the CR-V', () => {
    const r = cw(LEAD()); return r && [r.display, r.condition, r.notColors, r.date, r.support.length, r.leadModel]; }, ['Land Cruiser', 'used', ['black'], '10/12', 1, 'CR-V']);
  check('controls: a no-contact note alone, a call about the CR-V, a car they own, a model they ruled out -> nothing', () => [
    cw(LEAD({ history: H(NOCONTACT, TEXT) })),
    cw(LEAD({ history: H(E('10/12/2026 2:00 PM', 'AGENT', 'Outbound phone call (Contacted)', 'By: Rep Name wants the CR-V in white'), TEXT) })),
    cw(LEAD({ history: H(E('10/12/2026 2:00 PM', 'AGENT', 'Outbound phone call (Contacted)', 'By: Rep Name trading in his Land Cruiser on the CR-V'), TEXT) })),
    cw(LEAD({ history: H(E('10/12/2026 2:00 PM', 'AGENT', 'Outbound phone call (Contacted)', 'By: Rep Name not interested in a Land Cruiser, CR-V only'), TEXT) }))], [null, null, null, null]);
  check('control: they wrote about the CR-V after the call -> back on the CR-V', () =>
    cw(LEAD({ history: H(E('10/13/2026 9:00 AM', 'CUSTOMER', 'Inbound Text Message', 'Is the CR-V still there?'), CALL, TEXT) })), null);

  console.log(' 2. what we have that fits (new helper):');
  const units = fn('_lpCallWantsUnits');
  check('used and not black: the 2022 Ice Cap at Community Toyota Baytown -- not the black one, not the new one', () =>
    units(LEAD(), cw(LEAD())).map(u => [u.store, u.own, u.text]), [['Community Toyota Baytown', false, '2022 Toyota Land Cruiser in Ice Cap']]);
  check('one on our own lot comes first', () => { feeds([LC('H1', 2021, 'Lunar Rock', 'used')], TOY); const r = units(LEAD(), cw(LEAD())).map(u => u.own); feeds([], TOY); return r; }, [true, false]);

  console.log(' 3. the prompt:');
  const p = prompt();
  check('WHAT THEY WANT NOW from the call; the sister store\'s unit named; the visit offered at Community Toyota Baytown, the rep going with them', () =>
    [/^🔁 WHAT THEY WANT NOW -- FROM THE CALL: on 10\/12 the sales rep spoke with them: "Wife wants a used landcruiser, told them about the one at Toyota but they don't want black" \(and 10\/16: "In market for Land Cruiser"\)\. The conversation is about a used Land Cruiser, not black -- not the 2027 Honda CR-V Hybrid TrailSport the lead came in on\. Do NOT push the CR-V/m.test(p),
     /^- At our sister store, Community Toyota Baytown: 2022 Toyota Land Cruiser in Ice Cap\. Name it, and offer to set up a visit at Community Toyota Baytown to see it -- Rep can meet them there and go through it with them\./m.test(p)],
    [true, true]);
  check('the CR-V lock gives way: the Vehicle line points at the call, the inventory note stands the CR-V down', () =>
    [/THIS IS THE VEHICLE FOR THIS LEAD/.test(p), /^Vehicle: {4}2027 Honda CR-V Hybrid TrailSport {2}← what the lead came in on\. On the 10\/12 call they said they want something else/m.test(p),
     /INVENTORY: VEHICLE NOTE: The 2027 Honda CR-V Hybrid TrailSport on the lead is not what they want now/.test(p)], [false, true, true]);
  check('nothing that fits anywhere: say so, do not offer the black one again, ask year range or colour, keep watch here and at the sister store', () => {
    feeds([], [LC('T1', 2023, 'Midnight Black Metallic', 'used')]); const q = prompt(); feeds([], TOY);
    return /^- Neither our lot nor Community Toyota Baytown has a used Land Cruiser that is not black today\. Do not offer the black one again\. Ask what year range or colour they would like, and offer to keep watch for one here and at our sister store, Community Toyota Baytown\./m.test(q); }, true);
  check('control: Honda Lafayette has no sister stores -- no Toyota store is offered, only our own lot', () => {
    const q = prompt({ dealerId: '24399', store: 'Community Honda Lafayette' });
    return [/WHAT THEY WANT NOW/.test(q), /sister store|Community Toyota/.test(q.split('\n').filter(l => /^- (?:Neither|At our)/.test(l)).join('\n'))]; }, [true, false]);
  check('control: no call note -> the CR-V stays the vehicle for this lead', () => /THIS IS THE VEHICLE FOR THIS LEAD/.test(prompt({ history: H(TEXT) })), true);

  console.log(' 4. the text rewrite:');
  check('WHAT THEY WANT NOW is in the rewrite prompt', () => {
    const ol = sb.console.log; sb.console.log = () => {}; try { return /━━━ WHAT THEY WANT NOW ━━━\nOn the 10\/12 call they said they want a used Land Cruiser, not black -- not the 2027 Honda CR-V Hybrid TrailSport the lead came in on\. Keep the text on that; do not bring the CR-V back\./.test(run('_lpBuildSmsRefinePrompt')('Test, pass one.', EMAIL, LEAD())); } finally { sb.console.log = ol; } }, true);
  const refine = async (pass1, reply, x) => { const logs = []; sb.__reply = reply; sb.__d = LEAD(x);
    run('window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Community Honda Baytown" };'
      + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpAddApptLeadId = ""; window._lpActiveProhibitions = [];'
      + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
      + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
      + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };');
    const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...q) => logs.push(q.join(' ')); sb.console.warn = () => {};
    let out; try { out = await run('_lpRefineSms(' + JSON.stringify(pass1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)'); } catch (e) { out = 'THREW ' + e.message; }
    sb.console.log = ol; sb.console.warn = ow;
    return [out === null ? null : 'shipped', logs.some(l => /kept the first pass — the rewrite went back to the CR-V after the call moved them to the Land Cruiser/.test(l))]; };
  const P1 = 'Test, I can set up a time to see the used Land Cruiser at our sister store, Community Toyota Baytown, and Rep can meet you there. Would that help?' + SIG;
  await acheck('a first draft on the Land Cruiser, a rewrite that brings the CR-V back -> the first draft ships', () => refine(P1, 'Test, the CR-V Hybrid TrailSport is here, or I can set up the Land Cruiser at Toyota. Which would you like?' + SIG), [null, true]);
  await acheck('control: a rewrite that stays on the Land Cruiser ships', () => refine(P1, 'Test, want me to set up a look at the Land Cruiser at Community Toyota Baytown? Rep can meet you there.' + SIG), ['shipped', false]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
