#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('lp-superseded-767.test.js');
// (v9.7.767) A STALE AGENT LP COMMAND IS NOT FORCED INTO THE TEXT. Honda Lafayette lead 2049596846 (log288): an 84-day-old
// "LP: value" note, which the main prompt shows as context only because the customer has replied since, reached the text
// rewrite as "EVERY ONE OF THESE MUST APPEAR IN THE TEXT". The rewrite added "so you get more value from your visit", and an
// earlier one shipped a bare "Value" before the signature. Executes the shipped _lpBuildSmsRefinePrompt. Placeholder data.
//
// Usage: node tests/lp-superseded-767.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: lp-superseded-767.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const PASS1 = 'Test, I can check for a comparable Accord. Are you looking for a pre-owned Accord, or would you consider a new one?';
const EMAIL = 'Subject: Finding the right Accord\n\nTest,\n\nI can check for a comparable Accord. Are you looking for a pre-owned one, or would you consider new?\n\nAgent Name';
const lead = (cmds, superseded) => ({ name: 'Test Buyer', firstName: 'Test', lastInboundMsg: 'What years do you have?', agentLPCommands: cmds,
  relationshipSignals: { agentLPCommandSuperseded: superseded, lastInboundAgeDays: 4, unansweredQuestions: [] } });
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const rp = (d) => { const ol = sb.console.log, logs = []; sb.console.log = (...x) => logs.push(x.join(' '));
    try { return { p: vm.runInContext('_lpBuildSmsRefinePrompt', sb)(PASS1, EMAIL, d), logs }; } finally { sb.console.log = ol; } };
  const stale = rp(lead(['value'], true));
  check('a command the customer has replied past: no "must appear in the text" block, and no "► value" at all', () =>
    [/WHAT THE AGENT TYPED BY HAND/.test(stale.p), /MUST APPEAR IN THE TEXT/.test(stale.p), /► value/.test(stale.p)], [false, false, false]);
  check('...and the skip is logged with the command', () => stale.logs.some(l => /agent LP command not forced into the text[^\n]*\["value"\]/.test(l)), true);
  const live = rp(lead(['mention the $500 loyalty bonus'], false));
  check('control: a current command still reaches the rewrite and must appear in the text', () =>
    [/WHAT THE AGENT TYPED BY HAND FOR THIS LEAD/.test(live.p), /► mention the \$500 loyalty bonus/.test(live.p), /EVERY ONE OF THESE MUST APPEAR IN THE TEXT/.test(live.p)], [true, true, true]);
  check('control: no flag at all (older scrape) behaves as current, as before', () => {
    const d = lead(['mention the $500 loyalty bonus'], undefined); delete d.relationshipSignals.agentLPCommandSuperseded;
    return /EVERY ONE OF THESE MUST APPEAR IN THE TEXT/.test(rp(d).p); }, true);
  check('no commands: no block either way', () => /WHAT THE AGENT TYPED BY HAND/.test(rp(lead([], true)).p) || /WHAT THE AGENT TYPED BY HAND/.test(rp(lead([], false)).p), false);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
