#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('call-keyinfo-810.test.js');
// (v9.7.810) TOYOTA BAYTOWN LEAD 2103463134, 10/21 (log340): THE NEXT DAY'S DRAFT RE-SENT THE FIRST TEXT. The lead came in at 2:36 PM
// on 10/20; our text said the car was here at its price with two times; the salesperson reached the customer at 3:46 ("Outbound
// phone call (Contacted)", "sent over pics"). On 10/21 the draft said the same thing with two new times. Three causes:
//  1. A connected call made the text and email a follow-up only when the call was TODAY (v9.7.792). Now: since the lead came in.
//  2. The Key Information rows were read (in the dashboard frame's shadow root) and lost in the frame merge: every frame without
//     the panel sent keyInfo [] -- truthy -- and the first one won; and the dashboard frame has no lead or customer ID, so the
//     second pass dropped its customer-level fields anyway. Now: an empty read is null, and that frame's rows are taken when it
//     is the only frame with rows and its ZIP or phone is the lead's own (or its URL names the customer).
//  3. The Fullpath block said "Lead with that car. You may name that advertised price" after our text had said both, and the
//     text rewrite put "$55,948" back into a first draft that had dropped it. Now: already put to them, it is background.
// Runs the shipped inlineScraper in Chromium and feeds what it returns through the shipped frame merge (lifted whole); runs the
// shipped call block, buildUserPrompt (through the panel payload) and _lpBuildSmsRefinePrompt. Placeholder data only.
//
// Usage: node tests/call-keyinfo-810.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: call-keyinfo-810.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = typeof fn === 'function' ? fn() : fn; } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const H = 3600000, NOW = Date.now();
const fmt = (ms) => { const f = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  .formatToParts(new Date(ms)).reduce((o, p) => (o[p.type] = p.value, o), {}); return f.month + '/' + f.day + '/' + f.year + ' ' + f.hour + ':' + f.minute + ' ' + f.dayPeriod.toUpperCase(); };
const note = (msAgo, dir, title, content) => ({ getAttribute: (k) => (k === 'data-direction' ? dir : null),
  querySelector: (sel) => ({ innerText: /title/.test(sel) ? title : /content/.test(sel) ? content : /date/.test(sel) ? fmt(NOW - msAgo) : '' }) });
const dayStart = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

// The thread the prompt reads (newest first), the 10/20 shape.
const E = (when, tag, title, body) => '[' + when + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = '[10/20/2026 2:36 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const HIST = (caller) => E('10/20/2026 3:46 PM', 'CALL NOTE', 'Outbound phone call (Contacted)', 'By: ' + caller + '\n  sent over pics')
  + E('10/20/2026 2:39 PM', 'AGENT', 'Outbound Text Message', 'Test, the black 2024 Land Cruiser you viewed for $55,948 is here and available to see. Would 4:45 or 5:30 work better? Agent')
  + E('10/20/2026 2:39 PM', 'AGENT', 'Outbound phone call (Machine)', 'By: Agent Name Left message') + MARK;
const FPNOTE = 'By: System CONVERTED ON: Nurture Landing Page 2024 Toyota Land Cruiser (VIN JTEABFAJ1TEST0001) $55,948 Lead Details: Click here to view complete lead information Show Less';
const LSD = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2024 Toyota Land Cruiser',
  condition: 'Pre-Owned', stockNum: 'P0001', dealerId: '6189', store: 'Test Toyota', leadSource: 'FullPath', convState: 'call-followup', leadAgeDays: 0, hasOutbound: true,
  hasCustomerReply: false, isContacted: true, totalNoteCount: 49, phone: '(555) 010-0199', email: 'test@example.com', relationshipSignals: { unansweredQuestions: [] },
  outboundSends: [], fullpathConversion: FPNOTE, history: HIST('Rep Name'), conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + HIST('Rep Name') + '---' }, x || {});
const PANEL = '<div id="keyInfo-CustomerSummary"><div id="keyInfo-CustomerSummary-icon"><span>Fullpath CDP Summary</span></div>'
  + '<div id="keyInfo-CustomerSummary-blurb"><span>[Customer] has never purchased a vehicle or had service visits with the dealership.</span></div></div>';
const DASH = '<html><body><div id="CustomerDashboardTop">Test Buyer</div><div class="portal-shadow-container" id="host"></div>'
  + '<script>document.getElementById("host").attachShadow({ mode: "open" }).innerHTML = ' + JSON.stringify(PANEL) + ';</script></body></html>';
const BLANK = '<html><body><div>Lead Info</div></body></html>';

(async () => {
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }).catch(() => chromium.launch());
  for (const f of BUILDS) {
    console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
    const src = fs.readFileSync(f, 'utf8');
    let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
    const run = (e) => vm.runInContext(e, sb);
    const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
    for (const id of ['6189', '6190', '6191', '24399']) run('_lpValueFactCache')[id] = { inv: { units: [] }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true };

    console.log(' 1. a connected call on this lead, from the day before:');
    const a = src.indexOf('      var _lpCallToday = false'), b = src.indexOf("        convState = 'call-followup';\n      } else ", a);
    const state = (notes, createdAgo) => {
      if (a < 0 || b < 0) return '(no call block)';
      const block = src.slice(a, b) + "        convState = 'call-followup';\n      }\n      return convState;\n";
      const s = { noteEls: notes, hasNewLeadToday: true, hasRealCustomerReply: false, convState: 'first-touch', leadCreatedMs: dayStart(NOW - createdAgo), _lpD: () => {}, Date, Math, String, RegExp };
      vm.createContext(s); return vm.runInContext('(function(){\n' + block + '})()', s);
    };
    check('lead 2103463134: the lead came in yesterday and the salesperson reached them yesterday afternoon -> call-followup, not first-touch',
      () => state([note(22 * H, 'outbound', 'Outbound phone call (Contacted)', 'By: Rep Name sent over pics')], 23 * H), 'call-followup');
    check('control: a connected call from before this lead came in (the last lead\'s) still does not count',
      () => state([note(50 * H, 'outbound', 'Outbound phone call (Contacted)', 'By: Rep Name talked')], 23 * H), 'first-touch');

    console.log(' 2. the call it follows, in the prompt:');
    const viaPanel = (lsd) => quiet(() => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(lsd);
      return sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: run('leadContext') })); });
    const p = viaPanel(LSD());
    check('"THE CALL THIS FOLLOWS": the salesperson reached them on 10/20, "sent over pics" -- ask whether they came through, as one team, no re-sent pitch',
      () => [/THE CALL THIS FOLLOWS: Rep, your teammate, reached them by phone on 10\/20\. The call note: "sent over pics"/.test(p), /ask whether it came through and what they thought/.test(p),
        /You may say Rep spoke with them/.test(p), /do not re-send what our earlier messages already said \(the car being here, its price, the times already offered\)/.test(p)], [true, true, true, true]);
    check('control: the signer made the call -- no teammate, no "you may say ... spoke with them"', () => { const q = viaPanel(LSD({ history: HIST('Agent Name'), conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + HIST('Agent Name') + '---' }));
      return [/THE CALL THIS FOLLOWS: you reached them by phone on 10\/20/.test(q), /your teammate/.test(q)]; }, [true, false]);
    check('control: a first touch gets no call line', () => /THE CALL THIS FOLLOWS/.test(viaPanel(LSD({ convState: 'first-touch' }))), false);

    console.log(' 3. what they responded to, after our messages already said it:');
    check('lead 2103463134: the Land Cruiser at $55,948 is background -- not "Lead with that car", not "You may name that advertised price"',
      () => [/OUR EARLIER MESSAGES ALREADY ANSWERED IT \(BACKGROUND, NOT THE PITCH\)/.test(p), /do NOT lead with it again, say again that it is here or available, or repeat the price/.test(p),
        /Lead with that car|You may name that advertised price/.test(p)], [true, true, false]);
    const fresh = LSD({ convState: 'first-touch', isContacted: false, history: MARK, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + MARK + '---' });
    check('control: before anything has gone out, it is still the reason for the message, price and all', () => { const q = viaPanel(fresh);
      return [/AND IT IS THE REASON FOR THIS MESSAGE/.test(q), /Lead with that car\. You may name that advertised price/.test(q)]; }, [true, true]);
    const refine = (d) => quiet(() => sb._lpBuildSmsRefinePrompt('Test, I can have the 2024 Toyota Land Cruiser ready this afternoon. Would 3:45 or 4:30 work better?',
      'Test,\n\nThe 2024 Toyota Land Cruiser is here. Would 3:45 or 4:30 work better?\n\nAgent Name', d));
    check('the text rewrite: told not to put the price or "it is here" back in, and not shown the price', () => { const r = String(refine(LSD()));
      return [/already told them about it\. Do not put the price, or that it is here, back into the text/.test(r), /\$55,948/.test(r)]; }, [true, false]);
    check('control: before anything has gone out, the rewrite still keeps the car and its price', () => /the 2024 Toyota Land Cruiser at \$55,948 on our website\. Keep it in the text/.test(String(refine(fresh))), true);

    console.log(' 4. the Key Information rows survive the frame merge:');
    const scrape = async (html, url) => {
      const page = await br.newPage();
      await page.route('**/*', r => r.request().url() === url ? r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }) : r.abort());
      await page.goto(url, { waitUntil: 'load' });
      const sa = src.indexOf('  function inlineScraper() {'), sx = src.indexOf('  } // end inlineScraper', sa);
      let res; try { res = await page.evaluate('(async()=>{' + src.slice(sa, sx + 3) + '\n; return await inlineScraper();})()'); } catch (e) { res = { err: e.message }; }
      await page.close(); return res || {};
    };
    const leadRaw = await scrape(BLANK, 'https://crm.example.test/CarDashboard/lead');
    const dashRaw = await scrape(DASH, 'https://crm.example.test/CarDashboard/dash');
    const dashUrl = await scrape(DASH, 'https://crm.example.test/CarDashboard/CustomerDashboard.aspx?GlobalCustomerID=111');
    check('a frame without the panel sends no keyInfo at all (an empty list won the merge)', () => leadRaw.keyInfo === null || leadRaw.keyInfo === undefined, true);
    check('the dashboard frame names the customer from its URL when the page has no other ID', () => dashUrl.customerId, '111');
    const ms = src.indexOf('          const sorted = results.slice().sort('), ma = src.indexOf('          const m = {};', ms), mb = src.indexOf('          // (v9.7.547/546) [LP ADDRESS DIAG]', ma);
    run('globalThis.__lpMerge = function (results, aid) { window._activeLeadId = aid; ' + src.slice(ms, mb) + '\n return m; };');
    const lead = Object.assign({}, leadRaw, { autoLeadId: 'TEST001A', customerId: '111', isLeadFrame: true, hasActiveLeadPanel: true, totalNoteCount: 49, customerZip: '00000', customerState: 'TX', phone: '(555) 010-0199' });
    const shell = Object.assign({}, leadRaw, { autoLeadId: null, customerId: '', totalNoteCount: 0 });
    const dash = (x) => Object.assign({}, dashRaw, { autoLeadId: null, customerId: '', totalNoteCount: 0, customerZip: '00000', customerState: 'TX' }, x || {});
    const merged = (frames) => quiet(() => sb.__lpMerge(frames.map(r => ({ result: r })), 'TEST001A'));
    check('log340\'s shape -- the lead frame, a shell, then the dashboard frame (no lead or customer ID, the lead\'s ZIP): the rows reach the grab',
      () => (merged([lead, shell, dash()]).keyInfo || []).map(k => k.key), ['CustomerSummary']);
    check('...or the lead\'s phone, when that frame has no ZIP', () => (merged([lead, shell, dash({ customerZip: '', customerState: '', phone: '555-010-0199' })]).keyInfo || []).map(k => k.key), ['CustomerSummary']);
    check('control: a dashboard frame naming another customer is refused', () => (merged([lead, shell, dash({ customerId: '999' })]).keyInfo || []).length, 0);
    check('control: no customer ID and neither the lead\'s ZIP nor phone -- refused', () => (merged([lead, shell, dash({ customerZip: '99999' })]).keyInfo || []).length, 0);
    check('control: two frames with rows and no customer ID -- refused (which customer is not knowable)', () => (merged([lead, dash(), dash()]).keyInfo || []).length, 0);
  }
  await br.close();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
