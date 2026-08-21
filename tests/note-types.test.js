#!/usr/bin/env node
'use strict';
/**
 * note-types.test.js — v9.7.560 / proxy v7.56 / reporter v1.14.
 *
 * SCOPE EXPANSION: the verbal-commit regex and the Phase 2 observer now read general notes as
 * well as call notes. Not a one-line type-list change, because general notes are a different
 * shape of content and reading them safely needs two things call notes never did.
 *
 * TWO FINDINGS THAT SHAPED THE BUILD, both measured before any code was written:
 *
 *  1. THE TAG IS [NOTE], NOT [GENERAL NOTE]. The scraper emits "[<date>] [NOTE] General Note",
 *     and the file's own General-Note filter reads indexOf('[NOTE]') && indexOf('General Note').
 *     A type list of '[GENERAL NOTE]' matches ZERO entries on every capture in the repo and
 *     would have shipped as a silent no-op. Asserted below against all three fixtures.
 *
 *  2. 13 OF 23 REAL GENERAL NOTES (57%) CONTAIN THE CUSTOMER'S PHONE OR EMAIL. The corpus in
 *     tests/fixtures/general-notes-corpus.json is 23 distinct general notes pulled from 13
 *     leads' delivered prompts. The single most common general note is the duplicate-check note
 *     — "no dupes <name> <phone> <email> <address>" — which is a block of contact data. That
 *     makes the general-note boilerplate filter a PRIVACY REQUIREMENT, not just a false-positive
 *     guard: without it those notes reach the comprehension probe, and the v9.7.559
 *     unverified-quote path could persist them to KV, against the v9.7.489 posture.
 *
 * Also measured, and stated so expectations are honest: the v9.7.556 commitment regex fires on
 * ZERO of the 23. This widening is not currently adding detections on real data. What it adds is
 * coverage of a note type that CAN carry a commitment, plus the per-type disagreement data to
 * tell whether it ever matters.
 *
 * SUBJECT ATTRIBUTION is addressed here rather than deferred a third time — v9.7.556 recorded it
 * as residual risk on "coming <day>", and agent-typed general notes make it common. It is a
 * narrow veto plus a reported reading, not a classifier: it refuses where the subject is
 * unambiguously us, and reports its reading on every fire so the ambiguous middle is countable.
 *
 * Sliced out of the SHIPPED files. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const args = process.argv.slice(2);
const BUILDS   = args.filter(a => /popup\.js$/.test(a));
const PROXY    = args.find(a => /cloudflare-worker/.test(a));
const REPORTER = args.find(a => /leadpro-reporter/.test(a));
if (!BUILDS.length || !PROXY || !REPORTER) {
  console.error('usage: note-types.test.js <popup.js...> <cloudflare-worker.js> <leadpro-reporter.js>');
  process.exit(2);
}

const FIX = p => fs.readFileSync(path.join(__dirname, 'fixtures', p), 'utf8');
const JASON   = FIX('jason-pellegrin-context.txt');
const JEFFREY = FIX('jeffrey-best-context.txt');
const COROLLA = FIX('corolla-2068821407-context.txt');
const CORPUS  = JSON.parse(FIX('general-notes-corpus.json'));

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const at = (needle) => { const i = src.indexOf(needle); if (i < 0) throw new Error('missing ' + needle + ' in ' + file); return i; };
  const ha = at('var LP_SCAFFOLD_LINE_RE ='), hb = at('// (v9.7.429/427) ONE definition of');
  const wa = at('var LP_CRM_ENTRY_SPLIT_RE ='), wb = at('// ── (v9.7.560) NOTE TYPES');
  const na = wb, nb = at('// ── (v9.7.558) COMPREHENSION PASS');
  const oa = nb, ob = at('// (v9.7.559) DURABLE, NOT EPHEMERAL');
  const sa = ob, sb = at('// ── (v9.7.554) AGENT LP COMMAND CHANNEL COVERAGE');

  const logs = [];
  const sandbox = {
    console: { log: (...x) => logs.push(x.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' ')) },
    window: {}, JSON, Promise, Date, String, Number, Object, Array, RegExp, Math,
    chrome: { runtime: { getManifest: () => ({ version: '9.7.560', version_name: '9.7.560-dev' }) } }
  };
  vm.createContext(sandbox);
  [[ha, hb], [wa, wb], [na, nb], [oa, ob], [sa, sb]].forEach(([a, b]) => vm.runInContext(src.slice(a, b), sandbox));

  // The verbal-commit block, as shipped.
  const va = at('  if (hasCallNoteContent && !data.isShowroomFollowUp) {');
  const vb = at('  if (data.conversationBrief && (data.convState !== ');
  const detect = vm.runInContext(
    '(function(data, hasCallNoteContent){ var hasVerbalCommitment=false, conversationAnalysis="";\n'
    + src.slice(va, vb) + '\n return { fired: hasVerbalCommitment }; })', sandbox);

  const api = vm.runInContext(
    '({ bp:_lpNoteBoilerplateReason, subject:_lpCommitSubject, probe:_lpBuildCommitProbe,'
    + '  run:_lpRunCommitComprehension, send:_lpSendCommitComprehension, walk:_lpWalkCrmEntries,'
    + '  TYPES:LP_NOTE_TYPES })', sandbox);

  return {
    name: path.basename(path.dirname(file)), src, api, sandbox, logs,
    detect: (data) => { logs.length = 0; const r = detect(data, true); return Object.assign({}, r, { logs: logs.slice() }); }
  };
}

const impls = BUILDS.map(extract);
const proxySrc = fs.readFileSync(PROXY, 'utf8');
const reporterSrc = fs.readFileSync(REPORTER, 'utf8');

let pass = 0, fail = 0;
const pending = [];
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
function check(name, fn, want) {
  report(name, impls.map(i => { try { return JSON.stringify(fn(i)); } catch (e) { return 'THREW: ' + e.message; } }), want);
}
function one(name, value, want) {
  const got = (() => { try { return JSON.stringify(value()); } catch (e) { return 'THREW: ' + e.message; } })();
  const ok = got === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + JSON.stringify(want) + '\n        got      ' + got); }
}
function checkAsync(name, fn, want) {
  pending.push(async () => {
    let results;
    try { results = await Promise.all(impls.map(async i => JSON.stringify(await fn(i)))); }
    catch (e) { results = ['THREW: ' + e.message]; }
    report(name, results, want);
  });
}
function section(t) { pending.push(async () => console.log('\n' + t)); }

const NOTE = (body, by) => '[08/19/2026 4:10 PM] [NOTE] General Note\n  By: ' + (by || 'Kaylee Guzman') + '\n  ' + body;
const CALL = (body, by) => '[08/19/2026 4:10 PM] [CALL NOTE] Outbound phone call (Contacted)\n  By: ' + (by || 'Chassica Vincent') + '\n  ' + body;

console.log('\nv9.7.560 — general notes are a different shape of content');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── Finding 1: the tag ─────────────────────────────────────────────────────────
console.log('the tag is [NOTE], not [GENERAL NOTE] — checked, not assumed:');

check('the type constant is [NOTE]', i => i.api.TYPES.GENERAL, '[NOTE]');

check('[GENERAL NOTE] matches nothing on any real capture — it would have been a silent no-op',
  i => [JASON, JEFFREY, COROLLA].map(c => i.api.walk(c, { type: '[GENERAL NOTE]' }).length),
  [0, 0, 0]);

check('[NOTE] finds the real general notes on all three captures',
  i => [JASON, JEFFREY, COROLLA].map(c => i.api.walk(c, { type: '[NOTE]' }).length),
  [12, 1, 1]);

// ── Finding 2: the corpus ──────────────────────────────────────────────────────
console.log('\nthe real 23-note corpus — why the filter is a privacy requirement:');

one('the corpus is 23 distinct real general notes', () => CORPUS.length, 23);

one('13 of them carry the customer\'s phone or email',
  () => CORPUS.filter(c => /\(\d{3}\)\s?\d{3}-\d{4}|@[\w.-]+\.\w{2,}/.test(c.body)).length, 13);

check('EVERY note carrying contact data is refused before it can reach the probe',
  i => CORPUS.filter(c => /\(\d{3}\)\s?\d{3}-\d{4}|@[\w.-]+\.\w{2,}/.test(c.body))
             .filter(c => !i.api.bp(NOTE(c.body), '[NOTE]')).length,
  0);

check('the refusal reason names contact data specifically, so it is auditable',
  i => i.api.bp(NOTE('no dupes Jason Pellegrin Eve: (337) 256-3478 apelle4@gmail.com'), '[NOTE]'),
  'carries customer contact data — duplicate-check note');

// THREE survive, not four. I expected the "GIRLFRIEND'S INFO BUT DO NOT CONTACT SINCE ITS A
// SURPRISE" note to survive as content; it is refused, and correctly — it carries a THIRD
// PARTY's phone and email. That note is not a duplicate-check note and its shape was never
// enumerated, so it is the strongest evidence for the shape-based contact gate over a list of
// known phrasings. (It still reaches the model through the ordinary AGENT CONTEXT path — this
// filter governs only what the commit detectors and the probe read.)
check('the corpus reduces to exactly the three notes with real, contact-free content',
  i => CORPUS.filter(c => !i.api.bp(NOTE(c.body), '[NOTE]')).map(c => c.body.slice(0, 62)).sort(),
  ['By: Mario Sanchez Customer is rescheduling appointment for tom',
   'By: Roslynn Kelley wants to do deal over the phone called Hond',
   'By: Samantha Gonzalez hung up on me- sent txt and email'].sort());

check('the surprise-gift note is refused for carrying a third party\'s contact data',
  i => i.api.bp(NOTE('GIRLFRIEND\u2019S INFO BUT DO NOT CONTACT SINCE ITS A SURPRISE Jasmine Thompson Eve: (346) 710-8939 jthompson100499@gmail.com'), '[NOTE]'),
  'carries customer contact data — duplicate-check note');

check('20 of the 23 are refused',
  i => CORPUS.filter(c => !!i.api.bp(NOTE(c.body), '[NOTE]')).length, 20);

check('the housekeeping shapes are all refused',
  i => [
    'SubmitSENT NEW LEAD Dismiss Edit Assigned To: Kaylee Guzman',
    'Customer copied from Audi Lafayette and assigned to Robert Staten',
    '*Sales rep was alerted*',
    'no active dupes',
    'dupe but only transfered call'
  ].map(b => !!i.api.bp(NOTE(b), '[NOTE]')),
  [true, true, true, true, true]);

check('an empty note and an LP-tag remnant are refused',
  i => [i.api.bp(NOTE(''), '[NOTE]'), i.api.bp(NOTE('LP: value'), '[NOTE]')].map(Boolean), [true, true]);

check('a real content note is NOT refused',
  i => i.api.bp(NOTE('Customer is rescheduling appointment for tomorrow'), '[NOTE]'), '');

check('the call-note filter is unchanged and still type-specific',
  i => [i.api.bp(CALL('Left message'), '[CALL NOTE]'),
        i.api.bp(CALL('will try to come in on sat'), '[CALL NOTE]')],
  ['voicemail/machine boilerplate', '']);

check('a call note is NOT judged by the general-note rules',
  i => i.api.bp(CALL('no dupes, customer will come in Friday'), '[CALL NOTE]'), '');

// ── Subject attribution ────────────────────────────────────────────────────────
console.log('\nsubject attribution — the v9.7.556 residual risk, now addressed:');

// Locate the commitment VERB the way the real regex would, not the full phrase — "I'll come in"
// has no "will come" in it, and searching for the phrase put the index past the subject entirely.
const subj = (i, text) => i.api.subject(text, text.search(/\b(?:come|coming|be there|visit|stop)\b/));
check('"I will come by Thursday" reads as us',        i => subj(i, 'I will come by Thursday'), 'us');
check('"we will be there at 4" reads as us',          i => subj(i, 'we will be there at 4'), 'us');
check('"I\'ll come in and check" reads as us',        i => subj(i, "I'll come in and check"), 'us');
check('"manager will come by" reads as us',           i => subj(i, 'manager will come by'), 'us');
check('"told him I will come by" reads as us',        i => subj(i, 'told him I will come by'), 'us');
check('"customer will come in Friday" reads as them', i => subj(i, 'customer will come in Friday'), 'customer');
check('"he will come in Friday" reads as them',       i => subj(i, 'he will come in Friday'), 'customer');
check('"she is coming in today" reads as them',       i => subj(i, 'she is coming in today'), 'customer');
check('a bare "will come in Friday" is unattributed, not guessed',
  i => subj(i, 'will come in Friday'), 'unattributed');

check('the VETO fires on an agent plan in a general note',
  i => i.detect({ context: NOTE('I will come by his house Thursday to get the paperwork') }).fired, false);

check('...and the refusal is logged with the note type',
  i => /REFUSED — the subject is US, not the customer.*noteType:\[NOTE\]/.test(
    i.detect({ context: NOTE('I will come by his house Thursday to get the paperwork') }).logs.join(' ')), true);

check('a customer-attributed general note still FIRES',
  i => i.detect({ context: NOTE('customer will come in Friday to sign') }).fired, true);

check('the fire reports subject:customer',
  i => (i.detect({ context: NOTE('customer will come in Friday to sign') }).logs.join(' ')
        .match(/subject:(\w+)/) || [])[1], 'customer');

check('the veto does NOT over-reach onto call notes that already worked',
  i => i.detect({ context: CALL('will try to come in on sat just to see what her car is worth') }).fired, true);

// ── No regression on the call-note path ────────────────────────────────────────
console.log('\nthe call-note path is unchanged on real captures:');

check("Jason's verdict still fires from his 8/19 CALL note, not a general note",
  i => {
    const r = i.detect({ context: JASON, isShowroomFollowUp: false });
    const l = r.logs.join(' ');
    return { fired: r.fired, noteType: (l.match(/noteType:(\S+ ?\S*) subject:/) || [])[1] };
  }, { fired: true, noteType: '[CALL NOTE]' });

check('the log reports the true per-type totals for the lead',
  i => (i.detect({ context: JASON }).logs.join(' ')
        .match(/of (\d+) on the lead \((\d+) call, (\d+) general/) || []).slice(1, 4),
  ['34', '22', '12']);

check('a call note still wins over a general note when both could fire',
  i => {
    const ctx = NOTE('customer will come in Friday') + '\n' + CALL('will come in Monday');
    const l = i.detect({ context: ctx }).logs.join(' ');
    return (l.match(/noteType:(\S+ ?\S*) subject:/) || [])[1];
  }, '[CALL NOTE]');

check('a lead with only refused general notes reports NO USABLE NOTE with reasons',
  i => /NO USABLE NOTE.*general\), examined.*refused — \[NOTE\]: carries customer contact data/.test(
    i.detect({ context: NOTE('no dupes Jason Pellegrin Cell: (337) 256-3478 apelle4@gmail.com') }).logs.join(' ')), true);

// ── The comprehension probe ───────────────────────────────────────────────────
console.log('\nthe comprehension probe — same notes, same filter, type-labelled:');

check('the probe labels each note with its type',
  i => {
    const p = i.api.probe(['a call one', 'a general one'], ['[CALL NOTE]', '[NOTE]']);
    return /\[1\] \[CALL NOTE\] a call one/.test(p) && /\[2\] \[NOTE\] a general one/.test(p);
  }, true);

check('the probe tells the model a [NOTE] is often OUR plan',
  i => /a \[NOTE\] is typed by the dealership, so it often records what WE will do/.test(i.api.probe(['x'], ['[NOTE]'])), true);

check('the probe rules out CRM housekeeping explicitly',
  i => /CRM housekeeping is not a commitment/.test(i.api.probe(['x'], ['[NOTE]'])), true);

section('the probe never receives a contact-data note:');

checkAsync('a duplicate-check note is filtered out before the probe is built',
  async i => {
    let sentText = '';
    await i.api.run(NOTE('no dupes Jason Pellegrin Cell: (337) 256-3478 apelle4@gmail.com') + '\n' + CALL('nothing here'),
      { fired: false, quote: '' },
      { fetch: (u, o) => { sentText = JSON.parse(o.body).contents[0].parts[0].text;
                           return Promise.resolve({ json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: '{"kind":"none","note":null,"quote":null}' }] } }] }) }); },
        endpoint: { url: 'https://example.invalid/g' }, attach: p => p, log: () => {}, send: () => {} });
    return ['337', '256-3478', 'apelle4', '@gmail'].filter(n => sentText.indexOf(n) >= 0);
  }, []);

// (v9.7.562) The skip line is now three-way, so this asserts the "everything refused" branch
// specifically rather than the old catch-all wording.
checkAsync('a lead whose only notes are contact-data notes SKIPS, and says how many it refused',
  async i => {
    const logs = [];
    await i.api.run(NOTE('no dupes Jason Pellegrin Cell: (337) 256-3478 apelle4@gmail.com'),
      { fired: false, quote: '' },
      { fetch: () => { throw new Error('probe must not run'); },
        endpoint: { url: 'https://example.invalid/g' }, attach: p => p,
        log: (...x) => logs.push(x.join(' ')), send: () => {} });
    return /SKIPPED — every note was refused \(1 as boilerplate or contact data\)/.test(logs.join(' '));
  }, true);

checkAsync('the observer reports the note type on BOTH sides',
  async i => {
    const logs = [];
    const r = await i.api.run(CALL('will come in Monday'),
      { fired: true, quote: 'will come in Monday', noteType: '[CALL NOTE]' },
      { fetch: () => Promise.resolve({ json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: '{"kind":"firm","note":1,"quote":"will come in Monday"}' }] } }] }) }),
        endpoint: { url: 'https://example.invalid/g' }, attach: p => p,
        log: (...x) => logs.push(x.join(' ')), send: () => {} });
    return { regex: r.regexNoteType, comp: r.compNoteType,
             logged: /regexNoteType:\[CALL NOTE\] compNoteType:\[CALL NOTE\]/.test(logs.join(' ')) };
  }, { regex: '[CALL NOTE]', comp: '[CALL NOTE]', logged: true });

checkAsync('a general-note verdict is reported as such',
  async i => {
    const r = await i.api.run(NOTE('customer will come in Friday to sign'),
      { fired: true, quote: 'will come in Friday', noteType: '[NOTE]' },
      { fetch: () => Promise.resolve({ json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: '{"kind":"firm","note":1,"quote":"customer will come in Friday to sign"}' }] } }] }) }),
        endpoint: { url: 'https://example.invalid/g' }, attach: p => p, log: () => {}, send: () => {} });
    return { comp: r.compNoteType, call: r.callNotesRead, gen: r.generalNotesRead };
  }, { comp: '[NOTE]', call: 0, gen: 1 });

checkAsync('the persisted payload carries the note types and still no contact data',
  async i => {
    let body = null;
    const r = await i.api.run(CALL('will come in Monday'),
      { fired: true, quote: 'will come in Monday', noteType: '[CALL NOTE]' },
      { fetch: () => Promise.resolve({ json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: '{"kind":"firm","note":1,"quote":"will come in Monday"}' }] } }] }) }),
        endpoint: { url: 'https://example.invalid/g' }, attach: p => p, log: () => {},
        send: res => i.api.send(res, { fetch: (u, o) => { body = JSON.parse(o.body); return Promise.resolve({}); },
                                       attach: p => p, scraped: { autoLeadId: '1', phone: '(337) 256-3478' } }) });
    return { regexNoteType: body.regexNoteType, compNoteType: body.compNoteType,
             leaks: JSON.stringify(body).indexOf('256-3478') >= 0 };
  }, { regexNoteType: '[CALL NOTE]', compNoteType: '[CALL NOTE]', leaks: false });

// ── Worker + reporter ──────────────────────────────────────────────────────────
pending.push(async () => {
  console.log('\nproxy v7.56 and reporter v1.14:');
  one('the worker stores both note types',
    () => /regexNoteType:\s*\['\[CALL NOTE\]', '\[NOTE\]'\]\.indexOf\(cc\.regexNoteType\)/.test(proxySrc), true);
  one('an arbitrary note-type string is clamped away rather than stored',
    () => /indexOf\(cc\.compNoteType\)\s*>= 0 \? cc\.compNoteType\s*: ''/.test(proxySrc), true);
  one('the v7.55 fields are untouched — purely additive',
    () => {
      const prev = fs.readFileSync(PROXY.replace('v7.56', 'v7.55'), 'utf8');
      const cut = t => { const a = t.indexOf('const ccValue = JSON.stringify({'); return t.slice(a, t.indexOf('notesRead:', a)); };
      return cut(prev) === cut(proxySrc);
    }, true);
  one('the reporter breaks the deltas down by note type',
    () => /const byNoteType = \{\};/.test(reporterSrc) && /By note type/.test(reporterSrc), true);
  one('pre-v9.7.560 rows with no type land under "unknown", not dropped',
    () => /const nt = e\.regexNoteType \|\| e\.compNoteType \|\| 'unknown';/.test(reporterSrc), true);
  one('the disagreement list gains a NOTE column',
    () => /table\(\['Time \(CT\)', 'Delta', 'Note', 'Store', 'Source', 'Lead'\], disRows\)/.test(reporterSrc), true);

  // Render the real shape through the real renderer.
  const sandbox = { console: { log() {} }, TextDecoder, JSON, Date, Math, Object, String, Number, Intl };
  vm.createContext(sandbox);
  vm.runInContext(reporterSrc.slice(reporterSrc.indexOf('const _CT_FMT ='), reporterSrc.indexOf('function buildReport(')), sandbox);
  const lines = reporterSrc.split('\n');
  let s0 = -1; for (let n = 0; n < lines.length; n++) if (lines[n].startsWith('function buildReport(')) { s0 = n; break; }
  let s1 = -1; for (let n = s0 + 1; n < lines.length; n++) if (lines[n] === '}') { s1 = n; break; }
  vm.runInContext(lines.slice(s0, s1 + 1).join('\n'), sandbox);
  const build = vm.runInContext('buildReport', sandbox);
  const CD = {
    date: '2026-08-21', total: 6,
    deltas: { 'AGREE-COMMITMENT': 2, 'AGREE-NONE': 2, 'DISAGREE-REGEX-ONLY': 1,
              'DISAGREE-COMPREHENSION-ONLY': 0, 'QUOTE-FABRICATED': 1 },
    bySource: { 'CarGurus': { total: 6, agree: 4, disagree: 1, fabricated: 1 } },
    byNoteType: { '[CALL NOTE]': { total: 4, agree: 3, disagree: 1, fabricated: 0 },
                  '[NOTE]':      { total: 1, agree: 1, disagree: 0, fabricated: 0 },
                  'unknown':     { total: 1, agree: 0, disagree: 0, fabricated: 1 } },
    disagreements: [
      { ts: '2026-08-21T15:00:00Z', delta: 'DISAGREE-REGEX-ONLY', noteType: '[CALL NOTE]',
        store: 'Community Honda Lafayette', leadSource: 'CarGurus', autoLeadId: '204', customerId: '142' },
      { ts: '2026-08-21T14:00:00Z', delta: 'QUOTE-FABRICATED', noteType: '',
        store: 'Community Kia Baytown', leadSource: 'CarGurus', autoLeadId: '207', customerId: '111' }
    ],
    regexFired: 3, compFired: 3
  };
  const reqs = [{ final: { ts: '2026-08-21T15:00:00Z', ms: 100, tier: 'primary' }, fails: [], ts: '2026-08-21T15:00:00Z' }];
  const sec = (() => {
    const h = build(reqs, '2026-08-21', null, CD).html;
    const a = h.indexOf('Commit Comprehension');
    return h.slice(a, h.indexOf('LeadPro · Community Auto Group', a));
  })();
  one('the rendered section shows the by-note-type table with friendly labels',
    () => /By note type/.test(sec) && />call note</.test(sec) && />general note</.test(sec), true);
  one('an untyped legacy row renders as "unknown" rather than vanishing',
    () => /unknown/.test(sec), true);
  one('the disagreement rows show their note type',
    () => />call</.test(sec), true);
  one('the section renders no NaN', () => /NaN/.test(sec), false);
  one('...and the section really was found', () => sec.length > 400, true);
  one('byNoteType missing entirely (a v1.13 payload) does not crash the render',
    () => {
      const legacy = Object.assign({}, CD); delete legacy.byNoteType;
      return /Commit Comprehension/.test(build(reqs, '2026-08-21', null, legacy).html);
    }, true);
});

(async () => {
  for (const p of pending) await p();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
