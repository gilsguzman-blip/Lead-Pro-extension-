#!/usr/bin/env node
'use strict';
// (v9.7.597) Registered BEFORE anything can throw. A suite that dies during module
// evaluation prints nothing, and nothing reads exactly like 'asserted nothing wrong'.
// See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('lp-command-coverage.test.js');

/**
 * lp-command-coverage.test.js — v9.7.554.
 *
 * KNOWN GAP, NOT A DATA BUG. Amber Johnson (Community Kia Baytown, dealerId 6190,
 * lead 2070428771, 8/20). The agent wrote a three-part LP command:
 *
 *   "Need POI, How much money as initial investment is the most they can use,
 *    What vehicle and are they flexible."
 *
 * The pipeline handled it correctly end to end — log117 line 1448 shows it parsed once
 * ([Lead Pro] LP commands found: 1) and the delivered prompt carries it three times with
 * highest-priority framing. The EMAIL asked all three. The SMS asked two: the
 * proof-of-income clause was what lost the length cut.
 *
 * Nothing in the file could see that, because nothing compared what each channel said
 * against what the command asked for. Two changes, both verified here:
 *   (1) a MULTI-ASK MANDATE in the prompt, gated on the command genuinely having >1 clause
 *   (2) [LP COMMAND COVERAGE DIAG] — rough per-clause keyword coverage, sms vs email vs vm
 *
 * The coverage check is DELIBERATELY not a gate. It is a keyword match with a dealership
 * shorthand expansion (POI -> proof of income), so paraphrase sharing no keyword reads as a
 * miss. The SMS-vs-EMAIL delta is the signal; on Amber it is 2/3 vs 3/3 and it names the POI
 * clause outright.
 *
 * Strings below are the REAL rawSms/rawEmail from log117 lines 1600-1601, verbatim.
 * All blocks are sliced out of each SHIPPED popup.js. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2);
if (!BUILDS.length) { console.error('usage: lp-command-coverage.test.js <popup.js> [popup.js...]'); process.exit(2); }

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');

  const ha = src.indexOf('var LP_CMD_STOPWORDS =');
  const hb = src.indexOf("// ── (v9.7.552) LEAD PRO'S OWN SCAFFOLD");
  if (ha < 0 || hb < 0 || hb <= ha) throw new Error('could not locate the coverage helpers in ' + file);

  const sandbox = { console: { log() {} } };
  vm.createContext(sandbox);
  vm.runInContext(src.slice(ha, hb), sandbox);

  const cover = vm.runInContext('(function(c,t){ return _lpCommandCoverage(c,t); })', sandbox);
  const term  = vm.runInContext('(function(h,t){ return _lpCmdTermHit(h,t); })', sandbox);

  // The MULTI-ASK MANDATE block out of buildUserPrompt, wrapped with just the scope it reads.
  const ma = src.indexOf('    // (v9.7.554) MULTI-ASK MANDATE');
  const mb = src.indexOf('    if(lpHasUrl) {', ma);
  if (ma < 0 || mb < 0 || mb <= ma) throw new Error('could not locate the multi-ask mandate in ' + file);
  const mandate = vm.runInContext(
    '(function(data){ var lines = [];\n' + src.slice(ma, mb) + '\n return lines.join("\\n"); })', sandbox);

  // The SMS format rule as shipped in the system prompt.
  // (v9.7.665) The prefix is now upper-case. Note the trap this fell into first: when the pattern
  // stopped matching, this returned '' and every NEGATIVE assertion below passed vacuously against
  // an empty string. A silent empty extraction is the quiet cousin of the extraction that throws,
  // which tests/lib/guarded-impls.js exists to catch. Asserted non-empty below.
  const smsRuleLine = (src.match(/'SMS: A REAL TEXT MESSAGE[^\n]*'/) || [''])[0];

  return { name: path.basename(path.dirname(file)), cover, term, mandate, smsRule: smsRuleLine };
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

// ── Amber's real artifacts, verbatim from log117 ───────────────────────────────
const CMD = 'Need POI, How much money as initial investment is the most they can use, What vehicle and are they flexible.';

const REAL_SMS = 'Amber, I don’t want to keep sending repeated Seltos messages. Are AWD and Iceberg Green '
  + 'must-haves, and what is the most you want to use initially? I can have the right options and paperwork '
  + 'ready when you arrive.\nJordyn\nCommunity Kia Baytown\n281-837-3630';

const REAL_EMAIL = 'Subject: AWD Seltos and Iceberg Green\n\nHi Amber,\n\nI know you have received a few messages '
  + 'about the 2027 Kia Seltos, so I’ll keep this simple. Are AWD and Iceberg Green must-haves, or are you '
  + 'flexible? Also, what is the most you want to use as your initial investment, and what can you provide for '
  + 'proof of income?\n\nOnce I have that, I can verify the right Seltos configuration and have the options and '
  + 'paperwork ready so your visit is efficient. You can reply directly to this email.\n\nJordyn Guzman\n'
  + 'Internet Sales Coordinator\nCommunity Kia Baytown\n281-837-3630';

console.log('\nv9.7.554 — a multi-part LP command must survive the SMS length cut');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

console.log('Amber Johnson — the real delivered drafts:');

check('the command splits into the three asks the agent wrote',
  i => i.cover(CMD, '').total,
  3);

check('EMAIL covered all three — this is the channel that was right',
  i => { const c = i.cover(CMD, REAL_EMAIL); return c.covered + '/' + c.total; },
  '3/3');

check('SMS covered two of three — the reported symptom, reproduced',
  i => { const c = i.cover(CMD, REAL_SMS); return c.covered + '/' + c.total; },
  '2/3');

check('and the uncovered clause is the POI ask specifically, not a different one',
  i => i.cover(CMD, REAL_SMS).clauses.filter(c => !c.covered).map(c => c.clause),
  ['Need POI']);

check('the SMS/EMAIL delta names exactly the dropped clause',
  i => {
    const s = i.cover(CMD, REAL_SMS), e = i.cover(CMD, REAL_EMAIL);
    return s.clauses.filter((c, n) => !c.covered && e.clauses[n].covered).map(c => c.clause);
  },
  ['Need POI']);

check('the money clause reads covered in the SMS via "initially"',
  i => i.cover(CMD, REAL_SMS).clauses[1].hits,
  ['initial', 'investment']);

check('the vehicle clause reads covered in the SMS via the must-have alias',
  i => i.cover(CMD, REAL_SMS).clauses[2].hits,
  ['flexible']);

// ── The boundary rule that makes the POI miss detectable at all ────────────────
console.log('\nshort-token boundaries — without these the POI miss reads as covered:');

check('"poi" does NOT match inside "appointment"',
  i => i.term(' can we set an appointment ', 'poi'), false);
check('"poi" does NOT match inside "point"',
  i => i.term(' good point ', 'poi'), false);
check('"poi" DOES match as its own word',
  i => i.term(' send your poi over ', 'poi'), true);
check('"dl" does NOT match inside "idle"',
  i => i.term(' the engine is idle ', 'dl'), false);
check('a long token still matches its own suffix — "initial" in "initially"',
  i => i.term(' use initially ', 'initial'), true);
check('a multi-word alias matches as a phrase',
  i => i.term(' what can you provide for proof of income ', 'proof of income'), true);

check('an SMS that DOES ask for POI reads 3/3 — the fix has somewhere to land',
  i => { const c = i.cover(CMD, REAL_SMS.replace('initially?', 'initially, and what can you send for proof of income?')); return c.covered + '/' + c.total; },
  '3/3');

check('POI written as the bare abbreviation also reads covered',
  i => i.cover('Need POI', 'Amber, can you send your POI when you get a chance?').covered,
  1);

// ── Robustness: this runs on every generation with a command ───────────────────
console.log('\nthe scan is safe on every shape it will meet in production:');

check('empty command yields no clauses',    i => i.cover('', REAL_SMS).total, 0);
check('empty channel text covers nothing',  i => i.cover(CMD, '').covered, 0);
check('null inputs do not throw',           i => i.cover(null, null).total, 0);
check('a single-ask command is one clause', i => i.cover('Ask about the trade', '').total, 1);
check('trailing punctuation is not a clause', i => i.cover('Need POI,', '').total, 1);
check('a regex-special command does not throw',
  i => i.cover('Ask about the 2027 (X-Line) [AWD] + $3,000 down', 'we can talk about $3,000 down').total > 0, true);
check('a URL in the command does not split into junk clauses',
  i => i.cover('Send them https://a.example/x?y=1 and confirm receipt', '').total, 1);

// ── The prompt-side mandate ────────────────────────────────────────────────────
console.log('\nthe MULTI-ASK MANDATE renders only when it is warranted:');

check('a three-part command renders the mandate and states the count',
  i => {
    const out = i.mandate({ agentLPCommands: [CMD] });
    return { fires: /MULTI-ASK MANDATE/.test(out), count: (out.match(/contains (\d+) distinct asks/) || [])[1] };
  },
  { fires: true, count: '3' });

check('it names all three channels, so the email cannot stand in for the text',
  i => {
    const out = i.mandate({ agentLPCommands: [CMD] });
    return /in the SMS, in the email, AND in the voicemail/.test(out) && /may only ever read the text/.test(out);
  },
  true);

check('it says plainly what may be cut instead',
  i => /comparable vehicle, an incentive, an appointment time/.test(i.mandate({ agentLPCommands: [CMD] })),
  true);

check('a single-ask command adds NO extra prompt text',
  i => i.mandate({ agentLPCommands: ['Ask if they still want the Telluride'] }),
  '');

check('a two-part command does fire — the gate is >1, not >2',
  i => /MULTI-ASK MANDATE/.test(i.mandate({ agentLPCommands: ['Need POI, and what is their budget'] })),
  true);

check('no commands at all renders nothing',
  i => i.mandate({ agentLPCommands: [] }),
  '');

// ── The SMS format rule ────────────────────────────────────────────────────────
console.log('\nthe shipped SMS format rule now says length may not eat the command:');

check('the SMS rule was actually extracted — an empty slice passes every negative test',
  i => i.smsRule.length > 400,
  true);

check('the rule states the command is never what gets cut',
  i => /AGENT LP COMMAND IS NEVER WHAT GETS CUT/.test(i.smsRule),
  true);

check('it names what to cut instead rather than only forbidding',
  i => /WHAT GETS DROPPED, IN THIS ORDER/.test(i.smsRule) && /an incentive mention/.test(i.smsRule),
  true);

check('...and the carve-out is stated as outranking that list',
  i => /ONE EXCEPTION, AND IT OUTRANKS EVERYTHING ABOVE/.test(i.smsRule),
  true);

check('the signature rules are still intact, word for word',
  i => /End with the stacked signature/.test(i.smsRule)
    && /No dash, no comma, no name in the message body/.test(i.smsRule),
  true);

// ── (v9.7.665) A TEXT IS A SHAPE, NOT A SHORTENED EMAIL ────────────────────────
// Gil, 9/16, on Aimee Williams: "The Email was much better than the Text message. We need to work
// on the text messaging content." The email opened on HER; the SMS opened on US and crammed three
// logistics items into one thirty-word sentence closed with a semicolon.
//
// The rule was the cause. It said "not a compressed email" and then, in five of its seven
// sentences, taught compression. v9.7.553 had already written in its own header that this wording
// "tells the model to compress" and fixed only the LP-command half.
console.log('\nthe rule teaches a shape rather than a subtraction (v9.7.665):');

check('the old compression framing is gone',
  i => /Just written at text length|WRITING AT TEXT LENGTH IS A CUT|Same specific hook, same quality/.test(i.smsRule),
  false);
// (v9.7.672) THIS ASSERTION CHANGED DELIBERATELY, AND IT WAS PINNING THE DEFECT.
// Gil, 9/16, on log210: "I think the 'two to three sentences' directive is killing this."
// v9.7.665 wrote a numeric cap on both axes -- "an email can carry three things, a text carries
// the ONE" and "two or three short sentences" -- and then, four sentences later in the SAME
// paragraph, forbade the constructions a model reaches for when it has more to say than budget:
// a semicolon, three items off "and", two clauses joined with "while". The rule was creating the
// pressure it then named as a failure. Both caps are gone; what replaces them is a rhythm, not a
// size. The anti-agenda purpose the first cap served survives in "an email works through an
// agenda, a text does not have one".
check('a text leads rather than working an agenda — and neither half is a number any more',
  i => [/An email works through an agenda\. A text does not have one/.test(i.smsRule),
        /THERE IS NO SENTENCE COUNT AND NO LENGTH TO HIT/.test(i.smsRule),
        /two or three short sentences|can carry three things/.test(i.smsRule)],
  [true, true, false]);
check('...and the rule now says SPLIT where it used to leave only welding available',
  i => /ONE THOUGHT PER SENTENCE — if two thoughts have to be joined with "and", "while" or a semicolon, they are two sentences, not one/.test(i.smsRule),
  true);
check('it says to open on them, not on us',
  i => /Open on something THEY said or want, never on what YOU are going to do/.test(i.smsRule),
  true);
check('the example names no vehicle, so it cannot be copied onto the wrong lead',
  i => /Sportage|Seltos|Accord|Prelude|CR-V/.test(i.smsRule),
  false);
check('the hook is put out of reach of the cut',
  i => /THE HOOK IS NEVER WHAT GETS CUT/.test(i.smsRule) && /cut exactly the wrong half/.test(i.smsRule),
  true);

// The read-it-back test, run against the two drafts that produced this build.
const SHIPPED_SMS   = 'Aimee, I can have the 2026 Sportage ready for you and get your 2022 Seltos appraised while finance gives you a clear approval answer; can you make it in today?';
const SHIPPED_EMAIL = 'The 2026 Sportage you liked gives you the added space you wanted over your 2022 Seltos. I can have it ready for you, complete the trade appraisal, and have finance review everything together so you get a clear approval answer rather than a guess by text.';
// The three shapes the rule now names, applied per sentence as the rule instructs.
const failsReadBack = t => String(t).split(/(?<=[.!?])\s+/).filter(Boolean).map(sen => ({
  semicolon: /;/.test(sen),
  threeOffAnd: (sen.match(/\band\b/g) || []).length >= 1 && (sen.match(/,/g) || []).length >= 1 && sen.split(/\s+/).length > 25,
  whileClause: /\bwhile\b/.test(sen),
}));

check('the rule names all three shapes',
  i => /needs a semicolon/.test(i.smsRule) && /hangs three items off "and"/.test(i.smsRule)
    && /joins two clauses with "while"/.test(i.smsRule),
  true);
check('the SMS that shipped fails the read-back on all three',
  () => { const r = failsReadBack(SHIPPED_SMS)[0]; return [r.semicolon, r.threeOffAnd, r.whileClause]; },
  [true, true, true]);
check('the EMAIL that shipped passes it — the rule is not just banning long sentences',
  () => failsReadBack(SHIPPED_EMAIL).some(r => r.semicolon || r.whileClause),
  false);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
