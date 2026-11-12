#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('exchange-826.test.js');
// (v9.7.826) THE EXCHANGE THIS MESSAGE ANSWERS. Toyota Baytown lead 2105834775 (log362): a Click & Go credit app came in at 2:44;
// at 2:56 the BD agent texted "I can have it ready this afternoon. Would 5:00 or 5:45 work?"; at 3:02 the customer answered "Yes".
// A scraper rule from v9.7.256 threw the bare "Yes" away (it was written for "Reply YES to receive texts"), the lead was labeled a
// first touch, and the draft re-pitched the car and the application and offered 5:15. Gil: "That should have been a given ... We need
// to be better than applying constant band-aids." Three changes, all on one principle -- when the customer wrote last, their message
// answers ours right before it: the scraper keeps a bare yes unless it answers an opt-in prompt; buildUserPrompt never treats such a
// lead as a first touch; and THE EXCHANGE THIS MESSAGE ANSWERS (our message, their answer) sits ahead of the scenario in the prompt
// and in the text rewrite.
// Runs the SHIPPED inlineScraper in Chromium, and executes buildUserPrompt through the panel payload and _lpBuildSmsRefinePrompt.
// Placeholder data only.
//
// Usage: node tests/exchange-826.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: exchange-826.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const sure = (fn) => { try { return fn(); } catch (e) { return 'THREW: ' + e.message; } };
const OFFER = 'Test, the 2021 Toyota Camry SE Nightshade is here and available to see. Your Click & Go application came through, so we can go over the details together and help you finalize everything. I can have it ready this afternoon. Would 5:00 or 5:45 work? Agent Reply STOP to cancel.';
const OPTIN = 'Test Toyota: Reply YES to receive text messages about your inquiry. Msg and data rates may apply.';
// ── placeholder lead pages, in VinSolutions' own note markup ──────────────────────────────────────────────────────────
const note = (id, tags, dir, when, title, html) => '<span id="notes-and-history-item-' + id + '" data-tags="' + tags + '" data-direction="' + dir
  + '" data-unique-identifier-type="AutoLeadMessageID" data-unique-identifier-value="' + id + '" class="notes-and-history-item list-group-item">'
  + '<div class="notes-and-hsitory-item-date">' + when + '</div><div class="notes-and-hsitory-item-detail"><div class="notes-and-history-item-header">'
  + '<div class="legacy-notes-and-history-title">' + title + '</div></div><div class="notes-and-history-item-content">' + html + '</div></div></span>';
const PAGE = (notes) => '<html><body><div>Lead Info<br>Status:\tWaiting for Prospect Response<br>Created:\t10/26/26 2:44p (0d)<br>Source:\tGubagoo Virtual Retailing</div><div id="notes">' + notes.join('') + '</div></body></html>';
const THREAD = (ours) => [
  note('300000001', 'Communication-Texts', 'Inbound', '10/26/2026 3:02 PM', 'Inbound Text Message', 'Received from: (555) 010-0199<br>Received by: Agent Name<br>Yes'),
  note('300000002', 'Communication-Texts', 'Outbound', '10/26/2026 2:56 PM', 'Outbound Text Message', 'Sent to: (555) 010-0199<br>Sent by: Agent Name<br>' + ours),
  note('300000003', 'Email-Communication', 'Inbound', '10/26/2026 2:44 PM', 'Lead received', '<div>By: System</div>Lead Type: Gubagoo Dynamic Credit App<br>Department: Virtual Retailing')];
// ── placeholder prompt fixture ───────────────────────────────────────────────────────────────────────
const M = 60000, H = 60 * M, D = 24 * H, NOW = Date.now();
const fmt = (ms) => { const f = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  .formatToParts(new Date(ms)).reduce((o, p) => (o[p.type] = p.value, o), {}); return f.month + '/' + f.day + '/' + f.year + ' ' + f.hour + ':' + f.minute + ' ' + f.dayPeriod.toUpperCase(); };
const E = (ms, tag, title, body) => '[' + fmt(ms) + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (ms) => '[' + fmt(ms) + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const LEAD = (o) => { o = o || {}; const at = o.at || (NOW - 10 * M), said = o.said || 'Yes', ours = o.ours || OFFER;
  const h = (o.weAnswered ? E(at + 2 * M, 'AGENT', 'Outbound Text Message', 'Test, great -- which works better, 5:00 or 5:45? Agent') : '')
    + E(at, 'CUSTOMER', 'Inbound Text Message', said) + E(at - 6 * M, 'AGENT', 'Outbound Text Message', ours) + MARK(at - 18 * M);
  return Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2021 Toyota Camry SE Nightshade',
    condition: 'Pre-Owned', stockNum: 'P0001', dealerId: '6189', store: 'Test Toyota', leadSource: 'Gubagoo Virtual Retailing', convState: o.state || 'first-touch',
    leadAgeDays: 0, hasOutbound: true, totalNoteCount: 12, phone: '(555) 010-0199', email: 'test@example.com', customerZip: '00000', lastInboundMsg: said,
    lastOutboundMsg: 'Sent to: (555) 010-0199\nSent by: Agent Name\n' + ours, lastSubstantiveOutboundMsg: ours,
    outboundSends: [{ title: 'outbound text message', ms: at - 6 * M, body: 'Sent to: (555) 010-0199\nSent by: Agent Name\n' + ours }],
    relationshipSignals: { unansweredQuestions: [], customerCommitments: [], agentCommitments: [] },
    history: h, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + h + '---' }, o.x || {}); };

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
      await page.clock.install({ time: new Date('2026-10-26T15:06:00-05:00').getTime() });
      await page.goto('https://crm.example.test/CarDashboard/lead', { waitUntil: 'domcontentloaded' });
      let res; try { res = await page.evaluate('(async()=>{' + scraper + '\n; return await inlineScraper();})()'); } catch (e) { res = { err: e.message }; }
      await ctx.close(); return res || {};
    };

    console.log(' 1. the scraper: a bare "Yes" after our question is their answer:');
    const s1 = await scrape(THREAD(OFFER));
    check('lead 2105834775: "Yes" to "Would 5:00 or 5:45 work?" -> not a first touch', [s1.convState !== 'first-touch', s1.lastInboundMsg, s1.err || ''], [true, 'Yes', '']);
    const s2 = await scrape(THREAD(OPTIN));
    check('control: "Yes" to "Reply YES to receive text messages" is still plumbing -> first touch', s2.convState, 'first-touch');

    let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
    const run = (e) => vm.runInContext(e, sb);
    const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
    const viaPanel = (lsd) => String(sure(() => quiet(() => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(lsd);
      return sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: run('leadContext') })); })));

    console.log(' 2. the prompt: the exchange comes first, and nothing calls it a first touch:');
    const p = viaPanel(LEAD());
    const iEx = p.indexOf('━━━ THE EXCHANGE THIS MESSAGE ANSWERS ━━━'), iSc = p.indexOf('━━━ SCENARIO ━━━'), iRec = p.indexOf('THE CUSTOMER\'S OWN MESSAGES ARE THE RECORD');
    check('even labeled first-touch upstream: our message and their "Yes" side by side, after the conversation and ahead of the scenario',
      [iEx > -1, iEx > iRec, iEx < iSc, p.indexOf('Our message (' + fmt(NOW - 16 * M).slice(0, 5) + ', sent by you): "' + OFFER.replace(' Reply STOP to cancel.', '') + '"') > -1,
        p.indexOf('Their reply (' + fmt(NOW - 10 * M).slice(0, 5) + '): "Yes"') > -1], [true, true, true, true, true]);
    check('a yes to two times: confirm they are coming and ask which -- 5:00 or 5:45, the same times, no new ones',
      p.indexOf('They said yes to coming in but did not say which time. Confirm they are coming, ask which of the times our message offered works (5:00 or 5:45) -- the same times, no new ones') > -1, true);
    const logs = []; { const ol = sb.console.log; sb.console.log = (...x) => logs.push(x.join(' '));
      try { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); const l = LEAD(); sb.populateFromData(l); sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: l, context: run('leadContext') })); } catch (e) {}
      sb.console.log = ol; }
    check('...and the first-touch label upstream is overruled (the customer wrote last), and nothing calls the "Yes" silence',
      [logs.some(l => /\[LP EXCHANGE DIAG\] convState first-touch -> active-follow-up: the customer answered our [\d/]+ message \("Yes"\)/.test(l)), /same as silence/.test(p)], [true, false]);
    const p1 = viaPanel(LEAD({ ours: 'Test, the Camry is here. Would 5:15 today work? Agent' }));
    check('a yes to one time: confirm it cleanly and stop', p1.indexOf('They said yes to 5:15. Confirm it cleanly, say what will be ready for them, and stop.') > -1, true);
    const pSt = viaPanel(LEAD({ at: NOW - 30 * H }));
    check('times offered more than 12 hours ago: ask when they can come instead if they have passed', /if they have passed, say so simply and ask when they can come instead/.test(pSt), true);
    const pQ = viaPanel(LEAD({ said: 'Does it have a sunroof?' }));
    check('a question back is read as a question about our message (no yes-to-times line)',
      [/THE EXCHANGE THIS MESSAGE ANSWERS/.test(pQ), /They said yes/.test(pQ)], [true, false]);

    console.log(' 3. controls:');
    check('we already answered their reply -> no exchange block', /THE EXCHANGE THIS MESSAGE ANSWERS/.test(viaPanel(LEAD({ weAnswered: true }))), false);
    check('"Yes" to an opt-in prompt -> no exchange block', /THE EXCHANGE THIS MESSAGE ANSWERS/.test(viaPanel(LEAD({ ours: OPTIN }))), false);

    console.log(' 4. the text rewrite carries it too:');
    const rp = String(quiet(() => sb._lpBuildSmsRefinePrompt('Test, which works better, 5:00 or 5:45? Agent', 'Subject: Camry\n\nTest,\n\nWhich works better, 5:00 or 5:45?\n\nAgent Name', LEAD())));
    check('the rewrite sees the same exchange and the same two times', [/━━━ THE EXCHANGE THIS MESSAGE ANSWERS ━━━/.test(rp), /\(5:00 or 5:45\)/.test(rp)], [true, true]);
  }
  await br.close();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
