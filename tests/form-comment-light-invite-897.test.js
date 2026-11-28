#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('form-comment-light-invite-897.test.js');
// (v9.7.897) TWO FIXES. (1) A web form's comment, ahead of its "----------" fields: Audi Lafayette lead 3122586517 (Dealer.com E-Pricer,
// 11/27) asked "Pictures show brown interior listing says black" in a lead-received note followed by CCPA and tracking fields; the intake
// reader refused the note as machine fields and the inquiry reader found it too long, so the question never reached the prompt. Part 1
// runs the SHIPPED inlineScraper in Chromium on a placeholder page of that shape. (2) Owner, 11/27: "a light ask for an appointment to
// come see the vehicle or go over options rather than the other questions" -- the first reach-out closes with an open invitation, no
// times and no day (rulings: open invite, no times; first reach-out only). Placeholder data only.
//
// Usage: node tests/form-comment-light-invite-897.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const { chromium } = require('playwright');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: form-comment-light-invite-897.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
let id = 560000000;
const note = (dir, when, title, html) => { id++; return '<span id="notes-and-history-item-' + id + '" data-tags="x" data-direction="' + dir
  + '" data-unique-identifier-type="AutoLeadMessageID" data-unique-identifier-value="' + id + '" class="notes-and-history-item list-group-item">'
  + '<div class="notes-and-hsitory-item-date">' + when + '</div><div class="notes-and-hsitory-item-detail"><div class="notes-and-history-item-header">'
  + '<div class="legacy-notes-and-history-title">' + title + '</div></div><div class="notes-and-history-item-content">' + html + '</div></div></span>'; };
const PAGE = (notes) => '<html><body><div>Lead Info<br>Status:\tActive<br>Created:\t11/27/26 9:27a (0d)<br>Source:\tDealer.Com - Get Eprice</div><div id="notes">' + notes.join('') + '</div></body></html>';
const FIELDS = '<br>---------- CCPA Consent: Checked<br>---------- CCPA_VERBIAGE: I understand I do not have to consent as a condition of purchase or to receive any services. By checking this box, I agree the dealer and its vendors may use the number provided to make telemarketing calls or texts via automated technology. Carrier charges may apply.<br>By submitting your information, you agree to the sharing of your information.<br>---------- CONTACT_ID_FOR_DEALREFID: 0000000000test0000000000000000aa<br>---------- Submission Timestamp: 2026-11-27T15:26:12<br>---------- VinLens Session ID: 00000.0000000000000.0000<br>---------- devicePlatformLeadTag: mobile<br>---------- formElapsedTime: 134094<br>---------- listingType: standard<br>---------- source: E Pricer - Dealer.Com Website';
const RECEIVED = (comment) => note('Inbound', '11/27/2026 9:26 AM', 'Lead received', '<div>By: System</div><div>' + comment + FIELDS + '</div>');
const CT = (y, mo, d, h, mi) => { const guess = Date.UTC(y, mo - 1, d, h + 6, mi); const off = (new Date(guess).toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }) | 0) - h; return guess - off * 3600000; };
const NOW = CT(2026, 11, 27, 14, 0);
const E = (day, clock, tag, title, body) => '[' + day + ' ' + clock + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (day) => '[' + day + ' 9:00 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const NEW = E('11/27/2026', '1:50 PM', 'CUSTOMER REQUEST FROM INQUIRY', 'Lead Received', 'I am interested in the CR-V EX.') + MARK('11/27/2026');
const LEAD = (h, x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Honda CR-V EX', condition: 'New', dealerId: '6191',
  store: 'Community Honda Baytown', leadSource: 'Honda.com', convState: 'first-touch', leadAgeDays: 0, hasOutbound: false, hasCustomerReply: false, totalNoteCount: 3, phone: '(555) 010-0199',
  email: 'test@example.com', customerZip: '12345', relationshipSignals: { unansweredQuestions: [] }, conversationBrief: h, history: h, context: '', autoLeadId: 'TEST017S', outboundSends: [] }, x || {});
const EMAIL = 'Hi Test,\n\nThe 2026 CR-V EX is here. Would you like to come take a look at it?\n\nAgent Name';

(async () => {
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }).catch(() => chromium.launch());
  for (const f of BUILDS) {
    console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
    let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
    const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };

    console.log(' 1. the customer\'s comment ahead of a web form\'s fields (shipped scraper):');
    const sa = src.indexOf('  function inlineScraper() {'), sbx = src.indexOf('  } // end inlineScraper', sa);
    const scraper = src.slice(sa, sbx + 3);
    const scrape = async (notes) => {
      const ctx = await br.newContext({ timezoneId: 'America/Chicago' }); const page = await ctx.newPage();
      await page.route('**/*', r => /\/CarDashboard\/lead$/.test(r.request().url()) ? r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE(notes) }) : r.abort());
      await page.clock.install({ time: new Date('2026-11-27T09:48:00-06:00').getTime() });
      await page.goto('https://crm.example.test/CarDashboard/lead', { waitUntil: 'domcontentloaded' });
      let res; try { res = await page.evaluate('(async()=>{' + scraper + '\n; return await inlineScraper();})()'); } catch (e) { res = { err: e.message }; }
      await ctx.close(); return res || {};
    };
    const Q = 'I’m interested but need some clarification, Pictures show brown interior listing says black';
    const s1 = await scrape([RECEIVED(Q)]);
    check('lead 3122586517\'s shape: the question reaches the transcript as the customer\'s inquiry', () => [String(s1.conversationBrief || '').indexOf('[CUSTOMER REQUEST FROM INQUIRY] ' + Q) >= 0, s1.err || ''], [true, '']);
    check('...and as their stated intent, with none of the form fields', () => [s1.leadIntakeReq, /CCPA|Submission Timestamp|VinLens/.test(String(s1.leadIntakeReq || '') + String(s1.conversationBrief || ''))], [Q, false]);
    const s2 = await scrape([RECEIVED('')]);
    check('control: the same fields with no comment -> no inquiry and no stated intent', () => [/CUSTOMER REQUEST FROM INQUIRY/.test(String(s2.conversationBrief || '')), s2.leadIntakeReq || ''], [false, '']);

    sb.__I = { units: [{ stock: 'TEST0Q7', vehicle: '2023 Audi Q7 45 Premium Plus quattro', year: 2023, make: 'Audi', model: 'Q7 45 Premium Plus quattro', color: 'Glacier White', interior: 'Brown', condition: 'used' }] };
    run('_lpValueFactCache["21135"] = { inv: globalThis.__I };');
    const intr = (req) => { const r = run('_lpStockInteriorLine')({ stockNum: 'TEST0Q7', dealerId: '21135', vehicle: '2023 Audi Q7 Premium Plus', lastInboundMsg: '', leadIntakeReq: req, conversationBrief: '', context: '' }); return r ? r.text : null; };
    check('the form comment is read for the interior they asked about: our record says Brown, said plainly', () => /THE INTERIOR THEY ASKED ABOUT \(brown\): our inventory record for this unit lists the interior as Brown[^\n]*say so plainly/.test(intr(Q) || ''), true);
    check('control: no comment -> no interior line', () => intr(''), null);

    console.log(' 2. the first reach-out: a light, open invitation -- no times, no day, no other question:');
    vm.runInContext('(function(){ var RD = Date, FIX = ' + NOW + '; function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); } FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; Date = FD; })()', sb);
    const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
    const prompt = (d) => quiet(() => { run('activeFlags = new Set(); leadContext = ""; window._lpAddApptLeadId = "";'); sb.__L = d; run('lastScrapedData = globalThis.__L;'); sb.populateFromData(d);
      return String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: d, context: String(run('leadContext') || '') }))); });
    const p1 = prompt(LEAD(NEW));
    check('the block invites them in -- to see the car or go over options -- with no time and no day', () =>
      [/FIRST REACH-OUT — LIGHT VISIT INVITE, NO TIMES: [^\n]*closes with a light, open invitation to come in -- to see the car, or to go over their options -- and offers no appointment time and no day/.test(p1), /BUILD ENGAGEMENT, NO VISIT ASK/.test(p1)], [true, false]);
    check('the journey chooses what the invitation is about (one car named: "to come see it in person, and drive it if they like")', () => /Let it choose what the invitation is about: to come see it in person, and drive it if they like\./.test(p1), true);
    check('the invitation is the close: no other question, and anything they asked is answered first', () =>
      [/The invitation is the close\. No other question: not what they drive, what they are comparing, their budget or their timeline\./.test(p1), /Answer anything they asked first/.test(p1)], [true, true]);
    check('the visit decision is "no specific times", owned by the first reach-out (level 2, not "no visit ask")', () =>
      [/VISIT DECISION FOR THIS MESSAGE: no specific appointment times and no same-day push in this message; invite them in only as that instruction allows -- the FIRST REACH-OUT \(a light invite: no times, no day\) owns this\./.test(p1), /SUGGESTED APPOINTMENT TIMES \(fallback only/.test(p1)], [true, false]);
    check('a car on its way: never invited to see it, invited to go over the details', () => /If it is not here yet \(on its way to us\), never invite them to see it: invite them to come go over the details or their options\./.test(p1), true);
    const pF = prompt(LEAD(E('11/24/2026', '10:00 AM', 'AGENT', 'Outbound Text Message', 'Test, thanks for asking about the CR-V EX. Is it still on your list?') + E('11/23/2026', '9:30 AM', 'CUSTOMER REQUEST FROM INQUIRY', 'Lead Received', 'I am interested in the CR-V EX.') + MARK('11/23/2026'),
      { convState: 'active-follow-up', hasOutbound: true, leadAgeDays: 4, totalNoteCount: 6 }));
    check('control: a follow-up (our second message) is unchanged -- no first-reach-out block, the concrete question line stays', () => [/FIRST REACH-OUT/.test(pF), /\nCONCRETE QUESTION: /.test(pF)], [false, true]);
    sb.__L = LEAD(NEW); run('lastScrapedData = globalThis.__L; _lpLastVisitDecision = { level: 2, owner: "the FIRST REACH-OUT (a light invite: no times, no day)" };');
    const r = quiet(() => String(run('_lpBuildSmsRefinePrompt')('Test, the CR-V EX is here.', EMAIL, LEAD(NEW))));
    check('the text rewrite ends on the same light invitation the email makes, no time, no day, no other question', () =>
      /end on the same light invitation the email makes -- to come see the car or go over their options -- with no time, no day and no other question\./.test(r), true);
  }
  await br.close();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
