#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('batch-ab-868.test.js');
// (v9.7.868) OWNER-APPROVED 11/10 ("build batch A and B from the audit, and the message generated is almost identical to the last
// message we sent"). Kia Baytown lead 2112534348 (log418): at 11:25 AM our text thanked them for their kind words about the rep,
// named the $2,500 down / $500 a month target and asked them back; at 11:28 they answered "Of course, I will be back. I will try
// today. If not for sure tomorrow." The draft thanked them again and restated the target.
//  1. OUR LAST MESSAGE, AND THEIR ANSWER TO IT, quoted, so it is not said again (prompt and text rewrite).
//  2. The showroom template's "do this" lines give way once the conversation has gone on past the visit.
//  3. The trade-value trigger reads transcript notes, not Lead Pro's own blocks (the template's "the color they wanted, a trade
//     appraisal" made it say "The customer wants to know what their TRADE is worth" on leads 2112534348 and 2112149909).
//  Audit #2 batch B: PF-1 (frames with no lead stand down once the lead frame is ready), PF-3 (the lead frame stops waiting for
//  key-information rows another frame has drawn), PF-2 (a grab refreshes its own store and its Baytown sisters), PF-5 (the text
//  rewrite's system prompt names the agent last). Batch A: MS-1.2 (directive labels), 1.3 (prompt length), 1.5 (key-info rows) on
//  the feedback row, and the frame classes in [LP GRAB TIMING].
// Placeholder data only.
//
// Usage: node tests/batch-ab-868.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: batch-ab-868.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const pad = (n) => String(n).padStart(2, '0');
const at = (minsAgo, clockOverride) => { const d = new Date(Date.now() - minsAgo * 60000); let h = d.getHours(), m = d.getMinutes(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear() + ' ' + (clockOverride || (h + ':' + pad(m) + ' ' + ap)); };
const E = (date, tag, title, body) => '[' + date + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (date) => '[' + date + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const OURS = 'Test, I am glad Rep made your visit a great experience. I will pass your kind note along. For the SX Prestige Hybrid, I appreciate you working through the $2,500 down and $500/month target with us. Would you be open to coming back in so Rep can review the options with you?';
const THEIRS = 'Of course, I will be back. I will try today. If not for sure tomorrow. As long as we are at that number - we are good.';
const BOT = 'By: Assistant Name Virtual Assistant Community Kia Hi Test! Thanks for stopping by Community Kia. Are you still interested in moving forward?';

(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const fn = (n) => run('typeof ' + n + ' === "function" ? ' + n + ' : null');
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const go = (lsd) => quiet(() => { try { run('activeFlags = new Set(); leadContext = "";'); sb.__L = lsd; run('lastScrapedData = globalThis.__L;'); sb.populateFromData(lsd); const ctx = String(run('leadContext') || '');
      return { d: lsd, ctx, prompt: String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: ctx }))) }; } catch (e) { return { d: lsd, ctx: '', prompt: 'THREW ' + e.message }; } });
  const lead = (hist, x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '', condition: 'New', dealerId: '6190',
    store: 'Community Kia Baytown', leadSource: 'Phone Up', convState: 'active-follow-up', leadAgeDays: 1, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 40, phone: '(555) 010-0199',
    email: 'test@example.com', lastInboundMsg: THEIRS, relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 0 }, customerState: 'TX', isShowroomFollowUp: true,
    conversationBrief: hist, history: hist, context: '' }, x || {});
  // newest first, as the CRM writes it: their answer, our message, their compliment, the visit (on the record below the marker)
  const VISIT = E(at(26 * 60, '9:13 AM'), 'NOTE', 'Showroom Visit', 'By: Rep Name Showroom visit started, lasting 20 mins');
  const H = (x) => E(at(5), 'CUSTOMER', 'Inbound Text Message', THEIRS) + E(at(8), 'AGENT', 'Outbound Text Message', 'By: Agent Name ' + OURS)
    + E(at(20), 'CUSTOMER', 'Inbound Text Message', 'I received the best assistance. Rep has been fantastic.') + (x || '') + MARK(at(25 * 60, '10:25 AM')) + VISIT;

  console.log(' 1. our last message, and their answer to it:');
  const g1 = go(lead(H()));
  check('the context opens with what our message said and what they answered, both quoted',
    () => /^↩ OUR LAST MESSAGE, AND THEIR ANSWER TO IT: at \d{1,2}:\d{2} [AP]M our message said: "Test, I am glad Rep made your visit a great experience\.[^"]*target with us\. Would you be open to coming back in so Rep can review the options with you\?"\. They answered at \d{1,2}:\d{2} [AP]M: "Of course, I will be back\. I will try today\. If not for sure tomorrow\./.test(g1.ctx), true);
  check('...and says not to say any of it again: not its thanks, figures, offer or question',
    () => /This message replies to that answer\. Do not say again what our message already said -- not its thanks, not its figures, not its offer or its question -- unless their answer asks for it\./.test(g1.prompt), true);
  const rf = fn('_lpBuildSmsRefinePrompt');
  check('the text rewrite is told the same', () => { const p = quiet(() => rf ? String(rf('Test, see you today or tomorrow.\nAgent', 'Subject: x\n\nHi Test,\n\nSee you soon.\n\nAgent Name', g1.d)) : 'no helper');
    return /━━━ WHAT OUR LAST MESSAGE ALREADY SAID ━━━\nOur message at \d{1,2}:\d{2} [AP]M: "Test, I am glad Rep[^"]*"\. Their answer: "Of course, I will be back[^"]*"\. The text does not say any of that again/.test(p); }, true);
  const ola = fn('_lpOurLastAnswered');
  check('control: our message is the newest (they have not answered) -> nothing', () => ola ? ola(lead(E(at(2), 'AGENT', 'Outbound Text Message', 'By: Agent Name ' + OURS) + H())) : 'no helper', null);
  check('control: the message before theirs was the automated assistant\'s -> nothing',
    () => ola ? ola(lead(E(at(5), 'CUSTOMER', 'Inbound Text Message', THEIRS) + E(at(8), 'AGENT', 'Outbound Text Message', BOT + ' ' + OURS) + MARK(at(600)))) : 'no helper', null);
  check('control: their answer came more than 12 hours later -> nothing',
    () => ola ? ola(lead(E(at(5), 'CUSTOMER', 'Inbound Text Message', THEIRS) + E(at(16 * 60), 'AGENT', 'Outbound Text Message', 'By: Agent Name ' + OURS) + MARK(at(20 * 60)))) : 'no helper', null);
  check('control: a bare STOP is not an answer to quote',
    () => ola ? ola(lead(E(at(5), 'CUSTOMER', 'Inbound Text Message', 'Stop') + E(at(8), 'AGENT', 'Outbound Text Message', 'By: Agent Name ' + OURS) + MARK(at(600)))) : 'no helper', null);
  check('control: a one-line message of ours ("I gotcha!") is too short to repeat -> nothing',
    () => ola ? ola(lead(E(at(5), 'CUSTOMER', 'Inbound Text Message', 'Thanks') + E(at(8), 'AGENT', 'Outbound Text Message', 'By: Agent Name I gotcha!') + MARK(at(600)))) : 'no helper', null);

  console.log(' 2. the visit was followed up, and the conversation went on:');
  check('the template\'s "do this" lines give way to one fact; the visit facts stay',
    () => [/🏪 THEY VISITED THE STORE \(visit note \d\d\/\d\d\), AND THE CONVERSATION HAS GONE ON SINCE: 2 messages from them after the visit, and a person here has written back\. The post-visit follow-up has been sent: do not thank them for coming in again, re-introduce the visit or recap who they met\./.test(g1.prompt),
      /WHAT THIS MESSAGE MUST DO: \(1\) Acknowledge the visit specifically/.test(g1.prompt), /CLOSE WITH ONE CONCRETE OFFER/.test(g1.prompt), /🏪 SHOWROOM FOLLOW-UP:/.test(g1.prompt)], [true, false, false, false]);
  const g2 = go(lead(E(at(5), 'CUSTOMER', 'Inbound Text Message', 'Thanks for having me in') + MARK(at(25 * 60, '10:25 AM')) + VISIT, { lastInboundMsg: 'Thanks for having me in' }));
  check('control: no message from a person here since the visit -> the post-visit template stands', () => [/🏪 SHOWROOM FOLLOW-UP:/.test(g2.prompt), /WHAT THIS MESSAGE MUST DO/.test(g2.prompt), /THEY VISITED THE STORE/.test(g2.prompt)], [true, true, false]);

  console.log(' 3. the trade trigger reads notes, not our own blocks:');
  check('lead 2112534348 shape (a showroom lead, no trade anywhere) -> no "what their TRADE is worth"', () => [/what their TRADE is worth/.test(g1.prompt), /what their TRADE is worth/.test(g2.prompt)], [false, false]);
  const g3 = go(lead(E(at(5), 'CUSTOMER', 'Inbound Text Message', 'Ok') + E(at(30), 'AGENT', 'Outbound phone call (Contacted)', 'By: Agent Name spoke with him, he wants a trade value on his truck first') + MARK(at(600)) + VISIT,
    { lastInboundMsg: 'Ok' }));
  check('control: a call note on this lead that he wants a trade value -> the trade line still fires', () => /what their TRADE is worth/.test(g3.prompt), true);

  console.log(' 4. PF-5: the text rewrite names the agent last:');
  const rs = (a, s, p) => String(run('buildSystemPromptSmsRefine(' + JSON.stringify(a) + ', ' + JSON.stringify(s) + ', ' + JSON.stringify(p) + ')') || '');
  const r1 = rs('Alpha', 'Community Kia Baytown', '(555) 010-0100'), r2 = rs('Bravo', 'Community Honda Lafayette', '(555) 010-0199');
  check('two agents\' copies are identical for all but the last lines (the cache key reads the first 200 characters)', () => { let i = 0; while (i < r1.length && r1[i] === r2[i]) i++; return [i > r1.length - 200, r1.slice(0, 200) === r2.slice(0, 200)]; }, [true, true]);
  check('...the identity line is still there, just before the JSON instruction', () => /\nYou are Alpha at Community Kia Baytown\. Your direct phone number is \(555\) 010-0100\.\n\nReturn ONLY valid JSON: \{"sms":"\.\.\."\}/.test(r1), true);

  console.log(' 5. PF-2: a grab refreshes its own store (and its Baytown sisters):');
  const pf = (eccs, rims2, lead) => { sb.__got = []; run('window._lpGrabPrefetchDue = true; window._activeLeadId = ' + JSON.stringify(lead) + '; var __orig = _lpPrefetchValueFacts; _lpPrefetchValueFacts = function (id, age) { globalThis.__got.push(id + \":\" + age); };');
    sb.__e = eccs; sb.__r = rims2; quiet(() => run('_lpGrabPrefetch(globalThis.__e, globalThis.__r)')); run('_lpPrefetchValueFacts = __orig;'); return sb.__got.slice().sort(); };
  check('a Kia Baytown lead -> the three Baytown stores, one-minute limit', () => pf(null, [{ leadId: 'TEST001', dealerId: '6190' }], 'TEST001'), ['6189:60000', '6190:60000', '6191:60000']);
  check('a Honda Lafayette lead (no sister stores) -> that store only', () => pf(null, [{ leadId: 'TEST001', dealerId: '24399' }], 'TEST001'), ['24399:60000']);
  check('only ECCS names the lead -> its dealer', () => pf({ dealerId: '21135', activeLeadId: 'TEST001' }, [], 'TEST001'), ['21135:60000']);
  check('control: the store is not known -> all five, as before', () => pf(null, [{ leadId: 'OTHER', dealerId: '6190' }], 'TEST001').length, 5);
  check('...and only once per grab', () => { pf(null, [{ leadId: 'TEST001', dealerId: '24399' }], 'TEST001'); sb.__got = []; run('var __o2 = _lpPrefetchValueFacts; _lpPrefetchValueFacts = function (id) { globalThis.__got.push(id); };');
    quiet(() => run('_lpGrabPrefetch(null, [])')); run('_lpPrefetchValueFacts = __o2;'); return sb.__got.length; }, 0);

  console.log(' 6. PF-1 / PF-3: frames with no lead stand down once the lead frame is ready:');
  const wa = src.indexOf("    { target: { tabId: tab.id, allFrames: true }, func: function() {\n      // Inline polling scraper");
  const wb = src.indexOf("      return new Promise(function(resolve) { wait(resolve); });\n    }}", wa);
  const fnSrc = wa >= 0 && wb > wa ? src.slice(src.indexOf('function() {', wa), wb + "      return new Promise(function(resolve) { wait(resolve); });\n    }".length) : '';
  // a fake frame. o: { notes, leadInfo, lead (its lead id), dash (dashboard shell), rowsAt (ms when key-info rows appear), mark: { atMs, lead } on the top window }
  const frame = (o) => new Promise((done) => {
    let now = 0; const top = {}; let rows = 0;
    const doc = { documentElement: { setAttribute() {} }, body: { innerHTML: o.dash ? '<div class="customerdashboardtop">' : '' },
      querySelectorAll: (q) => q === '.notes-and-history-item' && o.notes ? [{}, {}] : (/keyInfo-/.test(q) ? new Array(rows).fill({}) : []),
      querySelector: (q) => (o.notes && /notes-and-history-item/.test(q)) || (o.leadInfo && /LeadSourceName|BDAgent/.test(q)) ? {} : (o.lead && /data-autoleadid/.test(q) ? { getAttribute: () => o.lead } : null),
      getElementById: () => null };
    const FD = function () { return new Date(now); }; FD.now = () => now;
    const box = { document: doc, location: { href: 'https://example.invalid/frame' }, Date: FD, Promise, console: { log() {} },
      setTimeout: (cb, ms) => { setImmediate(() => { now += (ms || 0); if (o.mark && now >= o.mark.atMs && !top.__lpLeadReady) top.__lpLeadReady = { t: now, lead: o.mark.lead }; if (o.rowsAt != null && now >= o.rowsAt) rows = 3; cb(); }); } };
    box.window = box; box.window.top = top; box.top = top; vm.createContext(box);
    if (!fnSrc) return done({ error: 'wait function not found' });
    vm.runInContext('(' + fnSrc + ')()', box).then(done, (e) => done({ error: e.message }));
  });
  await acheck('a frame with no lead in it, once the lead frame has marked ready -> stands down (not the 4-second cap)',
    async () => { const r = await frame({ mark: { atMs: 300, lead: 'TEST001' } }); return [r.timedOut, r.cls, r.at < 1000]; }, [false, 'no lead', true]);
  await acheck('control: no mark from a lead frame -> waits out the cap, as before', async () => { const r = await frame({}); return [r.timedOut, r.cls]; }, [true, 'cap']);
  await acheck('a frame for the same lead with no notes of its own -> stands down', async () => { const r = await frame({ leadInfo: true, lead: 'TEST001', mark: { atMs: 300, lead: 'TEST001' } }); return [r.timedOut, r.cls]; }, [false, 'same lead, no notes']);
  await acheck('control: lead markers, no notes, a lead id that is not the marked one -> waits (the rims2 race)', async () => { const r = await frame({ leadInfo: true, lead: 'TEST002', mark: { atMs: 300, lead: 'TEST001' } }); return [r.timedOut, r.cls]; }, [true, 'cap']);
  await acheck('the customer dashboard -> done as soon as its key-information rows are drawn, with when', async () => { const r = await frame({ dash: true, rowsAt: 900 }); return [r.timedOut, r.cls, r.kiRows, r.kiRowsAt >= 900 && r.kiRowsAt < 1200]; }, [false, 'dashboard', 3, true]);
  await acheck('control: the dashboard with no rows -> waits out the cap (the rows may still come)', async () => { const r = await frame({ dash: true, mark: { atMs: 300, lead: 'TEST001' } }); return [r.timedOut, r.cls]; }, [true, 'dashboard']);
  await acheck('the lead frame itself: ready, returns its own times, classed "lead"', async () => { const r = await frame({ notes: true, leadInfo: true }); return [r.timedOut, r.cls, typeof r.poll, typeof r.keyInfo]; }, [false, 'lead', 'number', 'number']);

  console.log(' 7. batch A: what the prompt carried, on the feedback row and in the timing line:');
  const pd = fn('_lpPromptDirectives');
  const P = ['DATE: Tuesday', 'STORE STATUS RIGHT NOW: OPEN. Closes at 8 PM.', 'VISIT DECISION FOR THIS MESSAGE: no visit ask', '⚠⚠ RESPOND TO WHAT THE CUSTOMER ACTUALLY ASKED — LEAD WITH INFO:',
    'CONVERSATION TRANSCRIPT (newest first):', '---', '[11/10/2026 9:00 AM] [CUSTOMER] Inbound Text Message', '  WHAT ABOUT THE PRICE: is it negotiable?', '---', 'OUR PITCH IS ALREADY OUT AND UNANSWERED: on 11/08 ...',
    '1. [11/09/2026 9:13 AM] US: Outbound Text Message — HELLO THERE FRIEND: hi', 'STORE STATUS RIGHT NOW: OPEN again'].join('\n');
  check('the labels outside the transcript, once each; nothing from inside the transcript or the arc', () => pd ? pd(P) : 'no helper',
    ['STORE STATUS RIGHT NOW', 'VISIT DECISION FOR THIS MESSAGE', 'RESPOND TO WHAT THE CUSTOMER ACTUALLY ASKED', 'OUR PITCH IS ALREADY OUT AND UNANSWERED']);
  const meta = quiet(() => { run('window._lpPromptFacts = { chars: 53741, directives: ["STORE STATUS RIGHT NOW", "VISIT DECISION FOR THIS MESSAGE"] };');
    sb.__L = { autoLeadId: 'TEST001A', store: 'Community Kia Baytown', agent: 'Agent Name', keyInfo: [{}, {}, {}], leadAgeDays: 1 }; run('lastScrapedData = globalThis.__L; _lpFeedbackCaptureMeta();');
    return run('JSON.stringify([_lpFeedback.meta.directives, _lpFeedback.meta.promptChars, _lpFeedback.meta.keyInfoRows])'); });
  check('the feedback row carries the directive labels, the prompt length and the key-information rows kept', () => JSON.parse(meta || 'null'), [['STORE STATUS RIGHT NOW', 'VISIT DECISION FOR THIS MESSAGE'], 53741, 3]);
  check('[LP GRAB TIMING] names each frame class and when the rows arrived', () => {
    run('window._lpGrabTiming = { t0: 0, leadId: "TEST001A", preScrape: 9, poll: 0, expand: 240, keyInfo: 30, frameWall: 1210, frames: 7, framesTimedOut: 0, frameClasses: "lead 1 @1.2s, no lead 3 @0.6s, same lead, no notes 2 @0.6s, dashboard 1 @0.9s", kiRows: 3, kiRowsAt: 900, merge: 85, total: 1300, gens: 0 }; lastScrapedData = { autoLeadId: "TEST001A" };');
    const line = run('_lpLogGrabTiming')(() => {}, { t0: 0, done: 10 }); return /0 of 7 frames waited out the 4000ms cap; frames: lead 1 @1\.2s, no lead 3 @0\.6s, same lead, no notes 2 @0\.6s, dashboard 1 @0\.9s; key-info rows 3 \(drawn at 900ms\)\)/.test(line); }, true);
}
})().then(() => {
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
});
