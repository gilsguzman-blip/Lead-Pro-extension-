#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('missed-appt-775.test.js');
// (v9.7.775) log298, Honda Lafayette lead 2091288708. An appointment was set for Saturday 10/3 and missed; on 10/6 the
// assistant texted "We noticed you missed your appointment ... I have availability Wednesday at 10:00 AM or Thursday";
// on 10/8 the customer answered a rep's intro with "Okay". The draft: "I can check whether the $1,000 offer fits the new
// Honda you have in mind." Three causes, three fixes:
//  (1) the appointment scan tested the REMINDER pattern first, and "your appointment ... Wednesday" matched, so the
//      missed-appointment notice was filed as a reminder 2 days old -> hasApptSet -> "THERE IS A LIVE APPOINTMENT".
//  (2) the no-show counter took "missed appointment" and "missed the appointment", not "missed your appointment".
//  (3) the claimed-offer line said "Lead with that" even on a follow-up, inside a wrapper saying not to present it again.
// Then Gil: "why is there a conflict in the logic to acknowledge or not ... so we won't have contradicting logic moving
// forward with other scenarios?" -- the audit fixes that ship with it, tested here too:
//  (4) the no-show line and APPOINTMENT FELL THROUGH each own their own miss: one on THIS lead is acknowledged, lightly;
//      one from earlier history stays unmentioned.
//  (5) a kept appointment is not a live one: a showroom visit at or after the reminder clears hasApptSet.
//  (6) the visit decision: the strongest hold on the visit (no ask / no times / not today) is decided once on the finished
//      prompt, and every push line that contradicts it is removed or neutralised.
// Executes the shipped appointment block (lifted as appt-booked-727 does), the shipped no-show pattern (lifted from
// its line), the shipped _lpImxOfferGuidance, renderRelationshipReading, _lpApplyVisitDecision and buildUserPrompt.
// Placeholder data only.
//
// Usage: node tests/missed-appt-775.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: missed-appt-775.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const H = 3600000, NOW = Date.now();
const fmt = (ms) => { const f = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  .formatToParts(new Date(ms)).reduce((o, p) => (o[p.type] = p.value, o), {}); return f.month + '/' + f.day + '/' + f.year + ' ' + f.hour + ':' + f.minute + ' ' + f.dayPeriod.toUpperCase(); };
const note = (hoursAgo, dir, title, content) => ({
  getAttribute: (k) => (k === 'data-direction' ? dir : null),
  querySelector: (sel) => ({ innerText: /title/.test(sel) ? title : /content/.test(sel) ? content : /date/.test(sel) ? fmt(NOW - hoursAgo * H) : '' }) });
const REMIND = 'Sent to: (555) 010-0199 Sent by: Agent Name Test quick reminder of our appointment on Saturday at 5:00 PM';
const MISSED = 'Sent to: (555) 010-0199 Sent by: Vinessa Virtual Assistant Community Honda Hi! We noticed you missed your appointment with us at Community Honda Lafayette. No worries life happens! Do you want to reschedule? I have availability Wednesday at 10:00 AM or Thursday at 10:00 AM.';
const INTRO = 'Sent to: (555) 010-0199 Sent by: Rep Name Hi, this is Rep Name with Community Honda. I wanted to introduce myself and see if you are still looking for a vehicle.';
const OKAY = 'Received from: (555) 010-0199 Okay';
for (const f of BUILDS) {
  const src = fs.readFileSync(f, 'utf8');
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const a = src.indexOf('    var apptTimeline = [];'), b = src.indexOf("      _lpD('[Lead Pro] Appointment timeline error:', apptErr);\n    }", a);
  const block = src.slice(a, b) + "      _lpD('[Lead Pro] Appointment timeline error:', apptErr);\n    }\n"
    + '    return { hasMissedAppt: hasMissedAppt, hasApptSet: hasApptSet, timeline: apptTimeline };\n';
  const run = (notes, visitHoursAgo) => { const sb = { noteEls: notes, convState: 'active-follow-up', _lpD: () => {}, Date, Math, Infinity, String, RegExp,
      _lastVisitMs: visitHoursAgo == null ? 0 : NOW - visitHoursAgo * H };
    vm.createContext(sb); const r = vm.runInContext('(function(){\n' + block + '})()', sb); return Object.assign(r, { timeline: r.timeline.map(t => t.slice(0, 44)) }); };

  console.log(' 1. the appointment scan:');
  const k = run([note(0.1, 'inbound', 'inbound text message', OKAY), note(0.2, 'outbound', 'outbound text message', INTRO),
                 note(48, 'outbound', 'outbound text message', MISSED), note(144, 'outbound', 'outbound text message', REMIND)]);
  check('lead 2091288708 shape: the "you missed your appointment ... Wednesday" notice is a MISSED appointment, not a live one', () => [k.hasMissedAppt, k.hasApptSet], [true, false]);
  check('...and the timeline calls it that (not "Agent sent appointment reminder")', () => k.timeline.some(t => /missed-appointment re-engagement/.test(t)) && !k.timeline.some(t => /reminder \(2 days ago\)/.test(t)), true);
  const solo = run([note(48, 'outbound', 'outbound text message', MISSED)]);
  check('the store saying "you missed your appointment" counts even with no reminder note in view (the assistant included)', () => [solo.hasMissedAppt, solo.hasApptSet], [true, false]);
  check('control: a real reminder naming a day is still a live appointment', () => { const r = run([note(20, 'outbound', 'outbound text message', 'Sent by: Agent Name Test, your appointment is Wednesday at 10:00 AM. Reply C to confirm.')]); return [r.hasApptSet, r.hasMissedAppt]; }, [true, false]);
  check('control: "sorry we missed your call ... Wednesday" is not a missed appointment', () => run([note(20, 'outbound', 'outbound text message', 'Sent by: Vinessa Virtual Assistant Community Honda Sorry we missed your call! Would Wednesday at 10:00 AM work?')]).hasMissedAppt, false);

  console.log(' 2. the no-show counter:');
  const line = src.split('\n').find(l => /sig\.priorNoShows\+\+|\\bno\.\?show\\b\|\\bdidn/.test(l) && /missed/.test(l)) || '';
  const lits = line.match(/\/\\bno\.\?show\\b[^\n]*?\/i/);
  const NS = lits ? new Function('return ' + lits[0])() : /(?!)/;
  check('"we noticed you missed your appointment" registers a no-show (the relationship read said noShow: false)', () => NS.test('hi! we noticed you missed your appointment with us'), true);
  check('...as do "missed the appointment", "no-show", "never showed"; "missed your call" does not', () =>
    [NS.test('customer missed the appointment'), NS.test('no-show today'), NS.test('he never showed'), NS.test('sorry we missed your call')], [true, true, true, false]);

  console.log(' 3. the claimed offer on a follow-up:');
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const G = (opts) => sb._lpImxOfferGuidance('claimed the website offer "$1,000 OFF MSRP on All New Hondas! Limited Time Savings on All New Inventory"', '', '', opts);
  check('a follow-up: no "Lead with that"; it is background and never the opener', () => { const g = G({ followUp: true }); return [/Lead with that/.test(g), /background on a follow-up: mention it only in support of what this message is about, never as its opener/.test(g)]; }, [false, true]);
  check('control: a first touch still leads with the offer', () => /Lead with that, and find out which model and trim/.test(G({ firstTouch: true })), true);
  check('a follow-up on an offer of another shape: "if you mention it", not "lead with"', () => {
    const g = sb._lpImxOfferGuidance('claimed the website offer "Free oil changes for a year"', '', '', { followUp: true }); return [/Lead with THAT/.test(g), /If you mention it, use its own words/.test(g)]; }, [false, true]);
  check('the scenario passes followUp on a follow-up', () => /firstTouch: !imFollowUp, followUp: !!imFollowUp,/.test(src), true);

  console.log(' 4. one owner per miss (relationship reading vs APPOINTMENT FELL THROUGH):');
  // the scraper's signal object, as it starts (sig = {...}), with one no-show
  const RS = { consecutiveOutboundNoReply: 0, lastInboundAgeDays: 0, totalInboundCount: 3, totalOutboundCount: 6, leadOutboundCount: null,
    priorAppointmentsTotal: 1, priorNoShows: 1, frustrationSignals: [], priorPricingObjections: [],
    topicMentions: { trade: { count: 0, mentions: [] }, financing: { count: 0, mentions: [] }, configuration: { count: 0, mentions: [] },
      distance: { count: 0, mentions: [] }, useCase: { count: 0, mentions: [] }, competitor: { count: 0, mentions: [] } },
    customerCommitments: [], agentCommitments: [], unansweredQuestions: [], personalContext: [], channelFatigue: false,
    hasNoShowHistory: true, hasFrustrationHistory: false, hasPricingFriction: false, hasRecurringTopic: false, hasOpenCommitments: false,
    hasUnansweredQuestions: false, hasPersonalContext: false };
  const rr = (x) => { const ol = sb.console.log; sb.console.log = () => {}; try { return sb.renderRelationshipReading(Object.assign({ relationshipSignals: RS, leadAgeDays: 10, totalNoteCount: 12 }, x)); } finally { sb.console.log = ol; } };
  check('a miss on THIS lead: acknowledged lightly, and nothing says not to reference it', () => { const t = rr({ hasMissedAppt: true, freshestApptEventDays: 5 });
    return [/The appointment on THIS lead was missed\. Acknowledge it lightly and without blame/.test(t), /Do NOT reference the no-show/.test(t)]; }, [true, false]);
  check('a no-show from earlier history (older than this lead): still not referenced', () => { const t = rr({ hasMissedAppt: true, freshestApptEventDays: 40 });
    return [/Do NOT reference the no-show directly/.test(t), /THIS lead was missed/.test(t)]; }, [true, false]);
  check('no miss on this lead at all: the history rule, as before', () => /1 prior no-show appointment\(s\) on file\. Do NOT reference the no-show directly/.test(rr({ hasMissedAppt: false })), true);

  console.log(' 5. a kept appointment is not a live one:');
  check('reminder 30h ago, then a showroom visit 20h ago: the appointment was kept, not upcoming', () => { const r = run([note(30, 'outbound', 'outbound text message', REMIND)], 20);
    return [r.hasApptSet, r.timeline.some(t => /^Appointment kept/.test(t))]; }, [false, true]);
  check('control: a visit 40h ago, then a reminder for a NEW appointment 30h ago, stays live', () => run([note(30, 'outbound', 'outbound text message', REMIND)], 40).hasApptSet, true);
  check('control: no visit at all, the reminder stays live', () => run([note(30, 'outbound', 'outbound text message', REMIND)]).hasApptSet, true);
  check('the newest reminder sets the comparison: an older kept one does not clear a newer live one', () =>
    run([note(10, 'outbound', 'outbound text message', REMIND), note(50, 'outbound', 'outbound text message', REMIND)], 30).hasApptSet, true);

  console.log(' 6. the visit decision has one owner:');
  const AV = (t) => sb._lpApplyVisitDecision(t);
  const STATUS = 'STORE STATUS RIGHT NOW: OPEN. Store closes at 8:00 PM -- 5 hours left today. OFFER THE SOONEST REAL OPENING FIRST: today is the default, lead with a today time.';
  const SLOTS = 'SUGGESTED APPOINTMENT TIMES (fallback only -- use the customer\'s own day first):\n- Today at 4:15 PM\n- Tomorrow at 10:30 AM';
  const STALL = 'DO NOT offer appointment times. DO NOT write duration. Re-engage softly.';
  const P2 = ['CURRENT TIME: Thursday 3:00 PM', STATUS, 'STALLED LEAD RE-ENGAGEMENT:', STALL, SLOTS, '(5) Close with two specific appointment times.', 'END'].join('\n');
  check('(new helper) a stalled lead: level 2, owner named, the today default, the slots and the two-times close are gone', () => { const r = AV(P2);
    return [r.level, r.owner, /OFFER THE SOONEST REAL OPENING FIRST|today is the default/.test(r.text), /SUGGESTED APPOINTMENT TIMES|Today at 4:15 PM/.test(r.text), /Close with two specific/.test(r.text),
      /^STORE STATUS RIGHT NOW: OPEN\. Store closes at 8:00 PM -- 5 hours left today\.$/m.test(r.text), /^VISIT DECISION FOR THIS MESSAGE: no specific appointment times[^\n]*the stalled-lead re-engagement block owns this/m.test(r.text), /^END$/m.test(r.text)]; },
    [2, 'the stalled-lead re-engagement block', false, false, false, true, true, true]);
  check('(new helper) level 3 (deal condition) beats level 2 and drops the hand-off\'s "When they come in"', () => { const r = AV(['CURRENT TIME: x', 'HARD RULE: do NOT offer an appointment time until the condition is met.', STALL,
      '(4) HAND OFF to the sales rep: When they come in, Rep Name will walk them through it.'].join('\n'));
    return [r.level, r.owner, /When they come in/.test(r.text), /\(4\) HAND OFF to the sales rep: Rep Name will walk/.test(r.text)]; }, [3, 'the DEAL CONDITION rule', false, true]);
  check('(new helper) level 1 (cannot come today): same-day examples go, tomorrow slots stay', () => { const r = AV(['CURRENT TIME: x', 'TIMING NOTE: Customer said they cannot come in TODAY.',
      'TIMING — AFTERNOON: Lead with a time this afternoon.', '- e.g. 4:15 PM today', SLOTS].join('\n'));
    return [r.level, /TIMING — AFTERNOON|4:15 PM today/.test(r.text), /SUGGESTED APPOINTMENT TIMES/.test(r.text)]; }, [1, false, true]);
  check('(new helper) a hold quoted inside a note or the transcript does not count', () => AV(['CURRENT TIME: x', '[10/07/2026 9:00 AM] [AGENT] Outbound Text Message',
      '  DO NOT offer appointment times. DO NOT write duration.', STATUS, SLOTS].join('\n')).level, 0);
  check('(new helper) no hold: the prompt is returned unchanged', () => { const t = ['CURRENT TIME: x', STATUS, SLOTS, '(5) Close with two specific appointment times.'].join('\n'); const r = AV(t); return [r.level, r.text === t]; }, [0, true]);

  const VISITBRIEF = '[10/07/2026 12:14 PM] [SHOWROOM VISIT]\n  By: Rep Name\n  Wants to think about it overnight.\n[10/07/2026 9:00 AM] [AGENT] Outbound Text Message\n  Hi Test.';
  const SHOW = { name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Honda CR-V EX', dealerId: '24399',
    store: 'Community Honda Lafayette', leadSource: 'Showroom', convState: 'active-follow-up', leadAgeDays: 1, isShowroomFollowUp: true,
    showroomDetails: 'By: Rep Name\nWants to think about it overnight.', conversationBrief: VISITBRIEF, hasOutbound: true, totalNoteCount: 6,
    phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '', relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: 0 }, context: '' };
  const up = (() => { const ol = sb.console.log; sb.console.log = () => {}; try { return sb.__lp.buildUserPrompt(SHOW); } catch (e) { return 'THREW ' + e.message; } finally { sb.console.log = ol; } })();
  check('the built prompt for a showroom follow-up: "the visit already happened" with no slot block and no two-times close beside it', () =>
    [/The visit already happened\. Do NOT push a same-day appointment or offer times/.test(up), /^SUGGESTED APPOINTMENT TIMES/m.test(up), /OFFER THE SOONEST REAL OPENING FIRST/.test(up), /\(5\) Close with two specific appointment times/.test(up)],
    [true, false, false, false]);
  check('...and it states the decision once, naming the showroom block as its owner', () => (up.match(/VISIT DECISION FOR THIS MESSAGE: [^\n]*the SHOWROOM FOLLOW-UP block owns this/g) || []).length, 1);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
