#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('teammate-825.test.js');
// (v9.7.825) THE CUSTOMER IS TALKING WITH US, A TEAMMATE ALREADY ANSWERED, A SECOND APPLICANT, AND THE EARLIER CHAPTER STAYS PUT.
// Honda Lafayette lead 2055144034 (log360, v9.7.824): the customer texted "Ok" and "Can you send 2 application"; a minute later the
// salesperson texted the finance-application link. The draft, signed by the BD agent, said "the application link I sent can be
// completed separately by each of the two applicants. You also asked about monthly payments ..." The phone-up block still said she
// "has not responded to multiple attempts"; the relationship reading quoted the July call note ("vehicles that only require monthly
// payments") as a recurring topic; nothing said who had sent the link. Gil, 10/26: "the link can be used by the second applicant or
// filled out jointly as a Co-buyer on the app."
// Builds the prompt through the shipped populateFromData and panel payload, and executes _lpCustomerTalking, _lpTeammateAnswered
// and _lpSecondApplicant through it. Placeholder data only.
//
// Usage: node tests/teammate-825.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: teammate-825.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const sure = (fn) => { try { return fn(); } catch (e) { return 'THREW: ' + e.message; } };
const M = 60000, H = 60 * M, D = 24 * H, NOW = Date.now();
const fmt = (ms) => { const f = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  .formatToParts(new Date(ms)).reduce((o, p) => (o[p.type] = p.value, o), {}); return f.month + '/' + f.day + '/' + f.year + ' ' + f.hour + ':' + f.minute + ' ' + f.dayPeriod.toUpperCase(); };
const E = (ms, tag, title, body) => '[' + fmt(ms) + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (ms) => '[' + fmt(ms) + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const LINK = 'https://www.example.test/finance-application/';
const T0 = NOW - 98 * D;
const JULY = 'called in- wanted to know if we have vehicles that only require monthly payments, stated that she will need to do a credit application, wanted one sent over to her';
const ASK = 'Can you send 2 application';
const LEAD = (o) => { o = o || {};
  const said = o.said || ASK, ansBy = o.ansBy || 'Rep Name', ans = o.noAnswer ? '' : E(NOW - 38 * M, 'AGENT', 'Outbound Text Message', o.noLink ? 'Test, I will get that over to you.' : LINK);
  const h = (o.silent ? E(NOW - 2 * D, 'AGENT', 'Outbound Text Message', 'Test, checking in from Test Honda. Agent') + E(NOW - 4 * D, 'AGENT', 'Outbound Text Message', 'Test, any questions on the application? Agent') : '')
    + ans + E(o.silent ? NOW - 10 * D : NOW - 39 * M, 'CUSTOMER', 'Inbound Text Message', said)
    + E(NOW - 48 * M, 'AGENT', 'Outbound Text Message', 'This is the link for the credit application. Once it is completed, just let me know and I will check on it for you.')
    + (o.noLink ? '' : E(NOW - 49 * M, 'AGENT', 'Outbound Text Message', LINK))
    + E(NOW - 65 * M, 'AGENT', 'Outbound Text Message', 'Good morning Test, this is Rep with Test Honda. What I can do to save you time is send over a credit app. Reply STOP to cancel.')
    + (o.noReact ? '' : E(NOW - 70 * M, 'NOTE', 'General Note', 'By: Agent Name User Agent Name has reactivated this lead with the following note: test'))
    + E(T0 + 4 * D, 'CUSTOMER', 'Inbound Text Message', 'I found me a vehicle')
    + E(T0 + 4 * M, 'AGENT', 'Outbound Text Message', 'Hi Test, this is Agent with Test Honda. This will be the link to our credit application. ' + (o.noLink ? '' : LINK + ' ') + 'Agent')
    + E(T0 + M, 'CUSTOMER', 'Inbound phone call', JULY) + MARK(T0);
  const mention = { sentence: JULY.slice(0, 140), date: fmt(T0 + M) };
  return Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '', dealerId: '24399', store: 'Test Honda',
    leadSource: 'Phone Up', convState: 'active-follow-up', leadAgeDays: 97, hasOutbound: true, hasCustomerReply: true, totalNoteCount: 28, phone: '(555) 010-0199',
    email: 'test@example.com', customerZip: '00000', lastInboundMsg: said, lastOutboundMsg: 'Sent to: (555) 010-0199\nSent by: ' + ansBy + '\n' + LINK, lastSubstantiveOutboundMsg: LINK,
    outboundSends: o.noAnswer ? [] : [{ title: 'outbound text message', ms: NOW - 38 * M, body: 'Sent to: (555) 010-0199\nSent by: ' + ansBy + '\n' + LINK }],
    relationshipSignals: { unansweredQuestions: [], customerCommitments: [], agentCommitments: [], lastInboundAgeDays: 0, totalInboundCount: 9, totalOutboundCount: 12, hasRecurringTopic: true,
      topicMentions: { financing: { count: 2, mentions: [mention, mention] } } },
    history: h, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + h + '---' }, o.x || {}); };

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => vm.runInContext(e, sb);
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const viaPanel = (lsd) => String(sure(() => quiet(() => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(lsd);
    return sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: run('leadContext') })); })));
  const p = viaPanel(LEAD());

  console.log(' 1. the customer is talking with us:');
  check('lead 2055144034: she texted 40 minutes ago -> the phone-up task says a live conversation, no "has not responded", no "acknowledge the silence"',
    [/TASK: Phone-up lead — the customer is in a live conversation with us \(their newest message is from [\d/]+\)\./.test(p), /has not responded/.test(p), /acknowledge the silence/.test(p)], [true, false, false]);
  const pS = viaPanel(LEAD({ silent: true }));
  check('control: her last message 10 days ago and two of ours since -> "has not responded" stands', /customer has not responded/.test(pS), true);

  console.log(' 2. a teammate already answered her newest message:');
  check('the salesperson sent the link a minute after her text -> it is his, never "I sent"',
    p.indexOf('↪ THEIR NEWEST MESSAGE WAS ALREADY ANSWERED: they wrote "' + ASK + '"') >= 0
      && p.indexOf('and Rep, their salesperson, answered it: "' + LINK + '". You did not send that -- never write "I sent", "the link I sent" or "my last message"; it is Rep\'s') >= 0, true);
  check('control: the signer answered it herself -> no line', /ALREADY ANSWERED/.test(viaPanel(LEAD({ ansBy: 'Agent Name' }))), false);
  check('control: nobody has answered yet -> no line', /ALREADY ANSWERED/.test(viaPanel(LEAD({ noAnswer: true }))), false);

  console.log(' 3. a second applicant (Gil, 10/26):');
  check('"Can you send 2 application" -> the same link, or jointly with the second person as the co-buyer',
    p.indexOf('👥 A SECOND APPLICANT: they wrote "' + ASK + '". The finance application covers that: the second person can use the same link (' + LINK + ') for their own application, '
      + 'or the two of them can fill it out together, with the second person added as the co-buyer on the application.') >= 0, true);
  check('"my husband needs to apply too" and "can my wife be a co-signer" are read the same way',
    [/A SECOND APPLICANT/.test(viaPanel(LEAD({ said: 'my husband needs to apply too' }))), /A SECOND APPLICANT/.test(viaPanel(LEAD({ said: 'can my wife be a co-signer' })))], [true, true]);
  check('control: "Can you send the application" (one applicant) -> no line', /A SECOND APPLICANT/.test(viaPanel(LEAD({ said: 'Can you send the application' }))), false);
  check('control: no finance-application link on the lead -> no line (nothing to point them to)', /A SECOND APPLICANT/.test(viaPanel(LEAD({ noLink: true }))), false);

  console.log(' 4. the earlier chapter stays background:');
  check('the July call note is not a recurring topic after the reactivation, and the reactivation line covers earlier calls and notes',
    [/RELATIONSHIP READING/.test(p), /RECURRING TOPICS IN THIS RELATIONSHIP/.test(p), /That includes what they said on earlier calls and in earlier notes \(payments, budget, credit\): never tell them they asked about it/.test(p)], [true, false, true]);
  check('control: no reactivation -> the financing topic is still listed', /Financing \/ credit \/ payment has come up 2 time\(s\)/.test(viaPanel(LEAD({ noReact: true }))), true);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
