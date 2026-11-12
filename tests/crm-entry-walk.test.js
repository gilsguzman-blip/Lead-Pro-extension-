#!/usr/bin/env node
'use strict';
// (v9.7.597) Registered BEFORE anything can throw. A suite that dies during module
// evaluation prints nothing, and nothing reads exactly like 'asserted nothing wrong'.
// See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('crm-entry-walk.test.js');

/**
 * crm-entry-walk.test.js — v9.7.557, PHASE 1 STEP 1.
 *
 * _lpWalkCrmEntries is written and tested here BEFORE any consumer is migrated onto it, so
 * "the utility is correct" and "the migration preserved behaviour" are two separate, separately
 * verifiable claims rather than one diff nobody can check.
 *
 * WHY IT EXISTS: five consumers hand-rolled "split the notes into entries, don't absorb across
 * a boundary", and five shipped a boundary bug — v9.7.552, v9.7.553, v9.7.554, v9.7.555, and
 * v9.7.556 (twice in one build).
 *
 * WHAT THIS FILE ALSO RECORDS, because it changes the shape of the consolidation: of those
 * five, only ONE is actually a dated-entry walker. The evidence is in the shipped bytes —
 *
 *   v9.7.552/553 pivot     ctxForPivot.split('\n')            line-level tag state machine
 *   v9.7.554 coverage      cmdText.split(/[,;\n]/)            an agent's command string
 *   v9.7.555 off-franchise new RegExp(makes.join('|'))        a token boundary
 *   v9.7.556 verbal-commit split(/\n(?=\[date\])/)            ← a dated-entry walk
 *
 * They are three different boundary problems that happen to share a symptom. Forcing the other
 * four onto an entry walker would buy nothing and obscure what each actually does. A SIXTH
 * instance the report did not list IS a genuine fit and is migrated alongside verbal-commit:
 * ctxEntries (the arc-bound / scaffold-leak path), which splits on
 * /\n(?=\[\d{2}\/\d{2}\/)/ — narrower than v9.7.556's. On every real capture the two agree
 * exactly (68 entries on Jason's context either way), but the narrow one silently fails to
 * split "[8/2/2026 ...]" or an indented entry. Latent, not live, and asserted below.
 *
 * Fixtures are real captures already in the repo: Jason Pellegrin's 22-call-note history and
 * Jeffrey Best's Gubagoo chat context.
 *
 * Sliced out of each SHIPPED popup.js. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2);
if (!BUILDS.length) { console.error('usage: crm-entry-walk.test.js <popup.js> [popup.js...]'); process.exit(2); }

const JASON   = fs.readFileSync(path.join(__dirname, 'fixtures', 'jason-pellegrin-context.txt'), 'utf8');
const JEFFREY = fs.readFileSync(path.join(__dirname, 'fixtures', 'jeffrey-best-context.txt'), 'utf8');
const COROLLA = fs.readFileSync(path.join(__dirname, 'fixtures', 'corolla-2068821407-context.txt'), 'utf8');

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');

  const wa = src.indexOf('var LP_CRM_ENTRY_SPLIT_RE =');
  const wb = src.indexOf('// ── (v9.7.554) AGENT LP COMMAND CHANNEL COVERAGE');
  if (wa < 0 || wb < 0 || wb <= wa) throw new Error('could not locate the entry walker in ' + file);

  const ha = src.indexOf('var LP_SCAFFOLD_LINE_RE =');
  const hb = src.indexOf('// (v9.7.429/427) ONE definition of');
  if (ha < 0 || hb < 0 || hb <= ha) throw new Error('could not locate LP_SCAFFOLD_LINE_RE in ' + file);

  const sandbox = { console: { log() {} } };
  vm.createContext(sandbox);
  vm.runInContext(src.slice(ha, hb), sandbox);   // the scaffold marker set the walker reads
  vm.runInContext(src.slice(wa, wb), sandbox);

  return {
    name: path.basename(path.dirname(file)),
    walk: vm.runInContext('(function(c,o){ return _lpWalkCrmEntries(c,o); })', sandbox),
    trim: vm.runInContext('(function(e){ return _lpTrimEntryScaffold(e); })', sandbox),
    splitRe: vm.runInContext('LP_CRM_ENTRY_SPLIT_RE.source', sandbox)
  };
}

// (v9.7.597) Extraction failure is a REPORTED failure, not a fatal one — see
// tests/lib/guarded-impls.js. Pointed at a build that predates the code under test,
// this suite now runs every assertion and fails loudly instead of printing nothing.
const guardedImpls = require('./lib/guarded-impls.js');
const impls = guardedImpls(BUILDS, extract);
let pass = 0, fail = 0;

function check(name, fn, want) {
  const results = impls.map(i => { try { return JSON.stringify(fn(i)); } catch (e) { return 'THREW: ' + e.message; } });
  const agree = results.every(r => r === results[0]);
  const ok = agree && results[0] === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; console.log('  FAIL ' + name);
    if (!agree) impls.forEach((i, n) => console.log('        ' + i.name + ' -> ' + results[n]));
    else console.log('        expected ' + JSON.stringify(want) + '\n        got      ' + results[0]);
  }
}

const FOLLOWUP = '\n\nFOLLOW-UP: read the full transcript and write a response that directly continues THIS conversation.';

console.log('\nv9.7.557 Phase 1 — the shared CRM entry walker, before any consumer is migrated');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

console.log("Jason Pellegrin's real 22-call-note history:");

check('walks his whole context into entries',
  i => i.walk(JASON).length, 68);

check('the [CALL NOTE] filter finds exactly the 22 call notes',
  i => i.walk(JASON, { type: '[CALL NOTE]' }).length, 22);

check('entry order is context order — newest first, as VinSolutions renders',
  i => i.walk(JASON, { type: '[CALL NOTE]' }).slice(0, 2).map(e => e.date),
  ['08/20/2026 11:36 AM', '08/19/2026 4:10 PM']);

check('the 8/19 commitment note comes back whole and alone',
  i => i.walk(JASON, { type: '[CALL NOTE]' })[1].text,
  '[08/19/2026 4:10 PM] [CALL NOTE] Outbound phone call (Contacted)\n  By: Chassica Vincent\n  will try to come in on sat just to see what her car is worth sent contact info');

check('no entry ever contains two dated headers',
  i => i.walk(JASON).filter(e => (e.text.match(/\[\d{1,2}\/\d{1,2}\/\d{2,4}[^\]]*\]/g) || []).length > 1).length,
  0);

check('the cap counts KEPT entries, not scanned ones',
  i => i.walk(JASON, { type: '[CALL NOTE]', max: 6 }).map(e => e.date),
  ['08/20/2026 11:36 AM', '08/19/2026 4:10 PM', '08/17/2026 4:59 PM',
   '08/06/2026 12:40 PM', '08/04/2026 10:22 AM', '07/29/2026 5:25 PM']);

check('index is the position among KEPT entries',
  i => i.walk(JASON, { type: '[CALL NOTE]', max: 3 }).map(e => e.index), [0, 1, 2]);

console.log("\nJeffrey Best's Gubagoo chat context — a different note shape entirely:");

check('his context walks without absorbing the chat turns into neighbours',
  i => i.walk(JEFFREY).filter(e => (e.text.match(/\[\d{1,2}\/\d{1,2}\/\d{2,4}[^\]]*\]/g) || []).length > 1).length,
  0);

check('the [GUBAGOO CHAT] entry survives as ONE entry with its turns intact',
  i => {
    const g = i.walk(JEFFREY, { type: '[GUBAGOO CHAT]' });
    return { entries: g.length, customerTurns: (g[0].text.match(/\[CUSTOMER\]/g) || []).length };
  },
  { entries: 1, customerTurns: 5 });

// Jeffrey's context genuinely carries ONE call note (08/18 9:54 AM) — the filter finds it and
// nothing else, which is the real assertion. A filter that matches nothing is tested below with
// a tag that is actually absent.
check('the [CALL NOTE] filter finds his single call note and no chat entries',
  i => i.walk(JEFFREY, { type: '[CALL NOTE]' }).map(e => e.date), ['08/18/2026 9:54 AM']);

check('a type filter that matches nothing returns empty, not everything',
  i => i.walk(JEFFREY, { type: '[NO SUCH TAG]' }).length, 0);

check("the Corolla capture walks too — a third real shape",
  i => i.walk(COROLLA).filter(e => (e.text.match(/\[\d{1,2}\/\d{1,2}\/\d{2,4}[^\]]*\]/g) || []).length > 1).length,
  0);

console.log('\nthe scaffold trim — the v9.7.556 mechanism, now shared:');

check('a trailing FOLLOW-UP block is trimmed off the last entry',
  i => i.walk('[08/19/2026 3:21 PM] [CALL NOTE] Outbound phone call (Contacted)\n  By: A\n  coming sat 29th 4pm' + FOLLOWUP)[0].text,
  '[08/19/2026 3:21 PM] [CALL NOTE] Outbound phone call (Contacted)\n  By: A\n  coming sat 29th 4pm');

check('trimScaffold:false returns the raw entry',
  i => /FOLLOW-UP/.test(i.walk('[08/19/2026 3:21 PM] [CALL NOTE] a' + FOLLOWUP, { trimScaffold: false })[0].text),
  true);

check("an entry's own dated header is never treated as scaffold",
  i => i.trim('[08/19/2026 3:21 PM] [NOTE] Manager: Ken Young\n  body line'),
  '[08/19/2026 3:21 PM] [NOTE] Manager: Ken Young\n  body line');

check('...but a scaffold line BELOW the header still cuts',
  i => i.trim('[08/19/2026 3:21 PM] [NOTE] General Note\n  body line\nManager: Ken Young'),
  '[08/19/2026 3:21 PM] [NOTE] General Note\n  body line');

console.log('\nthe boundary itself — including where the old ctxEntries pattern silently failed:');

const NARROW = /\n(?=\[\d{2}\/\d{2}\/)/;   // the ctxEntries pattern, for comparison

check('on the real captures the two patterns agree exactly',
  i => [JASON, JEFFREY, COROLLA].map(c => i.walk(c, { trimScaffold: false }).length
                                          === c.split(NARROW).filter(Boolean).length),
  [true, true, true]);

check('a one-digit month/day splits here and did NOT under ctxEntries',
  i => {
    const t = '[8/2/2026 9:00 AM] [CALL NOTE] a\n[8/1/2026 9:00 AM] [CALL NOTE] b';
    return { shared: i.walk(t).length, ctxEntries: t.split(NARROW).filter(Boolean).length };
  },
  { shared: 2, ctxEntries: 1 });

check('an indented entry splits here and did NOT under ctxEntries',
  i => {
    const t = '[08/02/2026 9:00 AM] [CALL NOTE] a\n  [08/01/2026 9:00 AM] [CALL NOTE] b';
    return { shared: i.walk(t).length, ctxEntries: t.split(NARROW).filter(Boolean).length };
  },
  { shared: 2, ctxEntries: 1 });

check('a two-digit year splits',
  i => i.walk('[08/02/26 9:00 AM] [CALL NOTE] a\n[08/01/26 9:00 AM] [CALL NOTE] b').length, 2);

check('a bracketed tag that is NOT a date does not open an entry',
  i => i.walk('[08/02/2026 9:00 AM] [CALL NOTE] a\n[CUSTOMER] still interested').length, 1);

check('a date inside an entry body does not split it',
  i => i.walk('[08/02/2026 9:00 AM] [CALL NOTE] Outbound\n  By: A\n  he said 08/09/2026 works').length, 1);

console.log('\nnever throws, whatever it is handed:');

check('empty context',      i => i.walk('').length, 0);
check('null context',       i => i.walk(null).length, 0);
check('undefined context',  i => i.walk(undefined).length, 0);
check('no opts at all',     i => i.walk(JASON).length > 0, true);
check('a context with no dated entries at all',
  i => i.walk('just some prose with no entries in it').map(e => e.text),
  ['just some prose with no entries in it']);
// A dated header with an empty body is real content (VinSolutions renders these), so it is KEPT
// — dropping it would lose an entry that happened. Only genuinely empty text is dropped.
check('a dated header with an empty body is kept, trimmed',
  i => i.walk('[08/02/2026 9:00 AM] [CALL NOTE] a\n[08/01/2026 9:00 AM]   ').map(e => e.text),
  ['[08/02/2026 9:00 AM] [CALL NOTE] a', '[08/01/2026 9:00 AM]']);

check('a whitespace-only context yields nothing',
  i => i.walk('   \n  \n ').length, 0);
check('max:0 is ignored rather than returning nothing',
  i => i.walk(JASON, { type: '[CALL NOTE]', max: 0 }).length, 22);
check('an array of types matches any of them',
  i => i.walk(JASON, { type: ['[CALL NOTE]', '[NOTE]'] }).length > 22, true);
check('date is empty string, not undefined, when an entry has no header',
  i => i.walk('no header here')[0].date, '');

console.log('\nthe migration guarantee — byte-identical, not merely content-identical:');

// The walker trims each entry by default, which the hand-rolled ctxEntries split did not: the
// FINAL entry in a context otherwise loses its trailing newline. trimText:false exists so a
// migration can be proven byte-identical rather than argued to be inert.
[['jason', JASON], ['jeffrey', JEFFREY], ['corolla', COROLLA]].forEach(([label, ctx]) =>
  check('ctxEntries on the ' + label + ' capture is byte-identical to the old split',
    i => {
      const oldWay = ctx.split(NARROW).filter(Boolean);
      const newWay = i.walk(ctx, { trimScaffold: false, trimText: false }).map(e => e.text).filter(Boolean);
      return oldWay.length === newWay.length && oldWay.every((x, n) => x === newWay[n]);
    }, true));

check('...and WITHOUT trimText:false the last entry differs, which is why the option exists',
  i => {
    const oldWay = JASON.split(NARROW).filter(Boolean);
    const trimmed = i.walk(JASON, { trimScaffold: false }).map(e => e.text).filter(Boolean);
    return oldWay.map((x, n) => x === trimmed[n]).filter(v => !v).length;
  }, 1);

console.log('\nboth builds ship the identical boundary:');
check('LP_CRM_ENTRY_SPLIT_RE source is the v9.7.556-proven pattern',
  i => i.splitRe, '\\n(?=\\s*\\[\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}[^\\n\\]]*\\])');

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
