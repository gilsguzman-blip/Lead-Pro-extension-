#!/usr/bin/env node
'use strict';
// (v9.7.612) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('voi-conflict-directive.test.js');

/**
 * voi-conflict-directive.test.js — v9.7.690. ONE ANSWER, AND IT HAS TO SURVIVE NOT KNOWING.
 *
 * census.test.js now owns "what do we tell the model when the record names two different
 * vehicles" and asserts there is exactly one implementation with two delegating consumers. That
 * is structure. This suite EXECUTES the shipped helper, because a single owner that answers
 * wrongly is worse than two that answer right — and because source position alone is satisfied by
 * a function nobody calls, the v9.7.563 false-green shape.
 *
 * WHAT WAS THERE BEFORE. Two copies of the same four rules. populateFromData's auto-detect branch
 * built its clarify example from the vehicles actually on the record. buildUserPrompt's
 * voi_conflict chip hard-coded "are you still set on the CR-V, or has the Pilot won you over?" —
 * two real Hondas, shown to the model as the worked example on whatever lead the agent pressed
 * the chip on. On a Kia lead that is a prompt carrying a concrete invitation to ask about a CR-V,
 * which is the invented-vehicle family of v9.7.583 (Andrea Pardon's Camry), v9.7.637 and v9.7.641.
 *
 * The drift was found by a BUILD, not an incident: v9.7.689 removed the word "short" from the
 * clarify sentence and it took two edits at two line numbers, with nothing asserting that the two
 * were one answer.
 *
 * THE HARD CASE IS THE CHIP PATH, which does not know the pair. It must still be useful without
 * inventing one, so the no-pair branch describes the ask by SHAPE and says outright not to make a
 * pair up. Both branches are executed here; neither is allowed to name a vehicle that was not
 * passed in.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: voi-conflict-directive.test.js <popup.js> [popup.js...]'); process.exit(2); }

// Header-stripped: this file's build headers quote its own code, and the v9.7.690 note names the
// retired CR-V/Pilot example verbatim (v9.7.630).
function bodyOf(src) {
  const i = src.lastIndexOf('// Lead Pro -- popup.js  v');
  if (i < 0) throw new Error('no build header found');
  const j = src.indexOf('\n', i);
  return src.slice(j < 0 ? i : j + 1);
}

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const body = bodyOf(src);
  const h = body.indexOf('function _lpVoiConflictDirective(');
  if (h < 0) throw new Error('_lpVoiConflictDirective not found — v9.7.690 owner missing');
  let d = 0, started = false, end = -1;
  for (let i = h; i < body.length; i++) {
    if (body[i] === '{') { d++; started = true; }
    else if (body[i] === '}') { d--; if (started && d === 0) { end = i + 1; break; } }
  }
  const code = body.slice(h, end);
  const sb = { String, Array, RegExp };
  vm.createContext(sb);
  vm.runInContext(code, sb);
  return { name: path.basename(path.dirname(file)), src, body, code,
           run: (v, f) => { sb.__v = v; sb.__f = f; return vm.runInContext('_lpVoiConflictDirective(__v, __f)', sb); },
           stripped: body.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n') };
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

// Henalyn Velasco's real shape (v9.7.409): a panel VOI and an inbound naming a different vehicle.
const PAIR = ['2020 Mazda CX-5 Sport', '2023 Honda CR-V'];
const all = r => r.header + ' ' + r.rules.join(' ');

console.log('\nv9.7.690 — one conflicting-vehicles directive, and it never invents a pair');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);
console.log('');

// ── THE PAIR IS KNOWN (auto-detect) ───────────────────────────────────────────────────────
console.log('when the two vehicles ARE known — populateFromData\'s branch:');

check('both vehicles are named in the header',
  i => { const h = i.run(PAIR, false).header;
         return [h.indexOf('2020 Mazda CX-5 Sport') >= 0, h.indexOf('2023 Honda CR-V') >= 0]; }, [true, true]);

check('the clarify example uses them, with the model year stripped',
  i => /are you still focused on the Mazda CX-5 Sport, or the Honda CR-V\?/.test(all(i.run(PAIR, false))), true);

check('four rules, always',
  i => i.run(PAIR, false).rules.length, 4);

check('it is not marked agent-flagged on the auto-detect path',
  i => /agent-flagged/.test(i.run(PAIR, false).header), false);

// ── THE PAIR IS NOT KNOWN (manual chip) ───────────────────────────────────────────────────
console.log('\n  when they are NOT known — the chip path, which is where the old copy invented two Hondas:');

check('no vehicle name appears anywhere in the directive',
  i => /CR-V|Pilot|Camry|Carnival|Accord|Sportage|Mazda|Honda|Kia|Toyota/.test(all(i.run(null, true))), false);

check('it still tells the model to clarify in one line',
  i => /CLARIFY naturally in one line/.test(all(i.run(null, true))), true);

check('...and says outright not to invent a pair',
  i => /DO NOT INVENT A PAIR OF MODELS TO ASK ABOUT/.test(all(i.run(null, true))), true);

check('...and gives it a usable fallback rather than only a prohibition',
  i => /ask which vehicle they are focused on without naming either/.test(all(i.run(null, true))), true);

check('the header carries the agent-flagged marker',
  i => /CONFLICTING VEHICLES ON THIS CUSTOMER \(agent-flagged\)/.test(i.run(null, true).header), true);

check('the header does not claim a vehicle list it does not have',
  i => /\(.*\/.*\)/.test(i.run(null, true).header.replace(' (agent-flagged)', '')), false);

// A single vehicle is not a conflict, and a one-element array must not produce "the X, or the ".
check('a one-vehicle list falls back to the no-pair wording rather than a half-built example',
  i => { const t = all(i.run(['2023 Honda CR-V'], false));
         return [/DO NOT INVENT A PAIR/.test(t), /CR-V/.test(t)]; }, [true, false]);

check('an empty list does the same',
  i => /DO NOT INVENT A PAIR OF MODELS TO ASK ABOUT/.test(all(i.run([], true))), true);

// ── THE RULES THEMSELVES ARE THE SAME ON BOTH PATHS ───────────────────────────────────────
console.log('\n  the four rules are one answer, not two that can drift:');

const SHARED = [
  'Do NOT confidently assert which vehicle they want',
  'do NOT stack several vehicles into one message',
  'If the conversation arc makes their current focus obvious, use that vehicle',
  'NEVER mention duplicates, records, CRM, or systems to the customer'
];
SHARED.forEach(s => check('both paths carry: ' + JSON.stringify(s.slice(0, 48)),
  i => [all(i.run(PAIR, false)).indexOf(s) >= 0, all(i.run(null, true)).indexOf(s) >= 0], [true, true]));

check('only the clarify rule differs between the two paths',
  i => { const a = i.run(PAIR, false).rules, b = i.run(null, true).rules;
         return a.map((r, n) => r === b[n]); }, [true, true, false, true]);

// ── THE RETIRED COPY IS GONE FROM THE CODE ────────────────────────────────────────────────
console.log('\n  the hard-coded example that shipped is gone (census owns the structure, this owns the text):');

check('"has the Pilot won you over" is not in the code',
  i => i.stripped.indexOf('has the Pilot won you over') >= 0, false);
check('"are you still set on the CR-V" is not in the code',
  i => i.stripped.indexOf('are you still set on the CR-V') >= 0, false);
check('the four rules exist in exactly one place',
  i => (i.stripped.split('NEVER mention duplicates, records, CRM').length - 1), 1);

// The chip path's context lookup is a LOOKUP, not a second answer — it must survive.
check('the chip still stands down when the populate-time directive is already in the context',
  i => i.stripped.indexOf("leadContext.indexOf('CONFLICTING VEHICLES ON THIS CUSTOMER')") >= 0, true);
check('...and when an agent LP VOI note resolved it',
  i => i.stripped.indexOf("leadContext.indexOf('AGENT-DECLARED VOI')") >= 0, true);

// ── NON-VACUITY ───────────────────────────────────────────────────────────────────────────
console.log('\nnon-vacuity — reverting each decision must fail assertions by name:');

function neuter(label, mutate, probe, wantBroken, control, wantControl) {
  const results = impls.map(i => {
    let m;
    try { m = mutate(Object.assign({}, i)); } catch (e) { return 'MUTATE THREW: ' + e.message; }
    let broken, ctl;
    try { broken = JSON.stringify(probe(m)); } catch (e) { broken = 'THREW'; }
    try { ctl = JSON.stringify(control(m)); } catch (e) { ctl = 'THREW'; }
    return JSON.stringify([broken !== JSON.stringify(wantBroken), ctl === JSON.stringify(wantControl)]);
  });
  report(label, results, [true, true]);
}

function rebuild(impl, newCode) {
  const sb = { String, Array, RegExp };
  vm.createContext(sb);
  vm.runInContext(newCode, sb);
  return Object.assign({}, impl, { code: newCode,
    run: (v, f) => { sb.__v = v; sb.__f = f; return vm.runInContext('_lpVoiConflictDirective(__v, __f)', sb); } });
}

neuter('A — the CR-V/Pilot example put back on the no-pair path (control: the known-pair path still names the real two)',
  i => rebuild(i, i.code.replace(
        /'Otherwise CLARIFY naturally in one line, naming[^']*'/,
        "'Otherwise CLARIFY naturally in one line (e.g. \"are you still set on the CR-V, or has the Pilot won you over?\").'")),
  i => /CR-V|Pilot/.test(all(i.run(null, true))), false,
  i => /are you still focused on the Mazda CX-5 Sport, or the Honda CR-V\?/.test(all(i.run(PAIR, false))), true);

neuter('B — a one-vehicle list builds a half-example (control: the full pair is unaffected)',
  i => rebuild(i, i.code.replace('vehicles.length >= 2', 'vehicles.length >= 1')),
  i => { const t = all(i.run(['2023 Honda CR-V'], false)); return [/DO NOT INVENT A PAIR/.test(t), /CR-V/.test(t)]; },
  [true, false],
  i => /are you still focused on the Mazda CX-5 Sport, or the Honda CR-V\?/.test(all(i.run(PAIR, false))), true);

neuter('C — the year is no longer stripped (control: four rules still returned)',
  i => rebuild(i, i.code.replace(/\.replace\(\/\^\(19\|20\)\\d\{2\}\\s\*\/, ''\)/g, '')),
  i => /are you still focused on the Mazda CX-5 Sport, or the Honda CR-V\?/.test(all(i.run(PAIR, false))), true,
  i => i.run(PAIR, false).rules.length, 4);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
