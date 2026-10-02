#!/usr/bin/env node
'use strict';
// (v9.7.597) Registered BEFORE anything can throw. A suite that dies during module
// evaluation prints nothing, and nothing reads exactly like 'asserted nothing wrong'.
// See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('value-fact-diag.test.js');

/**
 * value-fact-diag.test.js — v9.7.585, PHASE 2: MEASURE FIRST. NOTHING IS SURFACED.
 *
 * ── WHY THE PHASE 2 BUILD IS A DIAGNOSTIC AND NOT A FEATURE ───────────────────────────────
 * The brief asked whether LP can auto-source the VALUE FACT instead of the agent typing one. Two
 * findings say that question cannot be answered yet, and both are checkable rather than argued.
 *
 * (1) THE RESOLVER HAS NEVER RUN. Its gate tests /VALUE FACT|NURTURE FACT/ against the agent's LP
 *     commands. The live VinSolutions task list tells agents to type [LP: value]. Run the SHIPPED
 *     regex against that exact string and it is false. Across every captured generation — 712 with
 *     no command and 5 carrying ["value"]/["curiosity"] — not one could have fired it. The MANUAL
 *     path is as dead as the automatic one, which inverts the brief's premise.
 *
 * (2) THERE IS NO DENOMINATOR. Nothing counts how often each fact is PRESENT on a lead. If equity
 *     resolves on 4% of leads it is not worth a build; at 40% it plainly is. Measuring it from
 *     captured prompts produced numbers that were matching the prompt's own instruction text —
 *     the self-matching trap, hit three separate times while investigating this. It has to come
 *     from live traffic.
 *
 * ── WHAT WAS FOUND ABOUT THE SIX, AND WHY ONLY ONE IS A REAL CANDIDATE ────────────────────
 *   • store incentives     — already auto-source, zero agentLPCommands refs in that block
 *   • loyalty/owned vehicle— already auto-sources, fires on `if (d.ownedVehicle)`
 *   • unit position        — already auto-sources at the AGED/FRESH block; the copy inside the
 *                            gate is REDUNDANT with a path that already runs
 *   • offer on file        — conditionalOffer is READ twice and ASSIGNED nowhere. Dead branch.
 *   • finance (VR numbers) — blocked by policy, not plumbing: the OTD / PAYMENT DISCIPLINE block
 *                            in the same prompt forbids volunteering a monthly payment unless the
 *                            customer asked. Auto-surfacing VR numbers does exactly that.
 *   • equity               — the one clean candidate; asserts no number.
 *
 * That is why the gate is NOT widened here. Making it accept [LP: value] looks like a one-line fix
 * and would immediately start volunteering payment numbers.
 *
 * ── WHAT THIS SUITE PINS ──────────────────────────────────────────────────────────────────
 * The observer is EXECUTED out of the shipped file. The single most important assertion is that it
 * emits a log line and NOTHING ELSE — no prompt text, ever, on any input. An observer that leaks
 * into the prompt is not an observer.
 *
 * Sliced out of the SHIPPED files. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: value-fact-diag.test.js <popup.js> [popup.js...]'); process.exit(2); }

const START = '    // ── (v9.7.585) VALUE FACT AVAILABILITY OBSERVER';
const END   = '    if (!_lpStale && d.agentLPCommands.some(';

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf(START), b = src.indexOf(END);
  if (a < 0 || b < 0 || b <= a) throw new Error('value-fact observer not found in ' + file);
  // The observer reads `d` and `_lpStale` and writes only to console. `vehicleExtras` is handed in
  // so the suite can prove the observer never touches it.
  const fn = new vm.Script(
    '(function(d, _lpStale, vehicleExtras){\n var logs = [];\n' +
    'var console = { log: function(){ logs.push(Array.prototype.join.call(arguments, " ")); } };\n' +
    src.slice(a, b) +
    '\nreturn { logs: logs, extras: vehicleExtras }; })'
  ).runInNewContext({ String, Array, RegExp, Object });
  return { name: path.basename(path.dirname(file)), run: fn, src };
}

// (v9.7.597) Extraction failure is a REPORTED failure, not a fatal one — see
// tests/lib/guarded-impls.js. Pointed at a build that predates the code under test,
// this suite now runs every assertion and fails loudly instead of printing nothing.
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

const run = (i, d, stale) => i.run(d || {}, !!stale, []);
const line = (i, d, stale) => run(i, d, stale).logs.join('\n');

// Andrea Pardon's real shape: no VR, no owned vehicle, no stock, no LP command.
const ANDREA = { agentLPCommands: [] };
// A lead carrying everything the resolver knows how to read.
const RICH = {
  agentLPCommands: ['VALUE FACT'],
  vrMonthlyPayment: '489', vrAPR: '5.9', vrTerm: '72 mo', vrDownPayment: '3000',
  _hcaCurrentVehicle: '2023 Kia Soul', ownedVehicle: '2023 Kia Soul', ownedMileage: '41000',
  daysOnLot: 82
};

console.log('\nv9.7.585 — value-fact availability is measured, and nothing is surfaced');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── THE CONTAINMENT PROPERTY. This is the one that matters. ───────────────────
console.log('it is an OBSERVER — this is the assertion the whole build rests on:');

check('it adds NOTHING to the prompt, on a lead with every fact present',
  i => run(i, RICH, false).extras.length, 0);

check('...nor on an empty lead, a stale command, or a matching command',
  i => [run(i, ANDREA, false), run(i, RICH, true), run(i, RICH, false)]
        .map(r => r.extras.length), [0, 0, 0]);

check('it emits exactly ONE line per generation — not one per fact',
  i => run(i, RICH, false).logs.length, 1);

// ── It runs unconditionally ───────────────────────────────────────────────────
console.log('\nit runs on every generation, which is the entire point:');

check('it reports on a lead with NO LP command at all — the 712-of-717 case',
  i => /\[LP VALUE FACT DIAG\] gate:NO-COMMAND/.test(line(i, ANDREA, false)), true);

check('it reports even when the command is STALE',
  i => /gate:STALE-COMMAND/.test(line(i, RICH, true)), true);

// ── THE HEADLINE FINDING, made countable in production ────────────────────────
console.log('\nthe gate mismatch is reported by name, so it stops being an argument:');

check('an agent typing [LP: value] is reported as COMMAND-PRESENT-BUT-NO-MATCH',
  i => {
    const l = line(i, { agentLPCommands: ['value'] }, false);
    // Named didNotRun, not `ran`: the first draft of this assertion called it `ran` while testing
    // for "DID NOT RUN" and then expected false, so a CORRECT diag read as a failure. The name has
    // to match what the regex asks or the expectation gets written inverted.
    return { flagged: /COMMAND-PRESENT-BUT-NO-MATCH\[value\]/.test(l), didNotRun: /resolver:DID NOT RUN/.test(l) };
  }, { flagged: true, didNotRun: true });

check('"curiosity" is reported the same way — it is not a value command either',
  i => /COMMAND-PRESENT-BUT-NO-MATCH\[curiosity\]/.test(line(i, { agentLPCommands: ['curiosity'] }, false)), true);

check('a literal "VALUE FACT" is the ONLY thing that reports MATCH + RAN',
  i => {
    const m = line(i, { agentLPCommands: ['VALUE FACT'] }, false);
    return { gate: /gate:MATCH/.test(m), ran: /resolver:RAN/.test(m) };
  }, { gate: true, ran: true });

check('...and NURTURE FACT too, since the shipped gate accepts both',
  i => /gate:MATCH/.test(line(i, { agentLPCommands: ['NURTURE FACT'] }, false)), true);

// ── Per-fact availability, which is the denominator being collected ───────────
console.log('\nper-fact presence, which is the number the build decision needs:');

check('finance names WHICH VR fields exist, not how many',
  i => /finance:YES\(payment\+apr\+term\+down\)/.test(line(i, RICH, false)), true);

check('a partial VR lead reports only what it has',
  i => /finance:YES\(payment\+down\)/.test(
        line(i, { agentLPCommands: [], vrMonthlyPayment: '400', vrDownPayment: '2000' }, false)), true);

check('equity distinguishes its three sources',
  i => /equity:YES\(hcaVehicle\+ownedVehicle\+mileage\)/.test(line(i, RICH, false)), true);

check('absent facts read "no" rather than being omitted — an omitted field cannot be counted',
  i => /finance:no equity:no/.test(line(i, ANDREA, false)), true);

check('the dead conditionalOffer field says WHY it is always absent',
  i => /offer:no\(field is never assigned anywhere in this build\)/.test(line(i, ANDREA, false)), true);

check('unit position reports the value AND that it is already surfaced elsewhere',
  i => /unitPos:YES\(82d — already surfaced by the AGED\/FRESH block, this copy is redundant\)/
        .test(line(i, RICH, false)), true);

check('daysOnLot of 0 is a real reading, not a missing one — typeof, not truthiness',
  i => /unitPos:YES\(0d/.test(line(i, { agentLPCommands: [], daysOnLot: 0 }, false)), true);

// ── PRIVACY: presence, never values ───────────────────────────────────────────
console.log('\nit reports PRESENCE and never VALUES — logs get exported:');

check('no VR figure appears in the line, on a lead carrying all four',
  i => {
    const l = line(i, RICH, false);
    return ['489', '5.9', '72 mo', '3000', '41000', '2023 Kia Soul'].filter(v => l.indexOf(v) >= 0);
  }, []);

// ── It cannot take a generation down ──────────────────────────────────────────
console.log('\nit cannot break a generation, and it cannot fail silently:');

check('a lead with no agentLPCommands array at all still reports',
  i => /\[LP VALUE FACT DIAG\]/.test(line(i, {}, false)), true);

check('a throw is REPORTED, not swallowed into a quiet "nothing available"',
  i => {
    // d.agentLPCommands present but hostile: .map throws.
    const bad = { get agentLPCommands() { throw new Error('scrape blew up'); } };
    const l = line(i, bad, false);
    return /THREW — availability not measured this generation: scrape blew up/.test(l);
  }, true);

check('...and that throw still adds nothing to the prompt',
  i => {
    const bad = { get agentLPCommands() { throw new Error('x'); } };
    return run(i, bad, false).extras.length;
  }, 0);

// ── The gate is deliberately NOT widened ──────────────────────────────────────
console.log('\nthe gate is deliberately left alone, and the reason is recorded in place:');

check('the shipped gate still tests the ORIGINAL strings — this build changed no behaviour',
  i => /\/VALUE FACT\|NURTURE FACT\/i\.test\(c\)/.test(i.src), true);

check('the OTD conflict is written down where the next person will hit it',
  i => /OTD \/ PAYMENT DISCIPLINE block in this same prompt forbids/.test(i.src), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
