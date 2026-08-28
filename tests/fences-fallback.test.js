#!/usr/bin/env node
'use strict';
/**
 * fences-fallback.test.js — v9.7.552.
 *
 * THE FENCE PATH WAS THE EXCEPTION, NOT THE RULE.
 *
 * v9.7.544 (arc bounding) and v9.7.545 (sold scan) both scoped their scan to the region
 * between the 'CONVERSATION TRANSCRIPT (...)\n---' fences, and both fell back to the whole
 * assembled context when the fences were missing. That block is built ONLY when
 * convState !== 'first-touch' — and a Gubagoo chat lead takes the 'CHAT TRANSCRIPT (' branch
 * instead, which emits no fences at all.
 *
 * MEASURED, not assumed — the six logs captured since v9.7.544 (109/110/111/112/113/115):
 *   [LP ARC-BOUND DIAG]   15 fences found, 4 not found
 *   [LP SOLD SCAN DIAG]    9 transcript-only, 10 full-context (fences not found)
 * The two disagree because the arc-bound diag is gated on conversationBrief + a non-first-touch
 * convState, so it stays silent on exactly the leads where the sold scan falls back. Of those
 * 10 fallback rows, 4 returned vehicleSold:true on prose alone with authoritativeMarker:false —
 * two distinct leads, Jeffrey Best (1 generation) and lead 2068821407 (3), both fixtures below.
 * The 9 transcript-only rows are v9.7.545 working: 7 of them report proseMatchInFullCtx:true
 * with proseMatchInTranscript:false, i.e. a scaffold hit correctly refused because the fences
 * happened to exist on that lead.
 *
 * LIVE INCIDENT — Jeffrey Best, Community Honda Baytown, lead 2069849624, 8/18/26.
 * Active lead: 2021 Kia Telluride EX, in stock, CPO, confirmed by a clean single-panel merge
 * (VOI DIAG frame 2246 parsed the panel directly — this is NOT a split-frame repeat). The
 * delivered SMS: "The Telluride has sold, but I can connect you with Community Toyota Baytown
 * for a Highlander."
 *
 * Neither statement traces to the customer or to the CRM. Both trace to Lead Pro's own text:
 *   • "sold"       ← our directive "If the newest thing we told them was that the vehicle
 *                     sold, you may not now write as though it is available" (offset 5876 of
 *                     his 8,882-char context; it is the ONLY match in the whole string)
 *   • "Highlander" ← our own line "Customer's current vehicle (confirmed from service/sales
 *                     history): 2015 Toyota Highlander", absorbed by the pivot detector's
 *                     custOnlyLines state machine because [CHAT BOT] is not one of its five
 *                     recognised closers, so the block opened on his first chat turn and ran
 *                     39 lines / 5,627 chars to the end of the context.
 *
 * The fixture is his REAL captured context, byte for byte out of the delivered prompt, with
 * only direct identifiers (phone, email, street) masked — neither mechanism touches them.
 *
 * Both blocks are sliced out of each SHIPPED popup.js. Both builds must agree.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BUILDS = process.argv.slice(2);
if (!BUILDS.length) { console.error('usage: fences-fallback.test.js <popup.js> [popup.js...]'); process.exit(2); }

const JEFFREY = fs.readFileSync(path.join(__dirname, 'fixtures', 'jeffrey-best-context.txt'), 'utf8');
// Second real capture, found by surveying the logs for the same shape: lead 2068821407,
// 8/17, VOI "2023 TOYOTA COROLLA". Three generations, all vehicleSold:true on prose alone
// with authoritativeMarker:false — while [LP SOLD SIGNAL DIAG] on the same grabs reports
// inventoryWarning:false, vehiclePendingSale:false, _pdStatus:"(none)" and sold:false on
// every frame. Its 3,620-char context contains exactly ONE match for the sold regex, and it
// is the same directive of ours that caught Jeffrey.
const COROLLA = fs.readFileSync(path.join(__dirname, 'fixtures', 'corolla-2068821407-context.txt'), 'utf8');

const PIVOT_START = '  // ── Vehicle pivot detection ────────────────────────────────────';
const PIVOT_END   = '  // ── Competitor deposit override (v9.7.184) ────────────────────────';

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');

  const ha = src.indexOf('var LP_SCAFFOLD_LINE_RE =');
  const hb = src.indexOf('// (v9.7.429/427) ONE definition of');
  if (ha < 0 || hb < 0 || hb <= ha) throw new Error('could not locate LP_SCAFFOLD_LINE_RE in ' + file);
  const helper = src.slice(ha, hb);

  const sa = src.indexOf('  var _ctxSold = ctx, _csScope');
  const sb = src.indexOf('  s.vehicleInTransit   =');
  if (sa < 0 || sb < 0 || sb <= sa) throw new Error('could not locate the sold scan in ' + file);

  const pa = src.indexOf(PIVOT_START);
  const pb = src.indexOf(PIVOT_END);
  if (pa < 0 || pb < 0 || pb <= pa) throw new Error('could not locate the pivot block in ' + file);

  const sandbox = { console: { log() {} } };
  vm.createContext(sandbox);
  vm.runInContext(helper, sandbox);

  // The sold scan reports both its verdict and the scope it decided on, so a test can tell
  // "did not fire" from "fired for the right reason".
  const sold = vm.runInContext(
    '(function(data, opts){\n' +
    '  var ctx = (data.context || "").toLowerCase();\n' +
    '  var s = {}; opts = opts || {};\n' +
    '  var _inTransitNow = !!opts.inTransit, _isLeaseMatureEarly = !!opts.leaseMature, _audiAllAvail = !!opts.audiAllAvail;\n' +
    '  s.isLoyalty = !!opts.isLoyalty;\n' +
    src.slice(sa, sb) +
    '\n  return { sold: s.vehicleSold, scope: _csScope, stripped: _csStripped }; })', sandbox);

  const pivot = vm.runInContext(
    '(function(data, hasCustomerReply, hasRealOutbound){\n' +
    src.slice(pa, pb) +
    '\n  return { note: vehiclePivotNote, candidates: _pivotCandidates.slice(),' +
    '           custLines: custOnlyLines.length, custChars: custOnlyLines.join(" ").length,' +
    '           closedByTag: _pvClosedByTag, closedByScaffold: _pvClosedByScaffold,' +
    '           openedBy: Object.keys(_pvOpenedBy).sort() }; })', sandbox);

  // The scaffold stripper on its own, so the boundary itself is testable.
  const strip = vm.runInContext('(function(t){ return _lpStripScaffold(t); })', sandbox);

  return { name: path.basename(path.dirname(file)), sold, pivot, strip };
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

const TRANSCRIPT = body =>
  'CONVERSATION TRANSCRIPT (newest first — read the full thread before responding):\n---\n' + body + '\n---\n';

// The exact tail of Jeffrey's context: the appended VEHICLE/LEAD DETAILS scaffold that both
// consumers were reading as conversation.
const LP_TAIL =
  'VEHICLE/LEAD DETAILS:\n' +
  'Vehicle of Interest: 2021 Kia Telluride EX (Pre-Owned)\n' +
  'Color: Gravity Grey\n' +
  'VEHICLE ON LEAD: 2021 Kia Telluride EX — confirmed in stock.\n' +
  '🧾 WHAT WE HAVE ALREADY TOLD THIS CUSTOMER (our own prior outbound messages, oldest first):\n' +
  '  • [08/18/2026] WE SAID IT WAS AVAILABLE: "It currently shows 84,065 miles"\n' +
  '- Do NOT contradict the MOST RECENT of these without saying so plainly. If the newest thing we told ' +
  'them was that the vehicle sold, you may not now write as though it is available.\n' +
  "Customer's current vehicle (confirmed from service/sales history): 2015 Toyota Highlander — This is " +
  'their CURRENT vehicle, not what they want to buy. Do NOT use it as the vehicle of interest.\n' +
  'Manager: BJ Wilson\n';

const GUBAGOO_CHAT =
  'CHAT TRANSCRIPT (customer already spoke with the chat bot - read this before writing):\n' +
  '[08/18/2026 9:43 AM] [GUBAGOO CHAT] Chat transcript:\n' +
  '  [CHAT SUBJECT] My name is Jeffrey what is the mileage on the 2021 telluride\n' +
  '  [CUSTOMER] My name is Jeffrey what is the mileage on the 2021 telluride\n' +
  '  [CHAT BOT] This vehicle has 84,065 MI\n' +
  '  [CUSTOMER] I am helping my granddaughter by a pre owned suv\n' +
  '  [CHAT BOT] Customer left website\n';

console.log('\nv9.7.552 — the fences-not-found fallback must not read Lead Pro\'s own scaffold');
console.log('builds under test: ' + impls.map(i => i.name).join(', ') + '\n');

// ── The real capture ───────────────────────────────────────────────────────────
console.log('Jeffrey Best — his REAL 8,870-char captured context:');

check('the fixture is the fences-not-found shape (this is what made it live)',
  () => JEFFREY.indexOf('CONVERSATION TRANSCRIPT (') >= 0,
  false);

check('the fixture carries the two contaminants, so the test is not vacuous',
  () => ({ ourSoldDirective: /was that the vehicle sold/i.test(JEFFREY),
           ourOwnedVehicleLine: /Customer's current vehicle \(confirmed from service\/sales history\): 2015 Toyota Highlander/.test(JEFFREY),
           highlanderInAnyCustomerTag: /\[CUSTOMER\][^\n]*highlander/i.test(JEFFREY) }),
  { ourSoldDirective: true, ourOwnedVehicleLine: true, highlanderInAnyCustomerTag: false });

check('SOLD SCENARIO: the Telluride is no longer reported sold',
  i => i.sold({ vehicle: '2021 Kia Telluride EX', context: JEFFREY }, {}).sold,
  false);

check('SOLD SCENARIO: and the fallback path is named in the scope, not silent',
  i => i.sold({ vehicle: '2021 Kia Telluride EX', context: JEFFREY }, {}).scope,
  'full-context, scaffold stripped (fences not found)');

check('SOLD SCENARIO: the strip actually removed scaffold on this lead',
  i => i.sold({ vehicle: '2021 Kia Telluride EX', context: JEFFREY }, {}).stripped > 1000,
  true);

check('PIVOT: no Highlander candidate survives the customer-text scope',
  i => i.pivot({ vehicle: '2021 Kia Telluride EX', store: 'Community Honda Baytown',
                 context: JEFFREY, convState: 'first-touch',
                 lastInboundMsg: 'My name is Jeffrey what is the mileage on the 2021 telluride' },
               true, false).candidates,
  []);

check('PIVOT: no pivot note is produced at all',
  i => i.pivot({ vehicle: '2021 Kia Telluride EX', store: 'Community Honda Baytown',
                 context: JEFFREY, convState: 'first-touch',
                 lastInboundMsg: 'My name is Jeffrey what is the mileage on the 2021 telluride' },
               true, false).note,
  '');

check('PIVOT: the runaway block is bounded — the state machine now closes',
  i => {
    const r = i.pivot({ vehicle: '2021 Kia Telluride EX', store: 'Community Honda Baytown',
                        context: JEFFREY, convState: 'first-touch', lastInboundMsg: '' }, true, false);
    return { closedAtLeastOnce: (r.closedByTag + r.closedByScaffold) > 0, ranToEndOfContext: r.custChars > 5000 };
  },
  { closedAtLeastOnce: true, ranToEndOfContext: false });

console.log('\nlead 2068821407 (2023 Toyota Corolla, 8/17) — the same shape, found by log survey:');

check('its context is also the fences-not-found shape',
  () => COROLLA.indexOf('CONVERSATION TRANSCRIPT (') >= 0,
  false);

check('its ONLY sold-regex match is our own directive, not the CRM',
  () => (COROLLA.match(/the vehicle (?:has |I sent you has )?sold|vehicle sold|that (?:car|vehicle|unit) (?:has been |is )?sold|sorry[\s\S]*?(?:vehicle|car|it)[\s\S]*?sold|unfortunately[\s\S]*?sold|no longer available/gi) || []).length,
  1);

check('the Corolla is no longer reported sold',
  i => i.sold({ vehicle: '2023 TOYOTA COROLLA', context: COROLLA }, {}).sold,
  false);

// ── The mechanism, isolated ────────────────────────────────────────────────────
console.log('\nthe custOnlyLines closers — the gap that let it run:');

check('[CHAT BOT] closes the block (the tag that caused the incident)',
  i => i.pivot({ vehicle: '2021 Kia Telluride EX', context:
      '  [CUSTOMER] what is the mileage\n  [CHAT BOT] we also have a Highlander\n', lastInboundMsg: '' },
    true, false).candidates,
  []);

check('an unenumerated future tag closes it too — the fix is not a longer list',
  i => i.pivot({ vehicle: '2021 Kia Telluride EX', context:
      '  [CUSTOMER] what is the mileage\n  [WEBCHAT ASSISTANT] we also have a Highlander\n', lastInboundMsg: '' },
    true, false).candidates,
  []);

check('an LP scaffold header closes it even with no tag present',
  i => i.pivot({ vehicle: '2021 Kia Telluride EX', context:
      '  [CUSTOMER] what is the mileage\n' + LP_TAIL, lastInboundMsg: '' },
    true, false).candidates,
  []);

check('a lowercase bracketed token typed by the customer does NOT close it',
  i => i.pivot({ vehicle: '2021 Kia Telluride EX', context:
      '  [CUSTOMER] hey [asking again]\n  do you have a Highlander instead\n', lastInboundMsg: '' },
    true, false).candidates,
  ['Highlander']);

check('a dated [CUSTOMER] header still opens the block',
  i => i.pivot({ vehicle: '2021 Kia Telluride EX', context:
      '[08/18/2026 9:43 AM] [CUSTOMER] Inbound Text Message\n  actually I want a Highlander\n', lastInboundMsg: '' },
    true, false).candidates,
  ['Highlander']);

check('a real pivot inside a Gubagoo chat is still detected — no over-correction',
  i => i.pivot({ vehicle: '2021 Kia Telluride EX', context:
      GUBAGOO_CHAT.replace('[CUSTOMER] I am helping my granddaughter by a pre owned suv',
                           '[CUSTOMER] actually can we look at a Sorento instead') + LP_TAIL,
      lastInboundMsg: 'actually can we look at a Sorento instead' },
    true, true).candidates,
  ['Sorento']);

check('multi-line customer text is still absorbed after its own header',
  i => i.pivot({ vehicle: '2021 Kia Telluride EX', context:
      '[08/18/2026] [CUSTOMER] Inbound Text Message\n  hey there\n  do you have a Pilot\n' + LP_TAIL,
      lastInboundMsg: '' },
    true, false).candidates,
  ['Pilot']);

// ── (v9.7.553) all three customer tag shapes open the scan ─────────────────────
// Found by reading the v9.7.552 diag, not from a bad draft. The scraper writes the customer's
// own words under three tags: [CUSTOMER] (full turns), [CUSTOMER CHAT SUMMARY] (chat leads past
// first-touch, popup.js ~6310) and [CUSTOMER REQUEST FROM INQUIRY] (extracted lead-received
// question, ~6460). The v9.7.552 opener was a literal [CUSTOMER], so the other two not only
// failed to open the block — they matched the NEW uppercase-tag closer and shut it.
// Confirmed live on Jeffrey Best's own follow-up capture: custLines:0.
console.log('\nall three customer tag shapes open the scan (v9.7.553):');

check('[CUSTOMER CHAT SUMMARY] opens — the shape that reported custLines:0',
  i => i.pivot({ vehicle: '2021 Kia Telluride EX', context:
      '[CUSTOMER CHAT SUMMARY] Asked about a Highlander for his granddaughter\n' + LP_TAIL,
      lastInboundMsg: '' }, true, true).candidates,
  ['Highlander']);

check('[CUSTOMER REQUEST FROM INQUIRY] opens',
  i => i.pivot({ vehicle: '2021 Kia Telluride EX', context:
      '[CUSTOMER REQUEST FROM INQUIRY] Looking for a Sorento instead\n' + LP_TAIL,
      lastInboundMsg: '' }, true, true).candidates,
  ['Sorento']);

check('the opening tag shape is reported, so a fourth shape is visible from the log',
  i => i.pivot({ vehicle: '2021 Kia Telluride EX', context:
      '  [CUSTOMER] what is the mileage\n' +
      '  [CHAT BOT] one moment\n' +
      '[CUSTOMER CHAT SUMMARY] Asked about a Pilot\n' + LP_TAIL,
      lastInboundMsg: '' }, true, true).openedBy,
  ['[CUSTOMER CHAT SUMMARY]', '[CUSTOMER]']);

check('nothing recognised opens the block — reported as an empty set, not silence',
  i => i.pivot({ vehicle: '2021 Kia Telluride EX', context:
      '[08/18/2026] [NOTE] General Note\n  customer mentioned a Highlander\n' + LP_TAIL,
      lastInboundMsg: '' }, true, true).openedBy,
  []);

check('a summary tag still CLOSES a preceding block it did not open — closers unchanged',
  i => i.pivot({ vehicle: '2021 Kia Telluride EX', context:
      '  [CUSTOMER] what is the mileage\n' +
      '  [GUBAGOO CHAT] we also have a Highlander\n',
      lastInboundMsg: '' }, true, true).candidates,
  []);

check('an agent NOTE naming a model still cannot open the scan',
  i => i.pivot({ vehicle: '2021 Kia Telluride EX', context:
      '[08/18/2026] [NOTE] General Note\n  told him about the Highlander\n',
      lastInboundMsg: '' }, true, true).candidates,
  []);

check('Jeffrey\'s real context is unaffected by the wider opener',
  i => i.pivot({ vehicle: '2021 Kia Telluride EX', store: 'Community Honda Baytown',
                 context: JEFFREY, convState: 'first-touch',
                 lastInboundMsg: 'My name is Jeffrey what is the mileage on the 2021 telluride' },
               true, false).candidates,
  []);

// ── The stripper, isolated ─────────────────────────────────────────────────────
console.log('\n_lpStripScaffold — keeps captured content, drops our own:');

check('the ownedVehicle line is dropped',
  i => /Highlander/.test(i.strip(LP_TAIL)),
  false);

check('the sold directive is dropped',
  i => /was that the vehicle sold/.test(i.strip(LP_TAIL)),
  false);

check('dated CRM entries survive intact',
  i => i.strip('[08/12/2026] [AGENT] unfortunately that one sold last week\n').trim(),
  '[08/12/2026] [AGENT] unfortunately that one sold last week');

check('a tagged line after a scaffold header re-opens the stream',
  i => i.strip('VEHICLE/LEAD DETAILS:\nColor: Gravity Grey\n[08/12/2026] [CUSTOMER] still interested\n').trim(),
  '[08/12/2026] [CUSTOMER] still interested');

check('a context with no scaffold at all comes back byte-identical',
  i => i.strip('[08/12/2026] [CUSTOMER] hi\n  second line\n'),
  '[08/12/2026] [CUSTOMER] hi\n  second line\n');

check('empty input is safe',
  i => i.strip(''),
  '');

// ── Nothing that worked before may stop working ────────────────────────────────
console.log('\nthe paths that already worked are untouched:');

check('fences present — the v9.7.545 transcript scope still wins',
  i => i.sold({ vehicle: '2024 Honda Accord',
                context: LP_TAIL + TRANSCRIPT('[08/10/2026] [CUSTOMER] Inbound Text\n  still thinking') }, {}).scope,
  'transcript-only (fences found)');

check('fences present — LP scaffold outside them still cannot trip sold',
  i => i.sold({ vehicle: '2024 Honda Accord',
                context: LP_TAIL + TRANSCRIPT('[08/10/2026] [CUSTOMER] Inbound Text\n  still thinking') }, {}).sold,
  false);

check('no fences — a genuine agent "it sold" in a dated entry still fires',
  i => i.sold({ vehicle: '2024 Honda Accord',
                context: LP_TAIL + '[08/12/2026 9:00 AM] [AGENT] Outbound Text Message\n  Unfortunately that unit has been sold\n' },
              {}).sold,
  true);

check('no fences — a genuine customer "no longer available" still fires',
  i => i.sold({ vehicle: '2024 Honda Accord',
                context: GUBAGOO_CHAT + '[08/12/2026] [AGENT] Email\n  that one is no longer available\n' + LP_TAIL },
              {}).sold,
  true);

check('the authoritative marker still reads the FULL context, scaffold and all',
  i => i.sold({ vehicle: '2024 Honda Accord', context: '🔴 VEHICLE STATUS: SOLD\n' + LP_TAIL }, {}).sold,
  true);

check('no vehicle on the lead still means nothing can be sold',
  i => i.sold({ vehicle: '', context: '🔴 VEHICLE STATUS: SOLD\n' + LP_TAIL }, {}).sold,
  false);

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
