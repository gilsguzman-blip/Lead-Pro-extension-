#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('clickgo-840.test.js');
// (v9.7.840) CLICK & GO IS NAMED IN A FORMAT THAT HAS NOT NAMED IT; THE REWRITE DOES NOT REOPEN ON WHAT OUR LAST TEXT SAID. Toyota
// Baytown lead 2107371352 (log382, v9.7.839): our 4:58 text already said "I saw you built a payment in Click & Go"; the next text did
// not say it again and [LP CLICK&GO BRAND DIAG] logged sms:MISSING. Gil: "is it wrong, though? Remember the first reach already went
// out from <agent> that has Click & Go mentioned" -- and "let's be consistent". The same capture: the first pass opened on the
// drive-out numbers, and the rewrite opened "the 2026 RAV4 Plug-In Hybrid XSE in Meteor is here and available" -- what the 4:58 text
// had already said. Builds the prompt through the shipped panel payload and executes _lpRefineSms. Placeholder data only.
//
// Usage: node tests/clickgo-840.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: clickgo-840.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }

const E = (date, time, tag, title, body) => '[' + date + ' ' + time + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = '[10/29/2026 4:48 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const TEXT_CG = E('10/29/2026', '4:58 PM', 'AGENT', 'Outbound Text Message', 'Test, the 2026 RAV4 Plug-In Hybrid XSE in Meteor is here, ready for you to see. I saw you built a payment in Click & Go. Would 9:15 AM or 10:30 AM Friday work better? Agent');
const TEXT_PLAIN = E('10/29/2026', '4:58 PM', 'AGENT', 'Outbound Text Message', 'Test, the 2026 RAV4 Plug-In Hybrid XSE in Meteor is here, ready for you to see. Would 9:15 AM or 10:30 AM Friday work better? Agent');
const EMAIL_CG = E('10/29/2026', '5:05 PM', 'AGENT', 'Email reply to prospect', 'Hi Test, thanks for starting your deal on Click & Go. Agent Name');
const CALL = E('10/29/2026', '4:57 PM', 'AGENT', 'Outbound phone call (Contacted)', 'By: Agent Name\n  interested, will come by');
const LSD = (hist, x) => { const h = hist + MARK;
  return Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Agent Name', vehicle: '2026 Toyota RAV4 Plug-In Hybrid XSE',
    stockNum: 'TEST0R1', dealerId: '6189', store: 'Community Toyota Baytown', leadSource: 'Gubagoo Virtual Retailing', convState: 'call-followup', leadAgeDays: 0,
    hasOutbound: true, isContacted: true, hasCustomerReply: false, totalNoteCount: 6, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '',
    relationshipSignals: { unansweredQuestions: [] }, vrPaymentSelected: true, vrDroppedOff: true, vrDroppedOffPage: 'Financing',
    history: h, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + h + '---' }, x || {}); };

(async () => {
  for (const f of BUILDS) {
    console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
    let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
    const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
    const built = (lsd) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {};
      try { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(lsd);
        return String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: run('leadContext') }))); } finally { sb.console.log = ol; sb.console.warn = ow; } };
    const brand = (p) => (p.match(/^- BRAND: .*$/m) || ['(none)'])[0];

    console.log(' 1. the brand is asked for only in a format that has not named it:');
    check('lead 2107371352: our 10/29 text named Click & Go -> the email names it, the text does not have to', () =>
      brand(built(LSD(TEXT_CG + CALL))), '- BRAND: name Click & Go once in the EMAIL, in passing -- "the deal you started on Click & Go", "since you started on Click & Go". Our 10/29 text already named it, so the text does not have to say it again. Not as the opener and not as news.');
    check('our email named it, our text did not -> the text names it', () =>
      /^- BRAND: name Click & Go once in the SMS, in passing .* Our 10\/29 email already named it, so the email does not have to say it again\./.test(brand(built(LSD(EMAIL_CG + TEXT_PLAIN + CALL)))), true);
    check('both named -> neither has to; once, in passing, if it fits', () =>
      /^- BRAND: our 10\/29 text and 10\/29 email already named Click & Go, so neither format has to say it again/.test(brand(built(LSD(EMAIL_CG + TEXT_CG + CALL)))), true);
    check('control: neither named -> the v9.7.787 line, both formats', () =>
      /^- BRAND: name Click & Go once in BOTH the SMS and the email, in passing/.test(brand(built(LSD(TEXT_PLAIN + CALL)))), true);

    console.log(' 2. the console line does not call a format that already named it a miss:');
    const diag = (lsd, sms, email) => { const logs = [], ol = sb.console.log; sb.console.log = (...a) => logs.push(a.join(' '));
      try { run('lastScrapedData = ' + JSON.stringify(lsd) + ';'); const fn = run('_lpClickGoNamed'); const done = fn(lsd);
        const say = (t, k) => /click\s*(?:&|and)\s*go/i.test(t) ? 'named' : done[k] ? 'not needed (named in our ' + done[k] + ' ' + k + ')' : 'MISSING';
        return say(sms, 'text') + ' | ' + say(email, 'email'); } finally { sb.console.log = ol; } };
    check('the shipped diag reads "not needed (named in our 10/29 text)" for the text on log382\'s lead', () => {
      const i = src.indexOf("console.log('[LP CLICK&GO BRAND DIAG] sms:' + _cgSay(rawSms, 'text')"); return [i > 0, diag(LSD(TEXT_CG + CALL), 'no brand here', 'since you started on Click & Go')]; },
      [true, 'not needed (named in our 10/29 text) | named']);

    console.log(' 3. the text rewrite does not reopen on what our last text said:');
    const SIG = '\nAgent\nTest Store\n(555) 010-0100';
    const EMAIL = 'Hi Test,\n\nI am putting together the drive-out numbers on the RAV4 Plug-In Hybrid XSE. Since you started on Click & Go, I can send the secure credit application too.\n\nAgent Name\nTest Store\n(555) 010-0100';
    const refine = async (d, pass1, reply) => { const logs = []; sb.__reply = reply; sb.__d = d;
      run('_lpLastVisitDecision = { level: 0, owner: "" }; window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Test Store" };'
        + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpAddApptLeadId = ""; window._lpActiveProhibitions = [];'
        + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
        + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
        + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };');
      const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...q) => logs.push(q.join(' ')); sb.console.warn = () => {};
      let out; try { out = await run('_lpRefineSms(' + JSON.stringify(pass1) + ', ' + JSON.stringify(EMAIL) + ', globalThis.__d)'); } catch (e) { out = 'THREW ' + e.message; }
      sb.console.log = ol; sb.console.warn = ow;
      return [out === null ? null : 'shipped', (logs.find(x => /kept the first pass — the rewrite opened on the car being here/.test(x)) || '').replace(/^.*kept the first pass — /, '').replace(/ \|.*$/, '')]; };
    const P1 = 'Test, I\'m putting together the drive-out numbers for the RAV4 Plug-In Hybrid XSE. I can send the secure credit application so your financing is ready. Does 9:15 AM or 10:30 AM Friday still work?' + SIG;
    const HERE = 'Test, the 2026 RAV4 Plug-In Hybrid XSE in Meteor is here and available. I\'m putting together your drive-out numbers. Would 9:15 AM or 10:30 AM Friday work?' + SIG;
    await acheck('log382: our 4:58 text said it is here; the rewrite opens "...is here and available" -> the first pass ships', () =>
      refine(LSD(TEXT_CG + CALL), P1, HERE), [null, 'the rewrite opened on the car being here, which our 10/29 text already said']);
    await acheck('control: our last text never said it is here -> the rewrite ships', () =>
      refine(LSD(E('10/29/2026', '4:58 PM', 'AGENT', 'Outbound Text Message', 'Test, thanks for starting on Click & Go. Agent') + CALL), P1, HERE), ['shipped', '']);
    await acheck('control: the customer wrote after our text -> the rewrite ships (they may have asked whether it is still there)', () =>
      refine(LSD(E('10/29/2026', '5:10 PM', 'CUSTOMER', 'Inbound Text Message', 'is it still there?') + TEXT_CG + CALL), P1, HERE), ['shipped', '']);
    await acheck('control: the first pass also opened on it -> the rewrite ships', () =>
      refine(LSD(TEXT_CG + CALL), 'Test, the RAV4 is here and ready for you. Does Friday at 9:15 still work?' + SIG, HERE), ['shipped', '']);
  }
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
