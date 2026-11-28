#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('total-loss-880.test.js');
// (v9.7.880) A KIA FINANCE TOTAL LOSS LEAD IS A REPLACEMENT, NOT A LOAN COMING DUE. Owner, 11/17: "Kmf Total Loss Leads (Internet) treated
// as a KMF Luv 'end of'". Kia Baytown lead 3116039124 (HCA_Program: KFA Total Loss Leads, the note "ATTENTION - Active Kia Finance customer
// who has claimed a total loss on their current vehicles", maturity years out) got "Customer's loan is coming due ... lead with this timing
// ... pay off and keep, trade the equity, or refinance" and the draft "review your K4 loan as it comes due". Runs the shipped inlineScraper
// in Chromium on placeholder pages; builds prompts through the shipped populateFromData and panel payload. Placeholder data only.
//
// Usage: node tests/total-loss-880.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: total-loss-880.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = typeof fn === 'function' ? fn() : fn; } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
const note = (id, when, title, html) => '<span id="notes-and-history-item-' + id + '" data-tags="" data-direction="" data-unique-identifier-type="AutoLeadMessageID" data-unique-identifier-value="' + id
  + '" class="notes-and-history-item list-group-item"><div class="notes-and-hsitory-item-date">' + when + '</div><div class="notes-and-hsitory-item-detail"><div class="notes-and-history-item-header">'
  + '<div class="legacy-notes-and-history-title">' + title + '</div></div><div class="notes-and-history-item-content">' + html + '</div></div></span>';
const HCA = (program, attention) => 'By: System<br>///HCA details///<br>HCA_MonthlyPayment: 500.00<br>HCA_MaturityDate: 08/02/2030<br>HCA_TermMonths: 60<br>HCA_AccountType: RETAIL<br>HCA_Program: ' + program
  + '<br>HCA_GAP: Yes<br>///Lead Handeling///<br>' + attention + '<br><br>Current Vehicle: 2025 K4<br>';
const TL_NOTE = HCA('KFA Total Loss Leads', 'ATTENTION - Active Kia Finance customer who has claimed a total loss on their current vehicles.');
const LUV_NOTE = HCA('KMF LUV Program', 'ATTENTION - Active Kia Finance customer approaching the end of their term.');
const PAGE = (o) => '<html><body>'
  + '<div id="vindebug-section-wrap"><div class="vindebug-section vindebug-section-new" data-globalcustomerid="111" data-autoleadid="1000000009" data-dealerid="6190"></div></div>'
  + '<div id="PageData" data-pagedata="' + esc(JSON.stringify({ AutoLeadID: '1000000009', Lead: { LeadCreatedUTC: '2026-11-17T02:04:00' }, LeadVehicle: { InventoryType: 'N' } })) + '"></div>'
  + '<div>Lead Info Status: Active</div><span id="ActiveLeadPanelWONotesAndHistory1__LeadSourceName">' + o.source + '</span>'
  + '<span id="ActiveLeadPanelWONotesAndHistory1_m_VehicleInfo">2026 Kia Full Line (New)</span>'
  + '<div id="notes">' + note('1', '11/16/2026 8:04 PM', 'Lead received', o.hca) + '</div></body></html>';
const LEAD = (x) => Object.assign({ autoLeadId: '1000000009', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Kia Full Line',
  condition: 'New', dealerId: '6190', store: 'Community Kia Baytown', leadSource: 'Kmf Total Loss Leads', convState: 'first-touch', leadAgeDays: 0, hasOutbound: false, hasCustomerReply: false,
  totalNoteCount: 3, phone: '(555) 010-0199', email: 'test@example.com', relationshipSignals: { unansweredQuestions: [] }, outboundSends: [], history: '', conversationBrief: '',
  _hcaAccountType: 'finance', _hcaMaturity: 'far', _hcaCurrentVehicle: '2025 Kia K4' }, x || {});

(async () => {
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }).catch(() => chromium.launch());
  for (const f of BUILDS) {
    console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
    const src = fs.readFileSync(f, 'utf8');
    let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
    const run = (e) => vm.runInContext(e, sb);
    const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
    for (const id of ['6189', '6190', '6191', '24399']) run('_lpValueFactCache')[id] = { inv: { units: [] }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true };
    const scrape = async (html) => {
      const page = await br.newPage(), url = 'https://crm.example.test/CarDashboard/Pages/rims2.aspx';
      await page.route('**/*', r => r.request().url() === url ? r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }) : r.abort());
      await page.goto(url, { waitUntil: 'load' });
      const sa = src.indexOf('  function inlineScraper() {'), sx = src.indexOf('  } // end inlineScraper', sa);
      let res; try { res = await page.evaluate('(async()=>{' + src.slice(sa, sx + 3) + '\n; return await inlineScraper();})()'); } catch (e) { res = { err: e.message }; }
      await page.close(); return res || {};
    };
    const viaPanel = (lsd, flags) => quiet(() => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(lsd);
      (flags || []).forEach(fl => run('activeFlags.add(' + JSON.stringify(fl) + ')'));
      return String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: run('leadContext') }))); });

    console.log(' 1. the scraper reads the program off the lead note:');
    const tl = await scrape(PAGE({ source: 'Kmf Total Loss Leads (Internet)', hca: TL_NOTE }));
    check('"HCA_Program: KFA Total Loss Leads" -> the finance data says TOTAL LOSS and a replacement, not "frame around their loan, payoff, equity"',
      () => [/LOYALTY\/FINANCE PROGRAM DATA - TOTAL LOSS: [^\n]*declared a TOTAL LOSS in an insurance claim\. They need a REPLACEMENT/.test(String(tl.conversationBrief || '')), /Frame around their loan, payoff, equity position/.test(String(tl.conversationBrief || ''))], [true, false]);
    const luv = await scrape(PAGE({ source: 'Kmf Luv Program', hca: LUV_NOTE }));
    check('control: a KMF LUV note keeps its loan header', () => /LOYALTY\/FINANCE PROGRAM DATA - this customer FINANCED \(account type RETAIL\/loan\)\. Frame around their loan/.test(String(luv.conversationBrief || '')), true);

    console.log(' 2. the prompt (lead 3116039124\'s shape):');
    const p = viaPanel(LEAD(), ['loyalty']);
    check('the scenario is a TOTAL LOSS replacement, naming the car on the loan', () => /TASK: Kia Finance TOTAL LOSS lead\. The customer's financed Kia \(2025 Kia K4\) was declared a total loss in an insurance claim/.test(p), true);
    check('...and nothing says the loan is coming due, approaching maturity, or offers keep / equity / refinance', () => [/Customer's loan is coming due|Their loan is approaching maturity|the upcoming loan end|Options: pay off and keep/.test(p)], [false]);
    check('the loyalty flag says KIA FINANCE TOTAL LOSS, not an "options review" "as your loan comes due"', () => [/🔴 KIA FINANCE TOTAL LOSS:/.test(p), /🔴 LOYALTY \/ LEASE-END FLAG|Frame the visit as an "options review"|Reference it as their loan\/payoff/.test(p)], [true, false]);
    check('the loyalty vehicle line says the car was declared a total loss', () => /🔑 LOYALTY VEHICLE: "2025 Kia K4" is the customer's FINANCED VEHICLE, DECLARED A TOTAL LOSS IN AN INSURANCE CLAIM/.test(p), true);
    check('the source alone is not needed: the scraper\'s TOTAL LOSS header is enough (source "KMF - Kia Motors Finance")',
      () => /TASK: Kia Finance TOTAL LOSS lead/.test(viaPanel(LEAD({ leadSource: 'KMF - Kia Motors Finance', conversationBrief: String(tl.conversationBrief || '') }), ['loyalty'])), true);
    console.log(' 3. control -- a KMF LUV lead is unchanged:');
    const q = viaPanel(LEAD({ leadSource: 'Kmf Luv Program', _hcaMaturity: '' }), ['loyalty']);
    check('control: KMF LUV finance -> "loan is coming due", the options, and the loyalty flag, as before',
      () => [/Customer's loan is coming due/.test(q), /Options: pay off and keep/.test(q), /🔴 LOYALTY \/ LEASE-END FLAG/.test(q), /TOTAL LOSS/.test(q)], [true, true, true, false]);
  }
  await br.close();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
