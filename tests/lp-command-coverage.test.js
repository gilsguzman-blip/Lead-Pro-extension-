#!/usr/bin/env node
'use strict';
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
  const smsRuleLine = (src.match(/'SMS: A real text message[^\n]*'/) || [''])[0];

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

check('the rule states the command is never what gets cut',
  i => /AGENT LP COMMAND IS NEVER WHAT GETS CUT/.test(i.smsRule),
  true);

check('it names what to cut instead rather than only forbidding',
  i => /Cut somewhere else first/.test(i.smsRule) && /incentive mention/.test(i.smsRule),
  true);

check('the pre-existing SMS rules are still intact',
  i => /Same specific hook, same quality, same framing/.test(i.smsRule)
    && /End with the stacked signature/.test(i.smsRule)
    && /No dash, no comma, no name in the message body/.test(i.smsRule),
  true);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
