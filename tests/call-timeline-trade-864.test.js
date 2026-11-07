#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('call-timeline-trade-864.test.js');
// (v9.7.864) OWNER-APPROVED 11/7 ("build 864, option A"), from the 11/6 report and Gil's grabs on 863 (logs 411-414):
//  (1) THEY WANT A CALL, AND ONLY WITH NUMBERS THAT FIT: Honda Lafayette lead 2111261033 -- "not texting or emailing bc we spoke
//      on phone, customer wants us to call if we think it's likely we can keep her within budget"; the draft offered Saturday times.
//  (2) THE CALL'S WANTS: Honda Baytown lead 2110700703 -- "honda civic, around 23k, and not blue or red", and we then sent "our
//      used Honda Civics"; only "blue" was read, the price was ignored, and new 2027 Civic Sports were offered "around $23,000".
//  (3) THE VEHICLE ON THE LEAD IS THEIR TRADE: Toyota Baytown lead 2102596185 -- "Trade in- 2023 Honda Civic sport Hatchback
//      46,867 miles fully paid off" was stamped as a record error and the draft asked whether she was still considering the Civic.
//  (4) THEY TOLD US THEIR TIMELINE: the same lead -- "I won't make the decision until 2027 rolls around" -- drew "has your search
//      shifted?". Option A: no times, no "still looking?", one useful thing, check back closer to then.
//  (5) THEY CALLED US BACK AND WE MISSED THEM: Kia Baytown lead 2108597971 -- six inbound calls "calling <rep> back" in ten
//      minutes, nobody reached them, and three drafts offered a video walkaround.
//  (6) NARRATION, IN ANY FORMAT: Honda Lafayette lead 2108256455's email -- "I realize our messages haven't made it easy to
//      respond. I'll keep this simple: ..." and "I don't want to send another version of the same invitation".
// Executes populateFromData, buildUserPrompt through the panel payload, the visit decision, the SMS rewrite prompt and the
// render guard of the build under test. Placeholder data.
//
// Usage: node tests/call-timeline-trade-864.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: call-timeline-trade-864.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const pad = (n) => String(n).padStart(2, '0');
// A date N days ago, as the thread prints it, at a given clock time.
const at = (daysAgo, clock) => { const d = new Date(Date.now() - daysAgo * 86400000); return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear() + ' ' + clock; };
const E = (date, tag, title, body) => '[' + date + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (date) => '[' + date + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const U_ = (stock, vehicle, model, color, cond, year, price) => ({ stock, vin: '', vehicle, year, make: vehicle.split(' ')[1], model, condition: cond, certified: cond === 'cpo',
  class: 'Car', body: '4D Sedan', color, interior: 'Black', odometer: 10, daysOnLot: 30, price, stockNum: stock });

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const fn = (n) => run('typeof ' + n + ' === "function" ? ' + n + ' : null');
  const go = (lsd) => { const logs = []; const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...q) => logs.push(q.join(' ')); sb.console.warn = () => {};
    try { run('activeFlags = new Set(); leadContext = "";'); sb.__L = lsd; run('lastScrapedData = globalThis.__L;'); sb.populateFromData(lsd); const ctx = String(run('leadContext') || '');
      return { d: lsd, ctx, prompt: String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: ctx }))), logs: logs.join('\n') }; }
    catch (e) { return { d: lsd, ctx: '', prompt: '', logs: 'THREW ' + e.message }; } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const vd = (p, chip) => { const v = fn('_lpVisitDecision'); return v ? v(p, chip).level : 'no helper'; };
  const base = (brief, x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2027 Honda HR-V LX', condition: 'New',
    dealerId: '24399', store: 'Community Honda Lafayette', leadSource: 'Dealers WebSite', convState: 'call-followup', leadAgeDays: 0, hasOutbound: true,
    hasCustomerReply: false, totalNoteCount: 6, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '',
    relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 0 }, conversationBrief: brief, history: brief, context: '' }, x || {});

  console.log(' 1. they want a call, and only with numbers that fit (lead 2111261033):');
  const CWN = E(at(0, '3:58 PM'), 'NOTE', 'General Note', 'By: Rep Name not texting or emailing bc we spoke on phone, customer wants us to call if we think it\'s likely we can keep her within budget')
    + E(at(0, '3:53 PM'), 'NOTE', 'General Note', 'By: Rep Name wife is looking for an hrv, she is looking for a vehicle that comes out to 26-27k')
    + E(at(0, '3:50 PM'), 'AGENT', 'Outbound phone call (Contacted)', 'By: Rep Name otp') + MARK(at(0, '3:44 PM'));
  const g1 = go(base(CWN));
  check('the note -> THEY WANT A CALL: no times, the voicemail carries "whether we can keep it within what they told us"',
    () => [/^THEY WANT A CALL, AND ONLY WITH NUMBERS THAT FIT \(staff note, /m.test(g1.prompt), /we are working on whether we can keep it within what they told us, and we will call them with the answer/.test(g1.prompt)], [true, true]);
  check('...it holds the visit at level 3, and the Add Appt chip does not override it', () => [vd(g1.prompt, false), vd(g1.prompt, true)], [3, 3]);
  check('control: "customer wants a call tomorrow" (no condition, texting not ruled out) is no hold of this kind',
    () => /THEY WANT A CALL, AND ONLY/.test(go(base(E(at(0, '3:58 PM'), 'NOTE', 'General Note', 'By: Rep Name customer wants a call tomorrow afternoon') + MARK(at(0, '3:44 PM')))).prompt), false);

  console.log(' 2. what they want from the call: every excluded color, their price, new or used (lead 2110700703):');
  const HB = '6191';
  sb.__U = [U_('TEST0C1', '2027 Honda Civic Sport', 'Civic Sport', 'Rallye Red', 'new', 2027, 28290), U_('TEST0C2', '2027 Honda Civic Sport', 'Civic Sport', 'Platinum White Pearl', 'new', 2027, 28745),
    U_('TEST0C3', '2025 Honda Civic Sport', 'Civic Sport', 'Crystal Black Pearl', 'cpo', 2025, 24124), U_('TEST0C4', '2026 Honda Civic LX', 'Civic LX', 'Blue Lagoon Pearl', 'cpo', 2026, 24737),
    U_('TEST0C5', '2024 Honda Civic EX', 'Civic EX', 'Radiant Red', 'used', 2024, 22900), U_('TEST0C6', '2025 Honda Civic Sport', 'Civic Sport', 'Sonic Gray', 'used', 2025, 25842)];
  run('_lpValueFactCache["' + HB + '"] = { inv: { units: globalThis.__U, generated: new Date().toISOString() }, invSettledAt: Date.now(), fetchedAt: Date.now() };');
  const CALL = (note, after) => (after || '') + E(at(1, '10:19 AM'), 'AGENT', 'Outbound phone call (Contacted)', 'By: Rep Name ' + note) + MARK(at(1, '10:13 AM'));
  const civ = (brief) => base(brief, { vehicle: '2026 Honda Pilot', dealerId: HB, store: 'Community Honda Baytown', convState: 'active-follow-up' });
  const SENT = E(at(1, '10:26 AM'), 'AGENT', 'Outbound Text Message', 'Hi Test, these are some of our used Honda Civics. Please let me know what day next week works best for you.');
  const g2 = go(civ(CALL('She can\'t come this week is out of town. Is looking at honda civic, around 23k, and not blue or red. I will send her options', SENT)));
  const lot = (p) => ((p.match(/^- On our lot: [^\n]*/m) || p.match(/^- Neither our lot[^\n]*/m) || [''])[0]);
  check('"not blue or red" + "around 23k" + our "used Honda Civics" -> a used Civic, not blue or red, around $23,000',
    () => /The conversation is about a used Civic, not blue or red, around \$23,000 -- not the 2026 Honda Pilot/.test(g2.prompt), true);
  check('...the only car offered is the used one listed near their price (no red, no blue, nothing new, nothing over ~10%)',
    () => lot(g2.prompt), '- On our lot: 2025 Honda Civic Sport in Crystal Black Pearl (listed at $24,124). Name it and offer the visit here.');
  check('...and the prompt says never to call a car "around their price" unless its listed price says so',
    () => /^- THEIR PRICE: they said around \$23,000\. Only the cars listed below are near it, at the listed prices shown\. Never say a car is around, near or within their price/m.test(g2.prompt), true);
  check('control: no price, no condition -> the call reader lists Civics as before, still without the red one',
    () => { const l = lot(go(civ(CALL('Is looking at honda civic, not red.'))).prompt); return [/Rallye Red|Radiant Red/.test(l), /listed at/.test(l), /^- On our lot:/.test(l)]; }, [false, false, true]);

  console.log(' 3. a staff note with the car\'s own mileage and payoff makes the vehicle on the lead their trade (lead 2102596185):');
  const CORR = ' [RECORD CORRECTION: the Civic is this customer\'s VEHICLE OF INTEREST — the car they want to BUY. It is NOT their trade, and the CRM holds no trade vehicle for them.]';
  const TRADE = E(at(18, '3:45 PM'), 'NOTE', 'General Note', 'By: Rep Name Trade in- 2023 Honda Civic sport Hatchback 46,867 miles fully paid off-' + CORR)
    + E(at(18, '3:44 PM'), 'CUSTOMER', 'Inbound phone call', 'called in - looking into a vehicle with 7 seats, Captain chairs, wants to know how much it would be if she trades in her vehicle') + MARK(at(18, '3:27 PM'));
  const toy = (brief, x) => base(brief, Object.assign({ vehicle: '2023 Honda Civic', condition: 'Used', dealerId: '6189', store: 'Community Toyota Baytown', leadSource: 'Phone Up', convState: 'active-follow-up', leadAgeDays: 18 }, x || {}));
  const g3 = go(toy(TRADE));
  check('the vehicle field is emptied and the Civic becomes the trade; the record correction is taken off the note',
    () => [g3.d.vehicle, g3.d.tradeDescription, /RECORD CORRECTION/.test(g3.d.conversationBrief), /^Vehicle:\s+\(none specified\)/m.test(g3.prompt)], ['', '2023 Honda Civic', false, true]);
  check('...and the prompt says it is their trade, never something to offer or ask whether they still want',
    () => /THEIR TRADE IS THE 2023 HONDA CIVIC: the staff note \(\d\d\/\d\d\) gives its own details .*never offer it, ask whether they are still considering it, or name it as what they want/.test(g3.prompt), true);
  check('control: "trade value for the Civic" with no mileage or payoff leaves the vehicle on the lead alone',
    () => go(toy(E(at(18, '3:45 PM'), 'NOTE', 'General Note', 'By: Rep Name wants a trade value for the Civic' + CORR) + MARK(at(18, '3:27 PM')))).d.vehicle, '2023 Honda Civic');
  check('control: a lead with a stock number is a real unit -- left alone', () => go(toy(TRADE, { stockNum: 'TEST001A' })).d.vehicle, '2023 Honda Civic');

  console.log(' 4. they told us their timeline (option A):');
  const TL = (msg, daysAgo) => E(at(daysAgo || 16, '5:22 PM'), 'AGENT', 'Outbound Text Message', 'Test, when you are ready to revisit your midsize search, I can compare options.')
    + E(at(daysAgo || 16, '3:28 PM'), 'CUSTOMER', 'Inbound Text Message', msg) + MARK(at(18, '3:27 PM'));
  const SAID = 'Hi Rep, probably not any time soon I was just browsing the market because I do want a midsize vehicle but I am pretty sure I won\'t make the decision until ' + (new Date().getFullYear() + 1) + ' rolls around. Thank you again';
  const g4 = go(toy(TL(SAID), { vehicle: '' }));
  check('"won\'t make the decision until <next year>" -> THEY TOLD US THEIR TIMELINE: no "still looking?", one useful thing, check back closer to then',
    () => [/^THEY TOLD US THEIR TIMELINE \(\d\d\/\d\d\)/m.test(g4.prompt), /Do NOT ask whether they are still looking or still considering it, whether anything has changed or their search has shifted/.test(g4.prompt), /and that you will check back closer to then/.test(g4.prompt)], [true, true, true]);
  check('...a level-3 hold the Add Appt chip does not override', () => [vd(g4.prompt, false), vd(g4.prompt, true)], [3, 3]);
  check('control: "I can come by after work until 7" is no timeline', () => /THEY TOLD US THEIR TIMELINE/.test(go(toy(TL('I can come by after work until 7, is it still there?'), { vehicle: '' })).prompt), false);
  check('control: a year that has already come ("until ' + new Date().getFullYear() + '") is no timeline',
    () => /THEY TOLD US THEIR TIMELINE/.test(go(toy(TL('I won\'t be buying until ' + new Date().getFullYear() + '.'), { vehicle: '' })).prompt), false);

  console.log(' 5. they called us back and we missed them (lead 2108597971):');
  const CB = (after) => (after || '') + E(at(2, '5:48 PM'), 'CUSTOMER', 'Inbound phone call', 'called back for rep') + E(at(2, '5:46 PM'), 'CUSTOMER', 'Inbound phone call', 'System')
    + E(at(2, '5:44 PM'), 'CUSTOMER', 'Inbound phone call', 'calling Rep back') + E(at(2, '5:39 PM'), 'CUSTOMER', 'Inbound phone call', 'System')
    + E(at(2, '5:34 PM'), 'AGENT', 'Outbound phone call (Machine)', 'By: Rep Name Left message') + MARK(at(6, '6:17 AM'));
  const kia = (brief) => base(brief, { vehicle: '2027 Kia Telluride S', dealerId: '6190', store: 'Community Kia Baytown', leadSource: 'Dealertrack - Gubagoo Inc.', convState: 'active-follow-up', leadAgeDays: 6 });
  const LATER = E(at(1, '12:31 PM'), 'AGENT', 'Outbound Text Message', 'Hi Test, did you have a good day and time to stop in for the Telluride?') + E(at(1, '10:20 AM'), 'AGENT', 'Outbound phone call (Machine)', 'By: Rep Name Left message');
  const g5 = go(kia(CB(LATER)));
  check('their callbacks for the salesperson -> THEY CALLED US BACK AND WE MISSED THEM: sorry we missed them, connect with them, no video in its place',
    () => [/^THEY CALLED US BACK AND WE MISSED THEM: on \d\d\/\d\d at 5:48 PM they called the store back for Rep, trying several times that evening/m.test(g5.prompt),
      /ask when is a good time for Rep to call them/.test(g5.prompt), /Do not offer a video, photos or other options in place of the call/.test(g5.prompt)], [true, true, true]);
  check('control: a connected call since -> no block', () => /THEY CALLED US BACK AND WE MISSED/.test(go(kia(CB(E(at(1, '9:00 AM'), 'AGENT', 'Outbound phone call (Contacted)', 'By: Rep Name spoke with her')))).prompt), false);
  check('control: our own text since already owned it ("sorry we missed your call") -> no block',
    () => /THEY CALLED US BACK AND WE MISSED/.test(go(kia(CB(E(at(1, '9:00 AM'), 'AGENT', 'Outbound Text Message', 'Hi Test, sorry we missed your call yesterday! When is a good time for Rep to call?')))).prompt), false);
  const rf = fn('_lpBuildSmsRefinePrompt');
  check('the text rewrite carries all three: THEY CALLED US BACK, THEIR TIMELINE, THEY WANT A CALL',
    () => [/━━━ THEY CALLED US BACK ━━━/.test(String(rf('Test, sorry we missed you.\nAgent', '', g5.d))), /━━━ THEIR TIMELINE ━━━/.test(String(rf('Test, hello.\nAgent', '', g4.d))),
      /━━━ THEY WANT A CALL ━━━/.test(String(rf('Test, hello.\nAgent', '', g1.d)))], [true, true, true]);

  console.log(' 6. narrating our own messages, taken out before render in every format (lead 2108256455):');
  run('lastScrapedData = { leadAgeDays: 6, convState: "active-follow-up" };');
  const hg = (t, ch) => { const h = fn('_lpHouseGuard'); const ol = sb.console.log; sb.console.log = () => {}; try { return h ? h(t, ch || 'email') : 'no helper'; } finally { sb.console.log = ol; } };
  check('"I realize our messages haven\'t made it easy to respond. I\'ll keep this simple: what would you..." -> the question alone',
    () => hg('Test,\n\nWe\'ve been trying to reach you about the 2025 Toyota Camry SE, and I realize our messages haven\'t made it easy to respond. I\'ll keep this simple: what would you mainly use the Camry for?\n\nAgent Name'),
    'Test,\n\nWhat would you mainly use the Camry for?\n\nAgent Name');
  check('"...and I don\'t want to send another version of the same invitation." goes; the question after it stays',
    () => hg('Test,\n\nI know the team has tried to reach you about the Camry, and I don\'t want to send another version of the same invitation. If there\'s a detail you\'d like checked, what should I verify?\n\nAgent Name'),
    'Test,\n\nIf there\'s a detail you\'d like checked, what should I verify?\n\nAgent Name');
  check('the text too: "Test, I haven\'t heard back, so..." style narration goes from an SMS',
    () => hg('Test, I haven\'t heard back on the Camry. Is it still on your list?\nAgent', 'sms'), 'Test, is it still on your list?\nAgent');
  check('control: "We\'ve been trying to reach you about the Camry." stays (816)', () => hg('Test, we\'ve been trying to reach you about the Camry. Is it still on your list?\nAgent', 'sms'),
    'Test, we\'ve been trying to reach you about the Camry. Is it still on your list?\nAgent');
  check('control: a message that is nothing but narration is left as it was (never a greeting and a signature alone)',
    () => hg('Hi Test,\n\nI realize our messages haven\'t made it easy to respond.\n\nAgent Name'), 'Hi Test,\n\nI realize our messages haven\'t made it easy to respond.\n\nAgent Name');
  check('control: "I haven\'t heard back from the lender yet" stays', () => hg('Test, I haven\'t heard back from the lender yet. I will call you as soon as I do.\nAgent', 'sms'),
    'Test, I haven\'t heard back from the lender yet. I will call you as soon as I do.\nAgent');
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
