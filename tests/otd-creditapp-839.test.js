#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('otd-creditapp-839.test.js');
// (v9.7.839) THEY ASKED FOR THE OUT-THE-DOOR PRICE ON THE CALL, AND THE CREDIT APPLICATION IS THE NEXT STEP. Toyota Baytown lead
// 2107371352 (log381, Click & Go): the call note said "interested. wants OTD"; the text rewrite opened "the out-the-door figure you
// asked about is something we can go through together at the dealership" -- to someone who asked for it, a no. The session note
// said "Credit App: Not Started" and nothing offered it. Gil, 10/29: "The Baytown stores agents can follow up with Drive out.
// Lafayette stores we can not due to parish tax variances. Although we would like them to come in and review the drive out. So we
// would push for an appointment regardless." Runs the shipped inlineScraper in Chromium, builds the prompt through the shipped
// panel payload, and executes _lpRefineSms. Placeholder data only.
//
// Usage: node tests/otd-creditapp-839.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const { chromium } = require('playwright');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: otd-creditapp-839.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }

// The CRM page, for the scraper.
let id = 550000000;
const note = (dir, when, title, html) => { id++; return '<span id="notes-and-history-item-' + id + '" data-tags="x" data-direction="' + dir
  + '" data-unique-identifier-type="AutoLeadMessageID" data-unique-identifier-value="' + id + '" class="notes-and-history-item list-group-item">'
  + '<div class="notes-and-hsitory-item-date">' + when + '</div><div class="notes-and-hsitory-item-detail"><div class="notes-and-history-item-header">'
  + '<div class="legacy-notes-and-history-title">' + title + '</div></div><div class="notes-and-history-item-content">' + html + '</div></div></span>'; };
const PAGE = (notes) => '<html><body><div>Lead Info<br>Status:\tActive<br>Created:\t10/29/26 4:48p (0d)<br>Source:\tGubagoo Virtual Retailing</div><div id="notes">' + notes.join('') + '</div></body></html>';
const VR_NOTE = (app, pay) => note('Inbound', '10/29/2026 4:48 PM', 'Lead received', '<div>By: System</div><div>Click for Lead Info: <a href="https://dealer.example.test/l/x">dealer.example.test%2fl...</a><br>'
  + 'Customer is online<br>Opened VR From button (VDP page)<br>Dropped off on Financing page<br>Payment: $999.99/month (' + pay + '); Term: 48 mo; Down Payment: $1000;<br>'
  + 'APR: %4.99; Lender: Test Lender Corp;<br>Credit App: ' + app + '<br>Lead Type: virtual retailing</div>');

// The lead, for the prompt and the rewrite.
const E = (date, time, tag, title, body) => '[' + date + ' ' + time + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = '[10/29/2026 4:48 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const TEXT = E('10/29/2026', '4:58 PM', 'AGENT', 'Outbound Text Message', 'Test, the 2026 RAV4 Plug-In Hybrid XSE is here, ready for you to see. Would 9:15 AM or 10:30 AM Friday, October 30 work better? Agent');
const CALL = (words) => E('10/29/2026', '4:57 PM', 'AGENT', 'Outbound phone call (Contacted)', 'By: Agent Name\n  ' + words);
const LSD = (x, hist) => { const h = (hist || (TEXT + CALL('interested. wants OTD'))) + MARK;
  return Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Agent Name', vehicle: '2026 Toyota RAV4 Plug-In Hybrid XSE',
    stockNum: 'TEST0R1', dealerId: '6189', store: 'Community Toyota Baytown', leadSource: 'Gubagoo Virtual Retailing', convState: 'call-followup', leadAgeDays: 0,
    hasOutbound: true, isContacted: true, hasCustomerReply: false, totalNoteCount: 6, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '',
    relationshipSignals: { unansweredQuestions: [] }, vrPaymentSelected: true, vrDroppedOff: true, vrDroppedOffPage: 'Financing',
    vrCreditAppNotStarted: true, vrPayType: 'Finance', history: h, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + h + '---' }, x || {}); };
const LAF = { dealerId: '24399', store: 'Community Honda Lafayette', vehicle: '2026 Honda Accord Sport', stockNum: 'TEST0A1' };

(async () => {
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }).catch(() => chromium.launch());
  for (const f of BUILDS) {
    console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
    let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
    const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };

    console.log(' 1. the shipped scraper reads the credit application step off the session note:');
    const sa = src.indexOf('  function inlineScraper() {'), sbx = src.indexOf('  } // end inlineScraper', sa);
    const scraper = src.slice(sa, sbx + 3);
    const scrape = async (notes) => {
      const ctx = await br.newContext({ timezoneId: 'America/Chicago' }); const page = await ctx.newPage();
      await page.route('**/*', r => /\/CarDashboard\/lead$/.test(r.request().url()) ? r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE(notes) }) : r.abort());
      await page.clock.install({ time: new Date('2026-10-29T17:00:00-05:00').getTime() });
      await page.goto('https://crm.example.test/CarDashboard/lead', { waitUntil: 'domcontentloaded' });
      let res; try { res = await page.evaluate('(async()=>{' + scraper + '\n; return await inlineScraper();})()'); } catch (e) { res = { err: e.message }; }
      await ctx.close(); return res || {};
    };
    const s1 = await scrape([VR_NOTE('Not Started', 'Finance')]);
    check('lead 2107371352: "Credit App: Not Started" and "(Finance)" are carried; no credit app counted as submitted', () =>
      [s1.vrCreditAppNotStarted, s1.vrPayType, s1.vrCreditApp, s1.vrDroppedOffPage, s1.err || ''], [true, 'Finance', false, 'Financing', '']);
    const s2 = await scrape([VR_NOTE('Submitted', 'Lease')]);
    check('control: a submitted application is not "not started"', () => [s2.vrCreditAppNotStarted, s2.vrCreditApp, s2.vrPayType], [false, true, 'Lease']);

    const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; const logs = []; sb.console.log = (...a) => logs.push(a.join(' ')); sb.console.warn = () => {};
      try { return { v: g(), logs }; } finally { sb.console.log = ol; sb.console.warn = ow; } };
    const built = (lsd) => quiet(() => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(lsd);
      return String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: run('leadContext') }))); });

    console.log(' 2. Baytown: they asked on the call; the agent follows up with the drive-out, and we push the visit:');
    const b = built(LSD());
    check('lead 2107371352: the prompt says they asked on the 10/29 call and that this store follows up with the drive-out numbers', () =>
      /^OUT-THE-DOOR PRICE — THEY ASKED FOR IT, on the 10\/29 phone call \(the call note says "interested\. wants OTD"; never quote the note\)\. That counts as asking: the OTD rule's "unless the customer asked" is met\. At this store the agent follows up with the drive-out numbers/m.test(b.v), true);
    check('never opened on, never put off to a visit or a call; "I\'m putting together your drive-out numbers on the RAV4 Plug-In Hybrid XSE"; no figure of our own', () =>
      [/\(1\) Do NOT open with it, and never write that the out-the-door or drive-out price is something we go over in person, at the dealership or on a call/.test(b.v),
       /"I'm putting together your drive-out numbers on the RAV4 Plug-In Hybrid XSE\." Write no figure of your own/.test(b.v)], [true, true]);
    check('then the appointment to review it: the times our last text offered are asked about again, not replaced', () =>
      /\(3\) Then ask for the appointment to go over them together: we want them to come in and review the drive-out with us\. If our newest message already offered times they have not answered, ask whether one of those still works/.test(b.v), true);
    check('the console says where the ask came from', () => b.logs.some(l => /^\[LP OTD ASK DIAG\] asked on the call 10\/29 \("interested\. wants OTD"\) \| store: drive-out follow-up \| block: emitted$/.test(l)), true);
    check('a customer who asked in their own text gets the same block, "in their 10/29 message"', () =>
      /THEY ASKED FOR IT, in their 10\/29 message \("what is the out the door price on it\?"\)/.test(built(LSD({}, TEXT + E('10/29/2026', '5:10 PM', 'CUSTOMER', 'Inbound Text Message', 'what is the out the door price on it?'))).v), true);
    check('control: no ask on the lead -> no block', () => /OUT-THE-DOOR PRICE — THEY ASKED/.test(built(LSD({}, TEXT + CALL('interested. will call back after work'))).v), false);
    check('control: a note that we SENT the drive-out is not an ask', () => /OUT-THE-DOOR PRICE — THEY ASKED/.test(built(LSD({}, TEXT + CALL('sent OTD to customer, reviewing with wife'))).v), false);

    console.log(' 3. Lafayette: no drive-out in writing (parish tax), and the visit is still pushed:');
    const l = built(LSD(LAF));
    check('the store policy keeps the parish rule, says they asked on the call, and opens on the car or the proposal, not on what we cannot do', () =>
      [/This store does NOT provide out-the-door or drive-out totals over text or phone/.test(l.v),
       /THEY HAVE ASKED FOR IT, on the 10\/29 phone call .*do NOT open the message on what we cannot do: open on the vehicle or on what is being prepared for them, give the parish reason in one sentence, and push for the appointment to review the drive-out in person\./.test(l.v),
       /At this store the agent follows up with the drive-out numbers/.test(l.v)], [true, true, false]);

    console.log(' 4. the credit application is the next step:');
    check('lead 2107371352: Click & Go, financing, not started -> offer to send the secure credit application, in both formats, once', () =>
      /^- THE NEXT STEP THEY CAN TAKE BEFORE COMING IN: their Click & Go session shows the credit application was NOT started\. Offer once, in BOTH the text and the email, to send them the secure credit application so their financing is ready when they come in/m.test(b.v), true);
    check('controls: a cash deal, an application already in, and a session that never said "not started" get no offer', () =>
      [built(LSD({ vrPayType: 'Cash' })).v, built(LSD({ vrCreditApp: true })).v, built(LSD({ vrCreditAppNotStarted: false })).v].map(p => /THE NEXT STEP THEY CAN TAKE BEFORE COMING IN/.test(p)), [false, false, false]);

    console.log(' 5. the text rewrite does not open on the price, or put the drive-out off where the agent sends it:');
    const SIG = '\nAgent\nTest Store\n(555) 010-0100';
    const EMAIL = 'Hi Test,\n\nI am putting together your drive-out numbers on the RAV4 Plug-In Hybrid XSE. Does Friday at 9:15 or 10:30 still work to go over them?\n\nAgent Name\nTest Store\n(555) 010-0100';
    const refine = async (d, pass1, reply) => { const logs = []; sb.__reply = reply; sb.__d = d;
      run('_lpLastVisitDecision = { level: 0, owner: "" }; window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Test Store" };'
        + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpAddApptLeadId = ""; window._lpActiveProhibitions = [];'
        + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
        + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
        + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };');
      const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...q) => logs.push(q.join(' ')); sb.console.warn = () => {};
      let out; try { out = await run('_lpRefineSms(' + JSON.stringify(pass1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)'); } catch (e) { out = 'THREW ' + e.message; }
      sb.console.log = ol; sb.console.warn = ow;
      return [out === null ? null : 'shipped', (logs.find(x => /kept the first pass — the rewrite (?:opened by putting the out-the-door price off|put the drive-out off)/.test(x)) || '').replace(/^.*kept the first pass — /, '').replace(/ \(".*$| \|.*$/, '')]; };
    const P1 = 'Test, I\'m putting together your drive-out numbers on the RAV4 Plug-In Hybrid XSE. Does Friday at 9:15 or 10:30 still work to go over them?' + SIG;
    await acheck('log381: the rewrite opens "the out-the-door figure you asked about is something we can go through together at the dealership" -> the first pass ships', () =>
      refine(LSD(), P1, 'Test, the out-the-door figure you asked about is something we can go through together at the dealership. Does Friday at 9:15 work?' + SIG), [null, 'the rewrite opened by putting the out-the-door price off']);
    await acheck('Baytown: a rewrite that puts the drive-out off to a visit later in the text -> the first pass ships', () =>
      refine(LSD(), P1, 'Test, the RAV4 is ready for you. We can go over the drive-out price together in person Friday at 9:15 or 10:30.' + SIG), [null, 'the rewrite put the drive-out off']);
    await acheck('Lafayette: the same opener is held there too (open on the car or the proposal, not on what we cannot do)', () =>
      refine(LSD(LAF), P1, 'Test, the out-the-door figure you asked about is something we can go through together at the dealership. Does Friday at 9:15 work?' + SIG), [null, 'the rewrite opened by putting the out-the-door price off']);
    await acheck('control: Lafayette (no drive-out in writing), the in-person sentence after the opener ships', () =>
      refine(LSD(LAF), P1, 'Test, the Accord is ready for you. We can go over the drive-out price together in person Friday at 9:15 or 10:30.' + SIG), ['shipped', '']);
    await acheck('control: no out-the-door ask on the lead -> the rewrite ships', () =>
      refine(LSD({}, TEXT + CALL('interested. will call back after work')), P1, 'Test, the out-the-door figure is something we can go through together at the dealership.' + SIG), ['shipped', '']);
  }
  await br.close();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
