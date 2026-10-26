#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('call-note-schedule-828.test.js');
// (v9.7.828) A NOTE ABOUT THE CUSTOMER IS READ LIKE THEIR OWN MESSAGE. Kia Baytown lead 2105429946 (log367, v9.7.827): the
// salesperson reached the customer at 10:06 -- "Outbound phone call (Contacted)": "not a good time- hes at work// call him after
// 3pm" -- and the draft offered "9:15 AM or 10:30 AM Tuesday". The model had the note (twice); the schedule reader did not -- it
// read the customer's own messages only -- so the suggested-times block offered morning slots as if nothing said otherwise. Gil:
// "The model should ingest every note not just pieces." Now: a connected call note, and a general note about them, feed the same
// schedule reader as their messages; "after N" is a start time; the fallback slots yield to anything in a message OR a note.
// Also: a bare "2026 Honda" on the lead made the variant-mismatch check build a pattern with no model, and it threw.
// Runs the SHIPPED inlineScraper in Chromium, and executes buildUserPrompt through the panel payload. Placeholder data only.
//
// Usage: node tests/call-note-schedule-828.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: call-note-schedule-828.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const sure = (fn) => { try { return fn(); } catch (e) { return 'THREW: ' + e.message; } };
const note = (id, tags, dir, when, title, html) => '<span id="notes-and-history-item-' + id + '" data-tags="' + tags + '" data-direction="' + dir
  + '" data-unique-identifier-type="AutoLeadMessageID" data-unique-identifier-value="' + id + '" class="notes-and-history-item list-group-item">'
  + '<div class="notes-and-hsitory-item-date">' + when + '</div><div class="notes-and-hsitory-item-detail"><div class="notes-and-history-item-header">'
  + '<div class="legacy-notes-and-history-title">' + title + '</div></div><div class="notes-and-history-item-content">' + html + '</div></div></span>';
const PAGE = (notes) => '<html><body><div>Lead Info<br>Status:\tActive<br>Created:\t10/25/26 11:14p (1d)<br>Source:\tGubagoo - Virtual Retailing</div><div id="notes">' + notes.join('') + '</div></body></html>';
const INTRO = note('400000001', 'Communication-Texts', 'Outbound', '10/26/2026 10:06 AM', 'Outbound Text Message', 'Sent to: (555) 010-0199<br>Sent by: Rep Name<br>Hi Test, this is Rep over at Test Kia. Best way to get you answers - text, call, or email?');
const CALL = (title, body) => note('400000002', 'Phone-Communication', 'Outbound', '10/26/2026 10:06 AM', title, '<div>By: Rep Name</div>' + body);
const OURS = note('400000003', 'Communication-Texts', 'Outbound', '10/26/2026 9:16 AM', 'Outbound Text Message', 'Sent to: (555) 010-0199<br>Sent by: Agent Name<br>Test, I have been trying to reach you about the Click &amp; Go deal. Would you like to get the appraisal started?');
const LEADREC = note('400000004', 'Email-Communication', 'Inbound', '10/25/2026 11:14 PM', 'Lead received', '<div>By: System</div>Lead Type: Gubagoo Dynamic Credit App');
const TXT_IN = (body) => note('400000005', 'Communication-Texts', 'Inbound', '10/26/2026 10:30 AM', 'Inbound Text Message', 'Received from: (555) 010-0199<br>Received by: Rep Name<br>' + body);
const GEN = (body) => note('400000006', 'General-Note', '', '10/26/2026 10:10 AM', 'General Note', '<div>By: Rep Name</div>' + body);

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
      await page.clock.install({ time: new Date('2026-10-26T18:08:00-05:00').getTime() });
      await page.goto('https://crm.example.test/CarDashboard/lead', { waitUntil: 'domcontentloaded' });
      let res; try { res = await page.evaluate('(async()=>{' + scraper + '\n; return await inlineScraper();})()'); } catch (e) { res = { err: e.message }; }
      await ctx.close(); return res || {};
    };
    const sc = (notes) => scrape(notes).then(r => String(r.customerScheduleConstraint || r.err || ''));

    console.log(' 1. the schedule reader reads the notes about the customer, not only their messages:');
    const c1 = await sc([INTRO, CALL('Outbound phone call (Contacted)', 'not a good time- hes at work// call him after 3pm'), OURS, LEADREC]);
    check('lead 2105429946: connected call "hes at work// call him after 3pm" -> free after 3 PM, offer times after it',
      /^CUSTOMER ARRIVAL TIME: per a call note about them \("[^"]*call him after 3pm"\), they are free after 3 PM -- treat it as arriving around 3\. Offer appointment times AFTER this time - not before\.$/.test(c1) ? 'after 3 PM' : c1, 'after 3 PM');
    check('a general note about them ("she gets off at 5:30") counts the same way',
      /CUSTOMER ARRIVAL TIME: Customer said they arrive\/get off around 5:30/.test(await sc([INTRO, GEN('spoke w/ cust, she gets off at 5:30 most days'), OURS, LEADREC])), true);
    check('the customer\'s own "I\'m free after 5" counts too ("after N" is new)', /^CUSTOMER ARRIVAL TIME: per the customer, they are free after 5 PM/.test(await sc([TXT_IN('I\'m free after 5'), INTRO, OURS, LEADREC])), true);
    check('controls: an unanswered call (Machine), a note that is not about them, "after 2 weeks" -> no constraint',
      [await sc([INTRO, CALL('Outbound phone call (Machine)', 'Left message, call him after 3pm'), OURS, LEADREC]),
        await sc([INTRO, GEN('SENT MESSAGE IN WHATSAPP TO MANAGERS. Will follow up after 3pm'), OURS, LEADREC]),
        await sc([TXT_IN('I will be ready to buy after 2 weeks'), INTRO, OURS, LEADREC])], ['', '', '']);

    let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
    const run = (e) => vm.runInContext(e, sb);
    const logs = [];
    const viaPanel = (lsd) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...a) => logs.push(a.join(' ')); sb.console.warn = () => {};
      try { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(lsd); return String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: run('leadContext') }))); }
      catch (e) { return 'THREW ' + e.message; } finally { sb.console.log = ol; sb.console.warn = ow; } };
    const LEAD = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2027 Kia K5 GT-Line', condition: 'New',
      dealerId: '6190', store: 'Test Kia', leadSource: 'Gubagoo - Virtual Retailing', convState: 'call-followup', leadAgeDays: 1, hasOutbound: true, totalNoteCount: 12,
      phone: '(555) 010-0199', email: 'test@example.com', customerZip: '00000', relationshipSignals: { unansweredQuestions: [] }, history: '', conversationBrief: '' }, x || {});

    console.log(' 2. the prompt: the times follow the note; the fallback yields to notes too:');
    const p = viaPanel(LEAD({ customerScheduleConstraint: c1 }));
    const adj = /APPOINTMENT TIMES — ADJUSTED FOR CUSTOMER ARRIVAL TIME \(use exactly\):\nFirst option: (\d{1,2}):(\d{2}) (AM|PM)[^\n]*\nSecond option: (\d{1,2}):(\d{2}) (AM|PM)/.exec(p);
    const h24 = (h, m) => (m === 'PM' && +h < 12 ? +h + 12 : +h);
    check('the suggested times are after 3 PM (no 9:15 or 10:30 AM)', adj ? [h24(adj[1], adj[3]) >= 15, h24(adj[4], adj[6]) >= 15] : 'no adjusted block', [true, true]);
    check('the fallback rule names our notes about them, not only their messages',
      /in their own messages OR in any of our notes about them \(a call note such as "at work, call him after 3pm", an appointment or general note\) -- WORK WITHIN WHAT THEY SAID/.test(viaPanel(LEAD())), true);

    console.log(' 3. a bare "2026 Honda" on the lead:');
    logs.length = 0; viaPanel(LEAD({ vehicle: '2026 Honda', dealerId: '24399', store: 'Test Honda', leadSource: 'Identitymax' }));
    check('the variant-mismatch check no longer throws', logs.some(l => /\[LP VARIANT-MISMATCH DIAG\] block threw/.test(l)), false);
  }
  await br.close();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
