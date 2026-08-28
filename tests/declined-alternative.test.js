#!/usr/bin/env node
'use strict';
// (v9.7.598) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('declined-alternative.test.js');

/**
 * declined-alternative.test.js — v9.7.598. A GUARD THAT WROTE THE MESSAGE.
 *
 * Amber Carberry, lead 2042363543, Community Honda Baytown, 8/28.
 *
 * ── THE DIRECTIVE, AND THE DRAFT IT PRODUCED ──────────────────────────────────────────────
 * The prompt carried:
 *
 *   ❌ CUSTOMER DECLINED ALTERNATIVE — ABSOLUTE STOP: The customer stated: "just looking for a
 *   price. it would be a cash sale.". ... Write exactly two things: (1) confirm you heard their
 *   preference, (2) ask one question about their timeline. Nothing else. Full stop.
 *
 * The delivered SMS was that instruction executed literally:
 *
 *   "Amber, I hear you — cash purchase, and you prefer text or email rather than phone calls.
 *    What timeline are you working with?"
 *
 * Two rescans produced the same message, because the instruction admitted no other message.
 * Gil: "Message didn't change at all."
 *
 * ── WHY IT FIRED ──────────────────────────────────────────────────────────────────────────
 * /just\s+(?:want|need|looking\s+for)\s+/ matched her OPENING INQUIRY — "I am just looking for a
 * price. It would be a cash sale." That is the most ordinary way a person states what they want on
 * a first contact. It is not a rejection of anything.
 *
 * ── AND NOTHING REQUIRED THERE TO BE SOMETHING TO DECLINE ─────────────────────────────────
 * The scan read customer text alone, with no check that an alternative had ever been offered. Her
 * matched "decline" is the FIRST note on the lead; nothing preceded it. A decline is a response —
 * with no prior outbound there is nothing it could be responding to.
 *
 * That is the structural half, and it is the one that generalises. The pattern fix stops this
 * sentence; the precondition stops the whole class.
 *
 * ── AND THE GUARD AUTHORED THE MESSAGE ────────────────────────────────────────────────────
 * "Write exactly two things ... Nothing else. Full stop." A guard should constrain content, not
 * write it. The prohibition — do not re-offer what they turned down — is correct and is kept
 * verbatim. The two-item script is gone.
 *
 * Driven against the SHIPPED detector. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: declined-alternative.test.js <popup.js> [popup.js...]'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('    var customerDeclinedAlternative = false;');
  if (a < 0) throw new Error('decline detector not found in ' + file);
  const endMark = '      if(customerDeclinedAlternative) break;\n    }';
  const b = src.indexOf(endMark, a);
  if (b < 0) throw new Error('decline detector end not found in ' + file);

  const sb = { String, RegExp, console: { log() {} }, _lpD() {} };
  vm.createContext(sb);
  vm.runInContext(
    'function detect(noteEls){\n' + src.slice(a, b + endMark.length) +
    '\n return { fired: customerDeclinedAlternative, text: customerDeclinedAlternativeText }; }', sb);

  return {
    name: path.basename(path.dirname(file)),
    src,
    detect: notes => vm.runInContext('detect', sb)(notes)
  };
}

const guardedImpls = require('./lib/guarded-impls.js');
const impls = guardedImpls(BUILDS, extract);
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
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

// A note as the shipped selectors read it. noteEls is NEWEST-FIRST.
const N = (dir, title, body) => ({
  getAttribute: a => (a === 'data-direction' ? dir : ''),
  querySelector: s => s.indexOf('legacy-notes-and-history-title') >= 0 ? { innerText: title }
                    : s.indexOf('notes-and-history-item-content') >= 0 ? { innerText: body } : null
});
const fired = (i, notes) => i.detect(notes).fired;

// Amber's real thread, newest first. Her chat inquiry is the OLDEST note on the lead.
const AMBER = [
  N('Outbound', 'Outbound Text Message', 'Amber, inventory has turned over since we first talked.'),
  N('Inbound',  'Inbound Text Message',  "I'm looking for something under 50k miles that I can get a 17500 driveout on. I need backup camera and blind spot monitoring."),
  N('Outbound', 'Outbound Text Message', 'Yes maam of course! What car are we exactly looking for?'),
  N('Inbound',  'Inbound Text Message',  'Price on the 2022 ford escape? I do not want to speak to anyone over the phone. I am just looking for a price. It would be a cash sale.')
];

console.log('\nv9.7.598 — a decline needs something to decline');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);
console.log('');

// ── AMBER ───────────────────────────────────────────────────────────────────
console.log("Amber's real thread — her opening inquiry is not a rejection:");

check('the detector no longer fires on her lead',
  i => fired(i, AMBER), false);

check('...so the ABSOLUTE STOP directive never reaches the prompt',
  i => i.detect(AMBER).text, '');

check('her 7/06 criteria do not trigger it either',
  i => fired(i, [N('Inbound', 'Inbound Text Message',
        "I'm looking for something under 50k miles that I can get a 17500 driveout on."),
        N('Outbound', 'Outbound Text Message', 'What car are we looking for?')]), false);

// ── THE PATTERN HALF ────────────────────────────────────────────────────────
console.log('\n"just looking for X" is an opening, not a decline — unless it excludes something:');

const after = (customerText) => [
  N('Inbound',  'Inbound Text Message', customerText),
  N('Outbound', 'Outbound Text Message', 'We also have a CR-V EX-L if the Civic does not work.')
];

check('"just looking for a price" AFTER an offer is still not a decline',
  i => fired(i, after('I am just looking for a price. It would be a cash sale.')), false);

check('"just looking for the Accord, not the CR-V you sent" IS a decline',
  i => fired(i, after('just looking for the Accord, not the CR-V you sent.')), true);

check('"just want the Civic, don\'t want the CR-V" IS a decline',
  i => fired(i, after("just want the Civic, don't want the CR-V.")), true);

check('"just need something under 20k" alone is not',
  i => fired(i, after('just need something under 20k')), false);

// ── THE STRUCTURAL HALF — THE ONE THAT GENERALISES ──────────────────────────
console.log('\na decline is a response; with nothing sent before it, there is nothing to decline:');

check('an explicit rejection with NO prior outbound does not fire',
  i => fired(i, [N('Inbound', 'Inbound Text Message', 'Not interested in the CR-V, only want the Civic.')]), false);

check('...the SAME words WITH a prior outbound do fire',
  i => fired(i, [N('Inbound',  'Inbound Text Message', 'Not interested in the CR-V, only want the Civic.'),
                 N('Outbound', 'Outbound Text Message', 'We also have a CR-V EX-L.')]), true);

check('a prior outbound EMAIL counts as an offer too',
  i => fired(i, [N('Inbound',  'Inbound Text Message', 'Only want the Civic, not open to the CR-V.'),
                 N('Outbound', 'Email reply to prospect', 'Subject: A CR-V that may fit')]), true);

check('a prior INBOUND does not count — the customer offering nothing is not an offer',
  i => fired(i, [N('Inbound', 'Inbound Text Message', 'Only want the Civic, not open to the CR-V.'),
                 N('Inbound', 'Inbound Text Message', 'Hello?')]), false);

// ── GENUINE DECLINES STILL FIRE ─────────────────────────────────────────────
// The risk of this change is over-suppression: a real "no" that stops being heard.
console.log('\nevery genuine decline shape still fires after an offer:');

for (const [label, text] of [
  ['only interested in the Civic',        'I am only interested in the Civic'],
  ['not open to the CR-V',                'not open to the CR-V at all'],
  ['only want the Accord',                'only want the Accord please'],
  ['not the CR-V, just the Civic',        'not the CR-V, just the Civic'],
  ['prefer the Accord only',              'I prefer the Accord only']
]) {
  check('  ' + label, i => fired(i, after(text)), true);
}

// (v9.7.598) PRE-EXISTING GAP, found by this suite and fixed here rather than left. The pattern's
// lower bound was {5,40}, so any model name shorter than five characters could not be declined
// through it at all. Verified against v9.7.597: the same miss, so this is not a regression from
// this build — it has simply never worked for these names.
console.log('\nshort model names can be declined too — the bound was 5 characters:');
for (const name of ['CR-V', 'RAV4', 'Q5', 'A4', 'TLX', 'ES']) {
  check('  "not the ' + name + ', just the Civic"',
    i => fired(i, after('not the ' + name + ', just the Civic')), true);
}
check('  "not a CR-V, just the Civic" — the a/the branch too',
  i => fired(i, after('not a CR-V, just the Civic')), true);

// ── THE DIRECTIVE NO LONGER WRITES THE MESSAGE ──────────────────────────────
console.log('\nthe directive constrains content instead of authoring it:');

check('the two-item script is gone from the shipped code',
  i => strip(i.src).indexOf('Write exactly two things') >= 0, false);

check('...and "Nothing else. Full stop." with it',
  i => /Nothing else\. Full stop\./.test(strip(i.src)), false);

check('the prohibition itself is kept verbatim — this part was correct',
  i => /Do NOT reference alternatives under any phrasing/.test(strip(i.src)), true);

check('it now asks for a forward move on the customer\'s own terms',
  i => /move the conversation forward on THEIR terms/.test(strip(i.src)), true);

check('...and names the failure it produced, so the shape is banned not just the words',
  i => /reads like a first contact/.test(strip(i.src)), true);

check('the header is no longer an ABSOLUTE STOP',
  i => /CUSTOMER DECLINED ALTERNATIVE — ABSOLUTE STOP/.test(strip(i.src)), false);

// ── OBSERVABILITY ───────────────────────────────────────────────────────────
console.log('\nboth outcomes are visible in the log:');

check('[LP DECLINE DIAG] reports a firing',
  i => /\[LP DECLINE DIAG\] FIRED on/.test(strip(i.src)), true);

check('...and reports a suppression WITH its reason',
  i => /NOTHING was ever offered before it — not a decline/.test(strip(i.src)), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
