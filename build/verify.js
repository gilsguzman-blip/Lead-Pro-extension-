// Verification cases for: bare carrier STOP must not end a live lead.
// Every case runs the REAL shipped region via harness.js.
//
//   node verify.js dev/popup.js
//   node verify.js commercial/popup.js
//
// FIXTURES USE THE REAL PAGE SHAPES. The first version of this file fed the region
// '[CUSTOMER] STOP' and passed 20/20 while the live page still produced the farewell
// (log99). VinSolutions notes are multi-line innerText with routing headers —
//     Received from: (346) 417-5343⏎Received by: Gil Guzman⏎STOP
// — and the transcript entry is that content AFTER sanitize() collapses the newlines.
// Both forms are reproduced here; a fixture that skips the headers tests nothing.

const { buildRunner, entry, noteEl } = require('./harness.js');

const file = process.argv[2] || 'dev/popup.js';
const R = buildRunner(file);

const CUST_PHONE = '(346) 417-5343';
const AGENT = 'Gil Guzman';

// Build a lead from newest-first events, producing the transcript entries and the
// note elements exactly as the page does.
function lead(o) {
  const transcript = [], noteEls = [], notesFlat = [];
  let lastInboundMsg = '';
  let d = 12;
  for (const ev of o.events) {
    const date = '08/07/2026 ' + String(d--).padStart(2, '0') + ':00 PM';
    let raw, title, dir, who;
    if (ev.who === 'CUSTOMER') {
      raw = 'Received from: ' + CUST_PHONE + '\nReceived by: ' + AGENT + '\n' + ev.text;
      title = 'Inbound Text Message'; dir = 'inbound'; who = 'CUSTOMER';
      if (!lastInboundMsg) lastInboundMsg = raw.replace(/\s+/g, ' ').trim();
    } else if (ev.who === 'AGENT') {
      raw = 'Sent to: ' + CUST_PHONE + '\nSent by: ' + AGENT + '\n' + ev.text;
      title = 'Outbound Text Message'; dir = 'outbound'; who = 'AGENT';
    } else {
      raw = 'By: Abby Montez\n' + ev.text;
      title = 'Outbound phone call'; dir = 'outbound'; who = 'NOTE';
    }
    transcript.push(entry(date, who, title, raw));
    noteEls.push(noteEl(raw, { dir, title }));
    notesFlat.push(raw);
  }
  // Internal notes live only in the note list + scan text (not as transcript entries),
  // which is how agent call notes reach the internal-note detectors.
  for (const n of (o.internalNotes || [])) {
    noteEls.push(noteEl('By: Abby Montez\n' + n, { dir: 'outbound', title: 'Outbound phone call' }));
    notesFlat.push(n);
  }
  if (o.marker) transcript.push('[08/02/2026 03:54 AM] [=== CURRENT LEAD SUBMITTED HERE ===]');
  for (const p of (o.priorLead || [])) {
    transcript.push(entry('01/02/2025 09:00 AM', p.who, p.who === 'CUSTOMER' ? 'Inbound Text Message' : 'Outbound Text Message',
      (p.who === 'CUSTOMER' ? 'Received from: ' + CUST_PHONE + '\nReceived by: ' + AGENT + '\n' : 'Sent to: ' + CUST_PHONE + '\nSent by: ' + AGENT + '\n') + p.text));
    notesFlat.push(p.text);
  }
  return Object.assign({
    transcript, noteEls, lastInboundMsg,
    fullScanText: (transcript.join('\n') + '\n' + notesFlat.join('\n')).toLowerCase(),
    leadAgeDays: o.leadAgeDays === undefined ? 5 : o.leadAgeDays
  }, o.flags || {});
}

const CLICKNGO = 'Gerra, I saw you completed your application through Click & Go, but no vehicle is attached yet. What model are you shopping for? Kaylee Internet Sales Coordinator | Community Kia Baytown Reply STOP to cancel.';
const REMOVED  = 'You have successfully been removed from Community Auto Group text messages.';

const CASES = [
  // ---- must now suppress the farewell (SMS still off, email proceeds) ----
  {
    group: 'MUST NOW SUPPRESS FAREWELL',
    name: "Gerra's exact shape — bare STOP, current lead, 5d old, live Click & Go application",
    input: lead({
      marker: true,
      flags: { hasSystemOptOutNote: true },
      events: [
        { who: 'NOTE', text: 'Left message' },
        { who: 'AGENT', text: REMOVED },
        { who: 'CUSTOMER', text: 'STOP' },
        { who: 'AGENT', text: CLICKNGO }
      ]
    }),
    expect: { isSmsOptOut: true, smsOptOutIsExit: false, hasExitSignal: false, isSmsOptOutOnly: true }
  },
  {
    group: 'MUST NOW SUPPRESS FAREWELL',
    name: 'bare STOP on a current lead, no other exit signal present',
    input: lead({ events: [{ who: 'CUSTOMER', text: 'STOP' }, { who: 'AGENT', text: 'Following up on your inquiry' }] }),
    expect: { isSmsOptOut: true, smsOptOutIsExit: false, hasExitSignal: false, isSmsOptOutOnly: true }
  },
  {
    group: 'MUST NOW SUPPRESS FAREWELL',
    name: 'bare "stop." lowercase with trailing punctuation',
    input: lead({ events: [{ who: 'CUSTOMER', text: 'stop.' }, { who: 'AGENT', text: 'Checking in' }] }),
    expect: { isSmsOptOut: true, smsOptOutIsExit: false, hasExitSignal: false, isSmsOptOutOnly: true }
  },
  {
    group: 'MUST NOW SUPPRESS FAREWELL',
    name: 'bare STOP with the carrier system note alongside it (same event, two records)',
    input: lead({
      flags: { hasSystemOptOutNote: true },
      events: [{ who: 'AGENT', text: REMOVED }, { who: 'CUSTOMER', text: 'STOP' }, { who: 'AGENT', text: CLICKNGO }]
    }),
    expect: { isSmsOptOut: true, smsOptOutIsExit: false, hasExitSignal: false, isSmsOptOutOnly: true }
  },
  {
    group: 'MUST NOW SUPPRESS FAREWELL',
    name: 'bare STOP on a lead created TODAY (hasNewLeadToday) — STOP still honoured, no farewell',
    input: lead({
      leadAgeDays: 0,
      flags: { hasNewLeadToday: true },
      events: [{ who: 'CUSTOMER', text: 'STOP' }, { who: 'AGENT', text: CLICKNGO }]
    }),
    expect: { isSmsOptOut: true, smsOptOutIsExit: false, hasExitSignal: false, isSmsOptOutOnly: true }
  },

  // ---- must still exit — unchanged ----
  {
    group: 'MUST STILL EXIT (unchanged)',
    name: '"please stop contacting me" — written request, not a carrier keyword',
    input: lead({ events: [{ who: 'CUSTOMER', text: 'please stop contacting me' }, { who: 'AGENT', text: 'Following up' }] }),
    expect: { hasExitSignal: true, isSmsOptOutOnly: false },
    alsoRequire: { exitRawIndependent: true }
  },
  {
    group: 'MUST STILL EXIT (unchanged)',
    name: '"stop contacting me" AND a separate bare STOP text on the same lead',
    input: lead({ events: [{ who: 'CUSTOMER', text: 'STOP' }, { who: 'CUSTOMER', text: 'stop contacting me' }, { who: 'AGENT', text: 'Following up' }] }),
    expect: { hasExitSignal: true, isSmsOptOutOnly: false },
    alsoRequire: { exitRawIndependent: true }
  },
  {
    group: 'MUST STILL EXIT (unchanged)',
    name: '"I am no longer interested"',
    input: lead({ events: [{ who: 'CUSTOMER', text: 'I am no longer interested' }, { who: 'AGENT', text: 'Following up' }] }),
    expect: { hasExitSignal: true },
    alsoRequire: { exitRawIndependent: true }
  },
  {
    group: 'MUST STILL EXIT (unchanged)',
    name: '"we bought elsewhere"',
    input: lead({ events: [{ who: 'CUSTOMER', text: 'we bought elsewhere' }, { who: 'AGENT', text: 'Following up' }] }),
    expect: { hasExitSignal: true },
    alsoRequire: { exitRawIndependent: true }
  },
  {
    group: 'MUST STILL EXIT (unchanged)',
    name: '"we went with another dealer"',
    input: lead({ events: [{ who: 'CUSTOMER', text: 'we went with another dealer' }, { who: 'AGENT', text: 'Following up' }] }),
    expect: { hasExitSignal: true },
    alsoRequire: { exitRawIndependent: true }
  },
  {
    group: 'MUST STILL EXIT (unchanged)',
    name: '"take me off your list" (exitByRemoval component)',
    input: lead({ events: [{ who: 'CUSTOMER', text: 'take me off your list' }] }),
    expect: { hasExitSignal: true },
    alsoRequire: { exitByRemoval: true }
  },
  {
    group: 'MUST STILL EXIT (unchanged)',
    name: 'boughtElsewhere component — "we purchased from another dealer"',
    input: lead({ events: [{ who: 'CUSTOMER', text: 'we purchased from another dealer down the road' }] }),
    expect: { hasExitSignal: true },
    alsoRequire: { boughtElsewhere: true }
  },
  {
    group: 'MUST STILL EXIT (unchanged)',
    name: 'hasInternalSoldElsewhere component — agent note, no customer words',
    input: lead({ events: [{ who: 'AGENT', text: 'left voicemail' }], internalNotes: ['Spoke with customer, she bought elsewhere last week.'] }),
    expect: { hasExitSignal: true },
    alsoRequire: { hasInternalSoldElsewhere: true }
  },
  {
    group: 'MUST STILL EXIT (unchanged)',
    name: 'hasInternalNotInterested component — agent-recorded verbal decline',
    input: lead({ events: [{ who: 'AGENT', text: 'called customer' }], internalNotes: ['Customer stated she is not interested, no need to follow up.'] }),
    expect: { hasExitSignal: true },
    alsoRequire: { hasInternalNotInterested: true }
  },
  {
    group: 'MUST STILL EXIT (unchanged)',
    name: 'hasBereavementSignal component — death notification',
    input: lead({ events: [{ who: 'CUSTOMER', text: 'Sorry to inform you, my husband passed away last month.' }] }),
    expect: { hasExitSignal: true },
    alsoRequire: { hasBereavementSignal: true }
  },
  {
    group: 'MUST STILL EXIT (unchanged)',
    name: 'bare STOP + an independent exit signal in history — exit still wins',
    input: lead({ events: [{ who: 'CUSTOMER', text: 'STOP' }, { who: 'CUSTOMER', text: 'we already bought something else' }, { who: 'AGENT', text: 'Following up' }] }),
    expect: { hasExitSignal: true, isSmsOptOutOnly: false },
    alsoRequire: { exitRawIndependent: true }
  },

  // ---- must not regress ----
  {
    group: 'MUST NOT REGRESS',
    name: "Raul Meza's shape — prior-lead STOP below the CURRENT LEAD marker",
    input: lead({
      marker: true,
      events: [{ who: 'CUSTOMER', text: 'Interested in the 2026 RAV4, what can you do on price?' }],
      priorLead: [{ who: 'CUSTOMER', text: 'Stop' }, { who: 'AGENT', text: REMOVED }]
    }),
    expect: { isSmsOptOut: true, smsOptOutIsExit: false, hasExitSignal: false, isSmsOptOutOnly: true },
    alsoRequire: { _optOutPriorLead: true }
  },
  {
    group: 'MUST NOT REGRESS',
    name: 'no opt-out at all — ordinary live lead, untouched',
    input: lead({ events: [{ who: 'CUSTOMER', text: 'Can you send me pricing on the Telluride?' }, { who: 'AGENT', text: 'Sure' }] }),
    expect: { isSmsOptOut: false, smsOptOutIsExit: false, hasExitSignal: false, isSmsOptOutOnly: false }
  },
  {
    group: 'MUST NOT REGRESS',
    name: 'historical system-note opt-out, no bare STOP message, established lead',
    input: lead({
      flags: { hasSystemOptOutNote: true },
      events: [{ who: 'AGENT', text: 'Following up on your inquiry' }],
      internalNotes: ['SMS status has been manually changed to: Opt-Out']
    }),
    expect: { isSmsOptOut: true, smsOptOutIsExit: true, hasExitSignal: true, isSmsOptOutOnly: false }
  },
  {
    group: 'MUST NOT REGRESS',
    name: 'opt-out + explicit re-opt-in — SMS restored, no exit (hasRecentReoptIn path)',
    input: lead({
      flags: { hasSystemOptOutNote: true, hasRecentReoptIn: true },
      events: [{ who: 'AGENT', text: 'Following up' }],
      internalNotes: ['SMS status has been manually changed to: Opt-In by Abby Montez']
    }),
    expect: { isSmsOptOut: false, smsOptOutIsExit: false, isSmsOptOutOnly: false }
  },
  {
    group: 'MUST NOT REGRESS',
    name: 'Wendy Browne — bare STOP is newest with re-engagement history behind it',
    input: lead({
      events: [
        { who: 'CUSTOMER', text: 'STOP' },
        { who: 'CUSTOMER', text: 'Yes I am still interested in the Sportage' },
        { who: 'AGENT', text: 'Following up on your inquiry' }
      ]
    }),
    expect: { isSmsOptOut: true, smsOptOutIsExit: false, isSmsOptOutOnly: true }
  }
];

// The REAL render-time compliance gate, from popup.js "DETERMINISTIC SMS SUPPRESSION on
// opt-out":  _optOutNow = lastScrapedData.isSmsOptOutOnly
//                      || /^stop[\s.!]*$/i.test(String(lastScrapedData.lastInboundMsg||'').trim())
// This is the gate that FAILED on Gerra's live run, because lastInboundMsg carries the
// "Received from:/Received by:" header. Asserted per case, with the real lastInboundMsg.
function suppressedAtRender(out, lastInboundMsg) {
  return out.isSmsOptOutOnly === true || /^stop[\s.!]*$/i.test(String(lastInboundMsg || '').trim());
}

let pass = 0, fail = 0, lastGroup = '';
console.log('\n  file: ' + file + '   region: lines ' + R.lines + ' (real shipped bytes)\n');

for (const c of CASES) {
  if (c.group !== lastGroup) { console.log('  ── ' + c.group + ' ' + '─'.repeat(Math.max(0, 62 - c.group.length))); lastGroup = c.group; }
  let out, err = null;
  try { out = R.run(c.input); } catch (e) { err = e; }

  const checks = Object.assign({}, c.expect, c.alsoRequire || {});
  const bad = [];
  let smsState = '?';
  if (err) {
    bad.push('threw: ' + err.message);
  } else {
    for (const k of Object.keys(checks)) {
      if (out[k] !== checks[k]) bad.push(k + '=' + out[k] + ' (want ' + checks[k] + ')');
    }
    // COMPLIANCE INVARIANT, asserted on every case against the REAL render-time gate:
    // if the customer is opted out, the SMS field must actually be blanked.
    const rendered = suppressedAtRender(out, c.input.lastInboundMsg);
    if (out.isSmsOptOut === true && !rendered && out.hasExitSignal !== true) {
      bad.push('COMPLIANCE: opted out but render-time gate does NOT suppress SMS');
    }
    smsState = out.isSmsOptOut
      ? (rendered ? 'SUPPRESSED (render gate fires)' : (out.hasExitSignal ? 'exit close' : '⚠ NOT SUPPRESSED'))
      : 'n/a — no opt-out';
  }

  if (bad.length) { fail++; console.log('  ✗ ' + c.name); bad.forEach(b => console.log('      ' + b)); }
  else { pass++; console.log('  ✓ ' + c.name); }
  if (!err) console.log('      exit=' + out.hasExitSignal + '  optOutOnly=' + out.isSmsOptOutOnly + '  smsOptOutIsExit=' + out.smsOptOutIsExit + '  SMS: ' + smsState);
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
