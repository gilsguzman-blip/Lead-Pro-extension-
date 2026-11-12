#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('day-lock-orphan-857.test.js');
// (v9.7.857) OWNER-APPROVED 11/3. When a stronger rule owns the visit (level 2+: no specific times), the visit decision dropped
// the day-named block's two close lines -- "LOCK IN <day>" and "Your ONLY close is two times on the day the customer named" --
// and left its header and the rest: "CUSTOMER NAMED A SPECIFIC DAY -- THIS IS A HARD CONSTRAINT: Do NOT offer today. Do NOT offer
// any other day." The model was told to hold to a day it was never given (found by the B-2 replay on lead 2082278892, shipped
// 10/28). The whole block now leaves together, logged as one edit; at level 1 (the day named owns the visit) it stays whole.
// Executes _lpApplyVisitDecision and, end to end, populateFromData -> the generate path's fence strip -> buildUserPrompt.
// Placeholder data only.
//
// Usage: node tests/day-lock-orphan-857.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: day-lock-orphan-857.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const BLOCK = ['📅 CUSTOMER NAMED A SPECIFIC DAY — THIS IS A HARD CONSTRAINT:',
  '- Customer said Tuesday is when they are available. LOCK IN Tuesday - do NOT offer any other day. Offer two specific times on Tuesday only. Do NOT try to pull them in sooner.',
  '- Do NOT offer today. Do NOT offer any other day.',
  '- Do NOT add "or if you want to come sooner." That is a critical failure.',
  '- Your ONLY close is two times on the day the customer named. Nothing else.'].join('\n');
const L2 = 'DO NOT include appointment times in ANY format. This lead has had no contact.';   // the ZERO-CONTACT owner (level 2)
const ORPHAN = /CUSTOMER NAMED A SPECIFIC DAY|Do NOT offer any other day|or if you want to come sooner/;

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const apply = (text) => { const ol = sb.console.log; sb.console.log = () => {}; try { return run('_lpApplyVisitDecision')(text); } finally { sb.console.log = ol; } };

  console.log(' 1. a stronger rule owns the visit (level 2): the whole block leaves:');
  const r2 = apply('VEHICLE ON LEAD: 2026 Honda Civic Sport\n' + BLOCK + '\nCRM ENGAGEMENT RATING: Low\n' + L2 + '\n');
  check('level 2, and none of the block is left (no header naming a constraint without its day)', () => [r2.level >= 2, ORPHAN.test(r2.text), /LOCK IN|Your ONLY close/.test(r2.text)], [true, false, false]);
  check('it is one logged edit carrying all five lines', () => {
    const e = r2.removed.filter(x => /^day-named block/.test(x.why)); return [e.length, e[0] && e[0].was.split('\n').length]; }, [1, 5]);
  check('the lines around it are untouched', () => [/VEHICLE ON LEAD: 2026 Honda Civic Sport\n/.test(r2.text), /CRM ENGAGEMENT RATING: Low/.test(r2.text)], [true, true]);
  const lone = apply(BLOCK.split('\n').filter(l => !/Your ONLY close/.test(l)).join('\n') + '\n- Ask what color they want.\n' + L2 + '\n');
  check('it stops at the block: an unrelated "- " line after it stays', () => [ORPHAN.test(lone.text), /- Ask what color they want\./.test(lone.text)], [false, true]);

  console.log(' 2. the day the customer named owns the visit (level 1): the block stays whole:');
  const r1 = apply('VEHICLE ON LEAD: 2026 Honda Civic Sport\n' + BLOCK + '\n');
  check('level 1, all five lines kept', () => [r1.level, BLOCK.split('\n').every(l => r1.text.indexOf(l) >= 0)], [1, true]);

  console.log(' 3. end to end, the prompt the panel builds (a named day from the scrape under a level-2 owner):');
  const E = (date, tag, title, body) => '[' + date + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
  const H = E('10/27/2026 8:00 PM', 'AGENT', 'Outbound Text Message', 'Test, the 2026 Civic Sport is here and ready for you to see. Want to stop by and drive it?') + '[10/27/2026 7:00 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
  const lsd = { autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Honda Civic Sport', condition: 'New',
    stockNum: '', dealerId: '6191', store: 'Community Honda Baytown', leadSource: 'Dealers WebSite', convState: 'active-follow-up', leadAgeDays: 0, hasOutbound: true,
    hasCustomerReply: false, totalNoteCount: 3, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '', relationshipSignals: { unansweredQuestions: [] },
    history: H, conversationBrief: H,
    customerScheduleConstraint: 'CUSTOMER SPECIFIED DAY: Customer said Tuesday is when they are available. LOCK IN Tuesday - do NOT offer any other day. Offer two specific times on Tuesday only. Do NOT try to pull them in sooner.' };
  const prompt = (() => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {};
    try { run('activeFlags = new Set(); leadContext = "";'); sb.populateFromData(lsd);
      // A level-2 owner beside the block (the ZERO-CONTACT line); on the 10/28 lead it was the PITCH ALREADY OUT rule.
      const ctx = run('_lpApplyFactOverrides')(String(run('leadContext')), {}, () => {}).text + '\n' + L2 + '\n';
      return String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd, context: ctx }))); } finally { sb.console.log = ol; sb.console.warn = ow; } })();
  const lvl = (prompt.match(/VISIT DECISION FOR THIS MESSAGE: ([^\n]{0,60})/) || [])[1] || '';
  check('the visit decision holds times back here (the precondition: level 2+)', () => /no specific appointment times|no visit ask/.test(lvl), true);
  check('control: the block was in the context before the decision (populateFromData wrote it)', () => /CUSTOMER NAMED A SPECIFIC DAY/.test(String(run('leadContext'))), true);
  check('and the prompt carries no orphaned day constraint', () => ORPHAN.test(prompt), false);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
