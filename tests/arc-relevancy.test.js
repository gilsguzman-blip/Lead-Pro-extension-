#!/usr/bin/env node
'use strict';
/**
 * arc-relevancy.test.js — v9.7.561, PHASE A ONLY.
 *
 * First step toward a full-arc relevancy pass: given a lead's whole history, what should the
 * next message account for? This build ships the READ and its VERIFICATION only. Nothing is
 * dispatched, logged in the generate path, persisted, or referenced by any prompt builder —
 * Phase B wires it as an observer, Phase C decides promotion off real data. The non-wiring is
 * ASSERTED below, so a later build cannot quietly change it without this file failing.
 *
 * IT DOES NOT SUBSUME THE VERBAL-COMMIT CHECKS. "Did they name a day" is a binary with a single
 * verified quote and four builds of scar tissue (v9.7.197, v9.7.368, v9.7.429/427, v9.7.556).
 * The relevancy read is a multi-item interpretation with far more surface. Folding one into the
 * other would put the question that has actually shipped bad output behind a looser reader, and
 * would break the AGREE/DISAGREE series Phases 2 and 2.5 accumulate. They share the walked arc
 * and any overlap is REPORTED — asserted here — rather than silently duplicated.
 *
 * TWO FINDINGS FROM THE REAL CAPTURES, both of which shaped the walker and both asserted below
 * against the corpus in tests/fixtures/customer-arc-corpus.json (25 real customer-authored items
 * pulled from 19 delivered prompts plus the three stored contexts):
 *
 *  1. THE ENTRY TAG DOES NOT ESTABLISH THE SPEAKER. Of 19 distinct [CUSTOMER]-tagged entries,
 *     FOUR were written by an agent or by System. One reads "wanting to get his girlfriend a new
 *     vehicle for her birthday, coming in next thursday to meet with a sales rep" — and the
 *     v9.7.560 commitment regex matches "coming in next thursday" inside it. A reader trusting
 *     the tag would attribute agent-written text to the customer.
 *
 *  2. EVERY GENUINE INBOUND CARRIES THE CUSTOMER'S PHONE IN ITS HEADER — 15 of 15. Unlike a
 *     general note, that contact data is a structural prefix, not the content, so the v9.7.560
 *     whole-entry refusal would throw the message away. The header is stripped and the body
 *     kept; the whole-entry refusal still applies to general notes, where the contact data IS
 *     the note.
 *
 * Sliced out of the SHIPPED popup.js of each build. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2);
if (!BUILDS.length) { console.error('usage: arc-relevancy.test.js <popup.js> [popup.js...]'); process.exit(2); }

const FIX = p => fs.readFileSync(path.join(__dirname, 'fixtures', p), 'utf8');
const JASON   = FIX('jason-pellegrin-context.txt');
const JEFFREY = FIX('jeffrey-best-context.txt');
const COROLLA = FIX('corolla-2068821407-context.txt');
const CUSTCORPUS = JSON.parse(FIX('customer-arc-corpus.json'));

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const at = n => { const i = src.indexOf(n); if (i < 0) throw new Error('missing ' + n + ' in ' + file); return i; };
  const spans = [
    [at('var LP_SCAFFOLD_LINE_RE ='), at('// (v9.7.429/427) ONE definition of')],
    [at('var LP_CRM_ENTRY_SPLIT_RE ='), at('// ── (v9.7.560) NOTE TYPES')],
    [at('// ── (v9.7.560) NOTE TYPES'), at('// ── (v9.7.561) PHASE A')],
    [at('// ── (v9.7.561) PHASE A'), at('// ── (v9.7.561) THE RELEVANCY READ')],
    [at('// ── (v9.7.561) THE RELEVANCY READ'), at('// ── (v9.7.558) COMPREHENSION PASS')]
  ];
  const sandbox = { console: { log() {} }, JSON, Date, String, Number, Object, Array, RegExp, Math };
  vm.createContext(sandbox);
  spans.forEach(([a, b]) => vm.runInContext(src.slice(a, b), sandbox));
  return {
    name: path.basename(path.dirname(file)), src,
    api: vm.runInContext(
      '({ walkArc:_lpWalkArc, speaker:_lpArcSpeaker, body:_lpArcBody, probe:_lpBuildRelevancyProbe,'
      + '  verify:_lpVerifyRelevancy, verifyItem:_lpVerifyRelevancyItem, overlap:_lpRelevancyCommitOverlap,'
      + '  KINDS:LP_RELEVANCY_KINDS, SPEAKERS:LP_ARC_SPEAKER })', sandbox)
  };
}

const impls = BUILDS.map(extract);
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
function fnBody(src, name) {
  const lines = src.split('\n');
  let a = -1; for (let n = 0; n < lines.length; n++) if (lines[n].startsWith('function ' + name + '(')) { a = n; break; }
  if (a < 0) throw new Error('no function ' + name);
  for (let n = a + 1; n < lines.length; n++) if (lines[n] === '}') return lines.slice(a, n + 1).join('\n');
  throw new Error('no end of ' + name);
}

// Real entries, verbatim shapes from the captures.
const INBOUND = (body, phone) => '[08/19/2026 2:10 PM] [CUSTOMER] Inbound Text Message\n  Received from: '
  + (phone || '(337) 247-0886') + ' Received by: Lance Garrick\n  ' + body;
const OUTBOUND = body => '[08/19/2026 2:20 PM] [AGENT] Outbound Text Message\n  Sent to: (337) 247-0886 Sent by: Kaylee Guzman\n  ' + body;
const AGENTNOTE = body => '[08/19/2026 3:00 PM] [CUSTOMER] Inbound phone call\n  By: Rotaxlyn Hudson\n  ' + body;
const SYSNOTE = body => '[08/19/2026 3:05 PM] [CUSTOMER] Lead\n  By: System\n  ' + body;

console.log('\nv9.7.561 Phase A — the full-arc read (library only, not wired)');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── Non-wiring: what makes "Phase A only" checkable ────────────────────────────
console.log('Phase A is library only — nothing is wired:');

const SYMS = /_lpWalkArc|_lpBuildRelevancyProbe|_lpVerifyRelevancy|_lpRelevancyCommitOverlap|_lpArcSpeaker|_lpArcBody|LP_RELEVANCY_KINDS/g;

check('buildUserPrompt references no Phase A symbol',
  i => (fnBody(i.src, 'buildUserPrompt').match(SYMS) || []).length, 0);
check('classifyScenario references no Phase A symbol',
  i => (fnBody(i.src, 'classifyScenario').match(SYMS) || []).length, 0);
check('nothing outside the Phase A block calls the arc walker',
  i => {
    const a = i.src.indexOf('// ── (v9.7.561) PHASE A');
    const b = i.src.indexOf('// ── (v9.7.558) COMPREHENSION PASS');
    const outside = i.src.slice(0, a) + i.src.slice(b);
    return (outside.match(/_lpWalkArc\(|_lpBuildRelevancyProbe\(|_lpVerifyRelevancy\(/g) || []).length;
  }, 0);
check('no fetch, no POST, no console.log inside the Phase A block',
  i => {
    const a = i.src.indexOf('// ── (v9.7.561) PHASE A');
    const b = i.src.indexOf('// ── (v9.7.558) COMPREHENSION PASS');
    const block = i.src.slice(a, b);
    return (block.match(/\bfetch\(|console\.log\(/g) || []).length;
  }, 0);
check('the containment check is not vacuous — the block really is there',
  i => {
    const a = i.src.indexOf('// ── (v9.7.561) PHASE A');
    const b = i.src.indexOf('// ── (v9.7.558) COMPREHENSION PASS');
    return b > a && (b - a) > 5000;
  }, true);

// ── Finding 1: speaker comes from the attribution line ─────────────────────────
console.log('\nfinding 1 — the tag does not establish the speaker:');

check('a real inbound ("Received from:") is the customer',
  i => i.api.speaker(INBOUND('Yay!! Whats the price?')), 'customer');
check('a real outbound ("Sent to:") is us',
  i => i.api.speaker(OUTBOUND('Thanks for reaching out')), 'us');
check('a [CUSTOMER]-tagged entry written "By: <agent>" is US, not the customer',
  i => i.api.speaker(AGENTNOTE('She called back and set an appointment for 8/12 at 4:30 PM.')), 'us');
check('a [CUSTOMER]-tagged entry written "By: System" is system',
  i => i.api.speaker(SYSNOTE('Lead received')), 'system');

// THE decisive real case.
const GIRLFRIEND = AGENTNOTE('wanting to get his girlfriend a new vehicle for her birthday, coming in next thursday to meet with a sales rep');
check('the real agent-written entry carrying "coming in next thursday" is attributed to US',
  i => i.api.speaker(GIRLFRIEND), 'us');

check('...and it is NOT returned when the arc is filtered to customer speech',
  i => i.api.walkArc(GIRLFRIEND, { speakers: ['customer'] }).length, 0);

check('...while it IS returned, correctly attributed, on an unfiltered walk',
  i => i.api.walkArc(GIRLFRIEND).map(x => x.speaker), ['us']);

check('the corpus split matches what the captures actually contain',
  i => {
    const ent = CUSTCORPUS.filter(x => x.src === 'entry');
    return { total: ent.length,
             customer: ent.filter(x => /^Received from:/.test(x.text)).length,
             agentWritten: ent.filter(x => /^By:/.test(x.text)).length };
  }, { total: 19, customer: 15, agentWritten: 4 });

// ── Finding 2: the contact header is stripped, the message kept ────────────────
console.log('\nfinding 2 — the contact header is a prefix, not the content:');

check('the customer phone is stripped from an inbound body',
  i => i.api.body(INBOUND('I decided not to go with it. Thank you!')),
  'I decided not to go with it. Thank you!');

check('the receiving agent name is stripped too',
  i => /Lance Garrick/.test(i.api.body(INBOUND('Yay!! Whats the price?'))), false);

check('NO arc item from any real capture carries a phone or email',
  i => [JASON, JEFFREY, COROLLA].map(c =>
    i.api.walkArc(c, { max: 200 }).filter(x => /\(\d{3}\)\s*\d{3}-\d{4}|@[\w.-]+\.\w{2,}/.test(x.body)).length),
  [0, 0, 0]);

// THIS ASSERTION CAUGHT A REAL BUG rather than a test slip. VinSolutions puts the message on the
// SAME line as the header — "Received from: <phone> Received by: <agent> <the message>" — so the
// first version of LP_ARC_MSG_HEADER_RE, which ran to end of line, swallowed all 15 real customer
// messages and returned an empty body for every one. The arc would have been able to read nothing
// the customer ever said, silently. The header is now bounded at the agent's name.
check('every real inbound in the corpus still yields a non-empty body once stripped',
  i => CUSTCORPUS.filter(x => x.src === 'entry' && /^Received from:/.test(x.text))
        .filter(x => i.api.body('[08/19/2026 2:10 PM] [CUSTOMER] Inbound Text Message\n  ' + x.text).length === 0).length,
  0);

// The stripper keeps "Ok" intact; the ARC then drops it, and those are different decisions worth
// separating. A one- or two-character body is noise for a relevancy read — nothing a reply must
// account for — but the message itself was never mangled, which is what the assertion above pins.
check('a two-character acknowledgement survives stripping but is not carried into the arc',
  i => ({
    stripped: i.api.body('[08/11/2026 9:10 AM] [CUSTOMER] Inbound Text Message\n  Received from: (713) 725-6721 Received by: Mario Sanchez Ok'),
    inArc: i.api.walkArc('[08/11/2026 9:10 AM] [CUSTOMER] Inbound Text Message\n  Received from: (713) 725-6721 Received by: Mario Sanchez Ok').length
  }), { stripped: 'Ok', inArc: 0 });

check('...and the message survives intact, not truncated at its first word',
  i => i.api.body(INBOUND('Not needed. Already purchased another vehicle', '(832) 829-7272')),
  'Not needed. Already purchased another vehicle');

check('a one-word reply survives, and the agent surname does not eat it',
  i => i.api.body('[08/11/2026 9:10 AM] [CUSTOMER] Inbound Text Message\n  Received from: (713) 725-6721 Received by: Mario Sanchez Ok'),
  'Ok');

check('a general note whose contact data IS the content is still refused whole',
  i => i.api.walkArc('[08/19/2026 3:00 PM] [NOTE] General Note\n  By: A\n  no dupes Jason Pellegrin Cell: (337) 256-3478 apelle4@gmail.com').length,
  0);

// ── The arc walk on real captures ──────────────────────────────────────────────
console.log('\nthe walk over the real captures:');

check("Jeffrey's Gubagoo chat explodes into his individual customer turns",
  i => i.api.walkArc(JEFFREY, { speakers: ['customer'] }).map(x => x.body.slice(0, 46)),
  ['My name is Jeffrey what is the mileage on the ',
   'Best',
   '281XXXXXXX',
   'I am helping my granddaughter by a pre owned s',
   'I apologize I will get back with you']);

check('...and the [CHAT BOT] turns are never surfaced as customer speech',
  i => i.api.walkArc(JEFFREY, { max: 200 })
        .filter(x => /Mia|Sales notification|Just checking if you are still there/.test(x.body)).length, 0);

check('a chat turn is tagged [CHAT] so its origin is visible',
  i => i.api.walkArc(JEFFREY, { speakers: ['customer'] })[0].tag, '[CHAT]');

check("Jason's arc walks and every item carries a speaker",
  i => {
    const a = i.api.walkArc(JASON, { max: 200 });
    return { items: a.length > 10, unspeakered: a.filter(x => !x.speaker).length };
  }, { items: true, unspeakered: 0 });

check("Jason's housekeeping general notes are all filtered out of the arc",
  i => i.api.walkArc(JASON, { max: 200 }).filter(x => /SubmitSENT NEW LEAD|no dupes/.test(x.body)).length, 0);

// THE SECOND REAL BUG THIS SUITE CAUGHT. arc[0] was Lead Pro's own "ZERO-CONTACT LEAD —
// APPOINTMENT ENGINE DISABLED" preamble, which sits above the first dated entry and so has no
// date. It would have entered the arc as though someone had said it — the self-pollution class
// of v9.7.545/552/556 arriving by a new door. Undated entries are now skipped, and arc[0] is
// Jason's real 8/19 call note (the 8/20 one above it is refused as voicemail boilerplate).
check('the arc is capped, newest-first, and starts at a real dated entry',
  i => {
    const a = i.api.walkArc(JASON, { max: 5 });
    return { n: a.length, firstDate: a[0].date, undated: a.filter(x => !x.date).length };
  }, { n: 5, firstDate: '08/19/2026 4:10 PM', undated: 0 });

check('Lead Pro\'s own preamble never enters the arc',
  i => i.api.walkArc(JASON, { max: 200 })
        .filter(x => /ZERO-CONTACT LEAD|APPOINTMENT ENGINE DISABLED|FOLLOW-UP: read the full/.test(x.body)).length,
  0);

check('an empty / null context is safe',
  i => [i.api.walkArc('').length, i.api.walkArc(null).length, i.api.walkArc(undefined).length], [0, 0, 0]);

// ── The probe ──────────────────────────────────────────────────────────────────
console.log('\nthe probe — structured and constrained:');

const ITEMS = [
  { speaker: 'customer', date: '08/19/2026', body: 'I haven’t made a car payment because I really want to trade it in if I’m able to' },
  { speaker: 'customer', date: '08/18/2026', body: 'My meeting is at 4pm so it will have to be in the morning around 9am' },
  { speaker: 'us',       date: '08/17/2026', body: 'Thanks for reaching out, I will get you a number' }
];

check('the probe numbers each line and marks who said it',
  i => {
    const p = i.api.probe(ITEMS);
    return /\[1\] \(customer, 08\/19\/2026\) I haven/.test(p) && /\[3\] \(us, 08\/17\/2026\)/.test(p);
  }, true);

check('it demands a verbatim quote and a line citation',
  i => {
    const p = i.api.probe(ITEMS);
    return /CHARACTER FOR CHARACTER/.test(p) && /MUST cite the numbered line/.test(p);
  }, true);

check('it says an empty answer is valid — the anti-invention rule',
  i => /return an empty items array\. That is a valid and common answer/.test(i.api.probe(ITEMS)), true);

check('it tells the model that something WE said is not a customer preference',
  i => /Something WE said is not the customer stating a preference/.test(i.api.probe(ITEMS)), true);

check('it constrains kind to the declared set',
  i => {
    const p = i.api.probe(ITEMS);
    return i.api.KINDS.every(k => p.indexOf(k) >= 0);
  }, true);

check('it carries no Lead Pro directive scaffold',
  i => /VEHICLE ON LEAD|CALL NOTE — READ BEFORE WRITING|SMS SIGNATURE|Do NOT offer new appointment times/
        .test(i.api.probe(ITEMS)), false);

// ── Verification — the guard the whole design rests on ─────────────────────────
console.log('\nverification — a summary claim cannot survive:');

const ok = (kind, line, quote, speaker) => ({ kind, line, quote, speaker: speaker || 'customer', why: 'x' });

check('a verbatim quote on the right line is kept',
  i => i.api.verify({ items: [ok('stated_preference', 2, 'it will have to be in the morning around 9am')] }, ITEMS).kept.length, 1);

check('a paraphrase is rejected as FABRICATED',
  i => i.api.verify({ items: [ok('stated_preference', 2, 'the customer prefers a morning appointment')] }, ITEMS).rejected[0].reason,
  'FABRICATED — quote appears in no arc item');

check('a fabricated item is counted, not merely dropped',
  i => i.api.verify({ items: [ok('objection', 1, 'she said she is not interested at all')] }, ITEMS).fabricated, 1);

check('a REAL quote on the WRONG line is a different failure from fabrication',
  i => i.api.verify({ items: [ok('constraint', 3, 'it will have to be in the morning around 9am')] }, ITEMS).rejected[0].reason,
  'quote is real but line number is wrong (actually 2)');

check('...and that one is NOT counted as fabrication',
  i => i.api.verify({ items: [ok('constraint', 3, 'it will have to be in the morning around 9am')] }, ITEMS).fabricated, 0);

check('an unknown kind is rejected',
  i => i.api.verify({ items: [ok('vibes', 1, 'I haven’t made a car payment')] }, ITEMS).rejected[0].reason, 'unknown kind');

check('the model may NOT overrule the speaker the arc derived',
  i => i.api.verify({ items: [ok('stated_preference', 3, 'I will get you a number', 'customer')] }, ITEMS).kept[0],
  { kind: 'stated_preference', line: 3, quote: 'I will get you a number',
    speaker: 'us', claimedSpeaker: 'customer', why: 'x' });

check('whitespace reflow still verifies — that is not the failure mode',
  i => i.api.verify({ items: [ok('constraint', 2, 'it  will have\nto be in the morning')] }, ITEMS).kept.length, 1);

check('an empty items array is a valid answer, not an error',
  i => i.api.verify({ items: [] }, ITEMS), { kept: [], rejected: [], fabricated: 0, claimed: 0 });

check('a malformed response does not throw',
  i => [i.api.verify(null, ITEMS).claimed, i.api.verify({}, ITEMS).claimed,
        i.api.verify({ items: 'nope' }, ITEMS).claimed, i.api.verify({ items: [null] }, ITEMS).rejected[0].reason],
  [0, 0, 0, 'not an object']);

check('mixed good and bad items are separated, not all-or-nothing',
  i => {
    const r = i.api.verify({ items: [
      ok('constraint', 2, 'in the morning around 9am'),
      ok('objection', 1, 'she told me she already bought elsewhere')
    ] }, ITEMS);
    return { kept: r.kept.length, rejected: r.rejected.length, fabricated: r.fabricated };
  }, { kept: 1, rejected: 1, fabricated: 1 });

// ── Real customer text end to end ──────────────────────────────────────────────
console.log('\nend to end on real customer messages from the captures:');

const REALARC = [
  INBOUND('I haven’t made a car payment because I really want to trade it in if I’m able to', '(713) 725-6721'),
  INBOUND('My meeting is at 4pm so it will have to be in the morning around 9am I know this can take awhile', '(713) 725-6721'),
  OUTBOUND('I can get that started for you')
].join('\n');

check('the real arc walks into three items with the right speakers',
  i => i.api.walkArc(REALARC).map(x => x.speaker), ['customer', 'customer', 'us']);

check('...carrying no phone numbers',
  i => i.api.walkArc(REALARC).filter(x => /\d{3}\) ?\d{3}-\d{4}/.test(x.body)).length, 0);

check('a verdict quoting the real trade line verifies against the walked arc',
  i => {
    const arc = i.api.walkArc(REALARC);
    return i.api.verify({ items: [ok('stated_preference', 1, 'really want to trade it in')] }, arc).kept.length;
  }, 1);

check('a plausible-sounding invention about that same arc does NOT verify',
  i => {
    const arc = i.api.walkArc(REALARC);
    return i.api.verify({ items: [ok('constraint', 2, 'the customer can only come in before noon')] }, arc).fabricated;
  }, 1);

// ── Overlap with the commit check ──────────────────────────────────────────────
console.log('\noverlap with the verbal-commit check — reported, never merged:');

check('no commit verdict means no overlap claim',
  i => i.api.overlap([{ quote: 'anything' }], ''), { overlaps: false, commitAlsoSurfaced: false, commitItems: 0 });

check('the same commitment surfaced by both is REPORTED as overlapping',
  i => i.api.overlap([{ quote: 'will try to come in on sat just to see what her car is worth' }],
                     'will try to come in on sat'),
  { overlaps: true, commitAlsoSurfaced: true, commitItems: 1 });

check('unrelated relevancy items do not register as overlap',
  i => i.api.overlap([{ quote: 'I really want to trade it in' }], 'will come in Friday').overlaps, false);

check('the relevancy verifier has no reference to the commit verdict — they are independent',
  i => {
    const a = i.src.indexOf('// ── (v9.7.561) THE RELEVANCY READ');
    const b = i.src.indexOf('// ── (v9.7.558) COMPREHENSION PASS');
    const block = i.src.slice(a, b);
    // the overlap helper takes the quote as an argument; nothing here reaches into the
    // commit machinery on its own
    return (block.match(/_lpRunCommitComprehension|window\._lpVerbalCommitVerdict|_lpCommitVerdictDelta/g) || []).length;
  }, 0);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
