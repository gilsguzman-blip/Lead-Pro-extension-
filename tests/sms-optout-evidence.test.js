// (v9.7.696) SMS IS ALWAYS DRAFTED; OPT-OUT EVIDENCE IS REPORTED, NEVER ACTED ON.
//
// Gil, 9/23 (superseding the v9.7.695 P1 ruling the same day): "lose the opt in/opt out logic and
// just have an SMS generated regardless ... I'll put the onus on the agent to decide when to send."
//   - no build path blanks the SMS field for opt-out, adds an opt-out block to the prompt, or turns
//     a STOP into exit / opt-out framing;
//   - the marker-scoped evidence scan from v9.7.695 survives as smsOptOutEvidence, for the agent's
//     notice and [LP SMS OPT-OUT EVIDENCE DIAG] only, and its scoping is still asserted.
//
// HOW: the REAL shipped scraper region — from `var filteredTranscript = transcript.filter(` through
// `const isSmsOptOutOnly = …;` — is sliced out of popup.js and executed against fake CRM notes; the
// render-time code is checked for any opt-out blank. Run against v9.7.695 it fails: that build blanks.
//
// Usage: node tests/sms-optout-evidence.test.js <dev popup.js> <commercial popup.js>
'use strict';
const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);
if (!files.length) files.push('builds/dev/popup.js', 'builds/commercial/popup.js');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ok   ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }

// ── fake CRM ─────────────────────────────────────────────────────────────────────────────────
const PHONE = '(555) 010-0199';
function note(date, title, content, dir) {
  const map = {
    '.notes-and-hsitory-item-date': { innerText: date },
    '.legacy-notes-and-history-title': { innerText: title },
    '.notes-and-history-item-content': { innerText: content, textContent: content },
  };
  return { getAttribute: (k) => (k === 'data-direction' ? (dir || '') : null),
           querySelector: (s) => map[s] || null };
}
const custText = (date, body) => ({
  note: note(date, 'Inbound Text Message', 'Received from: ' + PHONE + '\nReceived by: Test Agent\n' + body, 'inbound'),
  line: '[' + date + '] [CUSTOMER] Inbound Text Message\n  Received from: ' + PHONE + ' Received by: Test Agent ' + body,
});
const outText = (date, body) => ({
  note: note(date, 'Outbound Text Message', 'By: Test Agent\n' + body, 'outbound'),
  line: '[' + date + '] [AGENT] Outbound Text Message\n  By: Test Agent ' + body,
});
const statusNote = (date, what, num) => ({
  // SMS status notes are stripped from the transcript by the scraper (the v9.7.x skip at the
  // "sms status … opt.?out" test), so they carry no transcript line — exactly like production.
  note: note(date, 'SMS Status', 'SMS status has been manually changed to: ' + what + (num ? ' for ' + num : '') + ' by System', ''),
  line: null,
});
const MARKER_DATE = '09/10/2026 9:00 AM';
const marker = () => ({
  note: note(MARKER_DATE, 'Lead Received', 'Lead received', ''),
  line: '[' + MARKER_DATE + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.',
  isMarker: true,
});

// Entries are given NEWEST FIRST, as the CRM renders them.
function lead(entries, opts) {
  opts = opts || {};
  const hasMarker = entries.some((e) => e.isMarker);
  return {
    noteEls: entries.map((e) => e.note),
    transcript: entries.filter((e) => e.line).map((e) => e.line),
    lastInboundMsg: (entries.find((e) => e.line && e.line.indexOf('[CUSTOMER]') > -1) || { line: '' }).line
      .replace(/^[^\n]*\n\s*/, '').replace(/Received (from|by): \S+( \S+)?\s*/g, '').trim(),
    hasNewLeadToday: !!opts.hasNewLeadToday,
    markerMs: hasMarker ? new Date(MARKER_DATE).getTime() : 0,
    markerDate: hasMarker ? MARKER_DATE : '',
  };
}

// ── extraction ───────────────────────────────────────────────────────────────────────────────
function extract(src) {
  const a = src.indexOf('    var filteredTranscript = transcript.filter(function(line){');
  const endTok = 'const isSmsOptOutOnly = isSmsOptOut && !smsOptOutIsExit && !hasExitSignal;';
  const b = src.indexOf(endTok, a);
  if (a < 0 || b < 0) throw new Error('opt-out region NOT FOUND — extraction failed (anchors moved?)');
  const body = src.slice(a, b + endTok.length);
  const hasFlag = /\bsmsOptOutEvidence\s*=/.test(body);
  const fn = new Function('__s',
    'var transcript=__s.transcript, noteEls=__s.noteEls, phone=__s.phone, _lpD=function(){},' +
    ' transcriptCutoffMs=0, _lpLineIsBeforeCutoff=function(){return false;},' +
    ' hasNewLeadToday=__s.hasNewLeadToday, leadAgeDays=3, _leadAgeScraped=true,' +
    ' _lpMarkerMs=__s.markerMs, _lpMarkerDate=__s.markerDate, lastInboundMsg=__s.lastInboundMsg;\n' +
    body + '\n' +
    'return { evidence: (typeof smsOptOutEvidence === "undefined" ? undefined : smsOptOutEvidence),' +
    ' diag: (typeof _smsOptOutDiag === "undefined" ? null : _smsOptOutDiag),' +
    ' isSmsOptOutOnly: isSmsOptOutOnly, hasExitSignal: hasExitSignal };');
  return { run: (L) => fn(Object.assign({ phone: PHONE }, L)), hasFlag };
}



const CASES = [
  // [name, lead, live evidence expected]
  ['prior-lead STOP only (below the marker)', () => lead([outText('09/11/2026 10:00 AM', 'Hi, following up.'), marker(), custText('01/05/2025 2:00 PM', 'STOP')]), false],
  ['prior-lead system opt-out note only', () => lead([outText('09/11/2026 10:00 AM', 'Hi.'), marker(), statusNote('01/05/2025 2:01 PM', 'Opt-Out')]), false],
  ['current-lead bare STOP', () => lead([custText('09/15/2026 3:00 PM', 'STOP'), outText('09/14/2026 10:00 AM', 'What model?'), marker()]), true],
  ['current-lead opt-out note, then "still looking, email me instead"', () => lead([custText('09/16/2026 9:00 AM', 'Still looking, email me instead please'), statusNote('09/15/2026 3:01 PM', 'Opt-Out'), marker()]), true],
  ['single-lead record (no marker): opt-out note', () => lead([custText('09/16/2026 9:00 AM', 'Still looking, email me instead please'), statusNote('09/15/2026 3:01 PM', 'Opt-Out')]), true],
  ['current-lead opt-out, then a NEWER opt-in note', () => lead([statusNote('09/17/2026 11:00 AM', 'Opt-In'), statusNote('09/15/2026 3:01 PM', 'Opt-Out'), marker()]), false],
  ['current-lead STOP, then START', () => lead([custText('09/17/2026 11:00 AM', 'START'), custText('09/15/2026 3:00 PM', 'STOP'), marker()]), false],
  ['a re-opt-in OLDER than the current opt-out', () => lead([statusNote('09/16/2026 3:01 PM', 'Opt-Out'), statusNote('09/12/2026 11:00 AM', 'Opt-In'), marker()]), true],
  ['our own "Reply YES to confirm" after a current opt-out', () => lead([outText('09/16/2026 4:00 PM', 'Reply YES to confirm your appointment'), statusNote('09/15/2026 3:01 PM', 'Opt-Out'), marker()]), true],
  ['opt-out note naming a different phone number', () => lead([statusNote('09/15/2026 3:01 PM', 'Opt-Out', '(555) 010-0142'), marker()]), false],
  ['no opt-out evidence anywhere', () => lead([custText('09/15/2026 3:00 PM', 'Is the Civic still there?'), outText('09/14/2026 10:00 AM', 'Hi.'), marker()]), false],
];

for (const f of files) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');   // comments (and build headers) quote old code
  let X;
  try { X = extract(src); } catch (e) { ok(false, 'extract: ' + e.message); continue; }
  ok(X.hasFlag, 'the scraper region still computes the marker-scoped evidence (smsOptOutEvidence)');

  console.log('  evidence scoping (informational flag):');
  for (const [name, L, want] of CASES) {
    let out; try { out = X.run(L()); } catch (e) { ok(false, name + ' — region threw: ' + e.message); continue; }
    ok(out.evidence === want, '  ' + name + ' → liveEvidence:' + want);
  }

  console.log('  opt-out shapes NOTHING — no framing, no farewell, on any of them:');
  const framing = CASES.map(([name, L]) => { const o = X.run(L()); return !o.isSmsOptOutOnly && !o.hasExitSignal; });
  ok(framing.every(Boolean), '  isSmsOptOutOnly:false and hasExitSignal:false on all ' + CASES.length + ' shapes');
  ok((() => { const o = X.run(lead([custText('09/15/2026 3:00 PM', 'please stop contacting me, not interested'), marker()])); return o.hasExitSignal; })(),
     '  …but a WRITTEN "stop contacting me, not interested" still exits (exitRaw owns that, not opt-out)');

  console.log('  the SMS is never blanked and the prompt carries no opt-out block:');
  ok(!/parsed\.sms = '';/.test(code.slice(code.indexOf('var rawSms   = flattenField') - 3000, code.indexOf('var rawSms   = flattenField'))),
     '  no render-time blank of parsed.sms before the SMS is flattened');
  ok(code.indexOf('SMS suppressed deterministically') === -1, '  the deterministic-suppression path is gone');
  ok(code.indexOf("SMS CHANNEL OVERRIDE: Customer opted out of SMS texts") === -1, '  no SMS CHANNEL OVERRIDE scenario line');
  ok(code.indexOf('TOP-PRIORITY DIRECTIVE — SMS OPT-OUT') === -1, '  no TOP-PRIORITY SMS OPT-OUT block');
  ok(code.indexOf("'⚠ SMS STATUS:") === -1, '  no SMS STATUS line in the LEAD section');
  ok(/var isSmsOptOut = false;/.test(code), '  isSmsOptOut is false on every lead');

  console.log('  the agent is told, the console says why:');
  const isA = src.indexOf('\n  function inlineScraper() {'), isB = src.indexOf('\n  } // end inlineScraper');
  const outside = (needle) => { const i = src.indexOf(needle); return i > -1 && (i < isA || i > isB); };
  ok(outside('function _lpSmsOptOutDiagLine(') && outside("_lpSmsOptOutDiagLine(m, '(grab)')") && outside("_lpSmsOptOutDiagLine(lastScrapedData, '(render)')"),
     '  [LP SMS OPT-OUT EVIDENCE DIAG] is defined and called outside inlineScraper (popup console)');
  ok(/if \(lastScrapedData && lastScrapedData\.smsOptOutEvidence\) \{[\s\S]{0,300}Your call whether to text\./.test(code),
     '  a notice (never a block) tells the agent when this lead has live opt-out evidence');
  ok(/smsOptOutEvidence:\s+lastScrapedData \? !!lastScrapedData\.smsOptOutEvidence : false/.test(code), '  the flag is bridged to the prompt-data object');
  try {
    const fa = src.indexOf('function _lpSmsOptOutDiagLine('); const fb = src.indexOf('\n}\n', fa);
    const diagFn = new Function(src.slice(fa, fb + 2) + '\nreturn _lpSmsOptOutDiagLine;')();
    const o = X.run(CASES[0][1]());
    const line = diagFn({ smsOptOutEvidence: o.evidence, _smsOptOutDiag: o.diag }, '(test)');
    ok(/liveEvidence:false/.test(line) && /informational — SMS is always drafted/.test(line) && /\[prior\]/.test(line),
       '  diag line: ' + line.slice(0, 140) + '…');
  } catch (e) { ok(false, '  diag function executes: ' + e.message); }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
