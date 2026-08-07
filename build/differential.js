// Differential / monotonicity test: pristine v9.7.533 vs patched, across a matrix
// of lead shapes. Both sides run the REAL shipped region via harness.js.
//
// The compliance claim being proved mechanically:
//   (a) isSmsOptOut is byte-for-byte unchanged in every case — the change cannot
//       make the system think a customer is opted IN when the old build said out.
//   (b) SMS suppression never weakens. Suppression at render is
//       `isSmsOptOutOnly || /^stop[\s.!]*$/i.test(lastInboundMsg)` (popup.js,
//       "DETERMINISTIC SMS SUPPRESSION on opt-out"). For every input, if the old
//       build suppressed, the new build must also suppress.
//   (c) hasExitSignal only ever goes true -> false (farewells are removed, never added).

const { buildRunner } = require('./harness.js');

const OLD = buildRunner('orig/dev/popup.js');
const NEW = buildRunner('dev/popup.js');

// Fragments combined exhaustively into lead shapes.
const CUSTOMER = [
  null,
  'STOP',
  'stop.',
  'Stop!',
  'stop contacting me',
  'please stop contacting me about this',
  'not interested',
  'we bought elsewhere',
  'we went with another dealer',
  'take me off your list',
  'Yes still interested in the Sportage',
  'What is the price on the Telluride?',
  'my husband passed away last month',
  'STOP',            // paired below with extra history
];
const EXTRA_CUSTOMER = [null, 'Yes I am still interested', 'we already bought something else', 'I completed the application'];
const NOTES = [
  [],
  ['Customer successfully removed from text messages'],
  ['SMS status has been manually changed to: Opt-Out'],
  ['Customer stated she is not interested'],
  ['She bought elsewhere last week'],
  ['Click & Go application received - no vehicle attached'],
];
const MARKER = [false, true];
const FLAGS = [
  {},
  { hasNewLeadToday: true, leadAgeDays: 0 },
  { hasRecentReoptIn: true },
  { hasRecentReactivation: true },
  { hasSystemOptOutNote: true },
];

function suppressed(out, lastInboundMsg) {
  // Mirrors the real render-time gate _optOutNow, plus the exit path (an exit close
  // routes through the farewell branch which never drafts SMS for an opted-out lead).
  return out.isSmsOptOutOnly === true || /^stop[\s.!]*$/i.test(String(lastInboundMsg || '').trim());
}

let n = 0, optOutDrift = 0, suppressionLoss = 0, exitAdded = 0, exitRemoved = 0, changed = 0;
const examples = { suppressionLoss: [], optOutDrift: [], exitAdded: [], exitRemoved: [] };

for (const cust of CUSTOMER)
for (const extra of EXTRA_CUSTOMER)
for (const notes of NOTES)
for (const marker of MARKER)
for (const flags of FLAGS) {
  const transcript = [];
  if (cust) transcript.push('[CUSTOMER] ' + cust);
  if (extra) transcript.push('[CUSTOMER] ' + extra);
  transcript.push('[AGENT] I saw you completed your application through Click & Go. What model are you shopping for?');
  if (marker) transcript.push('[SYSTEM] CURRENT LEAD SUBMITTED HERE');
  if (marker) transcript.push('[CUSTOMER] Stop');

  const input = Object.assign({ transcript, notes, leadAgeDays: 5, lastInboundMsg: cust || '' }, flags);
  const a = OLD.run(input);
  const b = NEW.run(input);
  n++;

  if (a.isSmsOptOut !== b.isSmsOptOut) {
    optOutDrift++;
    if (examples.optOutDrift.length < 3) examples.optOutDrift.push({ input, a: a.isSmsOptOut, b: b.isSmsOptOut });
  }
  const sa = suppressed(a, input.lastInboundMsg), sb = suppressed(b, input.lastInboundMsg);
  if (sa && !sb) {
    suppressionLoss++;
    if (examples.suppressionLoss.length < 3) examples.suppressionLoss.push({ input, a, b });
  }
  if (!a.hasExitSignal && b.hasExitSignal) {
    exitAdded++;
    if (examples.exitAdded.length < 3) examples.exitAdded.push({ input, a: a.hasExitSignal, b: b.hasExitSignal });
  }
  if (a.hasExitSignal && !b.hasExitSignal) {
    exitRemoved++;
    if (examples.exitRemoved.length < 3) examples.exitRemoved.push({ cust, extra, notes, marker, flags });
  }
  if (a.hasExitSignal !== b.hasExitSignal || a.isSmsOptOutOnly !== b.isSmsOptOutOnly) changed++;
}

console.log('\n  DIFFERENTIAL: pristine v9.7.533 vs patched — ' + n + ' lead shapes\n');
console.log('  isSmsOptOut drift (must be 0) ................ ' + optOutDrift);
console.log('  SMS suppression LOST (must be 0) ............. ' + suppressionLoss);
console.log('  hasExitSignal ADDED (must be 0) .............. ' + exitAdded);
console.log('  hasExitSignal REMOVED (the intended effect) .. ' + exitRemoved);
console.log('  shapes with any behaviour change ............. ' + changed);

if (exitRemoved) {
  console.log('\n  sample of shapes where the farewell was removed:');
  for (const e of examples.exitRemoved) {
    console.log('    customer="' + e.cust + '"' + (e.extra ? ' + "' + e.extra + '"' : '') +
                '  notes=' + JSON.stringify(e.notes) + '  marker=' + e.marker + '  flags=' + JSON.stringify(e.flags));
  }
}
for (const k of ['optOutDrift', 'suppressionLoss', 'exitAdded']) {
  if (examples[k].length) console.log('\n  VIOLATION ' + k + ':', JSON.stringify(examples[k], null, 1));
}

const bad = optOutDrift + suppressionLoss + exitAdded;
console.log('\n  ' + (bad ? 'FAILED — ' + bad + ' violations' : 'PASS — SMS suppression never weakens; no farewell is ever added') + '\n');
process.exit(bad ? 1 : 0);
