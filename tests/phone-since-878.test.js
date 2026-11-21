#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('phone-since-878.test.js');
// (v9.7.878) THE EXTENSION HALF OF PROXY v7.93 (owner, 11/17: "go with C, build the proxy batch"):
//  PF-6  the panel removes a sentence asking for a phone number we already have, at render; the draft request says so.
//  PF-2  step 2: the store prefetch sends since=<version>; an {unchanged:true} answer keeps the feed in hand and counts as this
//        grab's inventory arriving (the audit's regression risk); an older proxy's full answer is read as before.
// Executes _lpPhoneAskGuard and _lpPrefetchValueFacts (fetch stubbed). Placeholder data only.
//
// Usage: node tests/phone-since-878.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: phone-since-878.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const ON = 'VEHICLE/LEAD DETAILS:\nCustomer Phone: (555) 010-0199  ← already on file. Do NOT ask for a phone number.\n';
const OFF = 'VEHICLE/LEAD DETAILS:\nCustomer Phone: (no phone on file)  ← genuinely missing. Asking for a phone number IS appropriate.\n';

(async function () {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const quiet = (g) => { const ol = sb.console.log; sb.console.log = () => {}; try { return g(); } finally { sb.console.log = ol; } };
  const guard = vm.runInContext('typeof _lpPhoneAskGuard === "function" ? _lpPhoneAskGuard : null', sb) || ((t) => t);   // absent before 878
  const G = (t, p) => quiet(() => guard(t, 'sms', p));

  console.log(' PF-6: a phone ask is removed when the phone is on file:');
  check('"What\'s the best number to reach you?" -> removed, the rest kept',
    () => G('Test, the Accord SE is here and ready to see. What\'s the best number to reach you?', ON), 'Test, the Accord SE is here and ready to see.');
  check('"I don\'t have a number for you yet -- just send the best one to use." -> both sentences out',
    () => G('Test, I have the trade numbers ready. I don\'t have a number for you yet. Just send the best one to use.', ON), 'Test, I have the trade numbers ready.');
  check('an email paragraph: "Could you send me your cell number?" -> removed, the paragraph and sign-off kept',
    () => quiet(() => guard('Hi Test,\n\nThe Accord is here. Could you send me your cell number? I will have it ready.\n\nAgent Name', 'email', ON)), 'Hi Test,\n\nThe Accord is here. I will have it ready.\n\nAgent Name');
  check('"Is this still the best number to reach you?" (a confirm ask) -> removed',
    () => G('Test, I can have it ready Saturday. Is this still the best number to reach you?', ON), 'Test, I can have it ready Saturday.');
  console.log(' ...and nothing else is touched:');
  check('control: no phone on file -> the ask stays (asking is right then)',
    () => G('Test, the Accord SE is here. What\'s the best number to reach you?', OFF), 'Test, the Accord SE is here. What\'s the best number to reach you?');
  check('control: price talk -- "send me the numbers", "what number works for your budget" -- stays',
    () => G('Test, I can send you the numbers on the SE tonight. What monthly number works for your budget?', ON), 'Test, I can send you the numbers on the SE tonight. What monthly number works for your budget?');
  check('control: "call me at" our own number, and "what\'s the best one for you, the EX or the EX-L?" -- stay',
    () => G('Test, call me at (555) 010-0100 anytime. What\'s the best one for you, the EX or the EX-L?', ON), 'Test, call me at (555) 010-0100 anytime. What\'s the best one for you, the EX or the EX-L?');
  check('control: a message that is only the ask is kept as written (never an empty draft)',
    () => G('What\'s the best number to reach you?', ON), 'What\'s the best number to reach you?');
  check('the render chain runs it on the text and the email, inside the spelling pass',
    () => [src.indexOf("_lpAmericanSpelling(_lpPhoneAskGuard(cleanOutput(rawSms, true), 'sms'))") > 0, src.indexOf("_lpAmericanSpelling(_lpPhoneAskGuard(cleanOutput(rawEmail, false), 'email'))") > 0], [true, true]);
  check('the draft request tells the proxy the panel checks (phoneAskCheck: "render")', () => /contents: \[\{ role:'user', parts:\[\{ text: userPrompt \}\] \}\],\n\s+phoneAskCheck: 'render',/.test(src), true);

  console.log(' PF-2 step 2: since= on the store prefetch:');
  const urls = []; let answer = null;
  sb.__fetch = (u) => { urls.push(String(u)); const a = answer(String(u)); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(a) }); };
  vm.runInContext('fetch = function (u, o) { return globalThis.__fetch(u, o); }; window._leadProWorkerBase = "https://p.test"; _lpValueFactCache = {};', sb);
  const pf = vm.runInContext('_lpPrefetchValueFacts', sb), cache = () => vm.runInContext('_lpValueFactCache["6191"]', sb);
  const settle = () => new Promise(r => setTimeout(r, 20));
  answer = (u) => /inventory/.test(u) ? { ok: true, version: 'abc123-1', inventory: { store: 'S', count: 1, units: [{ stock: 'TEST001A' }] } } : { ok: true, version: 'vf9-1', valuefact: { store: 'S', count: 0, incentives: [] } };
  quiet(() => pf('6191', 0)); await settle();
  await acheck('the first fetch sends no since= and keeps the versions it is given', () => [urls.every(u => !/since=/.test(u)), cache().invVer, cache().vfVer], [true, 'abc123-1', 'vf9-1']);
  urls.length = 0;
  answer = () => ({ ok: true, unchanged: true, version: 'x' });
  vm.runInContext('window._lpGrabStartedAt = Date.now();', sb);
  quiet(() => pf('6191', 0)); await settle();
  await acheck('a grab sends since=<version> on both feeds', () => [urls.some(u => /\/inventory\?dealer=6191&since=abc123-1$/.test(u)), urls.some(u => /\/valuefact\?dealer=6191&since=vf9-1$/.test(u))], [true, true]);
  await acheck('{unchanged:true} keeps the units in hand, and they count as this grab\'s inventory (not "behind the grab")',
    () => [(cache().inv.units || []).length, vm.runInContext('_lpInvBehindGrab("6191")', sb), vm.runInContext('_lpInvFreshness("6191").fresh', sb)], [1, false, true]);
  answer = (u) => /inventory/.test(u) ? { ok: true, inventory: { store: 'S', count: 2, units: [{ stock: 'TEST001A' }, { stock: 'TEST002B' }] } } : { ok: true, valuefact: null };
  quiet(() => pf('6191', 0)); await settle();
  await acheck('control: an older proxy\'s full answer (no version) is read as before, and since= is dropped next time', () => [(cache().inv.units || []).length, cache().invVer || ''], [2, '']);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
