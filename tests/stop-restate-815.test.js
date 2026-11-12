#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('stop-restate-815.test.js');
// (v9.7.815) KIA BAYTOWN LEAD 2103538959 (log348): A STOP WAS READ AS A CONVERSATION, AND THE NEXT DRAFT RE-SENT THE FIRST REACH. Our
// 10/20 text, email and voicemail said the Summit White 2024 GMC Sierra 1500 AT4 was here, 9:15 or 10:30 Wednesday; the customer
// texted "Stop" two minutes later; the texting system confirmed. The 10/21 draft: the same truck, "you viewed for $58,067", 9:15
// or 10:30 Thursday. (1) The STOP counted as a reply, so the ANTI-RESTATE block never fired and the prompt said "THE CUSTOMER HAS
// REPLIED"; and the block's anchor was the system's opt-out confirmation. (2) The Fullpath car counted as "not put to them"
// because our messages named it without the price. (3) The text rewrite added a price the first draft did not have.
// Runs the shipped inlineScraper in Chromium on a placeholder lead page; builds prompts through the shipped populateFromData and
// panel payload; executes the shipped _lpBuildSmsRefinePrompt. Placeholder data only.
//
// Usage: node tests/stop-restate-815.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: stop-restate-815.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = typeof fn === 'function' ? fn() : fn; } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const H = 3600000, NOW = Date.now();
const fmt = (ms) => { const f = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  .formatToParts(new Date(ms)).reduce((o, p) => (o[p.type] = p.value, o), {}); return f.month + '/' + f.day + '/' + f.year + ' ' + f.hour + ':' + f.minute + ' ' + f.dayPeriod.toUpperCase(); };
const PITCH = 'Test, the Summit White 2024 GMC Sierra 1500 AT4 is here and ready for you to see. Would 9:15 AM or 10:30 AM Wednesday work better? Agent';
const CONFIRM = 'You have successfully been removed from Test Auto Group text messages.';
const E = (ms, tag, title, body) => '[' + fmt(ms) + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (ms) => '[' + fmt(ms) + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const T0 = NOW - 20 * H;
const HIST = (stop) => E(T0 + 3 * 60000, 'AGENT', 'Outbound Text Message', CONFIRM) + E(T0 + 2 * 60000, 'CUSTOMER', 'Inbound Text Message', stop)
  + E(T0, 'AGENT', 'Outbound Text Message', PITCH) + MARK(T0 - 60000);
const FPNOTE = 'By: System CONVERTED ON: Nurture Landing Page 2024 GMC Sierra 1500 (VIN 1GTUUEEL0TEST0001) $58,067 Lead Details: Click here Show Less';
const LEAD = (x) => { const stop = (x && x.stop) || 'Stop'; return Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name',
  vehicle: '2024 GMC Sierra 1500 AT4', condition: 'Pre-Owned', stockNum: 'P0001', dealerId: '6190', store: 'Test Kia', leadSource: 'FullPath', fullpathConversion: FPNOTE,
  convState: 'active-follow-up', leadAgeDays: 1, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 12, phone: '(555) 010-0199', email: 'test@example.com',
  relationshipSignals: { unansweredQuestions: [] }, lastInboundMsg: stop, lastSubstantiveOutboundMsg: CONFIRM, history: HIST(stop),
  conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + HIST(stop) + '---',
  outboundSends: [{ title: 'outbound text message', ms: T0 + 3 * 60000, body: CONFIRM }, { title: 'outbound text message', ms: T0, body: PITCH }] }, x || {}); };
const note = (id, dir, ms, title, html) => '<span id="notes-and-history-item-' + id + '" data-tags="" data-direction="' + dir + '" data-unique-identifier-type="AutoLeadMessageID" data-unique-identifier-value="' + id
  + '" class="notes-and-history-item list-group-item"><div class="notes-and-hsitory-item-date">' + fmt(ms) + '</div><div class="notes-and-hsitory-item-detail"><div class="notes-and-history-item-header">'
  + '<div class="legacy-notes-and-history-title">' + title + '</div></div><div class="notes-and-history-item-content">' + html + '</div></div></span>';

(async () => {
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }).catch(() => chromium.launch());
  for (const f of BUILDS) {
    console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
    const src = fs.readFileSync(f, 'utf8');
    let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
    const run = (e) => vm.runInContext(e, sb);
    const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
    for (const id of ['6189', '6190', '6191', '24399']) run('_lpValueFactCache')[id] = { inv: { units: [] }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true };
    const viaPanel = (lsd) => quiet(() => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(lsd);
      return sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: run('leadContext') })); });
    const anchor = (p) => { const i = p.indexOf('YOUR LAST SUBSTANTIVE MESSAGE'); return i < 0 ? '' : p.slice(i, i + 400); };

    console.log(' 1. a STOP is not a reply:');
    const p = viaPanel(LEAD());
    check('lead 2103538959: not "THE CUSTOMER HAS REPLIED"; the don\'t-restate block fires, anchored on our first reach -- not on the opt-out confirmation',
      () => [/EARLY FOLLOW-UP — THE CUSTOMER HAS REPLIED/.test(p), /Sierra 1500 AT4 is here and ready for you to see/.test(anchor(p)), /successfully been removed/.test(anchor(p))], [false, true, false]);
    check('control: a real message from them is still a reply', () => /EARLY FOLLOW-UP — THE CUSTOMER HAS REPLIED/.test(viaPanel(LEAD({ stop: 'Is it still there? What is your best price?' }))), true);

    console.log(' 2. the truck our messages already named:');
    check('the Fullpath car is background, not "Lead with that car ... you may name that advertised price"', () => [/OUR EARLIER MESSAGES ALREADY ANSWERED IT/.test(p), /Lead with that car/.test(p)], [true, false]);
    check('control: before anything named it, it is still the reason for the message', () => /AND IT IS THE REASON FOR THIS MESSAGE/.test(viaPanel(LEAD({ convState: 'first-touch', hasOutbound: false,
      hasCustomerReply: false, lastInboundMsg: '', lastSubstantiveOutboundMsg: '', outboundSends: [], history: MARK(T0), conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + MARK(T0) + '---' }))), true);
    check('the text rewrite does not add a price the first draft left out', () => /if the first draft does not name the price, do not add it/.test(String(quiet(() => sb._lpBuildSmsRefinePrompt(
      'Test, the 2024 GMC Sierra 1500 AT4 is here. Would 9:15 or 10:30 Thursday work?', 'Subject: Sierra\n\nTest,\n\nThe 2024 GMC Sierra 1500 AT4 is here.\n\nAgent Name',
      LEAD({ convState: 'first-touch', history: MARK(T0), outboundSends: [] }))))), true);

    console.log(' 3. the scrape: the opt-out confirmation is not our last message:');
    const page = await br.newPage(), url = 'https://crm.example.test/CarDashboard/Pages/rims2.aspx';
    const html = '<html><body><div id="notes">' + note('3', 'outbound', T0 + 3 * 60000, 'Outbound Text Message', 'Sent to: (555) 010-0199<br>Sent by: System<br>' + CONFIRM)
      + note('2', 'inbound', T0 + 2 * 60000, 'Inbound Text Message', 'Received from: (555) 010-0199<br>Stop') + note('1', 'outbound', T0, 'Outbound Text Message', 'Sent to: (555) 010-0199<br>Sent by: Agent Name<br>' + PITCH) + '</div></body></html>';
    await page.route('**/*', r => r.request().url() === url ? r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }) : r.abort());
    await page.goto(url, { waitUntil: 'load' });
    const sa = src.indexOf('  function inlineScraper() {'), sx = src.indexOf('  } // end inlineScraper', sa);
    let res; try { res = await page.evaluate('(async()=>{' + src.slice(sa, sx + 3) + '\n; return await inlineScraper();})()'); } catch (e) { res = { err: e.message }; }
    await page.close();
    check('lastSubstantiveOutboundMsg is our pitch, not "You have successfully been removed..."', () => [res.err || null, /Sierra 1500 AT4 is here/.test(res.lastSubstantiveOutboundMsg || ''), /successfully been removed/.test(res.lastSubstantiveOutboundMsg || '')], [null, true, false]);
  }
  await br.close();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
