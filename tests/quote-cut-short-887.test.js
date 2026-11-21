#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('quote-cut-short-887.test.js');
// (v9.7.887) A QUOTED-REPLY HEADER CUT SHORT IS STILL NOT THE CUSTOMER. Owner, 11/19 ("regrab"), Kia Baytown lead 3117232759 on 9.7.886:
// the customer's email reached Lead Pro as VinSolutions' preview, "...Can you email me your best price including all fees?Thanks<name>
// On Wednesday, November 18, 2026 at 07:09:55 PM CST, <agent> ..." -- cut before "wrote:", so the cutter's header rules missed it, the
// day scan logged "LOCKED -- day name IS customer-authored" on "on wednesday", and both drafts offered "Wednesday at 12:15 PM or 1:00 PM".
// The channel-preference line carried the email's Subject: and By: lines as the customer's words. Runs the shipped cutter, the shipped
// schedule loop and the shipped channel-preference block against a fake DOM. Placeholder data only.
//
// Usage: node tests/quote-cut-short-887.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), vm = require('vm'), path = require('path');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: quote-cut-short-887.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const REPLY = 'Subject: Re:Pricing on both Sorento VINs\nBy: Agent Name\nAgent,I prefer to communicate through email. I have already driven the Sorento so a test drive isnt necessary at this time. Can you email me your best price including all fees?ThanksTest On Wednesday, November 18, 2026 at 07:09:55 PM CST, Agent ...';
function makeNote(text, dir, title) {
  return { getAttribute: () => dir, querySelector: (sel) => /title/.test(sel) ? { innerText: title } : /content/.test(sel) ? { innerText: text } : /date/.test(sel) ? { innerText: '11/19/2026 9:28 AM' } : null };
}
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  const at = (n) => { const i = src.indexOf(n); if (i < 0) throw new Error('missing ' + n); return i; };
  let stripSrc, loopSrc, cpSrc;
  try {
    const sa = at('    function _lpCustomerAuthoredPart(raw) {'); stripSrc = src.slice(sa, src.indexOf('\n    function ', sa + 10));
    loopSrc = src.slice(at('    var customerSaidNotToday = false;'), at('    // Detect when customer has explicitly declined an alternative the agent offered.'));
    cpSrc = src.slice(at("    var customerChannelPref = '';"), at('    var inboundScanned = 0;'));
  } catch (e) { console.log('  FAIL slice: ' + e.message); fail++; continue; }
  const strip = (t) => { const b = {}; vm.createContext(b); vm.runInContext(stripSrc, b); return vm.runInContext('_lpCustomerAuthoredPart', b)(t); };
  const sched = (texts) => { const diag = []; const b = { Date, Math, String, Number, JSON, RegExp, Array, Object,
      _lpD: (...a) => diag.push(a.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' ')), noteEls: texts.map(t => makeNote(t, 'inbound', 'email reply from prospect')) };
    vm.createContext(b); vm.runInContext(stripSrc, b); vm.runInContext(loopSrc, b);
    const c = String(vm.runInContext('customerScheduleConstraint', b) || ''), m = /Customer said (\w+) is when/.exec(c);
    return { day: m ? m[1] : '', notToday: vm.runInContext('customerSaidNotToday', b), diag }; };
  const pref = (t, title) => { const b = { String, RegExp, noteEls: [makeNote(t, 'inbound', title || 'email reply from prospect')] };
    vm.createContext(b); vm.runInContext(stripSrc, b); vm.runInContext(cpSrc, b); return vm.runInContext('customerChannelPref', b); };

  console.log(' the header cut short before "wrote:" is cut:');
  check('lead 3117232759: the cut ends at "...including all fees?ThanksTest"', () => strip(REPLY).text.slice(-40), 'best price including all fees?ThanksTest');
  check('...by the cut-short header rule', () => strip(REPLY).cutBy, 'quoted-reply header, cut short (weekday, full date, time)');
  check('the numeric form ("On 11/18/2026 7:09 PM, Agent ...") too', () => strip('Sounds good.On 11/18/2026 7:09 PM, Agent ...').text, 'Sounds good.');
  check('control: the full header with "wrote:" is cut as before', () => strip('Thanks. On Wed, Nov 18, 2026 at 7:09 PM Agent Name <agent@example.com> wrote: Hi').text, 'Thanks.');

  console.log(' no day is locked from it:');
  const r = sched([REPLY]);
  check('no Wednesday lock and no not-today', () => [r.day, r.notToday], ['', false]);
  check('the day name is in the raw note (not vacuous) and the uncut text still matches the old pattern', () => /(?:until|till|on|this|next)\s+(wednesday)/i.test(REPLY), true);
  check('control: "On Wednesday I can come by after work" is the customer\'s and still locks', () => sched(['On Wednesday I can come by after work.']).day, 'Wednesday');
  check('control: "can I come in on Wednesday at 3:00?" still locks', () => sched(['Can I come in on Wednesday at 3:00?']).day, 'Wednesday');

  console.log(' the channel preference is the customer\'s sentence alone:');
  check('no "Re:Pricing ... By: Agent Name" in it', () => pref(REPLY), 'Agent,I prefer to communicate through email');
  check('control: a text that says "please text only" is kept', () => pref('Received from: (555) 010-0199\nPlease text only, I am at work', 'inbound text message'), 'Please text only, I am at work');
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
