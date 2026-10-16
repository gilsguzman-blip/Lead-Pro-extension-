#!/usr/bin/env node
'use strict';
// (v9.7.632) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('arc-dedupe.test.js');

/**
 * arc-dedupe.test.js — v9.7.632. THE SAME CONVERSATION WAS IN THE PROMPT THREE TIMES.
 *
 * MEASURED on Gil's 9/5 capture (Isaac, 2026 Honda Ridgeline Sport, Community Honda Baytown):
 *
 *   spine (CONVERSATION ARC)      4,796 chars
 *   fenced transcript             5,096
 *   digest exchange lines         3,518   <- what this build drops
 *   ------------------------------------
 *   the same conversation        13,410   = 18% of a 73,054-char prompt
 *
 * Every customer utterance appeared THREE times and the model had to work out they were one
 * thread. That is Gil's own complaint pointing the other way: not "the model is not getting the
 * whole arc" but "it is getting it three times."
 *
 * AND IT IS PARTLY SELF-INFLICTED. v9.7.627 hoisted the conversation above the directives,
 * v9.7.630 let the digest reach more leads, and neither build checked what the digest already
 * renders.
 *
 * WHY THE COPY CAN GO NOW AND COULD NOT BEFORE. Its one unique value was defensive: the exchange
 * lines are scaffold-stripped and low-info-filtered, which mattered when the digest read an
 * UNBOUNDED context full of Lead Pro's own directives. v9.7.629 made every path emit one bounded
 * transcript region, so that protection is redundant — the fenced region holds dated CRM entries
 * and nothing else, by construction.
 *
 * THE CONDITION IS A PROOF, NOT AN ASSUMPTION. `ctx_full !== _ctxRaw` is exactly "these entries
 * were parsed OUT OF the fenced transcript". When it holds, every exchange line is a re-rendering
 * of text already in the prompt verbatim. When it does not, the entries came from the whole
 * context — which can include AGENT CONTEXT notes the fence does not carry — and the lines are
 * kept exactly as v9.7.631 wrote them.
 *
 * VERIFIED LOSSLESS AGAINST THE REAL CAPTURE, separately from this suite: all 23 of Isaac's
 * digest exchange lines were found inside his fenced transcript, 23 of 23.
 *
 * Executes the SHIPPED digest builder. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: arc-dedupe.test.js <popup.js> [popup.js...]'); process.exit(2); }

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const bail = (m) => require('./lib/fatal-guard.js').bail('arc-dedupe.test.js', m);

function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf("    var _audiAllAvail = (String(data.dealerId) === '21135');");
  if (a < 0) bail('digest builder not in ' + file);
  // Slice to the END of the v9.7.630 else-block, not to the assignment inside it. Cutting at the
  // assignment leaves that `else {` unclosed and the suite reports "Unexpected end of input" —
  // a load failure where it should report assertions. Anchored on the closing braces.
  const endMark = "no friction or fatigue');\n    }\n    }";
  const b = src.indexOf(endMark, a);
  if (b < 0) bail('digest end not in ' + file);
  const block = src.slice(a, b + endMark.length);
  if (block.indexOf('_dgDedupe') < 0) bail('digest carries no de-duplication in ' + file);

  const logs = [];
  const sb = { String, console: { log: (...x) => logs.push(x.map(String).join(' ')) } };
  vm.createContext(sb);
  // Every input the block reads, supplied explicitly so each run says what it was given.
  vm.runInContext(
    'function _digest(o){\n'
    + '  var data = o.data || {}, conversationAnalysis = "";\n'
    + '  var ctx_full = o.ctxFull, _ctxRaw = o.ctxRaw;\n'
    + '  var exchangeLines = o.exchangeLines || [], recentCust = o.recentCust || "";\n'
    + '  var custQuestionsStr = o.custQuestionsStr || "";\n'
    + '  var custCount = o.custCount || 0, agentCount = o.agentCount || 0;\n'
    + '  var _arcNewlyAdmitted = !!o.newlyAdmitted, _arcExchangeCt = o.arcExchangeCt || 0;\n'
    + '  var renderRelationshipReading = function(){ return o.relReading || ""; };\n'
    + block + '\n  return conversationAnalysis; }', sb);

  return { src, logs, digest: vm.runInContext('_digest', sb) };
}

// Isaac's shape: entries parsed out of the fenced transcript (ctx_full is the bounded body).
const EX = [
  'AGENT: "By: Tania Gonzalez Left message"',
  'AGENT: "Sent to: (832) 724-6322 Sent by: Tania Gonzalez Isaac, I am Tania Gonzalez with Community Honda Baytown."',
  'CUSTOMER: "Received from: (832) 724-6322 Received by: Tania Gonzalez STOP"',
];
const BOUND = { ctxFull: '[06/24] [CUSTOMER] STOP', ctxRaw: 'HEADER SCAFFOLD\n[06/24] [CUSTOMER] STOP' };
const UNBOUND = { ctxFull: 'WHOLE CONTEXT', ctxRaw: 'WHOLE CONTEXT' };

for (const file of BUILDS) {
  const B = load(file);
  console.log('\n' + path.relative(process.cwd(), file) + ' — the conversation is carried once');

  // ── THE COPY IS DROPPED WHEN IT IS PROVABLY A DUPLICATE ────────────────────
  console.log('\nentries parsed from the fenced transcript — the copy goes:');
  B.logs.length = 0;
  const dedup = B.digest(Object.assign({ exchangeLines: EX, custCount: 1, agentCount: 2 }, BOUND));
  check('the exchange lines are gone', /Received by: Tania Gonzalez STOP/.test(dedup), false);
  check('...all of them', EX.every(l => dedup.indexOf(l) === -1), true);
  check('the drop is logged with a count',
    /ARC DEDUPE DIAG\] digest exchange lines DROPPED — 3 line\(s\)/.test(B.logs.join('|')), true);
  check('...and says where the conversation actually is',
    /already in this prompt inside the CONVERSATION TRANSCRIPT fences/.test(B.logs.join('|')), true);

  console.log('\n...and the block stops claiming to contain them:');
  check('the heading no longer collides with the spine',
    /CONVERSATION ARC — READ THIS BEFORE WRITING/.test(dedup), false);
  check('...it describes what the block now is',
    /BEFORE YOU WRITE — HOW TO READ WHAT IS ABOVE/.test(dedup), true);
  check('...and points the model at both renderings that remain',
    /CONVERSATION ARC spine in chronological order, and the CONVERSATION TRANSCRIPT for exact wording/.test(dedup), true);
  check('...saying plainly it is not repeated here', /it is not repeated here/.test(dedup), true);
  check('the notes preamble points ABOVE, not below', /The arc above includes internal agent notes/.test(dedup), true);
  check('...and never below', /The arc below includes internal agent notes/.test(dedup), false);

  // ── EVERYTHING THAT EARNS ITS PLACE STAYS ──────────────────────────────────
  console.log('\neverything that is not a duplicate stays:');
  check('the internal-agent-notes warning', /READ INTERNAL AGENT NOTES CAREFULLY/.test(dedup), true);
  check('the vehicle-not-cleanly-available signal', /VEHICLE NO LONGER CLEANLY AVAILABLE/.test(dedup), true);
  check('the another-agent-working-it signal', /ANOTHER AGENT IS ACTIVELY WORKING THE DEAL/.test(dedup), true);
  check('the internal-commitment signal', /INTERNAL COMMITMENT MADE TO THE CUSTOMER/.test(dedup), true);
  check('all eight response rules', /RULES FOR THIS RESPONSE:/.test(dedup)
    && /8\. HONOR THE CUSTOMER'S STATED POSITION/.test(dedup), true);
  check('the signing rule', /Sign ONLY as the BD Agent/.test(dedup), true);
  const withQ = B.digest(Object.assign({ exchangeLines: EX, custQuestionsStr: 'is it still available?' }, BOUND));
  check('the open-question callout survives — it is derived, not a copy',
    /OPEN QUESTION FROM CUSTOMER \(not yet answered/.test(withQ), true);
  check('...carrying the question itself', /is it still available\?/.test(withQ), true);

  // ── FAILS SAFE WHEN THE DUPLICATE CANNOT BE PROVED ─────────────────────────
  console.log('\nnot bounded to the transcript — the lines are kept, exactly as before:');
  B.logs.length = 0;
  const kept = B.digest(Object.assign({ exchangeLines: EX, custCount: 1, agentCount: 2 }, UNBOUND));
  check('the exchange lines are still there', EX.every(l => kept.indexOf(l) > -1), true);
  check('...and the old heading is unchanged',
    /CONVERSATION ARC — READ THIS BEFORE WRITING/.test(kept), true);
  check('...and the old preamble wording is unchanged',
    /The arc below includes internal agent notes/.test(kept), true);
  check('the decision is logged either way',
    /ARC DEDUPE DIAG\] digest exchange lines KEPT/.test(B.logs.join('|')), true);
  check('...naming why', /not provably duplicated elsewhere in the prompt/.test(B.logs.join('|')), true);

  // ── THE NO-REPLY WORDING FOLLOWS ITS REFERENT ──────────────────────────────
  console.log('\n"the messages above" follows what is actually above:');
  const nrDedup = B.digest(Object.assign({ exchangeLines: EX, custCount: 0, agentCount: 3 }, BOUND));
  check('deduped: it points at the transcript and arc',
    /already sent the outbound messages shown in the transcript and arc above/.test(nrDedup), true);
  const nrKept = B.digest(Object.assign({ exchangeLines: EX, custCount: 0, agentCount: 3 }, UNBOUND));
  check('kept: the original wording is untouched',
    /already sent the messages above\. Customer has not responded\./.test(nrKept), true);
  check('the v9.7.630 suppression still holds on a newly-admitted lead',
    /NO CUSTOMER REPLY YET/.test(B.digest(Object.assign(
      { exchangeLines: EX, custCount: 0, agentCount: 3, newlyAdmitted: true }, BOUND))), false);

  // ── EDGES ──────────────────────────────────────────────────────────────────
  console.log('\nedges:');
  check('no exchange lines and a bounded arc — the recentCust fallback still fires',
    /^CUSTOMER: "they asked about the Ridgeline"/m.test(
      B.digest(Object.assign({ exchangeLines: [], recentCust: 'they asked about the Ridgeline' }, BOUND))), true);
  // ANCHORED AT LINE START. An unanchored /CUSTOMER: "/ matched the preamble's OWN text — the
  // bullet 'INTERNAL COMMITMENT MADE TO THE CUSTOMER: "promised callback at 3pm"' — so the
  // assertion was testing our directive prose, not a conversation line. Third time this week a
  // pattern loose enough to match prose was read as measuring content (v9.7.563, v9.7.631).
  check('no exchange lines and nothing to fall back on — no conversation text at all',
    /^(?:CUSTOMER|AGENT|CALL NOTE): "/m.test(B.digest(Object.assign({ exchangeLines: [] }, BOUND))), false);
  check('...but the rules still ship', /RULES FOR THIS RESPONSE:/.test(
    B.digest(Object.assign({ exchangeLines: [] }, BOUND))), true);
  check('the v9.7.630 digest suppression is untouched',
    B.digest(Object.assign({ exchangeLines: [], newlyAdmitted: true, arcExchangeCt: 2 }, BOUND)), '');
  check('the relationship reading still appends when it fires',
    /FATIGUE/.test(B.digest(Object.assign({ exchangeLines: EX, relReading: 'FATIGUE' }, BOUND))), true);

  // ── SOURCE DISCIPLINE ──────────────────────────────────────────────────────
  console.log('\nthe condition is the one the arc-bound diagnostic already reports:');
  check('it is ctx_full !== _ctxRaw, not a new derivation',
    /var _dgFromFence = \(ctx_full !== _ctxRaw\);/.test(B.src), true);
  check('...and the dedupe requires lines to actually exist',
    /var _dgDedupe = _dgFromFence && exchangeLines\.length > 0;/.test(B.src), true);
  check('computed before the array, so the heading can describe the contents',
    B.src.indexOf('var _dgDedupe =') < B.src.indexOf('var digestLines = ['), true);
  check('the diagnostic never uses console.log inside inlineScraper scope — it is module scope here',
    /console\.log\('\[LP ARC DEDUPE DIAG\]/.test(B.src), true);
  check('the drop is wrapped so a diagnostic cannot fail a generation',
    /catch \(eDd\) \{\}/.test(B.src), true);
}

if (BUILDS.length > 1) {
  console.log('\nboth builds de-duplicate identically:');
  const region = (f) => {
    const s = fs.readFileSync(f, 'utf8');
    const a = s.indexOf("    var _audiAllAvail = (String(data.dealerId) === '21135');");
    const b = s.indexOf("no friction or fatigue');\n    }\n    }", a);
    if (a < 0 || b < 0) bail('parity region not found in ' + f);
    return s.slice(a, b);
  };
  check('dev and commercial are identical', region(BUILDS[0]) === region(BUILDS[1]), true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
