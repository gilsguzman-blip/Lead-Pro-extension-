#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('email-expand-744.test.js');
// (v9.7.744) Community Kia Baytown lead 2086487722, 9/29 (log266). VinSolutions' notes panel shows an email only as a
// preview cut at a fixed length; our 4:25 email stopped at "...Community Value Price$31,000.00 Nitro Wheel Locks, D...",
// so the drive-out total and the two times we offered never reached the model. Across 24 page dumps on file, 85 of
// 146 of our emails and 13 of 37 of the customer's were cut this way. Each note carries the email's message id, the
// RecordID of the ViewEmail page VinSolutions opens on click; _lpExpandEmails fetches that page before the read and
// swaps the whole email in for the preview, and inlineScraper logs the outcome and puts every preview back.
// Runs the SHIPPED _lpExpandEmails and inlineScraper in Chromium against a placeholder lead page, with the ViewEmail
// requests answered by placeholder pages shaped like the real one. Placeholder data only.
//
// Usage: node tests/email-expand-744.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: email-expand-744.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

// One note in VinSolutions' own markup: header rows as <div>s, then the preview text.
const note = (id, dir, when, title, preview) =>
  '<span id="notes-and-history-item-' + id + '9" data-tags="Email-Communication" data-direction="' + dir + '" data-unique-identifier-type="AutoLeadMessageID" data-unique-identifier-value="' + id + '" class="notes-and-history-item list-group-item">'
  + '<div class="notes-and-hsitory-item-date">' + when + '</div><div class="notes-and-hsitory-item-detail"><div class="notes-and-history-item-header"><div class="legacy-notes-and-history-title">' + title + '</div></div>'
  + '<div class="notes-and-history-item-content"><div class="legacy-notes-and-history-item-extra-buttons">Subject: Test subject</div><div>By: Agent Name</div>' + preview + '</div></div></span>';
const LEAD = (notes) => '<html><body><div id="notes">' + notes.join('') + '</div></body></html>';
const CUT_OURS = note('100000001', 'Outbound', '09/29/2026 4:25 PM', 'Email reply to prospect',
  'Hi Test, Thanks for sending the link. The Sorento is Panthera Metal with a Gray interior. MSRP37,100 Community Value Price$31,000.00 Wheel Locks, D...');
const CUT_THEIRS = note('100000002', 'Inbound', '09/29/2026 4:37 PM', 'Email reply from prospect',
  'We are a bit off on the drive out price, is this your final price and can you also tell me whether the warranty coverage inclu...');
const WHOLE = note('100000003', 'Outbound', '09/29/2026 3:36 PM', 'Email reply to prospect', 'Test, White is not an interior option. FWD or AWD?');
const CUT_FAILS = note('100000004', 'Outbound', '09/28/2026 9:15 AM', 'Email reply to prospect',
  'Hi Test, following up on the Sorento and the numbers we went over together on the phone yesterday afte...');
const VIEW = (body) => '<html><body><table><tr><td class="datalabel">From:</td><td id="ContentPlaceHolder1__from">agent@example.com</td></tr></table><hr>'
  + '<div id="ContentPlaceHolder1__body" style="display: inline;"><style>.x{color:red}</style><div><br><br>' + body + '</div></div></body></html>';
const OURS_FULL = VIEW('Hi Test,<br>Thanks for sending the link. The Sorento is Panthera Metal with a Gray interior.<br><br><table>'
  + '<tr><td>MSRP</td><td>37,100</td></tr><tr><td>Community Value Price</td><td>$31,000.00</td></tr><tr><td>Wheel Locks, Door Guards</td><td>$624.00</td></tr>'
  + '<tr><td>Drive Out with all Incentives</td><td>$30,000.00</td></tr></table><br>Would 9:15 AM or 10:30 AM Wednesday work? Your visit should take about 30–45 minutes.<br><br>Agent Name<br>Test Store'
  + '<div><br>All Prices + Registration, certificate of title, or license fees, taxes, other fees or charges. By submitting my cell phone number to the Dealership, I agree to receive text messages.</div>');
const THEIRS_FULL = VIEW('We are a bit off on the drive out price, is this your final price and can you also tell me whether the warranty coverage includes the roadside plan?<br>Regards<br><br>From: Agent Name agent@example.com<br>Sent: Tuesday, September 29, 2026 4:25 PM<br>Subject: Saturday at 10 AM works, and the price is $29,000');
const CUT_MISMATCH = note('100000005', 'Inbound', '09/27/2026 2:00 PM', 'Email reply from prospect',
  'Hello, I wanted to ask one more thing about the trade appraisal you mentioned and whether the num...');
const OTHER_EMAIL = VIEW('This is a different email altogether, about a service appointment for another car.');

(async () => {
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }).catch(() => chromium.launch());
  for (const f of BUILDS) {
    console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
    const src = fs.readFileSync(f, 'utf8');
    const ea = src.indexOf('      function _lpExpandEmails() {'), eb = src.indexOf('} // end _lpExpandEmails');
    const expander = (ea >= 0 && eb > ea) ? src.slice(ea, eb + '} // end _lpExpandEmails'.length) : '';
    const sa = src.indexOf('  function inlineScraper() {'), sbx = src.indexOf('  } // end inlineScraper', sa);
    const scraper = src.slice(sa, sbx + 3);

    const run = async (notes) => {
      const page = await br.newPage(); const fetched = [];
      await page.route('**/*', r => {
        const u = r.request().url();
        if (/ViewEmail\.aspx/.test(u)) {
          const id = (u.match(/RecordID=(\d+)/) || [])[1]; fetched.push(id);
          if (id === '100000004') return r.fulfill({ status: 500, body: 'error' });
          return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: id === '100000001' ? OURS_FULL : id === '100000002' ? THEIRS_FULL : OTHER_EMAIL });
        }
        if (/\/CarDashboard\/lead$/.test(u)) return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: LEAD(notes) });
        return r.abort();
      });
      await page.goto('https://vinsolutions.example.test/CarDashboard/lead', { waitUntil: 'domcontentloaded' });
      const html0 = await page.evaluate(() => document.getElementById('notes').innerHTML);
      let expandErr = '';
      if (expander) await page.evaluate('(async()=>{' + expander + '\n; await _lpExpandEmails();})()').catch(e => { expandErr = e.message; });
      else expandErr = '_lpExpandEmails not in this build';
      const seen = await page.evaluate(() => Array.from(document.querySelectorAll('.notes-and-history-item-content')).map(c => c.innerText));
      let res = {};
      try { res = await page.evaluate('(()=>{' + scraper + '\n; return inlineScraper();})()'); } catch (e) { res = { err: e.message }; }
      await page.waitForTimeout(30);
      const html1 = await page.evaluate(() => document.getElementById('notes').innerHTML);
      await page.close();
      return { fetched, seen, diag: (res._lpDiag || []).filter(l => /EMAIL EXPAND/.test(l)), restored: html0 === html1, expandErr };
    };

    console.log(' 1. the cut-off emails are fetched and ours reads in full:');
    const r = await run([CUT_THEIRS, CUT_OURS, WHOLE, CUT_FAILS, CUT_MISMATCH]);
    check('only the cut-off emails are fetched, by their message id', r.fetched.slice().sort(), ['100000001', '100000002', '100000004', '100000005']);
    const ours = r.seen[1] || '';
    check('our email now carries the drive-out line and the times we offered, dashes kept as "-"', [/Drive Out with all Incentives \$30,000\.00/.test(ours), /9:15 AM or 10:30 AM Wednesday/.test(ours), /30-45 minutes/.test(ours)], [true, true, true]);
    check('...the header rows are kept, and the store footer and page styles are left out', [/Subject: Test subject/.test(ours), /By: Agent Name/.test(ours), /All Prices|By submitting|color:red/.test(ours)], [true, true, false]);

    console.log(' 2. anything that is not plainly the same email keeps its preview:');
    const theirs = r.seen[0] || '';
    check('the customer\'s email reads in full, and the thread quoted under it (our "Saturday", our "$29,000") is left out', [/includes the roadside plan\?/.test(theirs), /Saturday|29,000|Sent:/.test(theirs)], [true, false]);
    check('a fetched page holding a different email -> the preview stays', /whether the num\.\.\.$/.test((r.seen[4] || '').trim()), true);
    check('a failed fetch -> the preview stays', /yesterday afte\.\.\.$/.test((r.seen[3] || '').trim()), true);
    check('an email that was never cut is left alone', (r.seen[2] || '').indexOf('FWD or AWD?') >= 0, true);

    console.log(' 3. the read logs it and puts the panel back:');
    check('one diag line with the counts', r.diag.map(l => l.replace(/\| \d+ms$/, '')), ['[LP EMAIL EXPAND DIAG] cut-off email previews:4 | fetched:4 | expanded:2 | nothing more to add:0 | not the same email (kept preview):1 | failed (kept preview):1 (HTTP 500) ']);
    check('the grab\'s wait step runs it once the notes are there', /if \(bothReady\) \{ _lpExpandEmails\(\)\.then\(/.test(src), true);
    check('after the read the notes panel is exactly as VinSolutions drew it', r.restored, true);
    const none = await run([WHOLE]);
    check('control: no cut-off email -> nothing fetched, nothing logged, panel unchanged', [none.fetched.length, none.diag.length, none.restored, none.expandErr], [0, 0, true, expander ? '' : '_lpExpandEmails not in this build']);
  }
  await br.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
