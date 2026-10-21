#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('lease-intent-813.test.js');
// (v9.7.813) KIA BAYTOWN, 10/21: A KMF LEASE-END INTENT, A CDP THAT SAYS "LEASED", AND A NEWER LEAD NOBODY WAS TOLD ABOUT.
//  - Lead 2103558746 (KMF Customer Intent Capture, status NCI -- Not Customer Initiated): the Lead received note carries
//    "HCA_AccountType: Lease" and "HCA_LeaseEndIntent: Return Your Vehicle". The drafts pitched an options-review visit, and the
//    CDP summary read the lead as "for a new 2024 Kia EV9 GT-Line" (the car she leases). The choice she made on the finance
//    company's site now drives the message; Gil on a Return: "light anything next is a good track."
//  - Where the lead's own account type is missing, the CDP summary's "leased" / "financed" decides (Gil: "The CDP is a good
//    fact if it says it's a lease").
//  - Lead 1581859334, the same customer's 2024 Sold walk-in with a 2024 EV9 on it, was grabbed with the 10/20 NCI lead above it in
//    the lead list, and nothing said so: the newer-lead check (v9.7.497) only ran on a lead with no vehicle of interest.
// Runs the shipped inlineScraper in Chromium on placeholder pages; builds prompts through the shipped populateFromData and panel
// payload. Placeholder data only.
//
// Usage: node tests/lease-intent-813.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: lease-intent-813.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = typeof fn === 'function' ? fn() : fn; } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
const note = (id, dir, when, title, html) => '<span id="notes-and-history-item-' + id + '" data-tags="" data-direction="' + dir
  + '" data-unique-identifier-type="AutoLeadMessageID" data-unique-identifier-value="' + id + '" class="notes-and-history-item list-group-item">'
  + '<div class="notes-and-hsitory-item-date">' + when + '</div><div class="notes-and-hsitory-item-detail"><div class="notes-and-history-item-header">'
  + '<div class="legacy-notes-and-history-title">' + title + '</div></div><div class="notes-and-history-item-content">' + html + '</div></div></span>';
const HCA = (intent) => 'HCA_MonthlyPayment: 600.00<br>HCA_MaturityDate: 04/09/2027<br>HCA_TermMonths: 36<br>HCA_AccountType: Lease<br>HCA_GAP: No<br>'
  + 'HCA_LeaseEndIntent: ' + intent + '<br>HCA_IntentDate: 20261019<br>///Media Type/// Media_Type:<br>///Lead Handeling/// ATTENTION - Active Kia Finance customer who has '
  + 'submitted their lease-end intent via www.kiafinance.com. Intents include Return Vehicle, Purchase Current Vehicle, or Purchase or Lease a New Vehicle. HCA SUGGESTED MODEL 1: EV9;';
const PAGE = (o) => '<html><body>'
  + '<div id="vindebug-section-wrap"><div class="vindebug-section vindebug-section-new" data-globalcustomerid="111" data-autoleadid="' + o.lead + '" data-dealerid="6190"></div></div>'
  + '<div id="PageData" data-pagedata="' + esc(JSON.stringify({ AutoLeadID: o.lead, Lead: { LeadCreatedUTC: o.created }, LeadVehicle: { InventoryType: 'N' } })) + '"></div>'
  + '<div>Lead Info Status: ' + o.status + '</div>' + (o.noSourceField ? '<div>' + o.source + '</div>' : '<span id="ActiveLeadPanelWONotesAndHistory1__LeadSourceName">' + o.source + '</span>')
  + '<span id="ActiveLeadPanelWONotesAndHistory1_m_VehicleInfo">2024 Kia EV9 GT-Line (New)</span>'
  + '<div id="LeadSelector"><table><tbody class="ant-table-tbody">' + o.rows.map(r => '<tr class="ant-table-row' + (r[0] === o.lead ? ' selected' : '') + ' LeadSelectorItem" data-row-key="' + r[0] + '">'
    + r.slice(1).map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>'
  + '<div id="notes">' + (o.notes || []).join('') + '</div></body></html>';
const ROWS = [['1000000002', 'NCI', '', '10/20/26', 'KMF Customer Intent Capture', '2024 Kia EV9'], ['1000000001', 'Sold', '', '4/6/24', 'Showroom', '2024 Kia EV9']];

const CDP = (t) => ({ key: 'CustomerSummary', label: 'Fullpath CDP Summary', date: '', blurb: t });
const LEAD = (x) => Object.assign({ autoLeadId: '1000000002', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2024 Kia EV9 GT-Line',
  condition: 'New', dealerId: '6190', store: 'Test Kia', leadSource: 'KMF Customer Intent Capture', convState: 'first-touch', leadAgeDays: 0, hasOutbound: false, hasCustomerReply: false,
  totalNoteCount: 3, phone: '(555) 010-0199', email: 'test@example.com', relationshipSignals: { unansweredQuestions: [] }, outboundSends: [], history: '', conversationBrief: '' }, x || {});

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
      return sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: run('leadContext') })); });

    console.log(' 1. the choice she made on the finance company\'s site:');
    const intentOf = async (intent) => (await scrape(PAGE({ lead: '1000000002', created: '2026-10-21T01:07:00', status: 'NCI', source: 'KMF Customer Intent Capture', rows: ROWS,
      notes: [note('1', '', '10/20/2026 8:07 PM', 'Lead received', HCA(intent))] })));
    const ret = await intentOf('Return Your Vehicle');
    check('lead 2103558746: "HCA_LeaseEndIntent: Return Your Vehicle" is read as a return, and the account type as a lease', () => [ret._hcaLeaseIntent, ret._hcaAccountType], ['return', 'lease']);
    const cur = await intentOf('Purchase Your Current Vehicle'), nw = await intentOf('Purchase or Lease a New Vehicle');
    check('..."Purchase Your Current Vehicle" and "Purchase or Lease a New Vehicle": buying the car they have, and a new vehicle', () => [cur._hcaLeaseIntent, nw._hcaLeaseIntent], ['purchase-current', 'new']);
    const pRet = viaPanel(LEAD({ _hcaAccountType: 'lease', _hcaLeaseIntent: 'return' }), ['loyalty']);
    check('a Return: make the turn-in easy, no pitch, at most one light question about what is next; it outranks the CRM summary; no options list',
      () => [/THEIR LEASE-END CHOICE: on the finance company's site they chose to RETURN the vehicle/.test(pRet), /outranks the CRM summary/.test(pRet),
        /At most one light question about what is next for them/.test(pRet), /- Options: return and lease new, purchase at residual/.test(pRet)], [true, true, true, false]);
    check('a purchase of the car they have, and a new vehicle, get their own lines',
      () => [/they chose to BUY THE VEHICLE THEY HAVE/.test(viaPanel(LEAD({ _hcaAccountType: 'lease', _hcaLeaseIntent: 'purchase-current' }), ['loyalty'])),
        /they chose to PURCHASE OR LEASE A NEW VEHICLE\. Their next vehicle with us is the subject/.test(viaPanel(LEAD({ _hcaAccountType: 'lease', _hcaLeaseIntent: 'new' }), ['loyalty']))], [true, true]);
    check('control: no intent on the lead -- the lease options as before', () => /- Options: return and lease new, purchase at residual, or switch to finance/.test(viaPanel(LEAD({ _hcaAccountType: 'lease' }), ['loyalty'])), true);

    console.log(' 2. the CDP says "leased" and the lead has no account type of its own:');
    const pCdp = viaPanel(LEAD({ keyInfo: [CDP('[Customer] leased one vehicle and has many service visits with the dealership.')] }), ['loyalty']);
    check('lead 2103558746 with its notes unread: a lease customer, not "account type UNKNOWN"', () => [/Kia LUV\/KMF, lease customer/.test(pCdp), /account type UNKNOWN/.test(pCdp)], [true, false]);
    check('control: a summary that says neither still leaves it unknown', () =>
      /account type UNKNOWN/.test(viaPanel(LEAD({ keyInfo: [CDP('[Customer] has many service visits with the dealership.')] }), ['loyalty'])), true);
    check('control: the lead\'s own account type outranks the summary', () =>
      /Kia LUV\/KMF, FINANCE customer/.test(viaPanel(LEAD({ _hcaAccountType: 'finance', keyInfo: [CDP('[Customer] leased one vehicle.')] }), ['loyalty'])), true);

    const nf = await scrape(PAGE({ lead: '1000000002', created: '2026-10-21T01:07:00', status: 'NCI', source: 'Kia Motors Finance program', rows: ROWS, noSourceField: true }));
    check('a page with no source field whose text names Kia Motors Finance: the fallback sets the source instead of throwing and losing the grab', () => [nf.err || null, nf.leadSource], [null, 'KMF - Kia Motors Finance']);

    console.log(' 3. a newer lead on the customer, while an older one with a vehicle is open:');
    const old = await scrape(PAGE({ lead: '1000000001', created: '2024-04-06T21:25:00', status: 'Sold', source: 'Showroom', rows: ROWS }));
    check('lead 1581859334: the open lead has a vehicle, and the 10/20 NCI lead above it is found', () => [!!old.vehicle, old.newerLead && [old.newerLead.leadId, old.newerLead.date, old.newerLead.status, old.newerLead.source]],
      [true, ['1000000002', '10/20/26', 'NCI', 'KMF Customer Intent Capture']]);
    const pOld = viaPanel(LEAD({ autoLeadId: '1000000001', leadSource: 'Showroom', newerLead: old.newerLead }));
    check('...and the prompt says so, and that NCI means the program created it -- not an inquiry they sent us',
      () => [/A NEWER LEAD EXISTS FOR THIS CUSTOMER/.test(pOld), /NCI, means NOT CUSTOMER INITIATED/.test(pOld)], [true, true]);
    const newest = await scrape(PAGE({ lead: '1000000002', created: '2026-10-21T01:07:00', status: 'NCI', source: 'KMF Customer Intent Capture', rows: ROWS }));
    check('control: on the newest lead there is nothing newer', () => newest.newerLead || null, null);
  }
  await br.close();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
