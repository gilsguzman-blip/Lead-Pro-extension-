#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('lease-timing-814.test.js');
// (v9.7.814) A RETURN CHOSEN MONTHS BEFORE LEASE END IS NOT A TURN-IN TODAY. Kia Baytown lead 2103558746 (log346, v9.7.813): the
// customer chose "Return Your Vehicle" on the finance company's site, her lease matures 04/09/2027, and every draft asked her to
// drop the EV9 off "this afternoon at 5:45" and skipped the light question about what is next; the email opened "As a returning
// Kia customer, you can handle the return". Gil: option (a) -- no turn-in now -- and "the go over options may be the better way
// to go with these. Being so far out offering may sway instead of just giving up and letting her walk away."
// Runs the shipped inlineScraper in Chromium on placeholder lead pages; builds prompts through the shipped populateFromData and
// panel payload. Placeholder data only.
//
// Usage: node tests/lease-timing-814.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: lease-timing-814.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = typeof fn === 'function' ? fn() : fn; } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
const mdy = (ms) => { const d = new Date(ms); return (d.getMonth() + 1 + '').padStart(2, '0') + '/' + (d.getDate() + '').padStart(2, '0') + '/' + d.getFullYear(); };
const DAY = 86400000;
const note = (title, html) => '<span id="notes-and-history-item-1" data-tags="" data-direction="" data-unique-identifier-type="AutoLeadMessageID" data-unique-identifier-value="1" class="notes-and-history-item list-group-item">'
  + '<div class="notes-and-hsitory-item-date">10/20/2026 8:07 PM</div><div class="notes-and-hsitory-item-detail"><div class="notes-and-history-item-header">'
  + '<div class="legacy-notes-and-history-title">' + title + '</div></div><div class="notes-and-history-item-content">' + html + '</div></div></span>';
const PAGE = (maturity) => '<html><body><div id="vindebug-section-wrap"><div class="vindebug-section" data-globalcustomerid="111" data-autoleadid="1000000002" data-dealerid="6190"></div></div>'
  + '<div id="PageData" data-pagedata="' + esc(JSON.stringify({ AutoLeadID: '1000000002', Lead: { LeadCreatedUTC: '2026-10-21T01:07:00' } })) + '"></div>'
  + '<span id="ActiveLeadPanelWONotesAndHistory1__LeadSourceName">KMF Customer Intent Capture</span><span id="ActiveLeadPanelWONotesAndHistory1_m_VehicleInfo">2024 Kia EV9 GT-Line (New)</span>'
  + '<div id="notes">' + note('Lead received', 'HCA_MonthlyPayment: 600.00<br>HCA_MaturityDate: ' + maturity + '<br>HCA_TermMonths: 36<br>HCA_AccountType: Lease<br>HCA_LeaseEndIntent: Return Your Vehicle<br>HCA_IntentDate: 20261019<br>') + '</div></body></html>';
const LEAD = (x) => Object.assign({ autoLeadId: '1000000002', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2024 Kia EV9 GT-Line',
  condition: 'New', dealerId: '6190', store: 'Test Kia', leadSource: 'KMF Customer Intent Capture', convState: 'first-touch', leadAgeDays: 0, hasOutbound: false, hasCustomerReply: false,
  totalNoteCount: 3, phone: '(555) 010-0199', email: 'test@example.com', relationshipSignals: { unansweredQuestions: [] }, outboundSends: [], history: '', conversationBrief: '',
  _hcaAccountType: 'lease', _hcaLeaseIntent: 'return' }, x || {});

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
    const viaPanel = (lsd) => quiet(() => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(lsd); run('activeFlags.add("loyalty")');
      return sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: run('leadContext') })); });

    console.log(' 1. how far off the lease end is (read off the Lead received note):');
    const far = await scrape(PAGE(mdy(Date.now() + 170 * DAY))), near = await scrape(PAGE(mdy(Date.now() + 40 * DAY)));
    check('lead 2103558746: a maturity five-plus months out is "far"; one forty days out is "near"', () => [far._hcaMaturity, near._hcaMaturity, far._hcaLeaseIntent], ['far', 'near', 'return']);

    console.log(' 2. a Return, months before the lease ends:');
    const pFar = viaPanel(LEAD({ _hcaMaturity: 'far' }));
    check('log346: no turn-in now and no drop-off time; a time to go over their lease-end options (what the return involves, a pre-inspection, what else is open); never argue the choice',
      () => [/Do NOT ask them to bring the car in, drop it off or turn it in now, and do not offer a drop-off time/.test(pFar), /Offer a time to go over their lease-end options together/.test(pFar),
        /a pre-inspection, so there are no surprises at turn-in/.test(pFar), /Respect the choice and never argue it/.test(pFar), /set a time for the inspection and drop-off/.test(pFar)], [true, true, true, true, false]);
    check('...ends with one light question about what is next, and is not told to call her a returning customer',
      () => [/End with one light question about what is next for them/.test(pFar), /Acknowledge they are a returning Kia customer/.test(pFar)], [true, false]);

    console.log(' 3. a Return near the lease end:');
    const pNear = viaPanel(LEAD({ _hcaMaturity: 'near' }));
    check('the turn-in, made easy -- and the light question is asked, not optional', () => [/set a time for the inspection and drop-off/.test(pNear), /End with one light question about what is next for them/.test(pNear),
      /go over their lease-end options/.test(pNear)], [true, true, false]);
    check('control: a lease customer who did not choose a return is still acknowledged as a returning customer', () =>
      /Kia LUV\/KMF, lease customer: warm and loyalty-based\. Acknowledge they are a returning Kia customer/.test(viaPanel(LEAD({ _hcaLeaseIntent: '', _hcaMaturity: 'far' }))), true);
  }
  await br.close();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
