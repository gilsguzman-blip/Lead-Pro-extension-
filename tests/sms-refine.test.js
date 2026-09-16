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
  i => /joins two clauses with "while"/.test(sysPrompt(i)) && /THE HOOK IS NEVER WHAT GETS CUT/.test(sysPrompt(i)), true);

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
check('it is SMALL — the whole point is that the rule is not drowned',
  i => sysPrompt(i).length < 3500, true);
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
  i => /do not write it again with words removed .* is the exact failure this pass exists to prevent/.test(userPrompt(i, AIMEE)), true);

// ── (v9.7.670) THE FLOOR, NOT ONLY THE CEILING ─────────────────────────────
// Gil, 9/16, on log208: "like the concept but seems rather short. Maybe too constrictive on
// length parameters we built." Four instructions pointed at less and nothing pushed back, so
// the refined draft answered her question, asked for a time, and gave her no reason to come.
console.log('\n    (v9.7.670) a floor as plain as the ceiling:');
check('the lead is named as a LEAD, not as the whole message',
  i => /That is what the text LEADS on/.test(userPrompt(i, AIMEE)), true);
check('one supporting reason is REQUIRED, not merely permitted',
  i => /THEN GIVE THEM ONE REASON/.test(userPrompt(i, AIMEE)), true);
check('...and it says what that reason is for',
  i => /makes replying easy or makes the visit worth making/.test(userPrompt(i, AIMEE)), true);
check('the floor is stated in sentences, agreeing with the shape rule rather than undercutting it',
  i => /THAT IS USUALLY THREE SENTENCES, AND SHORTER IS NOT AUTOMATICALLY BETTER/.test(userPrompt(i, AIMEE)), true);
check('...and it names log208\'s draft as the failure on that side',
  i => /answers the question and jumps straight to a time has cut too much/.test(userPrompt(i, AIMEE)), true);
check('it says outright that cutting is not the goal',
  i => /Cutting is not the goal/.test(userPrompt(i, AIMEE)), true);
check('the absolute "nothing else" that produced the two-sentence draft is gone',
  i => /Carry that one thing and nothing else/.test(userPrompt(i, AIMEE)), false);
check('...while the anti-agenda instruction it was doing double duty for survives',
  i => /do not carry its second AND third points/.test(userPrompt(i, AIMEE)), true);
check('the first-name opener now reaches this pass from both sides',
  i => [/open with their first name/.test(userPrompt(i, AIMEE)),
        /The text OPENS with the customer's first name/.test(sysPrompt(i))], [true, true]);
check('...and the system prompt says a nameless refine is not a refine',
  i => /A refined text that has dropped the name has not been refined/.test(sysPrompt(i)), true);
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
        .then(() => sent.system_instruction.parts[0].text.length < 3500), true);
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
const HOOK_ROW = "console.log('[LP SMS HOOK DIAG] the text reaches for: '";
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

// (v9.7.670) Put the absolute back and the prompt points only one way again, which is the
// state that produced log208's two-sentence draft.
const NOFLOOR = c => c
  .replace(/out\.push\('THEN GIVE THEM ONE REASON[^;]*\);/s, '')
  .replace(/out\.push\('THAT IS USUALLY THREE SENTENCES[^;]*\);/s, '');
check('neuter C actually removed both floor statements',
  i => { const m = NOFLOOR(i.usr); return [m !== i.usr, /THREE SENTENCES/.test(m), /ONE REASON/.test(m)]; },
  [true, false, false]);
check('C: with the floor gone, every remaining instruction points at less',
  i => {
    const sb = ctx({ ...i, usr: NOFLOOR(i.usr) }, {});
    sb.__d = AIMEE; sb.__p = PASS1; sb.__e = EMAIL;
    const p = vm.runInContext('_lpBuildSmsRefinePrompt(__p, __e, __d)', sb);
    return [/ONE thing/.test(p), /second AND third points/.test(p), /SHORTER IS NOT AUTOMATICALLY BETTER/.test(p)];
  }, [true, true, false]);
check('C (control): the shipped prompt carries both directions at once',
  i => { const p = userPrompt(i, AIMEE); return [/ONE thing/.test(p), /SHORTER IS NOT AUTOMATICALLY BETTER/.test(p)]; },
  [true, true]);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
