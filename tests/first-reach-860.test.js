#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('first-reach-860.test.js');
// (v9.7.860) Honda Lafayette lead 2109298069 (log394), owner-approved 11/3. After the 2:46 PM voicemail the agent texted at 2:49
// and emailed at 2:50 ("We do have a 2027 Honda Odyssey EX-L available!"), and the 3:12 PM draft ran on v9.7.859:
//  (1) 859's first reach held only while nothing but calls had gone out, so the email ended it: OUR PITCH IS ALREADY OUT told the
//      text not to say again that the van is here, the source line called it a continuing thread, and TOUCH POSITION said "early
//      follow-up ... do not re-introduce". The first reach is now the whole opening sequence: no reply, no connected call, our
//      FIRST outreach under two hours old. The prompt names what went out; the source line and the phase read as a first contact.
//  (2) "We do have a 2027 Honda Odyssey EX-L available" is an availability claim (it was not recorded at all).
//  (3) The text named all five colors; with three or more in stock, the text names two or three and asks which they prefer.
// Executes _lpStillFirstReach, the shipped claim-capture statement, _lpWhatWeHave, populateFromData and buildUserPrompt through
// the panel payload, with the clock pinned to the lead's own local times. Placeholder data only.
//
// Usage: node tests/first-reach-860.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: first-reach-860.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const NOW = new Date(2026, 10, 3, 15, 12).getTime();   // 3:12 PM local; the lead came in at 2:36 PM
const E = (time, tag, title, body) => '[11/03/2026 ' + time + '] [' + tag + '] ' + title + '\n  By: Agent Name ' + body + '\n';
const MARK = (t) => '[11/03/2026 ' + (t || '2:36 PM') + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const VM = E('2:46 PM', 'AGENT', 'Outbound phone call (Machine)', 'Left message, Hi Test, this is Agent with Community Honda Lafayette. Thanks for your online inquiry about the 2027 Odyssey EX-L.');
const TXT = E('2:49 PM', 'AGENT', 'Outbound Text Message', 'Test, this is Agent with Community Honda Lafayette about your 2027 Odyssey EX-L inquiry.');
const EML = E('2:50 PM', 'AGENT', 'Email reply to prospect', 'Subject: A quick note about your inquiry Hi Test, We do have a 2027 Honda Odyssey EX-L available! Would you like to stop by and see it?');
const H = EML + TXT + VM + MARK();
const U_ = (color) => ({ stock: 'TEST0D' + color.length, vin: '', vehicle: '2027 Honda Odyssey EX-L', year: 2027, make: 'Honda', model: 'Odyssey EX-L', condition: 'new',
  certified: false, class: 'Van, Minivan', body: '4D Passenger Van', color, interior: 'Gray', odometer: 10, daysOnLot: 20, price: 45000, stockNum: 'TEST0D' + color.length });
const UNITS = [U_('Black'), U_('Solar Silver Metallic'), U_('Platinum White Pearl'), U_('Radiant Red Metallic'), U_('Modern Steel Metallic')];
const LSD = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2027 Honda Odyssey EX-L',
  condition: 'New', dealerId: '24399', store: 'Community Honda Lafayette', leadSource: 'Thirdparty Honda -', convState: 'first-touch', leadAgeDays: 0, hasOutbound: true,
  totalNoteCount: 5, phone: '(555) 010-0199', email: 'test@example.com', relationshipSignals: { unansweredQuestions: [], customerCommitments: [], agentCommitments: [] },
  history: H, conversationBrief: H, context: H }, x || {});
function claimKind(src) {
  const a = src.lastIndexOf('if ((_scM = _scContent.match(', src.indexOf('is here|here and (?:ready|available)|available to see'));
  const b = src.indexOf('_scM[0]);', a) + '_scM[0]);'.length;
  if (a < 0) throw new Error('claim line not found');
  const fn = new Function('_scContent', 'var _scM, out = null; var _scAdd = function (k) { out = k; };\n' + src.slice(a, b) + '\nreturn out;');
  return (t) => fn(t);
}

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  run('(function(){ var RD = Date, FIX = ' + NOW + '; function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); } FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; Date = FD; })()');
  const setUnits = (u) => { sb.__U = u; run('_lpValueFactCache["24399"] = { inv: { units: globalThis.__U, generated: new Date().toISOString() }, invSettledAt: Date.now(), fetchedAt: Date.now() };'); };
  setUnits(UNITS);
  const go = (lsd) => { const logs = []; const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...q) => logs.push(q.join(' ')); sb.console.warn = () => {};
    try { run('activeFlags = new Set(); leadContext = "";'); sb.populateFromData(lsd); const ctx = String(run('leadContext') || '');
      return { ctx, prompt: String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: ctx }))), logs: logs.join('\n') }; }
    catch (e) { return { ctx: '', prompt: '', logs: 'THREW ' + e.message }; } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const SFR = (lsd) => { const fn = run('typeof _lpStillFirstReach === "function" ? _lpStillFirstReach : null'); return fn ? fn(lsd) : 'no helper'; };

  console.log(' 1. call, text and email minutes apart are one first reach:');
  check('still the first reach, naming what went out', () => { const r = SFR(LSD()); return r && r.sent; },
    ['called and left a voicemail at 2:46 PM', 'texted at 2:49 PM', 'emailed at 2:50 PM']);
  const a = go(LSD());
  check('the prompt says so and names the reach', () =>
    /THIS IS STILL THE FIRST REACH: on 11\/03 you called and left a voicemail at 2:46 PM, then texted at 2:49 PM, then emailed at 2:50 PM, and there is no answer yet/.test(a.prompt), true);
  check('no follow-up framing: no pitch-out, no "trying to reach", no continuing-thread source line, no early-follow-up phase', () =>
    [/OUR PITCH IS ALREADY OUT/.test(a.prompt), /WE HAVE BEEN TRYING TO REACH THEM|NOT THE FIRST CONTACT ATTEMPT/.test(a.prompt), /this is a continuing thread/.test(a.prompt), /early follow-up \(Day 0-1/.test(a.prompt)],
    [false, false, false, false]);
  check('the source line is the first-contact one, and the phase says first-touch, still the first reach', () =>
    [/Reference it naturally in your opening/.test(a.prompt), /Phase: first-touch \(Day 0-1\) — still the first reach/.test(a.prompt)], [true, true]);
  const old = (t) => { const h = EML.replace('2:50 PM', t) + MARK('11:00 AM'); return LSD({ history: h, conversationBrief: h, context: h }); };
  check('control: our first outreach three hours ago -> not the first reach any more', () => SFR(old('12:05 PM')), null);
  const o = go(old('12:05 PM'));
  check('control: ...and the prompt reads it as the follow-up it is (continuing thread, early follow-up)', () =>
    [/THIS IS STILL THE FIRST REACH/.test(o.prompt), /this is a continuing thread|early follow-up \(Day 0-1/.test(o.prompt)], [false, true]);
  const rep = E('2:55 PM', 'CUSTOMER', 'Inbound Text Message', 'Is the white one there?');
  check('control: once the customer wrote, it is a conversation', () => SFR(LSD({ history: rep + H })), null);

  console.log(' 2. "we do have ... available" is an availability claim:');
  let ck; try { ck = claimKind(src); } catch (e) { check('claim line', () => e.message, 'ok'); continue; }
  check('"We do have a 2027 Honda Odyssey EX-L available!" -> available', () => ck('Hi Test, We do have a 2027 Honda Odyssey EX-L available! Would you like to stop by?'), 'available');
  check('"we don\'t have that trim available" -> unavailable', () => ck("We don't have that trim available today"), 'unavailable');
  check('control: "Are you available at 3?" is not a claim about the car', () => ck('Are you available at 3 today?'), null);

  console.log(' 3. the text names two or three colors:');
  check('five in stock: the TEXT names two or three and asks which they prefer', () =>
    /In the TEXT, name two or three of these colors at most and ask which they prefer -- never the whole list\./.test(a.prompt), true);
  setUnits(UNITS.slice(0, 2));
  const two = go(LSD());
  check('control: with two in stock there is nothing to trim', () => [/IN STOCK --/.test(two.prompt), /In the TEXT, name two or three/.test(two.prompt)], [true, false]);
  setUnits([U_('Black'), U_('Black'), U_('Black'), U_('Black')].map((u, i) => Object.assign({}, u, { stock: 'TEST0K' + i, stockNum: 'TEST0K' + i })));
  const one = go(LSD());
  check('control: four units in one color are one color -- nothing to trim (colors are counted, not units)', () => [/IN STOCK --/.test(one.prompt), /In the TEXT, name two or three/.test(one.prompt)], [true, false]);
  setUnits(UNITS);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
