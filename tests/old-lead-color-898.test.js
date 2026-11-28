#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('old-lead-color-898.test.js');
// (v9.7.898) A COLOR FROM AN EARLIER LEAD, ABOUT ANOTHER CAR, IS NOT THIS LEAD'S ASK. Kia Baytown lead 3122500487 (TrueCar, 11/27, log432):
// a new Carnival Hybrid lead read "black" out of the customer's July text on the older Telluride lead ("... Was the matte black but had a
// mechanical issue with it so taking a glacier white.") and the prompt said they asked for black, over the lead's Astra Blue. Runs the
// SHIPPED inlineScraper in Chromium on placeholder pages. Placeholder data only.
//
// Usage: node tests/old-lead-color-898.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: old-lead-color-898.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
let id = 570000000;
const note = (dir, when, title, html) => { id++; return '<span id="notes-and-history-item-' + id + '" data-tags="x" data-direction="' + dir
  + '" data-unique-identifier-type="AutoLeadMessageID" data-unique-identifier-value="' + id + '" class="notes-and-history-item list-group-item">'
  + '<div class="notes-and-hsitory-item-date">' + when + '</div><div class="notes-and-hsitory-item-detail"><div class="notes-and-history-item-header">'
  + '<div class="legacy-notes-and-history-title">' + title + '</div></div><div class="notes-and-history-item-content">' + html + '</div></div></span>'; };
const PAGE = (notes) => '<html><body><div>Lead Info<br>Status:\tActive<br>Created:\t11/26/26 11:04p (1d)<br>Source:\tTruecar/Sams Club</div><div id="notes">' + notes.join('') + '</div></body></html>';
const IN = (when, text) => note('Inbound', when, 'Inbound Text Message', '<div>Received from: (555) 010-0199</div><div>Received by: Agent Name</div><div>' + text + '</div>');
const RECEIVED = note('Inbound', '11/26/2026 11:04 PM', 'Lead received', '<div>By: System</div><div>TrueCar lead. Customer is interested in a new vehicle.</div>');
const OUT = note('Outbound', '11/27/2026 8:10 AM', 'Outbound Text Message', '<div>Sent to: (555) 010-0199</div><div>Sent by: Agent Name</div><div>Test, thanks for reaching out about the Carnival Hybrid. I can help with pricing.</div>');   // our text: the color reader runs on follow-ups
const NOW_NEW = IN('11/27/2026 8:20 AM', 'Looking for the best pricing in a 26 or 27, hybrid SX or SX premium');
const OLD = IN('07/04/2026 1:10 PM', 'It is in my file. So not with me. Xline Hybrid SX prestige. Was the matte black but had a mechanical issue with it so taking a glacier white.');

(async () => {
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }).catch(() => chromium.launch());
  for (const f of BUILDS) {
    console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
    const src = fs.readFileSync(f, 'utf8');
    const sa = src.indexOf('  function inlineScraper() {'), sbx = src.indexOf('  } // end inlineScraper', sa);
    const scraper = src.slice(sa, sbx + 3);
    const scrape = async (notes) => {
      const ctx = await br.newContext({ timezoneId: 'America/Chicago' }); const page = await ctx.newPage();
      await page.route('**/*', r => /\/CarDashboard\/lead$/.test(r.request().url()) ? r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE(notes) }) : r.abort());
      await page.clock.install({ time: new Date('2026-11-27T10:45:00-06:00').getTime() });
      await page.goto('https://crm.example.test/CarDashboard/lead', { waitUntil: 'domcontentloaded' });
      let res; try { res = await page.evaluate('(async()=>{' + scraper + '\n; return await inlineScraper();})()'); } catch (e) { res = { err: e.message }; }
      await ctx.close(); return res || {};
    };
    const col = (r) => [r.customerStatedColor || '', r.customerStatedColorPhrase || '', r.err || ''];
    console.log(' a color from an earlier lead, about another car:');
    check('lead 3122500487\'s shape: the July text on the older lead names no color for this lead', col(await scrape([NOW_NEW, OUT, RECEIVED, OLD])), ['', '', '']);
    check('the same July text with no lead start before it is still read (only an earlier lead is set aside), as the color they went with', col(await scrape([NOW_NEW, OUT, OLD])), ['white', 'glacier white', '']);
    console.log(' the color they went with:');
    check('on this lead, "was the matte black but ... so taking a glacier white" -> white ("glacier white"), not black',
      col(await scrape([IN('11/27/2026 8:20 AM', 'Was the matte black but had a mechanical issue with it so taking a glacier white.'), OUT, RECEIVED])), ['white', 'glacier white', '']);
    check('control: a color asked on this lead still counts ("Do you have one in black?")', col(await scrape([IN('11/27/2026 8:20 AM', 'Do you have one in black?'), OUT, RECEIVED])), ['black', 'black', '']);
  }
  await br.close();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
