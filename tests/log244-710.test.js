#!/usr/bin/env node
'use strict';
// (v9.7.710) log244, Community Kia Baytown (capture 5e2c36ea). A fresh Click & Go lead whose only two
// outbound messages came from the store's automated assistant. Three defects in the prompt:
//  1. "A PERSON HAS ALREADY WRITTEN TO THIS CUSTOMER" -- false. buildUserPrompt reads
//     data.outboundSends, and generateAll's prompt-input object never carried it, so on the real
//     panel _lpFirstHumanTouch always saw an empty list.
//  2. The automated-assistant block said "do not name a day, a time or a slot", and the appointment
//     chain then printed SUGGESTED APPOINTMENT TIMES and an SMS script naming two of them.
//  3. "Comments ///" -- an empty web-form field -- was quoted as "the customer's own words".
// Runs shipped code: generateAll's prompt-input object literal evaluated in the popup's own sandbox,
// buildUserPrompt on the whole popup.js, and the scraper's inquiry-rejection expression lifted verbatim.
//
// Usage: node tests/log244-710.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: log244-710.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const BOT_TEXT = 'Sent to: (555) 010-0199 Sent by: Vinessa Virtual Assistant Community Kia Welcome to Community Kia. Reply YES to receive text messages. Reply STOP to cancel.';
const BOT_EMAIL = 'Subject: Your 2026 Kia K5 is Ready for a Test Drive By: Vinessa Virtual Assistant Community Kia Hi, I wanted to reach out because we have a 2026 Kia K5 that I think you would really enjoy.';
const HUMAN_TEXT = 'Sent to: (555) 010-0199 Sent by: Agent Name Hi, this is Agent at Community Kia. The K5 GT-Line you picked is here.';
const SENDS = (bodies) => bodies.map((b, i) => ({ title: i ? 'email reply to prospect' : 'outbound text message', ms: 1790000000000 + i, body: b }));
const ent = (date, tag, title, body) => '[' + date + '] [' + tag + '] ' + title + '\n  ' + body + '\n';

for (const f of BUILDS) {
  const src = fs.readFileSync(f, 'utf8');
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }

  console.log(' 1. the sends reach buildUserPrompt from the real panel path:');
  check('generateAll\'s prompt-input object carries lastScrapedData.outboundSends', () => {
    const a = src.indexOf('    var _lpPromptInputData = {');
    const b = src.indexOf('\n    };\n', a);
    const lit = src.slice(a + '    var _lpPromptInputData = '.length, b + '\n    }'.length);
    sb.__lsd = { outboundSends: SENDS([BOT_TEXT, BOT_EMAIL]), relationshipSignals: {} };
    vm.runInContext('lastScrapedData = globalThis.__lsd;', sb);
    const locals = { name: 'Test Buyer', agent: 'Agent Name', store: 'Community Kia Baytown', vehicleForPrompt: '2026 Kia K5 GT-Line', leadSource: 'Click & Go' };
    sb.__loc = new Proxy(locals, { has: () => true,
      get: (t, k) => (k in t ? t[k] : (k === Symbol.unscopables ? undefined : vm.runInContext('typeof ' + String(k) + ' === "undefined" ? undefined : ' + String(k), sb))) });
    const obj = vm.runInContext('(function(){ with (globalThis.__loc) { return (' + lit + '); } })()', sb);
    return (obj.outboundSends || []).length;
  }, 2);

  console.log(' 2. a lead only the automated assistant has written to:');
  const K5 = (extra) => Object.assign({ name: 'Test Buyer', agent: 'Agent Name', phone: '(555) 010-0199', email: 'test@example.com',
    vehicle: '2026 Kia K5 GT-Line', stockNum: 'T0000001', dealerId: '6190', store: 'Community Kia Baytown', leadSource: 'Gubagoo - Virtual Retailing',
    convState: 'first-touch', leadAgeDays: 0, hasOutbound: true, hasCustomerReply: false, totalNoteCount: 5, relationshipSignals: {},
    lastOutboundMsg: BOT_EMAIL, lastSubstantiveOutboundMsg: BOT_EMAIL, outboundSends: SENDS([BOT_TEXT, BOT_EMAIL]),
    context: ent('09/23/2026 9:18 PM', 'AGENT', 'Email reply to prospect', BOT_EMAIL) + ent('09/23/2026 9:18 PM', 'AGENT', 'Outbound Text Message', BOT_TEXT),
    lastInboundMsg: '' }, extra || {});
  const prompt = (d) => { vm.runInContext('leadContext = ' + JSON.stringify(d.context) + ';', sb); sb.__logs.length = 0;
    return { p: sb.__lp.buildUserPrompt(d), logs: sb.__logs.slice() }; };
  check('control: given the sends, buildUserPrompt already knew no person had written (the defect was the carry, above)',
    () => { const p = prompt(K5()).p; return [/YOU ARE THE FIRST REAL PERSON TO WRITE TO THIS CUSTOMER/.test(p), /A PERSON HAS ALREADY WRITTEN/.test(p)]; }, [true, false]);
  check('no SUGGESTED APPOINTMENT TIMES and no two-time SMS script beside a block that forbids naming times', () => {
    const p = prompt(K5()).p;
    return [/SUGGESTED APPOINTMENT TIMES/.test(p), /would \d{1,2}:\d{2} [AP]M or \d{1,2}:\d{2} [AP]M/.test(p), /APPOINTMENT TIMES WITHHELD ON THIS LEAD/.test(p)]; },
    [false, false, true]);
  check('...and the diag says which block owned it', () => prompt(K5()).logs.some(l => /^\[LP TIMES WITHHELD DIAG\] /.test(l)), true);
  check('control: a lead a PERSON wrote to last still gets suggested times', () => {
    const d = K5({ lastOutboundMsg: HUMAN_TEXT, lastSubstantiveOutboundMsg: HUMAN_TEXT, outboundSends: SENDS([HUMAN_TEXT]),
      context: ent('09/23/2026 9:30 PM', 'AGENT', 'Outbound Text Message', HUMAN_TEXT) });
    const p = prompt(d).p; return [/SUGGESTED APPOINTMENT TIMES/.test(p), /APPOINTMENT TIMES WITHHELD/.test(p)]; }, [true, false]);

  console.log(' 3. an empty web-form field is not the customer\'s words:');
  const a = src.indexOf("              || !/[a-z]{3,}/i.test(extractedCustQ)");
  const b = src.indexOf(') {\n', a);
  const rejected = (q) => new Function('extractedCustQ', 'return (false\n' + src.slice(a, b) + ');')(q);
  check('"Comments ///" is rejected', () => rejected('Comments ///'), true);
  check('"Questions: N/A" and "Additional Comments: --" are rejected', () => [rejected('Questions: N/A'), rejected('Additional Comments: --')], [true, true]);
  check('control: a real comment after the label is kept', () => rejected('Comments: Is the K5 GT-Line still available in gray?'), false);
  check('control: a plain question is kept', () => rejected('Do you have it in red?'), false);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
