#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('offer-asked-867.test.js');
// (v9.7.867) OWNER-APPROVED 11/10 ("build 867, leave the certified hybrid out"). Toyota Baytown lead 2113204072 (log417, source
// "Rct-Request A Quote"): the manufacturer's site sent the offer the customer clicked -- 3.99% APR for 48 months on the 2026
// Tacoma i-FORCE MAX, ending 11/30 -- as fields in the lead note. The scraper's tool-data rule told the model the customer "has
// not raised the subject ... move the conversation toward a real appraisal", the store's own offer list (which has the same line)
// stayed out of a first touch, and the draft asked "What trim and color are you after?".
// Executes _lpOfferRecord, populateFromData and buildUserPrompt through the panel payload, the powertrain reader and the
// rewrite's instructions, on the block exactly as it was captured (it holds offer fields only, no customer data).
//
// Usage: node tests/offer-asked-867.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
const panelPayload = require('./helpers/panel-payload.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: offer-asked-867.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const pad = (n) => String(n).padStart(2, '0');
const at = (daysAgo, clock) => { const d = new Date(Date.now() - daysAgo * 86400000); return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear() + ' ' + clock; };
const md = (days) => { const d = new Date(Date.now() + days * 86400000); return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear(); };
const iso = (days) => new Date(Date.now() + days * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const E = (date, tag, title, body) => '[' + date + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (date) => '[' + date + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
// The scraper's block, as captured on lead 2113204072 (the end date is set relative to today so the suite does not age).
const REC = (ends, info, veh) => '[Customer Comments] Offer Type: apr Vehicle: ' + (veh || '2026 Tacoma i-FORCE MAX') + ' Offer Info: ' + (info || '3.99% for 48 Months') + ' Offer End Date: ' + ends
  + ' Offer URL: www.toyota.com%2fgst%2fdeals-i... ::REFERRING URL:: www.toyota.com%2fgst%2fdeals-i... Show Less';
const TOOL = (inner) => 'TOOL-SUPPLIED DEAL DATA — NOT THE CUSTOMER\'S WORDS. The online tool wrote these fields when the customer used it. The customer did not type them, has not quoted them to us, and has not raised the subject:\n"'
  + inner + '"\nThese are the TOOL\'S UNVERIFIED ESTIMATE, not figures this store has confirmed. Do NOT quote them back to the customer, do NOT state them as fact, and do NOT build the message around them — the rule that real trade and '
  + 'payment numbers are produced in person applies to these exactly as it applies to price. Use them only as background for what the customer is working with, and move the conversation toward a real appraisal.';
const PAGE = '[Customer Comments]\nOffer Type: apr | Vehicle: 2026 Tacoma i-FORCE MAX | Offer Info: 3.99% for 48 Months | Offer End Date: 11/30/2026 | Offer URL: www.toyota.com%2fgst%2fdeals-i... ::REFERRING URL:: www.toyota.com%2fgst%2fdeals-i...';
const U_ = (stock, vehicle, model, color, cond, year) => ({ stock, vin: '', vehicle, year, make: 'Toyota', model, condition: cond, certified: cond === 'cpo', class: 'Truck, Small Pick-up', body: '4D Crew Cab',
  color, interior: 'Black', odometer: 10, daysOnLot: 30, price: 42000, stockNum: stock });
const INC = (model, line, expires) => ({ model, year: '2026', line: model + ' — ' + line, expires });

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb, src; try { sb = loadPopup(f, { withAuth: true }); src = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const run = (e) => { try { return vm.runInContext(e, sb); } catch (x) { return undefined; } };
  const fn = (n) => run('typeof ' + n + ' === "function" ? ' + n + ' : null');
  const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
  const go = (lsd) => quiet(() => { try { run('activeFlags = new Set(); leadContext = "";'); sb.__L = lsd; run('lastScrapedData = globalThis.__L;'); sb.populateFromData(lsd); const ctx = String(run('leadContext') || '');
      return { d: lsd, ctx, prompt: String(sb.__lp.buildUserPrompt(panelPayload(src, sb, { lsd: lsd, context: ctx }))) }; } catch (e) { return { d: lsd, ctx: '', prompt: 'THREW ' + e.message }; } });
  const TB = run('Object.keys(DEALER_ID_MAP).filter(function (k) { return /toyota/i.test(String(DEALER_ID_MAP[k])); })[0]') || '6189';
  const feed = (units, incs) => { sb.__U = units; sb.__I = incs; run('_lpValueFactCache["' + TB + '"] = { vf: { store: "Toyota Baytown", incentives: globalThis.__I }, inv: { units: globalThis.__U, generated: new Date().toISOString() }, invSettledAt: Date.now(), fetchedAt: Date.now() };'); };
  const SR5 = [U_('TEST0T1', '2026 Toyota Tacoma SR5', 'Tacoma SR5', 'Ice Cap', 'new', 2026), U_('TEST0T2', '2026 Toyota Tacoma SR5', 'Tacoma SR5', 'Underground', 'new', 2026), U_('TEST0T3', '2026 Toyota Tacoma SR5', 'Tacoma SR5', 'Black', 'new', 2026)];
  const CPO = U_('TEST0T4', '2026 Toyota Tacoma Hybrid TRD Off Road', 'Tacoma Hybrid TRD Off Road', 'Mudbath', 'cpo', 2026);
  const INCS = [INC('Tacoma', '3.99% APR for 48 mos', iso(20)), INC('Tacoma', '4.99% APR for 60 mos', iso(20)), INC('Tacoma i-FORCE MAX', '3.99% APR for 48 mos', iso(20)), INC('Tacoma i-FORCE MAX', '5.99% APR for 72 mos', iso(20)),
    INC('Tacoma i-FORCE MAX', '$449/mo 36 mo lease ($3,999 due at signing) — applies to 4WD TRD Sport i-FORCE MAX', iso(20))];
  const BOT = 'By: Assistant Name Virtual Assistant Community Toyota Hi Test, thanks for your interest! Would you be able to come in for a test drive?';
  const lead = (brief, x) => { const h = E(at(0, '8:15 AM'), 'AGENT', 'Outbound Text Message', BOT) + MARK(at(0, '8:14 AM'));
    return Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Toyota Tacoma', vehicleRaw: '2026 Toyota Tacoma', condition: 'New', dealerId: TB,
      store: 'Community Toyota Baytown', leadSource: 'Rct-Request A Quote', convState: 'first-touch', leadAgeDays: 0, hasOutbound: true, hasCustomerReply: false, totalNoteCount: 8, phone: '(555) 010-0199', email: 'test@example.com',
      lastInboundMsg: '', relationshipSignals: { unansweredQuestions: [], lastInboundAgeDays: null }, outboundSends: [{ body: BOT, date: at(0, '8:15 AM') }], customerState: 'TX',
      conversationBrief: brief + '\n\n' + h, history: h, context: '' }, x || {}); };

  console.log(' 1. the offer record:');
  const rec = fn('_lpOfferRecord');
  check('the block as the scraper wrote it -> type, vehicle, terms, end date, and whose site it was',
    () => rec ? rec(TOOL(REC('11/30/2026'))) : 'no helper', { type: 'apr', vehicle: '2026 Tacoma i-FORCE MAX', info: '3.99% for 48 Months', ends: '11/30/2026', site: 'Toyota' });
  check('the same record as the page shows it, with the pipes', () => { const r = rec ? rec(PAGE) : null; return r && [r.type, r.vehicle, r.info, r.ends]; }, ['apr', '2026 Tacoma i-FORCE MAX', '3.99% for 48 Months', '11/30/2026']);
  check('control: a trade estimator\'s fields are not an offer record', () => rec ? rec(TOOL('Trade Value: $12,400 Vehicle: 2019 Honda Civic Payoff: $3,000 Monthly Payment: $450')) : 'no helper', null);
  check('"i-FORCE MAX" reads as a hybrid, like the feed\'s "Tacoma Hybrid"; control: a Tacoma SR5 is gas',
    () => [run('_lpPowertrainOf("2026 Tacoma i-FORCE MAX")'), run('_lpPowertrainOf("2026 Toyota Tacoma Hybrid TRD Off Road")'), run('_lpPowertrainOf("2026 Toyota Tacoma SR5")')], ['Hybrid', 'Hybrid', 'Gas']);

  console.log(' 2. lead 2113204072: the offer is in the store\'s list, and no new one of that truck is on the lot:');
  feed(SR5.concat([CPO]), INCS);
  const END = md(20), g1 = go(lead(TOOL(REC(END))));
  check('the prompt opens its context with the offer they requested a quote on, named with its end date',
    () => g1.ctx.indexOf('💲 THE OFFER THEY REQUESTED A QUOTE ON: on Toyota\'s website this customer picked one offer and asked for a quote on it -- the 2026 Tacoma i-FORCE MAX, 3.99% APR for 48 months, ending ' + END + '.') === 0
      && /That offer is why they wrote in, so the message is about it: name the offer in the first sentence, and do not ask what they are interested in as if they had not said\./.test(g1.prompt), true);
  check('...the tool-data block is gone: no "has not raised the subject", no "toward a real appraisal"',
    () => [/TOOL-SUPPLIED DEAL DATA/.test(g1.prompt), /has not raised the subject/.test(g1.prompt), /toward a real appraisal/.test(g1.prompt)], [false, false, false]);
  check('...the store\'s own offer list confirms it: for well-qualified buyers, never promise the rate',
    () => /- The store's own current offer list confirms it \("Tacoma i-FORCE MAX — 3\.99% APR for 48 mos", expires \d{4}-\d\d-\d\d\)\. State it as an offer for well-qualified buyers, subject to credit approval -- never promise the rate -- and give its end date\./.test(g1.prompt), true);
  check('...what is on the lot: no new 2026 Tacoma i-FORCE MAX; three new SR5s, and the same rate applies to them',
    () => /- On the lot today \(this store's inventory feed, new units\): no new 2026 Tacoma i-FORCE MAX\. Say so plainly, once\. New 2026 Tacoma here: SR5 x3 -- and the store's offer list has the same 3\.99% APR for 48 months on the Tacoma, so the rate they saw applies to these too\. Ask which they would rather/.test(g1.prompt), true);
  check('...the certified hybrid is left out (owner, 11/10)', () => [/TRD Off Road/.test(g1.ctx.split('AGENT CONTEXT')[0]), /Pre-owned and certified units are not part of this offer and are not offered against it\./.test(g1.prompt)], [false, true]);
  check('...the first touch keeps its light ask (no times)', () => /FIRST HUMAN TOUCH — LIGHT ASK, NO TIMES/.test(g1.prompt), true);
  check('populateFromData a second time on the same lead keeps the offer (the block was already taken off)',
    () => { const again = go(g1.d); return [(again.ctx.match(/THE OFFER THEY REQUESTED A QUOTE ON/g) || []).length, /TOOL-SUPPLIED/.test(again.prompt)]; }, [1, false]);
  const rf = fn('_lpBuildSmsRefinePrompt');
  check('the text rewrite is told to keep the offer, and never promise the rate',
    () => { const p = quiet(() => rf ? String(rf('Test, the 3.99% APR for 48 months on the 2026 Tacoma i-FORCE MAX runs through the end of the month for qualified buyers.\nAgent', 'Subject: x\n\nHi Test,\n\nSame.\n\nAgent Name', g1.d)) : 'no helper');
      return /━━━ THE OFFER THEY ASKED ABOUT ━━━\nThey requested a quote on one offer: the 2026 Tacoma i-FORCE MAX, 3\.99% APR for 48 months, ending [\d/]+\. When the first draft names the offer, the text names it too, in its own first sentence\. It never promises the rate/.test(p); }, true);

  console.log(' 3. the other shapes:');
  feed(SR5.concat([U_('TEST0T5', '2026 Toyota Tacoma Hybrid TRD Sport', 'Tacoma Hybrid TRD Sport', 'Wind Chill Pearl', 'new', 2026)]), INCS);
  check('a new one IS on the lot -> it is named, with its paint', () => /- On the lot today \(this store's inventory feed, new units\): Tacoma Hybrid TRD Sport \(Wind Chill Pearl\)\. You may name these; never give a stock number or a price\./.test(go(lead(TOOL(REC(END)))).prompt), true);
  feed(SR5, [INC('Tacoma', '4.99% APR for 60 mos', iso(20))]);
  const g3 = go(lead(TOOL(REC(END))));
  check('the store\'s list does not have that offer -> "the offer you saw on Toyota\'s website", to be confirmed, the rate not stated as ours',
    () => [/- The store's offer list does not show this exact offer, so call it "the offer you saw on Toyota's website" and say you will confirm it applies to them\. Do not state the rate as ours\./.test(g3.prompt),
      /confirms it/.test(g3.prompt), /so the rate they saw applies to these too/.test(g3.prompt)], [true, false, false]);
  feed(SR5, INCS);
  check('an end date that has passed -> not presented as current',
    () => { const p = go(lead(TOOL(REC(md(-3))))).prompt; return [/- Its end date \([\d/]+\) has passed: do not present it as current\./.test(p), /confirms it/.test(p)]; }, [true, false]);
  feed([], INCS);
  check('no inventory in hand -> the offer is still named; nothing is said about the lot', () => { const p = go(lead(TOOL(REC(END)))).prompt; return [/THE OFFER THEY REQUESTED A QUOTE ON/.test(p), /On the lot today/.test(p)]; }, [true, false]);
  feed(SR5, INCS);
  const TRADE = TOOL('Trade Value: $12,400 Vehicle: 2019 Honda Civic Payoff: $3,000 Monthly Payment: $450');
  check('control: a trade estimator\'s tool data keeps its block and gets no offer line',
    () => { const p = go(lead(TRADE)).prompt; return [/TOOL-SUPPLIED DEAL DATA/.test(p), /THE OFFER THEY REQUESTED A QUOTE ON/.test(p)]; }, [true, false]);
  check('control: a lead with no tool data is unchanged', () => /THE OFFER THEY REQUESTED A QUOTE ON|THE OFFER THEY ASKED ABOUT/.test(go(lead('')).prompt), false);
}
console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
