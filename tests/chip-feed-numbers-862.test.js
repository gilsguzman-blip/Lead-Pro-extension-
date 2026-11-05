#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('chip-feed-numbers-862.test.js');
// (v9.7.862) OWNER-APPROVED 11/5, from the 11/4 report and Gil's grabs (logs 403-406):
//  (1) The Add Appt Ask chip was pressed three times on 11/4 and no draft named a time (leads 2109496366, 2110248930,
//      2110383482): it deferred to every hold. It now sets the soft holds aside (first touch, pitch already out, special trip,
//      relationship reading, times withheld) and gives two times -- the next open day or later for a customer a long way out --
//      and still yields to the hard ones (deal condition, paused, can't come in, will call us, a booked time, a named day).
//  (2) The unit on the lead answers what the customer asked about it. Kia lead 2110446873 asked whether the K5 GT-Line has red
//      seats or a black interior; the record says Black Cloth -- but Gil, 11/5: Kia's records list a Sportage's or a K5
//      GT-Line's interior as black or gray even when it is red, so on those it is "we'll check", never a no. Honda lead
//      2109496366 asked for red with none in the feed: "we don't have one in red right now", not "I'm checking"; a note that they
//      want ONLY red means no other colors. Its lead form ("I am ready to place a deposit and move forward" if we match $40,000)
//      had been read as a deposit placed and set the unit aside.
//  (3) Mileage is never their number: "your quote was on 12,000 miles per year and we only need 10,000" became "$12,000", and a
//      Tekion link's deal number became "a price of $68627" (lead 2110248930).
//  (4) A customer working the numbers (deal sheet, out-the-door, single pay, credit application) gets the numbers, not a video
//      walkaround; and the text rewrite may not add a video the first draft did not offer.
//  (5) The made-up openers ("I know my last note...", "I haven't heard back", "I'll keep this simple") are banned, and (6) the
//      equipment middle ground (Gil, 11/4): a new car's trim may be described, a used car's equipment is confirmed, not stated.
// Executes the shipped functions (the visit decision, the interior line, populateFromData, buildUserPrompt through the panel
// payload, the price reader, the SMS rewrite prompt, the system prompt) and the shipped deposit-scan patterns. Placeholder data.
//
// Usage: node tests/chip-feed-numbers-862.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: chip-feed-numbers-862.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const E = (date, tag, title, body) => '[' + date + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (when) => '[' + when + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const U_ = (stock, vehicle, model, color, interior, cond, year) => ({ stock, vin: '', vehicle, year: year || 2027, make: vehicle.split(' ')[1], model, condition: cond || 'new',
  certified: false, class: 'SUV', body: '4D Sport Utility', color, interior, odometer: 10, daysOnLot: 30, price: 40000, stockNum: stock });
// A finished prompt, cut down to the lines the visit decision reads.
const PROMPT = (holds) => ['DATE: Wednesday, November 4 2026', 'CURRENT TIME: 8:40 AM Central on TODAY (Wednesday 11/4)',
  'STORE STATUS RIGHT NOW: OPEN. Closes at 8 PM. OFFER THE SOONEST REAL OPENING FIRST. There is still usable time TODAY, so today is the default.'].concat(holds).join('\n');
const H_FIRST = 'FIRST HUMAN TOUCH — LIGHT ASK, NO TIMES: introduce yourself.';
const H_PITCH = 'OUR PITCH IS ALREADY OUT AND UNANSWERED: our 11/03 text offered times.';
const H_TRIP = '- A VISIT IS A SPECIAL TRIP FOR THIS CUSTOMER: they live more than 75 miles from the store.';
const H_DEAL = 'HARD RULE: do NOT offer an appointment time until the deal condition is met.';
const H_CALL = 'THEY SAID THEY WILL CALL US BACK (on the 11/03 call): do not push a time.';

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const fn = (n) => run('typeof ' + n + ' === "function" ? ' + n + ' : null');
  const setUnits = (dl, u) => { sb.__U = u; run('_lpValueFactCache["' + dl + '"] = { inv: { units: globalThis.__U, generated: new Date().toISOString() }, invSettledAt: Date.now(), fetchedAt: Date.now() };'); };
  const go = (lsd) => { const logs = []; const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...q) => logs.push(q.join(' ')); sb.console.warn = () => {};
    try { run('activeFlags = new Set(); leadContext = "";'); sb.populateFromData(lsd); const ctx = String(run('leadContext') || '');
      return { ctx, prompt: String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: ctx }))), logs: logs.join('\n') }; }
    catch (e) { return { ctx: '', prompt: '', logs: 'THREW ' + e.message }; } finally { sb.console.log = ol; sb.console.warn = ow; } };

  console.log(' 1. the Add Appt Ask chip:');
  const av = fn('_lpApplyVisitDecision');
  const dec = (holds, chip) => { const r = av ? av(PROMPT(holds), chip) : { level: 'no helper', text: '' }; return [r.level, /^VISIT DECISION FOR THIS MESSAGE: the agent asked for the appointment -- close with two specific appointment times inside store hours \(today if there is usable time left\)/m.test(r.text)]; };
  check('first touch + pitch already out, chip on -> no hold; the decision line asks for two times, today if there is time', () => dec([H_FIRST, H_PITCH], true), [0, true]);
  check('a customer 75+ miles out, chip on -> two times from the next open day', () => /\(the next open day or later, not later today -- the visit is a trip for them\)/.test(av(PROMPT([H_TRIP]), true).text), true);
  check('control: a deal condition still holds with the chip on (level 3), and so does "they will call us back" (level 2)', () => [dec([H_FIRST, H_DEAL], true)[0], dec([H_CALL], true)[0]], [3, 2]);
  check('control: without the chip, the first touch holds the times as before (level 2)', () => dec([H_FIRST, H_PITCH], false)[0], 2);
  check('buildUserPrompt passes the chip (the sticky lead id) to the visit decision', () => /_lpApplyVisitDecision\(_vdOut, _vdChip\)/.test(src) && /var _vdChip = \(typeof _lpAddApptOn === 'function'\) && _lpAddApptOn\(data\)/.test(src), true);

  console.log(' 2. the unit on the lead answers what they asked:');
  const KIA = '6190', HON = '6191';
  setUnits(KIA, [U_('TEST0K1', '2024 Kia K5 GT-Line', 'K5 GT-Line', 'Wolf Gray', 'Black Cloth', 'used', 2024), U_('TEST0K2', '2025 Kia K5 LXS', 'K5 LXS', 'Glacial White Pearl', 'Black Cloth', 'used', 2025),
    U_('TEST0S1', '2026 Kia Sportage X-Line', 'Sportage X-Line', 'Wolf Gray', 'Gray', 'new', 2026)]);
  setUnits(HON, [U_('TEST0H1', '2027 Honda CR-V Hybrid Sport-L', 'CR-V Hybrid Sport-L', 'Urban Gray Pearl', 'Black Leather'), U_('TEST0H2', '2027 Honda CR-V Hybrid Sport-L', 'CR-V Hybrid Sport-L', 'Meteorite Gray Metallic', 'Black Leather'),
    U_('TEST0H3', '2026 Honda CR-V Hybrid Sport-L', 'CR-V Hybrid Sport-L', 'Platinum White Pearl', 'Black Leather', 'new', 2026), U_('TEST0H4', '2027 Honda Pilot Touring', 'Pilot Touring', 'Black', 'Gray')]);
  const SL = fn('_lpStockInteriorLine');
  const unit = (dl, stock, vehicle, said) => ({ dealerId: dl, stockNum: stock, _pdUnitStock: stock, _pdStatus: 'A', vehicle, lastInboundMsg: said, history: '', context: '', conversationBrief: '' });
  const il = (d) => { const r = SL ? SL(d) : 'no helper'; return r && r.text ? r.text : r; };
  check('Honda, black interior asked, the record says Black Leather -> "it has the black leather interior", stated as the answer', () => {
    const t = il(unit(HON, 'TEST0H1', '2027 Honda CR-V Hybrid Sport-L', 'Does it have the black leather interior?')); return [/lists the interior as Black Leather/.test(t), /That is the black interior they asked about/.test(t), /do not write "I'm checking"/.test(t)]; }, [true, true, true]);
  check('Honda, red seats asked -> it does not have them, said plainly', () => /It does not have the red interior: say so plainly/.test(il(unit(HON, 'TEST0H1', '2027 Honda CR-V Hybrid Sport-L', 'Does it have red seats?'))), true);
  check('Kia K5 GT-Line, red seats asked (lead 2110446873) -> we will check, never a no and never "it is black"', () => {
    const t = il(unit(KIA, 'TEST0K1', '2024 Kia K5 GT-Line', 'Does this vehicle actually have the full red interior package with red seats, or is the interior black?'));
    return [/Kia's inventory records list the interior of a K5 GT-Line as black or gray even when the car has the red interior/.test(t), /never say it does not have the red interior, and never say it is black or gray/.test(t)]; }, [true, true]);
  check('Kia Sportage, any interior asked -> we will check', () => /interior of a Sportage as black or gray/.test(il(unit(KIA, 'TEST0S1', '2026 Kia Sportage X-Line', 'Is the interior black?'))), true);
  check('control: a Kia K5 LXS (not a GT-Line) answers from the record', () => /lists the interior as Black Cloth/.test(il(unit(KIA, 'TEST0K2', '2025 Kia K5 LXS', 'Does it have black seats?'))), true);
  check('control: nothing asked about the interior -> no line', () => il(unit(HON, 'TEST0H1', '2027 Honda CR-V Hybrid Sport-L', 'Is it still available?')), null);
  const crv = (notes) => { const h = (notes || '') + E('11/03/2026 9:27 PM', 'CUSTOMER', 'Inbound Text Message', 'Do you have it in red?') + MARK('11/03/2026 9:20 PM');
    return { autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2027 Honda CR-V Hybrid Sport-L', condition: 'New',
      stockNum: 'TEST0H1', _pdUnitStock: 'TEST0H1', _pdStatus: 'A', color: 'Urban Gray Pearl', dealerId: HON, store: 'Community Honda Baytown', leadSource: 'Internet',
      convState: 'active-follow-up', leadAgeDays: 1, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 8, phone: '(555) 010-0199', email: 'test@example.com',
      lastInboundMsg: 'Do you have it in red?', relationshipSignals: { unansweredQuestions: [], customerCommitments: [], agentCommitments: [], lastInboundAgeDays: 0.5 },
      history: h, conversationBrief: h }; };
  const c1 = go(crv());
  check('red asked, none in the feed -> "we don\'t have one in red right now", with the same trim in the colors we have', () => [
    /COLOR MISMATCH — NO RED ONE IN STOCK/.test(c1.prompt), /not "I'm checking" or "let me locate one"/.test(c1.prompt),
    /The same trim in the colors we do have: 2027 in Urban Gray Pearl; 2027 in Meteorite Gray Metallic; 2026 in Platinum White Pearl\./.test(c1.prompt)], [true, true, true]);
  const c2 = go(crv(E('11/04/2026 9:58 AM', 'NOTE', 'General Note', 'By: Rep Name Working with two other stores. Only Wants red Crv sport L and wants $40k otd')));
  check('a note says they want ONLY red -> no other colors, keep watch', () => [/A note says they want ONLY red: do not offer the other colors/.test(c2.prompt), /The same trim in the colors we do have/.test(c2.prompt)], [true, false]);
  const pend = src.match(/var _pnPendRx = (\/.*\/[a-z]*);/), fut = src.match(/var _pnFutureRx = (\/.*\/[a-z]*);/);
  const isPend = (t) => { const P = eval(pend[1]), F = eval(fut[1]); const m = t.match(P); return !!(m && !F.test(t.slice(Math.max(0, m.index - 30), m.index))); };
  check('the deposit scan: "I am ready to place a deposit and move forward" is not a deposit placed; "Customer placed a deposit" is', () =>
    [isPend('If you can match or beat a $40,000 out-the-door price, I am ready to place a deposit and move forward right away.'), isPend('Customer placed a $500 deposit on it today.')], [false, true]);
  check('the deposit scan skips the customer\'s own lead form ("Lead received")', () => /if \(\/\^\\s\*lead received\\b\/i\.test\(t\)\) return false;/.test(src), true);

  console.log(' 3. mileage is never their number:');
  const ago = (days, hm) => { const d = new Date(Date.now() - days * 86400000); return (d.getMonth() + 1 + '').padStart(2, '0') + '/' + (d.getDate() + '').padStart(2, '0') + '/' + d.getFullYear() + ' ' + hm; };
  const pl = (last, ents) => ({ name: 'Test Buyer', agent: 'Agent Name', vehicle: '2026 Honda Prologue EX', condition: 'New', dealerId: HON, store: 'Community Honda Baytown', leadSource: 'Internet',
    convState: 'active-follow-up', leadAgeDays: 2, hasOutbound: true, hasCustomerReply: true, relationshipSignals: { lastInboundAgeDays: 0 }, history: '', context: '',
    conversationBrief: ents.join('\n'), lastInboundMsg: last });
  const ours = E(ago(1, '4:08 PM'), 'AGENT', 'Email reply to prospect', 'Hi Test, the proposal Rep sent is our best deal. Single pay lease: $13,000.32.');
  const link = E(ago(1, '3:35 PM'), 'NOTE', 'General Note', 'By: Rep Name https://app.example-dms.com/sales/deals/details/68627');
  const MILES = 'And the other thing is your quote was on 12,000 miles per year and we only need 10,000 and that was the quote from the other dealer';
  const ppr = (d) => { const r = sb._lpPricePushback(d); return r ? [r.counter, r.counterText, r.figure] : null; };
  check('"12,000 miles per year ... we only need 10,000" -> no counter of theirs', () => { const r = ppr(pl(MILES, [E(ago(0, '4:10 PM'), 'CUSTOMER', 'Email reply from prospect', MILES), ours, link])); return r ? r[0] : r; }, null);
  check('a link\'s digits are not our price: a note with only "deals/details/68627" in it gave them no figure', () =>
    ppr(pl('Can you do $11,400 on the single pay?', [E(ago(0, '4:10 PM'), 'CUSTOMER', 'Email reply from prospect', 'Can you do $11,400 on the single pay?'), link])), null);
  check('control: with the $13,000.32 we sent, their $11,400 is their counter and ours is the figure', () =>
    ppr(pl('Can you do $11,400 on the single pay?', [E(ago(0, '4:10 PM'), 'CUSTOMER', 'Email reply from prospect', 'Can you do $11,400 on the single pay?'), ours, link])), [true, '11,400', '$13,000.32']);

  console.log(' 4. the numbers, not a video:');
  const nt = fn('_lpNumbersTalk');
  const said = (t) => nt ? nt({ history: E(ago(0, '9:00 AM'), 'CUSTOMER', 'Email reply from prospect', t) + MARK(ago(1, '9:00 AM')), conversationBrief: '', relationshipSignals: {} }) : 'no helper';
  check('a deal sheet, an out-the-door ask, a single pay -> working the numbers; "is it still there?" -> not', () =>
    [!!said('Here is the deal sheet from the other dealer.'), !!said('I am requesting your best out-the-door (OTD) price.'), !!said('The single pay option is 10400.'), said('Is it still there?')], [true, true, true, '']);
  check('the 75+ mile line under it: the numbers first, no video walkaround or photos', () => /they are working the numbers with us, so offer no video walkaround or photos in this message/.test(src), true);
  const rf = fn('_lpBuildSmsRefinePrompt');
  const rp = (p1) => { try { return String(rf(p1, 'Hi Test,\n\nThe numbers are attached.', { history: '', relationshipSignals: {} })); } catch (e) { return 'THREW ' + e.message; } };
  check('the text rewrite may not add a video the first draft did not offer; a first draft that offers one keeps it', () =>
    [/━━━ NO NEW OFFER ━━━/.test(rp('Test, I am taking your number to my manager. Agent')), /━━━ NO NEW OFFER ━━━/.test(rp('Test, would a video walkaround help? Agent'))], [true, false]);

  console.log(' 5. openers, and equipment:');
  const sys = String(run('buildSystemPrompt("bdc")') || '');
  check('the system prompt bans narrating our own messages or their silence', () => /NEVER narrate our own earlier messages or their silence: no "I know my last note\.\.\.", "I know I've reached out\.\.\.", "I haven't heard back"/.test(sys), true);
  check('the system prompt\'s equipment rule: a new car\'s trim may be described, a used car\'s equipment is confirmed', () =>
    [/For a NEW vehicle you may say what its TRIM normally comes with/.test(sys), /For a USED or certified vehicle never state its equipment -- offer to confirm it/.test(sys)], [true, true]);
  check('the text rewrite carries the opener ban too', () => /NEVER narrate our own earlier messages or their silence/.test(rp('Test, here are the numbers. Agent')) || /'  \\u2022 NEVER narrate our own earlier messages or their silence/.test(src), true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
