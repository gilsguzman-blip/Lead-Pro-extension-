#!/usr/bin/env node
'use strict';
// (v9.7.597) Registered BEFORE anything can throw. A suite that dies during module
// evaluation prints nothing, and nothing reads exactly like 'asserted nothing wrong'.
// See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('verbal-commit.test.js');

/**
 * verbal-commit.test.js — v9.7.556.
 *
 * There was no committed suite for [LP VERBAL COMMIT DIAG] before this file, despite three
 * prior tightenings of the block (v9.7.197, v9.7.368, v9.7.429/427) — two of which followed a
 * fabricated commitment shipping to a real customer. Those cases are reconstructed here from
 * what the changelog records, alongside the v9.7.556 regressions.
 *
 * LIVE INCIDENT — Jason Pellegrin, Community Honda Lafayette, dealerId 24399, lead 2043828702,
 * 8/20. He told Chassica Vincent by phone on 8/19 at 4:10 PM — disposition Contacted, a real
 * conversation, not a drop — that he would "try to come in on sat just to see what her car is
 * worth". The draft was a cold "did you end up getting a number elsewhere?" with no mention of
 * Saturday.
 *
 * THREE DEFECTS, and the first one alone does not fix the lead:
 *
 *  1. The capture was /\[CALL NOTE\][\s\S]{0,500}/ — from the FIRST tag, a flat 500 chars, no
 *     boundary at the next note. Context is newest-first and the newest entry is an unrelated
 *     8/20 11:36 AM "(Machine) / Left message", so the window held both notes and the
 *     boilerplate test ran on the combined blob. log119 line 1442.
 *
 *  2. The scan only ever looked at the FIRST call note. Bounded but not iterated, it would have
 *     examined the 8/20 voicemail, correctly blocked, and never reached the 8/19 commitment one
 *     entry below. Of Jason's 22 call notes only 7 are non-boilerplate and the real one is #2.
 *
 *  3. The commitment regex matched neither "will try to come in on sat" NOR "coming sat 29th
 *     4pm". Both notes could be extracted perfectly and still not fire.
 *
 * Fixtures are real: Jason's is his full 20,913-char context out of the delivered prompt. The
 * second lead's is the window log119 line 436 printed verbatim (its truncated trailing scaffold
 * line restored to the full standard text), as is the legitimate block from line 1195.
 *
 * The block is sliced out of each SHIPPED popup.js. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2);
if (!BUILDS.length) { console.error('usage: verbal-commit.test.js <popup.js> [popup.js...]'); process.exit(2); }

const JASON = fs.readFileSync(path.join(__dirname, 'fixtures', 'jason-pellegrin-context.txt'), 'utf8');

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');

  // The block reads LP_SCAFFOLD_LINE_RE (shared, v9.7.552) to trim trailing scaffold.
  const ha = src.indexOf('var LP_SCAFFOLD_LINE_RE =');
  const hb = src.indexOf('// (v9.7.429/427) ONE definition of');
  if (ha < 0 || hb < 0 || hb <= ha) throw new Error('could not locate LP_SCAFFOLD_LINE_RE in ' + file);

  const a = src.indexOf('  if (hasCallNoteContent && !data.isShowroomFollowUp) {');
  const b = src.indexOf('  // ── (v9.7.630) THE ARC DIGEST IS ADMITTED ON EVIDENCE');
  if (a < 0 || b < 0 || b <= a) throw new Error('could not locate the verbal-commit block in ' + file);

  // (v9.7.557) The block now calls the shared _lpWalkCrmEntries, so the walker has to be in
  // scope too. Sliced from the same shipped file, so the suite still exercises shipped bytes on
  // both sides of the migration.
  const wa = src.indexOf('var LP_CRM_ENTRY_SPLIT_RE =');
  const wb = src.indexOf('// ── (v9.7.554) AGENT LP COMMAND CHANNEL COVERAGE');
  if (wa < 0 || wb < 0 || wb <= wa) throw new Error('could not locate the entry walker in ' + file);

  const logs = [];
  const sandbox = { console: { log: (...x) => logs.push(x.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' ')) } };
  vm.createContext(sandbox);
  vm.runInContext(src.slice(ha, hb), sandbox);
  vm.runInContext(src.slice(wa, wb), sandbox);

  const run = vm.runInContext(
    '(function(data, hasCallNoteContent){\n' +
    '  var hasVerbalCommitment = false, conversationAnalysis = "";\n' +
    src.slice(a, b) +
    '\n  return { fired: hasVerbalCommitment, analysis: conversationAnalysis }; })', sandbox);

  return {
    name: path.basename(path.dirname(file)),
    run: (data, hasNote) => {
      logs.length = 0;
      const r = run(data, hasNote === undefined ? true : hasNote);
      return Object.assign({}, r, { logs: logs.slice() });
    }
  };
}

// (v9.7.597) Extraction failure is a REPORTED failure, not a fatal one — see
// tests/lib/guarded-impls.js. Pointed at a build that predates the code under test,
// this suite now runs every assertion and fails loudly instead of printing nothing.
const guardedImpls = require('./lib/guarded-impls.js');
const impls = guardedImpls(BUILDS, extract);
let pass = 0, fail = 0;

function check(name, fn, want) {
  const results = impls.map(i => { try { return JSON.stringify(fn(i)); } catch (e) { return 'THREW: ' + e.message; } });
  const agree = results.every(r => r === results[0]);
  const ok = agree && results[0] === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; console.log('  FAIL ' + name);
    if (!agree) impls.forEach((i, n) => console.log('        ' + i.name + ' -> ' + results[n]));
    else console.log('        expected ' + JSON.stringify(want) + '\n        got      ' + results[0]);
  }
}

const FOLLOWUP = '\n\nFOLLOW-UP: read the full transcript and write a response that directly continues THIS conversation.';

// log119 line 436 — a second lead, same collision, blocking an even more explicit commitment.
const SECOND_LEAD =
  '[08/20/2026 9:02 AM] [CALL NOTE] Outbound phone call (Machine)\n' +
  '  By: Rochelle Price\n' +
  '  Left message\n' +
  '[08/19/2026 3:21 PM] [CALL NOTE] Outbound phone call (Contacted)\n' +
  '  By: Jolette Aguilar\n' +
  '  coming sat 29th 4pm' + FOLLOWUP;

// log119 line 1195 — a genuine voicemail-only lead. This one MUST keep blocking.
const VOICEMAIL_ONLY =
  '[08/20/2026 10:14 AM] [CALL NOTE] Outbound phone call (Machine)\n' +
  '  By: Anahi Lepe\n' +
  '  Left message' + FOLLOWUP;

console.log('\nv9.7.556 — one call note at a time, and keep looking past the voicemails');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

console.log('Jason Pellegrin — his REAL 20,913-char context:');

check('the verbal-commit block now fires',
  i => i.run({ context: JASON, isShowroomFollowUp: false }).fired, true);

check('it matched his actual words, not a neighbouring note',
  i => (i.run({ context: JASON, isShowroomFollowUp: false }).logs.join(' ')
        .match(/matched: "([^"]*)"/) || [])[1],
  'will try to come in on sat just to see what her car is worth sent contact info');

check('the note it chose is the 8/19 4:10 PM Contacted one, alone',
  i => {
    const l = i.run({ context: JASON, isShowroomFollowUp: false }).logs.join(' ');
    return /this note ONLY: "\[08\/19\/2026 4:10 PM\] \[CALL NOTE\] Outbound phone call \(Contacted\)/.test(l)
        && !/Left message/.test(l);
  }, true);

// (v9.7.560) The log now reports what the lead HAS by type and what was examined, which are
// different numbers. Jason carries 22 call notes and 12 general notes.
check('the log says which note, how many the lead has by type, and how many it walked past',
  i => (i.run({ context: JASON, isShowroomFollowUp: false }).logs.join(' ')
        .match(/note (\d+) of (\d+) on the lead \((\d+) call, (\d+) general; examined (\d+), skipped (\d+)/) || []).slice(1, 7),
  ['2', '34', '22', '12', '2', '1']);

check('the fire reports the note type and the subject reading',
  i => (i.run({ context: JASON, isShowroomFollowUp: false }).logs.join(' ')
        .match(/noteType:(\S+ ?\S*) subject:(\w+)/) || []).slice(1, 3),
  ['[CALL NOTE]', 'unattributed']);

check('the directive quotes the Saturday commitment to the model',
  i => /will try to come in on sat/.test(i.run({ context: JASON, isShowroomFollowUp: false }).analysis)
    && /Do NOT offer new appointment times/.test(i.run({ context: JASON, isShowroomFollowUp: false }).analysis),
  true);

check('the showroom-followup exception (v9.7.197) still suppresses it entirely',
  i => i.run({ context: JASON, isShowroomFollowUp: true }).fired, false);

console.log('\nthe second lead in the same log (line 436) — same collision:');

check('"coming sat 29th 4pm" now fires',
  i => i.run({ context: SECOND_LEAD }).fired, true);

check('it reached the second note past the Rochelle Price voicemail',
  i => (i.run({ context: SECOND_LEAD }).logs.join(' ').match(/matched: "([^"]*)"/) || [])[1],
  'coming sat 29th 4pm');

check('the trailing FOLLOW-UP scaffold is trimmed off the note',
  i => /FOLLOW-UP/.test(i.run({ context: SECOND_LEAD }).logs.join(' ')), false);

console.log('\nthe genuine block (line 1195) must not regress:');

check('a voicemail-only lead still BLOCKS',
  i => i.run({ context: VOICEMAIL_ONLY }).fired, false);

// The walk now SKIPS boilerplate rather than selecting it, so the old BLOCKED wording is
// reachable only on the degraded flat-window path. NO USABLE NOTE is the normal report, and it
// carries more than BLOCKED did — how many notes existed and how many were refused.
check('and it says so, naming how many notes it refused and why',
  i => /NO USABLE NOTE — 1 note\(s\) on the lead \(1 call, 0 general\), examined 1, all 1 refused — \[CALL NOTE\]: voicemail\/machine boilerplate/
        .test(i.run({ context: VOICEMAIL_ONLY }).logs.join(' ')), true);

check('a lead whose every note is a voicemail reports NO USABLE NOTE',
  i => /NO USABLE NOTE — 3 note\(s\) on the lead \(3 call, 0 general\), examined 3, all 3 refused/.test(
    i.run({ context:
      '[08/20/2026 9:00 AM] [CALL NOTE] Outbound phone call (Machine)\n  By: A\n  Left message\n' +
      '[08/19/2026 9:00 AM] [CALL NOTE] Outbound phone call (Machine)\n  By: B\n  No answer\n' +
      '[08/18/2026 9:00 AM] [CALL NOTE] Outbound phone call\n  By: System\n  Auto-generated from adding customer.' }).logs.join(' ')),
  true);

check('a real conversation carrying no commitment reports NO COMMITMENT, not silence',
  i => /NO COMMITMENT — note is real content but carries no commitment phrase/.test(
    i.run({ context: '[08/20/2026 9:00 AM] [CALL NOTE] Outbound phone call (Contacted)\n  By: A\n  wrong number' }).logs.join(' ')),
  true);

console.log('\nthe documented false positives must all still be refused:');

// v9.7.368 — the voicemail SCRIPT contained "confirmed in stock", describing the VEHICLE.
check('v9.7.368 — "vehicle confirmed in stock" inside a voicemail script',
  i => i.run({ context: '[08/20/2026 9:00 AM] [CALL NOTE] Outbound phone call (Machine)\n  By: A\n'
    + '  Left message - the vehicle is confirmed in stock and ready' }).fired, false);

// v9.7.429/427 — bare day names / "next week" as standalone alternatives.
check('v9.7.429 — "try again friday" is not a commitment',
  i => i.run({ context: '[08/20/2026 9:00 AM] [CALL NOTE] Outbound phone call (Contacted)\n  By: A\n  try again friday' }).fired, false);

check('v9.7.429 — "busy next week, do not push" is not a commitment',
  i => i.run({ context: '[08/20/2026 9:00 AM] [CALL NOTE] Outbound phone call (Contacted)\n  By: A\n  busy next week, do not push' }).fired, false);

check('v9.7.429 — "credit approval" alone is not a commitment',
  i => i.run({ context: '[08/20/2026 9:00 AM] [CALL NOTE] Outbound phone call (Contacted)\n  By: A\n  waiting on credit approval' }).fired, false);

// v9.7.556 — the widening's own new risk.
check('a NEGATED commitment is refused — "not coming in"',
  i => i.run({ context: '[08/20/2026 9:00 AM] [CALL NOTE] Outbound phone call (Contacted)\n  By: A\n  says he is not coming in today' }).fired, false);

check('...and the refusal is logged rather than silent',
  i => /REFUSED — commitment phrase is negated/.test(
    i.run({ context: '[08/20/2026 9:00 AM] [CALL NOTE] Outbound phone call (Contacted)\n  By: A\n  says he is not coming in today' }).logs.join(' ')),
  true);

check('"won\'t be able to come in" is refused',
  i => i.run({ context: '[08/20/2026 9:00 AM] [CALL NOTE] Outbound phone call (Contacted)\n  By: A\n  he won\'t be coming in this week' }).fired, false);

check('a bare "sat" with no commitment verb does not fire',
  i => i.run({ context: '[08/20/2026 9:00 AM] [CALL NOTE] Outbound phone call (Contacted)\n  By: A\n  works sat and sun, call weekdays' }).fired, false);

check('"coming sunny weather" cannot match the sun day-token',
  i => i.run({ context: '[08/20/2026 9:00 AM] [CALL NOTE] Outbound phone call (Contacted)\n  By: A\n  coming sunny days ahead' }).fired, false);

console.log('\nthe shapes that already fired must keep firing:');

const stillFires = [
  ['will come in Friday',        'will come in Friday to look at it'],
  ['can come by tomorrow',       'can come by tomorrow afternoon'],
  ['scheduled for Tuesday',      'scheduled for Tuesday at 10'],
  ['set for 3pm',                'set for 3pm today'],
  ['confirmed an appointment',   'confirmed an appointment for the appraisal'],
  ['coming in today',            'coming in today after work'],
  ['will try and stop by sat',   'will try and stop by sat morning'],
  ['coming saturday',            'coming saturday around noon'],
  ['coming on thurs',            'coming on thurs after 5'],
];
stillFires.forEach(([label, body]) =>
  check('"' + label + '" fires',
    i => i.run({ context: '[08/20/2026 9:00 AM] [CALL NOTE] Outbound phone call (Contacted)\n  By: A\n  ' + body }).fired,
    true));

console.log('\nstructural safety:');

check('no call-note content at all is a no-op',
  i => i.run({ context: JASON, isShowroomFollowUp: false }, false).fired, false);

check('an empty context is a no-op and does not throw',
  i => i.run({ context: '' }).fired, false);

// (v9.7.560) THIS EXPECTATION IS DELIBERATELY INVERTED. It encoded the old scope — call notes
// only — and the whole point of this build is that a general note carrying a real commitment is
// now read. The companion assertion pins the subject reading, because an unattributed general
// note is exactly the ambiguity the subject veto is measuring rather than resolving.
check('a general note carrying a commitment now FIRES — the widening, working',
  i => i.run({ context: '[08/20/2026 9:00 AM] [NOTE] General Note\n  By: A\n  will come in Friday' }).fired, true);

check('...and it is reported as a general note with an unattributed subject',
  i => (i.run({ context: '[08/20/2026 9:00 AM] [NOTE] General Note\n  By: A\n  will come in Friday' })
        .logs.join(' ').match(/noteType:(\S+ ?\S*) subject:(\w+)/) || []).slice(1, 3),
  ['[NOTE]', 'unattributed']);

check('a context with NEITHER note type is still a no-op',
  i => i.run({ context: '[08/20/2026 9:00 AM] [AGENT] Outbound Text Message\n  By: A\n  will come in Friday' }).fired, false);

check('the walk is capped — a commitment below the cap is NOT surfaced',
  i => i.run({ context: Array.from({ length: 8 }, (_, n) =>
      '[08/2' + n + '/2026 9:00 AM] [CALL NOTE] Outbound phone call (Machine)\n  By: A\n  Left message').join('\n')
      + '\n[08/01/2026 9:00 AM] [CALL NOTE] Outbound phone call (Contacted)\n  By: A\n  will come in Friday' }).fired,
  false);

check('...and the cap is stated in the log rather than silently applied',
  i => /walk capped at 6/.test(i.run({ context: Array.from({ length: 8 }, (_, n) =>
      '[08/2' + n + '/2026 9:00 AM] [CALL NOTE] Outbound phone call (Machine)\n  By: A\n  Left message').join('\n') }).logs.join(' ')),
  true);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
