#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('sold-target-crossshop-863.test.js');
// (v9.7.863) OWNER-APPROVED 11/6, from the 11/5 report and Gil's grabs on 862 (logs 407-410):
//  (1) SOLD: Honda Baytown lead 2110472272 -- Lead Info "Status: Sold", Sale Info "Delivered | Deal # | Sold: 11/5/26" -- was
//      written as a live deal ("Did you make it in yesterday?", the credit application). currentLeadIsActive was true because
//      the source is Gubagoo ("fresh lead sources are never sold") and the custom sub-status read "Appointment Made". The lead's
//      own Sold status with a Deal # sold within 30 days now outranks both.
//  (2) PAYMENT TARGET: Toyota Baytown lead 2107959537 -- a note "hoping to be at around 600$ a month really looking closer to
//      900$" on a Camry purchase. The 759 block speaks only beside a live lease line, so the drafts offered "a different
//      structure ... without starting over". The no-promise block now speaks whenever a target is on record, and the text
//      rewrite carries it too.
//  (3) CROSS-SHOPPING: Honda Baytown lead 2108667800 -- "SHOPPING PILOT, GRAND HIGHLANDER AND WANTS TO LOOK AT THE TAHOE" was
//      read as a visit to the Toyota store; the drafts offered "the Highlander numbers from Community Toyota Baytown". Shopping
//      or comparing is not going there; the longer model name ("Grand Highlander") wins.
//  (4) LANGUAGE: Kia lead 2110818416 -- "I'm sorry I can only assist in English by text". Both language rules now say never
//      to mention language to the customer.
// Executes the shipped sold-detection block (lifted verbatim, as sold-708 does), populateFromData, buildUserPrompt through the
// panel payload, the SMS rewrite prompt and both system prompts. Placeholder data.
//
// Usage: node tests/sold-target-crossshop-863.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: sold-target-crossshop-863.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const mdy = (daysAgo) => { const d = new Date(Date.now() - daysAgo * 86400000); return (d.getMonth() + 1) + '/' + d.getDate() + '/' + String(d.getFullYear()).slice(2); };
// The lead frame's text, shaped like log410's page: the customer's lead grid (duplicates + the sold lead), the status
// dropdown showing the custom sub-status, Lead Info, then Sale Info.
const SRC = 'Hds Dr Lead - Gubagoo - Drs Digital Retailing';
const PAGE = ({ status, soldDaysAgo, deal }) => 'Test Buyer\n(Individual)\nC: (555) 010-0199\nAssigned To: Rep Name\nStatus\n\t\nBuyer/Co-Buyer\n\t\nCreated\n\t\nSource\n\t\nVehicle\n\n'
  + 'Duplicate\t\t' + mdy(1) + '\tGubagoo - Drs\t\nDuplicate\t\t' + mdy(2) + '\t' + SRC + '\t2026 Honda Ridgeline\n' + status + '\t\t' + mdy(2) + '\t' + SRC + '\t2026 Honda Ridgeline\n'
  + 'Hot\t\nCall\t\nEmail\t\nAppt.\t\nNote\t\nLost\t\nBad\t\nSold\t\nBe Back\t\nLetter\t\nText\nStatus:\nAppointment Made\n-- Configure Status List --\nNo longer owns?\n'
  + 'Lead Info\nStatus:\t' + status + '\nSales Rep:\tRep Name\nBD Agent:\tAgent Name\nManager:\tRep Name\nCreated:\t' + mdy(2) + ' 8:01p (1d)\nSource:\t' + SRC + ' (Internet)\n'
  + 'Contacted:\tYes (11:01)\n\n\nSale Info\n2026 Honda Ridgeline\nStatus:  \tDelivered\n' + (deal ? 'Deal #:  \t60001\n' : '') + 'Sold:  \t' + mdy(soldDaysAgo) + '\nBy:  \tRep Name\nStock #:  \tTEST001A\n'
  + 'Trade-in Info\n\t2020 Honda Ridgeline\n';
const E = (date, tag, title, body) => '[' + date + '] [' + tag + '] ' + title + '\n  ' + body + '\n';

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const go = (lsd) => { const logs = []; const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...q) => logs.push(q.join(' ')); sb.console.warn = () => {};
    try { run('activeFlags = new Set(); leadContext = "";'); sb.populateFromData(lsd); const ctx = String(run('leadContext') || '');
      return { ctx, prompt: String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: ctx }))), logs: logs.join('\n') }; }
    catch (e) { return { ctx: '', prompt: '', logs: 'THREW ' + e.message }; } finally { sb.console.log = ol; sb.console.warn = ow; } };

  console.log(' 1. a lead sold yesterday is sold, whatever its source or sub-status (lead 2110472272):');
  const a = src.indexOf('    var isSoldDelivered = false;'), b = src.indexOf('    // Scrape past showroom visits', a);
  const block = src.slice(a, b);
  const sold = (text, currentStatus, leadSource) => { const logs = [];
    const r = new Function('TEXT', 'currentStatus', 'leadSource', '_lpD', block + '\nreturn isSoldDelivered;')(text, currentStatus, leadSource, (x) => logs.push(x));
    return [r, logs.join(' ')]; };
  check('the log410 page (Gubagoo source, sub-status "Appointment Made", Lead Info Sold, Deal # sold 1 day ago) is sold/delivered',
    () => sold(PAGE({ status: 'Sold', soldDaysAgo: 1, deal: true }), 'appointment made sold', SRC)[0], true);
  check('...and the diag says the lead\'s own status outranked the source and the sub-status',
    () => /the lead's own status is Sold with a deal 1 day\(s\) old: that outranks the source and the sub-status/.test(sold(PAGE({ status: 'Sold', soldDaysAgo: 1, deal: true }), 'appointment made sold', SRC)[1]), true);
  check('a TrueCar lead whose own status is Sold with a deal 10 days old is sold too', () => sold(PAGE({ status: 'Sold', soldDaysAgo: 10, deal: true }), 'sold', 'TrueCar')[0], true);
  check('control: the same sale 40 days ago is a past customer, not a delivery', () => sold(PAGE({ status: 'Sold', soldDaysAgo: 40, deal: true }), 'appointment made sold', SRC)[0], false);
  check('control: a returning customer\'s new lead (Lead Info "Status: Active") with last week\'s deal in Sale Info is not sold',
    () => sold(PAGE({ status: 'Active', soldDaysAgo: 7, deal: true }), 'active', SRC)[0], false);
  check('control: Lead Info Sold with no Deal # on a Gubagoo lead stays as before (not sold)', () => sold(PAGE({ status: 'Sold', soldDaysAgo: 1, deal: false }), 'appointment made sold', SRC)[0], false);

  console.log(' 2. their payment target, with no lease offer to hold it against (lead 2107959537):');
  const camry = (notes, x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '', condition: 'New',
    dealerId: '6189', store: 'Community Toyota Baytown', leadSource: 'Showroom', convState: 'call-followup', leadAgeDays: 7, isShowroomFollowUp: true,
    showroomDetails: 'By: Rep Name\nShowed the Camry', hasOutbound: true, hasCustomerReply: false, totalNoteCount: 8, phone: '(555) 010-0199', email: 'test@example.com',
    lastInboundMsg: '', relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 7 },
    conversationBrief: notes + E('10/30/2026 4:10 PM', 'SHOWROOM VISIT', 'Showroom Visit', 'By: Rep Name\n  Showed the Camry, test drive, writeup'), history: '', context: '' }, x || {});
  const NOTE = E('10/30/2026 5:18 PM', 'NOTE', 'General Note', 'By: Rep Name Looking to get a new Camry in her business name. Was hoping to be at around 600$ a month really looking closer to 900$.');
  const PT = /💲 THEIR PAYMENT TARGET: a staff note on this lead says the customer was hoping for about \$600 a month\. That is background, not something we can promise\./;
  const g1 = go(camry(NOTE));
  check('the note\'s $600 target, no lease line -> the no-promise block is in the prompt', () => PT.test(g1.prompt), true);
  check('...it bans hinting the payment can come down ("a different structure", "without starting over") and repeating the figures',
    () => [/no "a different structure",/.test(g1.prompt), /"without starting over"/.test(g1.prompt), /Do NOT repeat their target or any payment figure from the notes\./.test(g1.prompt)], [true, true, true]);
  check('...and it still lets the draft offer to go over options with the rep (by first name)', () => /What you MAY offer: to go over their options with Rep -- how they want the purchase set up, a different vehicle, or their trade/.test(g1.prompt), true);
  check('control: no target in the notes -> no block', () => /THEIR PAYMENT TARGET/.test(go(camry(E('10/30/2026 5:18 PM', 'NOTE', 'General Note', 'By: Rep Name Looking to get a new Camry in her business name.'))).prompt), false);
  check('a used Camry with the same note gets the same block', () => PT.test(go(camry(NOTE, { condition: 'Used', vehicle: '2023 Toyota Camry SE' })).prompt), true);
  check('control: a sold lead gets no block', () => /THEIR PAYMENT TARGET/.test(go(camry(NOTE, { isSoldDelivered: true })).prompt), false);
  const rf = (d) => { const fnR = run('typeof _lpBuildSmsRefinePrompt === "function" ? _lpBuildSmsRefinePrompt : null'); return fnR ? String(fnR('Test, Rep can walk through a different deal structure with you. Would you like to come back in?\nAgent', '', d)) : 'no helper'; };
  check('the text rewrite carries it: THEIR PAYMENT, no hint the payment can come down, no figure', () => {
    const r = rf(camry(NOTE)); return [/━━━ THEIR PAYMENT ━━━/.test(r), /never says or hints the payment can come down, be adjusted, reworked or restructured/.test(r), /repeats no payment figure/.test(r)]; }, [true, true, true]);
  check('control: the rewrite has no such block without a target', () => /━━━ THEIR PAYMENT ━━━/.test(rf(camry(''))), false);

  console.log(' 3. shopping another brand is not a visit to the sister store (lead 2108667800):');
  const VIS = (txt) => E('11/02/2026 10:09 AM', 'SHOWROOM VISIT', 'Showroom Visit', 'By: Rep Name ' + txt) + E('11/04/2026 12:41 PM', 'AGENT', 'Outbound Text Message', 'Hi Test.');
  const honda = (txt) => ({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Honda Pilot Touring', dealerId: '6191',
    store: 'Community Honda Baytown', leadSource: 'Showroom', convState: 'active-follow-up', leadAgeDays: 4, isShowroomFollowUp: true, showroomDetails: 'By: Rep Name\n' + txt,
    conversationBrief: VIS(txt), hasOutbound: true, totalNoteCount: 6, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '',
    relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 0 } });
  const c3 = go(honda('SHOPPING PILOT, GRAND HIGHLANDER AND WANTS TO LOOK AT THE TAHOE.')).ctx;
  check('"SHOPPING PILOT, GRAND HIGHLANDER" -> CROSS-SHOPPING, the Grand Highlander by its full name; no sister-store offer',
    () => [/^CROSS-SHOPPING: the visit notes say they are also comparing the Toyota Grand Highlander\./m.test(c3), /^SISTER STORE ON THIS VISIT/m.test(c3)], [true, false]);
  check('...which names no dealership and offers no numbers from one', () => /do not name any dealership, do not offer that vehicle's numbers, and do not offer to get or arrange anything at another store/.test(c3), true);
  check('"went over to Toyota next door and drove the Grand Highlander" is still the sister-store visit, with the full model name',
    () => /^SISTER STORE ON THIS VISIT: the visit notes say they also looked at the Toyota Grand Highlander at our sister store Community Toyota Baytown/m.test(go(honda('Showed the Pilot, then went over to Toyota next door and drove the Grand Highlander.')).ctx), true);

  console.log(' 4. never mention language to the customer (lead 2110818416):');
  const sys = String(run('buildSystemPrompt("bdc")') || ''), rsys = String(run('buildSystemPromptSmsRefine("Agent", "Community Kia Baytown", "(555) 010-0100")') || '');
  check('the system prompt: never say you can only help in English, never offer a Spanish-speaking teammate',
    () => [/NEVER MENTION LANGUAGE TO THE CUSTOMER/.test(sys), /Do not say you can only help in English/.test(sys), /do not offer, promise or arrange a Spanish-speaking teammate/.test(sys)], [true, true, true]);
  check('the rewrite\'s system prompt says the same', () => /Never mention language to them: no "in English", no apology, no offer of a Spanish speaker\./.test(rsys), true);
  check('control: both still require English', () => [/ALL responses are written in English/.test(sys), /The text is written in ENGLISH\. ALWAYS\./.test(rsys)], [true, true]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
