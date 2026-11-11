#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('cutoff-offer-tundra-869.test.js');
// (v9.7.869) OWNER-APPROVED 11/11 ("build 869, go with your recommendation on the cutoff also look at this lead dump. we have three
// SR5 Crewmax in stock LP says we don't"):
//  1. One same-day rule: a same-day time while one fits an hour out and an hour before closing; one left -> it plus a next-morning
//     time. Both times carry their day, pairText says the pair once, the next-morning pair varies by lead, and the next-day timing
//     block's copied sentence ("I wanted to get ahead of your schedule") is gone.
//  2. The Add Appt chip ends when the customer writes after it was pressed; a shipping question holds the visit even with the chip
//     (lead 2113611885).
//  3. "I know the Ridgeline messages haven't drawn a reply" is narration and comes out (lead 2098112593).
//  4. The trim is not the cab, the bed or the engine: "Tundra SR5 4dr CrewMax SB w/5.5' Bed (3.4L 6cyl Turbo 10A" is the feed's
//     "Tundra SR5" (lead 2113695730: "NONE in stock today" with four on the lot).
//  5. The Edmunds lease special in the customer's inquiry is the offer they asked about.
// Executes the shipped functions. Placeholder data only.
//
// Usage: node tests/cutoff-offer-tundra-869.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: cutoff-offer-tundra-869.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const pad = (n) => String(n).padStart(2, '0');
const E = (date, tag, title, body) => '[' + date + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (date) => '[' + date + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const ctParts = (t) => { const o = {}; new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long' })
  .formatToParts(new Date(t)).forEach(x => { o[x.type] = x.value; }); return o; };
// the most recent Wednesday (a weekday with a weekday after it), at h:m Central
const ctAt = (h, m) => { for (let back = 0; back < 8; back++) { const p = ctParts(Date.now() - back * 86400000); if (p.weekday !== 'Wednesday') continue;
  for (const off of [5, 6]) { const t = Date.UTC(+p.year, +p.month - 1, +p.day, h + off, m); const q = ctParts(t); if ((+q.hour % 24) === h && q.day === p.day) return t; } } return Date.now(); };
const stamp = (ms, clock) => { const p = ctParts(ms); return p.month + '/' + p.day + '/' + p.year + ' ' + clock; };

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const fn = (n) => run('typeof ' + n + ' === "function" ? ' + n + ' : null');
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const atClock = (ms, g) => { run('(function(){ var RD = globalThis.__RD = globalThis.__RD || Date, FIX = ' + ms + '; function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); } FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; Date = FD; })()');
    try { return g(); } finally { run('if (globalThis.__RD) Date = globalThis.__RD;'); } };
  const go = (lsd) => quiet(() => { try { run('activeFlags = new Set(); leadContext = "";'); sb.__L = lsd; run('lastScrapedData = globalThis.__L;'); sb.populateFromData(lsd); const ctx = String(run('leadContext') || '');
      return { d: lsd, ctx, prompt: String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: ctx }))) }; } catch (e) { return { d: lsd, ctx: '', prompt: 'THREW ' + e.message }; } });
  const cat = (h, m, store, seed) => atClock(ctAt(h, m), () => quiet(() => run('computeAppointmentTimes')(store, seed)));

  console.log(' 1. one same-day rule:');
  check('Baytown at 3:45 PM -> two same-day times (it gave up on today at about this hour before)', () => { const a = cat(15, 45, 'Community Honda Baytown'); return [a.dayLabel, /today$/.test(a.time1), /today$/.test(a.time2)]; }, ['today', true, true]);
  check('Baytown at 5:50 PM -> the one same-day time left (7:00 PM), paired with a next-morning time',
    () => { const a = cat(17, 50, 'Community Honda Baytown'); return [a.time1, /^9:15 AM [A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}$/.test(a.time2), /^7:00 PM today or 9:15 AM tomorrow \([A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}\)$/.test(a.pairText), a.pastSameDayCutoff]; },
    ['7:00 PM today', true, true, false]);
  check('Baytown at 6:05 PM -> no same-day time left: the status line\'s "too late" flag is set', () => { const a = cat(18, 5, 'Community Honda Baytown'); return [a.pastSameDayCutoff, /today/.test(a.time1)]; }, [true, false]);
  check('Lafayette at 4:00 PM -> same-day times (5:00 PM onward)', () => { const a = cat(16, 0, 'Community Honda Lafayette'); return [a.time1, a.dayLabel]; }, ['5:00 PM today', 'today']);
  check('next-day times both carry the day, and pairText names it once', () => { const a = cat(19, 30, 'Community Honda Baytown');
    return [/^\d{1,2}:\d{2} [AP]M [A-Z][a-z]+day, /.test(a.time1), /^\d{1,2}:\d{2} [AP]M [A-Z][a-z]+day, /.test(a.time2), /^\d{1,2}:\d{2} [AP]M or \d{1,2}:\d{2} [AP]M tomorrow \(/.test(a.pairText)]; }, [true, true, true]);
  check('the next-morning pair varies by lead (at least 3 different pairs across 10 leads); no lead -> 9:15 / 10:30 as before', () => {
    const seen = {}; for (let i = 0; i < 10; i++) seen[cat(19, 30, 'Community Honda Baytown', 'TEST00' + i + 'A').pairText.replace(/ tomorrow.*$/, '')] = 1;
    return [Object.keys(seen).length >= 3, /^9:15 AM or 10:30 AM/.test(cat(19, 30, 'Community Honda Baytown').pairText)]; }, [true, true]);
  const lead = (hist, x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Honda Accord SE', condition: 'New', dealerId: '6191',
    store: 'Community Honda Baytown', leadSource: 'Honda Website -', convState: 'active-follow-up', leadAgeDays: 2, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 8, phone: '(555) 010-0199', email: 'test@example.com',
    lastInboundMsg: '', relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 1 }, conversationBrief: hist, history: hist, context: '' }, x || {});
  const pAt = (h, m, x) => { const t = ctAt(h, m); return atClock(t, () => go(lead(E(stamp(t - 86400000, '10:00 AM'), 'CUSTOMER', 'Inbound Text Message', 'Is the Accord still there?') + MARK(stamp(t - 2 * 86400000, '9:00 AM')), x)).prompt); };
  const p345 = pAt(15, 45);
  check('the prompt at 3:45 PM: today is the default AND the suggested times are today\'s; no "Appointments are for tomorrow"',
    () => [/There is still usable time TODAY/.test(p345), /^Option: \d{1,2}:\d{2} [AP]M today$/m.test(p345), /Appointments are for tomorrow/.test(p345)], [true, true, false]);
  const p745 = pAt(19, 45);
  check('the next-day timing block: no "get ahead of your schedule"; the times said once with their day',
    () => [/get ahead of your schedule/.test(p745), /- The times, said once with their day: \d{1,2}:\d{2} [AP]M or \d{1,2}:\d{2} [AP]M tomorrow \(/.test(p745)], [false, true]);

  console.log(' 2. the Add Appt chip and a shipping question:');
  const on = fn('_lpAddApptOn');
  const T0 = Date.now() - 3 * 3600000;
  const chipLead = (hist) => ({ autoLeadId: 'TEST001A', history: hist, conversationBrief: hist, context: '' });
  const nowStamp = (minsAgo) => { const d = new Date(Date.now() - minsAgo * 60000); let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear() + ' ' + h + ':' + pad(d.getMinutes()) + ' ' + ap; };
  run('window._lpAddApptLeadId = "TEST001A"; window._lpAddApptAt = ' + T0 + ';');
  check('pressed 3 hours ago, the customer wrote 1 hour ago -> the chip has ended', () => quiet(() => on ? on(chipLead(E(nowStamp(60), 'CUSTOMER', 'Inbound Text Message', 'Is there any warranty left? Can it be shipped to Arkansas?') + MARK(nowStamp(600)))) : 'no helper'), false);
  check('control: no message from them since the press -> still on', () => quiet(() => on ? on(chipLead(E(nowStamp(240), 'CUSTOMER', 'Inbound Text Message', 'Hi') + MARK(nowStamp(600)))) : 'no helper'), true);
  run('window._lpAddApptLeadId = ""; window._lpAddApptAt = 0;');
  const av = fn('_lpApplyVisitDecision');
  const SHIPLINE = '🚚 THEY ASKED ABOUT GETTING THE CAR TO THEM: "can it be shipped to Arkansas". It is their question -- answer it in this message.';
  check('a shipping question holds the visit at level 3 (no visit ask, no times)', () => quiet(() => { const r = av(['CURRENT TIME: x', SHIPLINE].join('\n'), false); return [r.level, r.owner]; }), [3, 'the SHIPPING question (they are buying from a distance)']);
  check('...and the Add Appt chip does not set it aside', () => quiet(() => av(['CURRENT TIME: x', SHIPLINE].join('\n'), true).level), 3);

  console.log(' 3. narrating their silence:');
  run('lastScrapedData = { leadAgeDays: 29, convState: "active-follow-up" };');
  const hg = (t) => quiet(() => { const h = fn('_lpHouseGuard'); return h ? h(t, 'email') : 'no helper'; });
  check('"I know the Ridgeline messages haven\'t drawn a reply, so ..." comes out; the rest stays',
    () => hg('Subject: x\n\nTest,\n\nI know the Ridgeline messages haven\'t drawn a reply, so I\'ll leave the decision with you. The 2026 Ridgeline TrailSport is here. Would a video be useful?\n\nAgent Name'),
    'Subject: x\n\nTest,\n\nThe 2026 Ridgeline TrailSport is here. Would a video be useful?\n\nAgent Name');

  console.log(' 4. the trim is not the cab, the bed or the engine:');
  const tr = (v) => { const t = fn('_lpTrimOf'); return t ? t(v).disp : 'no helper'; };
  check('"2026 Toyota Tundra SR5 4dr CrewMax SB w/5.5\' Bed (3.4L 6cyl Turbo 10A" -> SR5', () => tr("2026 Toyota Tundra SR5 4dr CrewMax SB w/5.5' Bed (3.4L 6cyl Turbo 10A"), 'SR5');
  check('"Tacoma TRD Off Road Double Cab 5\' Bed V6" -> TRD Off Road; "Tundra SR5 4.6L V8" -> SR5', () => [tr("2026 Toyota Tacoma TRD Off Road Double Cab 5' Bed V6"), tr('2017 Toyota Tundra SR5 4.6L V8')], ['TRD Off Road', 'SR5']);
  check('control: "Tundra Hybrid Limited" keeps Hybrid; "Accord EX-L" is unchanged', () => [tr('2026 Toyota Tundra Hybrid Limited'), tr('2026 Honda Accord EX-L')], ['Hybrid Limited', 'EX-L']);

  console.log(' 5. lead 2113695730: the Tundra SR5 and its Edmunds lease special:');
  const TB = run('Object.keys(DEALER_ID_MAP).filter(function (k) { return /toyota/i.test(String(DEALER_ID_MAP[k])); })[0]') || '6189';
  const U_ = (stock, vehicle, model, color, cond, year) => ({ stock, vin: '', vehicle, year, make: 'Toyota', model, condition: cond, certified: cond === 'cpo', class: 'Truck, Full-Size Pick-up', body: '4D CrewMax', color, interior: 'Black Cloth', odometer: 10, daysOnLot: 20, price: 52000, stockNum: stock });
  const iso = (days) => new Date(Date.now() + days * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  sb.__U = [U_('TEST0T1', '2026 Toyota Tundra SR5', 'Tundra SR5', 'Midnight Black Metallic', 'new', 2026), U_('TEST0T2', '2026 Toyota Tundra SR5', 'Tundra SR5', 'Midnight Black Metallic', 'new', 2026),
    U_('TEST0T3', '2026 Toyota Tundra SR5', 'Tundra SR5', 'Ice Cap', 'new', 2026), U_('TEST0T4', '2026 Toyota Tundra Limited', 'Tundra Limited', 'Celestial Silver Metallic', 'new', 2026),
    U_('TEST0T5', '2024 Toyota Tundra SR5', 'Tundra SR5', 'Magnetic Gray Metallic', 'used', 2024)];
  sb.__I = [{ model: 'Tundra', year: '2026', line: 'Tundra — $439/mo 36 mo lease ($3,999 due at signing) — applies to 4WD SR5', expires: iso(20) },
    { model: 'Tundra', year: '2026', line: 'Tundra — $439/mo 39 mo lease ($3,999 due at signing) — applies to 4WD SR5', expires: iso(20) },
    { model: 'Tundra', year: '2026', line: 'Tundra — 2.99% APR for 60 mos — excludes Platinum, 1794', expires: iso(20) }];
  run('_lpValueFactCache["' + TB + '"] = { vf: { store: "Toyota Baytown", incentives: globalThis.__I }, inv: { units: globalThis.__U, generated: new Date().toISOString() }, invSettledAt: Date.now(), fetchedAt: Date.now() };');
  const ASK = 'is interested in the 2026 Toyota Tundra SR5 manufacturer-advertised lease special for $399 per month. Lease program details: $399 per month; 39 month term; $4,999 due at signing.';
  const BOT = 'By: Assistant Name Virtual Assistant Community Toyota Hi Test, thanks for your interest! Would you be able to come in Wednesday at 10:00 AM?';
  const nowS = (minsAgo, clock) => { const p = ctParts(Date.now() - minsAgo * 60000); return p.month + '/' + p.day + '/' + p.year + ' ' + clock; };
  const H = E(nowS(30, '8:40 AM'), 'AGENT', 'Outbound Text Message', BOT) + E(nowS(31, '8:39 AM'), 'CUSTOMER REQUEST FROM INQUIRY', 'Lead Received', ASK) + MARK(nowS(31, '8:38 AM'));
  const tl = go(lead('CUSTOMER\'S INQUIRY — the customer\'s own words when they submitted this lead. This is what they actually asked for; address it directly:\n"' + ASK + '"\n\n' + H,
    { vehicle: "2026 Toyota Tundra SR5 4dr CrewMax SB w/5.5' Bed (3.4L 6cyl Turbo 10A", dealerId: TB, store: 'Community Toyota Baytown', leadSource: 'Edmunds', convState: 'first-touch', leadAgeDays: 0, hasCustomerReply: false,
      lastInboundMsg: ASK, history: H, outboundSends: [{ body: BOT, date: nowS(30, '8:40 AM') }], customerState: 'TX' }));
  check('what we have: the 2026 Tundra SR5 is IN STOCK (three, with their paint), not "NONE in stock today"',
    () => [/- The 2026 Tundra SR5: IN STOCK -- 2026 Tundra SR5 \(Midnight Black Metallic[^)]*\) x2; 2026 Tundra SR5 \(Ice Cap[^)]*\)/.test(tl.prompt), /SR5 CrewMax SB: NONE in stock/.test(tl.prompt)], [true, false]);
  check('the offer they asked about opens the context: the SR5 lease at $399 a month for 39 months with $4,999 due',
    () => tl.ctx.indexOf('💲 THE OFFER THEY REQUESTED A QUOTE ON: on Edmunds this customer picked one offer and asked for a quote on it -- the 2026 Tundra SR5, the lease at $399 a month for 39 months with $4,999 due at signing.') === 0, true);
  check('...not in the store\'s list: "the offer you saw on Edmunds", and the store\'s own Tundra leases named beside it',
    () => [/call it "the offer you saw on Edmunds" and say you will confirm it applies to them\. Do not state the rate as ours\./.test(tl.prompt),
      /- The store's own current lease offers on the Tundra: Tundra — \$439\/mo 36 mo lease \(\$3,999 due at signing\) — applies to 4WD SR5 \| Tundra — \$439\/mo 39 mo lease/.test(tl.prompt)], [true, true]);
  check('...and the lot: the new SR5s only (not the Limited, not the used one)', () => /- On the lot today \(this store's inventory feed, new units\): Tundra SR5 \(Midnight Black Metallic\) x2; Tundra SR5 \(Ice Cap\)\. You may name these/.test(tl.prompt), true);
  const eo = fn('_lpEdmundsOffer');
  check('control: an ordinary Edmunds inquiry with no advertised special -> no offer record', () => eo ? eo('is interested in the 2026 Toyota Tundra SR5. Please contact me.') : 'no helper', null);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
