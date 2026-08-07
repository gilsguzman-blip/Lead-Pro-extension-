// Differential / monotonicity test: pristine v9.7.533 vs patched, over a matrix of
// lead shapes built with the REAL VinSolutions note format (routing headers, multi-line
// raw innerText, sanitize()-collapsed transcript entries).
//
// Claims proved mechanically:
//   (a) SMS suppression never weakens. The gate is the real render-time one:
//       isSmsOptOutOnly || /^stop[\s.!]*$/i.test(lastInboundMsg.trim()), OR an exit close.
//       For every shape, if the old build suppressed, the new build must too.
//   (b) hasExitSignal is never ADDED (farewells are only ever removed).
//   (c) isSmsOptOut is never turned OFF (a STOP the old build honoured is still honoured).

const { buildRunner, entry, noteEl } = require('./harness.js');

const OLD = buildRunner('orig/dev/popup.js');
const NEW = buildRunner('dev/popup.js');

const PHONE = '(346) 417-5343', AGENT = 'Gil Guzman';

function build(custMsgs, agentMsgs, internalNotes, marker, priorStop) {
  const transcript = [], noteEls = [], flat = [];
  let lastInboundMsg = '';
  let d = 12;
  const push = (who, title, dir, raw) => {
    transcript.push(entry('08/07/2026 ' + String(d--).padStart(2, '0') + ':00 PM', who, title, raw));
    noteEls.push(noteEl(raw, { dir, title }));
    flat.push(raw);
  };
  for (const m of custMsgs) {
    const raw = 'Received from: ' + PHONE + '\nReceived by: ' + AGENT + '\n' + m;
    if (!lastInboundMsg) lastInboundMsg = raw.replace(/\s+/g, ' ').trim();
    push('CUSTOMER', 'Inbound Text Message', 'inbound', raw);
  }
  for (const m of agentMsgs) push('AGENT', 'Outbound Text Message', 'outbound', 'Sent to: ' + PHONE + '\nSent by: ' + AGENT + '\n' + m);
  for (const n of internalNotes) { noteEls.push(noteEl('By: Abby Montez\n' + n, { dir: 'outbound', title: 'Outbound phone call' })); flat.push(n); }
  if (marker) transcript.push('[08/02/2026 03:54 AM] [=== CURRENT LEAD SUBMITTED HERE ===]');
  if (priorStop) {
    transcript.push(entry('01/02/2025 09:00 AM', 'CUSTOMER', 'Inbound Text Message', 'Received from: ' + PHONE + '\nReceived by: ' + AGENT + '\nStop'));
    flat.push('Stop');
  }
  return { transcript, noteEls, lastInboundMsg, fullScanText: (transcript.join('\n') + '\n' + flat.join('\n')).toLowerCase() };
}

const CUST = [
  [], ['STOP'], ['stop.'], ['Stop!'], ['STOP', 'I completed the application'],
  ['stop contacting me'], ['please stop contacting me about this'],
  ['not interested'], ['we bought elsewhere'], ['we went with another dealer'],
  ['take me off your list'], ['Yes still interested in the Sportage'],
  ['What is the price on the Telluride?'], ['my husband passed away last month'],
  ['STOP', 'Yes I am still interested'], ['STOP', 'we already bought something else']
];
const AGENTM = [
  [], ['Following up on your inquiry'],
  ['You have successfully been removed from Community Auto Group text messages.']
];
const NOTES = [
  [], ['SMS status has been manually changed to: Opt-Out'],
  ['Customer stated she is not interested'], ['She bought elsewhere last week'],
  ['Click & Go application received - no vehicle attached']
];
const FLAGS = [
  {}, { hasNewLeadToday: true, leadAgeDays: 0 }, { hasRecentReoptIn: true },
  { hasRecentReactivation: true }, { hasSystemOptOutNote: true }
];

function suppressed(out, lastInboundMsg) {
  return out.isSmsOptOutOnly === true
      || /^stop[\s.!]*$/i.test(String(lastInboundMsg || '').trim())
      || out.hasExitSignal === true;
}

let n = 0, optOutTurnedOff = 0, suppressionLoss = 0, exitAdded = 0, exitRemoved = 0;
let newlyDetected = 0, newlySuppressed = 0;
const ex = { optOutTurnedOff: [], suppressionLoss: [], exitAdded: [] };

for (const cust of CUST)
for (const ag of AGENTM)
for (const notes of NOTES)
for (const marker of [false, true])
for (const prior of [false, true])
for (const flags of FLAGS) {
  const input = Object.assign(build(cust, ag, notes, marker, prior), { leadAgeDays: 5 }, flags);
  const a = OLD.run(input), b = NEW.run(input);
  n++;

  if (a.isSmsOptOut === true && b.isSmsOptOut !== true) {
    optOutTurnedOff++;
    if (ex.optOutTurnedOff.length < 3) ex.optOutTurnedOff.push({ cust, ag, notes, marker, prior, flags });
  }
  if (a.isSmsOptOut !== true && b.isSmsOptOut === true) newlyDetected++;

  const sa = suppressed(a, input.lastInboundMsg), sb = suppressed(b, input.lastInboundMsg);
  if (sa && !sb) { suppressionLoss++; if (ex.suppressionLoss.length < 3) ex.suppressionLoss.push({ cust, ag, notes, marker, prior, flags }); }
  if (!sa && sb) newlySuppressed++;

  if (!a.hasExitSignal && b.hasExitSignal) { exitAdded++; if (ex.exitAdded.length < 3) ex.exitAdded.push({ cust, ag, notes, marker, prior, flags }); }
  if (a.hasExitSignal && !b.hasExitSignal) exitRemoved++;
}

console.log('\n  DIFFERENTIAL: pristine v9.7.533 vs patched — ' + n + ' lead shapes (real note format)\n');
console.log('  MUST BE ZERO');
console.log('    isSmsOptOut turned OFF ...................... ' + optOutTurnedOff);
console.log('    SMS suppression LOST ....................... ' + suppressionLoss);
console.log('    hasExitSignal ADDED ........................ ' + exitAdded);
console.log('  INTENDED EFFECTS');
console.log('    farewell removed (bare keyword -> channel) .. ' + exitRemoved);
console.log('    STOP newly DETECTED (was missed entirely) .. ' + newlyDetected);
console.log('    SMS newly SUPPRESSED (compliance repair) ... ' + newlySuppressed);

for (const k of Object.keys(ex)) {
  if (ex[k].length) console.log('\n  VIOLATION ' + k + ':\n' + JSON.stringify(ex[k], null, 1));
}

const bad = optOutTurnedOff + suppressionLoss + exitAdded;
console.log('\n  ' + (bad ? 'FAILED — ' + bad + ' violations' : 'PASS — suppression only ever increases; no farewell is ever added') + '\n');
process.exit(bad ? 1 : 0);
