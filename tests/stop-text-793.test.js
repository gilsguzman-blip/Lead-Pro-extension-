#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('stop-text-793.test.js');
// (v9.7.793) log312, lead 2098953366 on 792. (1) The customer texted STOP; the first-pass text was right ("I'll respect that and
// leave the door open if your plans change.") but the rewrite shipped "If your plans change and you'd like help finding a vehicle,
// just text me." -- an invitation to text after an opt-out. Now the rewrite prompt carries THEY TEXTED STOP, and a rewrite that
// invites texting (when the first pass did not) does not ship: the first pass does. (2) 791's _lpThreadEntries joined every line
// after an entry's header into its body, so the state label printed after the last note ("FOLLOW-UP TO A PHONE CALL: ...") was
// read as part of the call note; a label like "no longer interested" could have set off a false call-note pause. The body is now
// the entry's own indented lines only. Executes the shipped helpers and _lpRefineSms (worker stubbed). Placeholder data only.
//
// Usage: node tests/stop-text-793.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: stop-text-793.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const E = (when, tag, title, ...body) => '[10/13/2026 ' + when + '] [' + tag + '] ' + title + '\n' + body.map(l => '  ' + l).join('\n');
const MARK = '[10/13/2026 10:45 AM] [=== CURRENT LEAD SUBMITTED HERE ===]';
const H = (...ents) => ents.reverse().join('\n') + '\n' + MARK + '\n';
const CALL = E('10:57 AM', 'CALL NOTE', 'Outbound phone call (Contacted)', 'By: Agent Name', "she said she isn't looking for a vehicle at this moment");
const STOP = E('11:21 AM', 'CUSTOMER', 'Inbound Text Message', 'Stop');
const LABEL = '\nFOLLOW-UP TO A PHONE CALL: we already spoke with this customer by phone (see the call note).';
const LEAD = (hist, x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '2026 Honda Pilot Black Edition', condition: 'New',
  dealerId: '24399', store: 'Community Honda Lafayette', leadSource: 'Thirdparty Honda -', convState: 'call-followup', leadAgeDays: 0, hasOutbound: true,
  phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: 'Stop', relationshipSignals: { unansweredQuestions: [] }, context: hist, history: hist }, x || {});
const SIG = '\nAgent Name\nCommunity Honda Lafayette\n(555) 010-0100';
const PASS1 = "Test, understood. I'll respect that and leave the door open if your plans change." + SIG;
const EMAIL = 'Test,\n\nThanks for taking my call today. I understand you are not looking right now.\n\nAgent Name';

(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const quiet = (fn) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return fn(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const TE = vm.runInContext('_lpThreadEntries', sb), HOLD = vm.runInContext('_lpCustomerStateHold', sb);

  console.log(' 1. a thread entry is its own indented lines (log312 read the state label into the call note):');
  check('the call note followed by a blank line and the state label reads as the note alone', () =>
    TE(CALL + '\n' + LABEL + '\n' + MARK + '\n').map(x => x.body), ["she said she isn't looking for a vehicle at this moment"]);
  const KEEP = E('10:57 AM', 'CALL NOTE', 'Outbound phone call (Contacted)', 'By: Agent Name', 'she will come by Saturday to look at the Pilot');
  check('an exit label after a harmless call note is not a call-note pause (791 read "no longer interested" off the label)', () =>
    quiet(() => HOLD(LEAD(KEEP + '\n\nEXIT SIGNAL: the customer is no longer interested\n' + MARK + '\n'))), null);
  check('control: a two-line note is read whole', () =>
    TE(E('10:57 AM', 'CALL NOTE', 'Outbound phone call (Contacted)', 'By: Agent Name', 'she is not', 'looking right now') + '\n' + MARK + '\n').map(x => x.body), ['she is not looking right now']);
  check('control: the real "not looking" call note still owns the pause', () => (quiet(() => HOLD(LEAD(H(CALL, STOP)))) || {}).kind, 'call-pause');

  console.log(' 2. the text rewrite is told they texted STOP:');
  const RP = (d) => quiet(() => vm.runInContext('_lpBuildSmsRefinePrompt', sb)(PASS1, EMAIL, d));
  check('STOP as their newest message -> THEY TEXTED STOP, no invitation to text', () =>
    /━━━ THEY TEXTED STOP ━━━\nTheir newest message opted them out of texts\. Do not invite them to text/.test(RP(LEAD(H(CALL, STOP)))), true);
  const BACK = E('11:40 AM', 'CUSTOMER', 'Inbound Text Message', 'Actually I might look next month');
  check('control: they wrote again after the STOP -> no STOP section', () => /THEY TEXTED STOP/.test(RP(LEAD(H(CALL, STOP, BACK)))), false);

  console.log(' 3. a rewrite that invites them to text after a STOP does not ship:');
  const refine = async (reply, hist) => { const logs = []; sb.__reply = reply; sb.__d = LEAD(hist);
    vm.runInContext('window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Community Honda Lafayette" };'
      + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpActiveProhibitions = [];'
      + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
      + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
      + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };', sb);
    const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...a) => logs.push(a.join(' ')); sb.console.warn = () => {};
    let out; try { out = await vm.runInContext('_lpRefineSms(' + JSON.stringify(PASS1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)', sb); } catch (e) { out = 'THREW ' + e.message; }
    sb.console.log = ol; sb.console.warn = ow;
    return [out === null ? null : 'shipped', logs.some(l => /kept the first pass — the customer texted STOP and the rewrite invited them to text/.test(l))]; };
  await acheck('log312: "... just text me." after STOP -> the first pass ships, logged', () =>
    refine("Test, understood. If your plans change and you'd like help finding a vehicle, just text me." + SIG, H(CALL, STOP)), [null, true]);
  await acheck('"reply here" after STOP -> the first pass ships', () =>
    refine('Test, understood. If anything changes, reply here anytime.' + SIG, H(CALL, STOP)), [null, true]);
  await acheck('control: a rewrite that points to a call or email ships', () =>
    refine('Test, understood. If your plans change, you can call or email me anytime.' + SIG, H(CALL, STOP)), ['shipped', false]);
  await acheck('control: no STOP on the lead -> "text me" is fine and ships', () =>
    refine('Test, thanks for the call today. If your plans change, just text me.' + SIG, H(CALL)), ['shipped', false]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
