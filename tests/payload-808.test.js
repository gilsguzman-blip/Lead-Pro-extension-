#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('payload-808.test.js');
// (v9.7.808) WHAT THE PANEL HANDS THE PROMPT, A NEW LEAD THAT HAS BEEN WORKED, AND THE PANEL IN THE SHADOW ROOT.
//  - buildUserPrompt is handed _lpPromptInputData, not the scrape, and it never carried fullpathConversion, serviceVehicle,
//    color or autoLeadId: the v9.7.803 Fullpath block never reached a live main prompt (Toyota Baytown 2103569612 and
//    2103463134, 10/21: "you came through your online inquiry" with the conversion note in hand), 806's paint-by-name could not
//    fire, and the shipping pair never varied. Every test before this one handed buildUserPrompt the scrape.
//  - 2103569612: six touches by noon, and the 12:27 draft re-sent the 10:30 email -- the default branch said "TASK: Standard
//    first-touch response" and "Write this message exactly as you would if this were the very first and only message".
//  - The Key Information rows are in the shadow root of DIV.portal-shadow-container (Gil's console: document 0, shadowRoot 17).
// Lifts the shipped _lpPromptInputData literal (tests/helpers/panel-payload.js) and builds the prompt from it; runs the shipped
// _lpKiWait and inlineScraper in Chromium against a placeholder dashboard whose panel is drawn into a shadow root after load.
// Placeholder data only.
//
// Usage: node tests/payload-808.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: payload-808.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = typeof fn === 'function' ? fn() : fn; } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

// Fields a helper may read without the payload carrying them: history falls back to context in every helper that reads it;
// indexOf/slice are string methods the scan mistakes for fields. (v9.7.809) The five other gaps this build found are carried
// now; isDistanceBuyer and agentPhone stay off because nothing ever sets them. Any NEW gap fails.
const KNOWN = ['history', 'indexOf', 'slice', 'agentPhone', 'isDistanceBuyer'];
const coverage = (src) => panelPayload.coverage(src, KNOWN);

const E = (when, tag, title, body) => '[' + when + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = '[10/20/2026 8:24 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const FPNOTE = 'By: System CONVERTED ON: Nurture Landing Page 2026 Toyota Camry (VIN 4T1DBADK3TEST0001) $33,295 Customer message: Lets talk Lead Details: Click here to view complete lead information ( dashboard.example.test%2fleads... ) Show Less';
const HIST = E('10/21/2026 10:49 AM', 'AGENT', 'Outbound Text Message', 'Hi Test, this is Rep over at Test Toyota - I’ll be the one taking care of you on the vehicle you were interested in. Agent has the details started; I just wanted you to have my direct line.')
  + E('10/21/2026 10:30 AM', 'AGENT', 'Email reply to prospect', 'Test, the 2026 Toyota Camry SE is showing available here in Midnight Black Metallic. Would 12:30 or 1:15 work?')
  + E('10/21/2026 10:30 AM', 'AGENT', 'Outbound Text Message', 'Test, the 2026 Camry SE you looked at for $33,295 is here. Would 12:30 or 1:15 work?')
  + E('10/21/2026 10:29 AM', 'AGENT', 'Outbound phone call (Machine)', 'By: Agent Name Left message') + MARK;
const SENDS = [{ title: 'outbound text message', ms: Date.parse('2026-10-21T15:49:00Z'), body: 'Hi Test, this is Rep over at Test Toyota - I’ll be the one taking care of you on the vehicle you were interested in. Agent has the details started; I just wanted you to have my direct line.' },
  { title: 'email reply to prospect', ms: Date.parse('2026-10-21T15:30:00Z'), body: 'Test, the 2026 Toyota Camry SE is showing available here in Midnight Black Metallic.' },
  { title: 'outbound text message', ms: Date.parse('2026-10-21T15:30:00Z'), body: 'Test, the 2026 Camry SE you looked at for $33,295 is here.' }];
const LSD = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Toyota Camry SE', condition: 'Pre-Owned',
  color: 'Black', stockNum: '', vin: '', dealerId: '6189', store: 'Test Toyota', leadSource: 'FullPath', convState: 'first-touch', leadAgeDays: 0, hasOutbound: true,
  hasCustomerReply: false, totalNoteCount: 32, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: 'Lets talk', customerState: 'TX', customerZip: '00000',
  relationshipSignals: { unansweredQuestions: [], leadOutboundCount: 4, totalOutboundCount: 24 }, outboundSends: SENDS, fullpathConversion: FPNOTE, serviceVehicle: '',
  history: HIST, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + HIST + '---' }, x || {});
const SHADOW = (delayMs) => '<html><body><div id="CustomerDashboardTop">Test Buyer</div><div class="portal-shadow-container" id="host"></div><div class="portal-shadow-container"></div>'
  + '<script>setTimeout(function(){ var r = document.getElementById("host").attachShadow({ mode: "open" });'
  + ' r.innerHTML = \'<div id="keyInfo-CustomerSummary"><div id="keyInfo-CustomerSummary-icon"><span>Fullpath CDP Summary</span></div><div id="keyInfo-CustomerSummary-date">View More</div>'
  + '<div id="keyInfo-CustomerSummary-blurb"><span>[Customer] has never purchased a vehicle or had service visits with the dealership.</span></div></div>'
  + '<div id="keyInfo-Amp"><div id="keyInfo-Amp-icon"><span>AMP</span></div><div id="keyInfo-Amp-date">10/3/2026</div><div id="keyInfo-Amp-blurb">This customer received an AMP marketing event</div></div>\'; }, ' + delayMs + ');</script></body></html>';

(async () => {
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }).catch(() => chromium.launch());
  for (const f of BUILDS) {
    console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
    const src = fs.readFileSync(f, 'utf8');

    console.log(' 1. every field the prompt\'s helpers read is one the panel hands it:');
    check('no helper called from buildUserPrompt reads a field _lpPromptInputData does not carry (history falls back to context)', () => coverage(src), {});

    let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
    const run = (e) => vm.runInContext(e, sb);
    const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
    for (const id of ['6189', '6191', '24399']) run('_lpValueFactCache')[id] = { inv: { units: [] }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true };
    const viaPanel = (lsd) => quiet(() => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(lsd);
      const ctx = run('leadContext'); return sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: ctx })); });

    console.log(' 2. through the panel\'s own payload:');
    const p = viaPanel(LSD());
    check('leads 2103569612 / 2103463134: the Fullpath block reaches the main prompt -- the car they opened at its advertised price, and not "your online inquiry"',
      () => [/WHAT THEY RESPONDED TO -- THEY ACTED ON OUR OWN MARKETING/.test(p), /The car they opened on our website: 2026 Toyota Camry, advertised at \$33,295/.test(p), /came through your online inquiry/.test(p)], [true, true, false]);
    check('...the payload carries the conversion note, the owned vehicle, the color and the lead ID', () => { const pl = quiet(() => panelPayload(src, sb, { lsd: LSD({ serviceVehicle: '2017 TOYOTA CAMRY' }), context: '' }));
      return [!!pl.fullpathConversion, pl.serviceVehicle, pl.color, pl.autoLeadId]; }, [true, '2017 TOYOTA CAMRY', 'Black', 'TEST001A']);

    console.log(' 3. a new lead that has already been worked:');
    check('lead 2103569612: "TASK: Follow-up on a new lead. 4 touches have already gone out" -- no re-introduction, nothing they were already told',
      () => [/TASK: Follow-up on a new lead\. 4 touches have already gone out on this lead[^\n]*do not restate what those messages already said/.test(p), /Standard first-touch response|very first and only message/.test(p)], [true, false]);
    check('...still not a stall: nothing about the absence of a reply', () => /NOT A STALL: the lead is new, so do not write as if they went quiet/.test(p), true);
    check('control: a new lead nobody has worked yet is still a first touch', () => /TASK: Standard first-touch response to a new inquiry/.test(viaPanel(LSD({ relationshipSignals: { unansweredQuestions: [], leadOutboundCount: 0, totalOutboundCount: 0 }, hasOutbound: false, outboundSends: [],
      history: MARK, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + MARK + '---' }))), true);
    check('the salesperson\'s intro: the message is written as one team with the salesperson, no re-introduction', () => /THEIR SALESPERSON HAS INTRODUCED THEMSELVES: Rep texted them \(10\/21\) as the person taking care of them\. Write as one team with Rep/.test(p), true);
    check('control: the signer\'s own intro is not someone else\'s', () => /SALESPERSON HAS INTRODUCED/.test(viaPanel(LSD({ agent: 'Rep Name' }))), false);

    console.log(' 4. the Key Information panel, drawn into a shadow root:');
    const sa = src.indexOf('  function inlineScraper() {'), sbx = src.indexOf('  } // end inlineScraper', sa), scraper = src.slice(sa, sbx + 3);
    const ra = src.indexOf('      function _lpKiRoots() {'), wa = src.indexOf('      function _lpKiWait(done) {'), wb = wa >= 0 ? src.indexOf('\n      }\n', wa) : -1;
    const waiter = (wa >= 0 && wb > wa) ? (ra >= 0 ? src.slice(ra, src.indexOf('\n', ra) + 1) : '') + src.slice(wa, wb + 8) : '';
    const visit = async (html) => {
      const page = await br.newPage();
      await page.route('**/*', r => /\/CarDashboard\/dash$/.test(r.request().url()) ? r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }) : r.abort());
      await page.goto('https://crm.example.test/CarDashboard/dash', { waitUntil: 'domcontentloaded' });
      let waited = -1; if (waiter) waited = await page.evaluate('(function(){' + waiter + '\n; var t0 = Date.now(); return new Promise(function(r){ _lpKiWait(function(){ r(Date.now() - t0); }); }); })()').catch(() => -1);
      let res; try { res = await page.evaluate('(async()=>{' + scraper + '\n; return await inlineScraper();})()'); } catch (e) { res = { err: e.message }; }
      await page.close(); return { res: res || {}, waited };
    };
    const sh = await visit(SHADOW(500));
    check('the panel is drawn into a portal-shadow-container\'s shadow root 500 ms after load: the grab waits for it', sh.waited >= 400 && sh.waited < 1800, true);
    check('...and reads its rows from inside the shadow root -- the Fullpath CDP Summary and the AMP row with its date', (sh.res.keyInfo || []).map(k => [k.key, k.label, k.date]), [['CustomerSummary', 'Fullpath CDP Summary', ''], ['Amp', 'AMP', '10/3/2026']]);
    check('...and logs where it found them', (sh.res._lpDiag || []).some(l => /\[LP KEYINFO DIAG\] rows:2 .* \| in shadow root of DIV\.portal-shadow-container/.test(l)), true);
  }
  await br.close();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
