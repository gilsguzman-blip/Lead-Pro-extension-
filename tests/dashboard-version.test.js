#!/usr/bin/env node
'use strict';
// (v9.7.611) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('dashboard-version.test.js');

/**
 * dashboard-version.test.js — dashboard v1.6. A STALE DEPLOY MUST NOT LOOK LIKE A LIVE DEFECT.
 *
 * 9/17. The deployed dashboard reported "Explicit 👍 479 / Explicit 👎 16". The reporter, reading
 * the same KV rows for the same day, reported 38 and 0. Two artefacts, one truth, and the raw
 * feedback export agreed with the dashboard's 16 — so the reporter looked broken and was very
 * nearly "fixed".
 *
 * THE REPORTER WAS RIGHT. Its own Signal Type table settles it without needing the export:
 *
 *     implicit regen no copy   14
 *     implicit chip no copy     2   -> 16
 *
 * Those sixteen are the export's sixteen. _lpFeedbackDeriveRating returns 'down' for BOTH an
 * explicit thumb and a regenerated-or-chipped-then-abandoned session (since v9.7.540), so a count
 * of rating==='down' is not a count of thumbs. Only `signal` separates them, which is the whole
 * subject of dashboard v1.2 and reporter v1.8/v1.10.
 *
 * AND THIS PAGE HAS BEEN CORRECT SINCE v1.2 — dashboard-explicit-down and dashboard-render have
 * pinned it ever since. The repo could not have rendered that tile. What was deployed was simply
 * OLDER THAN THE FIX, and no version was rendered anywhere, so the only way to tell was to notice
 * which tiles the snapshot did and did not have ("Positive Rate" where v1.3 renders "Shipped
 * Rate", no v1.2 disclosure line, no v1.4 incentives panel).
 *
 * That is the gap this file closes. It does not re-test the split; it asserts the page states a
 * version, that the version matches the newest block in the page's own header, and that the
 * marker rides in the footer where a screenshot will always carry it.
 *
 *   usage: dashboard-version.test.js <dashboard.html>
 */
const fs = require('fs');

const HTML = process.argv[2];
if (!HTML) { console.error('usage: dashboard-version.test.js <dashboard.html>'); process.exit(2); }
const html = fs.readFileSync(HTML, 'utf8');

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + JSON.stringify(want)
                             + '\n        got      ' + JSON.stringify(got)); }
}

console.log('\ndashboard v1.6 — the page states which page it is');

// ── (1) THE MARKER EXISTS AND IS REACHABLE ──────────────────────────────────
console.log('\n(1) the version constant and its rendering:');

const decl = html.match(/const DASH_VERSION = '(v\d+\.\d+)';/);
eq('a DASH_VERSION constant is declared', !!decl, true);
eq('...exactly once, so there is one answer to "which version is this"',
  (html.match(/const DASH_VERSION\s*=/g) || []).length, 1);
eq('the footer renders it rather than hard-coding a literal',
  /Data via leadpro-proxy KV · dashboard ' \+ DASH_VERSION/.test(html), true);
// A marker anywhere else can be cropped out of a screenshot; the footer is in every full capture.
eq('it rides in the footer block, below every panel',
  html.indexOf('DASH_VERSION') < html.lastIndexOf('DASH_VERSION')
  && html.lastIndexOf('DASH_VERSION') > html.indexOf("'LeadPro · Community Auto Group"), true);

// ── (2) IT TRACKS THE HEADER, WHICH IS WHAT KEEPS IT HONEST ─────────────────
console.log('\n(2) the marker cannot drift from the changelog above it:');

const blocks = [...html.matchAll(/^  v(\d+)\.(\d+) — /gm)].map(m => [+m[1], +m[2]]);
eq('the header carries versioned blocks at all', blocks.length > 0, true);
blocks.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const newest = 'v' + blocks[blocks.length - 1].join('.');
eq('DASH_VERSION equals the newest block in the page header', decl && decl[1], newest);

// The point of the pairing: bumping one without the other must fail here rather than ship a page
// that misreports its own age, which is the exact failure this file exists for.
const bumpedHeaderOnly = html.replace(/^  v1\.6 — /m, '  v1.7 — ');
const nb = [...bumpedHeaderOnly.matchAll(/^  v(\d+)\.(\d+) — /gm)].map(m => [+m[1], +m[2]])
  .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
eq('neuter: a header bumped without the constant would now disagree',
  decl[1] === 'v' + nb[nb.length - 1].join('.'), false);
eq('control: the shipped pair agrees', decl[1] === newest, true);

// ── (3) WHAT THE 9/17 CONFUSION ACTUALLY WAS ────────────────────────────────
// Pinned as arithmetic so the conclusion survives without the artefacts. A count of down-ratings
// is not a count of thumbs, and the reporter's own signal table proves which it had.
console.log('\n(3) the 9/17 reconciliation, as arithmetic:');

const REPORTER_9_17 = {           // read off the 19:57 CT snapshot
  explicitUp: 38, explicitDown: 0,
  signals: { implicit_copy: 434, no_interaction: 78, explicit: 38,
             implicit_regen_copy: 17, implicit_regen_no_copy: 14, implicit_chip_no_copy: 2 }
};
const EXPORT_DOWN_ROWS = 16;      // rating === 'down' rows in the KV export for the same day

eq('the implicit rejection signals account for every down-rating',
  REPORTER_9_17.signals.implicit_regen_no_copy + REPORTER_9_17.signals.implicit_chip_no_copy,
  EXPORT_DOWN_ROWS);
eq('...so zero of them were thumb presses, which is what the reporter said',
  REPORTER_9_17.explicitDown, 0);
eq('a down-rating count is therefore NOT a thumbs-down count',
  EXPORT_DOWN_ROWS === REPORTER_9_17.explicitDown, false);
// The dashboard tile that started this read 479 with "+441 implicit copy" beneath it. 479 is every
// positive signal, not the explicit ones — and the difference is exactly the reporter's figure.
eq('and 479 minus its own implicit sub-line is the reporter\'s explicit 👍',
  479 - 441, REPORTER_9_17.explicitUp);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
