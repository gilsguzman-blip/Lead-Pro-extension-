#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('four-fixes-890.test.js');
// (v9.7.890) FOUR FIXES FROM THE 11/19 AND 11/20 REPORTS. Owner, 11/21: "yes build 890 with all four".
//  1. A car on its way cannot be filmed (Toyota 3119235982, a RAV4 inbound: eight drafts offered a walkaround video of it).
//  2. At Audi the walkaround comes from the Brand Specialist (owner, 11/20: "I'll get your Sales person/ Brand Specialist 'X' to send you a walk around").
//  3. We told them we do not have it and offered something else: follow up on that (Kia 3116332231: "I don't currently have any pre-owned
//     Kia Souls or Kia Fortes. I do have a Certified Pre-Owned Kia K4"; the draft asked again which of a Soul or a Forte they wanted).
//  4. "I won't repeat that question" is the draft talking about its own instructions (Toyota 2103884293, 11/19).
// Executes the shipped guards, _lpScrubMetaLeak, _lpTeammateAnswered and _lpBuildSmsRefinePrompt. Placeholder data only.
//
// Usage: node tests/four-fixes-890.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: four-fixes-890.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const CT = (y, mo, d, h, mi) => { const guess = Date.UTC(y, mo - 1, d, h + 6, mi); const off = (new Date(guess).toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }) | 0) - h; return guess - off * 3600000; };
const NOW = CT(2026, 11, 20, 8, 40);
const E = (day, clock, tag, title, body) => '[' + day + ' ' + clock + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const ASK = 'Yes pre owned either a soul or a forte.. I am at work I will call when I can';
const MINE = 'Yes sir, sounds good. Right now we don’t have any pre-owned Fortes on the lot, but we do have a Soul. It’s a 2012 with 78k miles';
const MATE = 'Hi Test This is Rep. I don’t currently have any pre-owned Kia Souls or Kia Fortes. I do have a Certified Pre-Owned Kia K4. I also have a 2021 Hyundai Sonata.';
const KIA = (mate, mine) => { mine = mine || MINE; const h = E('11/17/2026', '12:07 PM', 'AGENT', 'Outbound Text Message', mate) + E('11/17/2026', '11:58 AM', 'AGENT', 'Outbound Text Message', mine)
    + E('11/17/2026', '11:49 AM', 'CUSTOMER', 'Inbound Text Message', ASK) + '[11/17/2026 11:39 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
  return { name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', dealerId: '6190', store: 'Community Kia Baytown', vehicle: '2021 Kia Soul GT Line Premium',
    convState: 'active-follow-up', hasOutbound: true, hasCustomerReply: true, lastInboundMsg: ASK, history: h, conversationBrief: h, context: '',
    outboundSends: [{ title: 'outbound text message', ms: CT(2026, 11, 17, 12, 7), body: 'Sent to: (555) 010-0199\nSent by: Rep Name\n' + mate },
      { title: 'outbound text message', ms: CT(2026, 11, 17, 11, 58), body: 'Sent to: (555) 010-0199\nSent by: Agent Name\n' + mine }] }; };
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  vm.runInContext('(function(){ var RD = Date, FIX = ' + NOW + '; function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); } FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; Date = FD; })()', sb);
  sb.console.log = () => {};
  const run = (e) => vm.runInContext(e, sb);
  const setLead = (d) => { sb.__L = d; run('lastScrapedData = globalThis.__L;'); };
  const hg = (t, ch) => run('_lpHouseGuard')(t, ch || 'sms');

  console.log(' 1. a car on its way cannot be filmed:');
  setLead({ dealerId: '6189', store: 'Community Toyota Baytown', isInTransit: true });
  check('"I can send the details and a video walkaround so you can see it before it arrives" -> the window sticker',
    () => hg('Test, the 2026 RAV4 is confirmed inbound. I can send the details and a video walkaround so you can see it before it arrives.'), 'Test, the 2026 RAV4 is confirmed inbound. I can send the details and the window sticker so you can see it before it arrives.');
  check('"Want me to send the video and details?" -> the window sticker', () => hg('Want me to send the video and details?'), 'Want me to send the window sticker and details?');
  check('the prompt says so beside the in-transit status, and the color of a unit on its VIN is not asked', () => /It is not here yet, so nobody can film or photograph it: never offer a walkaround video, photos or a look at it before it arrives[^']*never ask which color or trim they want for this unit/.test(src), true);
  setLead({ dealerId: '6189', store: 'Community Toyota Baytown', isInTransit: false });
  check('control: a car on the lot keeps its video offer', () => hg('I can send the details and a video walkaround so you can see it.'), 'I can send the details and a video walkaround so you can see it.');

  console.log(' 2. at Audi the walkaround comes from the Brand Specialist:');
  setLead({ dealerId: '21135', store: 'Audi Lafayette', salesRep: 'Rep Name' });
  check('"As your Concierge, I can send you a video walkaround ..." (text) -> "I can have your Audi Brand Specialist, Rep, send you a walkaround video ..."',
    () => hg('Test, the 2023 Ram 1500 is here. As your Concierge, I can send you a video walkaround so you can get a closer look.', 'sms'), 'Test, the 2023 Ram 1500 is here. I can have your Audi Brand Specialist, Rep, send you a walkaround video so you can get a closer look.');
  check('"I can arrange a quick walkaround video as your Concierge." (email) -> the full name', () => hg('I can arrange a quick walkaround video as your Concierge.', 'email'), 'I can have your Audi Brand Specialist, Rep Name, send you a walkaround video.');
  check('"Would you like me to send the video?" -> "Would you like Rep to send you the walkaround video?"', () => hg('Would you like me to send the video?', 'sms'), 'Would you like Rep to send you the walkaround video?');
  check('control: "Would a quick walkaround video be useful?" names nobody and stays', () => hg('Would a quick walkaround video be useful?', 'sms'), 'Would a quick walkaround video be useful?');
  setLead({ dealerId: '24399', store: 'Community Honda Lafayette', salesRep: 'Rep Name' });
  check('control: another store keeps "I can send you a video walkaround"', () => hg('I can send you a video walkaround.', 'sms'), 'I can send you a video walkaround.');
  check('the Audi prompt and the text rewrite both say it', () => [/A WALKAROUND VIDEO OR PHOTOS COME FROM THE BRAND SPECIALIST, who is with the car -- never from you/.test(src), /STORE POLICY \(Audi Lafayette\): a walkaround video or photos come from the Brand Specialist, never from you/.test(src)], [true, true]);

  console.log(' 3. we told them we do not have it, and offered something else:');
  const ta = (d) => { const r = run('_lpTeammateAnswered')(d); return r && r.offered ? r.offered.first : null; };
  check('lead 3116332231: the salesperson\'s "I don\'t currently have any ... I do have a Certified Pre-Owned Kia K4" is the offer', () => ta(KIA(MATE)), 'Rep');
  check('...and the text rewrite follows up on it, not on "Soul or Forte?"', () => { const d = KIA(MATE); setLead(d); const r = String(run('_lpBuildSmsRefinePrompt')('Test, a Soul or Forte works.', 'Hi Test,\n\nWhich matters more?', d));
    return /WE DO NOT HAVE WHAT THEY ASKED FOR, AND OFFERED SOMETHING ELSE[^\n]*\nRep told them: "[^"]*I do have a Certified Pre-Owned Kia K4[^"]*"\. The text follows up on what was offered[^\n]*does NOT ask again which of the models they first named/.test(r); }, true);
  check('control: "we don\'t have any openings at 3, but I have a 4:00" is not a car we lack', () => ta(KIA('We don’t have any openings at 3, but I have a 4:00 if that helps.', 'Yes sir, sounds good. I will look for you.')), null);
  check('the main prompt\'s teammate block carries it', () => /This message picks up from that offer -- ask whether one of those interests them, or what would -- and does NOT ask again which of the models they first named they want/.test(src), true);

  console.log(' 4. "I won\'t repeat that question" is not for the customer:');
  const ml = (t) => run('_lpScrubMetaLeak')(t);
  check('Toyota 2103884293\'s email sentence goes; the question stays', () => ml('I realize the last note already asked whether to keep your file open or close it, so I won’t repeat that question. Would you prefer I check back at a later time, or stop here?'), 'Would you prefer I check back at a later time, or stop here?');
  check('control: "I won\'t keep you long" stays', () => ml('I won’t keep you long. Is the Accord still on your list?'), 'I won’t keep you long. Is the Accord still on your list?');
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
