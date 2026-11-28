#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('records-sent-882.test.js');
// (v9.7.882) WHAT OUR TEAM DID AFTER THEIR ASK, IN ORDER. Owner, 11/18: "Missed the fact that the manager sent the service records to
// the customer. mishandled." Honda Lafayette lead 2096450291 (log423): "Can u email?" (11:15); the manager's 11:20 "difficulty sending a
// file that large", his 11:43 email "Service Records" and his 1:00 PM "I sent the service records to your email"; the customer's 1:01 PM
// reply has no text. The prompt credited a same-minute message sent BEFORE the ask as the answer, quoted the empty reply as "", and the
// text shipped "the service records ... are ready for you to review. Would 2:00 or 2:45 work?". Executes populateFromData and
// buildUserPrompt through the panel payload on a fixed clock. Placeholder data only.
//
// Usage: node tests/records-sent-882.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: records-sent-882.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
// Wednesday 11/18/2026, 1:13 PM Central (a Central wall clock, whatever TZ runs the suite)
const CT = (y, mo, d, h, mi) => { const guess = Date.UTC(y, mo - 1, d, h + 6, mi); const off = (new Date(guess).toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }) | 0) - h; return guess - off * 3600000; };
const NOW = CT(2026, 11, 18, 13, 13), DAY = '11/17/2026', ms = (h, mi) => CT(2026, 11, 17, h, mi);
const E = (clock, tag, title, body) => '[' + DAY + ' ' + clock + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const SEND = (h, mi, by, body) => ({ title: 'outbound text message', ms: ms(h, mi), body: 'Sent to: (555) 010-0199\nSent by: ' + by + '\n' + body });
const THREAD = (o) => (o.empty ? E('1:01 PM', 'CUSTOMER', 'Inbound Text Message', '') : '')
  + E('1:00 PM', 'AGENT', 'Outbound Text Message', o.last || 'I sent the service records to your email.')
  + (o.email === false ? '' : E('11:43 AM', 'AGENT', 'Email reply to prospect', 'Subject: Service Records Read 1 trackable time. First after 2 hours. By: Rep Name I was able to download them. It may take a while to look through them'))
  + E('11:20 AM', 'AGENT', 'Outbound Text Message', 'I am having difficulty sending a file that large. I am currently trying to figure this out for you.')
  + E('11:15 AM', 'CUSTOMER', 'Inbound Text Message', 'Can u email?')
  + E('11:15 AM', 'AGENT', 'Outbound Text Message', 'If there is any specific information you need I can look it up for you.')
  + E('11:14 AM', 'AGENT', 'Outbound Text Message', 'This vehicle has had 12 repair orders in the Honda system. The file is 37MB.')
  + E('10:16 AM', 'CUSTOMER', 'Inbound Text Message', 'Auto check is useless. No service records etc')
  + '[10/08/2026 9:00 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const SENDS = (o) => [SEND(13, 0, o.lastBy || 'Rep Name', o.last || 'I sent the service records to your email.'),
  { title: 'email reply to prospect', ms: ms(11, 43), body: 'Subject: Service Records\nRead 1 trackable time. First after 2 hours.\nBy: Rep Name\nI was able to download them. It may take a while to look through them' },
  SEND(11, 20, 'Rep Name', 'I am having difficulty sending a file that large. I am currently trying to figure this out for you.'),
  SEND(11, 15, 'Rep Name', 'If there is any specific information you need I can look it up for you.'),
  SEND(11, 14, 'Rep Name', 'This vehicle has had 12 repair orders in the Honda system. The file is 37MB.')];

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  vm.runInContext('(function(){ var RD = Date, FIX = ' + NOW + '; function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); } FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; Date = FD; })()', sb);
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const go = (o) => quiet(() => { const brief = THREAD(o); const lsd = { name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2020 Honda Pilot Touring', condition: 'Used',
      dealerId: '24399', store: 'Community Honda Lafayette', leadSource: 'Dealer Website', convState: 'active-follow-up', leadAgeDays: 41, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 40,
      phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: 'Can u email?', relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 1 }, conversationBrief: brief, history: brief, context: '',
      outboundSends: SENDS(o), autoLeadId: 'TEST010K' };
    try { vm.runInContext('activeFlags = new Set(); leadContext = ""; window._lpAddApptLeadId = "";', sb); sb.__L = lsd; vm.runInContext('lastScrapedData = globalThis.__L;', sb); sb.populateFromData(lsd);
      return String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd, context: String(vm.runInContext('leadContext', sb) || '') }))); } catch (e) { return 'THREW ' + e.message; } });

  console.log(' lead 2096450291\'s shape:');
  const p = go({ empty: true });
  const blk = (p.match(/^↪ THEIR NEWEST MESSAGE WAS ALREADY ANSWERED:[^\n]*/m) || [''])[0];
  check('the answer is what came AFTER the ask -- never the 11:15 message sent the same minute before it', () => [/If there is any specific information you need/.test(blk), /11:20 AM Rep: "I am having difficulty/.test(blk)], [false, true]);
  check('...the records email and the 1:00 PM text are listed, in order', () => /11:43 AM Rep by email \("Service Records"\): "I was able to download them[^"]*"; 1:00 PM Rep: "I sent the service records to your email\."/.test(blk), true);
  check('...and the prompt says what they asked for went out: follow it up, never offer it again or call it ready', () => /What they asked for went out -- Rep[^\n]*sent it\. This message follows that up: ask whether it came through[^\n]*do not describe it as ready, coming or on its way/.test(blk), true);
  check('the visit decision holds today\'s times (they are looking it over), and the suggested times are gone',
    () => [/VISIT DECISION FOR THIS MESSAGE: no specific appointment times[^\n]*WHAT THEY ASKED FOR WENT OUT \(they are looking it over\) owns this/.test(p), /SUGGESTED APPOINTMENT TIMES/.test(p)], [true, false]);
  check('the 1:01 PM reply with no text is an acknowledgment, never quoted as ""', () => [/They replied at 1:01 PM with no text the CRM can show[^\n]*\nRead that reply as an acknowledgment/.test(p), /They answered at 1:01 PM: ""/.test(p)], [true, false]);
  console.log(' controls:');
  const q = go({ email: false, last: 'Let me know if you have any other questions.' });
  check('control: a teammate answered with no delivery -> listed, "follows that answer", no went-out hold', () => [/THEIR NEWEST MESSAGE WAS ALREADY ANSWERED/.test(q), /What they asked for went out/.test(q), /WHAT THEY ASKED FOR WENT OUT/.test(q)], [true, false, false]);
  const r = go({ email: false, last: 'I sent it over just now.', lastBy: 'Agent Name' });
  check('control: a reply with text is quoted as before (only an empty one changes)', () => /They answered at 1:01 PM/.test(go({ empty: false })) || !/OUR LAST MESSAGE, AND THEIR ANSWER/.test(go({ empty: false })), true);
  check('the signer sent the last one but a teammate answered first -> still listed with "you" for the signer', () => /1:00 PM you: "I sent it over just now\."/.test(r), true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
