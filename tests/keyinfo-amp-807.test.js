#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('keyinfo-amp-807.test.js');
// (v9.7.807) THE KEY INFORMATION PANEL, AND AMP LEADS. The customer dashboard's Key Information rows (Fullpath CDP Summary, AMP,
// Customer Intelligence, Buying Signals) fill in from two requests the page makes after it loads, so Lead Pro's read always ran
// first: every grab logged since v9.7.550 found the panel and none of its rows. Gil, 10/21, from a Toyota Baytown Fullpath lead
// whose summary read "... has never purchased a vehicle or had service visits with the dealership. [They] submitted a FullPath
// lead on October 20, 2026, for a used 2024 Toyota Land Cruiser, viewed its vehicle listing, and opened and clicked a dealership
// email that day": use it, and fix the AMP signals. AMP sources ("AMP - I'm Interested", "Amp - Buying Signals", "AMP - Service
// to Sales Opportunity", ...) set s.isAMP and nothing read it, so a buying-signal lead was written as an inquiry.
// Runs the SHIPPED _lpKiWait and inlineScraper in Chromium against a placeholder customer dashboard whose panel fills in late,
// and executes _lpAmpKind, _lpKeyInfoLines, populateFromData and buildUserPrompt. Placeholder data only.
//
// Usage: node tests/keyinfo-amp-807.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: keyinfo-amp-807.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = typeof fn === 'function' ? fn() : fn; } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const SUMMARY = '[Customer] has never purchased a vehicle or had service visits with the dealership. [They] submitted a FullPath lead on October 20, 2026, for a used 2024 Toyota Land Cruiser, viewed its vehicle listing, and opened and clicked a dealership email that day.';
// The panel's own markup (Gil's element), rows added after load the way the dashboard's two requests add them.
const ROW = (name, label, blurb, date) => '<div id="keyInfo-' + name + '" class="key-information-banner__StyledKeyInformationBanner-sc-gicfmx-0 row">'
  + '<div id="keyInfo-' + name + '-icon" class="col-sm-3"><span><span class="customer-summary-icon__StyledCustomerSummaryIconText">' + label + '</span></span></div>'
  + '<div id="keyInfo-' + name + '-date" class="col-sm-2"><span role="button">' + date + '</span></div>'
  + '<div id="keyInfo-' + name + '-blurb" class="col-sm-7"><span>' + blurb + '</span></div></div>';
const ROWS = ROW('CustomerSummary', 'Fullpath CDP Summary', SUMMARY, 'View More') + ROW('CustomerIntelligence', 'Customer Intelligence', 'Lifestyle insights to help understand your customer.', '')
  + ROW('Amp', 'AMP', 'This customer received an AMP marketing event', '10/3/2026');
const DASH = (delayMs) => '<html><body><div id="CustomerDashboardTop">Test Buyer</div><div class="key-information-panel__Styled"><div id="ki-body"></div></div>'
  + '<script>setTimeout(function(){ document.getElementById("ki-body").innerHTML = ' + JSON.stringify(ROWS) + '; }, ' + delayMs + ');</script></body></html>';
const E = (when, tag, title, body) => '[' + when + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = '[10/20/2026 9:00 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const LEAD = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2024 Toyota Land Cruiser',
  condition: 'Used', stockNum: '', vin: '', dealerId: '6189', store: 'Community Toyota Baytown', leadSource: 'FullPath', convState: 'first-touch', leadAgeDays: 0, hasOutbound: false,
  hasCustomerReply: false, totalNoteCount: 3, phone: '(555) 010-0199', email: 'test@example.com', relationshipSignals: { unansweredQuestions: [] }, lastInboundMsg: '',
  history: MARK, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + MARK + '---', customerState: 'TX', customerZip: '77521',
  keyInfo: [{ key: 'CustomerSummary', label: 'Fullpath CDP Summary', blurb: SUMMARY, date: '' }, { key: 'CustomerIntelligence', label: 'Customer Intelligence', blurb: 'Lifestyle insights to help understand your customer.', date: '' },
    { key: 'Amp', label: 'AMP', blurb: 'This customer received an AMP marketing event', date: '10/3/2026' }] }, x || {});

(async () => {
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }).catch(() => chromium.launch());
  for (const f of BUILDS) {
    console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
    const src = fs.readFileSync(f, 'utf8');
    const sa = src.indexOf('  function inlineScraper() {'), sbx = src.indexOf('  } // end inlineScraper', sa);
    const scraper = src.slice(sa, sbx + 3);
    const wa = src.indexOf('      function _lpKiWait(done) {'), wb = wa >= 0 ? src.indexOf('\n      }\n', wa) : -1;
    const waiter = (wa >= 0 && wb > wa) ? src.slice(wa, wb + 8) : '';
    const visit = async (html, wait) => {
      const page = await br.newPage();
      await page.route('**/*', r => /\/CarDashboard\/dash$/.test(r.request().url()) ? r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }) : r.abort());
      await page.goto('https://crm.example.test/CarDashboard/dash', { waitUntil: 'domcontentloaded' });
      let waited = -1, err = '';
      if (wait) { if (!waiter) err = '_lpKiWait not in this build'; else waited = await page.evaluate('(function(){' + waiter + '\n; var t0 = Date.now(); return new Promise(function(r){ _lpKiWait(function(){ r(Date.now() - t0); }); }); })()').catch(e => { err = e.message; return -1; }); }
      let res; try { res = await page.evaluate('(async()=>{' + scraper + '\n; return await inlineScraper();})()'); } catch (e) { res = { err: e.message }; }
      await page.close(); return { res: res || {}, waited, err };
    };

    console.log(' 1. the grab waits for the panel, then reads it:');
    const late = await visit(DASH(600), true);
    check('the panel fills in 600 ms after load: the grab waits for it (and not the full 2 seconds)', [late.err, late.waited >= 450 && late.waited < 1800], ['', true]);
    const ki = (late.res.keyInfo || []).map(k => [k.key, k.label, k.date]);
    check('...and reads every row: the Fullpath CDP Summary, Customer Intelligence and the AMP row with its date', ki,
      [['CustomerSummary', 'Fullpath CDP Summary', ''], ['CustomerIntelligence', 'Customer Intelligence', ''], ['Amp', 'AMP', '10/3/2026']]);
    check('...the summary\'s own text, whole', ((late.res.keyInfo || [])[0] || {}).blurb, SUMMARY);
    check('...and logs it ([LP KEYINFO DIAG])', (late.res._lpDiag || []).some(l => /\[LP KEYINFO DIAG\] rows:3/.test(l)), true);
    const none = await visit('<html><body><div id="notes">no panel here</div></body></html>', true);
    check('control: a frame with no Key Information panel does not wait', [none.err, none.waited >= 0 && none.waited < 300], ['', true]);
    const never = await visit(DASH(99999), true);
    check('control: a panel that never fills in costs at most 2 seconds, and nothing is read', [never.waited >= 1900 && never.waited < 2600, (never.res.keyInfo || []).length], [true, 0]);
    check('the grab runs the wait after the notes and emails are in (source)', /if \(bothReady\) \{ _lpExpandEmails\(\)\.then\(function \(\) \{ _lpKiWait\(resolve\); \}/.test(src), true);
    check('it is a customer-level field: a frame showing another customer does not supply it (source)', /'fullpathConversion','keyInfo'\]/.test(src), true);

    let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
    const run = (e) => vm.runInContext(e, sb);
    const fn = (name) => { try { return run(name); } catch (e) { return null; } };
    const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
    for (const id of ['6189', '24399']) run('_lpValueFactCache')[id] = { inv: { units: [] }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true };
    const built = (d) => quiet(() => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(d); const ctx = run('leadContext');
      return { ctx: ctx, p: sb.__lp.buildUserPrompt(Object.assign({}, d, { context: ctx })) }; });

    console.log(' 2. the summary reaches the prompt as background:');
    const b = built(LEAD());
    check('the Fullpath CDP summary is in the prompt, marked as the CRM\'s own summary and background', /THE CRM'S OWN SUMMARY OF THIS CUSTOMER[^\n]*background[^\n]*\n- Fullpath CDP summary: "\[Customer\] has never purchased a vehicle/.test(b.p), true);
    check('...the AMP row as "one of our marketing emails went to them (10/3/2026)"', /- AMP: one of our marketing emails went to them \(10\/3\/2026\)\./.test(b.p), true);
    check('...never what they opened, clicked or viewed; a first-time customer is never welcomed back', [/NEVER mention what they opened, clicked, viewed or browsed/.test(b.p), /never bought or serviced with us is never welcomed back/.test(b.p)], [true, true]);
    check('...and Customer Intelligence\'s placeholder ("Lifestyle insights to help understand your customer.") is left out', /Lifestyle insights/.test(b.p), false);
    check('a Buying Signals row fills the field the AI Buying Signals arm reads, when the scrape had none', () => { const d = LEAD({ buyingSignals: '', keyInfo: [{ key: 'BuyingSignals', label: 'Buying Signals', blurb: 'Actively Shopping. Interests: Tacoma, 4Runner.', date: '' }] });
      built(d); return d.buyingSignals; }, 'Actively Shopping. Interests: Tacoma, 4Runner.');
    check('control: no panel rows, no block', /THE CRM'S OWN SUMMARY/.test(built(LEAD({ keyInfo: [] })).p), false);

    console.log(' 3. AMP leads say how they reached us:');
    const ak = fn('_lpAmpKind');
    check('the AMP sources on these stores are told apart (new helper)', () => ['AMP - I\'m Interested', 'AMP - Interested in More Information', 'AMP - Discuss Lease End', 'Amp - Buying Signals', 'AMP - Service to Sales Opportunity', 'AI Buying Signals - Not Previously Sold', 'Cars.com'].map(ak),
      ['cta', 'cta', 'lease', 'signal', 'service', '', '']);
    const amp = (ls) => built(LEAD({ leadSource: ls, keyInfo: [], vehicle: '2026 Toyota Camry', condition: 'New' })).p;
    const sig = amp('Amp - Buying Signals');
    check('"Amp - Buying Signals": they did NOT reach out -- never an inquiry, never "we noticed your activity"', /HOW THIS LEAD REACHED US: our marketing system flagged them as likely shopping -- they did NOT reach out or ask for anything\. Never call it an inquiry/.test(sig), true);
    check('...and no "came through <source>" acknowledgment on a flagged lead', /SOURCE ACKNOWLEDGMENT/.test(sig), false);
    check('"AMP - Interested in More Information": their request -- answer it ("thanks for letting us know you\'d like more information")', /HOW THIS LEAD REACHED US: they answered one of our emails -- they asked for more information\. That is their request/.test(amp('AMP - Interested in More Information')), true);
    check('"AMP - Service to Sales Opportunity": a service customer, not an inquiry, never "flagged"', /they are one of our service customers, flagged as a possible sales opportunity -- they did NOT ask about buying/.test(amp('AMP - Service to Sales Opportunity')), true);
    check('control: a Cars.com lead is unchanged', /HOW THIS LEAD REACHED US: you may say the customer came through Cars\.com/.test(amp('Cars.com')), true);
  }
  await br.close();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
