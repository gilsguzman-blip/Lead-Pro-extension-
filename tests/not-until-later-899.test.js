#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('not-until-later-899.test.js');
// (v9.7.899) THEY CANNOT COME IN UNTIL NEXT WEEK. Honda Lafayette lead 3122545541 (KBB ICO, 11/27, log433): a connected call note said
// "he said they might be interested in upgrading their vehicle wouldn't be able to come out until possibly sometime next week for an
// appraisal", and the draft offered two times today. Part 1 runs the SHIPPED inlineScraper in Chromium on placeholder pages; part 2
// builds the prompt. Placeholder data only.
//
// Usage: node tests/not-until-later-899.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const { chromium } = require('playwright');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: not-until-later-899.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
let id = 580000000;
const note = (dir, when, title, html) => { id++; return '<span id="notes-and-history-item-' + id + '" data-tags="x" data-direction="' + dir
  + '" data-unique-identifier-type="AutoLeadMessageID" data-unique-identifier-value="' + id + '" class="notes-and-history-item list-group-item">'
  + '<div class="notes-and-hsitory-item-date">' + when + '</div><div class="notes-and-hsitory-item-detail"><div class="notes-and-history-item-header">'
  + '<div class="legacy-notes-and-history-title">' + title + '</div></div><div class="notes-and-history-item-content">' + html + '</div></div></span>'; };
const PAGE = (notes) => '<html><body><div>Lead Info<br>Status:\tActive<br>Created:\t11/27/26 7:47a (0d)<br>Source:\tKbb Ico Kelley Blue Book</div><div id="notes">' + notes.join('') + '</div></body></html>';
const CALL = (text) => note('Outbound', '11/27/2026 11:15 AM', 'Outbound phone call (Contacted)', '<div>By: Agent Name</div><div>' + text + '</div>');
const RECEIVED = note('Inbound', '11/27/2026 7:47 AM', 'Lead received', '<div>By: System</div><div>Kelley Blue Book Instant Cash Offer.</div>');
const CT = (y, mo, d, h, mi) => { const guess = Date.UTC(y, mo - 1, d, h + 6, mi); const off = (new Date(guess).toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }) | 0) - h; return guess - off * 3600000; };
const NOW = CT(2026, 11, 27, 11, 20);
const E = (day, clock, tag, title, body) => '[' + day + ' ' + clock + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const H = E('11/27/2026', '11:15 AM', 'CALL NOTE', 'Outbound phone call (Contacted)', 'By: Agent Name he said they might be interested in upgrading their vehicle wouldn\'t be able to come out until possibly sometime next week for an appraisal')
  + '[11/27/2026 7:47 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const LEAD = (x) => Object.assign({ name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Agent Name', vehicle: '', condition: '', dealerId: '24399',
  store: 'Community Honda Lafayette', leadSource: 'Kbb Ico Kelley Blue Book', convState: 'call-followup', leadAgeDays: 0, hasOutbound: true, hasCustomerReply: false, totalNoteCount: 4,
  phone: '(555) 010-0199', email: 'test@example.com', customerZip: '12345', relationshipSignals: { unansweredQuestions: [] }, conversationBrief: H, history: H, context: '', autoLeadId: 'TEST017S', outboundSends: [] }, x || {});
const LATER = 'NOT UNTIL LATER: next week | our call note | he said they might be interested in upgrading their vehicle wouldn\'t be able to come out until possibly sometime next week for an appraisal';

(async () => {
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }).catch(() => chromium.launch());
  for (const f of BUILDS) {
    console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
    let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
    const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
    console.log(' 1. the shipped scraper reads "until next week" in a connected call note:');
    const sa = src.indexOf('  function inlineScraper() {'), sbx = src.indexOf('  } // end inlineScraper', sa);
    const scraper = src.slice(sa, sbx + 3);
    const scrape = async (notes) => {
      const ctx = await br.newContext({ timezoneId: 'America/Chicago' }); const page = await ctx.newPage();
      await page.route('**/*', r => /\/CarDashboard\/lead$/.test(r.request().url()) ? r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE(notes) }) : r.abort());
      await page.clock.install({ time: new Date('2026-11-27T11:20:00-06:00').getTime() });
      await page.goto('https://crm.example.test/CarDashboard/lead', { waitUntil: 'domcontentloaded' });
      let res; try { res = await page.evaluate('(async()=>{' + scraper + '\n; return await inlineScraper();})()'); } catch (e) { res = { err: e.message }; }
      await ctx.close(); return res || {};
    };
    const s1 = await scrape([CALL('he said they might be interested in upgrading their vehicle wouldn\'t be able to come out until possibly sometime next week for an appraisal'), RECEIVED]);
    check('lead 3122545541\'s shape: "wouldn\'t be able to come out until possibly sometime next week" -> not until next week, and not today', () =>
      [String(s1.customerScheduleConstraint || '').slice(0, 45), !!s1.customerSaidNotToday, s1.err || ''], ['NOT UNTIL LATER: next week | our call note | ', true, '']);
    const s2 = await scrape([CALL('he said he can come by today after work to look at the Pilot'), RECEIVED]);
    check('control: a call note with no later date -> no such constraint', () => /NOT UNTIL LATER/.test(String(s2.customerScheduleConstraint || '')), false);

    console.log(' 2. the prompt holds the visit until then, over the first-touch two times:');
    vm.runInContext('(function(){ var RD = Date, FIX = ' + NOW + '; function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); } FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; Date = FD; })()', sb);
    const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
    const prompt = (d) => quiet(() => { run('activeFlags = new Set(); leadContext = ""; window._lpAddApptLeadId = "";'); sb.__L = d; run('lastScrapedData = globalThis.__L;'); sb.populateFromData(d);
      return String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: d, context: String(run('leadContext') || '') }))); });
    const p = prompt(LEAD({ customerScheduleConstraint: LATER, customerSaidNotToday: true }));
    check('the prompt says they cannot come in until next week: no time before then, ask which day next week works', () =>
      /THEY CANNOT COME IN UNTIL NEXT WEEK \(our call note: [^\n]*No appointment time before then: not today, not tomorrow, nothing this week, and no same-day push\.[^\n]*ask which day next week works best for them -- no clock times\./.test(p), true);
    check('the visit decision belongs to it (no specific times), and no two-times close is left', () =>
      [/VISIT DECISION FOR THIS MESSAGE: no specific appointment times and no same-day push in this message; invite them in only as that instruction allows -- their EARLIEST DAY \(they cannot come in until later\) owns this\./.test(p),
       /close with two specific appointment times/.test(p), /SUGGESTED APPOINTMENT TIMES \(fallback only/.test(p)], [true, false, false]);
    check('the Add Appt chip does not override it (a hard hold)', () => run('_LP_VISIT_HARD').indexOf('their EARLIEST DAY (they cannot come in until later)') >= 0, true);
  }
  await br.close();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
