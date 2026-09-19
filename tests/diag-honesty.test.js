#!/usr/bin/env node
'use strict';
// (v9.7.633) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('diag-honesty.test.js');

/**
 * diag-honesty.test.js — v9.7.633. TWO DIAGNOSTICS THAT COULD NOT SEE WHAT THEY CLAIMED TO.
 *
 * (1) [LP BRIEF FENCE DIAG] WAS REPORTING ON FRAMES THAT SCRAPED NOTHING. Across log174 and
 *     log175 it produced 34 and 34 rows; in log175, TWENTY-NINE of the thirty-four read
 *     "convState:first-touch | NO TRANSCRIPT BODY to bound (recentHistory is empty)" — about
 *     frames that never carried a lead. VinSolutions renders many frames per page; the ones with
 *     no notes panel scrape nothing, so convState defaults to 'first-touch' and recentHistory is
 *     empty, and the line announced both as if they were findings about a customer.
 *
 *     WHAT IT COST: on the log175 grab of Kia lead 2078978836, four frames each reported
 *     "NO TRANSCRIPT BODY" while populateFromData on that same grab logged a brief BEGINNING
 *     "CONVERSATION TRANSCRIPT (newest first ...)". The diagnostic contradicted the shipped output
 *     on its face, and "region ADDED" appears ZERO times in either log — which reads identically
 *     to "the v9.7.629 append is dead" and to "no lead has needed it yet". Different facts.
 *
 *     Third instance of the class in this file's history — v9.7.552's fallback with no outcome
 *     line, v9.7.589's "no fences" that sent three investigation passes at the wrong layer — and
 *     this one shipped four days ago.
 *
 * (2) [LP NOTES-LOAD DIAG] IS NOT ALWAYS-ON AND NEVER WAS. v9.7.531 shipped it described as
 *     "ALWAYS-ON ... so the real frequency of this failure is measurable from live logs instead of
 *     assumed", and "specifically so a future scope change here cannot hide behind 'nothing to
 *     report'". It has produced ZERO rows across log173, log174 and log175, because it sits ~240
 *     lines inside `if (_transcriptMissing && ...)`. The diagnostic written to stop a scope hiding
 *     a measurement is itself hidden behind a scope.
 *
 * NEITHER GUARD MOVES AND NO BLOCKING BEHAVIOUR CHANGES. Whether a notes-only failure can occur
 * without triggering the rescue is the open question, and the honest order is to measure before
 * changing what blocks an agent's grab.
 *
 * Executes the SHIPPED suppression. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: diag-honesty.test.js <popup.js> [popup.js...]'); process.exit(2); }

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const bail = (m) => require('./lib/fatal-guard.js').bail('diag-honesty.test.js', m);

function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('    try {\n      var _cbHasFence =');
  const b = src.indexOf('} catch (eFence) {', a);
  if (a < 0 || b < 0) bail('invariant block not in ' + file);
  const block = src.slice(a, b + '} catch (eFence) {'.length);
  // The load guard checks for the BLOCK, not for the suppression condition inside it. Bailing on
  // the exact string a neuter edits turns a named failure into "could not find the code it tests"
  // — an unattributable result, which this repo's own fatal-guard says is not evidence either way.
  // Second time; the suppression's presence is asserted below instead, where it can fail by name.
  if (block.indexOf('_cbHasFence') < 0) bail('brief-fence block not in ' + file);

  const logs = [];
  const sb = {
    String,
    _lpD: m => logs.push(String(m)),
    // The real builder, so the ADDED path produces a real region rather than a stub that could
    // pass an assertion the shipped code would fail (v9.7.616).
    _lpFencedTranscript: b2 => 'CONVERSATION TRANSCRIPT (newest first — read the full thread before responding):\n---\n' + b2 + '\n---\n'
  };
  vm.createContext(sb);
  vm.runInContext('function _fence(conversationBrief, recentHistory, convState, totalNoteCount){\n'
    + block + ' }\n return conversationBrief; }', sb);

  return { src, logs, fence: vm.runInContext('_fence', sb) };
}

for (const file of BUILDS) {
  const B = load(file);
  const run = (brief, hist, cs, notes) => { B.logs.length = 0; const out = B.fence(brief, hist, cs, notes); return { out, logs: B.logs.join('|') }; };
  console.log('\n' + path.relative(process.cwd(), file) + ' — a diagnostic that cannot see is worse than none');

  // ── (1) THE NOISE IS GONE ──────────────────────────────────────────────────
  console.log('\nthe 29-of-34 shape from log175 — a frame that scraped nothing:');
  const empty = run('', '', 'first-touch', 0);
  check('it says nothing at all', empty.logs, '');
  check('...and still returns the brief untouched', empty.out, '');
  check('a frame with no lead but a stray convState is also silent',
    run('', '', 'active-follow-up', 0).logs, '');

  // ── AND NOTHING REAL WAS SILENCED ──────────────────────────────────────────
  // The failure mode of this fix is over-suppression, so each surviving shape is pinned.
  console.log('\nevery frame that actually carries a lead still reports:');
  const added = run("CUSTOMER'S INQUIRY — ...", '[09/04] [AGENT] hi', 'first-touch', 12);
  check('a first-touch lead with a thread — the append fires', /region ADDED/.test(added.logs), true);
  check('...and the region really is in the brief now',
    added.out.indexOf('CONVERSATION TRANSCRIPT (') > -1, true);
  const already = run('X\nCONVERSATION TRANSCRIPT (newest first):\n---\nbody\n---\n', 'body', 'active-follow-up', 25);
  check('a lead whose gate already emitted the region', /already emitted by the convState branch/.test(already.logs), true);
  // THE ONE THAT MUST NOT BE SILENCED: a real lead with notes but genuinely no thread. That is a
  // finding, not noise, and it is the shape the suppression could most easily swallow.
  const noThread = run('AGENT CONTEXT — ...', '', 'first-touch', 6);
  check('a real lead with notes but NO thread still reports', /NO TRANSCRIPT BODY to bound/.test(noThread.logs), true);
  check('...because notes>0 keeps it audible', noThread.logs.indexOf('notes:6') > -1, true);
  // ...and a lead with a body but no notes count is audible too.
  check('a lead with a transcript body but a zero note count still reports',
    run('X', '[09/04] [AGENT] hi', 'first-touch', 0).logs.length > 0, true);

  console.log('\nthe row now carries the note count, so noise is identifiable at a glance:');
  check('the ADDED row names it', /notes:12/.test(added.logs), true);
  check('the no-change row names it', /notes:25/.test(already.logs), true);

  // ── (2) THE OUTCOME ROW THAT DID NOT EXIST ─────────────────────────────────
  // Per-frame rows cannot report what SURVIVED the merge; this is the row that can.
  console.log('\nthe brief that actually ships is now reported, once per grab:');
  check('the outcome diagnostic exists', /\[LP BRIEF OUTCOME DIAG\] the brief that SHIPPED/.test(B.src), true);
  // MEASURED ON CODE. Both labels appear in build headers at the top of the file, which are
  // comments — so an ordering check against raw source compares a header to a header. FOURTH time
  // this week a pattern loose enough to match prose was read as measuring code (v9.7.563,
  // v9.7.631, v9.7.632, here). Line comments stripped first, every time, from now on.
  const code = B.src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  check('...in populateFromData, not in the frame scraper',
    code.indexOf('[LP BRIEF OUTCOME DIAG]') < code.indexOf('[LP BRIEF FENCE DIAG]'), true);
  check('...reporting whether the fence survived',
    /_bfFence \? 'present' : 'ABSENT'/.test(code), true);
  check('...and how much transcript it bounds', /bounded transcript:' \+ _bfBody\.length/.test(B.src), true);
  check('...and flags a worked lead that shipped without one',
    /WORKED LEAD WITH NO FENCE/.test(B.src), true);
  check('it uses console.log — populateFromData is popup scope, not frame scope',
    /console\.log\('\[LP BRIEF OUTCOME DIAG\]/.test(B.src), true);
  check('...and NOT _lpD, which would be a ReferenceError there',
    /_lpD\('\[LP BRIEF OUTCOME DIAG\]/.test(B.src), false);

  // ── (3) THE ALWAYS-ON RATE ─────────────────────────────────────────────────
  console.log('\nthe notes-load rate is measurable for the first time:');
  check('the rate row exists', /\[LP NOTES-LOAD RATE\]/.test(B.src), true);
  check('...and says plainly that it blocks nothing',
    /observational, blocks nothing/.test(B.src), true);
  check('...and names the row that does block', /The blocking decision is \[LP NOTES-LOAD DIAG\]/.test(B.src), true);
  check('it reports the verdict the guard would reach', /wouldBlock:' \+ _nlWouldBlock/.test(B.src), true);
  // The verdict must be computed the SAME way the guard computes it, or the rate measures nothing.
  check('same panelWorked terms as the guard', /_nlWorked  = !!\(d && \(d\.isContacted \|\| d\.hasOutbound\)\)/.test(B.src), true);
  check('same empty-arc terms, including the 40-char history floor',
    /_nlArcEmpty = !\(_nlNotes > 0\) && !\(_nlHistLen > 40\)/.test(B.src), true);
  check('same AI-lead exemption', /_nlWouldBlock = _nlWorked && _nlArcEmpty && !_nlAI/.test(B.src), true);
  // isAILead is a real persisted property (set at the frame merge) — checked, not assumed.
  check('the AI flag is persisted onto the merged object', /m\.isAILead = isAILead;/.test(B.src), true);
  check('...and the rate row has a leadSource fallback for paths that did not set it',
    /d\.isAILead \|\| \/ai\\s\*buying\\s\*signal\/i\.test\(d\.leadSource \|\| ''\)/.test(B.src), true);

  console.log('\nand the old row stops claiming to be always-on:');
  check('it says which grabs it speaks for', /rescue path only — see \[LP NOTES-LOAD RATE\]/.test(B.src), true);
  check('the blocking guard itself is unchanged',
    /var _notesOnlyFailure = _panelWorkedEff && _arcEmptyEff && !_eff\.isAILead;/.test(B.src), true);
  check('...and still blocks with the same message',
    /Notes didn\\'t load for this lead — refresh the page and try GRAB LEAD again/.test(B.src), true);
  check('the phantom guard is untouched too', /if \(_phantomScrape\) \{/.test(B.src), true);

  // ── FAILS OPEN ─────────────────────────────────────────────────────────────
  console.log('\nnothing here can fail a grab:');
  check('the outcome row is wrapped', /catch \(eBfo\) \{\}/.test(B.src), true);
  check('the rate row is wrapped', /catch \(eNlr\) \{\}/.test(B.src), true);
  check('the fence block is still wrapped', /catch \(eFence\) \{ \/\* the brief must ship/.test(B.src), true);
  check('a null brief does not throw', String(run(null, 'body', 'first-touch', 3).out || '').indexOf('CONVERSATION TRANSCRIPT (') > -1, true);
  check('a null transcript does not throw', run('x', null, 'first-touch', 0).out, 'x');
}

if (BUILDS.length > 1) {
  console.log('\nboth builds report identically:');
  const region = (f, o, c) => {
    const s = fs.readFileSync(f, 'utf8');
    const a = s.indexOf(o), b = s.indexOf(c, a);
    if (a < 0 || b < 0) bail('parity region not found in ' + f);
    return s.slice(a, b);
  };
  // ANCHORED ON CODE, NOT ON A LABEL. The build headers quote both diagnostic labels, and the dev
  // and commercial headers differ by design ("-dev" / "Commercial"), so a label anchor slices the
  // HEADER and reports a parity failure that is really a provenance difference. Fifth instance of
  // the prose-matching hazard this week; anchoring on a code token is the durable fix.
  check('the populateFromData diagnostics are identical',
    region(BUILDS[0], 'var _bfBrief = String(', 'catch (eNlr) {}')
    === region(BUILDS[1], 'var _bfBrief = String(', 'catch (eNlr) {}'), true);
  check('the fence suppression is identical',
    region(BUILDS[0], '      } else if (_cbHasFence', 'catch (eFence) {')
    === region(BUILDS[1], '      } else if (_cbHasFence', 'catch (eFence) {'), true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
