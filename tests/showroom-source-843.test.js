#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('showroom-source-843.test.js');
// (v9.7.843) AFTER A VISIT, HOW THE LEAD REACHED US IS NOT NEWS. Honda Lafayette lead 2107308865 (log384): a website lead who came in
// and test-drove a Passport; the follow-up opened "<name>, thanks for reaching out through our website." -- the source block gave the
// first-contact example ("I saw the request you sent through our website..."), the source constraint said "you may say the customer
// came through our website", and the text rewrite was told to keep the mention. Gil: "This was a showroom follow up that fact isn't
// needed." Builds the prompt through the shipped panel payload and executes the shipped rewrite prompt. Placeholder data only.
//
// Usage: node tests/showroom-source-843.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: showroom-source-843.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const E = (date, time, tag, title, body) => '[' + date + ' ' + time + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const VISIT = E('10/29/2026', '1:59 PM', 'SHOWROOM VISIT', 'Showroom Visit', 'By: Rep Name\n  Wants a smaller SUV. Showroom visit started at 10/29/2026 2:00 PM lasting 3 hours Walkaround Demo - Test Drive')
  + E('10/29/2026', '1:59 PM', 'NOTE', 'General Note', 'By: Rep Name\n  Came in and test drove a Passport. She likes the Passport and she will let me know after she does further research.');
const LSD = (x, hist) => { const h = hist === undefined ? VISIT : hist;
  return Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Honda Passport RTL',
    stockNum: 'TEST0P1', dealerId: '24399', store: 'Community Honda Lafayette', leadSource: 'Dealers WebSite', convState: 'pause', leadAgeDays: 1,
    hasOutbound: false, isContacted: true, hasCustomerReply: false, totalNoteCount: 8, phone: '(555) 010-0199', email: '', lastInboundMsg: '',
    isShowroomFollowUp: true, relationshipSignals: { unansweredQuestions: [] }, history: h, conversationBrief: h }, x || {}); };

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const built = (lsd) => { const ol = sb.console.log, ow = sb.console.warn; const logs = []; sb.console.log = (...a) => logs.push(a.join(' ')); sb.console.warn = () => {};
    try { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(lsd);
      return { p: String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: run('leadContext') }))), logs }; } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const how = (p) => (p.match(/^- HOW THIS LEAD REACHED US:.*$/m) || ['(none)'])[0];

  console.log(' 1. a website lead who came in:');
  const a = built(LSD());
  check('lead 2107308865: no SOURCE ACKNOWLEDGMENT block and no "I saw the request you sent through our website" example', () =>
    [/SOURCE ACKNOWLEDGMENT/.test(a.p), /I saw the request you sent through our website/.test(a.p)], [false, false]);
  check('the source line says they came in and not to mention how the lead reached us', () => how(a.p),
    '- HOW THIS LEAD REACHED US: they came in to the dealership, and that visit is the context. Do NOT mention how the lead reached us (our website, an online inquiry, a form or a request): they were here in person.');
  check('the console says why', () => a.logs.some(l => /\[LP SOURCE ACK DIAG\].*outcome:SKIPPED-showroom/.test(l)), true);
  const b = built(LSD({ isShowroomFollowUp: false, isContacted: false, convState: 'first-touch', leadAgeDays: 0, totalNoteCount: 1 }, ''));
  check('control: the same website lead with no visit still gets the first-contact acknowledgment and "you may say"', () =>
    [/SOURCE ACKNOWLEDGMENT/.test(b.p), /^- HOW THIS LEAD REACHED US: you may say the customer came through our website/m.test(b.p)], [true, true]);

  console.log(' 2. the text rewrite is not told to keep it:');
  const rf = (d) => { const fn = run('_lpBuildSmsRefinePrompt'); const ol = sb.console.log; sb.console.log = () => {};
    try { run('window._lpActiveProhibitions = []; _lpLastVisitDecision = { level: 0, owner: "" };'); return String(fn('Test, thanks for reaching out through our website. The Passport is here if you want to revisit it.\nAgent', 'Hi Test,\n\nThe Passport is here.\n\nAgent Name', d)); } finally { sb.console.log = ol; } };
  check('after a visit: no "The first draft names our website ... Keep that mention"', () => /The first draft names our website/.test(rf(LSD())), false);
  check('control: no visit -> the keep line stays', () => /The first draft names our website — how this customer reached us\. Keep that mention/.test(rf(LSD({ isShowroomFollowUp: false }, ''))), true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
