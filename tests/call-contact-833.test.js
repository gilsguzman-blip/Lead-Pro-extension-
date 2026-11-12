#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('call-contact-833.test.js');
// (v9.7.833) A CONNECTED CALL IS CONTACT, A PAUSE IS NOT AN EXIT, AND THE MODELS AND COLOR THEY NAMED LIMIT THE "OTHER OPTIONS".
// Toyota Baytown lead 2104784814 (log373, on v9.7.832): on 10/23 the customer said on a call that he would reach out if he liked the
// trade offer; on 10/27 the salesperson reached him again ("Outbound phone call (Contacted)": "Follow up this weekend"). The prompt
// opened "ZERO-CONTACT LEAD: this customer has not replied", the newest-note reader passed over the 10/27 call (no he/she in it) for
// the 10/23 note, and the pause took a 4-day-old lead to "PHASE 5 -- GRACEFUL CLOSE-OUT": every draft offered to close the file.
// Toyota Baytown lead 2082278892: the customer asked for a white Grand Highlander XLE AWD, "and possible a 4 runner"; the similar-
// vehicles angle supplied a Blueprint CPO Highlander Hybrid, and our text asked "Would that color work for you?" (the day's only 👎).
// Honda Baytown lead 2106268554: the Fullpath note was also stashed as "TOOL-SUPPLIED DEAL DATA ... do NOT quote them".
// Executes the shipped helpers, populateFromData and buildUserPrompt; the scraper part runs the shipped inlineScraper in Chromium.
// Placeholder data only.
//
// Usage: node tests/call-contact-833.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: call-contact-833.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const E = (date, time, tag, title, body) => '[' + date + ' ' + time + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = '[10/23/2026 4:04 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const CALL_1023 = E('10/23/2026', '4:09 PM', 'AGENT', 'Outbound phone call (Contacted)', 'By: Agent Name said that it was bad time to call but said that if the offer is good when he looks at it- he will reach out to us');
const NOTE_1023 = E('10/23/2026', '4:09 PM', 'NOTE', 'General Note', 'By: Agent Name Call connected- said that he was busy but once he looks at the offer, if he likes it, he will contact us back');
const CALL_1027 = E('10/27/2026', '12:05 PM', 'AGENT', 'Outbound phone call (Contacted)', 'By: Rep Name Follow up this weekend');
const TXT = (date, body) => E(date, '4:00 PM', 'AGENT', 'Outbound Text Message', body);
const OURS = TXT('10/26/2026', 'Test, just checking that your questions were answered.') + TXT('10/25/2026', 'Test, can you come in Monday at 10:00 AM?') + TXT('10/24/2026', 'Test, I am the one taking care of you.') + TXT('10/23/2026', 'Test, what vehicle are you shopping for?');
const MACHINE = E('10/26/2026', '9:00 AM', 'AGENT', 'Outbound phone call (No Contact)', 'By: Rep Name Na');

(async () => {
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }).catch(() => chromium.launch());
  for (const f of BUILDS) {
    console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
    let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
    const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
    const entries = (h) => run('_lpThreadEntries')(h);

    console.log(' 1. a connected call that records a conversation:');
    check('"Follow up this weekend" and the 10/23 call are conversations; "Na", "Left message", a silent pick-up and a missed call are not', () => {
      const t = run('_lpCallTalked'); if (typeof t !== 'function') return 'no _lpCallTalked';
      const one = (title, body) => t(entries(E('10/27/2026', '12:05 PM', 'AGENT', title, body))[0]);
      return [one('Outbound phone call (Contacted)', 'By: Rep Name Follow up this weekend'), entries(CALL_1023).map(t)[0],
        one('Outbound phone call (Contacted)', 'By: Rep Name Na'), one('Outbound phone call (Contacted)', 'By: Rep Name Left message'),
        one('Outbound phone call (Contacted)', 'By: Rep Name answered but did not say a word'), one('Outbound phone call (Machine)', 'By: Rep Name Follow up this weekend'),
        one('Outbound phone call (No Contact)', 'By: Rep Name will call back')]; },
      [true, true, false, false, false, false, false]);
    check('the newest event is the 10/27 call ("Follow up this weekend"), not the 10/23 note', () => {
      const n = run('_lpNewestNote')({ history: CALL_1027 + OURS + NOTE_1023 + CALL_1023 + MARK }); return n && [n.date, /Follow up this weekend/.test(n.body)]; }, ['10/27', true]);
    check('control: with only a no-contact call on 10/27, the 10/23 note stays the newest', () => {
      const n = run('_lpNewestNote')({ history: MACHINE + OURS + NOTE_1023 + CALL_1023 + MARK }); return n && n.date; }, '10/23');

    console.log(' 2. it is contact, not "ZERO-CONTACT":');
    const LEAD = (hist, x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '', condition: 'New',
      dealerId: '6189', store: 'Community Toyota Baytown', leadSource: 'Tradepending', convState: 'active-follow-up', leadAgeDays: 4, hasOutbound: true,
      hasCustomerReply: false, totalNoteCount: 20, isContacted: true, phone: '(555) 010-0199', email: 'test@example.com', relationshipSignals: { unansweredQuestions: [] },
      history: hist, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + hist + '---' }, x || {});
    const ctxOf = (d) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {};
      try { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(d); return String(run('leadContext')); } catch (e) { return 'THREW ' + e.message; } finally { sb.console.log = ol; sb.console.warn = ow; } };
    check('lead 2104784814: two connected calls -> no "ZERO-CONTACT LEAD" banner', () => /ZERO-CONTACT LEAD/.test(ctxOf(LEAD(CALL_1027 + OURS + NOTE_1023 + CALL_1023 + MARK))), false);
    check('control: no-contact calls only -> the banner stays', () => /ZERO-CONTACT LEAD/.test(ctxOf(LEAD(MACHINE + OURS + MARK))), true);
    check('control: a silent pick-up ("answered but did not say a word", the v9.7.430 case) -> the banner stays', () =>
      /ZERO-CONTACT LEAD/.test(ctxOf(LEAD(E('10/26/2026', '9:00 AM', 'AGENT', 'Outbound phone call (Contacted)', 'By: Rep Name answered but did not say a word') + OURS + MARK))), true);

    console.log(' 3. a pause does not skip the calendar to the close-out:');
    const rung = (extra) => {
      const c = OURS + OURS + MARK;
      const d = Object.assign({ agent: 'Agent Name', phone: '(555) 010-0199', email: 'test@example.com', name: 'Test Buyer', vehicle: '2026 Toyota Camry SE', leadSource: 'Cars.com',
        dealerId: '6189', store: 'Community Toyota Baytown', convState: 'active-follow-up', hasCustomerReply: false, hasOutbound: true, _isStalled: true, _neverReplied: true, leadAgeDays: 4,
        relationshipSignals: { totalOutboundCount: 8, consecutiveOutboundNoReply: 8, lastInboundAgeDays: null } }, extra || {});
      d.context = c; run('leadContext = ' + JSON.stringify(c) + ';'); sb.__logs.length = 0;
      const p = sb.__lp.buildUserPrompt(d); const m = p.match(/STALLED LEAD RE-ENGAGEMENT -- (PHASE \d)/); return m ? m[1] : null; };
    check('a 4-day-old lead with a pause and 8 touches -> the calendar rung (PHASE 2), not PHASE 5', () => rung({ hasPauseSignal: true, convState: 'pause' }), 'PHASE 2');
    check('control: an exit on the same lead still reaches PHASE 5', () => rung({ hasExitSignal: true }), 'PHASE 5');

    console.log(' 4. the "other options" respect the models and the color they named:');
    const GH = '2026 Toyota Grand Highlander LE AWD';
    const INV = { units: [
      { vehicle: '2026 Toyota Highlander Hybrid XLE', color: 'Blueprint', stock: 'TEST01', stockNum: 'TEST01', condition: 'Used', certified: true, price: 48000, type: 'CPO' },
      { vehicle: '2026 Toyota 4Runner TRD Off-Road 4WD', color: 'Ice Cap', stock: 'TEST02', stockNum: 'TEST02', condition: 'New', price: 52000, type: 'New' }] };   // no Grand Highlander in stock, as on the lead
    run('_lpValueFactCache')['6189'] = { inv: INV, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, ttlMs: 600000 };
    const SAID = E('10/09/2026', '4:09 PM', 'CUSTOMER', 'Inbound Text Message', 'I\'m interested in grand Highlander and possible a 4 runner. I would really like a white color');
    const GHLEAD = (hist, x) => LEAD(hist, Object.assign({ vehicle: GH, leadSource: 'Toyota.Com-Kbb Trade-In', convState: 'active-follow-up', leadAgeDays: 46, hasCustomerReply: true }, x || {}));
    const simLine = (ctx) => (ctx.split('\n').find(l => /SIMILAR VEHICLES IN STOCK/.test(l)) || '');
    const named = ctxOf(GHLEAD(OURS + SAID + MARK, { customerStatedColor: 'white' }));
    const plain = ctxOf(GHLEAD(OURS + E('10/09/2026', '4:09 PM', 'CUSTOMER', 'Inbound Text Message', 'Is it still available?') + MARK));
    check('control first: with nothing named, the similar-vehicles list offers the Highlander Hybrid (the comparable this lead got)', () => /Highlander Hybrid/.test(simLine(plain)), true);
    check('lead 2082278892: they named the Grand Highlander and the 4Runner -> no Highlander Hybrid among the "other options"', () => /Highlander Hybrid/.test(simLine(named)), false);
    check('the color they asked for travels with the list: "THEY ASKED FOR WHITE ... never ask whether a different color would work"', () => {
      const l = simLine(ctxOf(GHLEAD(OURS + E('10/09/2026', '4:09 PM', 'CUSTOMER', 'Inbound Text Message', 'Is it still available?') + MARK, { customerStatedColor: 'white' })));
      return [/THEY ASKED FOR WHITE: name a unit from this list only if its paint is white/.test(l), /never ask whether a different color would work/.test(l)]; }, [true, true]);
    check('control: no stated color -> no color clause', () => /THEY ASKED FOR/.test(simLine(plain)), false);

    console.log(' 5. the shipped scraper: a Fullpath note is not "tool-supplied deal data":');
    const sa = src.indexOf('  function inlineScraper() {'), sbx = src.indexOf('  } // end inlineScraper', sa);
    const scraper = src.slice(sa, sbx + 3);
    let id = 530000000;
    const note = (dir, when, title, html) => { id++; return '<span id="notes-and-history-item-' + id + '" data-tags="x" data-direction="' + dir
      + '" data-unique-identifier-type="AutoLeadMessageID" data-unique-identifier-value="' + id + '" class="notes-and-history-item list-group-item">'
      + '<div class="notes-and-hsitory-item-date">' + when + '</div><div class="notes-and-hsitory-item-detail"><div class="notes-and-history-item-header">'
      + '<div class="legacy-notes-and-history-title">' + title + '</div></div><div class="notes-and-history-item-content">' + html + '</div></div></span>'; };
    const PAGE = (notes) => '<html><body><div>Lead Info<br>Status:\tActive<br>Created:\t10/27/26 1:29p (0d)<br>Source:\tFullPath</div><div id="notes">' + notes.join('') + '</div></body></html>';
    const FP = note('Inbound', '10/27/2026 1:29 PM', 'Lead received', '<div>By: System</div>CONVERTED ON: Nurture Landing Page 2025 Honda Accord Sedan (VIN 1HGCY1F2TEST00001) $24,804<br>Lead Details: Click here to view complete lead information ( <a href="#">dashboard.fullpath.com%2fleads...</a> )<br>Vehicles viewed: Status: used, Make: Honda, Model: Accord LX, Year: 2025, Page-Views: 2<br>Page converted on: Used Certified 2025 Honda Accord LX in Baytown, TX - Community Honda ( <a href="#">www.example.com%2faut...</a> )');
    const scrape = async (notes) => {
      const ctx = await br.newContext({ timezoneId: 'America/Chicago' }); const page = await ctx.newPage();
      await page.route('**/*', r => /\/CarDashboard\/lead$/.test(r.request().url()) ? r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE(notes) }) : r.abort());
      await page.clock.install({ time: new Date('2026-10-27T14:30:00-05:00').getTime() });
      await page.goto('https://crm.example.test/CarDashboard/lead', { waitUntil: 'domcontentloaded' });
      let res; try { res = await page.evaluate('(async()=>{' + scraper + '\n; return await inlineScraper();})()'); } catch (e) { res = { err: e.message }; }
      await ctx.close(); return res || {};
    };
    const s1 = await scrape([note('Outbound', '10/27/2026 2:23 PM', 'Outbound Text Message', 'Sent to: (555) 010-0199<br>Sent by: Agent Name<br>Test, the Accord LX is here.'), FP]);
    check('lead 2106268554: the Fullpath note is kept for _lpFullpath and not wrapped as "TOOL-SUPPLIED DEAL DATA ... do NOT quote them"', () =>
      [/CONVERTED ON/.test(String(s1.fullpathConversion || '')), /TOOL-SUPPLIED DEAL DATA/.test(String(s1.conversationBrief || '') + String(s1.history || '')), s1.err || ''], [true, false, '']);
  }
  await br.close();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
