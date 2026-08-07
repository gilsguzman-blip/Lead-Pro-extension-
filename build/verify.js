// Verification cases for: bare carrier STOP must not end a live lead.
// Every case runs the REAL shipped region via harness.js.
//
//   node verify.js dev/popup.js
//   node verify.js commercial/popup.js

const { buildRunner } = require('./harness.js');

const file = process.argv[2] || 'dev/popup.js';
const R = buildRunner(file);

// ── Fixtures ────────────────────────────────────────────────────────────────
// Gerra Bell — Community Kia Baytown, lead 2061540346, 5 days old, 8/7.
// Completed a credit application through Click & Go; the outbound asked which
// model she was shopping. Her entire reply was the single word STOP.
const GERRA = {
  leadAgeDays: 5,
  transcript: [
    '[CUSTOMER] STOP',
    "[AGENT] I saw you completed your application through Click & Go, but no vehicle is attached yet. What model are you shopping for?",
    '[SYSTEM] CURRENT LEAD SUBMITTED HERE',
    '[SYSTEM] Click & Go credit application completed'
  ],
  notes: ['Click & Go application received - no vehicle attached']
};

// Raul Meza — STOP on a PRIOR lead (below the CURRENT LEAD marker), new inquiry above it.
const RAUL = {
  leadAgeDays: 2,
  transcript: [
    '[CUSTOMER] Interested in the 2026 RAV4, what can you do on price?',
    '[SYSTEM] CURRENT LEAD SUBMITTED HERE',
    '[CUSTOMER] Stop',
    '[SYSTEM] Customer successfully removed from text messages'
  ]
};

function base(o) { return Object.assign({ leadAgeDays: 4 }, o); }

// ── Cases ───────────────────────────────────────────────────────────────────
// expect: what must hold AFTER the fix. `unchanged` documents pre-fix parity.
const CASES = [
  // ---- must now suppress the farewell (SMS still off, email proceeds) ----
  {
    group: 'MUST NOW SUPPRESS FAREWELL',
    name: "Gerra's exact shape — bare STOP, current lead, 5d old, live Click & Go application",
    input: GERRA,
    expect: { isSmsOptOut: true, smsOptOutIsExit: false, hasExitSignal: false, isSmsOptOutOnly: true }
  },
  {
    group: 'MUST NOW SUPPRESS FAREWELL',
    name: 'bare STOP on a current lead, no other exit signal present',
    input: base({ transcript: ['[CUSTOMER] STOP', '[AGENT] Following up on your inquiry'] }),
    expect: { isSmsOptOut: true, smsOptOutIsExit: false, hasExitSignal: false, isSmsOptOutOnly: true }
  },
  {
    group: 'MUST NOW SUPPRESS FAREWELL',
    name: 'bare "stop." lowercase with trailing punctuation',
    input: base({ transcript: ['[CUSTOMER] stop.', '[AGENT] Checking in'] }),
    expect: { isSmsOptOut: true, smsOptOutIsExit: false, hasExitSignal: false, isSmsOptOutOnly: true }
  },
  {
    group: 'MUST NOW SUPPRESS FAREWELL',
    name: 'bare STOP that ALSO produced a carrier system note (same event, two records)',
    input: base({
      transcript: ['[CUSTOMER] STOP', '[AGENT] What model are you shopping for?'],
      notes: ['Customer successfully removed from text messages'],
      hasSystemOptOutNote: true
    }),
    expect: { isSmsOptOut: true, smsOptOutIsExit: false, hasExitSignal: false, isSmsOptOutOnly: true }
  },

  // ---- must still exit — unchanged ----
  {
    group: 'MUST STILL EXIT (unchanged)',
    name: '"please stop contacting me" — written request, not a carrier keyword',
    input: base({ transcript: ['[CUSTOMER] please stop contacting me', '[AGENT] Following up'] }),
    expect: { hasExitSignal: true, isSmsOptOutOnly: false },
    alsoRequire: { exitRawIndependent: true }   // stands on its own, per the instructions
  },
  {
    group: 'MUST STILL EXIT (unchanged)',
    name: '"stop contacting me" AND a separate bare STOP text on the same lead',
    input: base({
      transcript: ['[CUSTOMER] STOP', '[CUSTOMER] stop contacting me', '[AGENT] Following up']
    }),
    expect: { hasExitSignal: true, isSmsOptOutOnly: false },
    alsoRequire: { exitRawIndependent: true }
  },
  {
    group: 'MUST STILL EXIT (unchanged)',
    name: '"I am no longer interested"',
    input: base({ transcript: ['[CUSTOMER] I am no longer interested', '[AGENT] Following up'] }),
    expect: { hasExitSignal: true },
    alsoRequire: { exitRawIndependent: true }
  },
  {
    group: 'MUST STILL EXIT (unchanged)',
    name: '"we bought elsewhere"',
    input: base({ transcript: ['[CUSTOMER] we bought elsewhere', '[AGENT] Following up'] }),
    expect: { hasExitSignal: true },
    alsoRequire: { exitRawIndependent: true }
  },
  {
    group: 'MUST STILL EXIT (unchanged)',
    name: '"we went with another dealer"',
    input: base({ transcript: ['[CUSTOMER] we went with another dealer', '[AGENT] Following up'] }),
    expect: { hasExitSignal: true },
    alsoRequire: { exitRawIndependent: true }
  },
  {
    group: 'MUST STILL EXIT (unchanged)',
    name: '"take me off your list" (exitByRemoval component alone)',
    input: base({ transcript: ['[CUSTOMER] take me off your list'] }),
    expect: { hasExitSignal: true },
    alsoRequire: { exitByRemoval: true }
  },
  {
    group: 'MUST STILL EXIT (unchanged)',
    name: 'boughtElsewhere component alone — "we purchased from another dealer"',
    input: base({ transcript: ['[CUSTOMER] we purchased from another dealer down the road'] }),
    expect: { hasExitSignal: true },
    alsoRequire: { boughtElsewhere: true }
  },
  {
    group: 'MUST STILL EXIT (unchanged)',
    name: 'hasInternalSoldElsewhere component alone — agent note, no customer words',
    input: base({
      transcript: ['[AGENT] left voicemail'],
      notes: ['Spoke with customer, she bought elsewhere last week.']
    }),
    expect: { hasExitSignal: true },
    alsoRequire: { hasInternalSoldElsewhere: true }
  },
  {
    group: 'MUST STILL EXIT (unchanged)',
    name: 'hasInternalNotInterested component alone — agent-recorded verbal decline',
    input: base({
      transcript: ['[AGENT] called customer'],
      notes: ['Customer stated she is not interested, do not need to follow up.']
    }),
    expect: { hasExitSignal: true },
    alsoRequire: { hasInternalNotInterested: true }
  },
  {
    group: 'MUST STILL EXIT (unchanged)',
    name: 'hasBereavementSignal component alone — death notification',
    input: base({ transcript: ['[CUSTOMER] Sorry to inform you, my husband passed away last month.'] }),
    expect: { hasExitSignal: true },
    alsoRequire: { hasBereavementSignal: true }
  },
  {
    group: 'MUST STILL EXIT (unchanged)',
    name: 'bare STOP + an independent exit signal in history — exit still wins',
    input: base({
      transcript: ['[CUSTOMER] STOP', '[CUSTOMER] we already bought something else', '[AGENT] Following up']
    }),
    expect: { hasExitSignal: true, isSmsOptOutOnly: false },
    alsoRequire: { exitRawIndependent: true }
  },

  // ---- must not regress ----
  {
    group: 'MUST NOT REGRESS',
    name: "Raul Meza's shape — prior-lead STOP under the CURRENT LEAD marker",
    input: RAUL,
    expect: { isSmsOptOut: true, smsOptOutIsExit: false, hasExitSignal: false, isSmsOptOutOnly: true },
    alsoRequire: { _optOutPriorLead: true }
  },
  {
    group: 'MUST NOT REGRESS',
    name: 'no opt-out at all — ordinary live lead, untouched',
    input: base({ transcript: ['[CUSTOMER] Can you send me pricing on the Telluride?', '[AGENT] Sure'] }),
    expect: { isSmsOptOut: false, smsOptOutIsExit: false, hasExitSignal: false, isSmsOptOutOnly: false }
  },
  {
    group: 'MUST NOT REGRESS',
    name: 'historical system-note opt-out, no bare STOP message, established lead',
    input: base({
      transcript: ['[AGENT] Following up on your inquiry'],
      notes: ['SMS status has been manually changed to: Opt-Out'],
      hasSystemOptOutNote: true
    }),
    expect: { isSmsOptOut: true, smsOptOutIsExit: true, hasExitSignal: true, isSmsOptOutOnly: false }
  },
  {
    group: 'MUST NOT REGRESS',
    name: 'opt-out + explicit re-opt-in — SMS restored, no exit (hasRecentReoptIn path)',
    input: base({
      transcript: ['[AGENT] Following up'],
      notes: ['SMS status has been manually changed to: Opt-In by Abby Montez'],
      hasSystemOptOutNote: true,
      hasRecentReoptIn: true
    }),
    expect: { isSmsOptOut: false, smsOptOutIsExit: false, isSmsOptOutOnly: false }
  },
  {
    group: 'MUST NOT REGRESS',
    name: 'Wendy Browne — bare STOP is the newest message with 30 notes of history behind it',
    input: base({
      transcript: [
        '[CUSTOMER] STOP',
        '[CUSTOMER] Yes I am still interested in the Sportage',
        '[AGENT] Following up on your inquiry'
      ]
    }),
    // isSmsOptOut must stay TRUE (the STOP is respected); only the framing changes.
    expect: { isSmsOptOut: true, smsOptOutIsExit: false, isSmsOptOutOnly: true }
  }
];

// ── Runner ──────────────────────────────────────────────────────────────────
let pass = 0, fail = 0, lastGroup = '';
const rows = [];

console.log('\n  file: ' + file + '   region: lines ' + R.lines + ' (real shipped bytes)\n');

for (const c of CASES) {
  if (c.group !== lastGroup) { console.log('  ── ' + c.group + ' ' + '─'.repeat(Math.max(0, 62 - c.group.length))); lastGroup = c.group; }
  let out, err = null;
  try { out = R.run(c.input); } catch (e) { err = e; }

  const checks = Object.assign({}, c.expect, c.alsoRequire || {});
  const bad = [];
  if (err) {
    bad.push('threw: ' + err.message);
  } else {
    for (const k of Object.keys(checks)) {
      if (out[k] !== checks[k]) bad.push(k + '=' + out[k] + ' (want ' + checks[k] + ')');
    }
    // COMPLIANCE INVARIANT, asserted on every single case:
    // whenever a stop signal is present, the SMS channel must be suppressed —
    // either as an opt-out-only draft or as a full exit. It may never be "live".
    if (out.isSmsOptOut === true && !(out.isSmsOptOutOnly === true || out.hasExitSignal === true)) {
      bad.push('COMPLIANCE: isSmsOptOut true but neither isSmsOptOutOnly nor hasExitSignal set');
    }
  }

  const smsState = err ? '?' :
    (out.isSmsOptOut ? (out.isSmsOptOutOnly ? 'SUPPRESSED (opt-out-only)' : 'SUPPRESSED (exit)') : 'n/a — no opt-out');

  if (bad.length) { fail++; console.log('  ✗ ' + c.name); bad.forEach(b => console.log('      ' + b)); }
  else { pass++; console.log('  ✓ ' + c.name); }
  if (!err) console.log('      exit=' + out.hasExitSignal + '  optOutOnly=' + out.isSmsOptOutOnly + '  smsOptOutIsExit=' + out.smsOptOutIsExit + '  SMS: ' + smsState);
  rows.push({ group: c.group, name: c.name, out, ok: !bad.length });
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
if (process.env.LP_JSON) {
  require('fs').writeFileSync(process.env.LP_JSON, JSON.stringify(rows, null, 1));
}
process.exit(fail ? 1 : 0);
