#!/usr/bin/env node
'use strict';
// (v9.7.623) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('note-meta.test.js');

/**
 * note-meta.test.js — v9.7.623. THE CRM'S OWN METADATA WAS BEING READ AS THE CUSTOMER'S WORDS.
 *
 * LIVE INCIDENT: Sydnie Moon (Audi Lafayette, lead 2075798859, 9/4). Her reply body, in full:
 *
 *     "Email please. I have limited service currently but I do have WiFi"
 *
 * What every detector actually read:
 *
 *     "Subject: Re:Your CR-V appraisal and Armada numbers By: Kristen Willis Email please. I have
 *      limited service currently but I do have WiFi"
 *
 * The pivot scan found "Cr-v" in that, concluded she had switched to a Honda, and the delivered
 * draft closed out a live Armada deal over the car she was TRADING IN. v9.7.622 fixed the pivot's
 * half — a trade is not a pivot. This fixes the text the detector was reading in the first place,
 * which is the half Gil identified: "a wrong read by LP" that then "grew to the bigger problem."
 *
 * TWO PIECES OF METADATA, DELIBERATELY TREATED DIFFERENTLY:
 *   "By: <name>"         VinSolutions' ASSIGNED-AGENT field, not the author. On an INBOUND note it
 *                        names the agent the lead is assigned to — Sydnie's own reply carried
 *                        "By: Kristen Willis". Never the customer's words. Always removed.
 *   "Subject: Re:..."    An echo — the mail client bounces an existing thread subject back, so on a
 *                        reply it is usually OUR subject quoted at us. Removed.
 *   "Subject: <not Re>"  May genuinely be the customer's own words on a thread THEY started. KEPT.
 *                        Deleting real customer speech is the worse failure, and this distinction
 *                        is what makes the strip safe rather than blunt.
 *
 * INBOUND ONLY: an outbound note's subject is legitimately ours and tells the model what that email
 * was about. Stripping it would take real arc away — the opposite of the goal.
 *
 * THE FLATTENED FALLBACK STRIPS LABELS ONLY AND LEAVES THE NAME. That is the v9.7.435 lesson,
 * recorded there in full: a greedy class with no delimiter after "By: <name>" ate the real message
 * and silently disabled a detector. Leaving an agent's name in the text is a small wrong; deleting
 * the customer's message is a large one.
 *
 * Executes the SHIPPED helper and asserts the SHIPPED wiring at all three sites. Both builds must
 * agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: note-meta.test.js <popup.js> [popup.js...]'); process.exit(2); }

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const START = '    function _lpStripNoteMeta(str) {';
  const a = src.indexOf(START);
  if (a < 0) require('./lib/fatal-guard.js').bail('note-meta.test.js', '_lpStripNoteMeta not in ' + file);
  // Ends at the line before sanitize(), which is what it was inserted above.
  const b = src.indexOf('    function sanitize(str) {', a);
  const sb = { String, RegExp };
  vm.createContext(sb);
  // (v9.7.634) _lpStripNoteMeta now calls module-scope _lpIsRoutingLine, so lifting the function
  // alone leaves a ReferenceError. Lift the helper too — the harness must run what production
  // runs. Third build in a row where factoring a helper out of a lifted region broke a suite that
  // lifts it (v9.7.630 arc-bound/brief-fence, v9.7.631 distance-appt-gate, here). The suites
  // catching it every time is the system working; it is still worth checking for on any extraction.
  const ha = src.indexOf('    function _lpIsRoutingLine(line) {');
  if (ha < 0) throw new Error('_lpIsRoutingLine not in ' + file);
  vm.runInContext(src.slice(ha, a), sb);
  vm.runInContext(src.slice(a, b), sb);
  return { src, strip: vm.runInContext('_lpStripNoteMeta', sb),
           stripRouting: vm.runInContext('_lpStripRouting', sb) };
}

// Sydnie's note, in the shape VinSolutions renders it — innerText keeps the per-div line breaks.
const SYDNIE_LINES = 'Subject: Re:Your CR-V appraisal and Armada numbers\nBy: Kristen Willis\n'
                   + 'Email please. I have limited service currently but I do have WiFi';
const SYDNIE_BODY  = 'Email please. I have limited service currently but I do have WiFi';
const SYDNIE_FLAT  = 'Subject: Re:Your CR-V appraisal and Armada numbers By: Kristen Willis '
                   + 'Email please. I have limited service currently but I do have WiFi';

for (const file of BUILDS) {
  const B = load(file);
  console.log('\n' + path.relative(process.cwd(), file) + ' — the CRM\'s metadata is not the customer speaking');

  // ── THE INCIDENT ───────────────────────────────────────────────────────────
  console.log('\nSydnie, 9/4 — the note that closed out a live deal:');
  check('her reply reduces to exactly what she wrote', B.strip(SYDNIE_LINES), SYDNIE_BODY);
  check('...and "CR-V" is gone from her words entirely', /cr-v/i.test(B.strip(SYDNIE_LINES)), false);
  check('...while the agent name goes with it', /Kristen/.test(B.strip(SYDNIE_LINES)), false);
  // The whole point: the pivot scan can no longer find a vehicle in her message.
  check('no vehicle name survives in her text', /\b(cr-?v|armada|honda|nissan)\b/i.test(B.strip(SYDNIE_LINES)), false);

  console.log('\nthe same note already flattened (some shapes arrive joined):');
  const flat = B.strip(SYDNIE_FLAT);
  check('the echoed subject is still removed', /cr-v/i.test(flat), false);
  check('...and her actual message survives whole', flat.indexOf(SYDNIE_BODY) >= 0, true);
  // v9.7.435, recorded: a greedy strip with no delimiter after the name ate the message and
  // silently disabled a detector. The name staying is the deliberate, smaller wrong.
  check('the LABELS go, the name stays — the v9.7.435 trade-off', flat, 'Kristen Willis ' + SYDNIE_BODY);

  // ── WHAT MUST SURVIVE ──────────────────────────────────────────────────────
  // The guard against over-reach. A subject with no "Re:" may be the customer's own words on a
  // thread they started, and deleting real customer speech is the worse failure of the two.
  console.log('\nreal customer words are never deleted:');
  check('a subject the customer wrote (no "Re:") is KEPT',
    B.strip('Subject: Question about the Armada\nBy: Kristen Willis\nIs it still available?'),
    'Subject: Question about the Armada\nIs it still available?');
  check('a plain body is untouched', B.strip(SYDNIE_BODY), SYDNIE_BODY);
  check('a body naming a car is never eaten',
    B.strip('Subject: Re:Your appraisal\nBy: Kristen Willis\nActually I want to look at a CR-V instead'),
    'Actually I want to look at a CR-V instead');
  check('empty input returns empty, not a throw', B.strip(''), '');
  check('null input returns empty, not a throw', B.strip(null), '');
  check('a body whose 4th+ line says "By:" is out of the leading block and kept',
    B.strip('one\ntwo\nthree\nBy: the way I want the Armada').indexOf('By: the way') >= 0, true);

  // ── THE WIRING ─────────────────────────────────────────────────────────────
  // The helper is worthless unless it sits at the sites that actually produce customer text.
  // lastInboundMsg has ONE populator and 104 readers — that asymmetry is why the pollution
  // reached so many detectors from a single bad assignment.
  console.log('\nit is applied where customer text is produced:');
  check('lastInboundMsg is stripped before sanitize',
    /lastInboundMsg = sanitize\(_lpStripNoteMeta\(iiContent\)\)/.test(B.src), true);
  check('...including the burst-message prepend',
    /sanitize\(_lpStripNoteMeta\(nextContent\)\)/.test(B.src), true);
  // (v9.7.634) Outbound is no longer left untouched — it now goes through _lpStripRouting, which
  // removes the CRM's "Sent to: <phone> / Sent by: <agent>" header while KEEPING the subject.
  // v9.7.623's decision is unchanged and is what these two now assert: inbound loses its subject,
  // outbound keeps it. The wiring expression moved; the rule did not.
  check('the transcript entry is stripped for INBOUND notes',
    /var _annotatedContent = \(dir === 'inbound'\) \? _lpStripNoteMeta\(content\) : _lpStripRouting\(content\);/.test(B.src), true);
  // Asserted on BEHAVIOUR rather than on the expression, so a future rewiring that preserves the
  // rule still passes and one that breaks it cannot.
  const _subj = 'Sent to: (346) 579-4102\nSent by: Elsa McHaney\nSubject: Re:Your Pilot inquiry\nHi there';
  check('...and outbound keeps its subject — our own subject is real arc',
    /Subject: Re:Your Pilot inquiry/.test(B.stripRouting ? B.stripRouting(_subj) : ''), true);
  check('...while inbound still loses it', /Subject:/.test(B.strip(_subj)), false);
  check('...and outbound loses the routing header either way',
    /579-4102/.test(B.stripRouting ? B.stripRouting(_subj) : 'x'), false);
  check('no raw sanitize(iiContent) assignment remains',
    /lastInboundMsg = sanitize\(iiContent\)/.test(B.src), false);

  // Scope discipline: this lives INSIDE inlineScraper, so its diagnostic must use _lpD. A
  // console.log there prints to the PAGE console and has silently hidden four diagnostics before.
  console.log('\nscope discipline — inside inlineScraper:');
  check('the metadata diagnostic uses _lpD, not console.log',
    /_lpD\('\[LP NOTE META DIAG\]/.test(B.src), true);
  check('...and no console.log carries that tag',
    /console\.log\('\[LP NOTE META DIAG\]/.test(B.src), false);
}

// ── dev === comm ─────────────────────────────────────────────────────────────
if (BUILDS.length > 1) {
  console.log('\nboth builds ship the same helper:');
  const cut = f => {
    const s = fs.readFileSync(f, 'utf8');
    const i = s.indexOf('    function _lpStripNoteMeta(str) {');
    return s.slice(i, s.indexOf('    function sanitize(str) {', i));
  };
  check('dev and commercial strip identically', cut(BUILDS[0]) === cut(BUILDS[1]), true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
