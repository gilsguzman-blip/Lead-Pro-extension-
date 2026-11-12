#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('transport-interior-806.test.js');
// (v9.7.806) FOUR LEADS FROM 10/21, AND THE INTERIOR COLOR THE DATA TOOL WAS DROPPING.
//  - Honda Baytown 2102985701 (TrueCar): "BUILD: 2026 Honda Prelude Hybrid Winter Frost Pearl / Black" is paint / interior; the
//    drafts said the black Prelude isn't in stock. The vAuto export has an Interior column the Data Tool never kept.
//  - Honda Baytown 2103597607: "Si lo compro podran traerlo hasta Maryland" -- the draft put it off ("once we've worked through
//    the vehicle details"). Gil, 10/21: they arrange the transport, we coordinate with the shipper; name a couple of companies.
//  - Honda Lafayette 2079590323: her only message was "Stop"; the email closed the inquiry and the voicemail refused to be one.
//  - Honda Lafayette 2065141269: "doesn't want to make an appointment unless she for sure can get approved" (10/5 call); every
//    draft pushed a gray Accord and a visit. The lead's color had been read as "option" from an email subject.
// Runs the SHIPPED Data Tool page and inlineScraper in Chromium, and executes _lpInteriorAsk, _lpWhatWeHave, _lpShipAsk,
// _lpShipperPair, _lpApprovalFirst, populateFromData, buildUserPrompt, _lpVisitDecision and _lpBuildSmsRefinePrompt.
// Placeholder data only.
//
// Usage: node tests/transport-interior-806.test.js <dev popup.js> <commercial popup.js> [datatool/index.html]
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
const TOOL = process.argv.slice(2).find(a => /\.html$/.test(a)) || path.join(__dirname, '..', 'datatool', 'index.html');
if (!BUILDS.length) { console.error('usage: transport-interior-806.test.js <popup.js> [popup.js...] [datatool.html]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = typeof fn === 'function' ? fn() : fn; } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

const E = (when, tag, title, body) => '[' + when + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = (when) => '[' + when + '] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const BASE = { autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', stockNum: '', vin: '', hasOutbound: true,
  hasCustomerReply: true, totalNoteCount: 9, phone: '(555) 010-0199', email: 'test@example.com', relationshipSignals: { unansweredQuestions: [] } };
const LEAD = (hist, x) => Object.assign({}, BASE, { history: hist, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + hist + '---' }, x || {});
const BUILD = 'Verified Prospect LEAD: BUILD (NEW) BUILD: 2026 Honda Prelude Hybrid Winter Frost Pearl / Black';
const PRELUDE = (x) => LEAD(E('10/20/2026 8:36 AM', 'AGENT', 'Outbound Text Message', 'Test, thanks for your request.') + MARK('10/19/2026 9:00 PM'),
  Object.assign({ vehicle: '2026 Honda Prelude Hybrid', color: 'Winter Frost Pearl', condition: 'New', dealerId: '6191', store: 'Community Honda Baytown', leadSource: 'Truecar/Truecar',
    convState: 'active-follow-up', leadAgeDays: 1, lastInboundMsg: BUILD, customerState: 'TX', customerZip: '77521' }, x));
const PU = (color, interior) => ({ stock: 'TX0001', vin: 'JHMBF1D66TEST0001', vehicle: '2026 Honda Prelude Base', year: 2026, make: 'Honda', model: 'Prelude Base', condition: 'new', color: color, interior: interior, price: 41174 });
const SHIPHIST = E('10/21/2026 9:20 AM', 'AGENT', 'Outbound Text Message', 'Hi Test, the 2021 Accord is a great choice.')
  + E('10/20/2026 9:15 PM', 'CUSTOMER', 'Inbound Text Message', 'Si lo compro podran traerlo hasta Maryland')
  + E('10/20/2026 9:14 PM', 'CUSTOMER', 'Inbound Text Message', 'Estoy en Maryland el Carro se ve en perfecto estado') + MARK('10/20/2026 9:10 PM');
const SHIP = (x) => LEAD(SHIPHIST, Object.assign({ vehicle: '2021 Honda Accord Sedan Touring', condition: 'Used', dealerId: '6191', store: 'Community Honda Baytown', leadSource: 'Cars.com',
  convState: 'active-follow-up', leadAgeDays: 0, lastInboundMsg: 'Si lo compro podran traerlo hasta Maryland', customerState: 'MD', customerZip: '21201' }, x));
const STOPHIST = E('10/20/2026 11:31 AM', 'AGENT', 'Outbound phone call (No Contact)', 'By: Agent Name no answer')
  + E('10/14/2026 11:45 AM', 'AGENT', 'Outbound Text Message', 'You have successfully been removed from Community Honda Lafayette text messages.')
  + E('10/14/2026 11:45 AM', 'CUSTOMER', 'Inbound Text Message', 'Stop')
  + E('10/14/2026 10:15 AM', 'AGENT', 'Outbound Text Message', 'Test, the door is open whenever you want to pick the Accord back up.') + MARK('09/07/2026 9:00 AM');
const STOPL = (x) => LEAD(STOPHIST, Object.assign({ vehicle: '2026 Honda Accord', condition: 'New', dealerId: '24399', store: 'Community Honda Lafayette', leadSource: 'Thirdparty Honda -',
  convState: 'active-follow-up', leadAgeDays: 44, lastInboundMsg: 'Stop', customerState: 'LA', customerZip: '70001' }, x));
const APFHIST = E('10/16/2026 5:31 PM', 'AGENT', 'Outbound Text Message', 'Test, here is my direct number if you have any questions.')
  + E('10/05/2026 12:49 PM', 'AGENT', 'Outbound Text Message', 'Hi Test, as discussed, here is the link to our secure finance application. Once you have completed it, just let me know.')
  + E('10/05/2026 12:44 PM', 'CUSTOMER', 'Inbound phone call', 'sending credit application over . she said she has bad credit and doesn\'t want to make an appointment unless she for sure can get approved')
  + E('08/24/2026 10:24 AM', 'CUSTOMER', 'Inbound Text Message', 'Sonic gray I really love the mustache') + MARK('08/10/2026 1:20 PM');
const APF = (hist, x) => LEAD(hist || APFHIST, Object.assign({ vehicle: '2026 Honda Accord LX', condition: 'New', dealerId: '24399', store: 'Community Honda Lafayette', leadSource: 'Thirdparty Honda -',
  convState: 'active-follow-up', leadAgeDays: 70, lastInboundMsg: 'Sonic gray I really love the mustache', customerState: 'LA', customerZip: '70001' }, x));

(async () => {
  const br = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }).catch(() => chromium.launch());

  console.log('\nthe Data Tool (' + path.basename(path.dirname(TOOL)) + '/' + path.basename(TOOL) + '): the Interior column is kept');
  {
    const page = await br.newPage();
    await page.route('**/*', r => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
    await page.goto('file://' + path.resolve(TOOL));
    const row = (vin, interior) => ({ 'Dealer Name': 'Community Honda TX', 'Vehicle': '2026 Honda Prelude Base', 'Stock #': 'TX' + vin.slice(-4), 'VIN': vin, 'Class': 'Car, Compact',
      'Body': '2D Hatchback', 'Color': 'Boost Blue Pearl', 'Interior': interior, 'Odometer': '10', 'Age': '20', 'Price': '41174', 'Cost': '38000', 'Book': '40000' });
    const res = await page.evaluate(rows => {
      try { invLoaded = [{ name: 'test.xlsx', pool: 'new', rows: rows }]; document.getElementById('inv-go').disabled = false; document.getElementById('inv-go').click();
        const u = invResult && invResult.stores['6191'] && invResult.stores['6191'].units; return u ? u.map(x => [x.interior, Object.keys(x).sort().join(',')]) : 'no result: ' + document.getElementById('inv-msg').textContent; }
      catch (e) { return 'THREW ' + e.message; } }, [row('JHMBF1D66TEST0001', 'Black Leather'), row('JHMBF1D66TEST0002', null)]);
    check('a unit carries its interior exactly as the export writes it ("Black Leather"); a blank one is null', () => Array.isArray(res) ? res.map(x => x[0]) : res, ['Black Leather', null]);
    check('...and cost, book and the other dealer-only columns are still left out', () => Array.isArray(res) ? res[0][1] : res,
      'body,certified,class,color,condition,daysOnLot,interior,make,model,odometer,price,stock,vehicle,vin,year');
    await page.close();
  }

  for (const f of BUILDS) {
    console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
    const src = fs.readFileSync(f, 'utf8');
    const sa = src.indexOf('  function inlineScraper() {'), sbx = src.indexOf('  } // end inlineScraper', sa);
    const scraper = src.slice(sa, sbx + 3);
    const scrape = async (html) => {
      const page = await br.newPage();
      await page.route('**/*', r => /\/CarDashboard\/lead$/.test(r.request().url()) ? r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }) : r.abort());
      await page.goto('https://crm.example.test/CarDashboard/lead', { waitUntil: 'domcontentloaded' });
      let res; try { res = await page.evaluate('(async()=>{' + scraper + '\n; return await inlineScraper();})()'); } catch (e) { res = { err: e.message }; }
      await page.close(); return res || {};
    };
    const note = (dir, when, title, body) => '<span class="notes-and-history-item list-group-item" data-tags="Email-Communication" data-direction="' + dir + '"><div class="notes-and-hsitory-item-date">' + when
      + '</div><div class="notes-and-hsitory-item-detail"><div class="notes-and-history-item-header"><div class="legacy-notes-and-history-title">' + title + '</div></div><div class="notes-and-history-item-content">' + body + '</div></div></span>';
    console.log(' 1. the scraper: an email subject is not the paint color');
    const sub = await scrape('<html><body><div id="notes">' + note('Outbound', '10/05/2026 12:31 PM', 'Email reply to prospect', '<div>Subject: Another Accord LX color option</div><div>By: Agent Name</div>Hi Test, would you consider this color?') + '</div></body></html>');
    check('lead 2065141269: "Subject: Another Accord LX color option" no longer makes the color "option"', [sub.color || '', sub.err || ''], ['', '']);
    const pan = await scrape('<html><body><div>Vehicle Info\n<div>Color: Wolf Gray</div>\n<div>Stock: TEST01</div></div><div id="notes"></div></body></html>');
    check('control: the vehicle panel\'s "Color: Wolf Gray" is still read', pan.color, 'Wolf Gray');

    let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
    const run = (e) => vm.runInContext(e, sb);
    const fn = (name) => { try { return run(name); } catch (e) { return null; } };
    const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
    const inv = (id, units) => { run('_lpValueFactCache')[id] = { inv: { units: units, generated: '2026-10-21' }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true }; };
    for (const id of ['6189', '6190', '6191', '24399']) inv(id, []);
    const prompt = (d) => quiet(() => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); sb.populateFromData(d); return sb.__lp.buildUserPrompt(Object.assign({}, d, { context: run('leadContext') })); });
    const level = (p) => { try { const r = run('_lpVisitDecision')(p); return [r.level, r.owner]; } catch (e) { return 'THREW ' + e.message; } };
    const rewrite = (d) => quiet(() => run('_lpBuildSmsRefinePrompt')('Test, pass one.', 'Hi Test,\n\nThe email.\n\nAgent Name', d));

    console.log(' 2. the interior they asked for, and the paint by its name:');
    const ia = fn('_lpInteriorAsk');
    check('TrueCar\'s "Winter Frost Pearl / Black" -- black is the interior, and the paint is read from what is left (new helper)', () => {
      const r = ia(BUILD); return r && [r.color, /\/\s*Black/.test(r.rest), /Winter Frost Pearl/.test(r.rest)]; }, ['black', false, true]);
    check('"black leather interior" and "black leather" are the interior; control: "a black Accord" is the paint (new helper)', () => [(ia('I want black leather interior') || {}).color, (ia('it needs black leather') || {}).color, ia('a black Accord')], ['black', 'black', null]);
    inv('6191', [PU('Boost Blue Pearl', 'Black Leather')]);
    const ww = quiet(() => fn('_lpWhatWeHave')(PRELUDE()));
    check('lead 2102985701: no Winter Frost Pearl -- the Prelude here is named, Boost Blue Pearl with its Black Leather interior',
      () => [/The 2026 Prelude in Winter Frost Pearl: NONE in stock today/.test(ww.text), /2026 Prelude Base \(Boost Blue Pearl, Black Leather interior\)\. You may name these/.test(ww.text)], [true, true]);
    check('...the black interior is said to be the inside, and never read as "the black Prelude isn\'t here"', () => [/The interior they asked for: black\. That is the inside of the car, not the paint/.test(ww.text), /in black: NONE|Prelude Hybrid in black/.test(ww.text)], [true, false]);
    check('...TrueCar\'s "Prelude Hybrid" is the feed\'s "Prelude Base" (the model only comes as a hybrid)', () => /They asked about the 2026 Prelude in Winter Frost Pearl\./.test(ww.text), true);
    check('a unit with no interior on record says nothing about one', () => { inv('6191', [PU('Boost Blue Pearl', null)]); const r = quiet(() => fn('_lpWhatWeHave')(PRELUDE())); return /\(Boost Blue Pearl\)\. You may name these/.test(r.text); }, true);
    check('control: a Civic "Hybrid" still means the hybrid Civics where the feed has both', () => {
      inv('6191', [{ vehicle: '2026 Honda Civic Sport', year: 2026, model: 'Civic Sport', condition: 'new', color: 'Crystal Black Pearl', price: 28995 },
        { vehicle: '2026 Honda Civic Hybrid Sport', year: 2026, model: 'Civic Hybrid Sport', condition: 'new', color: 'Crystal Black Pearl', price: 30995 }]);
      const r = quiet(() => fn('_lpWhatWeHave')(PRELUDE({ vehicle: '2026 Honda Civic Hybrid', color: '', lastInboundMsg: 'Do you have a black Civic Hybrid?' })));
      return r && [/IN STOCK -- 2026 Civic Hybrid Sport \(Crystal Black Pearl\)/.test(r.text), /IN STOCK[^\n]*2026 Civic Sport \(/.test(r.text)]; }, [true, false]);

    console.log(' 3. they asked how the car gets to them:');
    const sp = quiet(() => prompt(SHIP()));
    check('lead 2103597607: "traerlo hasta Maryland" is answered in this message -- they arrange the transport, we coordinate the pickup with the shipper',
      () => /THEY ASKED ABOUT GETTING THE CAR TO THEM: "Si lo compro podran traerlo hasta Maryland"[^\n]*they arrange the transport company, and we coordinate the pickup with the shipper/.test(sp), true);
    check('...two companies from the list are named, and only two', () => { const m = sp.match(/these two and no others: ([^.]*?) or ([^.]*?)\. Never/); const L = ['uShip', 'Ship That Car', 'Sherpa Auto Transport', 'Montway Auto Transport'];
      return !!m && L.includes(m[1]) && L.includes(m[2]) && m[1] !== m[2]; }, true);
    check('...the "late-stage topic / once we lock in the deal" lines stand down; "never say we deliver" is in', () => [/TRANSPORT\/SHIPPING IS A LATE-STAGE TOPIC|once we lock in the deal" lines|not a transport discussion at first touch/.test(sp.replace(/do not put it off \("once we lock in the deal"/, '')), /Never say we deliver it, ship it, bring it/.test(sp)], [false, true]);
    check('...the same pair every time for a lead; other leads get other pairs (new helper)', () => { const pr = fn('_lpShipperPair'); const a = pr({ autoLeadId: 'TEST001A' }).join('+');
      const seen = {}; ['TEST001A', 'TEST002B', 'TEST003C', 'TEST004D', 'TEST005E', 'TEST006F'].forEach(id => { seen[pr({ autoLeadId: id }).join('+')] = 1; });
      return [a === pr({ autoLeadId: 'TEST001A' }).join('+'), Object.keys(seen).length > 1]; }, [true, true]);
    check('...an English ask fires too ("Can you ship it to Ohio?"); control: "I\'ll come pick it up Saturday" and our own text about shipping do not', () => {
      const one = (body, tag) => fn('_lpShipAsk')(LEAD(E('10/20/2026 9:15 PM', tag || 'CUSTOMER', 'Inbound Text Message', body) + MARK('10/20/2026 9:10 PM')));
      return [!!one('Can you ship it to Ohio?'), !!one('I\'ll come pick it up Saturday'), !!one('We can help coordinate shipping to you.', 'AGENT')]; }, [true, false, false]);
    check('...and the text rewrite says it too, naming the same two', () => { const r = rewrite(SHIP()); const pr = fn('_lpShipperPair')(SHIP());
      return /THEY ASKED ABOUT GETTING THE CAR TO THEM/.test(r) && r.indexOf(pr[0] + ' or ' + pr[1]) >= 0; }, true);

    console.log(' 4. a STOP is the texts turning off, not their last word:');
    const stp = quiet(() => prompt(STOPL()));
    check('lead 2079590323: the email and voicemail are the normal next touch -- no mention of the STOP, no apology, no closing the inquiry over it',
      () => /THEIR NEWEST MESSAGE IS A "STOP" TO OUR TEXTS -- NOT SOMETHING THEY SAID TO US[^\n]*Do NOT mention it, acknowledge it, apologize for reaching out/.test(stp), true);
    check('...the text rewrite no longer shows "Stop" as what they last said, and is told not to answer it', () => { const r = rewrite(STOPL()); return [/WHAT THE CUSTOMER LAST SAID[^\n]*\n"Stop"/.test(r), /The STOP is not something to answer/.test(r)]; }, [false, true]);
    check('control: "Stop by tomorrow?" is a message, not a STOP', () => /TO OUR TEXTS -- NOT SOMETHING THEY SAID/.test(quiet(() => prompt(STOPL({ history: STOPHIST.replace('\n  Stop\n', '\n  Stop by tomorrow?\n'), lastInboundMsg: 'Stop by tomorrow?',
      conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + STOPHIST.replace('\n  Stop\n', '\n  Stop by tomorrow?\n') + '---' })))), false);

    console.log(' 5. they will not come in until they know they are approved:');
    const ap = quiet(() => prompt(APF()));
    check('lead 2065141269: the 10/5 call owns the message -- the application we sent, no visit, no promise of approval',
      () => /THEY WILL NOT COME IN UNTIL THEY KNOW WHERE THEY STAND ON FINANCING \(10\/05\)[^\n]*We sent them the finance application: ask, simply, whether they had a chance to complete it[^\n]*No visit ask and no appointment times\. Never promise or hint at an approval/.test(ap), true);
    check('...and the visit decision holds the visit entirely (level 3, owned by it)', () => level(ap), [3, 'the APPROVAL FIRST condition (no visit until they know)']);
    check('...the text rewrite is about the application too', () => /THEY WILL NOT COME IN UNTIL THEY KNOW WHERE THEY STAND ON FINANCING[\s\S]{0,40}The text is about their finance application/.test(rewrite(APF())), true);
    check('control: a later note that she got approved ends it', () => /WHERE THEY STAND ON FINANCING/.test(quiet(() => prompt(APF(E('10/08/2026 10:00 AM', 'NOTE', 'General Note', 'By: Agent Name she got approved, finance called her') + APFHIST)))), false);
    check('control: "I can come in once I\'m off work" is not a credit condition', () => fn('_lpApprovalFirst')(APF(E('10/05/2026 12:44 PM', 'CUSTOMER', 'Inbound Text Message', 'I can come in once I\'m off work') + MARK('08/10/2026 1:20 PM'))), null);
  }
  await br.close();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
