// (v9.7.695) P1 — ONE MARKER-SCOPED SMS-SUPPRESSION FLAG.
//
// Gil's ruling, 9/23:
//   - opt-out evidence only BELOW the CURRENT LEAD marker (a prior lead) is superseded: SMS drafted,
//     and it does not drive exit/farewell framing either;
//   - opt-out evidence ABOVE the marker (this lead) suppresses SMS whatever else the customer wrote;
//   - an explicit re-opt-in NEWER than the newest current-lead opt-out clears it;
//   - no marker: all evidence is current (fail safe).
//
// HOW: the REAL shipped scraper region — from `var filteredTranscript = transcript.filter(` through
// `const isSmsOptOutOnly = …;` — is sliced out of popup.js and executed against fake CRM notes. The
// verdict on each lead is what the RENDER-TIME BLANK would do with that build's output. On a build
// without smsSuppressed (v9.7.694 and earlier) the blank is evaluated with that build's own formula,
// sliced from the same file, so running this suite against v9.7.694 shows which cases it got wrong.
//
// Usage: node tests/sms-suppress.test.js <dev popup.js> <commercial popup.js>
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
  const hasFlag = /\bsmsSuppressed\s*=/.test(body);
  const fn = new Function('__s',
    'var transcript=__s.transcript, noteEls=__s.noteEls, phone=__s.phone, _lpD=function(){},' +
    ' transcriptCutoffMs=0, _lpLineIsBeforeCutoff=function(){return false;},' +
    ' hasNewLeadToday=__s.hasNewLeadToday, leadAgeDays=3, _leadAgeScraped=true,' +
    ' _lpMarkerMs=__s.markerMs, _lpMarkerDate=__s.markerDate, lastInboundMsg=__s.lastInboundMsg;\n' +
    body + '\n' +
    'return { smsSuppressed: (typeof smsSuppressed === "undefined" ? undefined : smsSuppressed),' +
    ' diag: (typeof _smsSuppressDiag === "undefined" ? null : _smsSuppressDiag),' +
    ' isSmsOptOutOnly: isSmsOptOutOnly, hasExitSignal: hasExitSignal };');
  return { run: (L) => fn(Object.assign({ phone: PHONE }, L)), hasFlag };
}

// What the render-time blank does with a build's output. New builds: the flag, alone. Old builds:
// their own shipped formula (isSmsOptOutOnly || bare STOP in lastInboundMsg), sliced to confirm.
function blankFor(src, out, L) {
  const m = src.match(/var _optOutNow = !!\(lastScrapedData && ([\s\S]*?)\);\n/);
  if (!m) throw new Error('render-time blank NOT FOUND');
  const expr = m[1];
  const lastScrapedData = { smsSuppressed: out.smsSuppressed, isSmsOptOutOnly: out.isSmsOptOutOnly, lastInboundMsg: L.lastInboundMsg };
  return !!(lastScrapedData && new Function('lastScrapedData', 'return (' + expr + ');')(lastScrapedData));
}

const CASES = [
  { name: 'prior-lead STOP only (below the marker), new lead has our outbound and no reply → SMS drafted',
    L: () => lead([outText('09/11/2026 10:00 AM', 'Hi, this is Test Agent following up on your inquiry.'), marker(),
                   custText('01/05/2025 2:00 PM', 'STOP')]),
    suppressed: false, exit: false, optOutOnly: false },
  { name: 'prior-lead system opt-out note only → SMS drafted, and no farewell',
    L: () => lead([outText('09/11/2026 10:00 AM', 'Following up on the Civic.'), marker(),
                   statusNote('01/05/2025 2:01 PM', 'Opt-Out')]),
    suppressed: false, exit: false, optOutOnly: false },
  { name: 'current-lead bare STOP → suppressed (Gerra shape: opt-out-only framing, no farewell)',
    L: () => lead([custText('09/15/2026 3:00 PM', 'STOP'), outText('09/14/2026 10:00 AM', 'What model are you shopping for?'), marker()]),
    suppressed: true, exit: false, optOutOnly: true },
  { name: 'PATH A: current-lead opt-out status note, then "still looking, email me instead" → suppressed',
    L: () => lead([custText('09/16/2026 9:00 AM', 'Still looking, email me instead please'),
                   statusNote('09/15/2026 3:01 PM', 'Opt-Out'), outText('09/14/2026 10:00 AM', 'Checking in.'), marker()]),
    suppressed: true },
  { name: 'PATH A on a single-lead record (no marker): opt-out note, then "still looking, email me instead" → suppressed',
    // v9.7.694 got this one wrong: smsOptOutIsExit:true (not bare, no marker), hasExitSignal:false
    // ("still looking" cancels the exit), so isSmsOptOutOnly:false — neither popup flag went true.
    // With a marker it passed only by accident: status notes never reach the transcript, so the old
    // marker scan filed a CURRENT-lead status note as prior-lead evidence.
    L: () => lead([custText('09/16/2026 9:00 AM', 'Still looking, email me instead please'),
                   statusNote('09/15/2026 3:01 PM', 'Opt-Out'), outText('09/14/2026 10:00 AM', 'Checking in.')]),
    suppressed: true },
  { name: 'current-lead opt-out, then an explicit opt-in status note → SMS drafted',
    L: () => lead([statusNote('09/17/2026 11:00 AM', 'Opt-In'), statusNote('09/15/2026 3:01 PM', 'Opt-Out'),
                   outText('09/14/2026 10:00 AM', 'Checking in.'), marker()]),
    suppressed: false },
  { name: 'current-lead STOP, then the customer texts START → SMS drafted',
    L: () => lead([custText('09/17/2026 11:00 AM', 'START'), custText('09/15/2026 3:00 PM', 'STOP'), marker()]),
    suppressed: false },
  { name: 'a re-opt-in OLDER than the current opt-out does not clear it → suppressed',
    L: () => lead([statusNote('09/16/2026 3:01 PM', 'Opt-Out'), statusNote('09/12/2026 11:00 AM', 'Opt-In'),
                   outText('09/11/2026 10:00 AM', 'Checking in.'), marker()]),
    suppressed: true },
  { name: 'our own outbound "Reply YES to confirm" after a current opt-out is NOT a re-opt-in → suppressed',
    L: () => lead([outText('09/16/2026 4:00 PM', 'Reply YES to confirm your appointment'),
                   statusNote('09/15/2026 3:01 PM', 'Opt-Out'), marker()]),
    suppressed: true },
  { name: 'NO marker: an old system opt-out note counts as current (fail safe), even on a lead created today',
    L: () => lead([outText('09/22/2026 10:00 AM', 'Thanks for your inquiry.'), statusNote('01/05/2025 2:01 PM', 'Opt-Out')],
                  { hasNewLeadToday: true }),
    suppressed: true },
  { name: 'current-lead opt-out on a lead created today → still suppressed ("created today" is not an input)',
    L: () => lead([statusNote('09/22/2026 9:30 AM', 'Opt-Out'), marker()], { hasNewLeadToday: true }),
    suppressed: true },
  { name: 'opt-out status note naming a DIFFERENT phone number → not this customer, SMS drafted',
    L: () => lead([statusNote('09/15/2026 3:01 PM', 'Opt-Out', '(555) 010-0142'), outText('09/14/2026 10:00 AM', 'Hi.'), marker()]),
    suppressed: false },
  { name: 'current-lead "please stop texting me, email is fine" → suppressed',
    L: () => lead([custText('09/15/2026 3:00 PM', 'please stop texting me, email is fine'), outText('09/14/2026 10:00 AM', 'Hi.'), marker()]),
    suppressed: true },
  { name: 'current-lead STOP, then a later question → still suppressed, and NO farewell is added',
    // Measured: making the framing flag equal to smsSuppressed turned this into an exit. Framing keeps
    // its pre-695 flags by ruling; only the channel follows the new rule.
    L: () => lead([custText('09/17/2026 11:00 AM', 'is the civic still there?'), custText('09/15/2026 3:00 PM', 'STOP'),
                   outText('09/14/2026 10:00 AM', 'Hi.'), marker()]),
    suppressed: true, exit: false },
  { name: 'no opt-out evidence anywhere → SMS drafted',
    L: () => lead([custText('09/15/2026 3:00 PM', 'Is the Civic still there?'), outText('09/14/2026 10:00 AM', 'Hi.'), marker()]),
    suppressed: false },
];

for (const f of files) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  let X;
  try { X = extract(src); } catch (e) { ok(false, 'extract: ' + e.message); continue; }
  ok(X.hasFlag, 'the scraper region computes smsSuppressed');
  for (const c of CASES) {
    const L = c.L();
    let out;
    try { out = X.run(L); } catch (e) { ok(false, c.name + ' — region threw: ' + e.message); continue; }
    const blank = blankFor(src, out, L);
    ok(blank === c.suppressed, c.name + '  [render blank: ' + blank + ']');
    if ('exit' in c) ok(out.hasExitSignal === c.exit, '    …and hasExitSignal is ' + c.exit);
    if ('optOutOnly' in c) ok(out.isSmsOptOutOnly === c.optOutOnly, '    …and isSmsOptOutOnly is ' + c.optOutOnly + ' (framing unchanged)');
    if (X.hasFlag && out.diag) {
      ok(out.diag.smsSuppressed === c.suppressed, '    …and the diag object records the same verdict');
    }
  }

  // ── popup-side consumers read only the flag ──────────────────────────────────────────────
  const isA = src.indexOf('\n  function inlineScraper() {');
  const isB = src.indexOf('\n  } // end inlineScraper');
  const outside = (needle) => { const i = src.indexOf(needle); return i > -1 && (i < isA || i > isB); };
  ok(/var _optOutNow = !!\(lastScrapedData && lastScrapedData\.smsSuppressed\);/.test(src),
     'render-time blank reads lastScrapedData.smsSuppressed and nothing else');
  ok(/if \(data\.smsSuppressed\) \{\n    scenarioRules = scenarioRules \+ '\\nSMS CHANNEL OVERRIDE/.test(src),
     'the SMS CHANNEL OVERRIDE scenario line is keyed on data.smsSuppressed alone');
  ok(/data\.smsSuppressed\n      \? \(data\.isSmsOptOutOnly/.test(src), 'the LEAD-section SMS STATUS line is keyed on data.smsSuppressed');
  ok(/smsSuppressed:\s+lastScrapedData \? !!lastScrapedData\.smsSuppressed : false/.test(src),
     'the prompt-data literal bridges smsSuppressed (the v9.7.81 missing-prop class)');
  ok(/isSmsOptOutOnly, smsSuppressed, _smsSuppressDiag,/.test(src), 'the scraper returns smsSuppressed and its diag');
  ok(/var _wasOptOut = !!\(lastScrapedData && lastScrapedData\.smsSuppressed\);/.test(src), 'the empty-SMS-pane caption uses the same flag');
  const code = src.split('\n').filter((l) => !/^\/\/ Lead Pro -- popup\.js/.test(l)).join('\n');   // build headers quote old code
  ok(code.indexOf("SMS = generate a very short opt-out confirmation") === -1,
     'the TOP-PRIORITY block no longer asks for an SMS the blank discards');

  // ── the diag is popup-side and says what it saw ──────────────────────────────────────────
  ok(outside('function _lpSmsSuppressDiagLine(') && outside("_lpSmsSuppressDiagLine(m, '(grab)')")
     && outside("_lpSmsSuppressDiagLine(lastScrapedData, '(render)')"),
     '[LP SMS SUPPRESS DIAG] is defined and called outside inlineScraper (popup console)');
  try {
    const fa = src.indexOf('function _lpSmsSuppressDiagLine(');
    const fb = src.indexOf('\n}\n', fa);
    const diagFn = new Function(src.slice(fa, fb + 2) + '\nreturn _lpSmsSuppressDiagLine;')();
    const out = X.run(CASES[0].L());
    const line = diagFn({ smsSuppressed: out.smsSuppressed, _smsSuppressDiag: out.diag }, '(test)');
    ok(/smsSuppressed:false/.test(line) && /\[prior\]/.test(line) && /marker:found \(09\/10\/2026 9:00 AM\)/.test(line)
       && /current:0 prior:[1-9]/.test(line), 'diag line names the evidence, its side of the marker, and the verdict: ' + line.slice(0, 150) + '…');
    const out2 = X.run(CASES[3].L());
    const line2 = diagFn({ smsSuppressed: out2.smsSuppressed, _smsSuppressDiag: out2.diag }, '(test)');
    ok(/smsSuppressed:true/.test(line2) && /opt-out status note 09\/15\/2026 3:01 PM \[current\]/.test(line2), 'diag line on path A: ' + line2.slice(0, 150) + '…');
    const line3 = diagFn({ smsSuppressed: false, _smsSuppressDiag: null }, '(test)');
    ok(/no scraper detail/.test(line3), 'diag line when no notes frame merged says so rather than printing nothing');
  } catch (e) { ok(false, 'diag function executes: ' + e.message); }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
