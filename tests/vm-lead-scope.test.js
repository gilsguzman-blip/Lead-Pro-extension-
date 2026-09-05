#!/usr/bin/env node
'use strict';
// (v9.7.604) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('vm-lead-scope.test.js');

/**
 * vm-lead-scope.test.js — v9.7.604. ONE CUSTOMER'S VOICEMAIL UNDER ANOTHER CUSTOMER'S NAME.
 *
 * LIVE, 8/29. Four feedback captures carried a "final" voicemail belonging to a different lead,
 * and three of the four named the WRONG ROOFTOP:
 *
 *   lead 2075621339  Audi Lafayette, A4 Premium Plus, stock P7352
 *     → "Hi, this is Jolette with Community Honda Lafayette. I saw your Capital One
 *        pre-qualification come through ... what new Honda you're shopping for"
 *
 *   lead 2075587581  Community Honda Lafayette, 2021 Kia Rio LX
 *     → "this is Jolette with Community Toyota Baytown ... application through Click & Go
 *        ... what new Toyota you're shopping for"
 *
 *   lead 2075679374  Community Honda Lafayette, KBB trade on a 2010 GMC Sierra
 *     → "this is Jolette with Community Honda Baytown ... confirm your appointment Monday
 *        ... the higher trim with the sensors you wanted"
 *
 *   lead 2074243216  Community Toyota Baytown, Tacoma TRD Sport, 4.99% for 60 months
 *     → a 2026 4Runner script quoting 4.99% for 48 months
 *
 * CAUSE. output-vm was written in exactly two places — cleared at the top of generateVoicemail()
 * and filled at its end. Nothing else ever cleared it: not GRAB LEAD, not generateAll(). A
 * voicemail therefore survived every subsequent grab until another was generated.
 *
 * This was not confined to telemetry. output-vm is a visible textarea with a copy button, so the
 * previous customer's script sat on screen under the new customer's record, ready to send.
 *
 * FIX. The field carries the lead it was written for. A mismatch clears it on the next grab, and
 * both telemetry captures read it through _lpVmForLead so a missed path still cannot file one
 * lead's voicemail under another's id. Stamped rather than blind-cleared so that re-grabbing the
 * SAME lead — an ordinary thing to do — does not silently destroy the agent's voicemail.
 *
 * Drives the SHIPPED helper. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: vm-lead-scope.test.js <popup.js> [popup.js...]'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('function _lpVmLeadStamp(el) {');
  if (a < 0) throw new Error('_lpVmLeadStamp not found');
  const endMark = '  } catch (e) { return \'\'; }\n}';
  const b = src.indexOf(endMark, src.indexOf('function _lpVmForLead(leadId) {'));
  if (b < 0) throw new Error('_lpVmForLead end not found');
  return { name: path.basename(path.dirname(file)), src, code: src.slice(a, b + endMark.length) };
}

// A DOM stand-in carrying only what the helper touches.
function mkCtx(impl, fieldValue, stamp) {
  const el = { value: fieldValue, dataset: stamp === null ? undefined : { lpLeadId: stamp } };
  const warns = [];
  const sb = {
    String, document: { getElementById: id => (id === 'output-vm' ? el : null) },
    console: { warn: (...x) => warns.push(x.join(' ')), log() {} }
  };
  vm.createContext(sb);
  vm.runInContext(impl.code, sb);
  return { sb, warns, el };
}
const readFor = (impl, fieldValue, stamp, leadId) => {
  const c = mkCtx(impl, fieldValue, stamp);
  return { got: vm.runInContext('_lpVmForLead', c.sb)(leadId), warns: c.warns };
};

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

const AUDI_VM = 'Hi, this is Jolette with Community Honda Lafayette. I saw your Capital One '
              + 'pre-qualification come through, and I would like to learn what new Honda you are shopping for.';

console.log('\nv9.7.604 — a voicemail belongs to the lead it was written for');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);
console.log('');

// ── THE FOUR REAL CAPTURES ──────────────────────────────────────────────────
console.log('the 8/29 captures — a foreign voicemail is never returned as this lead\'s draft:');

check('the Audi A4 lead does not get the Cap One Honda script',
  i => readFor(i, AUDI_VM, '2075630449', '2075621339').got, '');

check('...and the mismatch is reported with BOTH lead ids, not silently dropped',
  i => { const w = readFor(i, AUDI_VM, '2075630449', '2075621339').warns.join(' ');
         return /LP VM SCOPE/.test(w) && w.indexOf('2075630449') > 0 && w.indexOf('2075621339') > 0; }, true);

check('the Kia Rio lead does not get the Toyota Click & Go script',
  i => readFor(i, 'this is Jolette with Community Toyota Baytown ... Click & Go',
       '2075504933', '2075587581').got, '');

check('the Tacoma lead does not get the 4Runner script',
  i => readFor(i, 'your 2026 4Runner question is about the 4.99% APR for 48 months',
       '9999999999', '2074243216').got, '');

// ── THE FIELD IS STILL USABLE FOR ITS OWN LEAD ──────────────────────────────
// The risk of this change is over-suppression: an agent losing a voicemail they just made.
console.log('\nthe agent keeps the voicemail they actually generated:');

check('a matching stamp returns the voicemail unchanged',
  i => readFor(i, 'Hi Dean, this is Jolette with Community Honda Lafayette.',
       '2075679374', '2075679374').got, 'Hi Dean, this is Jolette with Community Honda Lafayette.');

check('...and says nothing in the log when it matches',
  i => readFor(i, 'Hi Dean, this is Jolette.', '2075679374', '2075679374').warns.length, 0);

check('re-grabbing the SAME lead does not lose it — this is why it is stamped, not blind-cleared',
  i => readFor(i, 'a voicemail for this very lead', '2043865698', '2043865698').got,
  'a voicemail for this very lead');

// ── EDGES ───────────────────────────────────────────────────────────────────
console.log('\nthe absent and unknown cases:');

check('an unstamped field is treated as foreign, not assumed to match',
  i => readFor(i, AUDI_VM, '', '2075621339').got, '');

check('a field with no dataset at all cannot throw',
  i => readFor(i, AUDI_VM, null, '2075621339').got, '');

check('an empty field returns empty and logs nothing',
  i => { const r = readFor(i, '   ', '2075621339', '2075621339'); return [r.got, r.warns.length]; }, ['', 0]);

check('a stamped voicemail with an UNKNOWN active lead is still returned, not destroyed',
  i => readFor(i, 'stamped draft', '2075621339', '').got, 'stamped draft');

// ── THE WIRING, NOT JUST THE HELPER ─────────────────────────────────────────
// v9.7.561's lesson: a function can be exhaustively correct and never be handed anything.
console.log('\nthe helper is actually wired into all three sites:');

check('generateVoicemail stamps the field when it writes one',
  i => /vmField\.dataset\.lpLeadId = String\(\(lastScrapedData && lastScrapedData\.autoLeadId\)/.test(strip(i.src)), true);

check('populateFromData clears a foreign voicemail on grab',
  i => /clearing a voicemail written for lead/.test(strip(i.src)), true);

check('the feedback FINAL capture reads through _lpVmForLead',
  i => /voicemail:_lpScrubPII\(_lpVmForLead\(/.test(strip(i.src)), true);

check('the PRIOR draft capture reads through it too',
  i => /voicemail: _lpVmForLead\(/.test(strip(i.src)), true);

check('no capture site reads output-vm raw any more',
  i => (strip(i.src).match(/_g\('output-vm'\)/g) || []).length, 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
