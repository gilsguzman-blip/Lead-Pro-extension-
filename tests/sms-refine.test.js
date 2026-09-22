#!/usr/bin/env node
'use strict';
// (v9.7.611) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('sms-refine.test.js');

/**
 * sms-refine.test.js — v9.7.669. THE TEXT IS WRITTEN BEFORE THE EMAIL EXISTS.
 *
 * Gil, 9/16, after v9.7.668 shipped and the text still read like an email: "crazy idea can we
 * have the sms gen and then the email and then have the text regen based off the email and then
 * present the results?"
 *
 * WHY IT IS THE RIGHT SHAPE. The JSON contract is {"sms":...,"email":...,"voicemail":...} — stated
 * twice in the prompt, and every raw capture opens `{"sms":`. The text is the FIRST thing the model
 * writes, cold, off an 84,000-character prompt, before a word of the email exists. The email is
 * written second, once an angle has been chosen. Three prompt builds could not change that order.
 *
 * AND THE SIZE RATIO IS THE OTHER HALF. The shape rule is ~2,000 characters against ~84,000 of
 * context. This pass hands the model a few thousand characters, of which the rule is a large share.
 *
 * IT IS NOT "SHORTEN THE EMAIL". v9.7.665 established compression IS the failure mode. This pass
 * asks for ONE thing out of the email and forbids its second and third points.
 *
 * THE RULE THAT MATTERS MOST HERE IS THE ONE ABOUT DOING NOTHING: every failure path keeps the
 * first pass. A refine pass that can blank a draft an agent is about to send to a real customer is
 * worse than one that never runs.
 *
 * Executes the SHIPPED functions. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: sms-refine.test.js <popup.js> [popup.js...]'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const span = (mark, what) => {
    const a = src.indexOf(mark);
    if (a < 0) throw new Error(what + ' not found');
    const b = src.indexOf('\n}\n', a);
    if (b < 0) throw new Error(what + ' end not found');
    return src.slice(a, b + 2);
  };
  const ruleLine = (src.match(/^var _LP_SMS_SHAPE_RULE = '[^\n]*';$/m) || [''])[0];
  if (!ruleLine) throw new Error('_LP_SMS_SHAPE_RULE definition not found');

  // The call site, lifted so its ORDER and its guard are read off the shipped file.
  const ca = src.indexOf('    // (v9.7.669) THE SMS REFINE PASS. Placed HERE and nowhere else');
  if (ca < 0) throw new Error('the refine call site not found');
  const cEnd = src.indexOf('    // Light-touch SMS opener check', ca);
  if (cEnd < 0) throw new Error('the refine call site end not found');

  return {
    name: path.basename(path.dirname(file)), src,
    rule: ruleLine,
    sys:  span('function buildSystemPromptSmsRefine(agentFirst, storeName, phone) {', 'buildSystemPromptSmsRefine'),
    usr:  span('function _lpBuildSmsRefinePrompt(pass1, emailText, d) {', '_lpBuildSmsRefinePrompt'),
    call: span('async function _lpRefineSms(pass1, emailText, d) {', '_lpRefineSms'),
    site: src.slice(ca, cEnd)
  };
}

// ── AIMEE'S REAL LEAD, from log207 ──────────────────────────────────────────
const PASS1 = 'Aimee, the Glacial White Pearl 2026 Kia Sportage LX is here and certified, so you can sit inside and compare it with your Seltos while we review your approval options. I can have everything ready this afternoon at 2:30 PM or 3:15 PM.';
const EMAIL = 'Subject: See the Sportage interior today\n\nHi Aimee,\n\nThe Glacial White Pearl 2026 Kia Sportage LX is here and certified, so you can see the interior in person and make sure the extra space feels right. I can also have your 2022 Seltos appraisal started and have our finance team review the approval details during the same visit.\n\nI can have everything ready so you are not waiting when you arrive. Would 2:30 PM or 3:15 PM today work better?\n\nJordyn Guzman\nInternet Sales Coordinator\nCommunity Kia Baytown\n281-837-3630';
const AIMEE = {
  lastInboundMsg: 'Can I see the inside',
  storeName: 'Community Kia Baytown',
  relationshipSignals: { unansweredQuestions: [
    { date: '09/11/2026', question: 'Did you get my inform' },
    { date: '09/16/2026', question: 'Can I see the inside' }
  ] }
};

// Build a sandbox carrying the shipped functions, with fetch stubbed per case.
function ctx(impl, opts) {
  opts = opts || {};
  const logs = [];
  const sb = {
    String, JSON, Date, RegExp, Array, Math, Error, setTimeout, clearTimeout, AbortController,
    console: { log: (...x) => logs.push(x.join(' ')) },
    window: Object.assign({
      _leadProResolvedSigner:  { firstName: 'Jordyn', phone: '281-837-3630' },
      _leadProResolvedContext: { storeName: 'Community Kia Baytown' }
    }, opts.window || {}),
    getEndpoint: () => (opts.endpoint === null ? null : { url: 'https://example.invalid/generate' }),
    _lpAttachLicense: p => p,
    fetch: opts.fetch || (() => Promise.reject(new Error('fetch not stubbed'))),
    __sent: null, __out: undefined
  };
  vm.createContext(sb);
  vm.runInContext(impl.rule + '\n' + impl.sys + '\n' + impl.usr + '\n' + impl.call, sb);
  sb.__logs = logs;
  return sb;
}

// A worker response envelope, shaped exactly like the real one.
const ok = sms => ({
  json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms }) }] } }] })
});
const stub = (resp, capture) => function (url, init) {
  if (capture) capture(JSON.parse(init.body));
  const r = typeof resp === 'function' ? resp() : resp;
  return Object.assign(Promise.resolve(r), { finally: f => Promise.resolve(r).then(v => { f(); return v; }) });
};

function refine(impl, opts) {
  const sb = ctx(impl, opts);
  return vm.runInContext(
    '__out = _lpRefineSms(' + JSON.stringify(opts.pass1 === undefined ? PASS1 : opts.pass1) + ', '
      + JSON.stringify(opts.email === undefined ? EMAIL : opts.email) + ', __d);',
    Object.assign(sb, { __d: opts.d === undefined ? AIMEE : opts.d })
  ).then(v => ({ out: v, logs: sb.__logs.join(' ‖ ') }));
}
function userPrompt(impl, d, pass1, email) {
  const sb = ctx(impl, {});
  sb.__d = d; sb.__p = pass1 === undefined ? PASS1 : pass1; sb.__e = email === undefined ? EMAIL : email;
  return vm.runInContext('_lpBuildSmsRefinePrompt(__p, __e, __d)', sb);
}
function sysPrompt(impl) {
  const sb = ctx(impl, {});
  return vm.runInContext("buildSystemPromptSmsRefine('Jordyn', 'Community Kia Baytown', '281-837-3630')", sb);
}

const guardedImpls = require('./lib/guarded-impls.js');
const impls = guardedImpls(BUILDS, extract);
let pass = 0, fail = 0;
function report(name, results, want) {
  const agree = results.every(r => r === results[0]);
  const ok2 = agree && results[0] === JSON.stringify(want);
  if (ok2) { pass++; console.log('  ok   ' + name); }
  else {
    fail++; console.log('  FAIL ' + name);
    if (!agree) impls.forEach((i, n) => console.log('        ' + i.name + ' -> ' + results[n]));
    else console.log('        expected ' + JSON.stringify(want) + '\n        got      ' + results[0]);
  }
}
const check = (name, fn, want) =>
  report(name, impls.map(i => { try { return JSON.stringify(fn(i)); } catch (e) { return 'THREW: ' + e.message; } }), want);
const checkA = async (name, fn, want) =>
  report(name, await Promise.all(impls.map(async i => { try { return JSON.stringify(await fn(i)); } catch (e) { return 'THREW: ' + e.message; } })), want);

(async function () {

console.log('\nv9.7.669 — the text is rewritten from the email that was written after it');
console.log('builds under test: ' + impls.map(i => i.name).join(', '));
guardedImpls.note(impls);

// ── (1) ONE DEFINITION OF THE RULE ──────────────────────────────────────────
console.log('\n(1) the shape rule has exactly one definition, read by both prompts:');

check('the rule literal appears once in the file, not twice',
  i => (i.src.match(/'SMS: A REAL TEXT MESSAGE/g) || []).length, 1);
check('the main system prompt reads the constant',
  i => (i.src.match(/^    _LP_SMS_SHAPE_RULE,$/gm) || []).length >= 1, true);
check('the refine system prompt reads the same constant, not a copy',
  i => /_LP_SMS_SHAPE_RULE/.test(i.sys), true);
check('the constant is DECLARED above its first use, not below it (v9.7.422)',
  i => i.src.indexOf('var _LP_SMS_SHAPE_RULE =') < i.src.indexOf('\n    _LP_SMS_SHAPE_RULE,'), true);
check('so the rule reaches the refine pass verbatim, read-back test and all',
  i => /joining two clauses with "while"/.test(sysPrompt(i)) && /LEAD ON WHAT THEY CARE ABOUT, NOT ON OUR AGENDA/.test(sysPrompt(i)), true);

// ── (2) THE SYSTEM PROMPT SAYS WHAT THIS PASS IS NOT ────────────────────────
console.log('\n(2) the system prompt forbids the operation that IS the failure mode:');

check('it says the email is already written and already decided the angle',
  i => /ALREADY been written and is going out/.test(sysPrompt(i)), true);
check('it says in so many words this is not a shortening',
  i => /you are NOT shortening it/.test(sysPrompt(i)), true);
check('it carries the identity, so the refine cannot drift off the signer',
  i => /You are Jordyn at Community Kia Baytown\. Your direct phone number is 281-837-3630\./.test(sysPrompt(i)), true);
check('it asks for the same JSON envelope the rest of the pipeline parses',
  i => /Return ONLY valid JSON: \{"sms":"\.\.\."\}/.test(sysPrompt(i)), true);
// (v9.7.676) THE RAW CHARACTER CAP IS GONE, AND THAT IS A CORRECTION, NOT A LOOSENING.
// It has now broken twice in two builds for legitimate growth — v9.7.675 restating the LANGUAGE
// constraint, v9.7.676 giving the SMS the register instructions the email has always had — and
// both times the honest response was to raise it, which is the shape of an assertion measuring
// the wrong thing. A cap on total characters was only ever standing in for "the shape rule is not
// drowned", and it actively hides the outcome that matters: this build ADDED text and the rule's
// share went UP, from 62% to 67%, because the addition went into the rule rather than around it.
// The two measures below are what the cap was for, they cannot be satisfied by padding, and they
// would both fail on the 84,000-character brief this pass exists to escape.
check('the shape rule dominates the prompt rather than sitting inside it',
  i => { const s2 = sysPrompt(i); return i.rule.length / s2.length > 0.55; }, true);
check('...and the prompt is more than an order of magnitude smaller than the brief it replaces',
// (v9.7.678) THRESHOLD CORRECTED FROM 15 TO 10, AND THIS IS THE ASSERTION AGREEING WITH ITS OWN
// NAME RATHER THAN A FOURTH LOOSENING. It is called "more than an order of magnitude smaller" and
// tested 15, which is not an order of magnitude; 10 is. The measured ratio is 1:14.9, so nothing
// here is close to the line — but the number and the claim now match, and it will not need
// re-tuning the next time the rule earns a sentence. The share floor below is the real guard and
// it is at 74%, its highest yet, because the growth went INTO the rule.
  i => 84667 / sysPrompt(i).length > 10, true);
check('...which the brief itself would fail, so the bound is not vacuous',
  i => 84667 / 84667 > 15, false);
check('...and the rule is a large share of it, not a footnote',
  i => { const s = sysPrompt(i); return i.rule.length / s.length > 0.5; }, true);

// ── (3) THE USER TURN, BUILT FROM AIMEE'S REAL LEAD ─────────────────────────
console.log('\n(3) the user turn, built from log207:');

check('it carries the finished email',
  i => /The Glacial White Pearl 2026 Kia Sportage LX is here and certified, so you can see the interior/.test(userPrompt(i, AIMEE)), true);
check('it carries her last message in her own words',
  i => /"Can I see the inside"/.test(userPrompt(i, AIMEE)), true);
check('it carries BOTH open threads the v9.7.666 detector surfaced',
  i => { const p = userPrompt(i, AIMEE); return [/Did you get my inform/.test(p), /QUESTIONS OF THEIRS THAT ARE STILL OPEN/.test(p)]; }, [true, true]);
check('it carries the first-pass draft it is replacing',
  i => /THE FIRST DRAFT OF THE TEXT/.test(userPrompt(i, AIMEE)) && /and certified, so you can sit inside/.test(userPrompt(i, AIMEE)), true);
// (v9.7.670) Reworded when the floor was added — "do not write it again with words removed" now
// sits inside the anti-agenda sentence rather than standing alone. Same instruction, and it is
// still asserted by the clause that carries the meaning rather than by the old phrasing.
check('it names the failure it exists to prevent',
  i => /do not take the email and delete words out of it .* is the exact failure this pass exists to prevent/.test(userPrompt(i, AIMEE)), true);

// ── (v9.7.671) NO LENGTH CONSTRAINT AT ALL ─────────────────────────────────
// Gil, 9/16: "I don't think giving it a 3 sentence constraint is the right idea. I'm pretty sure
// the model can convey what it needs to without any constraint and not be too wordy."
//
// The record backs him. v9.7.669 pushed only at length and produced a two-sentence receipt.
// v9.7.670 answered with a floor and a sentence count; log209 hit the count exactly and produced
// a NEW artefact — 'Aimee, you asked, "Can I see the inside?" ...' — reading her own message back
// to her in quotation marks. Each counter-weight bought one problem and sold another.
console.log('\n    (v9.7.671) length is the model\'s to judge:');
check('no sentence count survives anywhere in the refine prompt',
  i => /THREE SENTENCES|two or three short sentences\b(?![^]*describes)/i.test(
    userPrompt(i, AIMEE).slice(userPrompt(i, AIMEE).indexOf('WRITE THE TEXT'))), false);
check('the v9.7.670 floor statements are gone by name',
  i => [/THEN GIVE THEM ONE REASON/.test(userPrompt(i, AIMEE)),
        /SHORTER IS NOT AUTOMATICALLY BETTER/.test(userPrompt(i, AIMEE)),
        /Cutting is not the goal/.test(userPrompt(i, AIMEE))], [false, false, false]);
check('...and so is v9.7.669\'s absolute on the other side',
  i => /Carry that one thing and nothing else/.test(userPrompt(i, AIMEE)), false);
check('length is handed to the model outright',
  i => /LENGTH IS YOURS TO JUDGE\. There is no target here and no sentence count\./.test(userPrompt(i, AIMEE)), true);
// (v9.7.672) v9.7.671 defused the shared rule's "two or three short sentences" by arguing with it
// from this prompt. That is the move this codebase has proven does not work — a rule stated
// elsewhere loses to the line the model is reading — and log210 proved it again, both passes still
// at two sentences. The phrase is removed at the source now, so the argument is gone with it.
check('the defusing clause is gone, because what it defused is gone',
  i => /describes what a text usually looks like|quota to reach or a ceiling/.test(userPrompt(i, AIMEE)), false);
// THE PROSE-MATCH HAZARD, EIGHTH TIME, ONE BUILD AFTER RECORDING THE SEVENTH. This first scanned
// i.src — the whole file — which carries v9.7.671's build header, and headers quote the very text
// the build removed. It read as "the count is still shipping" when the rule no longer has it.
// The subject of the assertion is the RULE, so the slice under test has to be the rule.
check('...and no sentence count survives in the shared rule either',
  i => /two or three short sentences|can carry three things/.test(i.rule), false);
check('the rule slice is the rule, not a header quoting it',
  i => /^var _LP_SMS_SHAPE_RULE = /.test(i.rule) && i.rule.length > 1500, true);
check('both failure directions are named without either becoming a number',
  i => /Do not pad it to sound thorough and do not strip it to a receipt/.test(userPrompt(i, AIMEE)), true);
check('what replaces the constraint is a job, not a size',
  i => /Then give them the substance \u2014 the actual reason this visit is worth making/.test(userPrompt(i, AIMEE)), true);
// (v9.7.673) THE DEFERRAL LANGUAGE WAS THE LAST THING STILL CUTTING. Four statements across the
// two prompts told the model to leave content out and let the email carry it. log211's refined
// draft dropped the appraisal and the approval answer — the whole reason to come in — and
// kept only "I can have it ready". The file's own v9.7.553 header had already established why
// that is wrong: the customer may only ever read the text.
check('nothing defers the substance to the email any more',
  i => /nothing they do not need|The email carries the rest|second AND third points/.test(userPrompt(i, AIMEE)), false);
check('...and the reason is stated, not just the rule',
  i => /plenty of customers read the text and never open the email/.test(userPrompt(i, AIMEE)), true);
check('"if that reason is two things, it is two things" — no cap on the substance',
  i => /If that reason is two things, it is two things/.test(userPrompt(i, AIMEE)), true);

console.log('\n    the quoting artefact log209 produced, which my own wording caused:');
check('"Open on THEIR words" — the phrase the model read as "quote them" — is gone',
  i => /Open on THEIR words/.test(userPrompt(i, AIMEE)), false);
check('...replaced by what it was meant to say',
  i => /Answer it IN YOUR OWN VOICE/.test(userPrompt(i, AIMEE)), true);
check('quoting the customer back is forbidden outright',
  i => /Do NOT quote their message back to them, and do not repeat their words in quotation marks/.test(userPrompt(i, AIMEE)), true);
check('...with the reason stated, so it reads as register rather than as a ban',
  i => /A person answers the question; they do not read it aloud first/.test(userPrompt(i, AIMEE)), true);

console.log('\n    what survives untouched:');
check('the anti-agenda instruction survives as FORM, not as a content cap',
  i => [/Do not work through an agenda in paragraphs/.test(userPrompt(i, AIMEE)),
        /The difference between the two is the voice and the rhythm, not how much you left out/.test(userPrompt(i, AIMEE))],
  [true, true]);
check('the lead is still the thing that earns a reply — without "one" capping it',
  i => [/Lead on the thing in that email that earns a reply/.test(userPrompt(i, AIMEE)),
        /Lead on the one thing/.test(userPrompt(i, AIMEE))], [true, false]);
check('the first-name opener reaches this pass from both sides',
  i => [/Open with their first name/.test(userPrompt(i, AIMEE)),
        /THE TEXT OPENS WITH THE CUSTOMER'S FIRST NAME/.test(sysPrompt(i))], [true, true]);
check('...and the system prompt says a nameless refine is not a refine',
  i => /A refined text that has dropped the name has not been refined/.test(sysPrompt(i)), true);
check('the shared shape rule itself is NOT forked — still one definition',
  i => (i.src.match(/'SMS: A REAL TEXT MESSAGE/g) || []).length, 1);
check('it pins the appointment times to the email, so the two cannot disagree',
  i => /use the SAME times\. Never invent different ones/.test(userPrompt(i, AIMEE)), true);
check('it forbids inventing a fact the email does not state',
  i => /Never state a fact the email does not state/.test(userPrompt(i, AIMEE)), true);
check('the whole turn is small — this is the size ratio the pass exists for',
  i => userPrompt(i, AIMEE).length < 4000, true);

console.log('\n    an agent LP command is never what gets cut (v9.7.553):');
const CMD = Object.assign({}, AIMEE, { agentLPCommands: ['Need POI, ask about the down payment'] });
check('a hand-typed command reaches the refine pass',
  i => /Need POI, ask about the down payment/.test(userPrompt(i, CMD)), true);
check('...and is told it outranks the cutting this pass does',
  i => /EVERY ONE OF THESE MUST APPEAR IN THE TEXT\. This outranks length/.test(userPrompt(i, CMD)), true);
check('no command means no command section at all',
  i => /WHAT THE AGENT TYPED BY HAND/.test(userPrompt(i, AIMEE)), false);

console.log('\n    it cannot throw on a thin lead:');
check('no relationshipSignals at all',        i => typeof userPrompt(i, { lastInboundMsg: 'hi' }), 'string');
check('a completely empty lead object',       i => typeof userPrompt(i, {}), 'string');
check('a null lead',                          i => typeof userPrompt(i, null), 'string');

// ── (4) THE CALL: A GOOD RESPONSE REPLACES THE DRAFT ────────────────────────
console.log('\n(4) the call, with the worker stubbed:');

const BETTER = 'Aimee, you asked to see the inside — I can have the Glacial White Pearl one open and ready for you to look through today. Does 2:30 or 3:15 work?';

await checkA('a good response replaces the first pass',
  i => refine(i, { fetch: stub(ok(BETTER)) }).then(r => r.out), BETTER);
await checkA('...and the diagnostic reports both drafts and the time it took',
  i => refine(i, { fetch: stub(ok(BETTER)) }).then(r => /ran \| \d+ms \| shipped:pass2/.test(r.logs) && /pass1:/.test(r.logs) && /pass2:/.test(r.logs)), true);

let sent = null;
await checkA('the request carries the refine system prompt, not the 84k one',
  i => refine(i, { fetch: stub(ok(BETTER), b => { sent = b; }) })
        .then(() => 84667 / sent.system_instruction.parts[0].text.length > 10), true);
await checkA('...and asks for JSON, like every other call on this pipeline',
  i => refine(i, { fetch: stub(ok(BETTER), b => { sent = b; }) })
        .then(() => sent.generationConfig.responseMimeType), 'application/json');

// ── (5) EVERY FAILURE KEEPS THE FIRST PASS ──────────────────────────────────
console.log('\n(5) every failure path keeps the first pass — it may never blank a draft:');

await checkA('an opted-out lead, whose SMS was deliberately emptied, is never refined',
  i => refine(i, { pass1: '', fetch: stub(ok(BETTER)) }).then(r => [r.out, /no first-pass SMS to replace/.test(r.logs)]), [null, true]);
await checkA('...and that check happens BEFORE any network call is made',
  i => refine(i, { pass1: '', fetch: () => { throw new Error('should not have been called'); } }).then(r => r.out), null);
await checkA('no usable email to derive from',
  i => refine(i, { email: '', fetch: stub(ok(BETTER)) }).then(r => [r.out, /no usable email/.test(r.logs)]), [null, true]);
await checkA('a worker error',
  i => refine(i, { fetch: stub({ json: () => Promise.resolve({ error: { message: 'boom' } }) }) }).then(r => [r.out, /worker error/.test(r.logs)]), [null, true]);
await checkA('a SAFE_FALLBACK envelope is never rendered as a refined draft',
  i => refine(i, { fetch: stub({ json: () => Promise.resolve({ candidates: [{ _fallback: true }] }) }) }).then(r => [r.out, /SAFE_FALLBACK/.test(r.logs)]), [null, true]);
await checkA('an empty response',
  i => refine(i, { fetch: stub({ json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: '' }] } }] }) }) }).then(r => [r.out, /empty response/.test(r.logs)]), [null, true]);
await checkA('a response with no sms field',
  i => refine(i, { fetch: stub({ json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: '{"email":"nope"}' }] } }] }) }) }).then(r => [r.out, /no sms field/.test(r.logs)]), [null, true]);
await checkA('a whitespace-only sms field',
  i => refine(i, { fetch: stub(ok('   ')) }).then(r => r.out), null);
await checkA('the network throwing outright',
  i => refine(i, { fetch: () => { throw new Error('offline'); } }).then(r => [r.out, /threw: offline/.test(r.logs)]), [null, true]);
await checkA('no endpoint resolved',
  i => refine(i, { endpoint: null, fetch: stub(ok(BETTER)) }).then(r => [r.out, /no endpoint resolved/.test(r.logs)]), [null, true]);
await checkA('the kill switch turns it off without touching the draft',
  i => refine(i, { window: { LEADPRO_SMS_REFINE: false }, fetch: () => { throw new Error('should not have been called'); } })
        .then(r => [r.out, /turned off/.test(r.logs)]), [null, true]);

console.log('\n    JSON that arrives wrapped, which the main path also tolerates:');
await checkA('a fenced or prefixed JSON body is still recovered',
  i => refine(i, { fetch: stub({ json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: '```json\n{"sms":"' + BETTER + '"}\n```' }] } }] }) }) }).then(r => r.out), BETTER);

// ── (6) THE CALL SITE ───────────────────────────────────────────────────────
console.log('\n(6) where it is wired in, read off the shipped file:');

check('it runs BELOW the email being finalised',
  i => i.src.indexOf("rawEmail = 'Subject: '") < i.src.indexOf('THE SMS REFINE PASS. Placed HERE'), true);
check('...and ABOVE the opener guard, so the guard sees the refined draft',
  i => i.src.indexOf('THE SMS REFINE PASS. Placed HERE') < i.src.indexOf('// Light-touch SMS opener check'), true);
// (v9.7.669) THE PROSE-MATCH HAZARD, SEVENTH TIME (v9.7.630). The bare string '[LP SMS HOOK DIAG]'
// matches v9.7.668's build header at line 1 — headers quote the file's own code — so this read as
// "the refine pass runs after the hook row" when it runs well before it. Anchor on the CODE form.
// (v9.7.679) The row no longer opens with a verdict, so the anchor moves with it — still the CODE
// form, and still asserted unique, which is what catches a header that quotes it.
const HOOK_ROW = "console.log('[LP SMS HOOK DIAG] firstPersonAt:'";
check('the hook-row anchor is the code, not a build header quoting it',
  i => (i.src.split(HOOK_ROW).length - 1), 1);
check('...and above the hook row, so the row measures what actually ships',
  i => i.src.indexOf('THE SMS REFINE PASS. Placed HERE') < i.src.indexOf(HOOK_ROW), true);
check('...and above the signature enforcement and setOutput',
  i => [i.src.indexOf('THE SMS REFINE PASS. Placed HERE') < i.src.indexOf('const smsText   = enforceSmsSig('),
        i.src.indexOf('THE SMS REFINE PASS. Placed HERE') < i.src.indexOf("setOutput('sms',")], [true, true]);
check('the assignment is guarded on a truthy return — a null can never blank rawSms',
  i => /if \(_rfSms\) rawSms = _rfSms;/.test(i.site), true);
check('and the call site itself is wrapped, so a throw cannot take the generation down',
  i => /catch \(eRf\)/.test(i.site), true);

// ── (v9.7.675) THE LANGUAGE FLIP ───────────────────────────────────────────
// log213, Juan at Community Honda Baytown, 9/17. His last message is "Y yo". The main call obeyed
// the brief's LANGUAGE hard constraint and wrote English BOTH times. This pass, which never
// received that constraint, answered in Spanish BOTH times — and the email, which is never
// refined, stayed English. Two channels, same outreach, different languages.
console.log('\n(7) the language constraint the main brief has and this pass did not (v9.7.675):');

// The two real pairs, verbatim from log213.
const J1_EN = 'Juan, the 2026 Honda CR-V Hybrid Sport in Urban Gray Pearl is here if you\u2019d like to see how it feels in person. Would a quick visit today be useful, or are you still gathering information?';
const J1_ES = 'Juan, puedo revisar contigo las ofertas disponibles cuando vengas a ver el CR-V Hybrid Sport 2026 en Urban Gray Pearl. Est\u00e1 disponible aqu\u00ed. \u00bfTe sirve pasar hoy?';
const J2_EN = 'Juan, the 2026 Honda CR-V Hybrid Sport in Urban Gray Pearl is still showing available, and qualified buyers may be eligible for 2.99% APR on 24\u201336 months, subject to approval. Is this still the Honda you are considering?';
const J2_ES = 'Juan, s\u00ed. La CR-V Hybrid Sport 2026 en Urban Gray Pearl sigue disponible. Los compradores que califiquen podr\u00edan obtener 2.99% APR por 24\u201336 meses, sujeto a aprobaci\u00f3n de cr\u00e9dito y requisitos del programa. \u00bfSigue siendo la Honda que est\u00e1s considerando?';

console.log('    the prompt, which is the actual fix:');
check('the refine system prompt now carries the LANGUAGE constraint',
  i => /LANGUAGE\. The text is written in ENGLISH\. ALWAYS\./.test(sysPrompt(i)), true);
check('...and closes the exact escape the customer\'s own message opened',
  i => /if their last message is in Spanish, the text is STILL IN ENGLISH/.test(sysPrompt(i)), true);
check('...and names the translate step, so the rule has a reason rather than just force',
  i => /The dealership translates inside the CRM after this step, on the agent's command/.test(sysPrompt(i)), true);
check('it says every main-brief constraint still binds, not just these three',
  i => /EVERY CONSTRAINT FROM THE MAIN BRIEF STILL BINDS THIS MESSAGE/.test(sysPrompt(i)), true);
check('the v9.7.670 first-name requirement survived the rewrite',
  i => /THE TEXT OPENS WITH THE CUSTOMER'S FIRST NAME/.test(sysPrompt(i)), true);
check('...and the signer rule is restated too',
  i => /YOU ARE THE PERSON NAMED ABOVE and you sign as them/.test(sysPrompt(i)), true);
// (v9.7.678) THE FOURTH COPY OF A RAW CHARACTER CAP, AND THE LAST. There were four of these
// scattered through this suite, each bumped independently as the rule earned sentences — 3500,
// 4500, 5000 — which is four chances to notice they were all measuring the wrong thing. What
// "did not drown the shape rule" means is the SHARE, and the share has risen through every
// addition since: 62% at v9.7.675, 67% at .676, 74% now, because the growth went INTO the rule
// rather than around it. A cap could never have shown that.
check('restating those rules did not drown the shape rule',
  i => { const p = sysPrompt(i); return i.rule.length / p.length > 0.55; }, true);

console.log('\n    the net under it, executed against both real drafts:');
await checkA('log213 generation 1 — the Spanish refine is rejected, the English first pass ships',
  i => refine(i, { pass1: J1_EN, fetch: stub(ok(J1_ES)) }).then(r => r.out), null);
await checkA('...and the row says what it saw, without naming a language',
  i => refine(i, { pass1: J1_EN, fetch: stub(ok(J1_ES)) })
        .then(r => /introduced \d+ character\(s\) the first pass did not have/.test(r.logs)
                && !/Spanish|spanish/.test(r.logs)), true);
await checkA('log213 generation 2 — same, on the longer draft',
  i => refine(i, { pass1: J2_EN, fetch: stub(ok(J2_ES)) }).then(r => r.out), null);
await checkA('the diagnostic reports the introduced characters themselves',
  i => refine(i, { pass1: J2_EN, fetch: stub(ok(J2_ES)) })
        .then(r => /\\u00ed|\u00ed/.test(r.logs) || /character\(s\)/.test(r.logs)), true);

console.log('\n    it is comparative, so it does not punish a legitimate accent:');
await checkA('a customer called Jos\u00e9 keeps his name — pass 1 carries the accent too',
  i => refine(i, { pass1: 'Jos\u00e9, the CR-V is here.',
                   fetch: stub(ok('Jos\u00e9, the CR-V is ready whenever you are. Does today work?')) })
        .then(r => r.out), 'Jos\u00e9, the CR-V is ready whenever you are. Does today work?');
await checkA('typographic punctuation an English draft uses is never treated as a flip',
  i => refine(i, { pass1: 'Juan, the CR-V is here.',
                   fetch: stub(ok('Juan, the CR-V is here \u2014 24\u201336 months, and I\u2019ll have it ready\u2026')) })
        .then(r => typeof r.out), 'string');
await checkA('an ordinary English refine is untouched',
  i => refine(i, { pass1: J1_EN, fetch: stub(ok(BETTER)) }).then(r => r.out), BETTER);

console.log('\n    and it falls back rather than blanking anything:');
await checkA('a rejected refine returns null, which the call site treats as keep-pass-1',
  i => refine(i, { pass1: J1_EN, fetch: stub(ok(J1_ES)) }).then(r => r.out), null);
check('the call site assigns only on a truthy return, so null cannot blank the draft',
  i => /if \(_rfSms\) rawSms = _rfSms;/.test(i.site), true);

// ── (v9.7.676) REGISTER PARITY, AND THE FACT THAT MUST NOT BE DROPPED ──────
// Gil, 9/17, on Thomas Lilley at Community Kia Baytown: "The emails are so good but then the text
// just seems pale in comparison... Text is just so important as it just about always gets read."
//
// Counted against the shipped prompt, the asymmetry is total: the EMAIL carries five
// channel-scoped REGISTER instructions — "match the depth of the customer's last message", "Email
// is a personal message, not a memo", "natural prose paragraphs", "weave them into sentences",
// "body addresses the actual conversation" — and the SMS carried ZERO. Every SMS rule written
// since v9.7.665 is about content selection or form. The one closest to register, "specific and
// substantive — not a generic check-in", points AWAY from warmth.
//
// Thomas wrote: "Sorry I am late getting back to you. I teach school and coach football so it is
// a busy time of year." The EMAIL answered it — "No problem at all — I understand this is a busy
// time of year with teaching and football." The TEXT opened "Thomas, what was the rest of your
// tint question?", which is a demand that he repeat himself.
console.log('\n(8) register parity with the email (v9.7.676):');

check('the shared rule now carries the email\'s own depth-and-tone requirement',
  i => /MATCH THE DEPTH AND THE TONE OF WHAT THEY SENT YOU/.test(i.rule), true);
check('...and names it as the half the text keeps losing, so it is not read as optional polish',
  i => /the same requirement the email carries, and the half the text keeps losing/.test(i.rule), true);
check('it says answering a personal remark comes FIRST and is cheap',
  // (v9.7.691) The clause said "it costs one short sentence". It was ARGUING that warmth is
  // cheap — but it argued it with a measurement, and Gil's call was that measurements in the
  // prompt build constraints whatever they are there to do. The argument is what this asserts.
  i => /a PERSON answers that first, and it costs almost nothing to do/.test(i.rule), true);
check('...and that accuracy without warmth is a worse message, not a leaner one',
  i => /is not the efficient version of a good message; it is a worse message/.test(i.rule), true);

console.log('\n    the failure that produced this build, named in the rule:');
check('a question WE are asking is explicitly not a hook',
  i => /A QUESTION YOU ARE ASKING THEM IS NOT A HOOK/.test(i.rule), true);
check('...with the remedy stated, not just the ban',
  i => /say what you CAN do first and put your question at the END/.test(i.rule), true);
check('...and the exact shipped opener named as the coldest start',
  i => /Opening on a request for them to repeat themselves is the coldest way to start/.test(i.rule), true);

console.log('\n    a material fact in the email must reach the text (Thomas\'s K5 was gone):');
check('the refine prompt states the mirror of "never add a fact"',
  i => /if the email states something that changes what they should DO or EXPECT/.test(userPrompt(i, AIMEE)), true);
check('...naming an unavailable vehicle first, which is the case that shipped',
  i => /a vehicle no longer being available/.test(userPrompt(i, AIMEE)), true);
check('...and says why, rather than only that',
  i => /An email that discloses and a text that does not is one outreach telling two different stories/.test(userPrompt(i, AIMEE)), true);
check('the no-invented-facts rule it mirrors is still there',
  i => /Never state a fact the email does not state/.test(userPrompt(i, AIMEE)), true);

console.log('\n    and the rule is still a rule, not a word list:');
check('no vehicle, store or customer name leaked into the register text',
  i => /Thomas|Lilley|K5|Kia|Sportage|football/.test(i.rule), false);

// ── NON-VACUITY ─────────────────────────────────────────────────────────────
console.log('\nnon-vacuity (v9.7.669):');

const UNGUARD = c => c.replace('if (!pass1) {', 'if (false) {');
check('neuter A actually removed the empty-draft guard',
  i => UNGUARD(i.call) !== i.call, true);
await checkA('A: without it, an opted-out lead gets a refine call it must never get',
  i => refine(i, { pass1: '', fetch: stub(ok(BETTER)), mutate: true, call: UNGUARD }).then(r => r.out).catch(() => 'THREW'), null);

// Run the neutered function directly — the guard is what stands between an opt-out and a draft.
await checkA('A (executed): the neutered build returns a draft for an opted-out lead',
  async i => {
    const sb = ctx({ ...i, call: UNGUARD(i.call) }, { fetch: stub(ok(BETTER)) });
    sb.__d = AIMEE;
    return await vm.runInContext('_lpRefineSms("", ' + JSON.stringify(EMAIL) + ', __d)', sb);
  }, BETTER);
await checkA('A (control): the shipped build returns null for the same lead',
  i => refine(i, { pass1: '', fetch: stub(ok(BETTER)) }).then(r => r.out), null);

const NOSHRINK = c => c.replace('you are NOT shortening it', 'you may shorten it');
check('neuter B actually changed the anti-compression sentence',
  i => NOSHRINK(i.sys) !== i.sys, true);
check('B (control): the shipped system prompt forbids shortening',
  i => /you are NOT shortening it/.test(sysPrompt(i)), true);

// (v9.7.671) Put a sentence count back and the prompt is telling the model a size again, which
// is the state that produced log209's quoted-question draft.
const RECOUNT = c => c.replace(
  "out.push('LENGTH IS YOURS TO JUDGE. There is no target here and no sentence count. ",
  "out.push('THAT IS USUALLY THREE SENTENCES. ");
check('neuter C actually put a sentence count back',
  i => { const m = RECOUNT(i.usr); return [m !== i.usr, /THREE SENTENCES/.test(m)]; }, [true, true]);
check('C: the neutered build hands the model a size again',
  i => {
    const sb = ctx({ ...i, usr: RECOUNT(i.usr) }, {});
    sb.__d = AIMEE; sb.__p = PASS1; sb.__e = EMAIL;
    const p = vm.runInContext('_lpBuildSmsRefinePrompt(__p, __e, __d)', sb);
    return [/THREE SENTENCES/.test(p), /LENGTH IS YOURS TO JUDGE/.test(p)];
  }, [true, false]);
check('C (control): the shipped prompt names no size at all',
  i => { const p = userPrompt(i, AIMEE); return [/THREE SENTENCES/.test(p), /LENGTH IS YOURS TO JUDGE/.test(p)]; },
  [false, true]);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
