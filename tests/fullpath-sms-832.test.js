#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('fullpath-sms-832.test.js');
// (v9.7.832) FULLPATH'S TEXT CONVERSATIONS. "CONVERTED ON: SMS" is not a page on our website: the lead is the customer's reply to a
// text our marketing system sent them, and the note carries the exchange ("Conversation: role: delivery content: ... role: user
// content: ... role: bot content: ..."). Two on 10/27, both read on v9.7.831 as "on our website they opened the SMS page":
//   Toyota Baytown lead 2106255852 -- "We've just listed the 2026 Toyota Camry XSE for $42,082" -> "Can I trade in my 2024 Camry
//   XSE?"; the prompt said no vehicle was on file, the inquiry was the note's trailer ("Conversation may have continued after this
//   message"), and the bot's "What condition is your Camry in?" was filed as the customer's open question.
//   Kia Baytown lead 2106267729 -- "a special financing deal on the new 2026 Kia K5 for you - 1.9% APR 48 mos" -> "what cha got ?",
//   after which the conversation went on (a call, a link, "i'm good"): the text is background there, not the pitch.
// Part 1 executes _lpFullpath, populateFromData, buildUserPrompt and _lpBuildSmsRefinePrompt; part 2 runs the SHIPPED inlineScraper
// in Chromium. Placeholder data only.
//
// Usage: node tests/fullpath-sms-832.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: fullpath-sms-832.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
// The notes as the scraper flattens them (whitespace collapsed), from the two leads' shapes.
const CAMRY_NOTE = 'By: System CONVERTED ON: SMS Lead Details: Click here to view complete lead information ( dashboard.fullpath.com%2fshopp... ) Conversation: role: delivery content: Hi, it\'s Ella from Community Toyota. We\'ve just listed the 2026 Toyota Camry XSE for $42,082. Take a look: alst.me%2fs%2fTESTLINK01 Reply STOP to opt out. role: user content: Can I trade in my 2024 Camry XSE? role: bot content: Absolutely! We’d love to see your 2024 Camry XSE. You can start your trade-in estimate here: alst.me%2fs%2fTESTLINK02 What condition is your Camry in? note: Conversation may have continued after this message. For full conversation click dashboard.fullpath.com%2fshopp... Show Less';
const K5_NOTE = 'By: System CONVERTED ON: SMS Lead Details: Click here to view complete lead information ( dashboard.fullpath.com%2fshopp... ) Conversation: role: delivery content: Test, Ella from Community Kia here. I got a special financing deal on the new 2026 Kia K5 for you - 1.9% APR 48 mos.. Text back if interested. Reply STOP to opt out of texts. role: user content: what cha got ? role: bot content: Kia deals on new models, including the 2026 K5. See lease and finance offers: alst.me%2fs%2fTESTLINK03 Want details by text? note: Conversation may have continued after this message. For full conversation click dashboard.fullpath.com%2fshopp... Show More';
const WEB_NOTE = 'By: System Preferred Contact Method: Any CONVERTED ON: Nurture Landing Page 2026 Kia Sorento Hybrid Lease for $409/mo for 24 months, $3,999 due at signing Lead Details: Click here to view complete lead information ( dashboard.fullpath.com%2fshopp... ) Show Less';
const E = (time, tag, title, body) => '[10/27/2026 ' + time + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = '[10/27/2026 12:55 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const ASKED = E('1:01 PM', 'AGENT', 'Outbound Text Message', 'Test, what are you shopping for? I can help narrow down the options. Agent');
const LIVE = E('1:45 PM', 'CUSTOMER', 'Inbound Text Message', 'ohh this car looks like my car right now. i’m good') + E('1:32 PM', 'AGENT', 'Outbound Text Message', 'Here are the new K5s we have.');
const LEAD = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '', condition: 'New',
  stockNum: '', vin: '', dealerId: '6189', store: 'Community Toyota Baytown', leadSource: 'FullPath', convState: 'follow-up', leadAgeDays: 0, hasOutbound: true,
  hasCustomerReply: false, totalNoteCount: 6, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '', relationshipSignals: { unansweredQuestions: [] },
  pdPresent: true, pdHasLeadVehicle: false, pdVoiCount: 0, tradeDescription: '2024 Toyota Camry XSE\n\t43,000 miles',
  fullpathConversion: CAMRY_NOTE, serviceVehicle: '2024 TOYOTA CAMRY', history: ASKED + MARK, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + ASKED + MARK + '---' }, x || {});
const K5_LEAD = (x) => LEAD(Object.assign({ dealerId: '6190', store: 'Community Kia Baytown', fullpathConversion: K5_NOTE, serviceVehicle: '', tradeDescription: '',
  history: LIVE + ASKED + MARK, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + LIVE + ASKED + MARK + '---' }, x || {}));
const EMAIL = 'Hi Test,\n\nYes, you can trade in your 2024 Camry XSE toward the 2026 Camry XSE.\n\nAgent Name\nCommunity Toyota Baytown\n(555) 010-0100';

let id = 520000000;
const note = (dir, when, title, html) => { id++; return '<span id="notes-and-history-item-' + id + '" data-tags="x" data-direction="' + dir
  + '" data-unique-identifier-type="AutoLeadMessageID" data-unique-identifier-value="' + id + '" class="notes-and-history-item list-group-item">'
  + '<div class="notes-and-hsitory-item-date">' + when + '</div><div class="notes-and-hsitory-item-detail"><div class="notes-and-history-item-header">'
  + '<div class="legacy-notes-and-history-title">' + title + '</div></div><div class="notes-and-history-item-content">' + html + '</div></div></span>'; };
const PAGE = (notes) => '<html><body><div>Lead Info<br>Status:\tActive<br>Created:\t10/27/26 12:55p (0d)<br>Source:\tFullPath</div><div id="notes">' + notes.join('') + '</div></body></html>';
// The received note as VinSolutions renders it: <br> between lines, links as anchors, a Show More link after the body.
const RECEIVED = (turnsHtml) => note('Inbound', '10/27/2026 12:55 PM', 'Lead received', '<div>By: System</div><div><div class="adf_email_truncated">CONVERTED ON: SMS<br><br>Lead Details: Click here to view complete lead information ( <a href="#">dashboard.fullpath.com%2fshopp...</a> )<br><br>Conversation:<br>'
  + turnsHtml + '<br><br>note: Conversation may have continued after this message. For full conversation click <a href="#">dashboard.fullpath.com%2fshopp...</a></div><a href="#expand">Show More</a></div>');
const CAMRY_TURNS = 'role: delivery<br>content: Hi, it\'s Ella from Community Toyota. We\'ve just listed the 2026 Toyota Camry XSE for $42,082. Take a look: <a href="#">alst.me%2fs%2fTESTLINK01</a><br>Reply STOP to opt out.<br>role: user<br>content: Can I trade in my 2024 Camry XSE?<br>role: bot<br>content: Absolutely! We’d love to see your 2024 Camry XSE. You can start your trade-in estimate here: <a href="#">alst.me%2fs%2fTESTLINK02</a> What condition is your Camry in?';
const OUT = (when, body) => note('Outbound', when, 'Outbound Text Message', 'Sent to: (555) 010-0199<br>Sent by: Agent Name<br>' + body);

(async () => {
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }).catch(() => chromium.launch());
  for (const f of BUILDS) {
    console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
    let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
    const run = (e) => vm.runInContext(e, sb);
    for (const dl of ['6189', '6190']) run('_lpValueFactCache')[dl] = { inv: { units: [] }, vf: { incentives: [{ model: 'Camry', line: 'Camry -- $1,000 Customer Cash' }] }, fetchedAt: Date.now() - 5000, ttlMs: 600000 };
    const built = (d) => { const logs = []; const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...a) => logs.push(a.join(' ')); sb.console.warn = () => {};
      try { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(d); const ctx = run('leadContext');
        return { p: sb.__lp.buildUserPrompt(Object.assign({}, d, { context: ctx })), logs }; } finally { sb.console.log = ol; sb.console.warn = ow; } };
    const fp = (d) => { try { return run('_lpFullpath')(d); } catch (e) { return 'THREW ' + e.message; } };

    console.log(' 1. the conversation, read:');
    check('lead 2106255852: a text about the 2026 Toyota Camry XSE at $42,082, their reply, the bot\'s answer, the sender; nobody has written since', () => {
      const r = fp(LEAD()); return r && [r.via, r.kind, r.vehicle, r.price, r.key, r.replies, /What condition is your Camry in\?$/.test(r.botReply || ''), r.sender, r.live, r.trade]; },
      ['text', 'unit', '2026 Toyota Camry XSE', '$42,082', '$42,082', ['Can I trade in my 2024 Camry XSE?'], true, 'Ella', false, true]);
    check('lead 2106267729: a financing offer (1.9% APR 48 mos) on the 2026 Kia K5, "what cha got?", and the conversation has gone on since', () => {
      const r = fp(K5_LEAD()); return r && [r.via, r.kind, r.offer, r.key, r.vehicle, r.replies, r.sender, r.live]; },
      ['text', 'offer', '1.9% APR 48 mos', '1.9%', '2026 Kia K5', ['what cha got?'], 'Ella', true]);
    check('control: a website conversion (no conversation) reads as before -- no "via text"', () => { const r = fp(LEAD({ fullpathConversion: WEB_NOTE })); return r && [r.via, r.kind, r.key]; }, [undefined, 'offer', '$409']);
    check('the scraper\'s copy of the turn reader is byte-identical to the popup\'s', () => {
      const top = (src.match(/^function _lpFpTurns\(s\) \{[\s\S]*?\n\}/m) || [''])[0];
      const inner = (src.match(/^    function _lpFpTurns\(s\) \{[\s\S]*?\n    \}/m) || [''])[0].split('\n').map(l => l.replace(/^    /, '')).join('\n');
      return [top.length > 200, top === inner]; }, [true, true]);

    console.log(' 2. the prompt (nobody has answered their reply yet):');
    const a = built(LEAD());
    check('HOW THIS LEAD REACHED US: they replied to our text about the Camry; never "the SMS page" or the website; never the assistant\'s name', () =>
      [/^- HOW THIS LEAD REACHED US: they REPLIED TO A TEXT WE SENT THEM about the 2026 Toyota Camry XSE at \$42,082 -- this lead is their reply/m.test(a.p), /or "Ella" \(the automated text's signature/.test(a.p),
       /SMS page/i.test(a.p), /on our website they opened/.test(a.p)], [true, true, false, false]);
    check('WHAT THEY RESPONDED TO: our text, the car named with its listed price, their question to answer first, the bot as not a person', () =>
      [/WHAT THEY RESPONDED TO -- THEY REPLIED TO A TEXT WE SENT, AND THEIR REPLY IS THE REASON FOR THIS MESSAGE:/.test(a.p),
       /^- The car in it: the 2026 Toyota Camry XSE, listed at \$42,082\. That is the car they responded to: name it\./m.test(a.p),
       /^- Their reply: "Can I trade in my 2024 Camry XSE\?" -- their own words, and nobody on our team has answered them yet\. Answer it first/m.test(a.p),
       /^- An automated reply went back before anyone on our team wrote: "Absolutely!/m.test(a.p)], [true, true, true, true]);
    check('the car in our text is the subject: no "NO VEHICLE IS ATTACHED", no "CRM CONFIRMS: no vehicle", no "do not ask/invent" fallback', () =>
      [/^Vehicle:\s+\(none on file\) ← the car they responded to is the 2026 Toyota Camry XSE, in our text to them/m.test(a.p), /NO VEHICLE IS ATTACHED/.test(a.p), /CRM CONFIRMS: no vehicle of interest/.test(a.p),
       /^- NEVER mention a specific vehicle model[^\n]*they responded to our text about the 2026 Toyota Camry XSE: that is the car this conversation is about/m.test(a.p)], [true, false, false, true]);
    check('their inquiry is their question, not the note\'s trailer; they asked about trading, so no "are you thinking about trading in" fishing', () =>
      [/Conversation may have continued/.test(a.p), /THEY OWN A/.test(a.p), a.logs.some(l => /\[LP FULLPATH DIAG\] via text \(their reply is the latest\) unit: /.test(l))], [false, false, true]);

    console.log(' 3. the prompt (they have written to us since):');
    const k = built(K5_LEAD());
    check('lead 2106267729: the text is how it started (background); the 1.9% APR offer stays usable but is not the subject', () =>
      [/HOW THIS CONVERSATION STARTED -- THEY REPLIED TO A TEXT WE SENT \(BACKGROUND/.test(k.p),
       /^- The offer in it: "1\.9% APR 48 mos" on the 2026 Kia K5\. It is still an angle you may use if it fits where the conversation is now/m.test(k.p),
       /^- Their reply: "what cha got\?" -- what they have said since, in the thread, comes after this\./m.test(k.p), /OTHER OFFERS WAIT/.test(k.p), /SMS page/i.test(k.p)],
      [true, true, true, false, false]);
    const k0 = built(K5_LEAD({ history: ASKED + MARK, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + ASKED + MARK + '---' }));
    check('control: before they write again, the same offer leads, on approved credit, and other offers wait', () =>
      [/^- The offer in it: "1\.9% APR 48 mos" on the 2026 Kia K5\. Lead with it\. Quote it as advertised, prefaced with "on approved credit"/m.test(k0.p), /OTHER OFFERS WAIT/.test(k0.p)], [true, true]);
    const w = built(LEAD({ fullpathConversion: WEB_NOTE, dealerId: '6190', store: 'Community Kia Baytown', vehicle: '2026 Kia Sorento Hybrid EX', serviceVehicle: '' }));
    check('control: a website conversion keeps the v9.7.803 wording', () =>
      [/^- HOW THIS LEAD REACHED US: they acted on our own marketing -- on our website they opened our 2026 Kia Sorento Hybrid Lease/m.test(w.p), /REPLIED TO A TEXT/.test(w.p)], [true, false]);

    console.log(' 4. the text rewrite:');
    const RP = (x) => { const ol = sb.console.log; sb.console.log = () => {}; try { return run('_lpBuildSmsRefinePrompt')('Test, pass one.', EMAIL, x); } finally { sb.console.log = ol; } };
    check('the rewrite is told they replied to our text, never the website, never the assistant\'s name', () => {
      const r = RP(LEAD()), r2 = RP(K5_LEAD());
      return [/━━━ WHAT THEY RESPONDED TO ━━━\nThey replied to our text about the 2026 Toyota Camry XSE at \$42,082\. Keep it in the text the way the first draft has it/.test(r), /never sign or refer to "Ella"/.test(r),
        /on our website/.test(String(r.split('WHAT THEY RESPONDED TO')[1] || '').replace(/say they were on our website/g, '')), /They replied to our text about our offer, "1\.9% APR 48 mos" on the 2026 Kia K5\. The conversation has moved on since/.test(r2)]; },
      [true, true, false, true]);

    console.log(' 5. the shipped scraper:');
    const sa = src.indexOf('  function inlineScraper() {'), sbx = src.indexOf('  } // end inlineScraper', sa);
    const scraper = src.slice(sa, sbx + 3);
    const scrape = async (notes) => {
      const ctx = await br.newContext({ timezoneId: 'America/Chicago' }); const page = await ctx.newPage();
      await page.route('**/*', r => /\/CarDashboard\/lead$/.test(r.request().url())
        ? r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE(notes) }) : r.abort());
      await page.clock.install({ time: new Date('2026-10-27T14:00:00-05:00').getTime() });
      await page.goto('https://crm.example.test/CarDashboard/lead', { waitUntil: 'domcontentloaded' });
      let res; try { res = await page.evaluate('(async()=>{' + scraper + '\n; return await inlineScraper();})()'); } catch (e) { res = { err: e.message }; }
      await ctx.close(); return res || {};
    };
    const s1 = await scrape([OUT('10/27/2026 1:01 PM', 'Test, what are you shopping for? Agent'), RECEIVED(CAMRY_TURNS)]);
    check('the customer\'s inquiry is "Can I trade in my 2024 Camry XSE?", not "Conversation may have continued after this message"', () =>
      [/\[CUSTOMER REQUEST FROM INQUIRY\] Can I trade in my 2024 Camry XSE\?/.test(String(s1.history || '') + String(s1.conversationBrief || '')),
       /Conversation may have continued after this message\. For full conversation click"?\s*$/m.test(String(s1.conversationBrief || '')), s1.err || ''], [true, false, '']);
    check('open questions: theirs only, without the "content:" label; the bot\'s "What condition is your Camry in?" is not theirs', () =>
      ((s1.relationshipSignals || {}).unansweredQuestions || []).map(q => q.question), ['Can I trade in my 2024 Camry XSE?']);
    const longTurns = CAMRY_TURNS + ('<br>role: user<br>content: Also what colors do you have on the XSE, and is the panoramic roof standard on it?<br>role: bot<br>content: Great question! The XSE comes in several colors and the roof depends on the package.').repeat(6);
    const s2 = await scrape([RECEIVED(longTurns)]);
    check('a longer conversation is kept past 900 characters (the note is not cut mid-exchange)', () => { const n = String(s2.fullpathConversion || ''); return [n.length > 1500, /Conversation may have continued/.test(n)]; }, [true, true]);
  }
  await br.close();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
