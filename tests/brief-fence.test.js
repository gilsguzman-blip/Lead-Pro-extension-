#!/usr/bin/env node
'use strict';
// (v9.7.629) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('brief-fence.test.js');

/**
 * brief-fence.test.js — v9.7.629. EVERY PATH EMITS ONE BOUNDED TRANSCRIPT REGION.
 *
 * v9.7.552 named this in its own header and deferred it: "the fences are still not emitted on
 * first-touch and Gubagoo leads at all. Reconciling the brief builder so every path emits one
 * bounded transcript region is the correct end state and would retire the fallback entirely."
 *
 * MEASURED ON log173 — six grabs, 9/4, five rooftops, on v9.7.628:
 *   [LP ARC-BOUND DIAG]    3 of 5 rows  "no CONVERSATION TRANSCRIPT marker in the context at all"
 *   [LP SOLD SCAN DIAG]    4 of 6 rows  "full-context, scaffold stripped (fences not found)"
 *   [LP PIVOT SCOPE DIAG]  4 of 6 rows  "transcriptFences:NOT found"
 *
 * And not one of those leads is a real first touch. The fresh-today rule demoted all four —
 * "was about to be active-follow-up on 14 notes", and 12, and 13, and 6. That rule is right about
 * TONE. It was never supposed to decide whether the customer's thread reaches the prompt, and one
 * flag was answering both questions.
 *
 * THE INVARIANT THIS SUITE PINS: after the brief builder, either conversationBrief carries a
 * bounded CONVERSATION TRANSCRIPT region, or there was no transcript body to bound. Never a
 * thread that exists and is not fenced.
 *
 * AND THE TWO WAYS A FIX LIKE THIS GOES WRONG, both asserted by name:
 *  - IT LEAKS. Hoisting the region must not drag the DIRECTIVES out of the gate with it. Same
 *    discipline as v9.7.618: the raw record moves, stateLabel / entry count / keySignal /
 *    commitments / concerns stay put. Checked by source position, because position is what broke.
 *  - IT DUPLICATES. recentHistory already contains the [GUBAGOO CHAT] lines, so a chat lead would
 *    print its own conversation twice — the v9.7.544 duplicate-entry problem.
 *
 * Executes the SHIPPED builder, the SHIPPED Gubagoo branch, the SHIPPED invariant block, and the
 * SHIPPED arc-bound extractor the fix exists to feed. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: brief-fence.test.js <popup.js> [popup.js...]'); process.exit(2); }

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

const MARKER = 'CONVERSATION TRANSCRIPT (newest first — read the full thread before responding):';
const bail = (m) => require('./lib/fatal-guard.js').bail('brief-fence.test.js', m);

// A slice that matched nothing is the failure mode that cost four wrong results this week
// (v9.7.597). Every cut below goes through this.
function cut(src, file, what, openMark, closeMark, tailLen) {
  const a = src.indexOf(openMark);
  if (a < 0) bail(what + ': open marker not in ' + file);
  const b = src.indexOf(closeMark, a);
  if (b < 0) bail(what + ': close marker not found after the open in ' + file);
  const s = src.slice(a, b + (tailLen === undefined ? closeMark.length : tailLen));
  if (!s.trim()) bail(what + ': slice is empty in ' + file);
  return s;
}

function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const logs = [];
  const sb = { String, Array, Date, JSON, console: { log: m => logs.push(String(m)) }, _lpD: m => logs.push(String(m)) };
  vm.createContext(sb);

  // (1) the shipped fenced-region builder
  const fenceSrc = cut(src, file, '_lpFencedTranscript',
    '    function _lpFencedTranscript(body){', "+ body + '\\n---\\n';\n    }");
  if (fenceSrc.indexOf(MARKER) < 0) bail('_lpFencedTranscript slice does not contain the marker in ' + file);
  vm.runInContext(fenceSrc, sb);

  // (2) the shipped Gubagoo branch, wrapped so it can be handed a transcript + recentHistory
  const gubSrc = cut(src, file, 'gubagoo branch',
    '    var gubogooChatEntry = transcript.filter(',
    "keeping the verbatim block (would otherwise be lost)'));\n    }");
  if (gubSrc.indexOf('_gubInFence') < 0) bail('gubagoo slice missing the new guard in ' + file);
  vm.runInContext(
    'function _gub(transcript, recentHistory){ var conversationBrief = "";\n' + gubSrc + '\n return conversationBrief; }', sb);

  // (3) the shipped invariant block
  const invSrc = cut(src, file, 'invariant block',
    '    try {\n      var _cbHasFence =', '} catch (eFence) {');
  if (invSrc.indexOf('_lpFencedTranscript(recentHistory)') < 0) bail('invariant slice does not call the builder in ' + file);
  vm.runInContext(
    'function _invariant(conversationBrief, recentHistory, convState, totalNoteCount){\n'
    + invSrc + ' }\n return conversationBrief; }', sb);

  // (4) the SHIPPED arc-bound extractor — the consumer this whole build exists to feed.
  // (v9.7.630) It now calls module-scope _lpBoundedTranscript, so that has to be in scope here
  // too. Without it the block throws and its own `catch (eTs)` turns the throw into the
  // full-context fallback — a silent wrong answer rather than a loud one.
  const bt0 = src.indexOf('function _lpBoundedTranscript(ctx) {');
  const bt1 = src.indexOf('\n}', bt0);
  if (bt0 < 0 || bt1 < 0) bail('_lpBoundedTranscript not in ' + file);
  vm.runInContext(src.slice(bt0, bt1 + 2), sb);
  const arcSrc = cut(src, file, 'arc-bound extractor',
    "    var _ctxRaw = data.context || '';", '} catch (eTs) { ctx_full = _ctxRaw; }');
  if (arcSrc.indexOf('ARC-BOUND DIAG') < 0) bail('arc slice missing the diagnostic in ' + file);
  vm.runInContext('function _arcBound(ctx){ var data = { context: ctx };\n' + arcSrc + '\n return ctx_full; }', sb);

  return {
    src, logs,
    fence: vm.runInContext('_lpFencedTranscript', sb),
    gub: vm.runInContext('_gub', sb),
    invariant: vm.runInContext('_invariant', sb),
    arcBound: vm.runInContext('_arcBound', sb),
  };
}

// A thread of the shape the four demoted leads carry: real entries, and a convState of first-touch.
const THREAD = [
  '[09/04/2026 8:12 AM] [CUSTOMER] Email reply from prospect',
  '  Is the EV6 still available and what is the out the door price?',
  '[09/04/2026 7:40 AM] [AGENT] Outbound text',
  '  Good morning! Following up on your inquiry.',
  '[09/04/2026 7:31 AM] [NOTE] Lead received',
].join('\n');

const GUB = [
  '[09/04/2026 8:12 AM] [GUBAGOO CHAT] Customer: do you still have the Sportage',
  '[09/04/2026 8:13 AM] [GUBAGOO CHAT] Bot: yes, would you like to schedule',
];

for (const file of BUILDS) {
  const B = load(file);
  console.log('\n' + path.relative(process.cwd(), file) + ' — one bounded transcript, on every path');

  // ── THE REGION ITSELF IS UNCHANGED ─────────────────────────────────────────
  // Four consumers search for these exact characters. Moving the emission must not move a byte
  // of what is emitted.
  console.log('\nthe region is byte-identical to the one v9.7.628 emitted:');
  check('the marker text is unchanged', B.fence('X').indexOf(MARKER), 0);
  check('the whole region is unchanged', B.fence('BODY'), MARKER + '\n---\nBODY\n---\n');
  check('...including the opening fence the arc splitter seeks', B.fence('B').indexOf('\n---\n') > -1, true);
  check('...and the closing \\n--- it bounds on', /\n---\n$/.test(B.fence('B')), true);
  // An empty body must still produce fences here. "Fences present, body empty" and "no fences"
  // are DIFFERENT failures and v9.7.589 lost three investigation passes to conflating them.
  check('an empty body still yields fences — v9.7.589 keeps its two distinct states',
    B.fence(''), MARKER + '\n---\n\n---\n');

  // ── THE INVARIANT ──────────────────────────────────────────────────────────
  console.log('\nthe four demoted leads now carry their thread:');
  B.logs.length = 0;
  const ft = B.invariant("CUSTOMER'S INQUIRY — ...\n\"is it still available\"", THREAD, 'first-touch', 14);
  check('a first-touch brief now carries the marker', ft.indexOf('CONVERSATION TRANSCRIPT (') > -1, true);
  check('...bounded, not pasted loose', ft.indexOf(MARKER + '\n---\n') > -1, true);
  check('...and the thread is inside it', ft.indexOf('out the door price') > -1, true);
  check('what was already in the brief is kept', ft.indexOf("CUSTOMER'S INQUIRY") > -1, true);
  check('...and still comes first — the thread goes last, as on the gated path',
    ft.indexOf("CUSTOMER'S INQUIRY") < ft.indexOf('CONVERSATION TRANSCRIPT ('), true);
  check('it says so in the log', /BRIEF FENCE DIAG.*region ADDED/.test(B.logs.join('|')), true);
  check('...naming the convState it fired on', /convState:first-touch/.test(B.logs.join('|')), true);

  // ── IT IS A NO-OP WHERE THE REGION ALREADY EXISTS ──────────────────────────
  // Non-first-touch prompts must not change by one character in this build.
  console.log('\nnothing changes on a lead that already had a region:');
  const gated = 'ACTIVE FOLLOW-UP\nTotal CRM entries: 175\n' + B.fence(THREAD);
  B.logs.length = 0;
  check('the brief is returned untouched', B.invariant(gated, THREAD, 'active-follow-up', 175), gated);
  check('the region appears exactly once',
    (B.invariant(gated, THREAD, 'active-follow-up', 175).match(/CONVERSATION TRANSCRIPT \(/g) || []).length, 1);
  check('...and the log says why it did nothing',
    /already emitted by the convState branch/.test(B.logs.join('|')), true);

  // ── EMPTY FENCES ARE NEVER MANUFACTURED ────────────────────────────────────
  console.log('\na lead with no thread keeps its honest "no marker" state:');
  B.logs.length = 0;
  // (v9.7.633) The note count is now part of the shape. A lead with NOTES but no thread is a
  // finding and stays audible; a frame with NEITHER scraped nothing and is silent. This case
  // carries notes:6 so it exercises the finding, not the noise — before v9.7.633 it passed
  // notes:0, which is now (correctly) the silent shape.
  const none = B.invariant('AGENT CONTEXT — READ THIS FIRST. ...', '', 'first-touch', 6);
  check('no fences invented', none.indexOf('CONVERSATION TRANSCRIPT (') , -1);
  check('the brief is otherwise untouched', none, 'AGENT CONTEXT — READ THIS FIRST. ...');
  check('whitespace is not a transcript', B.invariant('x', '   \n  \n', 'first-touch', 6), 'x');
  check('...and the log says which of the two it is',
    /NO TRANSCRIPT BODY to bound/.test(B.logs.join('|')), true);
  // ...and the frame that never held a lead says nothing at all — see diag-honesty.
  B.logs.length = 0;
  check('a frame that scraped nothing is silent (v9.7.633)',
    B.invariant('', '', 'first-touch', 0) === '' && B.logs.length === 0, true);
  check('an empty brief with a thread still gets one, with no leading blank lines',
    B.invariant('', THREAD, 'first-touch', 5).indexOf(MARKER), 0);

  // ── THE CHAT LEAD IS NOT PRINTED TWICE ─────────────────────────────────────
  console.log('\nthe Gubagoo chat is carried once, not twice:');
  const chatHistory = GUB.join('\n') + '\n[09/04/2026 7:00 AM] [NOTE] Lead received';
  B.logs.length = 0;
  const gubBrief = B.gub(GUB.slice(), chatHistory);
  const gubFull = B.invariant(gubBrief, chatHistory, 'first-touch', 8);
  check('the chat turn appears exactly once in the whole brief',
    (gubFull.match(/do you still have the Sportage/g) || []).length, 1);
  check('...and it is the fenced copy that survived',
    gubFull.indexOf('do you still have the Sportage') > gubFull.indexOf(MARKER), true);
  check('the model is still told a bot chat happened', /already spoke with the chat bot/.test(gubFull), true);
  check('...and told where to read it', /tagged \[GUBAGOO CHAT\]/.test(gubFull), true);
  check('the swap is logged', /CHAT BRIEF DIAG.*allInFencedTranscript:true/.test(B.logs.join('|')), true);

  // The fail-safe half. If the transcript does NOT carry the chat — a cutoff dropped it, an entry
  // was reshaped — printing it twice is strictly better than losing it.
  console.log('\n...and when the transcript does NOT carry it, the verbatim block stays:');
  B.logs.length = 0;
  const orphan = B.gub(GUB.slice(), '[09/04/2026 7:00 AM] [NOTE] Lead received');
  check('the chat body is kept verbatim', orphan.indexOf('do you still have the Sportage') > -1, true);
  check('...in the original unfenced block, exactly as v9.7.628 wrote it',
    orphan.indexOf('CHAT TRANSCRIPT (customer already spoke with the chat bot - read this before writing):'), 0);
  check('...and the log flags that it would otherwise be lost',
    /allInFencedTranscript:false/.test(B.logs.join('|')), true);
  check('one missing line is enough to fail safe',
    B.gub(GUB.slice(), GUB[0]).indexOf('CHAT TRANSCRIPT (customer already'), 0);

  // ── IT ACTUALLY REACHES THE CONSUMER ───────────────────────────────────────
  // The point of the build. Run the SHIPPED arc-bound extractor over a first-touch brief and
  // require the outcome log173 could not produce.
  console.log('\nthe shipped arc-bound extractor now binds on a first-touch lead:');
  B.logs.length = 0;
  const bound = B.arcBound(ft);
  check('the arc is bounded to the transcript', bound !== ft, true);
  check('...and contains the customer message', bound.indexOf('out the door price') > -1, true);
  check('...and NOT the inquiry scaffold above it', bound.indexOf("CUSTOMER'S INQUIRY"), -1);
  check('it reports success, not the log173 fallback',
    /ARC-BOUND DIAG.*arc built from the transcript fences/.test(B.logs.join('|')), true);
  check('the log173 line is gone', /no CONVERSATION TRANSCRIPT marker in the context at all/.test(B.logs.join('|')), false);
  // Before the fix, the same lead's brief had no region — prove the extractor really would have
  // fallen back, so the assertion above is attributable to this build and not to the fixture.
  B.logs.length = 0;
  const preFix = "CUSTOMER'S INQUIRY — ...\n\"is it still available\"";
  check('the SAME brief without the region falls back, as it did on 9/4', B.arcBound(preFix), preFix);
  check('...with the exact line log173 printed three times',
    /no CONVERSATION TRANSCRIPT marker in the context at all/.test(B.logs.join('|')), true);

  // ── NO DIRECTIVE LEAKED OUT OF THE GATE ────────────────────────────────────
  // v9.7.618's lesson, restated as source position because position is what broke. The raw record
  // moves out of the gate; every conclusion drawn from it stays inside.
  console.log('\nonly the raw record was hoisted — every directive stayed behind the gate:');
  const iGate = B.src.indexOf("if(convState !== 'first-touch'){");
  const iInv  = B.src.indexOf('      var _cbHasFence =');
  check('both anchors exist', iGate > -1 && iInv > iGate, true);
  const gatedRegion = B.src.slice(iGate, iInv);
  for (const [what, needle] of [
    ['stateLabel',      'conversationBrief = stateLabel'],
    ['the CRM count',   "'Total CRM entries: ' + totalNoteCount"],
    ['keySignal',       "+ keySignal + '\\n'"],
    ['the commitments', "+ commitmentBlock + '\\n'"],
    ['the concerns',    "+ concernBlock + '\\n'"],
  ]) check('  ' + what + ' is still inside the gate', gatedRegion.indexOf(needle) > -1, true);
  // ...and the invariant block is NOT. Indentation is the structural fact: the gated body sits at
  // six spaces, this block at four — the same depth as `var conversationBrief = ''`.
  const invLine = B.src.slice(B.src.lastIndexOf('\n', B.src.indexOf('    try {\n      var _cbHasFence')) + 1);
  check('the invariant block sits at the brief-builder depth, outside the gate',
    /^ {4}try \{/.test(invLine), true);
  check('...and it is not indented to the gated depth', /^ {6}try \{/.test(invLine), false);
  check('the gated branch still emits its own region', gatedRegion.indexOf('_lpFencedTranscript(recentHistory)') > -1, true);

  // ── ONE DEFINITION ─────────────────────────────────────────────────────────
  // Two hand-maintained copies of a marker four consumers depend on is a drift generator — the
  // v9.7.589 lesson, where three byte-identical filters carried the same bug three times.
  console.log('\nthe marker has exactly one definition in executable code:');
  const codeLines = B.src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l));
  check('one emitting site', codeLines.filter(l => l.indexOf(MARKER) > -1).length, 1);
  check('...and it is the builder', /function _lpFencedTranscript/.test(B.src), true);
  check('both call sites go through it',
    (B.src.match(/_lpFencedTranscript\(recentHistory\)/g) || []).length, 2);

  // ── FAILS OPEN ─────────────────────────────────────────────────────────────
  console.log('\nit fails open — a missing region is never a reason a grab fails:');
  check('the invariant block is wrapped in try/catch',
    /catch \(eFence\) \{ \/\* the brief must ship even if the region cannot be added \*\/ \}/.test(B.src), true);
  // String()-wrapped on purpose: the assertion is about the SHIPPED code not throwing on a null
  // brief. Reading .indexOf off the return directly made the TEST throw instead — found by the
  // neuter run, which is exactly the kind of self-inflicted failure a neuter is for.
  check('a null brief does not throw', String(B.invariant(null, THREAD, 'first-touch', 3) || '').indexOf(MARKER) > -1, true);
  check('a null transcript does not throw', B.invariant('x', null, 'first-touch', 0), 'x');
  // Inside inlineScraper a console.log prints to the PAGE console and has hidden four diagnostics.
  check('the new diagnostics use _lpD', /_lpD\('\[LP BRIEF FENCE DIAG\]/.test(B.src), true);
  check('...and never console.log', /console\.log\('\[LP BRIEF FENCE DIAG\]/.test(B.src), false);
  check('the chat diagnostic too', /_lpD\('\[LP CHAT BRIEF DIAG\]/.test(B.src), true);
}

if (BUILDS.length > 1) {
  console.log('\nboth builds build the brief identically:');
  const region = f => {
    const s = fs.readFileSync(f, 'utf8');
    const a = s.indexOf('    function _lpFencedTranscript(body){');
    const b = s.indexOf('} catch (eFence) {', a);
    if (a < 0 || b < 0) bail('parity region not found in ' + f);
    return s.slice(a, b);
  };
  check('dev and commercial are identical', region(BUILDS[0]) === region(BUILDS[1]), true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
