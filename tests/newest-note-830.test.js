#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('newest-note-830.test.js');
// (v9.7.830) THE NEWEST EVENT ON THE LEAD MAY BE OUR NOTE, NOT THEIR LAST MESSAGE. Kia Baytown lead 2104004243 (log368): on a 10/21 call
// the customer asked about a Sorento EX in Wolf Gray; on 10/26 our text said "Ex Sorento Wolf Gray" and they texted "Headed your way";
// at 7:41 PM the salesperson noted "Showed / Test drove the 2026 Sorento (CPO) - Black #P2962 Showed numbers - talking about coming back
// in on Friday", and the lead was changed to that car. The prompt still said "THE CUSTOMER HAS MOVED OFF THE UNIT ON THE LEAD: they asked
// for GRAY", "TRIM/CONFIG PREFERENCE: EX", offered Wolf Gray units, and the v9.7.826 exchange block showed "Ex Sorento Wolf Gray" ->
// "Headed your way". The text went back to the Wolf Gray EX. Gil: "VOI was changed to Sorento S #P2962 and the note from 10/26 7:41 pm
// confirms ... The text is still stuck on the Wolf gray."
// Executes the shipped scraper color/trim detector slice, and buildUserPrompt through the panel payload. Placeholder data only.
//
// Usage: node tests/newest-note-830.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), vm = require('vm'), path = require('path');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: newest-note-830.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const sure = (fn) => { try { return fn(); } catch (e) { return 'THREW: ' + e.message; } };
const M = 60000, H = 60 * M, D = 24 * H, NOW = Date.now();
const fmt = (ms) => { const f = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  .formatToParts(new Date(ms)).reduce((o, p) => (o[p.type] = p.value, o), {}); return f.month + '/' + f.day + '/' + f.year + ' ' + f.hour + ':' + f.minute + ' ' + f.dayPeriod.toUpperCase(); };
const E = (ms, tag, title, body) => '[' + fmt(ms) + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (ms) => '[' + fmt(ms) + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const T_ASK = NOW - 6 * D, T_OURS = NOW - 21 * H, T_HEAD = NOW - 19 * H, T_NOTE = NOW - 18 * H;
const DROVE = 'By: Rep Name Showed / Test drove the 2026 Sorento (CPO) - Black #P2962 Showed numbers - talking about coming back in on Friday Follow up with customer';
const ASKL = E(T_ASK, 'CUSTOMER', 'Inbound phone call', 'Asked about Sorento EX in wolf gray. Wants to stay under 40k with otd, and is pre-approved by his bank');
const OURL = E(T_OURS, 'AGENT', 'Outbound Text Message', 'Ex Sorento Wolf Gray');
const HEADL = E(T_HEAD, 'CUSTOMER', 'Inbound Text Message', 'Headed your way');
const NOTEL = (body) => E(T_NOTE, 'NOTE', 'General Note', body || DROVE);
const AGAINL = E(NOW - 2 * H, 'CUSTOMER', 'Inbound Text Message', 'Do you have it in gray though?');

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');

  console.log(' 1. the scraper: a test drive of the lead\'s unit settles the color and the trim:');
  const a = src.indexOf('      var _lpColorRx = ');
  const endMark = "do not pitch a different trim without reason.');";
  const detector = src.slice(a, src.indexOf(endMark, a) + endMark.length);
  const scan = (lines) => {
    const logs = [];
    const sb = { String, Date, Array, RegExp, concernScanLines: lines.map(l => l.replace(/\n\s+/, ' ').trim()), allTranscriptText: lines.join(' '), _fricQuote: '', _fricState: '',
      customerConcerns: [], color: 'Ebony Black', vin: '', stockNum: 'P2962', vehicle: '2026 Kia Sorento S', _lpD: (...x) => logs.push(x.join(' ')),
      _lpCustomerSaid: () => [{ text: 'Asked about Sorento EX in wolf gray. Wants to stay under 40k with otd' }] };
    vm.createContext(sb); try { vm.runInContext(detector, sb); } catch (e) { return { err: e.message }; }
    const c = sb.customerConcerns.join('\n');
    return { moved: /MOVED OFF THE UNIT ON THE LEAD/.test(c), settled: /SETTLED ON THE UNIT ON THE LEAD/.test(c), trim: /TRIM\/CONFIG PREFERENCE/.test(c), concerns: c,
      how: vm.runInContext('typeof _colorSettled !== "undefined" && _colorSettled && _colorSettled.droveAt ? "drove" : ""', sb) };
  };
  const r = scan([ASKL, OURL, HEADL, NOTEL()]);
  check('lead 2104004243: asked for gray, then "Test drove ... Black #P2962" -> SETTLED on the lead\'s unit, not MOVED OFF; no EX trim preference',
    [r.settled, r.moved, r.trim, r.how, r.err || ''], [true, false, false, 'drove', '']);
  check('...and the concern says how: they drove the unit on the lead (stock P2962)',
    /since then a note says they drove or were shown the unit on this lead \(Ebony Black, stock P2962\)/.test(r.concerns || ''), true);
  const r2 = scan([ASKL, OURL, HEADL, NOTEL('By: Rep Name Customer called, said he will come by Friday')]);
  check('control: a later note that does not show them the lead\'s car -> the gray ask still drives (MOVED OFF), EX stays', [r2.moved, r2.settled, r2.trim], [true, false, true]);
  const r3 = scan([ASKL, OURL, HEADL, NOTEL(), AGAINL]);
  check('control: they ask for gray again after the test drive -> back on the table (MOVED OFF)', [r3.moved, r3.settled], [true, false]);

  console.log(' 2. the prompt: the newest event is the note; the exchange steps aside; no gray alternates:');
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  const unit = (stock, veh, model, color, cond, price) => ({ stock, stockNum: stock, vin: 'TESTVIN' + stock, vehicle: veh, year: 2026, make: 'Kia', model, condition: cond, certified: cond === 'used',
    class: 'SUV', body: 'SUV', color, odometer: cond === 'new' ? 5 : 9000, daysOnLot: 10, price });
  run('_lpValueFactCache')['6190'] = { inv: { units: [unit('P2962', '2026 Kia Sorento S', 'Sorento S', 'Ebony Black', 'used', 36000), unit('P3001', '2026 Kia Sorento S', 'Sorento S', 'Wolf Gray', 'used', 35500),
    unit('N4001', '2026 Kia Sorento EX', 'Sorento EX', 'Wolf Gray', 'new', 41000), unit('N4002', '2026 Kia Sorento LX', 'Sorento LX', 'Glacial White Pearl', 'new', 33000)] },
    vf: { incentives: [] }, fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true };
  const viaPanel = (lsd) => String(sure(() => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {};
    try { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(lsd); return sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: run('leadContext') })); }
    finally { sb.console.log = ol; sb.console.warn = ow; } }));
  const LEAD = (o) => { o = o || {}; const h = (o.noNote ? '' : NOTEL()) + HEADL + OURL + ASKL + MARK(T_ASK - 10 * M);
    return Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Kia Sorento S', condition: 'Certified',
      stockNum: 'P2962', vin: 'TESTVINP2962', color: 'Ebony Black', _lpInvConfirmedAvailable: true, dealerId: '6190', store: 'Test Kia', leadSource: 'Dealers WebSite', convState: 'active-follow-up',
      leadAgeDays: 6, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 20, phone: '(555) 010-0199', email: 'test@example.com', customerZip: '00000', lastInboundMsg: 'Headed your way',
      customerStatedColor: o.noNote ? 'gray' : '', colorAskSettled: o.noNote ? '' : 'gray', colorAskSettledHow: o.noNote ? '' : 'drove',
      lastOutboundMsg: 'Sent to: (555) 010-0199\nSent by: Rep Name\nEx Sorento Wolf Gray', lastSubstantiveOutboundMsg: 'Ex Sorento Wolf Gray',
      outboundSends: [{ title: 'outbound text message', ms: T_OURS, body: 'Sent to: (555) 010-0199\nSent by: Rep Name\nEx Sorento Wolf Gray' }],
      relationshipSignals: { unansweredQuestions: [], customerCommitments: [], agentCommitments: [] }, history: h, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + h + '---' }, o.x || {}); };
  const p = viaPanel(LEAD());
  check('the newest event is the note: it says they drove the car on the lead, and earlier asks are background',
    [/📍 THE NEWEST EVENT ON THIS LEAD IS OUR NOTE, NOT THEIR LAST MESSAGE: [\d/]+ \(Rep Name\): "Showed \/ Test drove the 2026 Sorento \(CPO\) - Black #P2962/.test(p),
      /It came after their last message \("Headed your way"\), so it is where things stand: write from it\. It says they drove or were shown the vehicle on this lead \(2026 Kia Sorento S, stock P2962\)/.test(p),
      /What they asked for before it \(a color, a trim, another unit\) is background/.test(p)], [true, true, true]);
  check('the exchange block steps aside, and no Wolf Gray alternates are offered', [/THE EXCHANGE THIS MESSAGE ANSWERS/.test(p), /SIMILAR VEHICLES IN STOCK|ALTERNATE CONDITION AVAILABLE/.test(p)], [false, false]);
  check('the color line says the test drive settled it, not a listing', /the color question is closed: they first asked for gray, then a note says they drove or were shown this car \(Ebony Black\)\. They have not asked for gray since/.test(p), true);
  const pc = viaPanel(LEAD({ noNote: true }));
  check('control: no note after their reply -> the exchange block stands, no newest-event line', [/THE EXCHANGE THIS MESSAGE ANSWERS/.test(pc), /THE NEWEST EVENT ON THIS LEAD/.test(pc)], [true, false]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
