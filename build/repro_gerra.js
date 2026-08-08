// Reproduce Gerra's lead using the REAL transcript/note shapes taken from log99 and
// the captured prompt — not the simplified '[CUSTOMER] STOP' fixture used earlier.
//
// Real note content (multi-line innerText, per [LP SCHED DIAG]'s "|"-rendered sample):
//     Received from: (346) 417-5343
//     Received by: Gil Guzman
//     STOP
// Real transcript entry (sanitize() has collapsed those newlines to spaces):
//     [08/07/2026 10:33 AM] [CUSTOMER] Inbound Text Message
//       Received from: (346) 417-5343 Received by: Gil Guzman STOP

const { buildRunner, entry, noteEl } = require('./harness.js');

// Run from anywhere: CLI paths resolve against your shell's cwd, everything else
// against this directory.
const _ARGV = process.argv.slice(2).map(function (a) { return require('path').resolve(a); });
process.chdir(__dirname);

const INBOUND_RAW  = 'Received from: (346) 417-5343\nReceived by: Gil Guzman\nSTOP';
const OUT_REMOVED  = 'Sent to: (346) 417-5343\nSent by: Gil Guzman\nYou have successfully been removed from Community Auto Group text messages.';
const OUT_CLICKNGO = 'Sent to: (346) 417-5343\nSent by: Gil Guzman\nGerra, I saw you completed your application through Click & Go, but no vehicle is attached yet. What model are you shopping for? Kaylee Internet Sales Coordinator | Community Kia Baytown Reply STOP to cancel.';
const CALL_NOTE    = 'By: Abby Montez\nLeft message';

const GERRA_REAL = {
  leadAgeDays: 5,
  lastInboundMsg: 'Received from: (346) 417-5343 Received by: Gil Guzman STOP',
  transcript: [
    entry('08/07/2026 12:09 PM', 'AGENT',    'Outbound phone call (Machine)', CALL_NOTE),
    entry('08/07/2026 12:08 PM', 'AGENT',    'Outbound phone call (Machine)', CALL_NOTE),
    entry('08/07/2026 10:33 AM', 'AGENT',    'Outbound Text Message',         OUT_REMOVED),
    entry('08/07/2026 10:33 AM', 'CUSTOMER', 'Inbound Text Message',          INBOUND_RAW),
    entry('08/07/2026 10:32 AM', 'AGENT',    'Outbound Text Message',         OUT_CLICKNGO),
    '[08/02/2026 03:54 AM] [=== CURRENT LEAD SUBMITTED HERE ===]'
  ],
  noteEls: [
    noteEl(CALL_NOTE,    { dir: 'outbound', title: 'Outbound phone call (Machine)' }),
    noteEl(CALL_NOTE,    { dir: 'outbound', title: 'Outbound phone call (Machine)' }),
    noteEl('Lead log',   { dir: '',         title: 'Lead log' }),
    noteEl(OUT_REMOVED,  { dir: 'outbound', title: 'Outbound Text Message' }),
    noteEl('SMS status', { dir: '',         title: 'SMS status' }),
    noteEl(INBOUND_RAW,  { dir: 'inbound',  title: 'Inbound Text Message' })
  ],
  hasSystemOptOutNote: true   // [LP OPTOUT DIAG] fired on the real page
};

const LOG99 = {   // observed on the real page, v9.7.534-dev
  isSmsOptOut: true, rawStopSignal: true, _optOutPriorLead: false,
  _bareCarrierKeywordOptOut: false, smsOptOutIsExit: true,
  hasExitSignal: true, isSmsOptOutOnly: false
};

const out = buildRunner(_ARGV[0] || 'dev/popup.js').run(GERRA_REAL);

console.log('\n  Gerra, REAL note/transcript shapes — harness vs log99\n');
let mismatch = 0;
for (const k of Object.keys(LOG99)) {
  const ok = out[k] === LOG99[k];
  if (!ok) mismatch++;
  console.log('   ' + (ok ? '=' : '≠') + ' ' + k.padEnd(26) + ' harness:' + String(out[k]).padEnd(7) + ' log99:' + LOG99[k]);
}
console.log('\n   _freshStopOnThisLead : ' + out._freshStopOnThisLead + '   <-- the bare STOP the customer actually sent');
console.log('\n  ' + (mismatch ? mismatch + ' field(s) differ from the live log' : 'harness reproduces log99 exactly') + '\n');

// Show WHY, by replaying the real header-strip against the real transcript entry.
const custLine = GERRA_REAL.transcript.find(t => t.indexOf('[CUSTOMER]') !== -1);
const stripped = custLine
  .replace(/Received (from|by)[^\n]*\n?/gi, '')
  .replace(/\[CUSTOMER\]/gi, '')
  .replace(/^\s*\[[^\]]*\]\s*/, '')
  .replace(/\s+/g, ' ')
  .trim().toLowerCase();
console.log('  newest [CUSTOMER] transcript entry:');
console.log('    ' + JSON.stringify(custLine));
console.log('  after the real _newestInboundBody header-strip chain:');
console.log('    ' + JSON.stringify(stripped) + '   <-- the word STOP is gone\n');
