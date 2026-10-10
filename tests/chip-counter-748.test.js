#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('chip-counter-748.test.js');
// (v9.7.748) Kia Baytown lead 2086487722, 9/30 (log271, dump 2d800a4a). Two things on one generation:
//  (1) "Shorter" cut the first-pass text from 648 to 472 characters, and the SMS rewrite shipped 586: it was never told
//      a chip was pressed. Gil: "yes build the chip fix. fix it for all chips effected." The rewrite is now told which
//      chip is active, and where the chip's effect can be checked and the rewrite undid it, the first pass ships.
//  (2) The customer answered our $33,998.74 with "My Drive out price is $32,250", and the draft went back to "I can't
//      confirm $32,250 ... the $33,998.74 isn't confirmed for you". Gil: "keep working the counter before handing
//      off. Maybe something acknowledging the counter and that we will look into it". A counter now gets its own block.
// Executes the shipped _lpBuildSmsRefinePrompt / _lpRefineSms (worker call stubbed) and _lpPricePushback /
// buildUserPrompt. Placeholder data only.
//
// Usage: node tests/chip-counter-748.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), vm = require('vm'), path = require('path');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: chip-counter-748.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
function ago(days, hm) {
  const d = new Date(Date.now() - days * 86400000);
  return (d.getMonth() + 1 + '').padStart(2, '0') + '/' + (d.getDate() + '').padStart(2, '0') + '/' + d.getFullYear() + ' ' + hm;
}
const SIG = '\nAgent\nTest Store\n(555) 010-0100';
const EMAIL = 'Subject: Your Sorento\n\nHi Test,\n\nI am taking your number to my manager and will come back to you today with an answer.\n\nAgent Name';
const P1 = 'Test, I have your $32,250 and I am taking it to my manager now. What term are you thinking?' + SIG;
const LONGER = 'Test, I have your $32,250 and I am taking it to my manager now; the loyalty offer may apply and Kia Finance sets the APR after review. What term are you thinking?' + SIG;
const SHORTER = 'Test, taking your $32,250 to my manager now. What term?' + SIG;
const WITH_TIME = 'Test, I have your $32,250 and I am taking it to my manager. Would 1:30 PM today work?' + SIG;

(async () => {
  for (const f of BUILDS) {
    console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
    const src = fs.readFileSync(f, 'utf8');
    const span = (mark, endMark) => { const a = src.indexOf(mark); if (a < 0) return ''; return src.slice(a, src.indexOf(endMark || '\n}\n', a) + (endMark ? 0 : 2)); };
    const rule = (src.match(/^var _LP_SMS_SHAPE_RULE = '[^\n]*';$/m) || [''])[0];
    const chipHelpers = span('// ── (v9.7.748) A CHIP THE AGENT PRESSED MUST SURVIVE', '\nfunction _lpBuildSmsRefinePrompt(');
    const code = rule + '\n' + chipHelpers + '\n' + span('function buildSystemPromptSmsRefine(') + '\n' + span('function _lpBuildSmsRefinePrompt(') + '\n' + span('async function _lpRefineSms(');
    const run = (chip, reply, sticky) => {
      const logs = [];
      const sb = { String, JSON, Date, RegExp, Array, Math, Error, setTimeout, clearTimeout, AbortController,
        console: { log: (...x) => logs.push(x.join(' ')) },
        window: { _leadProResolvedSigner: { firstName: 'Agent', phone: '(555) 010-0100' }, _leadProResolvedContext: { storeName: 'Test Store' },
          _lpRegenChipKey: chip || '', _lpNoApptLeadId: sticky ? '2000000001' : '' },
        _regenDirectives: { shorter: 'Shorten the message.', 'no-appt': 'Remove the appointment ask entirely.' },
        getEndpoint: () => ({ url: 'https://example.invalid/generate' }), _lpAttachLicense: p => p,
        fetch: () => { const r = { json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sms: reply }) }] } }] }) };
          return Object.assign(Promise.resolve(r), { finally: fn => Promise.resolve(r).then(v => { fn(); return v; }) }); } };
      vm.createContext(sb); vm.runInContext(code, sb);
      sb.__d = { autoLeadId: '2000000001', lastInboundMsg: '', relationshipSignals: { unansweredQuestions: [] } };
      const prompt = vm.runInContext('_lpBuildSmsRefinePrompt(' + JSON.stringify(P1) + ', ' + JSON.stringify(EMAIL) + ', __d)', sb);
      return { prompt, out: vm.runInContext('_lpRefineSms(' + JSON.stringify(P1) + ', ' + JSON.stringify(EMAIL) + ', __d)', sb), logs };
    };

    console.log(' 1. the SMS rewrite keeps the chip the agent pressed:');
    const s1 = run('shorter', LONGER); const o1 = await s1.out;
    check('log271 shape: "shorter" pressed, the rewrite came back longer -> the first pass ships, logged', [o1, s1.logs.some(l => /kept the first pass — chip "shorter": the agent asked for it shorter and the rewrite came back longer/.test(l))], [null, true]);
    check('...and the rewrite was told: the chip, what it asked for, and not to lengthen it', [/THE AGENT ASKED FOR THIS ON THIS VERSION/.test(s1.prompt), /Shorten the message\. Do not make it any longer than the first draft/.test(s1.prompt)], [true, true]);
    check('control: "shorter" pressed and the rewrite is shorter still -> the rewrite ships', await run('shorter', SHORTER).out, SHORTER);
    const s2 = run('no-appt', WITH_TIME); const o2 = await s2.out;
    check('"no appointment" pressed, the rewrite put a time back -> the first pass ships', [o2, s2.logs.some(l => /chip "no-appt": the agent dropped the appointment ask and the rewrite put a time back/.test(l))], [null, true]);
    check('...and a no-appointment chip pressed earlier on this lead still holds for the rewrite', await run('', WITH_TIME, true).out, null);
    check('control: no chip pressed -> a rewrite with a time ships as before, and the rewrite hears of no chip', [await run('', WITH_TIME).out, /THE AGENT ASKED FOR THIS/.test(run('', WITH_TIME).prompt)], [WITH_TIME, false]);
    check('the other checkable chips: expand, lead-credit, lead-distance, lead-trade', (() => { try {
      const sb = {}; vm.createContext(sb); vm.runInContext(chipHelpers, sb);
      const br = (k, a, b) => !!vm.runInContext('_lpChipBroken', sb)(k, a, b);
      return [br('expand', 'x'.repeat(200), 'x'.repeat(100)), br('lead-credit', 'We can look at options.', 'Once you are approved we can look.'),
              br('lead-distance', 'Everything will be ready.', 'Worth the drive, everything will be ready.'), br('lead-trade', 'Bring your trade for a real number.', 'Come see the car.'),
              br('warmer', 'a', 'b')]; } catch (e) { return 'THREW ' + e.message; } })(), [true, true, true, true, false]);
    check('the chip handler stamps which chip this version carries and clears it after', [/window\._lpRegenChipKey = key;/.test(src), /window\._lpRegenChipKey = '';/.test(src)], [true, true]);

    console.log(' 2. a counter with their own number is worked, not hedged:');
    const sb = loadPopup(f, { withAuth: true });
    const BREAKDOWN = 'Hi Test, MSRP 37,100 Available Manufacture Rebates* -$3,000.00 Community Value Price $31,000.00 Community Repeat Customer^ -$250.00 Community Trade-In-Assistance+ -$500.00 Drive Out with all Incentives $33,998.74 *Must finance with Kia Finance';
    const FOLLOW = 'Hi Test, the $33,998.74 drive-out is the figure for the Sorento with all the incentives shown, subject to their terms. Where would the drive-out need to land for you?';
    const COUNTER = 'I will be financing thru KIA Finance. I do not have trade in. My Drive out price is $32,250. Please let me know the lowest apr. Regards From: Agent Name Sent: Tuesday';
    const ent = (days, tag, title, body) => '[' + ago(days, tag === 'CUSTOMER' ? '9:00 AM' : '5:44 PM') + '] [' + tag + '] ' + title + '\n  ' + body;
    const lead = (last, entries) => ({ name: 'Test Buyer', agent: 'Agent Name', phone: '(555) 010-0199', vehicle: '2026 Kia Sorento S', condition: 'New',
      dealerId: '6190', store: 'Community Kia Baytown', leadSource: 'Internet', convState: 'active-follow-up', leadAgeDays: 10,
      hasOutbound: true, hasCustomerReply: true, totalNoteCount: 12, relationshipSignals: { lastInboundAgeDays: 0 }, history: '', context: '',
      conversationBrief: entries.join('\n'), lastInboundMsg: last });
    const pp = (d) => { try { return sb._lpPricePushback(d); } catch (e) { return 'THREW ' + e.message; } };
    const d1 = lead(COUNTER, [ent(0, 'CUSTOMER', 'Email reply from prospect', COUNTER), ent(1, 'AGENT', 'Email reply to prospect', FOLLOW), ent(1, 'AGENT', 'Email reply to prospect', BREAKDOWN)]);
    const r1 = pp(d1);
    check('log271 shape: their $32,250 is read as a counter; our drive-out from the follow-up, the conditions from the breakdown', r1 && [r1.counter, r1.counterText, r1.otd, r1.items.length], [true, '32,250', '$33,998.74', 3]);
    const p1 = (() => { try { return sb.__lp.buildUserPrompt(d1); } catch (e) { return 'THREW ' + e.message; } })();
    check('the prompt: acknowledge their number, ours stands, taking it to the manager, conditions lined up, no visit ask', [
      /THEY COUNTERED WITH THEIR OWN NUMBER/.test(p1), /their number is \$32,250 \(\$1,748\.74 apart\)/.test(p1), /OUR NUMBER STANDS until we come back to them/.test(p1),
      /you are taking their \$32,250 to your manager to see what can be done/.test(p1), /Community Repeat Customer \(-\$250\.00\)/.test(p1),
      /No appointment time and no ask to come in until we have an answer for them; for this message that outranks any visit ask/.test(p1),
      /THEY PUSHED BACK ON THE PRICE WE SENT/.test(p1)], [true, true, true, true, true, true, false]);
    check('control (new field): our own figure said back is not a counter ("is $33,998.74 your final price?" -> the push-back block)', (() => {
      const r = pp(lead('Is $33,998.74 your final price?', [ent(0, 'CUSTOMER', 'Email reply from prospect', 'x'), ent(1, 'AGENT', 'Email reply to prospect', BREAKDOWN)]));
      return r && [r.counter, r.trigger]; })(), [false, 'final price']);
    check('control: a payoff on their trade is not a counter ("I owe $12,000 on my trade")', pp(lead('I owe $12,000 on my trade.', [ent(0, 'CUSTOMER', 'x', 'x'), ent(1, 'AGENT', 'Email reply to prospect', BREAKDOWN)])), null);
    check('control: they name a number but we never sent one -> nothing', pp(lead('My drive out price is $32,250.', [ent(0, 'CUSTOMER', 'x', 'x'), ent(1, 'AGENT', 'Email reply to prospect', 'Hi Test, the Sorento is here.')])), null);
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
