#!/usr/bin/env node
'use strict';
// (v9.7.601) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('phone-directory.test.js');

/**
 * phone-directory.test.js — v9.7.601. THE NUMBER IN THE SIGNATURE.
 *
 * Phone resolution is the single most incident-prone data path in this extension and until this
 * suite it had NO test coverage of any kind. Its history:
 *
 *   v9.7.469  Veronica's lead read "Veronica Aguilar"; no PHONE_DIR key under that name, so it
 *             fell to STORE_PHONE_FALLBACK['6191'] — which was Patricia Galvan's PERSONAL
 *             extension. A customer was given a co-worker's direct line.
 *   v9.7.474  Same class: replaced agents (Zoey→Veronica, Jacqueline→Jordyn) had no entries.
 *   v9.7.481  Elsa McHaney had no entry; fell through to Gil's own Baytown line.
 *   v9.7.482  Two agents found signing WRONG numbers in production — Kristen's Lafayette line,
 *             and Tania's, which was Rotaxlyn Hudson's number.
 *   v9.7.596  A guard meant to refuse a personal line read the table the config had already
 *             overwritten, so its "replacement" was the number it had just refused.
 *   v9.7.601  'veronica aguilar' found deleted by the 482 rebuild — see below.
 *
 * Every one of those is a data defect that a table-vs-source-of-truth check would have caught on
 * the build that introduced it. This suite is that check, driven against the SHIPPED lookupPhone
 * and the SHIPPED tables — executed, never scanned. Both builds must agree.
 *
 * ── THE 7/24/26 CONTACT SHEET ─────────────────────────────────────────────────────────────────
 * Gil's authoritative BDC agent contact sheet, transcribed below. 14 agents × 3 store columns.
 * Baytown is one column on the sheet and is shared by all three Baytown rooftops (6189/6190/6191).
 * MOBILE numbers are deliberately excluded and must never enter this file — asserted at the end.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: phone-directory.test.js <popup.js> [popup.js...]'); process.exit(2); }

function slice(src, startMark, endMark, what, from) {
  const a = src.indexOf(startMark, from || 0);
  if (a < 0) throw new Error(what + ' not found');
  const b = src.indexOf(endMark, a);
  if (b < 0) throw new Error(what + ' end not found');
  return { text: src.slice(a, b + endMark.length), end: b };
}

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const map = slice(src, 'const DEALER_ID_MAP = {', '\n};', 'DEALER_ID_MAP');
  const dir = slice(src, 'const PHONE_DIR = {', '\n};', 'PHONE_DIR');
  const fb  = slice(src, 'var STORE_PHONE_FALLBACK = {', '\n};', 'STORE_PHONE_FALLBACK');
  const fn  = slice(src, 'function lookupPhone(agentName, store, dealerId) {', '\n}', 'lookupPhone');
  const inD = slice(src, 'function _lpAgentInDirectory(agentName) {', '\n}', '_lpAgentInDirectory');

  const sb = { String, Object, console: { log() {} }, _lpD() {} };
  vm.createContext(sb);
  vm.runInContext(map.text + '\n' + dir.text + '\n' + fb.text + '\n' + fn.text + '\n' + inD.text, sb);

  return {
    name: path.basename(path.dirname(file)),
    src,
    lookup: (who, store, did) => vm.runInContext('lookupPhone', sb)(who, store, did),
    inDir:  who => vm.runInContext('_lpAgentInDirectory', sb)(who),
    dir:    () => vm.runInContext('PHONE_DIR', sb),
    fb:     () => vm.runInContext('STORE_PHONE_FALLBACK', sb)
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

// ── THE SHEET, AS TRANSCRIBED ────────────────────────────────────────────────
// [baytown, honda_laf (24399), audi (21135)]
const SHEET = {
  'noelia diaz':         ['281-837-3683', '337-321-5656', '337-247-9118'],
  'anahi lepe':          ['281-837-3629', '337-205-8409', '337-247-7866'],
  'berenice torres':     ['281-837-3377', '337-205-8311', '337-247-7877'],
  'melanie martinez':    ['281-837-3373', '337-568-0435', '337-889-2034'],
  'elsa mchaney':        ['281-837-3624', '337-889-2169', '337-483-1427'],
  'kaylee guzman':       ['281-837-3381', '337-889-2654', '337-557-8731'],
  'kristen willis':      ['281-837-3380', '337-443-4448', '337-247-9205'],
  'veronica villanueva': ['281-837-3682', '337-205-8335', '337-568-0459'],
  'patricia galvan':     ['281-837-3384', '337-205-8323', '337-247-9237'],
  'rotaxlyn hudson':     ['281-837-3684', '337-205-8301', '337-247-9266'],
  'tania gonzalez':      ['281-837-3383', '337-205-8315', '337-247-9304'],
  'jolette aguilar':     ['281-837-3627', '337-205-8339', '337-247-9110'],
  'jordyn guzman':       ['281-837-3630', '337-247-9053', '337-901-8079'],
  'samantha lopez':      ['281-837-3375', '337-541-0253', '337-706-0507']
};
const STORE_LINES = { '6189':'281-837-3687', '6190':'281-837-3687', '6191':'281-837-3687',
                      '24399':'337-326-4484', '21135':'337-252-0822' };

console.log('\nv9.7.601 — the number that goes in the signature');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);
console.log('');

// ── EVERY SHEET AGENT, EVERY ROOFTOP, THROUGH THE REAL RESOLVER ──────────────
// This is the check that would have caught v9.7.482's two wrong numbers on the build that
// shipped them. It runs lookupPhone; it does not read the table.
console.log('all 14 sheet agents resolve to their sheet number at all 5 rooftops:');
for (const who of Object.keys(SHEET)) {
  const [bay, laf, audi] = SHEET[who];
  check('  ' + who, i => ({
    '6189':  i.lookup(who, 'Community Toyota Baytown',  '6189'),
    '6190':  i.lookup(who, 'Community Kia Baytown',     '6190'),
    '6191':  i.lookup(who, 'Community Honda Baytown',   '6191'),
    '24399': i.lookup(who, 'Community Honda Lafayette', '24399'),
    '21135': i.lookup(who, 'Audi Lafayette',            '21135')
  }), { '6189': bay, '6190': bay, '6191': bay, '24399': laf, '21135': audi });
}

// ── THE DIRECTORY IS EXACTLY WHAT GIL NAMED ──────────────────────────────────
// (v9.7.602) Gil resolved all three double-named agents on 8/28 — "Jolette Aguilar is Kimberly
// Aguilar, Patricia Galvan is Patricia Serna, Veronica Villanueva is Veronica Aguilar" — and named
// the surviving key in each pair. The second name of each is removed, not aliased. Roslynn Kelley
// removed too: she has left the BDC.
console.log('\nthe four keys Gil removed are gone, and nothing else went with them:');
check('the directory is exactly the 14 sheet agents + Gil + Samantha Gonzalez',
  i => Object.keys(i.dir()).sort(),
  [...Object.keys(SHEET), 'gil guzman', 'samantha gonzalez'].sort());
for (const gone of ['kimberly aguilar', 'patricia serna', 'veronica aguilar', 'roslynn kelley']) {
  check('  "' + gone + '" is no longer a key', i => Object.keys(i.dir()).includes(gone), false);
}

// The surviving name of each pair must still resolve — removing the partner must not disturb it.
console.log('\nthe surviving name of each pair still resolves to that person\'s line:');
check('jolette aguilar at Honda Baytown',   i => i.lookup('Jolette Aguilar',    '', '6191'), '281-837-3627');
check('patricia galvan at Honda Baytown',   i => i.lookup('Patricia Galvan',    '', '6191'), '281-837-3384');
check('veronica villanueva at Honda Baytown', i => i.lookup('Veronica Villanueva','', '6191'), '281-837-3682');

// Two different people who share a first name. This is why phoneFor()'s assignments matcher —
// which binds on first name as a substring — must not be activated as written.
console.log('\nthe two Samanthas are different people and must not collapse:');
check('Samantha Lopez and Samantha Gonzalez resolve to different numbers everywhere',
  i => ['6189','6190','6191','24399','21135']
        .map(d => i.lookup('Samantha Lopez','',d) !== i.lookup('Samantha Gonzalez','',d)),
  [true,true,true,true,true]);

// ── NO STORE FALLBACK MAY BE A PERSON'S DIRECT LINE ──────────────────────────
// This is the v9.7.469/474/481 defect stated as an invariant. It shipped three separate times.
console.log('\nno store fallback is any agent\'s personal line — the v9.7.469 invariant:');
check('the five store lines are the general numbers',
  i => i.fb(), STORE_LINES);
check('none of them appears in any PHONE_DIR row',
  i => {
    const personal = new Set();
    const d = i.dir();
    for (const k in d) for (const c in d[k]) personal.add(d[k][c]);
    return Object.keys(i.fb()).filter(s => personal.has(i.fb()[s]));
  }, []);
check('an agent NOT in the directory falls to the store line, never to a person',
  i => ['6189','6190','6191','24399','21135'].map(d => i.lookup('Nobody Here', '', d)),
  ['281-837-3687','281-837-3687','281-837-3687','337-326-4484','337-252-0822']);

// ── NO TWO AGENTS SHARE A NUMBER ─────────────────────────────────────────────
// v9.7.482 found Tania signing with Rotaxlyn's line. As of v9.7.602 there are no aliases left, so
// this is now a flat one-number-one-person check with no collapsing step — any collision at all is
// two different humans on one line.
console.log('\nno two people share a direct dial — the v9.7.482 defect:');
check('every direct dial belongs to exactly one person',
  i => {
    const d = i.dir(), owner = {}, dupes = [];
    for (const k in d) for (const col in d[k]) {
      const n = d[k][col];
      if (owner[n] && owner[n] !== k) dupes.push(n + ' = ' + owner[n] + ' AND ' + k);
      else owner[n] = k;
    }
    return dupes;
  }, []);

// ── A MISS MUST BE VISIBLE ───────────────────────────────────────────────────
// (v9.7.602) The reason every incident in this file went unnoticed until Gil read a number in a
// delivered message: lookupPhone returns the store switchboard for an unknown agent, so the caller
// sees a valid number and nothing reports that the lookup failed. _lpAgentInDirectory answers the
// question lookupPhone cannot, and must agree with it on key normalization or the log lies.
console.log('\nan agent the table does not hold is reported as a miss, not as a hit:');
check('a known agent is in the directory, in any casing or padding',
  i => [i.inDir('Kaylee Guzman'), i.inDir('KAYLEE GUZMAN'), i.inDir('  kaylee guzman  ')],
  [true, true, true]);
check('each of the four removed names now reports a MISS',
  i => ['Kimberly Aguilar','Patricia Serna','Veronica Aguilar','Roslynn Kelley'].map(n => i.inDir(n)),
  [false, false, false, false]);
check('...even though lookupPhone still hands back a real-looking number for them',
  i => ['Kimberly Aguilar','Patricia Serna','Veronica Aguilar','Roslynn Kelley']
        .map(n => i.lookup(n, 'Community Honda Baytown', '6191')),
  ['281-837-3687','281-837-3687','281-837-3687','281-837-3687']);
check('an empty or missing agent name is not claimed as a directory hit',
  i => [i.inDir(''), i.inDir(null), i.inDir(undefined)], [false, false, false]);

// ── MOBILE NUMBERS ARE NOT STORED ────────────────────────────────────────────
// Gil excluded them deliberately. They are personal cell numbers for 14 real people; this file
// ships to the Chrome Web Store. Asserted against the shipped source, not the table, because the
// risk is a number pasted anywhere in the file — a comment included.
console.log('\nno agent mobile number appears anywhere in the shipped file:');
// Comments are scanned too, deliberately: this file ships to the Chrome Web Store, so a number
// sitting in a changelog is as published as one in the table. Two superseded values are recorded
// in comments by name and are allowed BY VALUE, so a third number appearing anywhere still trips.
const HISTORICAL = {
  // v9.7.482 header, documenting a correction: Kristen's Lafayette line was wrong in production.
  // Superseded by 337-443-4448. Never a mobile — a misfiled desk line.
  '337-446-2432': "Kristen Willis's old (incorrect) Honda Lafayette line, corrected in v9.7.482",
  // STORE_PHONE_FALLBACK's own "was" annotation. A former general store line, not a person's.
  '337-235-9086': 'the previous Honda Lafayette store fallback, replaced in v9.7.482',
  // (v9.7.602) Roslynn Kelley's Baytown desk line, named in the v9.7.482 header. She has left the
  // BDC and her entry is removed from the table this build; this is the residue in the changelog,
  // which is an append-only record. A dealership desk extension, not a personal or mobile number.
  // Worth noting the tripwire found this by itself the moment her row was deleted — which is the
  // whole point of scanning the file rather than the table.
  '281-837-3626': "Roslynn Kelley's former Baytown desk line, recorded in the v9.7.482 header"
};
check('the file carries no number outside the live set and two documented historical values',
  i => {
    const allowed = new Set(Object.keys(STORE_LINES).map(k => STORE_LINES[k]));
    const d = i.dir();
    for (const k in d) for (const c in d[k]) allowed.add(d[k][c]);
    Object.keys(HISTORICAL).forEach(n => allowed.add(n));
    const found = i.src.match(/\b\d{3}-\d{3}-\d{4}\b/g) || [];
    return [...new Set(found)].filter(n => !allowed.has(n));
  }, []);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
