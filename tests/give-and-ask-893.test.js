#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('give-and-ask-893.test.js');
// (v9.7.893) THE TEXT KEEPS WHAT IT GIVES, AND WHAT IT GIVES HELPS THEM DECIDE. Owner, 11/25: "yes build 893 with both". On 11/24 (9.7.892)
// stalled follow-ups were as short as before -- before Expand, about 120 characters on 892 and 130 on 891 -- and Expand was pressed on
// all five stalled leads one agent worked on 892. The main draft carried 892's "give before you ask"; the text rewrite, on a follow-up
// whose pitch went unanswered, was told "bring one new thing or ask one simple question", and took the question (Kia 2112669282: "I've
// been trying to reach you about the 2027 Seltos. You can call or text me here. Has your timeline shifted ...?"). And the useful fact on a
// first touch could be a lone spec (Honda Baytown 3121256964: "the Pilot LX is front-wheel drive"). Executes _lpBuildSmsRefinePrompt on
// a fixed Central clock and reads the first-reach-out and follow-up lines. Placeholder data only.
//
// Usage: node tests/give-and-ask-893.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: give-and-ask-893.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const CT = (y, mo, d, h, mi) => { const guess = Date.UTC(y, mo - 1, d, h + 6, mi); const off = (new Date(guess).toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }) | 0) - h; return guess - off * 3600000; };
const NOW = CT(2026, 11, 24, 13, 30);
const E = (day, clock, tag, title, body) => '[' + day + ' ' + clock + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = '[11/10/2026 9:00 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const PITCH = E('11/12/2026', '10:00 AM', 'AGENT', 'Outbound Text Message', 'Test, the 2027 Seltos is here and available to see. Would 4:00 PM or 4:45 PM work?');
const INQ = E('11/10/2026', '9:05 AM', 'CUSTOMER REQUEST FROM INQUIRY', 'Lead Received', 'I am interested in the 2027 Seltos.');
const LEAD = (h) => ({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', dealerId: '6190', store: 'Community Kia Baytown', vehicle: '2027 Kia Seltos', convState: 'active-follow-up',
  leadAgeDays: 14, hasOutbound: true, hasCustomerReply: false, lastInboundMsg: '', history: h, conversationBrief: h, context: '', outboundSends: [] });
const EMAIL = 'Hi Test,\n\nI can narrow the current 2027 Seltos options by trim and color. Has your timeline shifted, or has it just been a busy stretch?\n\nAgent Name';
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  vm.runInContext('(function(){ var RD = Date, FIX = ' + NOW + '; function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); } FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; Date = FD; })()', sb);
  sb.console.log = () => {};
  const rf = (d) => { sb.__L = d; vm.runInContext('lastScrapedData = globalThis.__L; _lpLastVisitDecision = { level: 0 };', sb); return String(vm.runInContext('_lpBuildSmsRefinePrompt', sb)('Test, has your timeline shifted?', EMAIL, d)); };

  console.log(' the text rewrite keeps what it gives:');
  const r1 = rf(LEAD(PITCH + INQ + MARK));
  check('a follow-up whose pitch went unanswered: "bring one new thing ... and then end on one simple question; never the question alone"', () => [/bring one new thing -- something useful the email gives \(what is on our lot, what we will do for them, the offer\) -- and then end on one simple question; never the question alone\./.test(r1), /bring one new thing or ask one simple question/.test(r1)], [true, false]);
  const r2 = rf(LEAD(E('11/20/2026', '11:00 AM', 'AGENT', 'Outbound phone call (No Contact)', 'By: Agent Name No answer') + PITCH + INQ + MARK));
  check('...and when we have called since: a way to reach us AND one thing they can use, then the question', () => /give one easy way to reach us and one thing they can use -- something useful the email gives[^']*-- and then end on one simple question\./.test(r2), true);
  check('the first reach-out\'s text keeps the email\'s useful line, then ends on its light invitation (v9.7.897)', () => /keep the email\\'s useful line \(what is on our lot, what we will do for them, the offer\), and end on the same light invitation the email makes/.test(src), true);

  console.log(' what it gives helps them decide:');
  check('the first reach-out: what is on our lot, a feature that sets the trim apart, the offer, or what we can do -- a lone window-sticker spec is not it', () => /Ahead of the invitation, one or two sentences that help them decide: what is on our lot \(how many, which colors or trims\), a feature that sets that trim apart[^']*A lone spec they could read off the window sticker \("it is front-wheel drive"\) is not it\./.test(src), true);
  check('a follow-up: the same', () => /Before any question, give them something that helps them decide -- what is on our lot for what they asked about[^']*A lone spec they could read off the window sticker is not it\./.test(src), true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
