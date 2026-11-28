#!/usr/bin/env node
'use strict';
// (v9.7.630) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('arc-admit.test.js');

/**
 * arc-admit.test.js — v9.7.630. THE ARC DIGEST IS ADMITTED ON EVIDENCE, NOT ON A LABEL.
 *
 * v9.7.629 gave every lead a bounded CONVERSATION TRANSCRIPT region. This build lets the digest
 * that reads it actually run.
 *
 * MEASURED ON log173, per GRAB rather than per diagnostic row — six grabs, five entered the arc
 * block, ONE was refused outright:
 *
 *   Bobby Terrazas · Toyota Baytown · 2018 Ford Expedition · convState first-touch
 *   6 CRM notes · hasRealOutbound:true · [LP VARIANT-MISMATCH DIAG] ctxLen:346
 *
 * 346 characters of context, on a lead the agent had already written to that morning. No
 * ARC-BOUND row, no RelReading row — the block never ran for him.
 *
 * AND THE OTHER THREE DEMOTED LEADS GOT IN BY ACCIDENT. hasCallNoteContent tests data.context for
 * the literal '[CALL NOTE]' — a tag written ONLY by the AGENT CONTEXT block. The raw transcript
 * tags entries [CUSTOMER]/[AGENT]/[NOTE] and never [CALL NOTE], so the question the gate actually
 * asked was "did an agent happen to type a non-boilerplate phone note". Unrelated to whether a
 * conversation exists. Three passed on it, one did not, and the difference meant nothing.
 *
 * WHAT THIS SUITE HOLDS THE BUILD TO:
 *  - STRICTLY ADDITIVE. Every lead the old gate admitted still enters on the same terms.
 *  - THE NEW TERM READS THE BOUNDED REGION ONLY. Scanning the whole context finds Lead Pro's own
 *    directives and reads them back as the record — the entire v9.7.552 lesson.
 *  - THE RECORD IS ADMITTED; THE FOLLOW-UP FRAMING IS NOT. "Write a DIFFERENT follow-up ... a
 *    different person picked up the thread" on a lead whose first outreach is 20 minutes old is
 *    the James Bellard message v9.7.399 exists to stop. Third build running: the record moves,
 *    the conclusions drawn from it stay put.
 *  - NO DIRECTIVES WITH NO RECORD UNDER THEM. A newly-admitted lead whose entries all die in the
 *    walk gets no digest at all.
 *
 * Executes the SHIPPED helpers, the SHIPPED admission logic and the SHIPPED suppressions.
 * Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: arc-admit.test.js <popup.js> [popup.js...]'); process.exit(2); }

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const bail = (m) => require('./lib/fatal-guard.js').bail('arc-admit.test.js', m);

const MARKER = 'CONVERSATION TRANSCRIPT (newest first — read the full thread before responding):';

function cut(src, file, what, openMark, closeMark) {
  const a = src.indexOf(openMark);
  if (a < 0) bail(what + ': open marker not in ' + file);
  const b = src.indexOf(closeMark, a);
  if (b < 0) bail(what + ': close marker not found after the open in ' + file);
  const s = src.slice(a, b + closeMark.length);
  if (!s.trim()) bail(what + ': slice is empty in ' + file);
  return s;
}

function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const logs = [];
  const sb = { String, RegExp, console: { log: (...a) => logs.push(a.map(String).join(' ')) } };
  vm.createContext(sb);

  // (1) the two shipped module-scope helpers
  const helpers = cut(src, file, 'helpers',
    'function _lpBoundedTranscript(ctx) {', 'function _lpBuildArcSpine(ctx) {');
  if (helpers.indexOf('_lpCountArcExchanges') < 0) bail('helpers slice missing the counter in ' + file);
  vm.runInContext(helpers.replace(/function _lpBuildArcSpine\(ctx\) \{$/, ''), sb);

  // (2) the shipped admission logic, wrapped so it can be handed a data object
  const gateSrc = cut(src, file, 'admission',
    '  var _arcExchangeCt = 0;',
    'if (data.conversationBrief && (_arcAdmitOld || _arcNewlyAdmitted)) {');
  if (gateSrc.indexOf('_lpCountArcExchanges(data.context)') < 0) bail('admission slice does not call the counter in ' + file);
  // Close the `if` the slice opens, and report what it decided.
  // `var _entered = false` is not decoration. Without the declaration it is a sandbox global that
  // SURVIVES between calls, so the first admitted lead makes every later one report entered:true —
  // a stale global read as a current verdict, the exact v9.7.563 shape, in the harness this time.
  // Caught by the refusal cases below, which is what they are for.
  vm.runInContext(
    'function _admit(data, hasCallNoteContent){ var _entered = false;\n' + gateSrc
    + ' _entered = true; }\n'
    + ' return { entered: _entered, exchanges: _arcExchangeCt, oldGate: _arcAdmitOld, newlyAdmitted: _arcNewlyAdmitted }; }',
    sb);

  // (3) the shipped follow-up-framing suppression, as its own executable expression
  // Anchored on the comment header, NOT on the assignment itself. Anchoring a slice to the exact
  // line a neuter edits makes the suite report "could not find the code it tests" where it should
  // report a named failure — an unattributable result, which this repo's fatal-guard says is not
  // evidence about the code either way. Found by running the neuter.
  const nrySrc = cut(src, file, 'noReplyYet',
    '    // ── (v9.7.630) THE RECORD IS ADMITTED; THIS FRAMING IS NOT',
    '    if (noReplyYet) {');
  if (nrySrc.indexOf('var noReplyYet =') < 0) bail('noReplyYet slice does not contain the assignment in ' + file);
  vm.runInContext(
    'function _noReply(custCount, agentCount, _arcNewlyAdmitted){\n'
    + nrySrc.replace('    if (noReplyYet) {', '') + '\n return noReplyYet; }', sb);

  return {
    src, logs,
    bounded: vm.runInContext('_lpBoundedTranscript', sb),
    count: vm.runInContext('_lpCountArcExchanges', sb),
    admit: vm.runInContext('_admit', sb),
    noReply: vm.runInContext('_noReply', sb),
  };
}

// Bobby's shape: an agent wrote to him this morning; he has not replied.
const BOBBY_CTX =
  "CUSTOMER'S INQUIRY — the customer's own words when they submitted this lead:\n"
  + '"I\'m interested in this 2018 Ford Expedition and I\'d like to know if it\'s still available"\n\n'
  + MARKER + '\n---\n'
  + '[09/04/2026 9:14 AM] [AGENT] Outbound text\n  Good morning Bobby! Thanks for reaching out on the Expedition.\n'
  + '[09/04/2026 9:14 AM] [AGENT] Outbound email\n  Hi Bobby, I have the Expedition details for you.\n'
  + '[09/04/2026 9:02 AM] [NOTE] Lead received\n'
  + '\n---\n';

// A real follow-up lead: the customer has replied.
const REPLIED_CTX = 'ACTIVE FOLLOW-UP\n' + MARKER + '\n---\n'
  + '[09/04/2026 8:12 AM] [CUSTOMER] Email reply from prospect\n  Is it still available and what is the out the door price?\n'
  + '[09/03/2026 4:40 PM] [AGENT] Outbound text\n  Following up on your inquiry.\n'
  + '\n---\n';

for (const file of BUILDS) {
  const B = load(file);
  console.log('\n' + path.relative(process.cwd(), file) + ' — admitted on the record, not on the label');

  // ── BOBBY GETS IN ──────────────────────────────────────────────────────────
  console.log('\nthe one grab log173 refused outright:');
  B.logs.length = 0;
  const bobby = B.admit({ context: BOBBY_CTX, conversationBrief: BOBBY_CTX, convState: 'first-touch' }, false);
  check('the old gate refused him', bobby.oldGate, false);
  check('...and the digest now runs anyway', bobby.entered, true);
  // Two, not three: his [NOTE] Lead received line sits in the fenced body but is not an exchange,
  // and the counter recognises exactly the three tags the digest's own walk recognises.
  check('...because his bounded transcript carries a conversation', bobby.exchanges, 2);
  check('he is flagged as newly admitted', bobby.newlyAdmitted, true);
  check('the log names the refusal it is overturning',
    /ARC ADMIT DIAG.*old gate would have REFUSED/.test(B.logs.join('|')), true);
  check('...and says what the framing does', /follow-up framing and the relationship reading stay suppressed/.test(B.logs.join('|')), true);

  // ── STRICTLY ADDITIVE ──────────────────────────────────────────────────────
  console.log('\nevery lead the old gate admitted still enters, unchanged:');
  const replied = B.admit({ context: REPLIED_CTX, conversationBrief: REPLIED_CTX, convState: 'active-follow-up' }, false);
  check('a follow-up lead enters', replied.entered, true);
  check('...on the OLD term', replied.oldGate, true);
  check('...and is NOT marked newly admitted', replied.newlyAdmitted, false);
  const viaCallNote = B.admit({ context: BOBBY_CTX, conversationBrief: BOBBY_CTX, convState: 'first-touch' }, true);
  check('a first-touch lead with call-note content still enters on the old term', viaCallNote.oldGate, true);
  check('...and is NOT newly admitted, so it keeps everything it had', viaCallNote.newlyAdmitted, false);
  // The accident this build documents: [CALL NOTE] is never written by the transcript.
  check('the transcript tag set is CUSTOMER/AGENT/NOTE — [CALL NOTE] comes only from AGENT CONTEXT',
    /var who = dir==='inbound' \? 'CUSTOMER' : dir==='outbound' \? 'AGENT' : 'NOTE';/.test(B.src), true);
  check('...and hasCallNoteContent still tests data.context for it, untouched',
    /var hasCallNoteContent = \/\\\[CALL NOTE\\\]\/i\.test\(data\.context \|\| ''\);/.test(B.src), true);

  // ── A GENUINE FIRST TOUCH IS STILL REFUSED ─────────────────────────────────
  console.log('\na lead with no conversation is still refused:');
  B.logs.length = 0;
  const bare = B.admit({ context: "CUSTOMER'S INQUIRY — ...\n\"is it available\"",
                         conversationBrief: 'x', convState: 'first-touch' }, false);
  check('no bounded region, no admission', bare.entered, false);
  check('...and zero exchanges counted', bare.exchanges, 0);
  check('the log says so rather than going quiet',
    /still refused, there is no conversation to analyse/.test(B.logs.join('|')), true);
  const emptyFence = B.admit({ context: 'H\n' + MARKER + '\n---\n\n---\n',
                               conversationBrief: 'x', convState: 'first-touch' }, false);
  check('empty fences are not a conversation (Keisha shape)', emptyFence.entered, false);
  check('no brief at all — refused even with a transcript',
    B.admit({ context: BOBBY_CTX, conversationBrief: '', convState: 'first-touch' }, false).entered, false);

  // ── THE NEW TERM READS THE BOUNDED REGION ONLY ─────────────────────────────
  // The v9.7.552 lesson: Lead Pro's own directives sit in the context wearing CRM costumes.
  console.log('\nour own scaffold outside the fences can never admit a lead:');
  const scaffoldOnly =
    'AGENT CONTEXT — READ THIS FIRST.\n'
    + '[09/04/2026] [CALL NOTE] Phone call\n  a note that is NOT inside any transcript region\n'
    + '[09/04/2026] [CUSTOMER] this line is outside the fences too\n';
  const sc = B.admit({ context: scaffoldOnly, conversationBrief: 'x', convState: 'first-touch' }, false);
  check('tagged lines outside the fences are not counted', sc.exchanges, 0);
  check('...so the lead is refused', sc.entered, false);
  // And the counter itself, directly.
  check('the counter reads the bounded body only',
    B.count('junk [CUSTOMER] junk\n' + MARKER + '\n---\n[09/04] [AGENT] real\n---\n'), 1);
  check('...counting all three tags the digest walk recognises',
    B.count(MARKER + '\n---\n[1] [CUSTOMER] a\n[2] [AGENT] b\n[3] [CALL NOTE] c\n[4] [NOTE] d\n---\n'), 3);
  check('...and [NOTE] alone is not an exchange',
    B.count(MARKER + '\n---\n[1] [NOTE] Lead received\n---\n'), 0);

  // ── THE FOLLOW-UP FRAMING IS SUPPRESSED ────────────────────────────────────
  console.log('\nthe record is admitted; the follow-up framing is not:');
  check('a newly-admitted lead does NOT get NO CUSTOMER REPLY YET', B.noReply(0, 2, true), false);
  check('...but a lead admitted by the old gate still does', B.noReply(0, 2, false), true);
  check('a lead that HAS replies never got it anyway', B.noReply(3, 2, false), false);
  check('the suppressed text is the James Bellard shape',
    /Write a DIFFERENT follow-up: new angle/.test(B.src), true);
  check('...and the code names why it is gated', /James Bellard/.test(B.src), true);
  check('the suppression is logged, not silent',
    /NO CUSTOMER REPLY YET suppressed/.test(B.src), true);

  console.log('\n...and neither is the relationship reading:');
  check('renderRelationshipReading is not called for a newly-admitted lead',
    /var _relReading = _arcNewlyAdmitted \? '' : renderRelationshipReading\(data\);/.test(B.src), true);
  check('the v9.7.616 precedent is named', /fatigued ghost/.test(B.src), true);
  check('a suppressed reading is not reported as "simple lead"',
    /\} else if \(!_arcNewlyAdmitted\) \{/.test(B.src), true);

  console.log('\nand a newly-admitted lead with nothing renderable gets no digest:');
  check('the suppression exists',
    /if \(_arcNewlyAdmitted && exchangeLines\.length === 0 && !recentCust\) \{/.test(B.src), true);
  check('...and it cannot touch a lead the old gate admitted',
    /_arcNewlyAdmitted && exchangeLines\.length === 0/.test(B.src), true);

  // ── ONE DEFINITION OF THE BOUNDARY ─────────────────────────────────────────
  console.log('\nthe fence boundary has one definition, shared by gate and consumer:');
  check('the helper exists at module scope', /^function _lpBoundedTranscript\(ctx\) \{$/m.test(B.src), true);
  check('the in-block extraction now calls it', /var _tsBody = _lpBoundedTranscript\(_ctxRaw\);/.test(B.src), true);
  check('...and no longer re-implements the slice',
    /var _tsClose = _ctxRaw\.indexOf\('\\n---', _tsOpen \+ 3\);/.test(B.src), false);
  check('the counter routes through the same helper',
    /function _lpCountArcExchanges\(ctx\) \{\n  var body = _lpBoundedTranscript\(ctx\);/.test(B.src), true);
  // Behaviour of the lifted extraction, on the shapes production actually produces.
  console.log('\nthe lifted extraction behaves as it did in v9.7.629:');
  check('a normal region', B.bounded('H\n' + MARKER + '\n---\n[09/04] [CUSTOMER] hi\n---\n'), '[09/04] [CUSTOMER] hi');
  check('no marker', B.bounded('no region here'), '');
  check('marker but no fence', B.bounded('H\n' + MARKER + '\nnothing'), '');
  check('empty body', B.bounded('H\n' + MARKER + '\n---\n\n---\n'), '');
  check('unterminated region keeps the tail', B.bounded('H\n' + MARKER + '\n---\n[1] [AGENT] x'), '[1] [AGENT] x');
  check('null does not throw', B.bounded(null), '');
  check('the first region wins when two exist',
    B.bounded(MARKER + '\n---\nA\n---\n' + MARKER + '\n---\nB\n---\n'), 'A');

  // ── FAILS OPEN ─────────────────────────────────────────────────────────────
  console.log('\nit fails open — the count is never a reason a generation fails:');
  check('the counter call is wrapped', /catch \(eAx\) \{ _arcExchangeCt = 0; \}/.test(B.src), true);
  check('a null context counts zero and does not throw',
    B.admit({ context: null, conversationBrief: 'x', convState: 'first-touch' }, false).exchanges, 0);
  check('an undefined convState still reaches the old term',
    B.admit({ context: REPLIED_CTX, conversationBrief: 'x', convState: undefined }, false).oldGate, true);
}

if (BUILDS.length > 1) {
  console.log('\nboth builds admit identically:');
  const region = (f, o, c) => {
    const s = fs.readFileSync(f, 'utf8');
    const a = s.indexOf(o), b = s.indexOf(c, a);
    if (a < 0 || b < 0) bail('parity region not found in ' + f);
    return s.slice(a, b);
  };
  check('the helpers are identical',
    region(BUILDS[0], 'function _lpBoundedTranscript(ctx) {', 'function _lpBuildArcSpine')
    === region(BUILDS[1], 'function _lpBoundedTranscript(ctx) {', 'function _lpBuildArcSpine'), true);
  check('the admission logic is identical',
    region(BUILDS[0], '  var _arcExchangeCt = 0;', '_arcNewlyAdmitted)) {')
    === region(BUILDS[1], '  var _arcExchangeCt = 0;', '_arcNewlyAdmitted)) {'), true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
