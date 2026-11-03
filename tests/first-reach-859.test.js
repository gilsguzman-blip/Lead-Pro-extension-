#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('first-reach-859.test.js');
// (v9.7.859) Honda Lafayette lead 2109298069 (log393), Gil 11/3: "at first agent message said we had no 2027 Odyssey EX-L's. We
// have 7 ... and now the message reads like a follow up she had just sent the VM. Message should read like a first reach per rules".
//  (1) VinSolutions' trim was "EX-L Auto" ("2027 Honda Odyssey EX-L Auto (New)"); the feed lists "Odyssey EX-L"; the inventory
//      answer said "NONE in stock today". Transmission words (Auto, Automatic, Manual, CVT, 6MT, 10AT, 6-speed) are not trim.
//  (2) Our voicemail "We don't have that trim in stock today" was quoted back as WE SAID IT WAS AVAILABLE. "don't have ... in
//      stock", "out of stock" and "none in stock" are the opposite claim.
//  (3) A call (and voicemail) minutes before the first text, on a fresh lead with nothing else of ours and no reply, is the same
//      first reach: no "THIS IS THE FIRST TEXT/EMAIL, BUT NOT THE FIRST CONTACT ATTEMPT", no OUR PITCH IS ALREADY OUT, no WE HAVE
//      BEEN TRYING TO REACH THEM; the prompt says it is still the first reach.
// Executes _lpTrimOf, _lpWhatWeHave, the shipped claim-capture statement, _lpStillFirstReach, populateFromData and
// buildUserPrompt through the panel payload. Placeholder data only.
//
// Usage: node tests/first-reach-859.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: first-reach-859.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
// Local wall-clock times on both sides, so the suite reads the same in any time zone: the lead came in at 2:36 PM, the call was
// at 2:46 PM, the grab is at 2:50 PM.
const NOW = new Date(2026, 10, 3, 14, 50).getTime();
const E = (time, tag, title, body) => '[11/03/2026 ' + time + '] [' + tag + '] ' + title + '\n  By: Agent Name ' + body + '\n';
const MARK = '[11/03/2026 2:36 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const VM = E('2:46 PM', 'AGENT', 'Outbound phone call (Machine)', 'Left message, Hi Test, this is Agent with Community Honda Lafayette. Thanks for your online inquiry about the 2027 Odyssey EX-L. I can have details ready for you.');
const NOTE = E('2:44 PM', 'NOTE', 'General Note', 'no dupe');
const U_ = (color) => ({ stock: 'TEST0D' + color.length, vin: '', vehicle: '2027 Honda Odyssey EX-L', year: 2027, make: 'Honda', model: 'Odyssey EX-L', condition: 'new',
  certified: false, class: 'Van, Minivan', body: '4D Passenger Van', color, interior: 'Gray', odometer: 10, daysOnLot: 20, price: 45000, stockNum: 'TEST0D' + color.length });
const UNITS = [U_('Black'), U_('Solar Silver Metallic'), U_('Platinum White Pearl')];
const LSD = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2027 Honda Odyssey EX-L Auto',
  condition: 'New', dealerId: '24399', store: 'Community Honda Lafayette', leadSource: 'Thirdparty Honda -', convState: 'first-touch', leadAgeDays: 0,
  totalNoteCount: 3, phone: '(555) 010-0199', email: 'test@example.com', relationshipSignals: { unansweredQuestions: [], customerCommitments: [], agentCommitments: [] },
  history: VM + NOTE + MARK, conversationBrief: VM + NOTE + MARK, context: VM + NOTE + MARK }, x || {});
function claimKind(src) {   // the shipped availability-claim statement, run on one message
  const a = src.indexOf("if ((_scM = _scContent.match(/[^.!?]{0,70}\\b(?:is here|"); const b = src.indexOf('_scM[0]);', a) + '_scM[0]);'.length;   // one statement, possibly over several lines
  if (a < 0) throw new Error('claim line not found');
  const fn = new Function('_scContent', 'var _scM, out = null; var _scAdd = function (k) { out = k; };\n' + src.slice(a, b) + '\nreturn out;');
  return (t) => fn(t);
}

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  run('(function(){ var RD = Date, FIX = ' + NOW + '; function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); } FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; Date = FD; })()');
  sb.__U = UNITS; run('_lpValueFactCache["24399"] = { inv: { units: globalThis.__U, generated: new Date().toISOString() }, invSettledAt: Date.now(), fetchedAt: Date.now() };');
  const go = (lsd) => { const logs = []; const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...q) => logs.push(q.join(' ')); sb.console.warn = () => {};
    try { run('activeFlags = new Set(); leadContext = "";'); sb.populateFromData(lsd); const ctx = String(run('leadContext') || '');
      return { ctx, prompt: String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: ctx }))), logs: logs.join('\n') }; }
    catch (e) { return { ctx: '', prompt: '', logs: 'THREW ' + e.message }; } finally { sb.console.log = ol; sb.console.warn = ow; } };

  console.log(' 1. the transmission is not the trim:');
  const trim = (v) => (run('_lpTrimOf')(v) || {}).norm;
  check('"2027 Honda Odyssey EX-L Auto" is the EX-L', () => trim('2027 Honda Odyssey EX-L Auto') === trim('2027 Honda Odyssey EX-L'), true);
  check('...and CVT, 6MT, 10AT, 6-speed, Automatic, Manual', () =>
    ['2026 Honda Civic Sport CVT', '2026 Toyota Tacoma SR5 6MT', '2026 Toyota Tundra SR5 10AT', '2026 Mazda MX-5 Club 6-speed', '2026 Honda Civic Sport Automatic', '2026 Honda Civic Sport Manual']
      .map(trim), [trim('2026 Honda Civic Sport'), trim('2026 Toyota Tacoma SR5'), trim('2026 Toyota Tundra SR5'), trim('2026 Mazda MX-5 Club'), trim('2026 Honda Civic Sport'), trim('2026 Honda Civic Sport')]);
  check('control: the trim itself stays (Sport, Touring, EX-L are three trims)', () => [trim('2026 Honda Civic Sport') !== trim('2026 Honda Civic Touring'), trim('2027 Honda Odyssey EX-L')], [true, 'exl']);
  const w = run('_lpWhatWeHave')(LSD());
  check('the inventory answer for "EX-L Auto": IN STOCK, named as the EX-L (it said "NONE in stock today")', () =>
    w ? [/The 2027 Odyssey EX-L: IN STOCK/.test(w.text), /NONE in stock/.test(w.text), /EX-L Auto/.test(w.text)] : 'no answer', [true, false, false]);

  console.log(' 2. "we don\'t have that trim in stock" is not an availability claim:');
  let ck; try { ck = claimKind(src); } catch (e) { check('claim line', () => e.message, 'ok'); continue; }
  check('"We don\'t have that trim in stock today, but we do have other Odyssey options" -> unavailable', () => ck("We don't have that trim in stock today, but we do have other Odyssey options"), 'unavailable');
  check('"out of stock" is never recorded as available (no claim); "none in stock right now" -> unavailable', () => [ck('That color is out of stock'), ck('We have none in stock right now')], [null, 'unavailable']);
  check('controls: "the Odyssey is in stock" -> available; "isn\'t in stock" -> unavailable (v9.7.847)', () => [ck('The Odyssey EX-L is in stock in three colors'), ck("The SR isn't in stock today")], ['available', 'unavailable']);

  console.log(' 3. a voicemail minutes ago is the same first reach:');
  const a = go(LSD());
  check('the prompt says it is still the first reach', () => /THIS IS STILL THE FIRST REACH: the only contact so far is the call you made at 2:46 PM on 11\/03, minutes ago/.test(a.prompt), true);
  check('and none of the three follow-up blocks is there', () =>
    [/NOT THE FIRST CONTACT ATTEMPT/.test(a.prompt), /OUR PITCH IS ALREADY OUT/.test(a.prompt), /WE HAVE BEEN TRYING TO REACH THEM/.test(a.prompt)], [false, false, false]);
  check('[LP FIRST REACH DIAG] says why', () => /\[LP FIRST REACH DIAG\] still the first reach: 1 call\(s\) of ours on this lead, the newest 11\/03 2:46 PM/.test(a.logs), true);
  const SFR = (lsd) => run('_lpStillFirstReach')(lsd);
  const call3h = E('11:30 AM', 'AGENT', 'Outbound phone call (Machine)', 'Left message, Hi Test, this is Agent.');
  check('control: a call three hours ago is a real prior attempt (not the first reach any more)', () => SFR(LSD({ history: call3h + MARK.replace('2:36 PM', '11:00 AM') })), null);
  const txt = E('2:48 PM', 'AGENT', 'Outbound Text Message', 'Test, thanks for your inquiry about the Odyssey.');
  check('control: once a text of ours went out, this is a follow-up', () => SFR(LSD({ history: txt + VM + NOTE + MARK })), null);
  const conn = E('2:46 PM', 'AGENT', 'Outbound phone call (Contacted)', 'Spoke with Test about the Odyssey.');
  check('control: a call that connected is contact, not a first reach', () => SFR(LSD({ history: conn + NOTE + MARK })), null);
  const rep = E('2:48 PM', 'CUSTOMER', 'Inbound Text Message', 'Is the white one there?');
  check('control: once the customer wrote, it is a conversation', () => SFR(LSD({ history: rep + VM + NOTE + MARK })), null);
  const old = go(LSD({ history: call3h + MARK.replace('2:36 PM', '11:00 AM'), conversationBrief: call3h + MARK.replace('2:36 PM', '11:00 AM'), context: call3h + MARK.replace('2:36 PM', '11:00 AM') }));
  check('control: with the call three hours old, the existing "first text, not the first attempt" framing is unchanged', () =>
    [/NOT THE FIRST CONTACT ATTEMPT|WE HAVE BEEN TRYING TO REACH THEM/.test(old.prompt), /THIS IS STILL THE FIRST REACH/.test(old.prompt)], [true, false]);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
