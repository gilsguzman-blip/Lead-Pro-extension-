#!/usr/bin/env node
'use strict';
// (v9.7.697) STEP-2 BUILD — one regression per fix, EXECUTING shipped code wherever it can be lifted
// out cleanly, and labelled "source" where only a structural check is honest. Run against v9.7.696
// it fails on every fix (non-vacuity is reported in the build header).
//
// Usage: node tests/step2-697.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs');
const path = require('path');

const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: step2-697.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const slice = (src, a, b, what) => {
  const i = src.indexOf(a); if (i < 0) throw new Error((what || a.slice(0, 40)) + ' NOT FOUND');
  const j = src.indexOf(b, i + a.length); if (j < 0) throw new Error((what || a.slice(0, 40)) + ' END NOT FOUND');
  return src.slice(i, j + b.length);
};
const fn = (src, name) => slice(src, 'function ' + name + '(', '\n}\n', name);
const code = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
function note(date, title, content, dir) {
  const map = { '.notes-and-hsitory-item-date': { innerText: date }, '.legacy-notes-and-history-title': { innerText: title },
                '.notes-and-history-item-content': { innerText: content, textContent: content } };
  return { getAttribute: (k) => (k === 'data-direction' ? (dir || '') : null), querySelector: (s) => map[s] || null };
}

for (const f of BUILDS) {
  const src = fs.readFileSync(f, 'utf8');
  const C = code(src);
  const isA = src.indexOf('\n  function inlineScraper() {'), isB = src.indexOf('\n  } // end inlineScraper');
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));

  // ── SOURCES ────────────────────────────────────────────────────────────────────────────
  console.log(' sources:');
  const ack = () => new Function(src.slice(src.indexOf('var _LP_CUSTOMER_FACING_SOURCES = ['), src.indexOf('\n];', src.indexOf('var _LP_CUSTOMER_FACING_SOURCES = [')) + 3)
    + '\n' + slice(src, 'var _LP_NON_WEB_ORIGIN', ';\n') + '\n' + slice(src, 'var _LP_ACK_FRAMES', '\n};\n')
    + '\n' + fn(src, '_lpSourceAckPhrase') + '\nreturn _lpSourceAckPhrase;')();
  check('TradePending resolves to its own name, not the "your online inquiry" catch-all (Ashlee, Kia)', () => ack()('Tradepending').name, 'TradePending');
  check('control: Facebook still resolves to Facebook', () => ack()('Facebook').name, 'Facebook');
  check('the dedicated-source skip applies only while the source\'s own first-touch framing runs (source)',
    () => /if \(_ackDedicated && !\(sc\.isFollowUp && hasRealOutbound\)\)/.test(C), true);
  check('a continuing thread that never named the source now names it once, in passing (source)',
    () => /name the source once, in passing/.test(C), true);
  check('the SMS refine keeps a brand/place source name the first draft carried, or ships the first draft (source)',
    () => /it named where the customer came from/.test(C) && /KEEP WHERE THEY CAME FROM/.test(C), true);
  check('Facebook\'s "yes it is here" needs the feed (source)',
    () => /var _fbConfirmedPresent = !!data\.stockNum && !!data\._lpInvConfirmedAvailable/.test(C), true);

  // ── DISTANCE / REMOTE ──────────────────────────────────────────────────────────────────
  console.log(' remote buyers:');
  check('no suggested times or TIMING block for a remote buyer (source: the appointment gate reads isRemoteBuyer)',
    () => /&& !closeOverride && !isZeroContactStalled && !isRemoteBuyer\) \{/.test(C), true);

  // ── H1 / channel preference (scraper detector, executed) ───────────────────────────────
  console.log(' H1 channel preference detector (scraper, executed):');
  const cp = (body) => new Function('noteEls', slice(src, "    var customerChannelPref = '';", "} catch (eCp) { customerChannelPref = ''; }", 'channel pref detector') + '\nreturn customerChannelPref;')(
    [note('09/20/2026 3:00 PM', 'Inbound Text Message', 'Received from: (555) 010-0199\n' + body, 'inbound')]);
  check('"I would prefer to text only" is carried as a channel preference', () => /prefer to text only/.test(cp('I would prefer to text only')), true);
  check('"please don\'t call me, I\'m at work" too', () => /don't call/.test(cp("please don't call me, I'm at work")), true);
  check('"Is the Civic still there?" is not a channel preference', () => cp('Is the Civic still there?'), '');

  // ── H2 ─────────────────────────────────────────────────────────────────────────────────
  console.log(' H2:');
  check('the zero-contact block carries no A3 examples, no GOOD/BAD lines', () => /still have the A3 here|Is the A3 still on your radar|GOOD EMAIL CLOSE/.test(C), false);

  // ── H3 (executed) ──────────────────────────────────────────────────────────────────────
  console.log(' H3 trade-conflation guard (executed):');
  const runTv = (d) => new Function('d', '_lpCustomerText', 'var vehicleExtras = [], console = { log: function(){} };\n' + slice(src, '  try {\n    // (v9.7.697) AUDIT H3.', '  } catch (eTv) {}', 'trade guard') + '\nreturn vehicleExtras.join("\\n");')(
    Object.assign({ hasTrade: false, pdPresent: true, pdTradeCount: 0, vehicle: '2026 Kia Carnival LX FWD' }, d), (x) => x.customerText || '');
  check('our own outbound "your trade" on a zero-reply lead no longer arms it',
    () => runTv({ conversationBrief: '[08/11/2026 1:32 PM] [AGENT] Email reply to prospect\n  One thing I cannot do in a message is your trade', customerText: '' }), '');
  check('an agent call note "looking to trade in" still arms it',
    () => /TRADE DISCUSSED/.test(runTv({ conversationBrief: '[09/17/2026 11:37 AM] [CALL NOTE] Outbound phone call (Contacted)\n  By: Agent\n  looking to trade in', customerText: '' })), true);
  check('...without claiming the notes already contain the conflation when they do not',
    () => /earlier notes in this thread DO contain it|THE TRANSCRIPT ITSELF CARRIES THIS ERROR/.test(runTv({ conversationBrief: '[09/17/2026 11:37 AM] [CALL NOTE] Outbound phone call (Contacted)\n  By: Agent\n  looking to trade in', customerText: '' })), false);
  check('when a note DOES attach the Carnival to the trade, it says so',
    () => /THE TRANSCRIPT ITSELF CARRIES THIS ERROR/.test(runTv({ conversationBrief: '[09/17/2026 11:37 AM] [CALL NOTE] Outbound phone call (Machine)\n  By: Agent\n  left vm about the trade value on the Carnival', customerText: 'can you give me a trade in number' })), true);

  // ── H4 ─────────────────────────────────────────────────────────────────────────────────
  console.log(' H4:');
  check('first-touch and active Director modes clear the stall email/voicemail examples (source)',
    () => (C.match(/_voiceExampleEmail = ''; _voiceExampleVoicemail = '';/g) || []).length, 2);
  check('the active example asserts nothing about inventory', () => /the Blueprint with graphite is here/.test(C), false);
  check('every example is labelled tone-only', () => (C.match(/— for TONE only, not content: /g) || []).length, 3);
  const auth = fs.readFileSync(path.join(path.dirname(f), 'auth.js'), 'utf8');
  check('auth.js persona examples: no real vehicle names, no "is here", no "Matthew"',
    () => /exampleSms: "[^"]*(?:Pilot|Civic|Telluride|is here)|example(?:Email|Voicemail): "[^"]*(?:Pilot|Civic|Telluride|still here|is here|Matthew)/.test(auth), false);

  // ── H5 (executed filter) ───────────────────────────────────────────────────────────────
  console.log(' H5:');
  const bp = (content) => new Function('content', slice(src, "        var _bpBody = content.replace(", "/callmeasurement\\.com/i.test(content);", 'boilerplate test') + '\nreturn isBoilerplate;')(content);
  check('"By: Agent\\nno answer" is boilerplate now', () => bp('By: Agent Name\nno answer'), true);
  check('"By: Agent\\nLeft message- day 1" is boilerplate', () => bp('By: Agent\nLeft message- day 1'), true);
  check('a real call note is kept', () => bp('By: Agent\nsaid she is talking with her sales rep already'), false);
  check('thresholds and the displayed SITUATION count read the scraper tally (source)',
    () => /sbHungUp && sbAttemptsN >= 3/.test(C) && /sbAttemptsN >= 5 && sbContacted === 0/.test(C) && /'📋 SITUATION: ' \+ sbAttemptsN/.test(C), true);

  // ── N1 / N2 ────────────────────────────────────────────────────────────────────────────
  console.log(' N1 / N2:');
  check('bounce notices and call-tracking rows are not outreach (source)', () => /var _rsNoise = /.test(C), true);
  const fat = (streakLead, ageD, known) => new Function('sig', '_lpLeadCreatedMs', 'Date',
    slice(src, '      var _fatLeadAgeD = ', "sig.channelFatigue = _fatStreak >= 3 && (_fatLeadAgeD === null || _fatLeadAgeD >= 3);", 'fatigue') + '\nreturn sig.channelFatigue;')(
    { consecutiveOutboundNoReply: 14, leadConsecutiveOutboundNoReply: streakLead }, known ? 1000 : null, { now: () => 1000 + ageD * 86400000 });
  check('14 outbound on a 1-day-old lead is NOT channel fatigue', () => fat(14, 1, true), false);
  check('the same streak on a 5-day-old lead is', () => fat(14, 5, true), true);
  check('a prior lead\'s streak does not count on a fresh lead (lead streak 0)', () => fat(0, 5, true), false);
  check('ONE-SIDED needs the lead to be 3+ days old (source)', () => /_outreachN >= 8 && _osAge >= 3/.test(C), true);

  // ── N3 (executed) ──────────────────────────────────────────────────────────────────────
  console.log(' N3 bounced email:');
  const eb = (notes, markerMs) => new Function('noteEls', '_lpMarkerMs', '_lpD',
    slice(src, '    var emailBounce = null;', '} catch (eEb) { emailBounce = null; }', 'bounce scan') + '\nreturn emailBounce;')(notes, markerMs || 0, () => {});
  check('two "Email Failure" notes on this lead are counted', () => (eb([
      note('09/23/2026 8:57 AM', 'Email Failure', 'Subject: Your 2021 Kia Stinger Awaits By: System Bounced Address', 'outbound'),
      note('09/22/2026 9:03 AM', 'Email Failure', 'Subject: Panthera Metal Stinger GT-Line By: System Bounced Address', 'outbound')]) || {}).count, 2);
  check('a prior lead\'s bounce is not', () => eb([note('01/02/2025 9:00 AM', 'Email Failure', 'Bounced Address', 'outbound')], new Date('09/21/2026 10:00 PM').getTime()), null);
  const emLine = (d) => new Function('data', 'return (' + slice(src, '    data.email\n      ? (data.emailBounce && data.emailBounce.count', ": 'Email:      ' + data.email + '  ← customer email already on file. Do NOT ask for their email address.')\n      : ''", 'email line').trim() + ');')(d);
  check('on a bouncing lead the LEAD section asks for a good address in the SMS, and drops "do NOT ask"',
    () => { const t = emLine({ email: 'redacted@example.com', emailBounce: { count: 2, lastDate: '09/23/2026 8:57 AM' } });
            return /BOUNCING/.test(t) && /In the SMS, ask them once, plainly, for a good email address/.test(t) && !/Do NOT ask for their email/.test(t); }, true);
  check('control: a working address keeps "already on file"', () => /already on file\. Do NOT ask/.test(emLine({ email: 'redacted@example.com' })), true);
  check('the refine pass keeps the email ask, or ships the first draft (source)',
    () => /KEEP THE EMAIL ASK/.test(C) && /emails are bouncing and the rewrite dropped the ask/.test(C), true);
  check('a bounce notice is never "our last substantive message" (source)',
    () => /if \(\/email failure\|bounced\/i\.test\(niOutTitle\) \|\| \/bounced address\/i\.test\(niOutBody\)\) continue;/.test(C), true);

  // ── N4 (executed) ──────────────────────────────────────────────────────────────────────
  console.log(' N4:');
  const own = (x) => new Function(fn(src, '_lpIsOurOwnSend') + '\nreturn _lpIsOurOwnSend;')()(x);
  check('an Email Failure notice (which repeats OUR subject line) is ours', () => own('[09/23/2026 8:57 AM] [AGENT] Email Failure'), true);
  check('control: a customer text is not', () => own('[09/23/2026 8:57 AM] [CUSTOMER] Inbound Text Message'), false);

  // ── N6 ─────────────────────────────────────────────────────────────────────────────────
  console.log(' N6:');
  check('the no-vehicle line no longer hard-codes "Telluride, Crown, Optima"', () => /Do not mention Telluride, Crown, Optima/.test(C), false);
  check('the "no trade" subject directive is gated on no trade being listed (source)', () => /!data\.vehicle && !hasCustomerReply && !data\.hasTrade && !data\.tradeDescription/.test(C), true);
  check('"acknowledge the silence plainly" is offered only on a lead 2+ days old (source)', () => /\(parseFloat\(data\.leadAgeDays \|\| 0\) >= 2\) \? 'acknowledge the silence plainly, OR '/.test(C), true);
  check('self-claims are taken only from this lead\'s notes (source)', () => /if \(content && !firstLeadReceivedSeen && \/\\boutbound\\b/.test(C), true);
  const arc = (x) => new Function(fn(src, '_lpBuildArcSpine') + '\nreturn _lpBuildArcSpine;')()(x);
  check('the arc lists a General Note once, not twice',
    () => { const ctx = '[09/22/2026 9:02 AM] [NOTE] General Note\n  By: Agent NO DUPE\n[09/22/2026 9:05 AM] [AGENT] Outbound Text Message\n  Hi\n[09/22/2026 9:02 AM] [NOTE] General Note\n  By: Agent NO DUPE';
            return (arc(ctx).match(/NO DUPE/g) || []).length; }, 1);

  // ── P2 (executed regex) ────────────────────────────────────────────────────────────────
  console.log(' P2:');
  const exitLine = () => slice(src, '    var exitRaw = smsOptOutIsExit || ', ';', 'exitRaw');
  check('exitRaw reads customer lines only (recentInbound)', () => /\.test\(recentInbound\)$/.test(exitLine().replace(/;$/, '')), true);
  const exitRe = { test: (t) => { const l = exitLine(); return new Function('return ' + l.slice(l.indexOf('/'), l.lastIndexOf('.test(')))().test(t); } };
  check('"I found one on your website I really like" is not an exit', () => exitRe.test('i found one on your website i really like'), false);
  check('"We decided to go with the Highlander" is not an exit', () => exitRe.test('we decided to go with the highlander, when can we sign?'), false);
  check('"had a bad experience at another dealer" is not an exit', () => exitRe.test('had a bad experience at another dealer so i want this easy'), false);
  check('control: "we bought elsewhere" still is', () => exitRe.test('we already bought elsewhere, thanks'), true);

  // ── P3 (executed) ──────────────────────────────────────────────────────────────────────
  console.log(' P3:');
  const nt = (d) => new Function('d', 'var vehicleExtras = [];\n' + slice(src, "  if (d.customerSaidNotToday && d.customerScheduleConstraint\n", "Customer said today does not work.');", 'not-today line') + '\nreturn vehicleExtras.length;')(d);
  check('a day-lock regex hit alone no longer emits "today does not work"',
    () => nt({ customerSaidNotToday: true, customerScheduleConstraint: 'CUSTOMER SPECIFIED DAY: Customer said Saturday is when…' }), 0);
  check('the customer\'s own "not today" still does', () => nt({ customerSaidNotToday: true, customerSaidNotTodayExplicit: true, customerScheduleConstraint: 'CUSTOMER SPECIFIED DAY: …' }), 1);
  check('an out-of-town constraint still does', () => nt({ customerSaidNotToday: true, customerScheduleConstraint: 'OUT_OF_TOWN: Customer is out of town…' }), 1);

  // ── P4 / P5 / L1 / L4 ──────────────────────────────────────────────────────────────────
  console.log(' P4 / P5 / L1 / L4:');
  check('no RETURN VISIT PLANNED / CUSTOMER ALREADY VISITED tags on General Notes', () => /'⚠ RETURN VISIT PLANNED' : '⚠ CUSTOMER ALREADY VISITED'/.test(C), false);
  check('window._activeLeadDealerId is set from the PASS-1 active frame and reset per grab (source)',
    () => /window\._activeLeadDealerId = String\(d\.dealerId\)/.test(C) && /window\._activeLeadDealerId = null;/.test(C), true);
  const scr = C.slice(C.indexOf('function inlineScraper() {'), C.indexOf('} // end inlineScraper'));
  check('the four scraper diagnostics are relayed, not printed in the CRM tab',
    () => ["console.log('[LP CONTENT-TRUNCATION DIAG]", "console.log('[LP INCOMPLETE-NOTE DIAG]", "console.log('[LP SCHED SOURCE DIAG] day-lock SUPPRESSED", "console.log('[LP SPOUSE DIAG]"].some((t) => scr.indexOf(t) >= 0), false);
  check('the prompt no longer says to read a newest-first transcript "in chronological order"', () => /texts, emails, call notes, agent notes — in chronological order\./.test(C), false);

  // ── dump helper (executed) ─────────────────────────────────────────────────────────────
  console.log(' dump helper:');
  check('window._lpDumpLead() saves the captured inputs as a local JSON file',
    () => { const saved = []; const doc = { createElement: () => ({ click() { saved.push(this.download); } }), body: { appendChild() {}, removeChild() {} } };
            const w = { _lpLastPromptInputs: { promptData: { name: 'Test' } } };
            const r = new Function('window', 'document', 'Blob', 'URL', 'setTimeout', 'console', fn(src, '_lpDumpLead') + '\nreturn _lpDumpLead();')(
              w, doc, function () {}, { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, () => {}, { log() {} });
            return [r, /^leadpro_lead_dump_.*\.json$/.test(saved[0] || '')]; }, [true, true]);
  check('the generation stashes what buildUserPrompt was given (source)', () => /window\._lpLastPromptInputs = \{/.test(C) && /let userPrompt = buildUserPrompt\(_lpPromptInputData\);/.test(C), true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
