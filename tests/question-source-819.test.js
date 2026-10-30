#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('question-source-819.test.js');
// (v9.7.819) A CRM FIELD BECAME THE CUSTOMER'S QUESTION, NEVER AGED, AND THE TEXT REWRITE ANSWERED IT. Honda Baytown lead
// 2079723069 (log354): the KBB Instant Cash Offer note prints "Traffic Source: KBB ? Mobile" (a dash shown as "?"); the
// lead-received reader took "Traffic Source: KBB ?" as the customer's question; 45 days and 43 of our messages later the prompt
// still called it "the highest-leverage move this message can make"; the email and the first draft of the text ignored it, and
// the rewrite shipped "I see your question about whether the traffic source was KBB." Gil: "why didn't it take all the history
// into account ... Is this just a band aid or a true fix?" Three fixes: the reader, the age-out, the rewrite follows the email.
// Runs the SHIPPED inlineScraper in Chromium against placeholder lead pages, and executes buildUserPrompt (through the panel
// payload), _lpBuildSmsRefinePrompt and _lpRefineSms (worker stubbed). Placeholder data only.
//
// Usage: node tests/question-source-819.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: question-source-819.test.js <popup.js> [popup.js...]'); process.exit(2); }
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
const KBB = note('100000041', 'Email-Communication', 'Inbound', '09/07/2026 10:43 AM', 'Lead received', '<div>By: System</div>Offer Amount: $5,648<br>Traffic Source: KBB ? Mobile<br>'
  + 'Offer Link: <a href="https://kbb.example.test/x">www.kbb.com%2finstant-cash-off...</a><br>Customer ID: 1000000001 | LeadID: 1000000002 | DealerID: 6191');
const APR = note('100000042', 'Email-Communication', 'Inbound', '09/07/2026 10:43 AM', 'Lead received', '<div>By: System</div>I\'m gonna have to pay APR?<br>Customer ID: 1000000001 | LeadID: 1000000002 | DealerID: 6191');
const OURS = note('100000043', 'Email-Communication', 'Outbound', '09/07/2026 10:52 AM', 'Outbound Text Message', '<div>By: Agent Name</div>Thanks for using KBB. What are you shopping for next? Agent');
// ── placeholder prompt fixture ──────────────────────────────────────────────────────────────────────────────────────
const H = 3600000, D = 24 * H, NOW = Date.now();
const fmt = (ms) => { const f = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  .formatToParts(new Date(ms)).reduce((o, p) => (o[p.type] = p.value, o), {}); return f.month + '/' + f.day + '/' + f.year + ' ' + f.hour + ':' + f.minute + ' ' + f.dayPeriod.toUpperCase(); };
const E = (ms, tag, title, body) => '[' + fmt(ms) + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (ms) => '[' + fmt(ms) + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const T0 = NOW - 45 * D;
const SENDS = (n, from) => { let h = ''; for (let i = n; i >= 1; i--) h += E(from + i * 2 * D, 'AGENT', 'Outbound Text Message', 'By: Agent Name\n  Test, checking in on what you are shopping for next. Agent'); return h; };
const Q = (ms, text) => ({ date: fmt(ms), question: text, isObjection: false, older: false });
const LEAD = (o) => { o = o || {}; const h = SENDS(o.sends === undefined ? 6 : o.sends, o.qAt || T0) + MARK(T0 - 60000);
  return Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '', dealerId: '6191', store: 'Test Honda',
    leadSource: 'Kbb Ico Kelley Blue Book - Mobile', convState: 'active-follow-up', leadAgeDays: 45, hasOutbound: true, hasCustomerReply: false, totalNoteCount: 20,
    phone: '(555) 010-0199', email: 'test@example.com', customerZip: '00000', lastInboundMsg: '',
    relationshipSignals: { unansweredQuestions: [Q(o.qAt || T0, o.q || 'Traffic Source: KBB ?')], hasUnansweredQuestions: true, customerCommitments: [], agentCommitments: [] },
    history: h, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + h + '---' }, o.x || {}); };
const PASS1 = 'Test, I know the messages have added up, and I haven\'t heard back. Would you prefer we keep in touch by text, email, or not at all?\nAgent';
const EMAIL = 'Subject: How would you prefer we stay in touch?\n\nTest,\n\nI know our messages have added up. Would you prefer we contact you by text, by email, or not at all?\n\nAgent Name';
const KBB_REWRITE = 'Test, I see your question about whether the traffic source was KBB. Would you prefer we keep in touch by text, email, or not at all?\nAgent';
const GOOD_REWRITE = 'Test, I know it has been a lot of messages. Text, email, or not at all -- what works best for you?\nAgent';

(async () => {
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }).catch(() => chromium.launch());
  for (const f of BUILDS) {
    console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
    const src = fs.readFileSync(f, 'utf8');
    const sa = src.indexOf('  function inlineScraper() {'), sbx = src.indexOf('  } // end inlineScraper', sa);
    const scraper = src.slice(sa, sbx + 3);
    const scrape = async (notes) => {
      const ctx = await br.newContext({ timezoneId: 'America/Chicago' }); const page = await ctx.newPage();
      await page.route('**/*', r => /\/CarDashboard\/lead$/.test(r.request().url())
        ? r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE(notes) }) : r.abort());
      await page.clock.install({ time: new Date('2026-09-07T11:00:00-05:00').getTime() });
      await page.goto('https://crm.example.test/CarDashboard/lead', { waitUntil: 'domcontentloaded' });
      let res; try { res = await page.evaluate('(async()=>{' + scraper + '\n; return await inlineScraper();})()'); } catch (e) { res = { err: e.message }; }
      await ctx.close(); return res || {};
    };

    console.log(' 1. the reader: a CRM field is not the customer\'s question:');
    const k = await scrape([OURS, KBB]);
    const kq = ((k.relationshipSignals || {}).unansweredQuestions || []).map(q => q.question);
    check('lead 2079723069: "Traffic Source: KBB ? Mobile" is not an open question, an inquiry or their last message',
      [kq.some(q => /Traffic Source/i.test(q)), /Traffic Source/i.test(k.lastInboundMsg || ''), /\[CUSTOMER REQUEST FROM INQUIRY\][^\n]*Traffic Source/i.test(k.history || ''), k.err || ''], [false, false, false, '']);
    const a = await scrape([OURS, APR]);
    check('control: a question the customer typed into the form ("I\'m gonna have to pay APR?") is still an open question of theirs',
      ((a.relationshipSignals || {}).unansweredQuestions || []).some(q => /pay APR\?/.test(q.question)), true);

    let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
    const run = (e) => vm.runInContext(e, sb);
    const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
    const viaPanel = (lsd) => quiet(() => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(lsd);
      return sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: run('leadContext') })); });

    console.log(' 2. a question ages out once the thread has moved on:');
    const p = sure(() => viaPanel(LEAD()));
    check('45 days and 6 of our messages after it: background, not "may not have been answered", not "the highest-leverage move"',
      [/An early question of theirs, now background: "Traffic Source: KBB \?" \([^)]*6 of our messages since\)\. The conversation has moved on since; it is not what this message answers/.test(p),
        /may not have been answered: "Traffic Source/.test(p), /addressing them is the highest-leverage move/.test(p)], [true, false, false]);
    const pLive = sure(() => viaPanel(LEAD({ q: 'Can you itemize the fees?', qAt: NOW - 2 * D, sends: 1 })));
    check('control: a question two days old with one of our messages since is still open', [/may not have been answered: "Can you itemize the fees\?"/.test(pLive), /now background/.test(pLive)], [true, false]);
    const pMonth = sure(() => viaPanel(LEAD({ q: 'Can you itemize the fees?', qAt: NOW - 35 * D, sends: 2 })));
    check('control: a month-old question with only two of ours since is still open (we may never have answered it)', /may not have been answered: "Can you itemize the fees\?"/.test(pMonth), true);

    console.log(' 3. the text rewrite follows the draft that saw the whole thread:');
    const rp = (lead, em) => String(quiet(() => sb._lpBuildSmsRefinePrompt(PASS1, em || EMAIL, lead)));
    check('neither the email nor the first draft took it up: the rewrite is not handed it', /QUESTIONS OF THEIRS THAT ARE STILL OPEN/.test(rp(LEAD({ q: 'Can you itemize the fees?', qAt: NOW - 2 * D, sends: 1 }))), false);
    check('control: the email took it up: the rewrite carries it', /QUESTIONS OF THEIRS THAT ARE STILL OPEN ━━━\n  - "Can you itemize the fees\?"/.test(
      rp(LEAD({ q: 'Can you itemize the fees?', qAt: NOW - 2 * D, sends: 1 }), 'Subject: Fees\n\nTest,\n\nHere are the fees, itemized as you asked.\n\nAgent Name')), true);
    const refine = async (reply, lead) => { const logs = []; sb.__reply = reply; sb.__d = lead;
      run('window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Test Honda" };'
        + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpActiveProhibitions = [];'
        + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
        + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
        + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };');
      const ol = sb.console.log; sb.console.log = (...x) => logs.push(x.join(' '));
      let out; try { out = await run('_lpRefineSms(' + JSON.stringify(PASS1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)'); } catch (e) { out = 'THREW ' + e.message; }
      sb.console.log = ol; return [out === null ? null : 'shipped', logs.some(l => /kept the first pass — the rewrite took up a question neither the email nor the first draft did \("Traffic Source: KBB \?"\)/.test(l))]; };
    check('log354: the rewrite answered "Traffic Source: KBB ?" -> the first pass ships, logged', await refine(KBB_REWRITE, LEAD()), [null, true]);
    check('control: a rewrite that stays on the first draft\'s question ships', await refine(GOOD_REWRITE, LEAD()), ['shipped', false]);
  }
  await br.close();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
