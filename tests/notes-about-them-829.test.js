#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('notes-about-them-829.test.js');
// (v9.7.829) THE OTHER READERS OF THE CUSTOMER'S SITUATION READ OUR NOTES ABOUT THEM TOO. v9.7.828 taught the schedule reader that
// a connected call note reports the customer's words ("hes at work// call him after 3pm"); its header named three more readers that
// judged the customer's situation from their own messages only. Gil: "build 829". Now one definition, _lpNoteAboutThem (a connected
// or inbound call, or a general / appointment / showroom note about them), feeds: the schedule reader, the declined-alternative
// reader ("said he doesn't want the black one"), price pushback ("said the price is too high"), and a reschedule ("needs to
// reschedule"). Readers that ask whether THEY replied keep reading their messages only.
// Runs the SHIPPED inlineScraper in Chromium against placeholder lead pages. Placeholder data only.
//
// Usage: node tests/notes-about-them-829.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: notes-about-them-829.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
let id = 500000000;
const note = (dir, when, title, html) => { id++; return '<span id="notes-and-history-item-' + id + '" data-tags="x" data-direction="' + dir
  + '" data-unique-identifier-type="AutoLeadMessageID" data-unique-identifier-value="' + id + '" class="notes-and-history-item list-group-item">'
  + '<div class="notes-and-hsitory-item-date">' + when + '</div><div class="notes-and-hsitory-item-detail"><div class="notes-and-history-item-header">'
  + '<div class="legacy-notes-and-history-title">' + title + '</div></div><div class="notes-and-history-item-content">' + html + '</div></div></span>'; };
const PAGE = (notes) => '<html><body><div>Lead Info<br>Status:\tActive<br>Created:\t10/01/26 10:00a (25d)<br>Source:\tDealers WebSite</div><div id="notes">' + notes.join('') + '</div></body></html>';
const TXT_OUT = (when, body) => note('Outbound', when, 'Outbound Text Message', 'Sent to: (555) 010-0199<br>Sent by: Agent Name<br>' + body);
const TXT_IN = (when, body) => note('Inbound', when, 'Inbound Text Message', 'Received from: (555) 010-0199<br>Received by: Agent Name<br>' + body);
const CALL = (when, title, body) => note('Outbound', when, title, '<div>By: Rep Name</div>' + body);
const GEN = (when, body) => note('', when, 'General Note', '<div>By: Rep Name</div>' + body);
const LEADREC = note('Inbound', '10/01/2026 10:00 AM', 'Lead received', '<div>By: System</div>Interested in a 2027 Kia K5');
const BASE = [TXT_IN('10/20/2026 9:00 AM', 'Is the K5 still available?'), TXT_OUT('10/20/2026 9:05 AM', 'Test, we have a black 2027 K5 GT-Line here. Would you like to see it? Agent'), LEADREC];

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
      await page.clock.install({ time: new Date('2026-10-26T15:00:00-05:00').getTime() });
      await page.goto('https://crm.example.test/CarDashboard/lead', { waitUntil: 'domcontentloaded' });
      let res; try { res = await page.evaluate('(async()=>{' + scraper + '\n; return await inlineScraper();})()'); } catch (e) { res = { err: e.message }; }
      await ctx.close(); return res || {};
    };

    console.log(' 1. a declined alternative, said on a call:');
    const d1 = await scrape([CALL('10/26/2026 10:00 AM', 'Outbound phone call (Contacted)', 'said he doesn\'t want the black one, wants the gray K5'), ...BASE]);
    check('connected call "said he doesn\'t want the black one" -> a declined alternative', [d1.customerDeclinedAlternative, /black one/.test(d1.customerDeclinedAlternativeText || ''), d1.err || ''], [true, true, '']);
    const d2 = await scrape([TXT_IN('10/26/2026 10:00 AM', 'I don\'t want a car note above 400 a month'), ...BASE]);
    check('control: the third-person shape is for notes only -- "I don\'t want a car note above 400" from them is not a declined vehicle', d2.customerDeclinedAlternative, false);
    const d3 = await scrape([CALL('10/26/2026 10:00 AM', 'Outbound phone call (Machine)', 'Left message. He doesn\'t want the black one per last note'), ...BASE]);
    check('control: an unanswered call (Machine) is not their words', d3.customerDeclinedAlternative, false);

    console.log(' 2. price pushback, said on a call:');
    const p1 = await scrape([CALL('10/26/2026 10:00 AM', 'Outbound phone call (Contacted)', 'spoke with him, said the price is too high, wants to see numbers on the LX'), ...BASE]);
    check('connected call "said the price is too high" -> a negative reply (pricing)', p1.convState, 'negative-reply');
    const p2 = await scrape([CALL('10/26/2026 10:00 AM', 'Outbound phone call (Contacted)', 'spoke with him, he will come by Saturday'), ...BASE]);
    check('control: a call note with no pushback is not negative', p2.convState === 'negative-reply', false);

    console.log(' 3. a reschedule, said on a call:');
    const APPT = TXT_OUT('10/24/2026 9:00 AM', 'Quick reminder of our appointment Tuesday at 3 PM. Reply C to confirm. Agent');
    const r1 = await scrape([CALL('10/26/2026 10:00 AM', 'Outbound phone call (Contacted)', 'she said she can\'t make it Tuesday, needs to reschedule'), APPT, ...BASE]);
    check('connected call "she can\'t make it Tuesday, needs to reschedule" after a booked appointment -> a reschedule', [r1.customerRepliedReschedule, r1.hasMissedAppt, /A note says the customer needs to reschedule/.test(JSON.stringify(r1.apptTimeline || ''))], [true, true, true]);
    const r2 = await scrape([GEN('10/26/2026 10:00 AM', 'Need to reschedule my dentist, will follow up later'), APPT, ...BASE]);
    check('control: a note that is not about them is not their reschedule', !!r2.customerRepliedReschedule, false);

    console.log(' 4. the schedule reader uses the same definition (v9.7.828):');
    const s1 = await scrape([CALL('10/26/2026 10:00 AM', 'Outbound phone call (Contacted)', 'not a good time- hes at work// call him after 3pm'), ...BASE]);
    check('connected call "call him after 3pm" -> free after 3 PM', /^CUSTOMER ARRIVAL TIME: per a call note about them/.test(String(s1.customerScheduleConstraint || '')), true);
  }
  await br.close();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
