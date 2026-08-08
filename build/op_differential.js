// Differential fuzz for the _onPremise detector, run against the REAL extracted blocks.
// Every note is assembled from a presence fragment and a distractor fragment, joined by
// each separator agents actually use, in both orders. Every case where the two builds
// disagree is printed for audit — the point is that no disagreement goes unexamined.

const { buildOp } = require('./op_harness.js');

// Run from anywhere: CLI paths resolve against your shell's cwd, everything else
// against this directory.
const _ARGV = process.argv.slice(2).map(function (a) { return require('path').resolve(a); });
process.chdir(__dirname);
const A = buildOp(_ARGV[0] || 'new/dev/popup.js');   // v9.7.535
const B = buildOp(_ARGV[1] || 'dev/popup.js');       // corrected

// left-hand fragments: genuine presence (G) vs idiom/inventory noise (N)
const LEFT = [
  ['G', 'customer is outside waiting'],
  ['G', 'he pulled up out front'],
  ['G', 'she is standing in the showroom'],
  ['G', 'walked the lot with him'],
  ['G', 'He’s outside now'],
  ['G', 'customer arrived and is out front'],
  ['N', 'he asked if we have any CR-V EX-L\'s in white on the lot'],
  ['N', 'told him we can get one on the lot by Friday'],
  ['N', 'the vehicle is on the lot and ready to view'],
  ['N', 'the payment is outside of budget'],
  ['N', 'the next one due in is a Meteorite Gray due to arrive around 8/11'],
  ['N', 'we have 3 in stock on the lot right now'],
];
const RIGHT = [
  ['x', 'he said that he will talk it over and will call back'],
  ['x', 'he said he would think about it'],
  ['x', 'I told him the price is 35093'],
  ['x', 'customer says he will come by next week'],
  ['x', 'was looking at financing options'],
  ['x', 'no answer'],
];
const SEP = ['. ', ', ', '; ', '\n', ' and ', ' - '];
const PREFIX = ['By: Rotaxlyn\n', 'By: Kaylee Guzman\n', ''];

let n = 0, widened = [], narrowed = [];
for (const [kind, l] of LEFT)
for (const [, r] of RIGHT)
for (const s of SEP)
for (const p of PREFIX)
for (const order of [0, 1]) {
  const body = order ? (l + s + r) : (r + s + l);
  const text = p + body;
  const a = A.fires(text), b = B.fires(text);
  n++;
  if (!a && b) widened.push({ kind, text: text.replace(/\n/g, '\\n') });
  if (a && !b) narrowed.push({ kind, text: text.replace(/\n/g, '\\n') });
}

console.log('\n  _onPremise DIFFERENTIAL — v9.7.535 vs corrected — ' + n + ' notes\n');
console.log('  newly FIRES under corrected (widened) .... ' + widened.length);
console.log('  newly SILENT under corrected (narrowed) .. ' + narrowed.length);

// Audit: every widened case must be a genuine-presence fragment (kind G);
// every narrowed case must be a noise fragment (kind N).
const badWiden = widened.filter(w => w.kind !== 'G');
const badNarrow = narrowed.filter(w => w.kind !== 'N');

const show = (label, arr) => {
  if (!arr.length) return;
  console.log('\n  ' + label + ' (' + arr.length + ', showing up to 6):');
  for (const x of arr.slice(0, 6)) console.log('    [' + x.kind + '] ' + x.text.slice(0, 100));
};
show('widened — all must carry a genuine presence fragment [G]', widened);
show('narrowed — all must carry a noise fragment [N]', narrowed);

console.log('\n  widened on a NOISE fragment (must be 0) ... ' + badWiden.length);
console.log('  narrowed on a GENUINE fragment (must be 0) . ' + badNarrow.length);
if (badWiden.length) { console.log('\n  BAD WIDEN:'); badWiden.slice(0, 8).forEach(x => console.log('    ' + x.text.slice(0, 120))); }
if (badNarrow.length) { console.log('\n  BAD NARROW:'); badNarrow.slice(0, 8).forEach(x => console.log('    ' + x.text.slice(0, 120))); }

const bad = badWiden.length + badNarrow.length;
console.log('\n  ' + (bad ? 'FAILED — ' + bad + ' unaudited disagreements' : 'PASS — every disagreement resolves the correct way') + '\n');
process.exit(bad ? 1 : 0);
