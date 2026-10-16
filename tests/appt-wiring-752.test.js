#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('appt-wiring-752.test.js');
// (v9.7.752) Toyota Baytown lead 2092976040, 10/1 (log276, on v9.7.751). v9.7.751's _lpMissedApptIsPrior reads
// data.freshestApptEventDays, and its test handed buildUserPrompt that field directly. The live prompt is built from
// generateAll's hand-built _lpPromptInputData, which carried hasMissedAppt but not the appointment's age -- so the check
// saw no age, and "TIMING — APPOINTMENT FELL THROUGH ... confirm they still want to come in" printed again on a lead
// submitted that afternoon ("Are you still interested in coming in?"). The v9.7.618 lesson, again: a field the prompt
// builder reads is wired only if that object carries it. This suite builds the object the way generateAll does, from
// lastScrapedData, and runs buildUserPrompt on IT. Placeholder data only.
//
// Usage: node tests/appt-wiring-752.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: appt-wiring-752.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const SCRAPE = (extra) => Object.assign({ name: 'Test Buyer', agent: 'Agent Name', phone: '(555) 010-0199', email: 'test@example.com',
  vehicle: '2026 Toyota Tundra 4WD 1794 Edition', stockNum: 'TEST001A', dealerId: '6189', store: 'Community Toyota Baytown', leadSource: 'Edmunds',
  convState: 'first-touch', hasOutbound: true, hasCustomerReply: false, totalNoteCount: 4, relationshipSignals: {}, autoLeadId: '2000000001',
  lastInboundMsg: '', hasMissedAppt: true, leadAgeDays: 0 }, extra);

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  const sb = loadPopup(f, { withAuth: true });
  // generateAll's object, evaluated as generateAll evaluates it: every field read from lastScrapedData, the handful of
  // locals it names resolved from the sandbox (undefined where generateAll would hold the form's values).
  const a = src.indexOf('    var _lpPromptInputData = {'), b = src.indexOf('\n    };\n', a);
  const lit = src.slice(a + '    var _lpPromptInputData = '.length, b + '\n    }'.length);
  const viaGenerate = (scrape) => {
    sb.__lsd = scrape;
    vm.runInContext('lastScrapedData = globalThis.__lsd; leadContext = ""; window._lpSuppressApptChip = false; window._lpNoApptLeadId = "";', sb);
    sb.__loc = new Proxy({}, { has: () => true, get: (t, k) => (k === Symbol.unscopables ? undefined : vm.runInContext('typeof ' + String(k) + ' === "undefined" ? undefined : ' + String(k), sb)) });
    const obj = vm.runInContext('(function(){ with (globalThis.__loc) { return (' + lit + '); } })()', sb);
    return { obj, p: sb.__lp.buildUserPrompt(Object.assign({}, obj, { context: '' })) };   // the object alone, as generateAll passes it
  };
  console.log(' the appointment\'s age reaches the prompt builder through generateAll:');
  const prior = viaGenerate(SCRAPE({ freshestApptEventDays: 58 }));
  check('_lpPromptInputData carries freshestApptEventDays from lastScrapedData', () => prior.obj.freshestApptEventDays, 58);
  check('log276 shape: the only appointment events are 58 days old, the lead is from today -> no "APPOINTMENT FELL THROUGH"',
    () => /APPOINTMENT FELL THROUGH/.test(prior.p), false);
  check('control: missed today, on this lead -> the block stands', () => /APPOINTMENT FELL THROUGH/.test(viaGenerate(SCRAPE({ freshestApptEventDays: 0 })).p), true);
  check('control: no event age in the scrape -> the block stands, as before', () => /APPOINTMENT FELL THROUGH/.test(viaGenerate(SCRAPE({})).p), true);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
