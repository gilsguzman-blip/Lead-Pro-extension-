#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('click-path-837.test.js');
// (v9.7.837) A LATER WEBSITE VISIT MAY BE OFFERED AS OUR OWN SUGGESTION -- ONLY A MODEL WE HAVE, A NATURAL PAIRING, AND NEVER AS
// SOMETHING THEY LOOKED AT. Gil, 10/29, on Honda Lafayette lead 2106212974 (asked "still on the lot?" about new Accord Sedans, back on
// 10/29 looking at new CR-Vs): mention the chance he is widening his search without disclosing we saw it. Then: "what if it's a used
// car and he was looking at a Kia K5 and searched for a Toyota Camry?" -- and "yes add all three": (1) only a model we have, in the
// condition they shop; (2) used may cross brands within the same type; (3) new stays with the brand. A rewrite that says we saw their
// browsing does not ship. Executes _lpClickPathLines, buildUserPrompt through populateFromData and _lpRefineSms. Placeholder data only.
//
// Usage: node tests/click-path-837.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: click-path-837.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const CP = (asked, later) => ({ ok: true, sessions: [
  { date: 'Tuesday, October 27, 2026', leads: ['1'], current: true, pages: [], vehicles: [{ kind: 'model', name: asked }] },
  { date: 'Thursday, October 29, 2026', leads: ['2'], current: false, pages: [], vehicles: [{ kind: 'model', name: later }] }] });
const U = (v, c, s, cond) => ({ vehicle: v, color: c, stock: s, stockNum: s, condition: cond, type: cond === 'new' ? 'New' : 'Used' });
const LEAD = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '', condition: '',
  dealerId: 'TST1', store: 'Test Store', leadSource: 'Contact Us', convState: 'active-follow-up', leadAgeDays: 2, hasOutbound: true, hasCustomerReply: false,
  totalNoteCount: 6, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: 'still on the lot?', relationshipSignals: { unansweredQuestions: [] },
  history: '', conversationBrief: '' }, x || {});

(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const stock = (units) => { run('_lpValueFactCache')['TST1'] = { inv: { units: units }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, ttlMs: 600000 }; };
  const lines = (cp) => { const fn = run('_lpClickPathLines'); if (typeof fn !== 'function') return 'no _lpClickPathLines'; const ol = sb.console.log; sb.console.log = () => {};
    try { return fn(LEAD({ clickPath: cp })).join('\n'); } finally { sb.console.log = ol; } };

  console.log(' 1. lead 2106212974: new Accord Sedan, then new CR-V (same brand, neighboring type):');
  stock([U('2026 Honda Accord SE', 'Crystal Black Pearl', 'TEST0A1', 'new'), U('2026 Honda CR-V EX', 'Meteorite Gray Metallic', 'TEST0C1', 'new'), U('2026 Honda CR-V Sport', 'Radiant Red Metallic', 'TEST0C2', 'new')]);
  const a = lines(CP('New Honda Accord Sedan', 'New Honda CR-V'));
  check('the CR-V is offered as OUR suggestion, once, after the answer, with how many we have', () =>
    [/^- THEY MAY BE OPEN TO ANOTHER MODEL\. After you answer their question, you may add ONE line offering the CR-V as something we can show them too \(we have 2 in stock\), framed as OUR suggestion/m.test(a),
     /"if you are also weighing an SUV, a lot of Accord shoppers compare it with the CR-V, so I can line up both\."/.test(a)], [true, true]);
  check('and never as something they looked at', () => /NEVER say or imply they looked at it or that we can see what they browsed, and never "has your search shifted", "now" or "still"/.test(a), true);
  stock([U('2026 Honda Accord SE', 'Crystal Black Pearl', 'TEST0A1', 'new')]);
  check('(1) no CR-V in stock -> no suggestion; the general "other options" line, no model named', () => {
    const l = lines(CP('New Honda Accord Sedan', 'New Honda CR-V')); return [/CR-V/.test(l), /^- THEY MAY BE OPEN TO OTHER OPTIONS\./m.test(l)]; }, [false, true]);
  stock([U('2026 Honda Ridgeline RTL', 'Sonic Gray Pearl', 'TEST0R1', 'new')]);
  check('not a natural pairing (Accord -> Ridgeline), even in stock -> the general line, no model named', () => {
    const l = lines(CP('New Honda Accord Sedan', 'New 2026 Honda Ridgeline')); return [/Ridgeline/.test(l), /THEY MAY BE OPEN TO OTHER OPTIONS/.test(l)]; }, [false, true]);

  console.log(' 2. Gil\'s case: a used K5, then a used Camry (another brand, same type):');
  stock([U('2023 Kia K5 LXS', 'Ebony Black', 'TEST0K1', 'used'), U('2022 Toyota Camry SE', 'Celestial Silver Metallic', 'TEST0T1', 'used'), U('2021 Toyota Camry LE', 'Super White', 'TEST0T2', 'used')]);
  const k = lines(CP('Used Kia K5', 'Used Toyota Camry'));
  check('(2) used crosses brands within the type: the used Camry is suggested, "a lot of K5 shoppers also look at the Camry", 2 in stock', () =>
    [/offering the used Camry as something we can show them too \(we have 2 in stock\)/.test(k), /"if you are open to comparing, a lot of K5 shoppers also look at the Camry, and we have a few here\."/.test(k)], [true, true]);
  check('control: a used K5, then a used Tundra (not the same type) -> no Tundra named', () => {
    stock([U('2023 Kia K5 LXS', 'Ebony Black', 'TEST0K1', 'used'), U('2021 Toyota Tundra SR5', 'Magnetic Gray', 'TEST0T3', 'used')]);
    return /Tundra/.test(lines(CP('Used Kia K5', 'Used Toyota Tundra'))); }, false);
  check('(3) new stays with the brand: a new K5, then a new Camry -> no Camry named', () => {
    stock([U('2026 Kia K5 GT-Line', 'Wolf Gray', 'TEST0K2', 'new'), U('2026 Toyota Camry SE', 'Ice Cap', 'TEST0T4', 'new')]);
    return /Camry/.test(lines(CP('New Kia K5', 'New Toyota Camry'))); }, false);
  check('the stock check reads the condition: a used Camry search and only NEW Camrys in stock -> no suggestion', () => {
    stock([U('2023 Kia K5 LXS', 'Ebony Black', 'TEST0K1', 'used'), U('2026 Toyota Camry SE', 'Ice Cap', 'TEST0T4', 'new')]);
    return /Camry/.test(lines(CP('Used Kia K5', 'Used Toyota Camry'))); }, false);

  console.log(' 3. the text rewrite never says we saw their browsing:');
  const SIG = '\nAgent\nTest Store\n(555) 010-0100';
  const EMAIL = 'Hi Test,\n\nYes, we have new Accord Sedans here right now, and I can send you a few to look at. If you are also weighing an SUV, a lot of Accord shoppers compare it with the CR-V, so I can line up both.\n\nAgent Name\nTest Store\n(555) 010-0100';
  const refine = async (d, pass1, reply) => { const logs = []; sb.__reply = reply; sb.__d = d;
    run('_lpLastVisitDecision = { level: 0, owner: "" }; window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Test Store" };'
      + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpAddApptLeadId = ""; window._lpActiveProhibitions = [];'
      + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
      + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
      + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };');
    const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...q) => logs.push(q.join(' ')); sb.console.warn = () => {};
    let out; try { out = await run('_lpRefineSms(' + JSON.stringify(pass1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)'); } catch (e) { out = 'THREW ' + e.message; }
    sb.console.log = ol; sb.console.warn = ow;
    return [out === null ? null : 'shipped', logs.some(l => /kept the first pass — the rewrite said we saw their browsing/.test(l))]; };
  const P1 = 'Test, yes, we have new Accord Sedans here right now. Want me to send a few? A lot of Accord shoppers also compare the CR-V, so I can line up both.' + SIG;
  const BAD = 'Test, yes, we have new Accord Sedans here right now. If your search has shifted to the CR-V, I can line up both.' + SIG;
  await acheck('lead 2106212974: a rewrite with "If your search has shifted to the CR-V" on a click-path lead -> the first draft ships', () => refine(LEAD({ clickPath: CP('New Honda Accord Sedan', 'New Honda CR-V') }), P1, BAD), [null, true]);
  await acheck('control: the same rewrite on a lead with no click path ships (no browsing on record to reveal)', () => refine(LEAD(), P1, BAD), ['shipped', false]);
  await acheck('control: a rewrite that offers the CR-V as our suggestion ships', () => refine(LEAD({ clickPath: CP('New Honda Accord Sedan', 'New Honda CR-V') }), P1,
    'Test, yes, we have new Accord Sedans here right now. If you are also weighing an SUV, a lot of Accord shoppers compare it with the CR-V.' + SIG), ['shipped', false]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
