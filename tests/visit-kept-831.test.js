#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('visit-kept-831.test.js');
// (v9.7.831) A STAFF NOTE OF THE VISIT ENDS THE APPOINTMENT, AND ITS DAY IS THE CUSTOMER'S. Lead 2104004243: a reminder and a
// connected call ("appt. confirmed for today at 6:30pm"), then a 7:41 PM General Note -- "Showed / Test drove the 2026 Sorento ...
// talking about coming back in on Friday". Two readers missed it on v9.7.830:
//   1. Only a "Showroom Visit" entry counted as a visit, so the 6:30 appointment stayed live and the LIVE APPOINTMENT block owned
//      the visit decision the next day. _lpVisitNote now reads a staff note that records the visit (past tense only).
//   2. The day-lock comprehension probe was told every entry was "a message the customer sent" and that a day in "an agent note"
//      never counts, so it removed the Friday the note reported. Notes about the customer now reach it tagged as staff notes,
//      with a rule that a day the CUSTOMER gave counts and a day the staff member plans for themselves does not.
// Part A runs the SHIPPED inlineScraper in Chromium against placeholder lead pages; part B runs the shipped probe builder and
// fact-input assembly. Placeholder data only.
//
// Usage: node tests/visit-kept-831.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: visit-kept-831.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
let id = 510000000;
const note = (dir, when, title, html) => { id++; return '<span id="notes-and-history-item-' + id + '" data-tags="x" data-direction="' + dir
  + '" data-unique-identifier-type="AutoLeadMessageID" data-unique-identifier-value="' + id + '" class="notes-and-history-item list-group-item">'
  + '<div class="notes-and-hsitory-item-date">' + when + '</div><div class="notes-and-hsitory-item-detail"><div class="notes-and-history-item-header">'
  + '<div class="legacy-notes-and-history-title">' + title + '</div></div><div class="notes-and-history-item-content">' + html + '</div></div></span>'; };
const PAGE = (notes) => '<html><body><div>Lead Info<br>Status:\tActive<br>Created:\t10/21/26 10:00a (6d)<br>Source:\tDealers WebSite</div><div id="notes">' + notes.join('') + '</div></body></html>';
const TXT_OUT = (when, body) => note('Outbound', when, 'Outbound Text Message', 'Sent to: (555) 010-0199<br>Sent by: Agent Name<br>' + body);
const TXT_IN = (when, body) => note('Inbound', when, 'Inbound Text Message', 'Received from: (555) 010-0199<br>Received by: Agent Name<br>' + body);
const CALL = (when, title, body) => note('Outbound', when, title, '<div>By: Rep Name</div>' + body);
const GEN = (when, body) => note('', when, 'General Note', '<div>By: Rep Name</div>' + body);
const LEADREC = note('Inbound', '10/21/2026 10:00 AM', 'Lead received', '<div>By: System</div>Interested in a 2026 Kia Sorento');
// Newest first, as the CRM renders them.
const ARC = [
  TXT_IN('10/26/2026 6:28 PM', 'Headed your way'),
  CALL('10/26/2026 3:18 PM', 'Outbound phone call (Contacted)', 'appt. confirmed for today at 6:30pm'),
  TXT_OUT('10/26/2026 9:00 AM', 'Test quick reminder of our appointment on Monday, October 26, 2026 at 6:30 PM. Please reply C to confirm. Agent'),
  TXT_IN('10/22/2026 11:00 AM', 'Is the Sorento still available?'),
  TXT_OUT('10/22/2026 10:30 AM', 'Test, the 2026 Sorento S is here. Would you like to see it? Agent'),
  LEADREC];
const VISIT = GEN('10/26/2026 7:41 PM', 'Showed / Test drove the 2026 Sorento (CPO) - Black #TEST001A Showed numbers - talking about coming back in on Friday Follow up with customer');

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
      await page.clock.install({ time: new Date('2026-10-27T16:47:00-05:00').getTime() });
      await page.goto('https://crm.example.test/CarDashboard/lead', { waitUntil: 'domcontentloaded' });
      let res; try { res = await page.evaluate('(async()=>{' + scraper + '\n; return await inlineScraper();})()'); } catch (e) { res = { err: e.message }; }
      await ctx.close(); return res || {};
    };
    const kept = (d) => /Appointment kept/.test(JSON.stringify(d.apptTimeline || ''));

    console.log(' A1. the visit note ends the appointment it followed:');
    const a1 = await scrape([VISIT, ...ARC]);
    check('"Showed / Test drove ..." at 7:41 PM after the 6:30 PM appointment -> not a live appointment, recorded as kept',
      [a1.hasApptSet, kept(a1), a1.err || ''], [false, true, '']);
    const a1n = (a1.schedCustomerNotes || []).filter(n => /coming back in on Friday/.test(n.text || ''));
    check('the visit note reaches the day-lock probe input marked as a note about them', [a1n.length, a1n.length ? a1n[0].about : null], [1, true]);

    console.log(' A2. controls -- the appointment stays live:');
    const a2 = await scrape(ARC);
    check('control: no visit note -> the 6:30 PM appointment is still the one on the books', [a2.hasApptSet, kept(a2)], [true, false]);
    const a3 = await scrape([GEN('10/26/2026 7:41 PM', 'No show. Will call him Friday to reschedule'), ...ARC]);
    check('control: "No show. Will call him Friday" is not a visit', kept(a3), false);
    const a4 = await scrape([GEN('10/26/2026 7:41 PM', 'Customer wants to test drive the Sorento before deciding'), ...ARC]);
    check('control: "wants to test drive" is a plan, not a visit', kept(a4), false);
    const a5 = await scrape([GEN('10/25/2026 7:41 PM', 'Showed / test drove the Telluride, thinking it over'), ...ARC]);
    check('control: a visit BEFORE the appointment was booked does not end it', [a5.hasApptSet, kept(a5)], [true, false]);
    const a6 = await scrape(ARC.slice(0, 2).concat([note('', '10/26/2026 7:41 PM', 'General Note', '<div>By: Rep Name</div>Lead came in on the Sorento, sent pricing')]).concat(ARC.slice(2)));
    check('control: "lead came in" is not the customer coming in', kept(a6), false);

    console.log(' B. the day-lock probe reads a staff note as a report of the customer\'s words:');
    const ctx = vm.createContext({});
    const lift = (startRx, endMarker) => { const m = src.match(startRx); if (!m) return ''; const a = m.index; const e = src.indexOf(endMarker, a); return src.slice(a, e); };
    let ok = true;
    try {
      vm.runInContext(lift(/^var LP_FACT_IDS = /m, '\n') + '\n'
        + (src.match(/^var LP_STAFF_NOTE_TAG = [^\n]+/m) || [''])[0] + '\n'
        + lift(/^function _lpVerifyCommitQuote\(/m, '\n}\n') + '\n}\n'
        + lift(/^function _lpBuildDayLockProbe\(/m, '\n}\n') + '\n}\n'
        + lift(/^function _lpBuildFactInputs\(/m, '\n}\n') + '\n}\n', ctx);
    } catch (e) { ok = false; console.log('  (lift failed: ' + e.message + ')'); }
    const run = (expr) => { try { return vm.runInContext(expr, ctx); } catch (e) { return 'ERR ' + e.message; } };
    ctx.SN = [{ text: 'Headed your way', about: false },
              { text: 'Showed / Test drove the 2026 Sorento (CPO) - talking about coming back in on Friday Follow up with customer', about: true }];
    const inp = run('_lpBuildFactInputs({ schedCustomerNotes: SN }, {})["day-lock"].notes');
    check('fact inputs: the customer\'s own text is unchanged; the note about them carries the staff-note tag',
      [Array.isArray(inp) && inp[0], Array.isArray(inp) && /^\(A NOTE OUR STAFF WROTE ABOUT THE CUSTOMER\) Showed/.test(inp[1])], ['Headed your way', true]);
    ctx.INP = inp;
    const prompt = String(run('_lpBuildDayLockProbe(INP)'));
    check('probe prompt says some entries are staff notes and lets a day the customer gave count ("talking about coming back in on Friday")',
      [/notes our staff wrote about what the customer told them/.test(prompt), /AN ENTRY MARKED AS A STAFF NOTE/.test(prompt), /talking about coming back in on Friday/.test(prompt)], [true, true, true]);
    check('probe prompt: a day the staff member plans for themselves ("follow up Friday", "will call him Monday") does not count',
      /A day the STAFF MEMBER plans for themselves \("will call him Monday", "follow up Friday"/.test(prompt), true);
    const plain = String(run('_lpBuildDayLockProbe(["I can come Saturday"])'));
    check('control: with no staff notes the probe prompt is the customer-only wording it was',
      [/^Below are messages a car dealership customer sent\. Decide/.test(plain), /STAFF NOTE/.test(plain)], [true, false]);
    check('quote verification: the note\'s words verify; the tag alone does not',
      [run('_lpVerifyCommitQuote("talking about coming back in on Friday", INP)'), run('_lpVerifyCommitQuote("A NOTE OUR STAFF WROTE", INP)')], [2, 0]);
    if (!ok) { fail++; console.log('  FAIL lift'); }
  }
  await br.close();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
