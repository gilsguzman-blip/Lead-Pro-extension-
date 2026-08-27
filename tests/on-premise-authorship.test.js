#!/usr/bin/env node
'use strict';
/**
 * on-premise-authorship.test.js — v9.7.586. LP TOLD A CUSTOMER WITH NO CAR THAT SHE WAS IN OUR LOT.
 *
 * ── THE INCIDENT ──────────────────────────────────────────────────────────────────────────
 * Keisha Burgess (Community Kia Baytown, lead 2074168344, 8/27). Her inbound text, 12:27 PM:
 *
 *   "May have to print them out here is my ID also  https://images.vinsolutions.com/..."
 *
 * The place token matched "out here" — the "out" of "print them OUT" plus the "here" of "HERE is
 * my ID". Two different phrases, adjacent by accident. _opSubjTok then matched the "is" of "here
 * is". Same clause, so the v9.7.533 same-clause rule could not help: the tokens genuinely ARE
 * adjacent, they just belong to different units of meaning.
 *
 * The prompt then carried "🚨 THE CUSTOMER IS AT THE STORE RIGHT NOW — THIS OUTRANKS EVERY OTHER
 * DIRECTIVE", and LP wrote "Keisha, I see you're here now. Someone is coming right out—where on the
 * lot are you?" to a customer who had said, nine minutes earlier: "I don't have a car so the one
 * time I do come I hope to leave with a vehicle."
 *
 * ── FIFTH INCIDENT OF THIS CLASS, FIRST ON A CUSTOMER'S OWN WORDS ─────────────────────────
 * Robin Newman ("on the lot" + "said"), Artemisa Amaro ("here now" + "is"), and the two v9.7.531
 * cases were all AGENT notes. This one is not, and that is the structural finding:
 * _opOurOwnOutbound excludes notes OPENING with our own send headers (left message / sent to: /
 * sent by: / subject:) — but an inbound customer text opens "Received from:", which is not in that
 * list. So a detector built to read AGENT OBSERVATIONS was reading CUSTOMER SPEECH, where "here is
 * my ID" is ordinary English for "attached".
 *
 * ── THE FIX, AND WHY IT IS NOT "IGNORE INBOUND" ───────────────────────────────────────────
 * A customer texting "I'm outside" is the STRONGEST on-premise signal there is, so inbound is not
 * excluded. It is held to a FIRST-PERSON presence claim instead: the customer must say THEY are
 * here, not merely use a word that can mean here. Agent notes keep the third-person observation
 * rule unchanged. Separately, the phrasal-verb object ("them/it/those out") is blanked before the
 * place test, the same way the inventory and budget idioms already were.
 *
 * Driven against the SHIPPED detector with the REAL captured text. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: on-premise-authorship.test.js <popup.js> [popup.js...]'); process.exit(2); }

const START = '      var _opVehicleAvailable =';
const END   = '      if (_opSameClauseHit !== null) {';

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf(START), b = src.indexOf(END);
  if (a < 0 || b < 0 || b <= a) throw new Error('on-premise block not found in ' + file);
  // The block reads `content`, `_opNorm` and `_opOurOwnOutbound`, and writes `_opSameClauseHit`.
  // _lpD is stubbed: the block lives INSIDE inlineScraper, where console does not exist.
  const fn = new vm.Script(
    '(function(content){\n' +
    ' var _opNorm = String(content || "").replace(/[\\u2018\\u2019\\u02BC\\u00B4]/g, "\'").trim();\n' +
    ' var _opOurOwnOutbound = /^\\s*(?:left\\s+(?:a\\s+)?(?:message|vm|voicemail)|sent to\\s*:|sent by\\s*:|subject\\s*:)/i;\n' +
    ' var rejects = [];\n' +
    ' var _lpD = function(){ rejects.push(Array.prototype.join.call(arguments, " ")); };\n' +
    src.slice(a, b) +
    '\nreturn { hit: _opSameClauseHit, rejects: rejects }; })'
  ).runInNewContext({ String, RegExp, Array, Date });
  return { name: path.basename(path.dirname(file)), run: fn };
}

const impls = BUILDS.map(extract);
let pass = 0, fail = 0;
function report(name, results, want) {
  const agree = results.every(r => r === results[0]);
  const ok = agree && results[0] === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; console.log('  FAIL ' + name);
    if (!agree) impls.forEach((i, n) => console.log('        ' + i.name + ' -> ' + results[n]));
    else console.log('        expected ' + JSON.stringify(want) + '\n        got      ' + results[0]);
  }
}
const check = (name, fn, want) =>
  report(name, impls.map(i => { try { return JSON.stringify(fn(i)); } catch (e) { return 'THREW: ' + e.message; } }), want);

const fires = (i, t) => i.run(t).hit !== null;

// Verbatim from the 8/27 VinSolutions record.
const KEISHA = 'Received from: (832) 459-3726\nReceived by: Ever Pereira\n'
             + 'May have to print them out here is my ID also\n\n'
             + 'https://images.vinsolutions.com/vindataaccessinterac/short/35a8a33d-9b91-4557-be45-89897c0be50a';

console.log('\nv9.7.586 — an on-premise reading needs an observer, not just the word "here"');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── THE INCIDENT ──────────────────────────────────────────────────────────────
console.log("Keisha's real text — the message that produced \"I see you're here now\":");

check('it no longer reads as on-premise',
  i => fires(i, KEISHA), false);

// Keisha is defused by the PHRASAL-VERB fix (A): "them out" is blanked, so no place token
// survives and the loop continues before the authorship test — correctly, and silently. The
// REJECT log belongs to fix (B), where a place token IS present and authorship is what fails.
// Asserting it on Keisha's text was pointing the assertion at the wrong mechanism.
check('...and it is suppressed with NO place token left at all — fix (A) got there first',
  i => i.run(KEISHA).rejects.length, 0);

check('where fix (B) does the work, the suppression is LOGGED rather than silent',
  i => {
    const r = i.run('Received from: (555) 555-5555\nCustomer is outside waiting').rejects.join('\n');
    return /\[LP ON-PREMISE REJECT\]/.test(r) && /CUSTOMER's own text/.test(r);
  }, true);

check('...and an agent note failing the verb test logs the OTHER reason',
  i => /no third-person observation verb/.test(
        i.run('By: Agent\nParking outside').rejects.join('\n')), true);

check('the phrasal-verb object is what defused it — "print them out" is not a place',
  i => fires(i, 'Received from: (832) 459-3726\nMay have to print them out here is my ID'), false);

check('...and the same shape with other verbs and pronouns',
  i => ['send it out here is the link', 'take those out here is why', 'bring her out here is the plan']
        .map(t => fires(i, 'Received from: (555) 555-5555\n' + t)), [false, false, false]);

// ── A CUSTOMER SAYING THEY ARE HERE MUST STILL WORK ───────────────────────────
console.log('\na customer who really IS here still fires — this is the strongest signal there is:');

const INBOUND_REAL = [
  "I'm outside",
  "im here in the lot",
  "I am waiting out front",
  "we're here now by the front door",
  "I'm parked outside the showroom"
];
for (const t of INBOUND_REAL) {
  check('  inbound: ' + JSON.stringify(t),
    i => fires(i, 'Received from: (555) 555-5555\nReceived by: Agent\n' + t), true);
}

// ── AGENT OBSERVATIONS ARE UNCHANGED ──────────────────────────────────────────
console.log('\nagent notes keep the third-person observation rule, unchanged:');

const AGENT_REAL = [
  'By: Kristen Willis\nCustomer is outside waiting',
  'By: Agent\nShe walked the lot with me',
  'By: Agent\nHe pulled up out front',
  "By: Agent\nShe's here now, standing out front",
  'By: Agent\nCustomer is in the showroom looking at the Telluride'
];
for (const t of AGENT_REAL) {
  check('  agent: ' + JSON.stringify(t.split('\n')[1].slice(0, 42)),
    i => fires(i, t), true);
}

// ── EVERY PRIOR INCIDENT STAYS SUPPRESSED ─────────────────────────────────────
console.log('\nthe four earlier false positives stay suppressed:');

check('our own outbound voicemail (Artemisa, v9.7.531)',
  i => fires(i, 'By: Samantha Gonzalez\nLeft message - the vehicle is here now and ready to see'), false);

check('outbound availability copy — "it\'s here now" is the CAR, not the customer',
  i => fires(i, 'By: Agent\nJust confirming it is here now and available'), false);

check('inventory idiom — "we can get one on the lot"',
  i => fires(i, 'By: Agent\nI said we can get one on the lot by Friday'), false);

check('budget idiom — "outside of budget"',
  i => fires(i, 'By: Agent\nShe said that is outside her budget'), false);

// ── The authorship rule is what does the work, not a blanket inbound ban ──────
console.log('\nthe rule is AUTHORSHIP-AWARE, not a blanket inbound exclusion:');

check('the SAME third-person sentence fires as an agent note and NOT as a customer text',
  i => {
    const body = 'Customer is outside waiting';
    return { asAgentNote:   fires(i, 'By: Agent\n' + body),
             asCustomerText: fires(i, 'Received from: (555) 555-5555\n' + body) };
  }, { asAgentNote: true, asCustomerText: false });

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
