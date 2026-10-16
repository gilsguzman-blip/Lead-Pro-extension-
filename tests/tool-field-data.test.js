#!/usr/bin/env node
'use strict';
// Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('tool-field-data.test.js');

/**
 * tool-field-data.test.js — v9.7.637. A MACHINE FIELD WAS QUOTED TO THE MODEL AS THE CUSTOMER'S
 * OWN SENTENCE, AND THE MODEL SAID IT BACK TO HER.
 *
 * Rebekah Fontenot, Community Honda Lafayette, 2026 Pilot Elite, 9/4 (log179). Her entire
 * "inquiry" was this, verbatim, and she typed none of it:
 *
 *   TradeInVehicleComment=Net trade-in: $-3200, trade-in value: $36800, remaining balance: $40000.00;
 *
 * The Click & Go tool wrote those fields. It reached the prompt under the header
 *
 *   "CUSTOMER'S INQUIRY — the customer's own words when they submitted this lead.
 *    This is what they actually asked for; address it directly:"
 *
 * and the model did precisely as instructed. Her delivered email, verbatim from log179:
 *
 *   "The online estimate shows about $3,200 in negative equity, but I don't want you relying
 *    on an estimate alone..."
 *
 * 1 of 456 captured drafts names negative equity to a customer, and it is the one number Gil had
 * explicitly not decided whether to say out loud. The other six leads carrying the same field
 * shape were all positive equity, so nobody noticed.
 *
 * TWO THINGS WERE WRONG AND ONLY ONE IS A STRATEGY QUESTION. Quoting a machine field as her
 * sentence is false whatever we decide about equity — she did not write it and has never raised
 * the subject. That is the defect this suite pins. Whether to deliberately SURFACE negative
 * equity is a separate call, still Gil's, and would be an added directive rather than a change
 * to this one.
 *
 * SHAPE, NOT FIELD NAME. A "TradeInVehicleComment" blocklist is enumeration, and this file has
 * been bitten by enumerating observed shapes more often than by anything else (v9.7.552/553/554;
 * v9.7.555 wrote the rule down). The gate tests the STRING.
 *
 * THE FIGURES ARE NOT HIDDEN. Her trade is real and the VR deal block does not carry the numbers
 * (v9.7.635 recorded that gap), so they are re-emitted under a header that says whose they are.
 *
 * Executes the SHIPPED predicate, lifted out of inlineScraper. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: tool-field-data.test.js <popup.js> [popup.js...]'); process.exit(2); }

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const bail = (m) => require('./lib/fatal-guard.js').bail('tool-field-data.test.js', m);

// Rebekah's real string, from log179 line 194.
const REBEKAH = 'TradeInVehicleComment=Net trade-in: $-3200, trade-in value: $36800, remaining balance: $40000.00;';
// The other six captures carrying the same shape — all positive equity, all equally not her words.
const POSITIVE = [
  'TradeInVehicleComment=Net trade-in: $7800, trade-in value: $7800, remaining balance: $0.00;',
  'TradeInVehicleComment=Net trade-in: $7200, trade-in value: $7200, remaining balance: $0.00;',
  'TradeInVehicleComment=Net trade-in: $12900, trade-in value: $12900, remaining balance: $0.00;'
];

function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('    function _lpIsToolFieldBlob(s) {');
  if (a < 0) bail('_lpIsToolFieldBlob not in ' + file + ' — THE SUITE DID NOT LOAD');
  const b = src.indexOf('\n    }', a);
  if (b < 0) bail('_lpIsToolFieldBlob has no close in ' + file);
  const sb = { String };
  vm.createContext(sb);
  vm.runInContext(src.slice(a, b + 6), sb);

  // Lift the GATE ITSELF, not just the predicate, and run it. A source-position assertion says
  // the line is present; only executing it says the line still does anything. Disabling the gate
  // (`if (false && ...)`) leaves every text-match assertion green, which is precisely the vacuous
  // shape this repo has been caught by before — so the wiring is proven by behaviour here.
  const ga = src.indexOf('          if (extractedCustQ && _lpIsToolFieldBlob(extractedCustQ)) {');
  const gateSrc = ga < 0 ? null : src.slice(ga, src.indexOf('\n          }', ga) + 12);
  if (!gateSrc) bail('the tool-field gate is not on the extraction path in ' + file + ' — THE SUITE DID NOT LOAD');
  vm.runInContext(
    'function _lpRunGate(q) { var extractedCustQ = q, _lpToolFieldData = "";\n'
    + gateSrc + '\n  return { inquiry: extractedCustQ, stashed: _lpToolFieldData }; }', sb);

  return { src, isBlob: vm.runInContext('_lpIsToolFieldBlob', sb), gate: vm.runInContext('_lpRunGate', sb) };
}

for (const file of BUILDS) {
  const B = load(file);
  // Every source-position assertion runs against comment-stripped code — this file's build
  // headers quote its own directives verbatim, which has produced seven false greens since
  // v9.7.563.
  const code = B.src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  console.log('\n' + path.relative(process.cwd(), file) + ' — the tool wrote it, not the customer');

  // ── THE STRING FROM THE INCIDENT ───────────────────────────────────────────
  console.log('\nRebekah\'s lead:');
  check('her "inquiry" is recognised as tool output', B.isBlob(REBEKAH), true);
  for (const s of POSITIVE)
    check('  so is the same shape with positive equity: ' + JSON.stringify(s.slice(24, 44)), B.isBlob(s), true);

  // ── WHAT A CUSTOMER ACTUALLY WRITES ────────────────────────────────────────
  // Real inbound text from the captured logs and from prior incidents in this repo. None of it
  // may be refused: a false positive here silently deletes a customer's actual question.
  console.log('\nreal customer messages are never mistaken for tool output:');
  const REAL = [
    "I'm interested in this 2018 Ford Expedition and I'd like to know if it's still available",
    'we are planning to purchase a new chevy silverado in the next few weeks',
    'Do you still have the Blueprint CR-V with graphite interior?',
    'trading in my 2018 Audi Q5, what can you give me for it',
    'does the up to $2000 in benefits apply to used?',
    'Sequoia',
    'R',
    'what is my out the door price on the 2026 Pilot Elite',
    'I can only come in on weekends, I work late during the week',
    'Net trade-in was about $7,800 when I checked online',
    // v9.7.555 named this exact hazard in its own header — a customer whose genuine message is
    // terse and label-shaped. A colon-counting heuristic (the obvious wrong implementation, and
    // the one v9.7.555 used for CALL metadata, where it was right) eats it. The field-shape gate
    // does not, because she never typed "Identifier=". Without this case the block below is
    // vacuous: every other fixture survives a wrong implementation by accident.
    'Trade: 2019 Durango. Timeframe: 2 weeks.',
    'Budget: 400 a month. Down: 3000. Looking at: CR-V or Pilot'
  ];
  for (const s of REAL)
    check('  kept: ' + JSON.stringify(s.slice(0, 46)), B.isBlob(s), false);

  // ── THE BOUNDARY, STATED AS A RULE RATHER THAN A LIST ──────────────────────
  // Two signals, and the opener is required for both. This is the v9.7.555 shape, deliberately.
  console.log('\nthe gate is a shape test, and it fails safe toward keeping the words:');
  check('an opening Identifier= is required',
    B.isBlob('Net trade-in: $-3200, trade-in value: $36800;'), false);
  check('  ...so a sentence that merely contains "=" is kept',
    B.isBlob('is the price = the online price you have listed?'), false);
  check('one key and no terminator is NOT enough (a person could type it)',
    B.isBlob('Trade=my 2019 Durango'), false);
  check('  ...but a trailing semicolon is',
    B.isBlob('Trade=my 2019 Durango;'), true);
  check('  ...and so is a second key',
    B.isBlob('Trade=2019 Durango Mileage=64000'), true);
  check('a short key is not a key', B.isBlob('a=1;'), false);
  check('the next tool\'s fields are caught too, whatever they are called',
    B.isBlob('LeaseMaturityData=Residual: $18400; Payoff: $19100;'), true);
  check('  ...and a wholly unfamiliar one',
    B.isBlob('WidgetPayload_v2=alpha; beta; gamma;'), true);

  // ── (v9.7.638) THE SECOND SHAPE, AND THE SECOND PATH ───────────────────────
  // v9.7.637 shipped saying "the gate is deliberately conservative ... if a real tool ever emits
  // that shape it will slip through". It did, the next morning, through a rescue with its own
  // separate strip chain. Rebecca Caplan's lead submission, presented under the strongest
  // attribution language in the file — "verbatim from their lead submission — treat as their own
  // words, and as the most reliable statement of intent on this lead".
  const REBECCA = 'By: System CUSTOMER INSIGHTS- ; CustomerComment : Preferred Contact Method*: Text '
    + 'Honda Dealercode: 208543 Vehicle Prices: Price: 17510 Dealer Doc Fee: 225 Final Price: 17735 '
    + 'Price: 17735 Honda Source Id: 90508';
  console.log('\nRebecca\'s lead — the colon-shaped field list:');
  check('recognised as tool output', B.isBlob(REBECCA), true);
  check('  ...and it carried dealer prices into a prompt that forbids quoting a total',
    /Final Price: 17735/.test(REBECCA), true);
  check('the field list alone is enough, without the System stamp',
    B.isBlob('Honda Dealercode: 208543 Vehicle Prices: Price: 17510 Dealer Doc Fee: 225'), true);
  check('the System stamp alone is enough, without three fields',
    B.isBlob('By: System lead received'), true);
  check('CUSTOMER INSIGHTS is a system marker wherever it sits',
    B.isBlob('something something CUSTOMER INSIGHTS- ; more'), true);

  // THE RULE IS PUNCTUATION, NOT A FIELD-NAME LIST. Enumerating "Dealercode|Source Id|Doc Fee" is
  // the trap this file keeps falling into (v9.7.552/553/554/555). Prose has sentences; a record
  // does not. These two cases are what stop the rule from eating a terse human message, and
  // v9.7.555's own header named the first one as the hazard.
  console.log('\nthree colon pairs is a record only when the sentences are missing:');
  check('a terse but PUNCTUATED customer message is kept',
    B.isBlob('Trade: 2019 Durango. Timeframe: 2 weeks. Budget: 400 a month'), false);
  check('  ...and so is a three-pair one with periods',
    B.isBlob('Budget: 400 a month. Down: 3000. Looking at: CR-V or Pilot'), false);
  check('two unpunctuated pairs are not yet a record',
    B.isBlob('Color: silver Trim: EX-L'), false);
  check('  ...but three are', B.isBlob('Color: silver Trim: EX-L Mileage: 40000'), true);
  check('the next vendor\'s colon fields are caught with no list to update',
    B.isBlob('Widget Campaign Id: 44 Session Ref: aa91 Visitor Score: 8'), true);

  console.log('\nthe leadIntakeReq rescue is routed through the SAME predicate:');
  check('it consults the shared gate rather than a third strip chain',
    /if \(_lpIsToolFieldBlob\(_lir\)\) \{/.test(code), true);
  check('  ...and refuses BEFORE the substance gate can accept it',
    code.indexOf('if (_lpIsToolFieldBlob(_lir)) {') < code.indexOf('} else if (_lir.length >= 40'), true);
  check('  ...the substance gate is now the else branch, not the first test',
    /\} else if \(_lir\.length >= 40/.test(code), true);
  check('the refusal is logged with what was refused',
    /\[LP INTAKE REQ DIAG\] REFUSED/.test(B.src), true);
  // The word that let it through: "Price:" is on the concrete-intent list the substance gate uses
  // to prove a human wrote something specific. A machine field list containing "Price" cleared it.
  check('the substance gate still lists "price" — it was doing what it was told',
    /trade\|lease\|finance\|payment\|quote\|price\|/.test(code), true);
  check('there is still exactly one definition of the predicate',
    (B.src.match(/function _lpIsToolFieldBlob\(/g) || []).length, 1);

  console.log('\nit never throws:');
  check('empty', B.isBlob(''), false);
  check('null', B.isBlob(null), false);
  check('undefined', B.isBlob(undefined), false);
  check('whitespace', B.isBlob('   '), false);

  // ── THE WIRING ─────────────────────────────────────────────────────────────
  // The predicate is worthless if it is not on the path. v9.7.618's lesson: IS IT WIRED.
  // ── THE GATE, EXECUTED ─────────────────────────────────────────────────────
  // Running the shipped gate rather than matching its text: a disabled branch keeps every
  // source-position assertion green, and this repo has shipped that false green before.
  console.log('\nrunning the shipped gate on the extraction path:');
  const gR = B.gate(REBEKAH);
  check('Rebekah\'s blob leaves the inquiry slot empty', gR.inquiry, '');
  check('  ...and is stashed intact, every figure preserved', gR.stashed, REBEKAH);
  check('  ...so the "customer\'s own words" header has nothing to carry', !gR.inquiry, true);
  const gC = B.gate("I'm interested in this 2018 Ford Expedition and I'd like to know if it's still available");
  check('a real inquiry passes through untouched',
    gC.inquiry, "I'm interested in this 2018 Ford Expedition and I'd like to know if it's still available");
  check('  ...and nothing is stashed for it', gC.stashed, '');
  const gE = B.gate('');
  check('an empty slot stays empty', gE.inquiry, '');
  check('  ...and stashes nothing', gE.stashed, '');
  for (const s of POSITIVE) {
    const g = B.gate(s);
    check('  positive-equity blob also refused: ' + JSON.stringify(s.slice(24, 40)), g.inquiry === '' && g.stashed === s, true);
  }

  console.log('\nthe predicate is on the extraction path:');
  check('it is consulted against the extracted inquiry',
    /if \(extractedCustQ && _lpIsToolFieldBlob\(extractedCustQ\)\) \{/.test(code), true);
  check('  ...and the blob is stashed BEFORE the slot is cleared',
    /_lpToolFieldData = extractedCustQ;\n\s*extractedCustQ = '';/.test(code), true);
  check('the stash is declared in inlineScraper scope, beside the inquiry it replaces',
    /var leadReceivedCustomerQuestion='';[\s\S]{0,80}var _lpToolFieldData='';/.test(code), true);

  console.log('\nthe "customer\'s own words" header can no longer carry it:');
  check('that header still exists for real inquiries',
    /CUSTOMER\\'S INQUIRY — the customer\\'s own words/.test(code), true);
  check('  ...and is gated on the inquiry slot the blob no longer fills',
    /if \(leadReceivedCustomerQuestion && \(!conversationBrief/.test(code), true);
  check('the transcript push is gated the same way',
    /if\(extractedCustQ\) \{\s*\n\s*leadReceivedCustomerQuestion = extractedCustQ;/.test(code), true);
  // One fix closes _lpCustomerText too: data.lastInboundMsg falls back to the inquiry slot, and
  // the slot is now empty, so the five scans v9.7.555 named never see the blob either.
  check('lastInboundMsg still falls back to the inquiry slot, which is now empty',
    /lastInboundMsg: lastInboundMsg\|\|leadReceivedCustomerQuestion/.test(code), true);

  // ── THE FIGURES SURVIVE, LABELLED ──────────────────────────────────────────
  console.log('\nthe numbers still reach the model, under a header that says whose they are:');
  check('a replacement block is emitted', /if \(_lpToolFieldData\) \{/.test(code), true);
  check('  ...that names the tool, not the customer',
    /TOOL-SUPPLIED DEAL DATA — NOT THE CUSTOMER\\'S WORDS/.test(code), true);
  check('  ...states the customer did not write them',
    /The customer did not type them/.test(code), true);
  check('  ...and carries the blob itself',
    /_lpToolFieldData \+ '"/.test(code), true);
  check('the block is prepended to the brief, so it is read',
    /conversationBrief = conversationBrief \? toolDataBlock \+ '\\n\\n' \+ conversationBrief : toolDataBlock;/.test(code), true);

  console.log('\nthe do-not-quote rule is the store rule, not a new one:');
  check('the figures are called unverified',
    /TOOL\\'S UNVERIFIED ESTIMATE/.test(code), true);
  check('quoting them back is forbidden outright',
    /Do NOT quote them \\\n?\s*\+? ?'?back to the customer|Do NOT quote them back to the customer/.test(code.replace(/'\s*\n\s*\+\s*'/g, '')), true);
  check('  ...and stating them as fact is too',
    /do NOT state them as fact/.test(code.replace(/'\s*\n\s*\+\s*'/g, '')), true);
  check('it is tied to the existing in-person rule rather than invented',
    /real trade and payment numbers are produced in person/.test(code.replace(/'\s*\n\s*\+\s*'/g, '')), true);
  check('the message is still pointed somewhere useful',
    /move the conversation toward a real appraisal/.test(code.replace(/'\s*\n\s*\+\s*'/g, '')), true);

  console.log('\nthe decision is on the record:');
  check('a diagnostic fires when a blob is refused', /\[LP TOOL DATA DIAG\]/.test(B.src), true);
  check('  ...through the scraper logger, not console.log (v9.7.450 scope trap)',
    /_lpD\('\[LP TOOL DATA DIAG\]/.test(B.src), true);

  // ── SCOPE ──────────────────────────────────────────────────────────────────
  // The predicate must be INSIDE inlineScraper. A module-scope helper called from there throws
  // ReferenceError frame-side and aborts the entire scrape — the v9.7.450 incident.
  console.log('\nthe helper is inside inlineScraper, where its caller runs:');
  const scraperEnd = B.src.indexOf('  } // end inlineScraper');
  const scraperStart = B.src.indexOf('function inlineScraper');
  if (scraperEnd < 0 || scraperStart < 0) bail('inlineScraper markers not found in ' + file);
  const defAt = B.src.indexOf('function _lpIsToolFieldBlob(s) {');
  const useAt = B.src.indexOf('_lpIsToolFieldBlob(extractedCustQ)');
  const emitAt = B.src.indexOf('if (_lpToolFieldData) {');
  check('the definition is inside', defAt > scraperStart && defAt < scraperEnd, true);
  check('the call site is inside', useAt > scraperStart && useAt < scraperEnd, true);
  check('the re-emission is inside', emitAt > scraperStart && emitAt < scraperEnd, true);
  check('the definition precedes its use', defAt < useAt, true);
  check('there is exactly one definition',
    (B.src.match(/function _lpIsToolFieldBlob\(/g) || []).length, 1);
}

if (BUILDS.length > 1) {
  console.log('\nboth builds carry the same gate and the same block:');
  const region = (f, o, c) => {
    const s = fs.readFileSync(f, 'utf8');
    const a = s.indexOf(o), b = s.indexOf(c, a);
    if (a < 0 || b < 0) bail('parity region not found in ' + f);
    return s.slice(a, b);
  };
  check('the predicate is identical',
    region(BUILDS[0], 'function _lpIsToolFieldBlob(s) {', "var lastInboundMsg=''")
    === region(BUILDS[1], 'function _lpIsToolFieldBlob(s) {', "var lastInboundMsg=''"), true);
  check('the replacement block is identical',
    region(BUILDS[0], 'if (_lpToolFieldData) {', 'the "address it directly" framing no longer applies')
    === region(BUILDS[1], 'if (_lpToolFieldData) {', 'the "address it directly" framing no longer applies'), true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
