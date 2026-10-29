#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('click-path-835.test.js');
// (v9.7.835) WHAT A WEBSITE SHOPPER WAS LOOKING AT WHEN THEY ASKED, AND NO VISIT ASK IN A TEXT WHEN THE PROMPT DECIDED ON NONE.
// Honda Lafayette lead 2106212974 (log377): a Contact Us form whose only words were "still on the lot?", no vehicle on the lead
// ("2026 Honda Any/All"), and three of our emails asking him to send the model or a link -- the draft asked a fourth time. The
// received note links the store site's click path: Homepage -> New Honda Accord Sedan (search) -> Contact Us -> this lead. The
// proxy (v7.90 /clickpath) reads it; the extension now captures the link, fetches it at generate time, and the prompt answers about
// that car without saying how it knows. Second: Audi Lafayette lead 2107090639 (waiting on the sales team) -- the email gave room,
// the text asked "What day and time would work for you to come in?"; the rewrite was told to give "the reason this visit is worth
// making" on every lead. Part 1 runs the SHIPPED inlineScraper in Chromium; the rest executes the shipped popup code.
// Placeholder data only.
//
// Usage: node tests/click-path-835.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const CP = require('./helpers/clickpath-page.js');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: click-path-835.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
// The proxy's answer for the placeholder page (what v7.90 returns for it).
const SESSIONS = { ok: true, lead: '100000002', sessions: [
  { date: 'Thursday, October 08, 2026', range: '', leads: ['100000001'], current: false, pages: [], vehicles: [{ kind: 'unit', name: 'New 2027 Honda HR-V', stock: 'TEST001A', dwell: '2m 13s' }] },
  { date: 'Tuesday, October 27, 2026', range: '', leads: ['100000002'], current: true, pages: [], vehicles: [{ kind: 'model', name: 'New Honda Accord Sedan', dwell: '3m 14s' }] },
  { date: 'Thursday, October 29, 2026', range: '', leads: ['100000003'], current: false, pages: [], vehicles: [{ kind: 'model', name: 'New Honda CR-V', dwell: '2m 45s' }] }] };
const E = (date, time, tag, title, body) => '[' + date + ' ' + time + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = '[10/27/2026 11:08 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const OURS = E('10/29/2026', '11:20 AM', 'AGENT', 'Email reply to prospect', 'Test, the specific vehicle did not come through with your inquiry. Could you send me the model or a link to the listing? Agent Name')
  + E('10/27/2026', '11:19 AM', 'AGENT', 'Email reply to prospect', 'Test, send me the model or a link to the listing and I will check on it. Agent Name');
const LEAD = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', vehicle: '', condition: 'Pre-Owned',
  dealerId: '24399', store: 'Community Honda Lafayette', leadSource: 'Lafayette - Contact Us', convState: 'active-follow-up', leadAgeDays: 2, hasOutbound: true,
  hasCustomerReply: false, totalNoteCount: 14, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: 'still on the lot?',
  pdPresent: true, pdHasLeadVehicle: false, pdVoiCount: 0, relationshipSignals: { unansweredQuestions: [] },
  history: OURS + MARK, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + OURS + MARK + '---' }, x || {});
const INV = { units: [{ vehicle: '2026 Honda Accord Sedan SE', color: 'Platinum White Pearl', stock: 'TEST0A1', stockNum: 'TEST0A1', condition: 'new', type: 'New' },
  { vehicle: '2026 Honda Accord Sedan LX', color: 'Crystal Black Pearl', stock: 'TEST0A2', stockNum: 'TEST0A2', condition: 'new', type: 'New' },
  { vehicle: '2022 Honda Accord Sedan EX', color: 'Lunar Silver Metallic', stock: 'TEST0A3', stockNum: 'TEST0A3', condition: 'used', type: 'Used' }] };

let id = 540000000;
const note = (dir, when, title, html) => { id++; return '<span id="notes-and-history-item-' + id + '" data-tags="x" data-direction="' + dir
  + '" data-unique-identifier-type="AutoLeadMessageID" data-unique-identifier-value="' + id + '" class="notes-and-history-item list-group-item">'
  + '<div class="notes-and-hsitory-item-date">' + when + '</div><div class="notes-and-hsitory-item-detail"><div class="notes-and-history-item-header">'
  + '<div class="legacy-notes-and-history-title">' + title + '</div></div><div class="notes-and-history-item-content">' + html + '</div></div></span>'; };
const PAGE = (notes) => '<html><body><div>Lead Info<br>Status:\tActive<br>Created:\t10/27/26 11:08a (2d)<br>Source:\tLafayette - Contact Us</div><div id="notes">' + notes.join('') + '</div></body></html>';
const RECEIVED = (link) => note('Inbound', '10/27/2026 11:08 AM', 'Lead received', '<div>By: System</div><div><div class="adf_email_show">Click Path: '
  + (link ? '<a target="_blank" href="' + link + '">www.example-honda.co...</a>' : '') + '<br>Return Shopper Info: <a href="https://dashboard.example.test/x">dashboard.example.test%2...</a><br>still on the lot?<br>Preferred Contact Method*: Email</div></div>');

(async () => {
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }).catch(() => chromium.launch());
  for (const f of BUILDS) {
    console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
    let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
    const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };

    console.log(' 1. the shipped scraper keeps the click path link:');
    const sa = src.indexOf('  function inlineScraper() {'), sbx = src.indexOf('  } // end inlineScraper', sa);
    const scraper = src.slice(sa, sbx + 3);
    const scrape = async (notes) => {
      const ctx = await br.newContext({ timezoneId: 'America/Chicago' }); const page = await ctx.newPage();
      await page.route('**/*', r => /\/CarDashboard\/lead$/.test(r.request().url()) ? r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE(notes) }) : r.abort());
      await page.clock.install({ time: new Date('2026-10-29T15:30:00-05:00').getTime() });
      await page.goto('https://crm.example.test/CarDashboard/lead', { waitUntil: 'domcontentloaded' });
      let res; try { res = await page.evaluate('(async()=>{' + scraper + '\n; return await inlineScraper();})()'); } catch (e) { res = { err: e.message }; }
      await ctx.close(); return res || {};
    };
    const s1 = await scrape([RECEIVED(CP.URL)]);
    check('lead 2106212974: the received note\'s Click Path link is carried as clickPathUrl', () => [s1.clickPathUrl, s1.err || ''], [CP.URL, '']);
    const s2 = await scrape([RECEIVED('https://www.example-honda.com/some/other/page/1')]);
    check('a link that is not a click path page is not carried (the field stays empty)', () => s2.clickPathUrl, '');

    console.log(' 2. the click path is fetched from the proxy at generate time:');
    const fetched = [];
    sb.fetch = (u) => { fetched.push(String(u)); return Promise.resolve({ ok: true, json: () => Promise.resolve(SESSIONS) }); };
    run('window._leadProWorkerBase = "https://proxy.example.test";');
    await acheck('it asks the proxy\'s /clickpath for this link and returns the sessions', async () => {
      const v = await run('_lpLoadClickPath')({ clickPathUrl: CP.URL });
      return [fetched.length, /\/clickpath\?u=https%3A%2F%2Fwww\.example-honda\.com%2Fresrc%2Fleadinfo%2Fclickpath%2F100000002$/.test(fetched[0] || ''), v && v.sessions.length]; }, [1, true, 3]);
    await acheck('a second generate on the same link reuses it (no second call); a lead with no link asks for nothing', async () => {
      await run('_lpLoadClickPath')({ clickPathUrl: CP.URL }); const n = await run('_lpLoadClickPath')({ clickPathUrl: '' }); return [fetched.length, n]; }, [1, null]);

    console.log(' 3. the prompt answers about what they were looking at:');
    run('_lpValueFactCache')['24399'] = { inv: INV, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, ttlMs: 600000 };
    const built = (d) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {};
      try { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(d); const ctx = run('leadContext');
        return String(sb.__lp.buildUserPrompt(Object.assign({}, d, { context: ctx }))); } catch (e) { return 'THREW ' + e.message; } finally { sb.console.log = ol; sb.console.warn = ow; } };
    const p = built(LEAD({ clickPath: SESSIONS }));
    check('WHAT THEY WERE LOOKING AT: the new Accord Sedan search page, their "still on the lot?" is about that, and what we have of it new', () =>
      [/WHAT THEY WERE LOOKING AT ON OUR WEBSITE WHEN THEY SENT THIS/.test(p),
       /^- Right before they sent it \(Tuesday, October 27, 2026\), they were on our New Honda Accord Sedan listings \(a search page, not one car\)\. Their message \("still on the lot\?"\) is about that\.$/m.test(p),
       /^- New Honda Accord Sedan: 2 in our current inventory, e\.g\. 2026 Honda Accord Sedan SE in Platinum White Pearl; 2026 Honda Accord Sedan LX in Crystal Black Pearl\.$/m.test(p)], [true, true, true]);
    check('it never says how we know, and does not ask what they want; the Pre-Owned condition field gives way to the page', () =>
      [/NEVER say or imply that you saw what they looked at, browsed or clicked/.test(p), /Do NOT ask what vehicle they are looking for: this is it/.test(p),
       /The lead's condition field says Pre-Owned; the page they were on was new\. Go by the page\./.test(p)], [true, true, true]);
    check('the newer visit is there too: back on 10/29 looking at the new CR-V, with another inquiry', () =>
      /^- Since then \(Thursday, October 29, 2026\) they were back on our site looking at our New Honda CR-V listings \(a search page, not one car\), and sent another inquiry\./m.test(p), true);
    check('the no-vehicle lines give way: the Vehicle line and the never-invent rule name it; no "NO VEHICLE IS ATTACHED"', () =>
      [/^Vehicle:\s+\(none on file\) ← what they were looking at when they sent this: New Honda Accord Sedan/m.test(p), /^- NEVER mention a specific vehicle[^\n]*the store website shows what they were looking at when they wrote \(New Honda Accord Sedan\)/m.test(p),
       /NO VEHICLE IS ATTACHED/.test(p)], [true, true, false]);
    const p0 = built(LEAD());
    check('control: with no click path the prompt is as before (no block, the no-vehicle line stays)', () => [/WHAT THEY WERE LOOKING AT/.test(p0), /NO VEHICLE IS ATTACHED/.test(p0)], [false, true]);
    check('a vehicle details page names the unit and checks it against stock: TEST001A is not in the feed -> do not say it is here', () => {
      const one = { ok: true, sessions: [{ date: 'Today', current: true, leads: ['1'], vehicles: [{ kind: 'unit', name: 'New 2027 Honda HR-V', stock: 'TEST001A' }] }] };
      const l = run('_lpClickPathLines')(LEAD({ clickPath: one })).join('\n');
      return [/they were on the New 2027 Honda HR-V \(stock TEST001A\)/.test(l), /NOT in our current inventory feed -- do not say it is here/.test(l)]; }, [true, true]);

    console.log(' 4. no visit ask in a text when the prompt decided on none:');
    const RP = (lv) => { run('_lpLastVisitDecision = ' + JSON.stringify(lv) + ';'); const ol = sb.console.log; sb.console.log = () => {};
      try { return run('_lpBuildSmsRefinePrompt')('Test, pass one.', 'Hi Test,\n\nBrittney will follow up with the details.\n\nAgent Name', LEAD()); } finally { sb.console.log = ol; } };
    const r3 = RP({ level: 3, owner: 'the PAUSE rule (not ready)' }), r0 = RP({ level: 0, owner: '' });
    check('level 3: the rewrite is told no visit ask and no time, and is not told to give "the reason this visit is worth making"', () =>
      [/This message makes NO visit ask and offers NO time \(the PAUSE rule \(not ready\)\)/.test(r3), /the actual reason this visit is worth making/.test(r3)], [true, false]);
    check('control: with no hold the rewrite keeps "the actual reason this visit is worth making"', () => [/the actual reason this visit is worth making/.test(r0), /makes NO visit ask/.test(r0)], [true, false]);
    const refine = async (lv, pass1, reply) => { const logs = []; sb.__reply = reply; sb.__d = LEAD();
      run('_lpLastVisitDecision = ' + JSON.stringify(lv) + '; window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Community Honda Lafayette" };'
        + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpAddApptLeadId = ""; window._lpActiveProhibitions = [];'
        + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
        + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
        + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };');
      const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...q) => logs.push(q.join(' ')); sb.console.warn = () => {};
      let out; try { out = await run('_lpRefineSms(' + JSON.stringify(pass1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)'); } catch (e) { out = 'THREW ' + e.message; }
      sb.console.log = ol; sb.console.warn = ow;
      return [out === null ? null : 'shipped', logs.some(l => /kept the first pass — the prompt decided on no visit ask/.test(l))]; };
    const SIG = '\nAgent\nCommunity Honda Lafayette\n(555) 010-0100';
    const EMAIL = 'Hi Test,\n\nUnderstood -- you will wait to hear from the sales team. The lighter exterior options and the current promotion details are the pieces to confirm before you decide whether to revisit the A8. Brittney, your Brand Specialist, will follow up with those details, and I am here if you need anything once you have reviewed them.\n\nAgent Name\nAudi Concierge\nAudi Lafayette\n(555) 010-0100';
    const P1 = 'Test, Brittney will confirm the lighter A8 colors and the current promotion for you. I will leave those details with her.' + SIG;
    await acheck('lead 2107090639: level 3, the rewrite adds "What day and time would work for you to come in?" -> the first draft ships', () =>
      refine({ level: 3, owner: 'the PAUSE rule (not ready)' }, P1, 'Test, Brittney will confirm the lighter A8 colors and the promotion. What day and time would work for you to come in?' + SIG), [null, true]);
    await acheck('control: the same rewrite with no hold ships', () => refine({ level: 0, owner: '' }, P1, 'Test, Brittney will confirm the lighter A8 colors and the promotion. What day and time would work for you to come in?' + SIG), ['shipped', false]);
    await acheck('control: level 3 and a rewrite with no visit ask ships', () => refine({ level: 3, owner: 'the PAUSE rule (not ready)' }, P1, 'Test, Brittney will confirm the lighter A8 colors and the promotion details. I will leave those with her.' + SIG), ['shipped', false]);
  }
  await br.close();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
