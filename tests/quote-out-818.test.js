#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('quote-out-818.test.js');
// (v9.7.818) THE PRICE THEY ASKED FOR WENT OUT, AND THE DRAFT ASKED WHETHER AWD WAS STILL A MUST. Kia Baytown lead 2102063788
// (log352): the customer emailed for out-the-door prices on two Telluride Hybrid trims ("-AWD, required ... -Any exterior color
// is acceptable except Black Jade Green ... -Total out-the-door price"); the salesperson texted the selling price, fees, tax and
// total drive-out on one of them. The prompt said nothing of that quote, and instead: "they asked for BLACK", an inventory answer
// for "the EX in black or green", "DRIVETRAIN QUESTION ... ask whether AWD is a must", "VEHICLE WAS TOTALED / IN AN INSURANCE
// CLAIM" (from "Total out-the-door"), "may be looking to SELL" (from "selling price ... the vehicle"), "a genuinely different
// angle" and "do not reference other vehicles". Gil: "Messaging should have been about the provided pricing."
// Builds prompts through the shipped populateFromData and panel payload (the edits run on the finished prompt), and executes
// the shipped color detector slice, _lpBuildSmsRefinePrompt, _lpDriveRequired and _lpVehicleTotaledNow. Placeholder data only.
//
// Usage: node tests/quote-out-818.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: quote-out-818.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const H = 3600000, NOW = Date.now();
const fmt = (ms) => { const f = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  .formatToParts(new Date(ms)).reduce((o, p) => (o[p.type] = p.value, o), {}); return f.month + '/' + f.day + '/' + f.year + ' ' + f.hour + ':' + f.minute + ' ' + f.dayPeriod.toUpperCase(); };
const E = (ms, tag, title, body) => '[' + fmt(ms) + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (ms) => '[' + fmt(ms) + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const T0 = NOW - 60 * H;
const ASK = 'Hello, I am requesting your best out-the-door (OTD) price on a 2027 Kia Telluride Hybrid EX AWD with Tow Package and a 2027 Kia Telluride Hybrid X-Line SX AWD with Tow Package. '
  + 'If you have one of each available, I would appreciate a quote for both. -AWD, required -Tow Package, required -Any exterior color is acceptable except Black Jade Green -No trade-in '
  + '-Selling price of the vehicle -Total out-the-door price. Thanks, Test';
const QUOTE = 'Test this is Rep with Test Kia. I have a 2027 Telluride Hybrid X-Line SX AWD. The selling price is $57,155.00 fees are $432.50 and the total drive out is $61,282.75. Please let me know what time you can be here so we can have the vehicle ready, Thanks!';
const HIST = (o) => (o.after ? E(T0 + 48 * H, 'CUSTOMER', 'Email reply from prospect', o.after) : '')
  + (o.noQuote ? '' : E(T0 + 44 * H, 'AGENT', 'Outbound phone call (Machine)', 'By: Rep Name\n  Left message') + E(T0 + 44 * H, 'AGENT', 'Outbound Text Message', o.quote || QUOTE))
  + E(T0 + 12 * H, 'CUSTOMER', 'Email reply from prospect', o.ask || ASK)
  + E(T0, 'AGENT', 'Outbound Text Message', 'By: Agent Name\n  Test, I am checking on the 2027 Telluride EX AWD you picked. Are you planning to finance or pay cash? Agent') + MARK(T0 - 60000);
const STATE = 'CONVERSATION STATE: The customer\'s last message was [sent 2 days ago]: "Hello". You ALREADY replied to it (see your most recent outbound in the transcript); they have been silent 1 day(s) since. Do NOT re-answer or restate that reply -- repeating your prior message is the failure here. Re-engage with a genuinely different angle: a concrete new reason to act now, a specific next step, or a question you have not already asked.';
const LEAD = (o) => { o = o || {}; const h = HIST(o); return Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name',
  vehicle: '2027 Kia Telluride EX AWD', condition: 'New', dealerId: '6190', store: 'Test Kia', leadSource: 'Internet',
  convState: 'active-follow-up', leadAgeDays: 3, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 12, phone: '(555) 010-0199', email: 'test@example.com',
  customerZip: '00000', relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 1.9 },
  lastInboundMsg: o.after || o.ask || ASK, lastSubstantiveOutboundMsg: o.noQuote ? 'Test, I am checking on it.' : (o.quote || QUOTE), history: h,
  conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + h + '---\n' + STATE,
  outboundSends: [{ title: 'outbound text message', ms: T0 + 44 * H, body: o.quote || QUOTE }] }, o.x || {}); };

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  run('_lpValueFactCache')['6190'] = { inv: { units: [{ stock: 'P0001', stockNum: 'P0001', vin: 'TESTVINP0001', vehicle: '2027 Kia Telluride EX', year: 2027, make: 'Kia', model: 'Telluride EX',
    condition: 'new', certified: false, class: 'SUV', body: 'SUV', color: 'Ebony Black', odometer: 5, daysOnLot: 10, price: 50000 }] }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true };
  const viaPanel = (lsd) => quiet(() => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(lsd);
    return sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: run('leadContext') })); });

  console.log(' 1. lead 2102063788: the price they asked for went out:');
  const p = viaPanel(LEAD());
  check('THE PRICE THEY ASKED FOR WENT OUT: who sent it (the salesperson, from the call beside it), the message itself, its total; the touch follows up on it',
    () => [/THE PRICE THEY ASKED FOR WENT OUT: on \d\d\/\d\d Rep, their salesperson, sent them a price: "Test this is Rep with Test Kia\. I have a 2027 Telluride Hybrid X-Line SX AWD\./.test(p),
      /You may name the vehicle it was for and its total \(\$61,282\.75\)/.test(p), /covers only part of what they asked for, say so plainly and say you are getting the rest priced the same way/.test(p)], [true, true, true]);
  check('"a genuinely different angle" and the vehicle lock point at the quote instead of away from it',
    () => [/Re-engage with a genuinely different angle/.test(p), /The price we sent since then is that reply: follow up on it/.test(p),
      /Do not substitute or reference other vehicles from the conversation history/.test(p), /may be for another trim or vehicle they asked about: name that one when you follow up on it/.test(p)], [false, true, false, true]);
  check('the pitch line points at it; the inventory answer stands down (the salesperson already answered with a unit and a price)',
    () => [/This message follows up on the price we sent \(see THE PRICE THEY ASKED FOR WENT OUT\)\./.test(p), /WHAT WE HAVE IN THE/.test(p)], [true, false]);
  check('no totaled-car block ("Total out-the-door price"), no seller warning ("The selling price ... the vehicle ready")',
    () => [/TOTALED \/ IN AN INSURANCE CLAIM/.test(p), /may be looking to SELL/.test(p)], [false, false]);
  check('"-AWD, required" is a requirement: never ask whether AWD is a must', () => [/🚙 DRIVETRAIN REQUIREMENT: They told us AWD is required\. That is settled: never ask whether AWD is a must/.test(p),
    /ask whether AWD is a must\), and keep moving/.test(p)], [true, false]);

  console.log(' 2. controls:');
  const pNo = viaPanel(LEAD({ noQuote: true }));
  check('no price sent: no quote line, the usual "different angle" and vehicle lock', () => [/THE PRICE THEY ASKED FOR WENT OUT/.test(pNo), /Re-engage with a genuinely different angle/.test(pNo),
    /THIS IS THE VEHICLE FOR THIS LEAD\. Do not substitute/.test(pNo)], [false, true, true]);
  check('they answered the quote: it is no longer what the message follows up', () => /THE PRICE THEY ASKED FOR WENT OUT/.test(viaPanel(LEAD({ after: 'Thanks, can you do better on the X-Line?' }))), false);
  check('they never asked for a price: a figure in our message is not "the price they asked for"', () => /THE PRICE THEY ASKED FOR WENT OUT/.test(viaPanel(LEAD({ ask: 'Is the Telluride still there? I want to see it Saturday.' }))), false);
  check('a real seller still gets the warning', () => /may be looking to SELL/.test(viaPanel(LEAD({ noQuote: true, ask: 'I want to sell my truck before I buy. What would you give me for it?' }))), true);

  console.log(' 3. a color they excluded is not one they asked for (the shipped scraper detector):');
  const i0 = src.indexOf('      var _lpColorRx = '), detector = src.slice(i0, src.indexOf("acknowledge availability honestly.');\n      }", i0) + "acknowledge availability honestly.');\n      }".length);
  const stated = (body) => { const box = { String, Date, Array, RegExp, concernScanLines: ['[10/19/2026 8:12 PM] [CUSTOMER] Email reply from prospect\n  ' + body], allTranscriptText: body,
    _fricQuote: '', _fricState: '', customerConcerns: [], color: 'No Preference', vin: '', vehicle: '2027 Kia Telluride EX AWD', _lpD() {} };
    vm.createContext(box); vm.runInContext(detector, box); return [box._statedColor || '', /they asked for BLACK/.test(box.customerConcerns.join('\n'))]; };
  check('log352: "Any exterior color is acceptable except Black Jade Green" -> no stated color, no "they asked for BLACK"', () => stated(ASK), ['', false]);
  check('"in white, not black" -> white; "any color but red, I prefer silver" -> silver', () => [stated('I want it in white, not black')[0], stated('any color but red works, I prefer silver')[0]], ['white', 'silver']);
  check('control: "I want the black one" -> black', () => stated('I want the black one'), ['black', true]);
  check('the inventory reader skips them too', () => [Object.keys(sb._lpColorWords(sb._lpStripColorExclusions(ASK))).length, Object.keys(sb._lpWantedColorWords('do you have it in black? not white')).join()], [0, 'black']);

  console.log(' 4. the readers that misfired:');
  check('"-AWD, required" / "must be all-wheel drive" are requirements; "is it AWD?" is a question', () => [sb._lpDriveRequired({ lastInboundMsg: ASK }),
    sb._lpDriveRequired({ lastInboundMsg: 'It must be all-wheel drive' }), sb._lpDriveRequired({ lastInboundMsg: 'Is it AWD?' })], ['AWD', 'AWD', '']);
  check('"Total out-the-door price" is not a total loss; "it was a total loss" and "they totaled it out" still are',
    () => [sb._lpVehicleTotaledNow('-Total out-the-door price'), sb._lpVehicleTotaledNow('the insurance said it was a total loss'), sb._lpVehicleTotaledNow('they totaled it out')], [false, true, true]);

  console.log(' 5. the text rewrite:');
  const rf = String(quiet(() => sb._lpBuildSmsRefinePrompt('Test, I saw your request for a black 2027 Telluride EX. Is AWD still required?\nAgent', 'Subject: Your quote\n\nTest,\n\nRep sent you the out-the-door price on the X-Line SX AWD.\n\nAgent Name', LEAD())));
  check('the rewrite is told about the price (the whole message, total intact) and its job is the follow-up; it drops "is AWD still required"',
    () => [/━━━ THE PRICE THEY ASKED FOR WENT OUT ━━━\nOn \d\d\/\d\d Rep, their salesperson, sent them a price \("[^"]*\$61,282\.75/.test(rf),
      /━━━ WRITE THE TEXT ━━━\nThis text follows up on the price we sent\. Right after their name, ask whether it came through/.test(rf),
      /If the first draft asks whether it is still required, leave that question out\./.test(rf)], [true, true, true]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
