#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('offer-yes-823.test.js');
// (v9.7.823) A YES TO OUR OFFER, A REACTIVATED LEAD, A SYSTEM FLAG, AND THE DRAFT TALKING ABOUT ITS INSTRUCTIONS.
// Honda Lafayette lead 2055144034 (log358): three months after the lead went quiet it was reactivated, the salesperson called and
// texted "What I can do to save you as much time as possible, is send over a credit app", and the customer answered "Ok". The
// scraper glued a July "Yes" onto it ("Yes / Ok"), the prompt called the reply "the same as silence", the phone-up block said the
// customer "has not responded" and that a payment quote was already out (a July phone note: "monthly payments ... wanted one sent
// over"), and the July details read as current. Honda Baytown, 10/24: a TrueCar "*** NO MATCHING VIN — ... ***" banner reached the
// email as the customer's words, and a text rewrite after the Add Appt Ask chip shipped "Those times aren't specified in the email,
// so I shouldn't invent them."
// Runs the SHIPPED inlineScraper in Chromium against placeholder lead pages, and executes buildUserPrompt (through the panel
// payload), _lpBuildSmsRefinePrompt, _lpRefineSms (worker stubbed) and the render-time _lpAmericanSpelling. Placeholder data only.
//
// Usage: node tests/offer-yes-823.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: offer-yes-823.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const sure = (fn) => { try { return fn(); } catch (e) { return 'THREW: ' + e.message; } };
// ── placeholder lead pages, in VinSolutions' own note markup ──────────────────────────────────────────────────────────
const note = (id, tags, dir, when, title, html) => '<span id="notes-and-history-item-' + id + '" data-tags="' + tags + '" data-direction="' + dir
  + '" data-unique-identifier-type="AutoLeadMessageID" data-unique-identifier-value="' + id + '" class="notes-and-history-item list-group-item">'
  + '<div class="notes-and-hsitory-item-date">' + when + '</div><div class="notes-and-hsitory-item-detail"><div class="notes-and-history-item-header">'
  + '<div class="legacy-notes-and-history-title">' + title + '</div></div><div class="notes-and-history-item-content">' + html + '</div></div></span>';
const PAGE = (notes) => '<html><body><div id="notes">' + notes.join('') + '</div></body></html>';
const TXT_IN = (id, when, body) => note(id, 'Communication-Texts', 'Inbound', when, 'Inbound Text Message', 'Received from: (555) 010-0199<br>Received by: Rep Name<br>' + body);
const TXT_OUT = (id, when, body) => note(id, 'Communication-Texts', 'Outbound', when, 'Outbound Text Message', 'Sent to: (555) 010-0199<br>Sent by: Rep Name<br>' + body);
const OFFER = 'Good morning Test, this is Rep again with Test Honda. We spoke this morning about getting a new vehicle. What I can do to save you as much time as possible, '
  + 'is send over a credit app for you. From there we can complete as much as possible before you come in. Reply STOP to cancel.';
const YES_PAGE = [TXT_IN('200000001', '10/26/2026 9:22 AM', 'Ok'), TXT_OUT('200000002', '10/26/2026 9:19 AM', OFFER),
  TXT_IN('200000003', '07/24/2026 2:58 PM', 'I found me a vehicle'), TXT_IN('200000004', '07/24/2026 2:57 PM', 'Yes'),
  TXT_OUT('200000005', '07/24/2026 2:57 PM', 'Rep here again from Test Honda. Have you narrowed down what you are looking for?')];
const BURST = [TXT_IN('200000011', '10/26/2026 9:22 AM', 'Please'), TXT_IN('200000012', '10/26/2026 9:20 AM', 'How much is it out the door?'),
  TXT_OUT('200000013', '10/26/2026 9:00 AM', 'Test, the Civic you asked about is here. Agent')];
const TRUECAR = note('200000021', 'Email-Communication', 'Inbound', '10/24/2026 8:40 AM', 'Lead received', '<div>By: System</div>Verified Prospect<br>*** DEALER PORTAL ***<br>'
  + 'LEAD: BUILD (NEW) | EXPIRES: 10/30/2026<br>*** NO MATCHING VIN ? HONOR YOUR DISCOUNT ON LOCATE/ORDER ***<br>BUILD: 2026 Honda Prelude Hybrid | Boost Blue Pearl / Black<br>'
  + 'MSRP: $43,950 | OFFER SHOWN: $43,175<br>Customer ID: 1000000001 | LeadID: 1000000002 | DealerID: 6191');
const ASKED = note('200000022', 'Email-Communication', 'Inbound', '10/24/2026 8:40 AM', 'Lead received', '<div>By: System</div>Is the Prelude still available?<br>Customer ID: 1000000001 | LeadID: 1000000002 | DealerID: 6191');
// ── placeholder prompt fixture ───────────────────────────────────────────────────────────────────────
const M = 60000, H = 60 * M, D = 24 * H, NOW = Date.now();
const fmt = (ms) => { const f = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  .formatToParts(new Date(ms)).reduce((o, p) => (o[p.type] = p.value, o), {}); return f.month + '/' + f.day + '/' + f.year + ' ' + f.hour + ':' + f.minute + ' ' + f.dayPeriod.toUpperCase(); };
const md = (ms) => fmt(ms).slice(0, 5);
const E = (ms, tag, title, body) => '[' + fmt(ms) + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (ms) => '[' + fmt(ms) + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const LINK = 'https://www.example.test/finance-application/';
const T0 = NOW - 98 * D;
const OLD = E(T0 + 4 * D + 1 * M, 'CUSTOMER', 'Inbound Text Message', 'I found me a vehicle') + E(T0 + 4 * D, 'CUSTOMER', 'Inbound Text Message', 'Yes')
  + E(T0 + 4 * D - M, 'AGENT', 'Outbound Text Message', 'Rep here again from Test Honda. Have you narrowed down what you are looking for?')
  + E(T0 + 6 * M, 'AGENT', 'Outbound Text Message', 'https://www.example.test/search/used/?pr=18365:23365 This is a link to our current inventory, the cheapest we have is around 19,000')
  + E(T0 + 4 * M, 'AGENT', 'Outbound Text Message', 'Hi Test, this is Rep with Test Honda. This will be the link to our credit application. ' + LINK + ' Rep')
  + E(T0 + M, 'NOTE', 'General Note', 'By: Rep Name called in- wanted to know if we have vehicles that only require monthly payments, stated that she will need to do a credit application, wanted one sent over to her, wants budget of 10k -sent txt')
  + MARK(T0);
const HIST = (o) => (o.reply === null ? '' : E(NOW - 10 * M, 'CUSTOMER', 'Inbound Text Message', o.reply || 'Ok'))
  + E(NOW - 13 * M, 'AGENT', 'Outbound Text Message', o.ours || OFFER)
  + (o.noReact ? '' : E(NOW - 18 * M, 'NOTE', 'General Note', 'By: Agent Name User Agent Name has reactivated this lead with the following note: test'))
  + (o.recent ? E(NOW - 5 * D, 'CUSTOMER', 'Inbound Text Message', 'I will think about it') : '')
  + (o.quoteNote ? E(NOW - 2 * D, 'NOTE', 'General Note', 'By: Rep Name sent her the numbers: $450 a month with $2,000 down') : '')
  + OLD;
const LEAD = (o) => { o = o || {}; const h = HIST(o); return Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name',
  vehicle: '', dealerId: '6191', store: 'Test Honda', leadSource: 'Phone Up', convState: 'active-follow-up', leadAgeDays: 98, hasOutbound: true, hasCustomerReply: true,
  totalNoteCount: 23, phone: '(555) 010-0199', email: 'test@example.com', customerZip: '00000', lastInboundMsg: o.reply === null ? '' : (o.reply || 'Ok'),
  lastOutboundMsg: o.ours || OFFER, lastSubstantiveOutboundMsg: o.ours || OFFER,
  relationshipSignals: { unansweredQuestions: [], hasUnansweredQuestions: false, customerCommitments: [], agentCommitments: [], lastInboundAgeDays: 0 },
  history: h, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + h + '---' }, o.x || {}); };
const PASS1 = 'Test, we have 10:30 AM or 2:00 PM Thursday open to see the Civic LX. Which works better?\nAgent';
const EMAIL = 'Subject: Your Civic LX\n\nTest,\n\nThe Civic LX is here and ready for you.\n\nAgent Name';
const LEAK = 'Test, the Civic LX is here. Those times aren’t specified in the email, so I shouldn’t invent them. When works for you?\nAgent';
const GOOD = 'Test, the Civic LX is ready. Would 10:30 AM or 2:00 PM Thursday work?\nAgent';

(async () => {
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }).catch(() => chromium.launch());
  for (const f of BUILDS) {
    console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
    const src = fs.readFileSync(f, 'utf8');
    const sa = src.indexOf('  function inlineScraper() {'), sbx = src.indexOf('  } // end inlineScraper', sa);
    const scraper = src.slice(sa, sbx + 3);
    const scrape = async (notes, at) => {
      const ctx = await br.newContext({ timezoneId: 'America/Chicago' }); const page = await ctx.newPage();
      await page.route('**/*', r => /\/CarDashboard\/lead$/.test(r.request().url())
        ? r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE(notes) }) : r.abort());
      await page.clock.install({ time: new Date(at || '2026-10-26T09:30:00-05:00').getTime() });
      await page.goto('https://crm.example.test/CarDashboard/lead', { waitUntil: 'domcontentloaded' });
      let res; try { res = await page.evaluate('(async()=>{' + scraper + '\n; return await inlineScraper();})()'); } catch (e) { res = { err: e.message }; }
      await ctx.close(); return res || {};
    };

    console.log(' 1. the scraper: the customer\'s newest message is not glued to one from July:');
    const s1 = await scrape(YES_PAGE);
    check('lead 2055144034: 10/26 "Ok" stands alone (was "Yes / Ok" -- two July texts a minute apart were compared with each other)', [s1.lastInboundMsg, s1.err || ''], ['Ok', '']);
    const s2 = await scrape(BURST);
    check('control: two texts two minutes apart are still read together, oldest first', s2.lastInboundMsg, 'How much is it out the door? / Please');

    console.log(' 2. a TrueCar system flag is not the customer\'s question:');
    const s3 = await scrape([TRUECAR], '2026-10-24T08:51:00-05:00');
    const q3 = ((s3.relationshipSignals || {}).unansweredQuestions || []).map(q => q.question);
    check('"*** NO MATCHING VIN ? HONOR YOUR DISCOUNT ... ***" is not an open question, their last message or their inquiry',
      [q3.some(q => /MATCHING VIN/i.test(q)), /MATCHING VIN/i.test(s3.lastInboundMsg || ''), /\[CUSTOMER REQUEST FROM INQUIRY\][^\n]*MATCHING VIN/i.test(s3.history || ''), s3.err || ''], [false, false, false, '']);
    const s4 = await scrape([ASKED], '2026-10-24T08:51:00-05:00');
    check('control: a question the customer typed into the form is still an open question of theirs',
      ((s4.relationshipSignals || {}).unansweredQuestions || []).some(q => /still available\?/.test(q.question)), true);

    let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
    const run = (e) => vm.runInContext(e, sb);
    const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
    const viaPanel = (lsd) => quiet(() => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(lsd);
      return sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: run('leadContext') })); });

    console.log(' 3. a yes to our offer: the message delivers it:');
    const p = String(sure(() => viaPanel(LEAD())));
    check('lead 2055144034: "Ok" after "What I can do ... is send over a credit app" -> THEY SAID YES TO OUR OFFER, with the finance-application link already sent',
      [p.indexOf('✅ THEY SAID YES TO OUR OFFER: on ' + md(NOW - 13 * M) + ' Rep, their salesperson, offered: "What I can do to save you as much time as possible, is send over a credit app for you.", and the customer answered "Ok".') >= 0,
        p.indexOf('send the credit application now -- the link already sent on this lead is ' + LINK + ' --') >= 0], [true, true]);
    check('the silence lines stand down: no "same as silence", no "has not responded", and the phone-up task says they said yes',
      [/for restate purposes this is the same as silence/.test(p), /customer has not responded|has not responded to multiple attempts/.test(p),
        /TASK: Phone-up lead — the customer just said yes to what we offered\./.test(p), /The customer answered that message with "Ok" -- a yes to what it offered/.test(p)], [false, false, true, true]);
    check('a July phone note ("monthly payments ... wanted one sent over") is not a payment quote already out', /PAYMENT\/PRICE ALREADY SENT/.test(p), false);
    const pQ = String(sure(() => viaPanel(LEAD({ quoteNote: true, reply: null, noReact: true }))));
    check('control: "sent her the numbers: $450 a month" is a quote already out', /PAYMENT\/PRICE ALREADY SENT/.test(pQ), true);
    const pN = String(sure(() => viaPanel(LEAD({ ours: 'Test, just checking in from Test Honda. Are you still looking? Agent' }))));
    check('control: "Ok" to a check-in that offered nothing is not a yes to an offer', /THEY SAID YES TO OUR OFFER/.test(pN), false);
    const pL = String(sure(() => viaPanel(LEAD({ reply: 'Ok but what is the price on the Accord first' }))));
    check('control: a reply that says more than yes is not read as one', /THEY SAID YES TO OUR OFFER/.test(pL), false);

    console.log(' 4. a reactivated lead starts a new chapter:');
    check('reactivated after three months: the earlier thread is background (the budget, the "I found one", the inventory link)',
      /🔄 THIS LEAD WAS REACTIVATED ON [\d/]+, after 9\d days with no messages either way\. What happened after that note is the conversation now; everything before it is background\./.test(p), true);
    check('control: no reactivation note, no new-chapter line', /THIS LEAD WAS REACTIVATED/.test(String(sure(() => viaPanel(LEAD({ noReact: true }))))), false);
    check('control: reactivated five days after their last message: not a new chapter', /THIS LEAD WAS REACTIVATED/.test(String(sure(() => viaPanel(LEAD({ recent: true }))))), false);

    console.log(' 5. the Add Appt Ask chip and the rewrite keep the times; the draft never talks about its instructions:');
    const rp = String(quiet(() => sb._lpBuildSmsRefinePrompt(PASS1, EMAIL, LEAD({ noReact: true, reply: null }))));
    check('the rewrite keeps the first draft\'s times when the email has none, and never mentions the email or the first draft',
      rp.indexOf('If the email has none and the first draft does, keep the first draft\'s times. Never invent different ones, and never mention the email or the first draft in the text.') >= 0, true);
    check('the Add Appt Ask chip asks for the same times in every format',
      src.indexOf("'add-appt':      'Ask for the appointment: invite the customer in with one or two specific times inside store hours, the same times in every format (the text, the email and the voicemail)") >= 0, true);
    const refine = async (reply) => { const logs = []; sb.__reply = reply; sb.__d = LEAD({ noReact: true, reply: null });
      run('window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Test Honda" };'
        + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpActiveProhibitions = [];'
        + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
        + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
        + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };');
      const ol = sb.console.log; sb.console.log = (...x) => logs.push(x.join(' '));
      let out; try { out = await run('_lpRefineSms(' + JSON.stringify(PASS1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)'); } catch (e) { out = 'THREW ' + e.message; }
      sb.console.log = ol; return [out === null ? null : 'shipped', logs.some(l => /kept the first pass — the rewrite talked about its own instructions \("n’t specified in the email"\)/.test(l))]; };
    check('10/24 Civic LX: "Those times aren\'t specified in the email, so I shouldn\'t invent them" -> the first pass ships, logged', await refine(LEAK), [null, true]);
    check('control: a rewrite that keeps the times ships', await refine(GOOD), ['shipped', false]);
    const am = (t) => quiet(() => sb._lpAmericanSpelling(t));
    check('render: the same sentence in an email or voicemail is cut, the rest stays',
      am('Test,\n\nThe Civic LX is here. Those times aren\'t specified in the email, so I shouldn\'t invent them. Would Thursday work?\n\nAgent Name'),
      'Test,\n\nThe Civic LX is here. Would Thursday work?\n\nAgent Name');
    const keep = 'Test, the payment options are listed in the email I sent. The previous version of the Civic had a CVT. Bring the bank draft with you.\nAgent';
    check('control: ordinary sentences about an email we sent, an earlier model, or a bank draft are untouched', am(keep), keep);
  }
  await br.close();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
