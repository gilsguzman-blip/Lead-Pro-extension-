#!/usr/bin/env node
'use strict';
// (v9.7.699) PHASE 2 STEP 4 — M2 (the showroom-visit read) and M8 (probe memoisation), both run
// against the WHOLE shipped popup.js in a vm (tests/helpers/load-popup.js). P6 has its own suite,
// cadence-calendar-699. Synthetic leads, placeholder names.
//
// Usage: node tests/step4-699.test.js <dev popup.js> <commercial popup.js>
const path = require('path');
const vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: step4-699.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) {
  let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }

  // ── M2 ─────────────────────────────────────────────────────────────────────────────────
  // An in-state-far / out-of-state Honda Baytown lead the scraper flagged isDistanceBuyer. populate
  // runs for real; toggleFlag is observed, and the context it builds is read back.
  const flagsFor = (extra) => {
    const calls = []; const orig = sb.toggleFlag;
    sb.toggleFlag = (k, on) => { calls.push(k); return orig(k, on); };
    vm.runInContext('activeFlags = new Set(); leadContext = "";', sb);
    try {
      sb.populateFromData(Object.assign({ name: 'Test Customer', agent: 'Agent Name', vehicle: '2026 Honda Pilot', dealerId: '6191',
        store: 'Community Honda Baytown', leadSource: 'Internet', convState: 'active-follow-up', customerState: 'OK', customerZip: '73101',
        isDistanceBuyer: true, leadAgeDays: 3, totalNoteCount: 4, hasOutbound: true, relationshipSignals: {} }, extra));
    } finally { sb.toggleFlag = orig; }
    // Only the FLAG is observable. The DISTANCE rule populate also writes is pushed onto vehicleExtras
    // AFTER vehicleExtras was joined into leadContext, so it has never reached a prompt (0 of 50 captures);
    // reported in the v9.7.699 header, not changed here.
    return { distance: calls.includes('distance') };
  };
  console.log(' M2 — a customer who already came in (executed populateFromData):');
  check('control: no visit — the distance flag lights', () => flagsFor({}), { distance: true });
  check('showroom follow-up — the flag does not light (the "already came in" suppression finally happens)', () => flagsFor({ isShowroomFollowUp: true }), { distance: false });
  check('showroom visit today — the flag does not light', () => flagsFor({ showroomVisitToday: true }), { distance: false });

  // ── LENGTH RULES (Gil, 9/23: "drop all the length rules. Keep 20-30 sec on VM, drop word count.
  //    Ignore subject line, change the rest.") ────────────────────────────────────────────────
  console.log(' length rules (executed system prompts + auth.js personas):');
  const sys = sb.buildSystemPrompt('bdc');
  const vmSys = sb.buildSystemPromptVoicemailOnly('bdc', 'Agent', 'Community Honda Baytown', '(555) 010-0199');
  check('voicemail-only: 20-30 seconds kept, the 60-80 word count and the per-beat sentence counts gone',
    () => [/Natural spoken cadence, 20-30 seconds, three beats:/.test(vmSys), /60-80 words/.test(vmSys), /One spoken sentence|REASON: ONE sentence|this ONE sentence/.test(vmSys)], [true, false, false]);
  check('the main voicemail rule keeps its 20-30 seconds', () => /VOICEMAIL: 20-30 seconds\./.test(sys), true);
  check('reading the room: register kept, "Short reply → short response" gone', () => [/Short reply → short response/.test(sys), /Match the register of what they sent/.test(sys)], [false, true]);
  check('subject lines untouched (4-8 words), as Gil said', () => /Short is better — 4-8 words/.test(sys), true);
  const fs = require('fs');
  const code = fs.readFileSync(f, 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  check('bereavement: no sentence count; clarify: no "in one line"', () => [/\(2-3 sentences\)/.test(code), /CLARIFY naturally in one line/.test(code)], [false, false]);
  const auth = fs.readFileSync(path.join(path.dirname(f), 'auth.js'), 'utf8');
  check('auth.js personas: no "concise", "short sentences", "Keep it short", "the shorter it is"',
    () => /concise|short sentences|Keep it short|the shorter it is/.test(auth), false);

  // ── M8 ─────────────────────────────────────────────────────────────────────────────────
  console.log(' M8 — probe verdicts memoised per lead + input hash (executed, fake transport):');
  let calls = 0; let answer = { kind: 'none', day: null, make: null, quote: '' }; let broken = false;
  const deps = (lead) => ({
    activeLeadId: lead, endpoint: { url: 'https://example.invalid/generate' }, attach: (p) => p, log: () => {},
    fetch: () => { calls++; if (broken) return Promise.reject(new Error('network down'));
      return Promise.resolve({ json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }) }); }
  });
  const data = (txt) => ({ context: '[09/22/2026 12:23 PM] [CALL NOTE] Outbound phone call (Contacted)\n  By: Agent Name\n  ' + txt + '\n',
    dealerId: '6191', schedCustomerNotes: [{ text: 'I can come by after work' }], lastInboundMsg: 'I can come by after work',
    conversationBrief: '', customerText: 'I can come by after work' });
  await acheck('first generation asks all three probes', async () => { calls = 0; await sb._lpPrepareFactVerdicts(data('said they will think about it'), deps('L-1001')); return calls; }, 3);
  await acheck('a regen with the same inputs asks NONE, and the verdicts are the same object the flush reads',
    async () => { calls = 0; const a = sb.window._lpFactVerdicts; const v = await sb._lpPrepareFactVerdicts(data('said they will think about it'), deps('L-1001'));
      return [calls, v === a, sb.window._lpFactVerdicts === v]; }, [0, true, true]);
  await acheck('a new note on the same lead changes the hash — asked again', async () => { calls = 0; await sb._lpPrepareFactVerdicts(data('said they will come Saturday at 10'), deps('L-1001')); return calls; }, 3);
  await acheck('the same inputs on a DIFFERENT lead are never reused', async () => { calls = 0; await sb._lpPrepareFactVerdicts(data('said they will think about it'), deps('L-2002')); return calls; }, 3);
  await acheck('a failed probe is not memoised — the next generation asks again',
    async () => { broken = true; calls = 0; await sb._lpPrepareFactVerdicts(data('fresh note A'), deps('L-3003')); broken = false;
      const first = calls; calls = 0; await sb._lpPrepareFactVerdicts(data('fresh note A'), deps('L-3003')); return [first, calls]; }, [3, 3]);
  await acheck('no lead id — nothing is memoised', async () => { calls = 0; await sb._lpPrepareFactVerdicts(data('fresh note B'), deps(''));
      await sb._lpPrepareFactVerdicts(data('fresh note B'), deps('')); return calls; }, 6);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
