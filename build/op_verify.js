// Independent review corpus for the v9.7.535 _onPremise clause-scoping change.
// Runs the REAL extracted detector block from both builds.
//   want:'fire'    genuine customer-presence observation — must set _onPremise
//   want:'silent'  no presence claim — must not fire
//   want:'gap'     documented cross-clause loss of the same-clause rule: reported, not a failure

const { buildOp } = require('./op_harness.js');

// Run from anywhere: CLI paths resolve against your shell's cwd, everything else
// against this directory.
const _ARGV = process.argv.slice(2).map(function (a) { return require('path').resolve(a); });
process.chdir(__dirname);
const OLD = buildOp(_ARGV[0] || 'dev/popup.js');        // pre-535 logic
const NEW = buildOp(_ARGV[1] || 'new/dev/popup.js');    // v9.7.535

const BY = 'By: Rotaxlyn\n';
const C = [
// ── genuine presence, single clause ─────────────────────────────────────────
['Armando (real)', 'fire', BY + 'said he was outside right now looking at the vehicles'],
['here now + standing out front', 'fire', BY + 'Customer is here now, standing out front'],
['curly apostrophe', 'fire', BY + 'She’s outside now'],
['walked the lot', 'fire', BY + 'Walked the lot with him, he is looking at the Telluride'],
['in the showroom waiting', 'fire', BY + 'Customer is in the showroom waiting'],
['pulled up out front', 'fire', BY + 'He pulled up out front'],
['left message MID-text', 'fire', BY + 'Called and left message earlier, then customer arrived and is outside now'],
['inbound Received-from', 'fire', 'Received from: (346) 417-5343\nReceived by: Gil Guzman\nHe is outside waiting by the door'],
['arrived + showroom', 'fire', BY + 'Customer arrived and is standing in the showroom'],

// ── genuine presence SPLIT ACROSS CLAUSES (the new rule's blind spot) ───────
['cross-clause: arrived. / out front', 'gap', BY + 'Customer arrived. Out front by the blue Telluride.'],
['cross-clause: he is here. / outside', 'gap', BY + 'He is here. Outside by the service door.'],
['cross-clause: "pulled in" not a token', 'gap', BY + 'He pulled in a minute ago. On the lot now.'],

// ── genuine presence sharing a clause with an excluded idiom ────────────────
['presence + vehicle-on-lot, one clause', 'fire', BY + 'He is outside and the vehicle is on the lot'],
['presence + budget idiom, one clause', 'fire', BY + 'Customer is out front, said the payment is outside of budget'],

// ── false positives that must stay silent ──────────────────────────────────
['Tiger (real, periods)', 'silent', BY + "He asked if stock #P4837 has remote start. He asked if we have any CR-V EX-L's in white on the lot. I told him that we have a certified 2026 available, stock #P4848 for $35,093. He said that he will talk it over and will call back."],
['Tiger, COMMA-joined', 'silent', BY + "He asked if we have any CR-V EX-L's in white on the lot, he said that he will talk it over and will call back"],
['Tiger, SEMICOLON-joined', 'silent', BY + "He asked if we have any CR-V EX-Ls on the lot; he said he will call back"],
['Robin Newman (arrival copy)', 'silent', BY + 'The next one due in is a Meteorite Gray due to arrive around 8/11. He said he would think about it.'],
['Artemisa real VM', 'silent', 'By: Kristen Willis\nLeft message - Hi, this is Kristen with Community Kia Baytown. I saw your Facebook message about the 2027 Kia Seltos S, and it’s here now if you’d like to come take a look.'],
['vehicle is on the lot', 'silent', BY + 'The vehicle is on the lot and ready to view'],
['get one on the lot', 'silent', BY + 'Told him we can get one on the lot by Friday, he said ok'],
['outside of budget', 'silent', BY + 'He said the payment is outside of budget'],
['outbound text availability', 'silent', 'Sent to: (346) 417-5343\nSent by: Gil Guzman\nThe Telluride is here now, want to come see it?'],
['no presence language', 'silent', BY + 'Left a voicemail about financing options'],
['inventory: any X on the lot', 'silent', BY + 'He asked if we have any CR-Vs on the lot'],
];

let fail = 0, lost = 0, kept = 0;
console.log('\n  old = ' + (_ARGV[0] || 'dev/popup.js') + '   new = ' + (_ARGV[1] || 'new/dev/popup.js') + '\n');
console.log('  ' + 'case'.padEnd(38) + 'want    old    new');
console.log('  ' + '-'.repeat(62));
for (const [name, want, text] of C) {
  const o = OLD.fires(text), n = NEW.fires(text);
  const ok = want === 'gap' ? true : ((want === 'fire') === n);
  if (!ok) fail++;
  if ((want === 'fire' || want === 'gap') && o && !n) lost++;
  if (want === 'silent' && o && !n) kept++;
  console.log('  ' + (ok ? '  ' : '✗ ') + name.padEnd(36) + want.padEnd(8) + String(o).padEnd(7) + String(n));
}
console.log('\n  ' + (C.length - fail) + '/' + C.length + ' correct under v9.7.535');
console.log('  genuine signals LOST by the change: ' + lost);
console.log('  false positives FIXED by the change: ' + kept + '\n');
process.exit(fail ? 1 : 0);
