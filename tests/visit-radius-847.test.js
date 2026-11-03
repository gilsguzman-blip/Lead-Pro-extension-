#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('visit-radius-847.test.js');
// (v9.7.847) FROM MONDAY 11/2, ON 9.7.846. (1) Kia Baytown lead 2108597971: a Louisiana customer about 110 miles out got the
// out-of-state no-visit rules and "since you're handling this remotely"; the agent regenerated and asked for the visit herself. Gil:
// "75 miles is a good marker ... relevant for LA as well. Anything beyond that would be a special trip ... a soft ask for a visit."
// (2) Toyota Baytown lead 2108628902: the salesperson's call note "Will call me back", then a text offering "2:15 or 3:00"; Gil: "no
// times after will call back." Our own "isn't in stock today" was quoted back as WE SAID IT WAS AVAILABLE. (3) Honda Baytown Fullpath
// lead 2108640226: "the Crystal Black Pearl Ridgeline you viewed". (4) Audi Lafayette lead 2108656923: "<customer>, <agent>," (the
// signer's own name opened the draft), "<agent>, your Concierge" above the signature, and "Audi Lafayette is open until 7 today";
// Honda Lafayette lead 2108459212: "Monday through Saturday, 9 AM to 7 PM". Executes buildUserPrompt through the shipped panel
// payload, _lpCallBack, _lpRefineSms, _lpHouseGuard, the scraper's claim statement, the opener guard and enforceSmsSig (lifted).
// Placeholder data only.
//
// Usage: node tests/visit-radius-847.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: visit-radius-847.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
async function acheck(name, fn, want) { let got; try { got = await fn(); } catch (e) { got = 'THREW: ' + e.message; } check(name, () => got, want); }
const SIG = '\nAgent\nTest Store\n(555) 010-0100';
const E = (time, tag, title, body) => '[11/02/2026 ' + time + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = '[11/02/2026 6:17 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const OUR = E('8:51 AM', 'AGENT', 'Outbound Text Message', 'Test, the 2027 Kia Telluride S is here and showing available. Agent');
const KIA = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2027 Kia Telluride S',
  condition: 'New', stockNum: 'TEST0K1', dealerId: '6190', store: 'Community Kia Baytown', leadSource: 'Cargurus', convState: 'first-touch', leadAgeDays: 0,
  hasOutbound: true, hasCustomerReply: false, totalNoteCount: 4, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '',
  customerState: 'LA', customerZip: '70601', relationshipSignals: { unansweredQuestions: [] }, history: OUR + MARK, conversationBrief: OUR + MARK }, x || {});
const CALL = E('9:50 AM', 'AGENT', 'Outbound phone call (Contacted)', 'By: Rep Name Will call me back');
const TOY_OUT = E('9:27 AM', 'AGENT', 'Outbound Text Message', 'Test, the 2026 Tacoma SR Double Cab you asked about isn’t in stock today, but we do have other Tacoma options. Agent');
const TOY = (x) => KIA(Object.assign({ vehicle: '2026 Toyota Tacoma SR', stockNum: '', dealerId: '6189', store: 'Community Toyota Baytown', leadSource: 'Edmunds',
  convState: 'call-followup', customerState: 'TX', customerZip: '77521', history: CALL + TOY_OUT + MARK, conversationBrief: CALL + TOY_OUT + MARK }, x || {}));

(async () => {
for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const at = (iso, fn) => { const restore = run('(function(){ var RD = Date; var FIX = new RD("' + iso + '").getTime();'
      + ' function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); }'
      + ' FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; var prev = Date; Date = FD; return function(){ Date = prev; }; })()');
    try { return fn(); } finally { if (restore) restore(); } };
  const NOON = '2026-11-02T12:14:00-06:00';
  const built = (lsd) => at(NOON, () => { const ol = sb.console.log, ow = sb.console.warn; const logs = []; sb.console.log = (...q) => logs.push(q.join(' ')); sb.console.warn = () => {};
    try { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0; window._lpAddApptLeadId = ""; window._lpNoApptLeadId = "";'); sb.populateFromData(lsd);
      return { p: String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: run('leadContext') }))), logs: logs.join('\n') }; } finally { sb.console.log = ol; sb.console.warn = ow; } });
  const VD = (p) => (p.match(/^VISIT DECISION FOR THIS MESSAGE: .*$/m) || ['(none)'])[0];

  console.log(' 1. distance is miles, 75 of them (Gil, 11/2):');
  const k = built(KIA());
  check('lead 2108597971 (LA ZIP 706xx, about 110 miles): not the no-visit rule -- an out-of-area buyer, a special trip', () =>
    [/REMOTE \/ OUT-OF-STATE BUYER: Customer is NOT local/.test(k.p), /^🔴 OUT-OF-AREA BUYER: this customer lives more than 75 miles from the store \(INTERNAL fact/m.test(k.p),
     /^- A VISIT IS A SPECIAL TRIP FOR THIS CUSTOMER: lead with a video walkaround, photos, the numbers or the credit application, and you may close with ONE soft, no-pressure invitation/m.test(k.p),
     /^- Do NOT push an in-person visit/m.test(k.p)], [false, true, true, false]);
  check('the visit decision: no times, a soft invitation allowed (level 2, the SPECIAL TRIP rule)', () =>
    /^VISIT DECISION FOR THIS MESSAGE: no specific appointment times and no same-day push in this message; invite them in only as that instruction allows -- the SPECIAL TRIP rule/.test(VD(k.p)), true);
  check('never told they are remote, and "remotely" is not handed to the model to copy', () =>
    [/^- NEVER tell them they are remote, out of state, not local or far away: no "since you are handling this remotely"/m.test(k.p), /Focus on what CAN be done remotely/.test(k.p), /They are remote: the next step is remote/.test(k.p)], [true, false, false]);
  check('the console says how far and what it decided', () => /\[LP DISTANCE MILES DIAG\] about 111 miles \| a special trip/.test(k.logs), true);
  const kShip = built(KIA({ lastInboundMsg: 'Can you ship to Louisiana?', history: E('9:00 AM', 'CUSTOMER', 'Inbound Text Message', 'Can you ship to Louisiana?') + OUR + MARK,
    conversationBrief: E('9:00 AM', 'CUSTOMER', 'Inbound Text Message', 'Can you ship to Louisiana?') + OUR + MARK, hasCustomerReply: true }));
  check('control: a customer who asks us to ship it keeps the no-visit rule (level 3), and the never-say line', () =>
    [/REMOTE \/ OUT-OF-STATE BUYER: Customer is NOT local/.test(kShip.p), /no visit ask and no appointment times in this message -- the REMOTE \/ OUT-OF-STATE BUYER block/.test(VD(kShip.p)),
     /NEVER tell them they are remote/.test(kShip.p)], [true, true, true]);
  run('ZIP3_CENTROIDS["999"] = { lat: 30.0, lng: -94.0 };');   // a placeholder ZIP3 about 60 miles from Baytown, across a state line
  const near = built(KIA({ customerZip: '99901' }));
  check('out of state but within 75 miles -> the distance tier (a visit ask), not a special trip', () =>
    [/OUT-OF-AREA BUYER|REMOTE \/ OUT-OF-STATE/.test(near.p), /^🔴 DISTANCE BUYER:/m.test(near.p), /SPECIAL TRIP/.test(near.p), /out of state but within 75 -> the distance tier/.test(near.logs)], [false, true, false, true]);
  const tx = built(KIA({ customerState: 'TX', customerZip: '77840' }));
  check('in state, about 100 miles (778xx): the distance tier with the special-trip line, no times (level 2)', () =>
    [/^🔴 DISTANCE BUYER:/m.test(tx.p), /^- A VISIT IS A SPECIAL TRIP FOR THIS CUSTOMER: they live more than 75 miles from the store/m.test(tx.p), /the SPECIAL TRIP rule/.test(VD(tx.p))], [true, true, true]);
  const tx62 = built(KIA({ customerState: 'TX', customerZip: '77701' }));
  check('control: in state, about 60 miles (777xx, outside the local list): the distance tier as before, no special trip', () =>
    [/^🔴 DISTANCE BUYER:/m.test(tx62.p), /SPECIAL TRIP/.test(tx62.p)], [true, false]);
  const local = built(KIA({ customerState: 'TX', customerZip: '77521' }));
  check('control: a local ZIP -> no distance block at all', () => /DISTANCE BUYER|OUT-OF-AREA|REMOTE \/ OUT-OF-STATE|SPECIAL TRIP/.test(local.p), false);

  console.log(' 2. "Will call me back" (lead 2108628902):');
  const cb = run('_lpCallBack');
  check('the call note is read as their promise to call', () => at(NOON, () => { const r = cb(TOY()); return r && [r.date, r.quote]; }), ['11/02', 'Will call me back']);
  check('control: "I will call him back tomorrow" is ours, not theirs; a promise four days old has lapsed', () => at(NOON, () =>
    [cb(TOY({ history: E('9:50 AM', 'AGENT', 'Outbound phone call (Contacted)', 'By: Rep Name I will call him back tomorrow') + MARK })),
     cb(TOY({ history: CALL.replace('11/02/2026', '10/29/2026') + '[10/29/2026 6:17 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  x\n' }))]), [null, null]);
  const t = built(TOY());
  check('the prompt: THEY SAID THEY WILL CALL US BACK, no appointment time in any format, and the decision says so (level 2)', () =>
    [/^THEY SAID THEY WILL CALL US BACK \(on the 11\/02 call\): the next move is theirs\. This message offers NO appointment time in any format/m.test(t.p),
     /the CALL-BACK rule \(they said they will call us\)/.test(VD(t.p)), /OFFER THE SOONEST REAL OPENING FIRST/.test(t.p)], [true, true, false]);
  check('the console names it', () => /\[LP CALL BACK DIAG\] 11\/02 \(Rep Name\): "Will call me back" -> they will call us: no appointment times/.test(t.logs), true);
  const P1 = 'Test, is the Double Cab the main thing you need? I can check which Tacoma options fit.' + SIG;
  const ADD = 'Test, is the Double Cab the main thing you need? I can check which Tacoma options fit. Would 2:15 or 3:00 work better?' + SIG;
  const refine = async (level, reply) => { const logs = []; sb.__reply = reply; sb.__d = TOY();
    run('_lpLastVisitDecision = { level: ' + level + ', owner: "the CALL-BACK rule (they said they will call us)" }; window._leadProResolvedSigner = { firstName: "Agent", phone: "(555) 010-0100" }; window._leadProResolvedContext = { storeName: "Test Store" };'
      + 'window._lpRegenChipKey = ""; window._lpNoApptLeadId = ""; window._lpAddApptLeadId = ""; window._lpActiveProhibitions = [];'
      + 'getEndpoint = function () { return { url: "https://example.invalid/generate" }; }; _lpAttachLicense = function (p) { return p; };'
      + 'fetch = function () { var r = { json: function () { return Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: globalThis.__reply }) }] } }] }); } };'
      + '  var p = Promise.resolve(r); p.finally = function (fn) { return Promise.resolve(r).then(function (v) { fn(); return v; }); }; return p; };');
    const ol = sb.console.log, ow = sb.console.warn; sb.console.log = (...q) => logs.push(q.join(' ')); sb.console.warn = () => {};
    let out; try { out = await run('_lpRefineSms(' + JSON.stringify(P1) + ', "Hi Test,\\n\\nRep Name mentioned you will call back. When you do, is the Double Cab the main thing you need? I can check which Tacoma options fit.\\n\\nAgent Name", globalThis.__d)'); } finally { sb.console.log = ol; sb.console.warn = ow; }
    return [out === null ? null : 'shipped', logs.some(l => /kept the first pass — the prompt decided on no appointment times \(the CALL-BACK rule/.test(l))]; };
  await acheck('the text rewrite added "Would 2:15 or 3:00 work better?" -> the first pass ships', () => refine(2, ADD), [null, true]);
  await acheck('control: a rewrite with no time ships; the same rewrite where times are allowed (level 0) ships', async () =>
    [(await refine(2, 'Test, is the Double Cab the main thing for you? I can check which Tacoma options fit.' + SIG))[0], (await refine(0, ADD))[0]], ['shipped', 'shipped']);

  console.log(' 3. our own "isn\'t in stock" is not an availability claim:');
  const ca = src.lastIndexOf('            if ((_scM = _scContent.match(', src.indexOf('is here|here and (?:ready|available)|available to see'));   // (v9.7.860) the pattern now opens with a group
  // (v9.7.859) the statement spans lines since "don't have ... in stock" joined it; it ends at its own "_scM[0]);".
  const stmt = ca > 0 ? src.slice(ca, src.indexOf('_scM[0]);', ca) + '_scM[0]);'.length) : '';
  const claim = (text) => { const box = { _scContent: text, _scM: null, got: [] }; box._scAdd = (k, s) => box.got.push(k); vm.createContext(box); vm.runInContext(stmt, box); return box.got[0] || null; };
  check('lead 2108628902: "...isn’t in stock today, but we do have other Tacoma options" -> unavailable', () => claim('Test, the 2026 Tacoma SR Double Cab you asked about isn’t in stock today, but we do have other Tacoma options.'), 'unavailable');
  check('"is not in stock" / "no longer in stock" -> unavailable; control: "is here and showing available" -> available', () =>
    [claim('The Tacoma is not in stock right now.'), claim('That trim is no longer in stock.'), claim('The 2027 Kia Telluride S is here and showing available.')], ['unavailable', 'unavailable', 'available']);
  const sc = built(TOY({ selfClaims: { unavailable: { ms: Date.parse('2026-11-02T09:27:00-06:00'), date: '11/02/2026', text: 'the 2026 Tacoma SR Double Cab you asked about isn’t in stock today, but we do have other Tacoma options' } } }));
  check('the prompt says WE SAID IT IS NOT IN STOCK, and not to write as though it is here', () =>
    [/WE SAID IT IS NOT IN STOCK: "the 2026 Tacoma SR Double Cab/.test(sc.p), /WE SAID IT WAS AVAILABLE/.test(sc.p), /^- THE NEWEST THING WE TOLD THEM ABOUT THIS VEHICLE IS THAT IT IS NOT IN STOCK\./m.test(sc.p)], [true, false, true]);

  console.log(' 4. at render:');
  const guard = (text, ch, lsd) => { run('lastScrapedData = ' + JSON.stringify(lsd || { store: 'Audi Lafayette', dealerId: '21135' }) + ';');
    const ol = sb.console.log; const logs = []; sb.console.log = (...a) => logs.push(a.join(' ')); try { return { out: run('_lpHouseGuard')(text, ch), log: logs.join('\n') }; } finally { sb.console.log = ol; } };
  check('lead 2108640226: "the Crystal Black Pearl Ridgeline you viewed is ready" -> "the Crystal Black Pearl Ridgeline is ready"', () =>
    guard('Test, the Crystal Black Pearl Ridgeline you viewed is ready for you to see.' + SIG, 'sms').out, 'Test, the Crystal Black Pearl Ridgeline is ready for you to see.' + SIG);
  check('control: "the Ridgeline you viewed in person Saturday" and "you looked at" are left alone', () => {
    const a = 'Test, the Ridgeline you viewed in person Saturday is still here.' + SIG, b = 'Test, the Ridgeline you looked at is still here.' + SIG;
    return [guard(a, 'sms').out === a, guard(b, 'sms').out === b]; }, [true, true]);
  check('lead 2108597971: "Since you’re handling this remotely, I can send ..." -> "I can send ..." (email); mid-sentence after the name too', () =>
    [guard('Hi Test,\n\nSince you’re handling this remotely, I can send a video walkaround of the Telluride S.\n\nAgent Name', 'email').out,
     guard('Test, since you’re out of state, we can start with a video walkaround.' + SIG, 'sms').out],
    ['Hi Test,\n\nI can send a video walkaround of the Telluride S.\n\nAgent Name', 'Test, we can start with a video walkaround.' + SIG]);
  check('lead 2108656923: "We have it here, and Audi Lafayette is open until 7 today." goes', () =>
    guard('Test, I understand transportation is hard right now. We have it here, and Audi Lafayette is open until 7 today. Would a call help?' + SIG, 'sms').out,
    'Test, I understand transportation is hard right now. Would a call help?' + SIG);
  check('lead 2108459212: "You’re welcome to see it in person Monday through Saturday, 9 AM to 7 PM." goes', () =>
    guard('Test, what feature matters most to you? You’re welcome to see it in person Monday through Saturday, 9 AM to 7 PM.' + SIG, 'sms', { store: 'Community Honda Lafayette', dealerId: '24399' }).out,
    'Test, what feature matters most to you?' + SIG);
  check('control: they asked about hours -> the hours stay', () => {
    const x = 'Test, we are open Monday through Saturday, 9 AM to 7 PM.' + SIG;
    return guard(x, 'sms', { store: 'Audi Lafayette', dealerId: '21135', lastInboundMsg: 'What are your hours?' }).out === x; }, true);
  check('the Fullpath block tells the model never to say what they viewed', () =>
    src.indexOf("lines.push('- What they opened or viewed is how we know what to talk about, never something to say: no \"you viewed\"") > 0, true);

  console.log(' 5. the signer\'s own name and title:');
  const oa = src.indexOf('    // Light-touch SMS opener check'), ob = src.indexOf('\n    })();', oa);
  const opener = (sms, agent) => { const box = { String, RegExp, rawSms: sms, lastScrapedData: { name: 'Test Buyer', agent: agent }, console: { log() {} } };
    vm.createContext(box); vm.runInContext(src.slice(oa, ob + '\n    })();'.length), box); return box.rawSms; };
  check('lead 2108656923: the draft opened "<agent>, I understand ..." with the signer\'s name -> the customer\'s name, not both', () =>
    opener('Agentname, I understand not having a way to get here makes this difficult.', 'Agentname Rep'), 'Test, I understand not having a way to get here makes this difficult.');
  check('control: a draft without a name still gets the customer\'s prepended -- and "I" stays "I", "The" becomes "the"', () =>
    [opener('I understand this is difficult.', 'Agentname Rep'), opener('The Sportage is here.', 'Agentname Rep')], ['Test, I understand this is difficult.', 'Test, the Sportage is here.']);   // and "I" stays "I"
  const sa = src.indexOf('  function enforceSmsSig(sms) {'), sigFn = src.slice(sa, src.indexOf('\n  }\n', sa) + 4);
  const sig = new Function('window', 'lastScrapedData', 'DEALER_ID_MAP', 'selectedStore', 'lookupPhone', 'console', sigFn + '\nreturn enforceSmsSig;')(
    { _leadProResolvedSigner: { firstName: 'Agentname', name: 'Agentname Rep', title: 'Audi Concierge', phone: '(555) 010-0100' } },
    { dealerId: '21135', totalNoteCount: 2, leadAgeDays: 1 }, { '21135': 'Audi Lafayette' }, '', () => '', { log() {} });
  check('"Agentname, your Concierge" above the signature is not kept: the name appears once', () =>
    (sig('Test, the Sportage is here. Would you like me to arrange a call?\nAgentname, your Concierge').match(/Agentname/g) || []).length, 1);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
