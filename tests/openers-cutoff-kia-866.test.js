#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('openers-cutoff-kia-866.test.js');
// (v9.7.866) OWNER-APPROVED 11/10 ("build 866 yes all Kia's show black and not the alternative option color on their description
// from the feed"), from the 11/9 report:
//  (a) Openers: "I reached out about", "I'm reaching out about", "I wanted to share that" (leads 2099092351, 2096792360, 2097496025,
//      2070752744) -- the standing rule, the rewrite's own instructions, and a render guard for the last one.
//  (b) A VIN typed into the stock-number field is matched to the feed by VIN (lead 2112437423: "I can't confirm it's at our store").
//  (c) The same question twice, in more wordings: "...hoping to get into?" (lead 2112726385).
//  (d) "tomorrow at 9:15 AM or Tuesday, November 10, at 10:30 AM" -- one day, named once (lead 2112726385).
//  (e) One same-day cutoff: past the store's last same-day appointment time the status line stops saying "there is still usable
//      time TODAY" ("tonight at 7:30" at 7:11 PM, leads 2108867424, 2103434989, 2108761432), and the chip line follows it.
//  (f) A feedback row for a generation that never rendered keeps its store, agent and lead, and is "incomplete", not "down"
//      (lead 2112556296).
//  (g) Kia interiors: the feed lists black or gray whatever the car has, so no Kia interior is printed or asserted (lead 2112556296).
// Executes the build's own functions. Placeholder data.
//
// Usage: node tests/openers-cutoff-kia-866.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: openers-cutoff-kia-866.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const pad = (n) => String(n).padStart(2, '0');
const E = (date, tag, title, body) => '[' + date + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (date) => '[' + date + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const U_ = (stock, vehicle, model, color, interior, cond, year, vin) => ({ stock, vin: vin || '', vehicle, year, make: vehicle.split(' ')[1], model, condition: cond, certified: cond === 'cpo',
  class: 'SUV', body: '4D Sport Utility', color, interior, odometer: 10, daysOnLot: 30, price: 42000, stockNum: stock });
// Central-time clock helpers: the most recent day that is not a Sunday (or is the weekday asked for), at h:m Central.
const ctParts = (t) => { const o = {}; new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long', })
  .formatToParts(new Date(t)).forEach(x => { o[x.type] = x.value; }); return o; };
const ctAt = (h, m, dow) => { for (let back = 0; back < 8; back++) { const p = ctParts(Date.now() - back * 86400000); if (dow ? p.weekday !== dow : p.weekday === 'Sunday') continue;
  for (const off of [5, 6]) { const t = Date.UTC(+p.year, +p.month - 1, +p.day, h + off, m); const q = ctParts(t); if ((+q.hour % 24) === h && q.day === p.day) return t; } } return Date.now(); };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TESTVIN = 'TESTV1N0000000001', OTHERVIN = 'TESTV1N0000000002';   // 17 characters, VIN alphabet, not real

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const fn = (n) => run('typeof ' + n + ' === "function" ? ' + n + ' : null');
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const go = (lsd) => quiet(() => { try { run('activeFlags = new Set(); leadContext = "";'); sb.__L = lsd; run('lastScrapedData = globalThis.__L;'); sb.populateFromData(lsd); const ctx = String(run('leadContext') || '');
      return { d: lsd, ctx, prompt: String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: ctx }))) }; } catch (e) { return { d: lsd, ctx: '', prompt: 'THREW ' + e.message }; } });
  const setUnits = (dl, u) => { sb.__U = u; run('_lpValueFactCache["' + dl + '"] = { inv: { units: globalThis.__U, generated: new Date().toISOString() }, invSettledAt: Date.now(), fetchedAt: Date.now() };'); };
  const atClock = (ms, g) => { run('(function(){ var RD = globalThis.__RD = globalThis.__RD || Date, FIX = ' + ms + '; function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); } FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; Date = FD; })()');
    try { return g(); } finally { run('if (globalThis.__RD) Date = globalThis.__RD;'); } };
  const stamp = (ms, clock) => { const p = ctParts(ms); return p.month + '/' + p.day + '/' + p.year + ' ' + clock; };
  const base = (brief, x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Honda Accord SE', condition: 'New',
    dealerId: '6191', store: 'Community Honda Baytown', leadSource: 'Honda Website -', convState: 'active-follow-up', leadAgeDays: 2, hasOutbound: true, hasCustomerReply: true,
    totalNoteCount: 8, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '', relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 1 },
    conversationBrief: brief, history: brief, context: '' }, x || {});
  run('lastScrapedData = { leadAgeDays: 9, convState: "active-follow-up" };');
  const hg = (t, ch) => quiet(() => { const h = fn('_lpHouseGuard'); return h ? h(t, ch || 'sms') : 'no helper'; });

  console.log(' (a) how a message opens:');
  const sys = String(run('buildSystemPrompt("bdc")') || ''), rsys = String(run('buildSystemPromptSmsRefine("Agent", "Community Kia Baytown", "(555) 010-0100")') || '');
  check('the standing rule names the three openers: open on the thing itself',
    () => /Open on the thing itself -- the car, the offer, the answer or the question: never "I reached out about\.\.\.", "I'm reaching out about\.\.\." or "I wanted to share that\.\.\."/.test(sys), true);
  const rf = fn('_lpBuildSmsRefinePrompt');
  const rp = quiet(() => rf ? String(rf('Test, the EV9 is here. Want to come see it?\nAgent', 'Subject: x\n\nHi Test,\n\nThe EV9 is here.\n\nAgent Name', base('', { vehicle: '2026 Kia EV9', dealerId: '6190', store: 'Community Kia Baytown' }))) : 'no helper');
  check('the rewrite is told the same, in its own instructions', () => /━━━ HOW IT OPENS ━━━\nOpen on the thing itself -- the car, the offer, the answer or the question\. Never "I reached out about", "I'm reaching out about" or "I wanted to share that"\./.test(rp), true);
  check('control: the rewrite\'s system prompt is unchanged in size (the sms-refine bound still holds: 84667 / length > 10)', () => 84667 / rsys.length > 10, true);
  check('"I wanted to share that the 2026 EV9 has ..." at the start of a sentence -> "The 2026 EV9 has ..."',
    () => hg('Hi Test. I wanted to share that the 2026 EV9 has a $7,500 lease offer this month. Would you like the details?\nAgent'),
    'Hi Test. The 2026 EV9 has a $7,500 lease offer this month. Would you like the details?\nAgent');
  check('...and after the name: "Test, I wanted to share that the EV9 ..." -> "Test, the EV9 ..."',
    () => hg('Test, I wanted to share that the EV9 has a $7,500 lease offer this month. Would you like the details?\nAgent'),
    'Test, the EV9 has a $7,500 lease offer this month. Would you like the details?\nAgent');
  check('control: "I wanted to share the video with you" is not that opener -> left alone',
    () => hg('Test, I wanted to share the video with you before you come in. Did it come through?\nAgent'), 'Test, I wanted to share the video with you before you come in. Did it come through?\nAgent');

  console.log(' (b) a VIN in the stock-number field:');
  const TB = '2969';
  const TOY = run('Object.keys(DEALER_ID_MAP).filter(function (k) { return /toyota/i.test(String(DEALER_ID_MAP[k])); })[0]') || TB;
  setUnits(TOY, [U_('TEST0T1', '2026 Toyota 4Runner SR5', '4Runner SR5', 'Ice Cap', 'Black', 'new', 2026, TESTVIN), U_('TEST0T2', '2026 Toyota 4Runner TRD', '4Runner TRD', 'Underground', 'Black', 'new', 2026, OTHERVIN)]);
  const fuc = fn('_lpFeedUnitCheck');
  const vd = (x) => Object.assign({ dealerId: TOY, stockNum: TESTVIN, vin: TESTVIN, vehicle: '2026 Toyota 4Runner SR5' }, x || {});
  check('the stock field holds the unit\'s VIN -> the feed finds the unit by VIN and confirms it',
    () => { const r = quiet(() => fuc(vd())); return [r.inFeed, r.confirmed, r.unit && r.unit.stock]; }, [true, true, 'TEST0T1']);
  check('populateFromData gives the lead that unit\'s stock number (every later reader sees the real one)',
    () => { const d = base(MARK(stamp(Date.now() - 86400000, '9:00 AM')), vd({ store: 'Community Toyota Baytown', vin: '' })); go(d); return [d.stockNum, d.vin]; }, ['TEST0T1', TESTVIN]);
  check('control: a VIN the feed does not hold -> not in the feed, the field untouched',
    () => { const d = base(MARK(stamp(Date.now() - 86400000, '9:00 AM')), vd({ store: 'Community Toyota Baytown', stockNum: 'TESTV1N0000000009', vin: '' })); go(d); return [d.stockNum, quiet(() => fuc(d)).inFeed]; }, ['TESTV1N0000000009', false]);
  check('control: an ordinary stock number still matches by stock', () => { const r = quiet(() => fuc(vd({ stockNum: 'TEST0T2', vin: '', vehicle: '2026 Toyota 4Runner TRD' }))); return [r.confirmed, r.unit && r.unit.stock]; }, [true, 'TEST0T2']);
  check('control: a VIN in the stock field never matches a unit by a stock that merely contains it', () => quiet(() => fuc(vd({ stockNum: 'TEST0T', vin: '' }))).inFeed, false);

  console.log(' (c) the same question twice, in more wordings:');
  run('lastScrapedData = { leadAgeDays: 0, convState: "first-touch" };');
  check('"What vehicle are you looking for? ... What are you hoping to get into?" -> asked once',
    () => (hg('Hi Test, thanks for your KBB request. What vehicle are you looking for? We have a strong selection right now. What are you hoping to get into?\nAgent').match(/\?/g) || []).length, 1);
  check('...the first question is the one kept', () => /What vehicle are you looking for\?/.test(hg('Hi Test, thanks for your KBB request. What vehicle are you looking for? We have a strong selection right now. What are you hoping to get into?\nAgent')), true);
  check('control: one vehicle question and a different question -> both kept',
    () => (hg('Hi Test, what are you hoping to get into? And would Saturday work for a visit?\nAgent').match(/\?/g) || []).length, 2);

  console.log(' (d) the same day, named once:');
  const MON5 = ctAt(17, 9), TMR = ctParts(MON5 + 86400000), DAY2 = ctParts(MON5 + 2 * 86400000), WK = ctParts(MON5 + 8 * 86400000);
  const TMR_LONG = TMR.weekday + ', ' + MONTHS[+TMR.month - 1] + ' ' + (+TMR.day), WK_LONG = WK.weekday + ', ' + MONTHS[+WK.month - 1] + ' ' + (+WK.day);
  const sdo = (t) => atClock(MON5, () => quiet(() => { const h = fn('_lpSameDayOnce'); return h ? h(t, 'sms') : 'no helper'; }));
  check('"tomorrow at 9:15 AM or <tomorrow\'s weekday and date>, at 10:30 AM" -> "tomorrow at 9:15 AM or 10:30 AM"',
    () => sdo('Test, would tomorrow at 9:15 AM or ' + TMR_LONG + ', at 10:30 AM work for a quick visit?\nAgent'), 'Test, would tomorrow at 9:15 AM or 10:30 AM work for a quick visit?\nAgent');
  check('...the weekday alone ("tomorrow at 9:15 AM or ' + TMR.weekday + ' at 10:30 AM") too',
    () => sdo('Would tomorrow at 9:15 AM or ' + TMR.weekday + ' at 10:30 AM work?'), 'Would tomorrow at 9:15 AM or 10:30 AM work?');
  check('...and through the render guard the drafts pass through', () => atClock(MON5, () => quiet(() => { const h = fn('_lpPastTimeGuard'); return h ? /tomorrow at 9:15 AM or 10:30 AM work/.test(h('Would tomorrow at 9:15 AM or ' + TMR_LONG + ', at 10:30 AM work?', 'sms')) : 'no helper'; })), true);
  check('control: the day after tomorrow is a second day -> left alone', () => sdo('Would tomorrow at 9:15 AM or ' + DAY2.weekday + ' at 10:30 AM work?'), 'Would tomorrow at 9:15 AM or ' + DAY2.weekday + ' at 10:30 AM work?');
  check('control: the same weekday a week later (a different date) -> left alone', () => sdo('Would tomorrow at 9:15 AM or ' + WK_LONG + ', at 10:30 AM work?'), 'Would tomorrow at 9:15 AM or ' + WK_LONG + ', at 10:30 AM work?');

  console.log(' (e) one same-day cutoff:');
  const cat = (h, m, store, dow) => atClock(ctAt(h, m, dow), () => quiet(() => { const r = run('computeAppointmentTimes')(store); return r ? [r.pastSameDayCutoff, r.dayLabel === 'today'] : 'no result'; }));
  check('Baytown at 7:11 PM (open until 8): past the last same-day appointment time', () => cat(19, 11, 'Community Honda Baytown'), [true, false]);
  check('Lafayette at 6:15 PM (open until 7): past it', () => cat(18, 15, 'Community Honda Lafayette'), [true, false]);
  check('an Audi Saturday at 4:45 PM (open until 6): past it', () => cat(16, 45, 'Audi Lafayette', 'Saturday'), [true, false]);
  // (v9.7.869) one same-day rule: an hour's notice and the last slot an hour before closing -- at 5:00 PM Baytown has same-day times
  check('control: Baytown at 5:00 PM -> not past it, and (since v9.7.869) same-day times are offered', () => cat(17, 0, 'Community Honda Baytown'), [false, true]);
  check('control: Baytown at 10:00 AM -> same-day times', () => cat(10, 0, 'Community Honda Baytown'), [false, true]);
  check('control: Baytown at 8:30 PM (closed) and on a Sunday -> not "past the cutoff" (the closed lines own those)',
    () => [cat(20, 30, 'Community Honda Baytown')[0], cat(13, 0, 'Community Honda Baytown', 'Sunday')[0]], [false, false]);
  const sp = (h, m) => { const t = ctAt(h, m); return atClock(t, () => go(base(E(stamp(t - 86400000, '10:00 AM'), 'CUSTOMER', 'Inbound Text Message', 'Is the Accord still there?') + MARK(stamp(t - 2 * 86400000, '9:00 AM')))).prompt); };
  const late = sp(19, 11), mid = sp(17, 0);
  check('the prompt at 7:11 PM: "too late in the day for a same-day appointment ... Do NOT offer a time today or tonight", and no "usable time TODAY"',
    () => [/STORE STATUS RIGHT NOW: OPEN, closing at 8 PM \(49m remaining\) -- too late in the day for a same-day appointment(?: \([^)]*\))?\. Earliest available appointment is [^.\n]+\. Do NOT offer a time today or tonight\./.test(late),
      /There is still usable time TODAY/.test(late)], [true, false]);
  check('control: the prompt at 5:00 PM keeps "There is still usable time TODAY"', () => [/There is still usable time TODAY/.test(mid), /too late in the day for a same-day appointment/.test(mid)], [true, false]);
  const av = fn('_lpApplyVisitDecision');
  const chipTxt = (status) => quiet(() => av ? av(['CURRENT TIME: x', status, 'SUGGESTED APPOINTMENT TIMES (fallback only — see rule below):'].join('\n'), true).text : 'no helper');
  check('Add Appt past the cutoff -> "two specific appointment times ... (the next open day -- no same-day time is left)"',
    () => /close with two specific appointment times inside store hours \(the next open day -- no same-day time is left\)/.test(chipTxt('STORE STATUS RIGHT NOW: OPEN, closing at 8 PM (0h 49m remaining) -- too late in the day for a same-day appointment. Earliest available appointment is tomorrow. Do NOT offer a time today or tonight.')), true);
  check('...and after closing', () => /\(the next open day -- no same-day time is left\)/.test(chipTxt('STORE STATUS RIGHT NOW: CLOSED for the day (closed at 8 PM). Earliest available appointment is tomorrow.')), true);
  check('control: Add Appt with the store open and time left -> "today if there is usable time left"',
    () => /\(today if there is usable time left\)/.test(chipTxt('STORE STATUS RIGHT NOW: OPEN. Closes at 8 PM (4h 0m remaining today). OFFER THE SOONEST REAL OPENING FIRST. There is still usable time TODAY, so today is the default.')), true);

  console.log(' (f) a feedback row for a generation that never rendered:');
  const posts = []; sb.fetch = (u, o) => { try { posts.push(JSON.parse(o.body)); } catch (e) {} return new Promise(() => {}); };
  const LSD = { autoLeadId: 'TEST001A', customerId: 'TESTC01', stockNum: 'TEST0K1', vin: '', dealerId: '6190', store: 'Community Kia Baytown', agent: 'Agent Name', leadSource: 'Internet', convState: 'active-follow-up', leadAgeDays: 0 };
  sb.__L = LSD;
  // A generation is started (reset), a chip is pressed, and a second generation starts before the first reply came back.
  const row = quiet(() => { posts.length = 0; run('lastScrapedData = globalThis.__L; _lpFeedbackReset(); _lpFeedback.regenCount = 1; _lpFeedback.chipCount = 1; _lpFeedback.chipsUsed = ["direct"]; _lpFeedbackReset();'); return posts[posts.length - 1] || null; });
  check('the superseded row carries the store, the agent and the lead', () => row && [row.meta.store, row.meta.agent, row.meta.autoLeadId, row.meta.dealerId], ['Community Kia Baytown', 'Agent Name', 'TEST001A', '6190']);
  check('...and is rated "incomplete" (no draft was produced), not "down"', () => row && [row.rating, row.meta.noDraft, row.chipsUsed], ['incomplete', true, ['direct']]);
  check('the meta itself stays empty until a reply is captured (an empty meta still means "no draft")', () => run('Object.keys(_lpFeedback.meta).length'), 0);
  const row2 = quiet(() => { posts.length = 0; run('lastScrapedData = globalThis.__L; _lpFeedbackReset(); _lpFeedbackCaptureMeta(); _lpFeedback.regenCount = 1; _lpFeedbackReset();'); return posts[posts.length - 1] || null; });
  check('control: a generation that did render and was regenerated away is still "down", with the full meta', () => row2 && [row2.rating, row2.meta.store, row2.meta.noDraft === undefined, 'route' in row2.meta], ['down', 'Community Kia Baytown', true, true]);
  check('control: the panel-load reset keeps no identity and posts nothing', () => quiet(() => { run('_lpFeedback.generationId = null;'); posts.length = 0; run('_lpFeedbackReset(true);'); return [run('_lpFeedback.identity'), posts.length]; }), [null, 0]);
  sb.fetch = () => new Promise(() => {});

  console.log(' (g) Kia interiors:');
  const KIA = '6190', HON = '6191';
  setUnits(KIA, [U_('TEST0K1', '2026 Kia Telluride SX', 'Telluride SX', 'Ebony Black', 'Black', 'new', 2026), U_('TEST0K2', '2026 Kia Telluride SX', 'Telluride SX', 'Glacial White Pearl', 'Black', 'new', 2026),
    U_('TEST0K3', '2025 Kia K5 LXS', 'K5 LXS', 'Wolf Gray', 'Black Cloth', 'used', 2025)]);
  setUnits(HON, [U_('TEST0H1', '2027 Honda CR-V Hybrid Sport-L', 'CR-V Hybrid Sport-L', 'Urban Gray Pearl', 'Black Leather', 'new', 2027), U_('TEST0H2', '2027 Honda CR-V Hybrid Sport-L', 'CR-V Hybrid Sport-L', 'Meteorite Gray Metallic', 'Gray Leather', 'new', 2027)]);
  const SL = fn('_lpStockInteriorLine');
  const unit = (dl, stock, vehicle, said) => ({ dealerId: dl, stockNum: stock, _pdUnitStock: stock, _pdStatus: 'A', vehicle, lastInboundMsg: said, history: '', context: '', conversationBrief: '' });
  const il = (d) => quiet(() => { const r = SL ? SL(d) : 'no helper'; return r && r.text ? r.text : r; });
  check('a Kia Telluride, brown interior asked -> the record cannot say; we will check, never "it does not have it", never "it is black"', () => {
    const t = il(unit(KIA, 'TEST0K1', '2026 Kia Telluride SX', 'Does it have the brown interior?'));
    return [/Kia's inventory records list a car's interior as black or gray even when it has another interior color, so the record cannot answer this/.test(t), /Say you will check the interior on this one and get back to them/.test(t),
      /never say it does not have the brown interior, and never say it is black or gray/.test(t), /lists the interior as/.test(t)]; }, [true, true, true, false]);
  check('a Kia K5 LXS (not a GT-Line or a Sportage) -> the same: we will check', () => { const t = il(unit(KIA, 'TEST0K3', '2025 Kia K5 LXS', 'Does it have black seats?')); return [/the record cannot answer this/.test(t), /lists the interior as Black Cloth/.test(t)]; }, [true, false]);
  check('control: a Honda still answers from its record', () => /lists the interior as Black Leather/.test(il(unit(HON, 'TEST0H1', '2027 Honda CR-V Hybrid Sport-L', 'Does it have the black leather interior?'))), true);
  const SAID_K = 'I want the Telluride SX with the brown interior';
  const kl = (x) => base(E(stamp(Date.now() - 3600000, '10:00 AM'), 'CUSTOMER', 'Inbound Text Message', SAID_K) + MARK(stamp(Date.now() - 86400000, '9:00 AM')),
    Object.assign({ vehicle: '2026 Kia Telluride SX', dealerId: KIA, store: 'Community Kia Baytown', leadSource: 'Kia Digital', lastInboundMsg: SAID_K, customerState: 'TX' }, x || {}));
  const ww = quiet(() => { const h = fn('_lpWhatWeHave'); return h ? h(kl()) : null; });
  check('what we have, for a Kia: the units are listed with their paint and NO interior', () => ww && [/Telluride SX \(Ebony Black\)/.test(ww.text), /Black interior/.test(ww.text)], [true, false]);
  check('...and the interior they asked for carries the Kia note: never say a Kia has or does not have it -- we will check',
    () => ww && [/The interior they asked for: brown\./.test(ww.text), /KIA INTERIORS: Kia's inventory records list the interior as black or gray even when the car has another interior color, so no interior is shown for these\. Never name a Kia's interior color, and never say it has or does not have the interior they want -- say you will check on it and get back to them\./.test(ww.text)], [true, true]);
  const SAID_H = 'I want the CR-V Hybrid Sport-L with the gray leather interior';
  const wh = quiet(() => { const h = fn('_lpWhatWeHave'); return h ? h(base(E(stamp(Date.now() - 3600000, '10:00 AM'), 'CUSTOMER', 'Inbound Text Message', SAID_H) + MARK(stamp(Date.now() - 86400000, '9:00 AM')),
    { vehicle: '2027 Honda CR-V Hybrid Sport-L', dealerId: HON, lastInboundMsg: SAID_H, customerState: 'TX' })) : null; });
  check('control: a Honda\'s units keep their interiors, with no Kia note', () => wh && [/\(Meteorite Gray Metallic, Gray Leather interior\)/.test(wh.text), /KIA INTERIORS:/.test(wh.text)], [true, false]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
