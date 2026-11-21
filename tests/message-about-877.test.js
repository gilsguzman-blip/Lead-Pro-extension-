#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('message-about-877.test.js');
// (v9.7.877) AUDIT #2 CT-2, OWNER-APPROVED 11/16: one block decides what the message is about. When two or more of Lead Pro's
// "lead with / close with" blocks are in one prompt, a fixed order picks one -- their newest question, something we owe them,
// something we asked them for, the standing offer -- one THIS MESSAGE IS ABOUT line names it under the VISIT DECISION line, and
// the others keep their facts and lose their "lead with". Under a level-3 visit hold nothing changes. Executes buildUserPrompt
// through the panel payload (the asked-for document on a showroom follow-up, lead 2112149909's shape) and _lpMessageAbout.
// Placeholder data only.
//
// Usage: node tests/message-about-877.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: message-about-877.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const pad = (n) => String(n).padStart(2, '0');
const at = (daysAgo, clock) => { const d = new Date(Date.now() - daysAgo * 86400000); return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear() + ' ' + clock; };
const E = (date, tag, title, body) => '[' + date + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (date) => '[' + date + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const count = (s, rx) => (String(s).match(rx) || []).length;

// The blocks as Lead Pro writes them (the exact sentences the decision reads and edits).
const B = {
  head: 'CURRENT TIME: Tuesday 10:00 AM\nVISIT DECISION FOR THIS MESSAGE: no specific appointment times -- the PITCH ALREADY OUT rule owns this.',
  asked: 'WE ASKED THEM FOR SOMETHING THAT MOVES THEIR DEAL: on 11/07 our message said "Please send a copy of your insurance card.", and nothing since shows it came in. Ask, simply, whether they were able to get it -- it is the next step on their deal and a better reason to write than a new pitch. Do not invent a step of ours instead ("I\'m putting together your numbers"), and never quote this line.',
  offer: 'CLOSE WITH ONE CONCRETE OFFER they can answer yes or no, and the offer BRINGS THEM BACK IN: the rep putting together new options for what the notes say (a different down payment or term, another vehicle or trim, the color they wanted, a trade appraisal) and going over them with them here, in person. Do NOT offer to send numbers, offer details or options for them to review, look over or compare at home -- new options are reviewed here, with the rep. NOT an open question ("what would help", "what part of the decision", "what would you like to revisit", "what matters most"). One question in the whole message. State the offer once, as that question -- do not promise it in one sentence and then ask it again in the next.',
  pitch: 'OUR PITCH IS ALREADY OUT AND UNANSWERED: on 11/07 our message told them the car is here and offered times, and they have not answered it. Do not say again that it is here or available, do not offer times or a visit slot, and do not re-send the reasons to come in (the vehicle ready, the paperwork). No specific appointment times in this message. Bring one new thing, or ask one simple question.',
  number: '  - Customer has stated a specific budget, payment, or OTD target. Agents cannot commit to exact numbers over text — keep the hedge — but lead with their stated number as the goal before explaining it needs to be confirmed in person. Do not open with a clarifying question about the number or pivot straight to scheduling as if the number was not mentioned. Acknowledge their target first, then move toward confirming it in person.',
  question: 'OPEN THREADS:\n  - Customer asked question(s) that may not have been answered: "Does it have heated seats?" (11/06/2026 9:00 AM) / "Is the price negotiable?" (11/07/2026 9:00 AM). Read the surrounding transcript carefully — if the question is still open, address it directly before moving on.',
  owed: '- On 11/05 our own message said "I can check availability on the exact configuration", and no message of ours has answered it since. This IS that answer: give it plainly, without apologizing for the wait.'
};
const P = (...k) => [B.head].concat(k.map(x => B[x])).join('\n');

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const go = (brief, x) => quiet(() => { const lsd = Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Honda HR-V', condition: 'New',
      dealerId: '6191', store: 'Community Honda Baytown', leadSource: 'Honda Website -', convState: 'active-follow-up', leadAgeDays: 3, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 8,
      phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '', relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 2 }, conversationBrief: brief, history: brief, context: '', autoLeadId: 'TEST006F' }, x || {});
    try { vm.runInContext('activeFlags = new Set(); leadContext = ""; window._lpAddApptLeadId = "";', sb); sb.__L = lsd; vm.runInContext('lastScrapedData = globalThis.__L;', sb); sb.populateFromData(lsd);
      const ctx = String(vm.runInContext('leadContext', sb) || ''); return String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd, context: ctx }))); } catch (e) { return 'THREW ' + e.message; } });
  const ma = vm.runInContext('typeof _lpMessageAbout === "function" ? _lpMessageAbout : null', sb) || ((t) => ({ text: String(t), owner: '', others: [], edits: [], skipped: '' }));   // absent before 877
  const run = (t, lv) => quiet(() => ma(t, lv || 0));

  console.log(' lead 2112149909\'s shape, built end to end (a showroom follow-up; we asked for a document; the budget line):');
  const THREAD = E(at(2, '5:11 PM'), 'AGENT', 'Outbound Text Message', 'We need a letter from the registers office that states your graduation date.\nBy: Rep Name')
    + E(at(2, '5:02 PM'), 'CUSTOMER', 'Inbound Text Message', 'What do I need to get the graduate discount?')
    + E(at(2, '5:01 PM'), 'AGENT', 'Outbound Text Message', 'The HRV in stock today would be 28k lowest price with financing through Honda.\nBy: Rep Name')
    + E(at(2, '4:59 PM'), 'CUSTOMER', 'Inbound Text Message', 'I need it at 25k out the door') + MARK(at(3, '10:00 AM'));
  const g = go(THREAD, { isShowroomFollowUp: true });
  check('one THIS MESSAGE IS ABOUT line, and it names what we asked them for', () => [count(g, /^THIS MESSAGE IS ABOUT: /gm), /^THIS MESSAGE IS ABOUT: what we asked them for -- see WE ASKED THEM FOR SOMETHING/m.test(g)], [1, true]);
  check('...the asked-for block keeps its ask; the showroom close loses "CLOSE WITH" and keeps "new options are reviewed here, with the rep"',
    () => [/^WE ASKED THEM FOR SOMETHING[^\n]*Ask, simply, whether they were able to get it/m.test(g), /^CLOSE WITH ONE CONCRETE OFFER/m.test(g), /^IF THIS MESSAGE OFFERS ANYTHING, IT BRINGS THEM BACK IN: [^\n]*new options are reviewed here, with the rep\./m.test(g)], [true, false, true]);

  console.log(' the fixed order:');
  const r1 = run(P('offer', 'asked', 'pitch', 'number'));
  check('asked-for + offer + pitch + number -> what we asked them for; the other three edited', () => [r1.owner, r1.others, r1.edits.slice().sort()], ['askedFor (something we asked them for)', ['offer', 'number', 'newThing'], ['newThing', 'number', 'offer']]);
  check('...the line sits directly under the VISIT DECISION line', () => r1.text.split('\n')[2].slice(0, 22), 'THIS MESSAGE IS ABOUT:');
  check('...the losers keep their facts: no times, not "it is here" again, no numbers sent home, keep the hedge',
    () => [/No specific appointment times in this message\. What THIS MESSAGE IS ABOUT is the one new thing\./.test(r1.text), /Do NOT offer to send numbers/.test(r1.text), /keep the hedge — but acknowledge their stated number as the goal/.test(r1.text), /lead with their stated number|Bring one new thing/.test(r1.text)], [true, true, true, false]);
  const r2 = run(P('asked', 'question', 'number'));
  check('their open question outranks what we asked for; the newest one is quoted', () => [r2.owner, /THIS MESSAGE IS ABOUT: their open question, "Is the price negotiable\?" \(see OPEN THREADS\)\. Answer it first/.test(r2.text)], ['question (their newest question)', true]);
  check('...and what we asked for stays, without the ask', () => [/It is still outstanding, but it does not open or close this message/.test(r2.text), /Ask, simply, whether they were able to get it -- it is the next step/.test(r2.text)], [true, false]);
  const r3 = run(P('asked', 'owed'));
  check('something we owe them outranks something we asked them for', () => [r3.owner, /Give that answer plainly, without apologizing for the wait/.test(r3.text), /This IS that answer/.test(r3.text)], ['owed (something we owe them)', false, true]);
  const r4 = run(P('pitch', 'offer'));
  check('the standing offer: the showroom offer before the pitch\'s "one new thing"', () => [r4.owner, /^CLOSE WITH ONE CONCRETE OFFER/m.test(r4.text)], ['offer (the standing offer)', true]);

  console.log(' when nothing competes, or a stronger hold owns the message:');
  check('one block alone -> nothing changes', () => run(P('asked')).text === P('asked'), true);
  check('control: two blocks under a level-3 visit hold (a decline, an exit, a pause) -> nothing changes', () => { const r = run(P('offer', 'asked'), 3); return [r.text === P('offer', 'asked'), r.owner, r.skipped]; }, [true, '', 'a level-3 visit hold owns the message']);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
