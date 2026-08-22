#!/usr/bin/env node
'use strict';
/**
 * commit-comprehension.test.js — v9.7.558, PHASE 2.
 *
 * A second, comprehension-based reading of the call notes that runs ALONGSIDE the verbal-commit
 * regex and can only ever be logged. It is NOT a replacement, and this file's job is to prove
 * that structurally rather than assert it.
 *
 * THE SCAR TISSUE THIS IS BUILT AGAINST: v9.7.197 and v9.7.368 are two tightenings of this exact
 * block, each following a looser, more interpretive version fabricating a verbal commitment and
 * shipping it to a real customer. Both failed by INTERPRETING LOOSELY, not by misreading clear
 * text. So the probe's output is constrained to a verbatim quote, and the quote is then verified
 * as a literal substring of the note it named. A paraphrase is rejected as FABRICATED and
 * counted — the failure mode is measurable, not argued.
 *
 * THREE CONTAINMENT PROPERTIES, all asserted below:
 *   1. buildUserPrompt contains ZERO references to any symbol this pass defines. If a later
 *      build wires the observer into a prompt, that assertion fails first.
 *   2. The probe prompt contains NO Lead Pro directive text — in particular not the
 *      "CALL NOTE — READ BEFORE WRITING" block the regex writes when it fires. A probe that saw
 *      the regex's own answer would agree by construction and its disagreement data would be
 *      worth nothing.
 *   3. It is dispatched without await, after the draft is rendered.
 *
 * The fetch is injected, so every branch is exercised against real note structures without any
 * network call.
 *
 * Fixtures are real: Jason Pellegrin's 22-call-note history and the log119 line 436 lead.
 * Sliced out of each SHIPPED popup.js. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2);
if (!BUILDS.length) { console.error('usage: commit-comprehension.test.js <popup.js> [popup.js...]'); process.exit(2); }

const JASON = fs.readFileSync(path.join(__dirname, 'fixtures', 'jason-pellegrin-context.txt'), 'utf8');

const FOLLOWUP = '\n\nFOLLOW-UP: read the full transcript and write a response that directly continues THIS conversation.';
const SECOND_LEAD =
  '[08/20/2026 9:02 AM] [CALL NOTE] Outbound phone call (Machine)\n  By: Rochelle Price\n  Left message\n' +
  '[08/19/2026 3:21 PM] [CALL NOTE] Outbound phone call (Contacted)\n  By: Jolette Aguilar\n  coming sat 29th 4pm' + FOLLOWUP;

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');

  const ha = src.indexOf('var LP_SCAFFOLD_LINE_RE =');
  const hb = src.indexOf('// (v9.7.429/427) ONE definition of');
  const wa = src.indexOf('var LP_CRM_ENTRY_SPLIT_RE =');
  const wb = src.indexOf('// ── (v9.7.558) COMPREHENSION PASS');
  const ca = wb;
  const cb = src.indexOf('// ── (v9.7.554) AGENT LP COMMAND CHANNEL COVERAGE');
  if ([ha, hb, wa, wb, cb].some(x => x < 0) || hb <= ha || wb <= wa || cb <= ca) {
    throw new Error('could not locate the comprehension pass in ' + file);
  }

  const logs = [];
  const sandbox = { console: { log: (...x) => logs.push(x.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' ')) },
                    window: {}, JSON, Promise };
  vm.createContext(sandbox);
  vm.runInContext(src.slice(ha, hb), sandbox);
  vm.runInContext(src.slice(wa, wb), sandbox);
  vm.runInContext(src.slice(ca, cb), sandbox);

  const api = vm.runInContext('({ probe:_lpBuildCommitProbe, verify:_lpVerifyCommitQuote, delta:_lpCommitVerdictDelta, run:_lpRunCommitComprehension, walk:_lpWalkCrmEntries })', sandbox);

  // A fake endpoint + fetch so every branch runs with no network.
  const fakeEndpoint = { type: 'proxy', url: 'https://example.invalid/generate' };
  const sent = [];
  function fetchReturning(body) {
    return function (url, opts) {
      sent.push(JSON.parse(opts.body));
      return Promise.resolve({ json: () => Promise.resolve(body) });
    };
  }
  const wrap = text => ({ candidates: [{ content: { parts: [{ text }] } }] });

  return {
    name: path.basename(path.dirname(file)),
    api, sandbox, logs, sent, fakeEndpoint, fetchReturning, wrap,
    // whole-file containment checks
    src,
    run: (ctx, verdict, modelJson, opts) => {
      logs.length = 0; sent.length = 0;
      const deps = Object.assign({
        fetch: fetchReturning(typeof modelJson === 'string' ? wrap(modelJson) : modelJson),
        endpoint: fakeEndpoint,
        attach: p => p,
        log: (...x) => logs.push(x.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' '))
      }, opts || {});
      return api.run(ctx, verdict, deps).then(r => ({ result: r, logs: logs.slice(), sent: sent.slice() }));
    }
  };
}

// The real body of buildUserPrompt. classifyScenario is defined BEFORE it in the file, so
// slicing "buildUserPrompt -> classifyScenario" silently ran to end-of-file and swept in the
// dispatch site — which is exactly how the first version of the containment assertions below
// failed. Take the function's own closing brace at column 0 instead.
// (v9.7.563) Strip line comments before counting symbol references. The containment checks
// claim "no CODE reads this"; without stripping, a comment that merely NAMES the symbol counts
// as a read and the assertion fails on prose. Caught by the v9.7.563 reset comment.
function stripComments(t) {
  return t.split('\n').map(l => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/.*$/, '')).join('\n');
}
function fnBody(src, name) {
  const lines = src.split('\n');
  let a = -1;
  for (let n = 0; n < lines.length; n++) {
    if (lines[n].startsWith('function ' + name + '(')) { a = n; break; }
  }
  if (a < 0) throw new Error('could not locate function ' + name);
  for (let n = a + 1; n < lines.length; n++) {
    if (lines[n] === '}') return lines.slice(a, n + 1).join('\n');
  }
  throw new Error('could not find the end of ' + name);
}

const impls = BUILDS.map(extract);
let pass = 0, fail = 0;
const pending = [];

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

// async variant — queued and awaited in order so output stays readable
function checkAsync(name, fn, want) {
  pending.push(async () => {
    let results;
    try { results = await Promise.all(impls.map(async i => JSON.stringify(await fn(i)))); }
    catch (e) { results = ['THREW: ' + e.message]; }
    const agree = results.every(r => r === results[0]);
    const ok = agree && results[0] === JSON.stringify(want);
    if (ok) { pass++; console.log('  ok   ' + name); }
    else {
      fail++; console.log('  FAIL ' + name);
      if (!agree) impls.forEach((i, n) => console.log('        ' + i.name + ' -> ' + results[n]));
      else console.log('        expected ' + JSON.stringify(want) + '\n        got      ' + results[0]);
    }
  });
}

function section(t) { pending.push(async () => console.log('\n' + t)); }

console.log('\nv9.7.558 Phase 2 — the comprehension pass, as an observer');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── Containment: the properties that make "observer only" structural ───────────
console.log('containment — this cannot influence a customer-facing message:');

check('buildUserPrompt references NO comprehension symbol',
  i => (stripComments(fnBody(i.src, 'buildUserPrompt'))
        .match(/_lpRunCommitComprehension|_lpCommitComprehension|LEADPRO_COMMIT_COMPREHENSION|_lpBuildCommitProbe|_lpVerifyCommitQuote|_lpCommitVerdictDelta/g) || []).length,
  0);

check('...and neither does classifyScenario, the other prompt-shaping function',
  i => (fnBody(i.src, 'classifyScenario')
        .match(/_lpRunCommitComprehension|_lpCommitComprehension|LEADPRO_COMMIT_COMPREHENSION|_lpBuildCommitProbe|_lpVerifyCommitQuote|_lpCommitVerdictDelta|_lpVerbalCommitVerdict/g) || []).length,
  0);

check('the containment check is not vacuous — the body really is the whole function',
  i => {
    const body = fnBody(i.src, 'buildUserPrompt');
    return body.length > 100000 && /CALL NOTE — READ BEFORE WRITING/.test(body);
  }, true);

// (v9.7.564) TWO writes now, not one — the PROBE-FAILED path stashes its own result so a dead
// probe is inspectable in the console the same way a real verdict is. `reads: 0` is the
// load-bearing half of this assertion and is unchanged: nothing in the file consumes the stash.
check('the window stash is written but never read anywhere in the file',
  i => {
    const writes = (i.src.match(/window\._lpCommitComprehension\s*=/g) || []).length;
    const reads  = (i.src.match(/window\._lpCommitComprehension(?!\s*=)/g) || []).length;
    return { writes, reads };
  }, { writes: 2, reads: 0 });

check('the regex verdict stash is written inside buildUserPrompt but never read back there',
  i => {
    const body = stripComments(fnBody(i.src, 'buildUserPrompt'));
    return { writes: (body.match(/window\._lpVerbalCommitVerdict\s*=/g) || []).length,
             reads:  (body.match(/window\._lpVerbalCommitVerdict(?!\s*=)/g) || []).length };
  }, { writes: 2, reads: 0 });

// (v9.7.568) TWO readers now, and the second one is the point of that build: the telemetry flush
// reads the stash to recover the REGEX side of the pair, because the flush runs after
// buildUserPrompt and that is the only moment the verdict exists. The load-bearing half of this
// assertion is unchanged and asserted directly above — buildUserPrompt writes it and never reads
// it back. What this one now pins is that both readers sit OUTSIDE the prompt builder.
check('the stash is read only outside buildUserPrompt — the dispatch and the telemetry flush',
  i => {
    const code = stripComments(i.src);
    const total = (code.match(/window\._lpVerbalCommitVerdict(?!\s*=)/g) || []).length;
    const inPrompt = (stripComments(fnBody(i.src, 'buildUserPrompt'))
      .match(/window\._lpVerbalCommitVerdict(?!\s*=)/g) || []).length;
    const inFlush = (() => {
      const a = i.src.indexOf('function _lpFlushFactTelemetry(');
      const b = i.src.indexOf('\n// ── Apply the verdicts', a);
      return (stripComments(i.src.slice(a, b)).match(/window\._lpVerbalCommitVerdict(?!\s*=)/g) || []).length;
    })();
    return { total, inPrompt, inFlush };
  }, { total: 2, inPrompt: 0, inFlush: 1 });

check('the observer is dispatched WITHOUT await, so it cannot delay a draft',
  i => /(?:^|[^.\w])await\s+_lpRunCommitComprehension/.test(i.src), false);

check('it is switchable off with one flag',
  i => /var LEADPRO_COMMIT_COMPREHENSION = true;/.test(i.src), true);

// ── The probe prompt: isolation and shape ──────────────────────────────────────
console.log('\nthe probe prompt — isolated from the regex\'s own answer:');

check('it carries none of the directive text the regex writes when it fires',
  i => {
    const p = i.api.probe(['[08/19/2026] [CALL NOTE] will try to come in on sat']);
    return /CALL NOTE — READ BEFORE WRITING|already has a next step agreed upon|Do NOT offer new appointment times/.test(p);
  }, false);

check('it carries no VOI, store, scenario or signature scaffold',
  i => {
    const p = i.api.probe(['[08/19/2026] [CALL NOTE] will try to come in on sat']);
    return /VEHICLE ON LEAD|Vehicle of Interest|SMS SIGNATURE|CONVERSATION ARC|STORE INCENTIVE/.test(p);
  }, false);

check('it contains the notes it was given, and numbers them',
  i => {
    const p = i.api.probe(['[08/20] [CALL NOTE] Left message', '[08/19] [CALL NOTE] will try to come in on sat']);
    return /\[1\] \[08\/20\] \[CALL NOTE\] Left message/.test(p) && /\[2\] .*will try to come in on sat/.test(p);
  }, true);

check('it names both failure modes this block has actually shipped',
  i => {
    const p = i.api.probe(['x']);
    return /voicemail we left, a message we sent, or something an agent plans to do is NOT the customer committing/.test(p)
        && /negated statement/.test(p);
  }, true);

check('it demands a verbatim quote and forbids paraphrase',
  i => {
    const p = i.api.probe(['x']);
    return /CHARACTER FOR CHARACTER/.test(p) && /Never paraphrase/.test(p);
  }, true);

// ── Quote verification: the guard against the v9.7.197/368 failure mode ────────
console.log('\nquote verification — a paraphrase is a fabrication, and is caught:');

const NOTES = [
  '[08/20/2026 11:36 AM] [CALL NOTE] Outbound phone call (Machine)\n  By: Chassica Vincent\n  Left message',
  '[08/19/2026 4:10 PM] [CALL NOTE] Outbound phone call (Contacted)\n  By: Chassica Vincent\n  will try to come in on sat just to see what her car is worth sent contact info'
];

check('an exact quote verifies, and names the note it came from',
  i => i.api.verify('will try to come in on sat', NOTES), 2);
check('whitespace reflow still verifies — that is not the failure mode',
  i => i.api.verify('will try   to come\n in on sat', NOTES), 2);
check('different case verifies',
  i => i.api.verify('WILL TRY TO COME IN ON SAT', NOTES), 2);
check('a PARAPHRASE does not verify',
  i => i.api.verify('the customer said he would come in on Saturday', NOTES), 0);
check('a plausible invention does not verify',
  i => i.api.verify('will come in Saturday at 2pm', NOTES), 0);
check('two notes welded together do not verify',
  i => i.api.verify('Left message will try to come in on sat', NOTES), 0);
check('an empty or trivial quote does not verify',
  i => [i.api.verify('', NOTES), i.api.verify('x', NOTES)], [0, 0]);

// ── The delta classifier ───────────────────────────────────────────────────────
console.log('\nthe verdict delta — the number this build exists to collect:');

check('both say commitment',        i => i.api.delta(true,  'soft', true),  'AGREE-COMMITMENT');
check('both say none',             i => i.api.delta(false, 'none', true),  'AGREE-NONE');
check('regex only',                i => i.api.delta(true,  'none', true),  'DISAGREE-REGEX-ONLY');
check('comprehension only',        i => i.api.delta(false, 'firm', true),  'DISAGREE-COMPREHENSION-ONLY');
check('an unverified quote outranks every other classification',
  i => [i.api.delta(true, 'firm', false), i.api.delta(false, 'firm', false)],
  ['QUOTE-FABRICATED', 'QUOTE-FABRICATED']);

// ── End to end against the real captures ───────────────────────────────────────
section("end to end on Jason Pellegrin's real 22-call-note history:");

// (v9.7.560) The boilerplate filter now runs BEFORE the probe, so refused notes never reach it.
// Of Jason's top-6 call notes only the 8/19 Contacted one is readable — the other five are
// voicemail drops — and all 12 of his general notes are housekeeping or empty. The probe
// therefore sees ONE note, and the commitment is note 1 in its numbering rather than note 2.
// That is the intended effect: no wasted tokens on "Left message", and no contact data.
checkAsync('the probe reads only the READABLE notes, not the raw walk',
  async i => (await i.run(JASON, { fired: true, quote: 'will try to come in on sat' },
    '{"kind":"soft","note":1,"quote":"will try to come in on sat just to see what her car is worth sent contact info"}')).result.notesRead,
  1);

// 11, not 17: the walk is capped at 6 PER TYPE, so it examines 6 call notes (5 refused) and 6
// of his 12 general notes (all 6 refused) — the cap is applied before the filter, not after.
checkAsync('...and the ones it dropped are counted, not silently gone',
  async i => (await i.run(JASON, { fired: true, quote: 'x' },
    '{"kind":"none","note":null,"quote":null}')).result.notesRefused,
  11);

checkAsync('the probe it sent contains his notes and no Lead Pro scaffold',
  async i => {
    const r = await i.run(JASON, { fired: true, quote: 'x' }, '{"kind":"none","note":null,"quote":null}');
    const text = r.sent[0].contents[0].parts[0].text;
    return { hasHisNote: /will try to come in on sat/.test(text),
             hasScaffold: /VEHICLE ON LEAD|ZERO-CONTACT LEAD|FOLLOW-UP: read the full transcript/.test(text) };
  }, { hasHisNote: true, hasScaffold: false });

checkAsync('regex FIRED + comprehension soft on the same note = AGREE-COMMITMENT',
  async i => {
    const r = await i.run(JASON, { fired: true, quote: 'will try to come in on sat' },
      '{"kind":"soft","note":1,"quote":"will try to come in on sat just to see what her car is worth sent contact info"}');
    return { delta: r.result.delta, verified: r.result.verifiedNote, logged: /AGREE-COMMITMENT/.test(r.logs.join(' ')) };
  }, { delta: 'AGREE-COMMITMENT', verified: 1, logged: true });

checkAsync('a paraphrased quote is reported FABRICATED even when the regex agrees',
  async i => {
    const r = await i.run(JASON, { fired: true, quote: 'will try to come in on sat' },
      '{"kind":"firm","note":2,"quote":"the customer agreed to visit on Saturday"}');
    return { delta: r.result.delta, quoteVerified: r.result.quoteVerified };
  }, { delta: 'QUOTE-FABRICATED', quoteVerified: false });

checkAsync('the log prints both verdicts side by side',
  async i => {
    const r = await i.run(JASON, { fired: true, quote: 'will try to come in on sat' },
      '{"kind":"soft","note":1,"quote":"will try to come in on sat just to see what her car is worth sent contact info"}');
    const l = r.logs.join(' ');
    return /regex:FIRED "will try to come in on sat"/.test(l) && /comprehension:soft note 1/.test(l);
  }, true);

checkAsync('the model naming the wrong note number is recorded, not silently accepted',
  async i => {
    const r = await i.run(JASON, { fired: true, quote: 'x' },
      '{"kind":"soft","note":5,"quote":"will try to come in on sat"}');
    return { claimed: r.result.claimedNote, verified: r.result.verifiedNote,
             noted: /verified against note 1/.test(r.logs.join(' ')) };
  }, { claimed: 5, verified: 1, noted: true });

section('the second log119 lead — a commitment one note below a voicemail:');

checkAsync('comprehension finds "coming sat 29th 4pm" and agrees with the regex',
  async i => {
    const r = await i.run(SECOND_LEAD, { fired: true, quote: 'coming sat 29th 4pm' },
      '{"kind":"firm","note":1,"quote":"coming sat 29th 4pm"}');
    return { delta: r.result.delta, verified: r.result.verifiedNote };
  }, { delta: 'AGREE-COMMITMENT', verified: 1 });

// (v9.7.560) BEHAVIOUR CHANGE, stated rather than absorbed: a lead whose every note is refused
// now SKIPS instead of producing an AGREE-NONE row. Emitting AGREE-NONE would assert the model
// answered "none" when it was never asked — the probe cannot run with no readable notes. The
// cost is a real one: the agreement denominator shifts at the v9.7.559/560 boundary, so rates
// either side are not directly comparable. Rows carry extensionVersion, and the SKIP line names
// how many notes were refused, so the discontinuity is visible rather than silent.
checkAsync('a voicemail-only lead now SKIPS rather than claiming an answer it never got',
  async i => {
    const r = await i.run('[08/20/2026 10:14 AM] [CALL NOTE] Outbound phone call (Machine)\n  By: A\n  Left message' + FOLLOWUP,
      { fired: false, quote: '' }, '{"kind":"none","note":null,"quote":null}');
    return r.result;
  }, null);

// (v9.7.562) SKIPPED is now three-way: a wiring fault, a genuinely note-free lead, and
// "everything was refused" no longer read identically. This is the refused case.
checkAsync('...and the skip says how many notes it refused',
  async i => /SKIPPED — every note was refused \(1 as boilerplate or contact data\) \| ctxLen:\d+/.test(
    (await i.run('[08/20/2026 10:14 AM] [CALL NOTE] Outbound phone call (Machine)\n  By: A\n  Left message' + FOLLOWUP,
      { fired: false, quote: '' }, '{"kind":"none","note":null,"quote":null}')).logs.join(' ')),
  true);

checkAsync('DISAGREE-COMPREHENSION-ONLY is reachable — the case that would justify promotion',
  async i => {
    const r = await i.run('[08/19/2026 4:10 PM] [CALL NOTE] Outbound phone call (Contacted)\n  By: A\n  said he would swing past after work thursday',
      { fired: false, quote: '' },
      '{"kind":"firm","note":1,"quote":"said he would swing past after work thursday"}');
    return { delta: r.result.delta, verified: r.result.verifiedNote };
  }, { delta: 'DISAGREE-COMPREHENSION-ONLY', verified: 1 });

section('every exit path logs — a silent skip would bias the count:');

// "nothing here" is now READABLE content (12 chars of real prose), so it no longer skips — use a
// context that genuinely carries neither note type.
checkAsync('a context with neither note type skips, and says the lead is note-free',
  async i => (await i.run('[08/20/2026] [AGENT] Outbound Text Message\n  By: A\n  anything', { fired: false, quote: '' }, '{}'))
    .logs.filter(l => /SKIPPED — this lead genuinely carries no CRM notes \| ctxLen:\d+/.test(l)).length, 1);

// The distinction that was missing: an EMPTY context is a wiring fault, not a note-free lead.
checkAsync('an empty context is reported as a WIRING FAULT instead',
  async i => (await i.run('', { fired: false, quote: '' }, '{}'))
    .logs.filter(l => /NO CONTEXT TEXT REACHED THE OBSERVER — this is a wiring fault/.test(l)).length, 1);

checkAsync('a general note with real prose IS read rather than skipped',
  async i => (await i.run('[08/20/2026] [NOTE] General Note\n  By: A\n  nothing here',
    { fired: false, quote: '' }, '{"kind":"none","note":null,"quote":null}')).result.notesRead, 1);

checkAsync('no endpoint configured',
  async i => (await i.run(JASON, { fired: false, quote: '' }, '{}', { endpoint: null }))
    .logs.filter(l => /SKIPPED — no endpoint/.test(l)).length, 1);

checkAsync('the model returns unparseable text',
  async i => (await i.run(JASON, { fired: true, quote: 'x' }, 'I think he is coming Saturday.'))
    .logs.filter(l => /UNPARSEABLE/.test(l)).length, 1);

checkAsync('a fenced ```json block is still parsed',
  async i => (await i.run(JASON, { fired: false, quote: '' },
    '```json\n{"kind":"none","note":null,"quote":null}\n```')).result.delta, 'AGREE-NONE');

checkAsync('the fetch rejects',
  async i => (await i.run(JASON, { fired: true, quote: 'x' }, '{}',
    { fetch: () => Promise.reject(new Error('network down')) }))
    .logs.filter(l => /FAILED — network down/.test(l)).length, 1);

// (v9.7.564) A PROXY ERROR IS NOT A MODEL PARSE FAILURE. This used to log UNPARSEABLE, which
// reads as "the model returned bad JSON" and is the wrong diagnosis — nothing was returned at
// all. It is now PROBE-FAILED with the proxy's own reason, and the genuinely-unparseable case
// above (model returned prose) still logs UNPARSEABLE, so the two stay distinguishable.
checkAsync('a proxy error envelope reports PROBE-FAILED, not UNPARSEABLE',
  async i => {
    const r = await i.run(JASON, { fired: false, quote: '' }, { error: 'nope' });
    return { unparseable: r.logs.filter(l => /UNPARSEABLE/.test(l)).length,
             probeFailed: r.logs.filter(l => /PROBE-FAILED/.test(l)).length,
             delta: r.result && r.result.delta };
  }, { unparseable: 0, probeFailed: 1, delta: 'PROBE-FAILED' });

checkAsync('an unknown kind is treated as none, not as a commitment',
  async i => (await i.run(JASON, { fired: false, quote: '' },
    '{"kind":"maybe","note":1,"quote":"something"}')).result.kind, 'none');

checkAsync('the flag off means no call and no log noise',
  async i => {
    i.sandbox.LEADPRO_COMMIT_COMPREHENSION = false;
    const r = await i.run(JASON, { fired: true, quote: 'x' }, '{}');
    i.sandbox.LEADPRO_COMMIT_COMPREHENSION = true;
    return { result: r.result, calls: r.sent.length, logs: r.logs.length };
  }, { result: null, calls: 0, logs: 0 });

(async () => {
  for (const p of pending) await p();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
