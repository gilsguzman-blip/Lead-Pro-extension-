#!/usr/bin/env node
'use strict';
// Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('audi-persona.test.js');

/**
 * audi-persona.test.js — v9.7.645. THE TITLE STAYS; THE INTRODUCTION DOES NOT REPEAT.
 *
 * Deandre Romee (Audi Lafayette, 9/7, CarGurus, 2020 Dodge Challenger SXT). At 8:40 AM Kristen
 * texted him "Hello Deandre! This is Kristen here with Audi Lafayette, may I communicate with you
 * through text?" and he replied "Yes". At 9:03 AM the LP draft opened:
 *
 *     "Hi Deandre, this is Kristen, your Audi Concierge at Audi Lafayette."
 *
 * — a first-meeting introduction, four minutes after the introduction, in the same thread. The
 * user prompt said the opposite twice ("continue the thread, do not re-introduce or repeat your
 * opener" / "do NOT re-introduce yourself") and lost, because the Audi persona block MANDATED the
 * opener in every format. Two directives, one question, and the one that does not own the question
 * won — the v9.7.631 ownership rule, again.
 *
 * WHAT IS *NOT* A DEFECT, AND THIS SUITE EXISTS PARTLY TO PROTECT IT. The store's AI assistant
 * (Vinessa) also introduces herself as "Audi Concierge at Audi Lafayette", so a bot-touched lead
 * meets two concierges. Gil, 9/7: "They both need to be Consierge. The AI has to keep that persona
 * as well." That overlap is a DECISION. The title is therefore asserted present on BOTH branches,
 * so a later build cannot read the overlap as a bug and quietly remove it.
 *
 * The split is: TITLE unconditional, FIRST-MEETING OPENER only when no outreach has gone out —
 * read from data.hasOutbound, the same field the phase block uses, rather than decided again here.
 *
 * Executes the SHIPPED block. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: audi-persona.test.js <popup.js> [popup.js...]'); process.exit(2); }

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const bail = (m) => require('./lib/fatal-guard.js').bail('audi-persona.test.js', m);

function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf("  let audiNote = '';");
  if (a < 0) bail('the Audi persona block is not in ' + file + ' — THE SUITE DID NOT LOAD');
  if (src.indexOf("  let audiNote = '';", a + 1) >= 0) bail('the audiNote anchor is not unique in ' + file);
  const end = src.indexOf("].join('\\n');", a);
  if (end < 0) bail('the audiNote block end was not found in ' + file);
  const close = src.indexOf('}', end);
  const region = src.slice(a, close + 1);
  if (!/data\.hasOutbound/.test(region)) bail('the lifted block does not read data.hasOutbound in ' + file);
  return { src, region };
}

// Runs the SHIPPED block with the surrounding values it reads.
function build(region, opts) {
  const sb = {
    console: { log() {} }, String, Boolean,
    sc: { isAudi: opts.isAudi !== false, salesRep: opts.salesRep === undefined ? 'Kristen Willis' : opts.salesRep,
          nonAudiVehicle: !!opts.nonAudiVehicle, vehicleBrand: opts.vehicleBrand || '' },
    _currentPersona: opts.persona === undefined ? 'bdc' : opts.persona,
    agentFirst: opts.agentFirst || 'Kristen',
    data: { hasOutbound: !!opts.hasOutbound }
  };
  vm.createContext(sb);
  vm.runInContext(region + '\n;globalThis.__out = audiNote;', sb);
  return String(sb.__out || '');
}

// The exact first-meeting opener the incident produced.
const OPENER = 'this is Kristen, your Audi Concierge at Audi Lafayette.';

for (const file of BUILDS) {
  const B = load(file);
  console.log('\n' + path.relative(process.cwd(), file) + ' — Concierge always; introduced once');

  // ── GIL'S DECISION, PINNED ON BOTH BRANCHES ────────────────────────────────
  console.log('\nthe Concierge title is not conditional — it stays on every touch:');
  const firstTouch = build(B.region, { hasOutbound: false });
  const continuing = build(B.region, { hasOutbound: true });
  // NOT /Concierge/ — that word also appears inside the continuing branch's NEGATIVE instruction
  // ("do not open with 'your Audi Concierge at Audi Lafayette'"), so a bare word-presence test
  // passes even with the title mandate deleted. Neuter C proved that on this very suite. The
  // assertion is the POSITIVE mandate, which is the thing Gil actually decided.
  const MANDATE = /The word "Concierge" must appear in every format/;
  check('  first contact carries the title mandate', MANDATE.test(firstTouch), true);
  check('  a continuing thread carries the SAME title mandate', MANDATE.test(continuing), true);
  check('  ...and says outright that the title stays on every touch after the first',
    /it is the title and it stays, on a first touch and on every touch after/.test(continuing), true);
  check('  the persona is still described as an Audi Concierge, not a sales coordinator',
    /Audi Concierge, not a generic sales coordinator/.test(continuing), true);

  // ── THE INCIDENT ───────────────────────────────────────────────────────────
  console.log('\nthe first-meeting opener is mandated ONLY on a first contact:');
  check('  a genuine first contact still gets the SMS opener verbatim',
    firstTouch.indexOf('SMS opening: "Hi [Name], ' + OPENER + '"') >= 0, true);
  check('  ...and the email opener', firstTouch.indexOf('Email opening: "Hi [Name], ' + OPENER + '"') >= 0, true);
  check('  ...and the voicemail opener',
    firstTouch.indexOf('Voicemail opening: "Hi [Name], ' + OPENER + '"') >= 0, true);

  check('  DEANDRE: outreach already sent — the opener is NOT mandated',
    continuing.indexOf('SMS opening: "Hi [Name], ' + OPENER + '"') >= 0, false);
  check('  ...and the block says so in the negative, naming the exact string to avoid',
    /Do NOT open by introducing yourself/.test(continuing), true);
  check('  ...in all three formats, not just SMS',
    /in any of the three formats/.test(continuing), true);

  // ── THE HALF THAT WAS ALWAYS RIGHT ─────────────────────────────────────────
  console.log('\nthe rest of the persona block is unchanged on both branches:');
  for (const [label, text] of [['first contact', firstTouch], ['continuing', continuing]]) {
    check('  ' + label + ' — the "finds you well" ban survives',
      /I hope this email finds you well/.test(text), true);
    check('  ' + label + ' — white-glove tone line present',
      /elevated, white-glove, personalized/.test(text), true);
    check('  ' + label + ' — Brand Specialist reference present',
      /your Audi Brand Specialist, Kristen Willis/.test(text), true);
  }

  // A non-Audi vehicle at the Audi store keeps the persona and drops the brand language. Deandre's
  // Challenger is exactly this case, so it is not hypothetical.
  const nonAudi = build(B.region, { hasOutbound: true, nonAudiVehicle: true, vehicleBrand: 'Dodge' });
  check('  a Dodge at Audi Lafayette keeps the Concierge persona', /Concierge/.test(nonAudi), true);
  check('  ...and still bans Audi brand language on the vehicle itself',
    /Do NOT say the vehicle has "Audi engineering"/.test(nonAudi), true);

  // ── THE GATE ───────────────────────────────────────────────────────────────
  console.log('\nthe block still fires only where it should:');
  check('  a non-Audi store gets no persona block at all',
    build(B.region, { isAudi: false, hasOutbound: true }), '');
  check('  a director persona at an Audi store gets no persona block',
    build(B.region, { persona: 'director', hasOutbound: true }), '');
  check('  the concierge persona does get it',
    /Concierge/.test(build(B.region, { persona: 'concierge', hasOutbound: true })), true);
  check('  no Brand Specialist assigned falls back cleanly',
    /one of our Audi Brand Specialists/.test(build(B.region, { hasOutbound: true, salesRep: '' })), true);

  // ── OWNERSHIP ──────────────────────────────────────────────────────────────
  // Comment-stripped: this file's build headers quote its own code, which has produced seven false
  // greens since v9.7.563.
  console.log('\nand it reads the phase block\'s field rather than deciding again:');
  const code = B.src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const blockCode = code.slice(code.indexOf("  let audiNote = '';"));
  const blockEnd = blockCode.indexOf("].join('\\n');");
  check('  the branch is data.hasOutbound',
    /data\.hasOutbound/.test(blockCode.slice(0, blockEnd)), true);
  check('  ...and it does not re-derive the answer from note counts or lead age',
    /leadAgeDays|noteCount|totalOutbound/.test(blockCode.slice(0, blockEnd)), false);
}

if (BUILDS.length > 1) {
  console.log('\ndev === comm:');
  const regions = BUILDS.map(f => load(f).region);
  check('  the persona block is byte-identical in both builds',
    regions.every(r => r === regions[0]), true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
