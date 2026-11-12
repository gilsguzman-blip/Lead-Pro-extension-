#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('render-checks-846.test.js');
// (v9.7.846) FROM SATURDAY 10/31, ON 9.7.845: A TIME TODAY THAT HAD PASSED, STORE HOURS THE 842 CHECK MISSED, A STREET ADDRESS COPIED
// FROM THE THREAD, AND A LOGISTICS ANSWER FULL OF FIGURES. Honda Lafayette CarGurus lead 2108097289: at 9:13 AM the draft offered "9 AM
// or 10 AM today" (the agent changed it to 10 AM or 2 PM) and said "We're open until 7 today and from 9 to 7 Monday". Audi Lafayette
// Autotrader lead 2108158988: asked for the address and proposed 10 AM; the draft gave "6160 Johnson St." (the CRM's own reminder text;
// the store is on Johnston St) and repeated the listing price and her budget. Executes _lpPastTimeGuard (clock pinned), _lpHouseGuard,
// _lpAddressGuard and the prompt through the shipped panel payload. Placeholder data only.
//
// Usage: node tests/render-checks-846.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: render-checks-846.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const SIG = '\nAgent\nTest Store\n(555) 010-0100';

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const at = (iso, fn) => { const restore = run('(function(){ var RD = Date; var FIX = new RD("' + iso + '").getTime();'
      + ' function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); }'
      + ' FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; var prev = Date; Date = FD; return function(){ Date = prev; }; })()');
    try { return fn(); } finally { if (restore) restore(); } };
  const guard = (name, text, ch, lsd) => { run('lastScrapedData = ' + JSON.stringify(lsd || { store: 'Community Honda Lafayette', dealerId: '24399' }) + ';');
    const fn = run(name); if (typeof fn !== 'function') return { out: 'no ' + name, log: '' };
    const ol = sb.console.log; const logs = []; sb.console.log = (...a) => logs.push(a.join(' ')); try { return { out: fn(text, ch), log: logs.join('\n') }; } finally { sb.console.log = ol; } };

  console.log(' 1. a time today that has passed:');
  const SAT_913 = '2026-10-31T09:13:00-05:00';
  const eng = at(SAT_913, () => run('computeAppointmentTimes("Community Honda Lafayette")'));
  const t1 = String(eng.time1).replace(/ today$/, ''), t2 = String(eng.time2).replace(/ today$/, '');
  const P = 'Test, the 2024 Toyota Corolla Cross LE from your CarGurus inquiry is here. Would 9 AM or 10 AM today work for you to come take a look?' + SIG;
  const g1 = at(SAT_913, () => guard('_lpPastTimeGuard', P, 'sms'));
  check('lead 2108097289, 9:13 AM Saturday: "9 AM or 10 AM today" -> the slot engine\'s today pair, one for one', () =>
    [eng.dayLabel, g1.out === P.replace('9 AM or 10 AM', t1 + ' or ' + t2)], ['today', true]);
  check('the console names the swap', () => /\[LP PAST TIME GUARD\] sms at 9:13 AM: "9 AM \/ 10 AM" -> "/.test(g1.log), true);
  check('control: times later today are left alone', () => at(SAT_913, () => guard('_lpPastTimeGuard', 'Test, would 2 PM or 3:30 PM today work?' + SIG, 'sms').out) === 'Test, would 2 PM or 3:30 PM today work?' + SIG, true);
  check('control: "9 AM Monday" is not today -> left alone', () => at(SAT_913, () => guard('_lpPastTimeGuard', 'Test, would 9 AM Monday work?' + SIG, 'sms').out) === 'Test, would 9 AM Monday work?' + SIG, true);
  const late = at('2026-10-31T18:30:00-05:00', () => guard('_lpPastTimeGuard', 'Test, would 5 PM today work?' + SIG, 'sms'));
  check('after the last slot of the day: left alone, and the console says it is left for the agent', () =>
    [late.out === 'Test, would 5 PM today work?' + SIG, /no slot left today -- left for the agent/.test(late.log)], [true, true]);

  console.log(' 2. store hours the 842 check missed:');
  const h1 = guard('_lpHouseGuard', 'Test, the Corolla Cross is here. Would you like to come by today or Monday? We’re open until 7 today and from 9 to 7 Monday, and I’ll have it ready when you arrive.' + SIG, 'sms').out;
  check('lead 2108097289: "We’re open until 7 today and from 9 to 7 Monday, ..." is removed', () => h1, 'Test, the Corolla Cross is here. Would you like to come by today or Monday?' + SIG);
  check('and the email\'s "We’re open until 7 today and Monday from 9 to 7."', () =>
    guard('_lpHouseGuard', 'Hi Test,\n\nWould you like to come in and see it? We’re open until 7 today and Monday from 9 to 7.\n\nAgent Name', 'email').out, 'Hi Test,\n\nWould you like to come in and see it?\n\nAgent Name');
  check('control: "we’re open until 7 tonight, so would 5:30 or 6:15 work?" is a time offer -> kept', () => {
    const t = 'Test, we’re open until 7 tonight, so would 5:30 or 6:15 work?' + SIG; return guard('_lpHouseGuard', t, 'sms').out === t; }, true);

  console.log(' 3. our street address:');
  const a1 = guard('_lpAddressGuard', 'Test, yes, November 11 at 10 AM works. The address is 6160 Johnson St., Lafayette, LA 70503.' + SIG, 'sms', { store: 'Audi Lafayette', dealerId: '21135' });
  check('lead 2108158988: "6160 Johnson St." -> "6160 Johnston St." (the config\'s), the sentence\'s period kept', () => a1.out, 'Test, yes, November 11 at 10 AM works. The address is 6160 Johnston St., Lafayette, LA 70503.' + SIG);
  check('the console names it', () => /\[LP ADDRESS GUARD\] sms: "6160 Johnson St" -> "6160 Johnston St"/.test(a1.log), true);
  check('control: the right address, and "2503 SE Evangeline Thwy" (the same street), are left alone', () => {
    const t = 'Test, we are at 6160 Johnston St, and our sister store is at 2503 SE Evangeline Thwy.' + SIG; return guard('_lpAddressGuard', t, 'sms').out === t; }, true);
  check('the render chain runs all three on the text, the email and the voicemail', () =>
    ["_lpFinanceGuard(_lpAddressGuard(_lpPastTimeGuard(_lpHouseGuard(((typeof _lpAmericanSpelling === 'function') ? _lpAmericanSpelling(cleanOutput(rawSms, true))",
     "_lpFinanceGuard(_lpAddressGuard(_lpPastTimeGuard(_lpHouseGuard(((typeof _lpAmericanSpelling === 'function') ? _lpAmericanSpelling(cleanOutput(rawEmail, false))",
     "_lpFinanceGuard(_lpAddressGuard(_lpPastTimeGuard(_lpHouseGuard(((typeof _lpAmericanSpelling === 'function') ? _lpAmericanSpelling(vmText)"].map(x => src.indexOf(x) > 0), [true, true, true]);

  console.log(' 4. a logistics question gets a logistics answer:');
  const LSD = (msg) => ({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2020 Nissan Rogue Sport SV',
    stockNum: 'TEST0N1', dealerId: '21135', store: 'Audi Lafayette', leadSource: 'Autotrader.Com - Lead', convState: 'active-follow-up', leadAgeDays: 0,
    hasOutbound: true, hasCustomerReply: true, totalNoteCount: 6, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: msg,
    relationshipSignals: { unansweredQuestions: [] }, history: '', conversationBrief: '' });
  const built = (lsd) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {};
    try { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(lsd);
      return String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: run('leadContext') }))); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const p = built(LSD('SEND. ME. THE. ADDRESS'));
  check('lead 2108158988: "SEND. ME. THE. ADDRESS" -> OUR ADDRESS from the config, and never one copied from the thread', () =>
    /^OUR ADDRESS: 6160 Johnston St, Lafayette, LA 70503\. They asked where we are: give exactly this address\. An address written elsewhere in the thread \(including our own reminder texts\) may be wrong -- never copy one from there\.$/m.test(p), true);
  check('and the reply answers only that: no budget, payment or price figures, no new pitch', () =>
    /THEIR NEWEST MESSAGE IS ABOUT LOGISTICS \("SEND\. ME\. THE\. ADDRESS"\)\. Answer exactly that, briefly: .*Do NOT repeat budget, down payment, monthly payment or price figures back to them/.test(p), true);
  check('"HOW. BOUT. 10. AM." is logistics too (no address line)', () => { const q = built(LSD('THAT. SOUNDS. GREAT. HOW. BOUT. 10. AM.')); return [/THEIR NEWEST MESSAGE IS ABOUT LOGISTICS/.test(q), /^OUR ADDRESS:/m.test(q)]; }, [true, false]);
  check('control: a message about money is not "logistics only"', () => /THEIR NEWEST MESSAGE IS ABOUT LOGISTICS/.test(built(LSD('I. CAN. PUT. 500. DOWN. WHAT. TIME. CAN. I. COME'))), false);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
