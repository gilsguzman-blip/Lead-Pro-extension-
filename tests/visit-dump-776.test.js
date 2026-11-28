#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('visit-dump-776.test.js');
// (v9.7.776) Gil, 10/9: "Should we add [LP VISIT DECISION DIAG] to the _LP dump console prompt for future analysis when
// working issues?" v9.7.775's visit decision put one line in the prompt, but the lines it removed were gone from the dump
// and a lead with no hold showed nothing. _lpDumpPrompt() now writes a VISIT DECISION section: the level, the owner, any
// outranked holds, and the original text of every line removed or rewritten -- or "level 0" when nothing held the visit.
// Executes the shipped buildUserPrompt, _lpApplyVisitDecision, _lpVisitDecisionDumpText and the shipped _lpDumpPrompt
// (lifted from the generation, with the browser download stubbed). Placeholder data only.
//
// Usage: node tests/visit-dump-776.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: visit-dump-776.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const VISITBRIEF = '[10/07/2026 12:14 PM] [SHOWROOM VISIT]\n  By: Rep Name\n  Wants to think about it overnight.\n[10/07/2026 9:00 AM] [AGENT] Outbound Text Message\n  Hi Test.';
const SHOW = { name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Honda CR-V EX', dealerId: '24399',
  store: 'Community Honda Lafayette', leadSource: 'Showroom', convState: 'active-follow-up', leadAgeDays: 1, isShowroomFollowUp: true,
  showroomDetails: 'By: Rep Name\nWants to think about it overnight.', conversationBrief: VISITBRIEF, hasOutbound: true, totalNoteCount: 6,
  phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '', relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 0 }, context: '' };
const STATUS = 'STORE STATUS RIGHT NOW: OPEN. Store closes at 8:00 PM -- 5 hours left today. OFFER THE SOONEST REAL OPENING FIRST: today is the default, lead with a today time.';
const SLOTS = 'SUGGESTED APPOINTMENT TIMES (fallback only -- use the customer\'s own day first):\n- Today at 4:15 PM\n- Tomorrow at 10:30 AM';

for (const f of BUILDS) {
  const src = fs.readFileSync(f, 'utf8');
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const quiet = (fn) => { const ol = sb.console.log; sb.console.log = () => {}; try { return fn(); } finally { sb.console.log = ol; } };
  const last = () => vm.runInContext('_lpLastVisitDecision', sb);
  const dumpText = (v) => vm.runInContext('_lpVisitDecisionDumpText', sb)(v);

  console.log(' 1. buildUserPrompt keeps the decision it made:');
  quiet(() => sb.__lp.buildUserPrompt(SHOW));
  check('(new helper) a showroom follow-up: level 2, the showroom block owns it', () => { const v = last(); return [v.level, v.owner]; }, [2, 'the SHOWROOM FOLLOW-UP block']);
  check('(new helper) each removed line is kept in full -- the slot block with its option lines', () => {
    const r = last().removed; const s = r.find(x => /^SUGGESTED APPOINTMENT TIMES/.test(x.was));
    return [r.length > 0, !!s, s ? s.was.split('\n').length > 1 : false]; }, [true, true, true]);
  // (the store-hours line depends on the clock here; section 2 checks it on a fixed prompt)
  check('(new helper) a lead with no hold is recorded as level 0, nothing removed', () => {
    quiet(() => sb.__lp.buildUserPrompt(Object.assign({}, SHOW, { isShowroomFollowUp: false, showroomDetails: '', conversationBrief: '', leadSource: 'Internet' })));
    const v = last(); return [v.level, v.removed.length]; }, [0, 0]);

  console.log(' 2. the dump section reads it:');
  const A = sb._lpApplyVisitDecision(['CURRENT TIME: x', STATUS, 'DO NOT offer appointment times. DO NOT write duration. Re-engage softly.',
    'This is not a hot lead. Soft re-engage — change the angle, do not press for an appointment hard.', SLOTS, 'END'].join('\n'));
  let T; try { T = dumpText(A); } catch (e) { T = 'THREW: ' + e.message; }   // tolerant on a build without the helper
  check('(new helper) level, its meaning and the owner', () => [/^level 2 -- no specific appointment times/.test(T), /\nowner: the stalled-lead re-engagement block\n/.test(T)], [true, true]);
  check('(new helper) the outranked hold is named with its level', () => /other holds present \(outranked\): the RELATIONSHIP READING \(not a hot lead\) \[level 1\]/.test(T), true);
  check('(new helper) every removal with what it was, the option lines included', () =>
    [/removed or neutralised \(2\):/.test(T), /- store-status today default\n    was: STORE STATUS RIGHT NOW: OPEN\.[^\n]*OFFER THE SOONEST/.test(T), /was: SUGGESTED APPOINTMENT TIMES[^\n]*\n\s+- Today at 4:15 PM\n\s+- Tomorrow at 10:30 AM/.test(T)], [true, true, true]);
  check('(new helper) level 0, nothing captured, and a failure each say so', () =>
    [/^level 0 -- no hold on the visit in this prompt; nothing removed$/.test(dumpText({ level: 0, removed: [], others: [] })),
     /none captured yet/.test(dumpText(null)), /the visit decision failed \(boom\)/.test(dumpText({ error: 'boom' }))], [true, true, true]);
  check('(new helper) the prompt itself is what v9.7.775 produced (the record is beside it, not in it)', () =>
    [/^VISIT DECISION FOR THIS MESSAGE: [^\n]*the stalled-lead re-engagement block owns this/m.test(A.text), /SUGGESTED APPOINTMENT TIMES|OFFER THE SOONEST|removed or neutralised/.test(A.text)], [true, false]);

  console.log(' 3. _lpDumpPrompt() writes it (the shipped function, download stubbed):');
  const a = src.indexOf('      window._lpLastSystemPrompt = payload.system_instruction.parts[0].text;');
  const b = src.indexOf('    } catch (ePromptDump)', a);
  check('(new helper) the generation copies the decision beside the prompt it belongs to', () =>
    /window\._lpLastUserPrompt = userPrompt;\n\s+window\._lpLastVisitDecision = \(typeof _lpLastVisitDecision !== 'undefined'\) \? _lpLastVisitDecision : null;/.test(src.slice(a, b)), true);
  const written = (() => { try {
    if (a < 0 || b < 0) return 'region not found';
    let blobText = '';
    const ctx = { window: {}, console: { log() {} }, Date, JSON, String, setTimeout: () => {},
      Blob: function (parts) { blobText = parts.join(''); }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
      document: { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } },
      payload: { system_instruction: { parts: [{ text: 'SYS' }] } }, userPrompt: 'USR', lastScrapedData: { autoLeadId: 'TEST001A', dealerId: '24399' },
      _lpLastVisitDecision: { level: 2, owner: 'the SHOWROOM FOLLOW-UP block', others: [], removed: [{ why: '(5) two-times close', was: '(5) Close with two specific appointment times.' }] },
      _lpVisitDecisionDumpText: vm.runInContext('_lpVisitDecisionDumpText', sb), _LP_VISIT_DECISION_TEXT: vm.runInContext('_LP_VISIT_DECISION_TEXT', sb) };
    vm.createContext(ctx);
    vm.runInContext('try {\n' + src.slice(a, b) + '    } catch (ePromptDump) { throw ePromptDump; }\nwindow._lpDumpPrompt();', ctx);
    return blobText; } catch (e) { return 'THREW: ' + e.message; } })();
  check('(new helper) the file carries a VISIT DECISION section with the owner and the removed line', () =>
    [/\n=== VISIT DECISION ===\n\nlevel 2 -- [^\n]*\nowner: the SHOWROOM FOLLOW-UP block\nremoved or neutralised \(1\):\n- \(5\) two-times close\n    was: \(5\) Close with two specific appointment times\./.test(written)], [true]);
  check('...and the sections around it are still there', () =>
    ['=== SYSTEM PROMPT', '=== USER PROMPT', '=== MODEL RAW RESPONSE ===', '=== SMS REWRITE STEP ===', '=== FACT CHECK VERDICTS ==='].map(h => written.indexOf(h) >= 0), [true, true, true, true, true]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
