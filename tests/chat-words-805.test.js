#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('chat-words-805.test.js');
// (v9.7.805) THE CHAT'S OWN WORDS, WHAT WE HAVE FOR THEM, AND THREE THINGS READ AS THE CUSTOMER'S THAT WERE NOT.
// Honda Lafayette lead 2102225210 (10/19): a Gubagoo chat -- "a Honda accord touring with a sunroof" / "Pre-owned" / "Black" --
// on a lead whose vehicle was the bot's placeholder ("2026 Honda Accord"). Nine drafts said "I can check for a pre-owned black
// Accord Touring" while the feed held no pre-owned Touring and two new 2026 Accord Hybrid Touring in Crystal Black Pearl; one
// answered the bot's own questions ("you can reach me at ..., my email is the one this message came from"). Gil, 10/19: "name
// the new one and ask which". Kia Baytown lead 2101887443: "Email is fineSent from Yahoo Mail for iPhoneOn Sunday, ... wrote:"
// locked Sunday as the customer's day. Honda Baytown lead 2102645799 (log332): a Fullpath "CONVERTED ON: Nurture Landing Page
// Nurture default ... Page converted on: Vehicle Trade-In Value" -- the voicemail said "You were looking at the Nurture page".
// Runs the SHIPPED inlineScraper in Chromium against placeholder lead pages, and executes _lpCustomerText, _lpWhatWeHave,
// _lpFullpath, populateFromData, buildUserPrompt and _lpBuildSmsRefinePrompt. Placeholder data only.
//
// Usage: node tests/chat-words-805.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), vm = require('vm');
const loadPopup = require('./helpers/load-popup.js');
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: chat-words-805.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = typeof fn === 'function' ? fn() : fn; } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

// ── placeholder lead pages, in VinSolutions' own note markup ──────────────────────────────────────────────────────────────
const note = (id, tags, dir, when, title, html) => '<span id="notes-and-history-item-' + id + '" data-tags="' + tags + '" data-direction="' + dir
  + '" data-unique-identifier-type="AutoLeadMessageID" data-unique-identifier-value="' + id + '" class="notes-and-history-item list-group-item">'
  + '<div class="notes-and-hsitory-item-date">' + when + '</div><div class="notes-and-hsitory-item-detail"><div class="notes-and-history-item-header">'
  + '<div class="legacy-notes-and-history-title">' + title + '</div></div><div class="notes-and-history-item-content">' + html + '</div></div></span>';
const PAGE = (notes) => '<html><body><div id="notes">' + notes.join('') + '</div></body></html>';
const T = (who, t, text) => who + ' (10/19/26 ' + t + ' am):<br> ' + text + ' <br>';
const CHAT = note('100000011', 'Email-Communication', 'Inbound', '10/19/2026 1:04 AM', 'Lead received', '<div>By: System</div><div> CUSTOMER INSIGHTS- ; CustomerComment : Click for Lead Info: '
  + '<a href="https://chat.example.test/l/x">chat.example.test%2fl%2fx...</a> <br>Lead Type: m-chat<br>Department: Used Vehicle Sales<br>Visitor Score: 1/10<br>'
  + 'Subject: Hi. I’m looking for a Honda accord touring with a sunroof<br><br>'
  + T('Guest', '00:46:38', 'Hi. I’m looking for a Honda accord touring with a sunroof') + T('System', '00:46:38', 'Sales notification sent')
  + T('Amelia', '00:46:38', 'Are you looking for a new or pre-owned vehicle?') + T('Guest', '00:46:59', 'Pre-owned')
  + T('Amelia', '00:47:00', 'Are there any additional special features or colors you would like?') + T('Guest', '00:47:25', 'Black')
  + T('Amelia', '00:47:47', 'Thanks Test, What\'s the best phone number to contact you on?') + T('Guest', '00:48:13', '(555) 010-0199')
  + T('Amelia', '00:48:13', 'Can you please provide your e-mail as well?') + T('Guest', '00:48:29', 'I don’t have one at the moment')
  + T('Amelia', '00:48:29', 'What day would you like to come in?') + '<br>Related Vehicles:</div>');
const CALL = note('100000012', 'Call', 'Outbound', '10/19/2026 8:49 AM', 'Outbound phone call (Machine)', '<div>By: Agent Name</div>Left message');
const FP = (msg) => note('100000021', 'Email-Communication', 'Inbound', '10/19/2026 5:32 PM', 'Lead received', '<div>By: System</div> CONVERTED ON:<br>Nurture Landing Page<br>Nurture default<br>'
  + (msg ? 'Customer message: ' + msg + '<br>' : '') + 'Lead Details: Click here to view complete lead information ( dashboard.example.test%2fleads... )<br>'
  + 'Page converted on: Vehicle Trade-In Value - Community Honda ( www.example.test%2fval... )');
const RUNON = note('100000031', 'Email-Communication', 'Inbound', '10/18/2026 5:35 PM', 'Email reply from prospect', '<div>Received from: test@example.com</div>'
  + 'Email is fineSent from Yahoo Mail for iPhoneOn Sunday, October 18, 2026, 3:27 PM, Test Assistant &lt;test@example.com&gt; wrote: Perfect, thanks Test! We will follow up with you via email.');
const OURS = note('100000032', 'Email-Communication', 'Outbound', '10/18/2026 3:27 PM', 'Email reply to prospect', '<div>By: Agent Name</div>Is there a best number or email to reach you?');

// ── placeholder inventory (Honda Lafayette) ──────────────────────────────────────────────────────────────────────────────
const U = (cond, year, vehicle, color, price) => ({ stock: 'TEST' + Math.random().toString(36).slice(2, 7), vehicle: vehicle, year: year, make: 'Honda',
  model: vehicle.replace(/^\d{4} Honda /, '').split(' ').slice(0, vehicle.indexOf('Hybrid') > 0 ? 2 : 1).join(' '), condition: cond, color: color, price: price });
const INV = [U('cpo', 2025, '2025 Honda Accord Hybrid Sport-L', 'Solar Silver Metallic', 31991), U('cpo', 2025, '2025 Honda Accord SE', 'Platinum White', 28891),
  U('cpo', 2024, '2024 Honda Accord LX', 'Platinum White Pearl', 23691),
  U('new', 2026, '2026 Honda Accord Hybrid Touring', 'Crystal Black Pearl', null), U('new', 2026, '2026 Honda Accord Hybrid Touring', 'Crystal Black Pearl', null),
  U('new', 2026, '2026 Honda Accord Hybrid Touring', 'Urban Gray Pearl', 38278), U('new', 2026, '2026 Honda Accord SE', 'Crystal Black Pearl', 30548),
  U('new', 2026, '2026 Honda Civic Sport', 'Crystal Black Pearl', 28995), U('new', 2026, '2026 Honda Civic Hybrid Sport', 'Crystal Black Pearl', 30995)];
const CHATBRIEF = '[10/19/2026 8:49 AM] [AGENT] Outbound phone call (Machine)\n  By: Agent Name Left message\n'
  + '[10/19/2026 1:04 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n'
  + '[CUSTOMER CHAT SUMMARY] Hi. I’m looking for a Honda accord touring with a sunroof Are you looking for a new or pre-owned vehicle?\n'
  + '[10/19/2026 1:04 AM] [GUBAGOO CHAT] Chat transcript:\n  [CHAT SUBJECT] Hi. I’m looking for a Honda accord touring with a sunroof\n'
  + '  [CUSTOMER] Hi. I’m looking for a Honda accord touring with a sunroof\n  [CHAT BOT] Are you looking for a new or pre-owned vehicle?\n  [CUSTOMER] Pre-owned\n'
  + '  [CHAT BOT] Are there any additional special features or colors you would like?\n  [CUSTOMER] Black\n  [CHAT BOT] What\'s the best phone number to contact you on?\n'
;
const OLDCHAT = '[05/02/2026 3:00 PM] [GUBAGOO CHAT] Chat transcript:\n  [CUSTOMER] I want a red Civic\n';
const LEAD = (x) => Object.assign({ autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Honda Accord',
  condition: 'Pre-Owned', stockNum: '', vin: '', dealerId: '24399', store: 'Community Honda Lafayette', leadSource: 'Hds Chat-Text Preowned Lead - Gubagoo - Chat Gubagoo - M-Chat',
  convState: 'first-touch', leadAgeDays: 0, hasOutbound: true, hasCustomerReply: false, totalNoteCount: 9, phone: '(555) 010-0199', email: '', customerState: 'LA', customerZip: '70001',
  lastInboundMsg: '', relationshipSignals: { unansweredQuestions: [] }, history: CHATBRIEF, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + CHATBRIEF + '---' }, x || {});
const FPNOTE = 'By: System CONVERTED ON: Nurture Landing Page Nurture default Lead Details: Click here to view complete lead information ( dashboard.example.test%2fleads... ) Page converted on: Vehicle Trade-In Value - Community Honda ( www.example.test%2fval... ) Show Less';
const FPMARK = '[10/19/2026 5:32 PM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const FPLEAD = (x) => LEAD(Object.assign({ vehicle: '2026 Honda Passport TrailSport', condition: 'New', dealerId: '6191', store: 'Community Honda Baytown', leadSource: 'FullPath',
  customerState: 'TX', customerZip: '77521', email: 'test@example.com', fullpathConversion: FPNOTE, history: FPMARK, conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + FPMARK + '---' }, x));
const EMAIL = 'Hi Test,\n\nI can help you get a value for your trade. What year, make and model is it?\n\nAgent Name\nCommunity Honda Baytown\n(555) 010-0100';

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
      await page.clock.install({ time: new Date('2026-10-19T17:40:00-05:00').getTime() });
      await page.goto('https://crm.example.test/CarDashboard/lead', { waitUntil: 'domcontentloaded' });
      let res; try { res = await page.evaluate('(async()=>{' + scraper + '\n; return await inlineScraper();})()'); } catch (e) { res = { err: e.message }; }
      await ctx.close(); return res || {};
    };

    console.log(' 1. the scraper: the chat bot\'s questions, a record field and a Fullpath note are not the customer\'s words:');
    const chat = await scrape([CALL, CHAT]);
    const uq = ((chat.relationshipSignals || {}).unansweredQuestions || []).map(q => q.question);
    check('lead 2102225210: the bot\'s "best phone number", "e-mail as well" and "What day would you like to come in?" are not open questions of theirs',
      [uq.some(q => /best phone number|e-mail as well|What day would you like/i.test(q)), chat.err || ''], [false, '']);
    check('...and "Lead Type: m-chat" is not their inquiry or their last message', [/Lead Type/i.test(chat.lastInboundMsg || ''), /\[CUSTOMER REQUEST FROM INQUIRY\] Lead Type/i.test(chat.history || '')], [false, false]);
    check('...the chat note tells the model the [CHAT BOT] lines are the widget\'s questions, already answered -- never to answer one', /\[CHAT BOT\] lines are the chat widget talking[\s\S]*never answer one/.test(chat.conversationBrief || ''), true);
    check('control: the customer\'s own chat turns still reach the transcript', [/\[CUSTOMER\] Pre-owned/.test(chat.history || ''), /\[CUSTOMER\] Black/.test(chat.history || '')], [true, true]);
    const fp0 = await scrape([FP('')]), fp1 = await scrape([FP('My credit is not that good')]);
    check('lead 2102645799: the Fullpath note is not their inquiry -- no CUSTOMER\'S INQUIRY, no last message', [fp0.lastInboundMsg || '', /CUSTOMER'S INQUIRY/.test(fp0.conversationBrief || '')], ['', false]);
    check('...but what they wrote in its "Customer message:" field is theirs', fp1.lastInboundMsg, 'My credit is not that good');
    check('control: the note is still kept whole for _lpFullpath', /CONVERTED ON: Nurture Landing Page[\s\S]*Page converted on: Vehicle Trade-In Value/.test(fp0.fullpathConversion || ''), true);
    const ro = await scrape([RUNON, OURS]);
    check('lead 2101887443: "Email is fineSent from Yahoo Mail for iPhoneOn Sunday, ... wrote:" -- no day is locked', [/Sunday/i.test(ro.customerScheduleConstraint || ''), ro.err || ''], [false, '']);
    check('...and no day is logged as LOCKED from that note',
      (ro._lpDiag || []).some(l => /SCHED/.test(l) && /Sunday|sunday/.test(l) && /LOCKED/.test(l)), false);

    console.log(' 2. the popup: the chat\'s words, and what we have for them:');
    let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
    const run = (e) => vm.runInContext(e, sb);
    const fn = (name) => { try { return run(name); } catch (e) { return null; } };
    const quiet = (g) => { const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {}; try { return g(); } finally { sb.console.log = ol; sb.console.warn = ow; } };
    const inv = (units) => { for (const id of ['24399', '6191']) run('_lpValueFactCache')[id] = { inv: { units: units, generated: '2026-10-19' }, vf: { incentives: [] }, fetchedAt: Date.now() - 5000, invSettledAt: Date.now() - 1000, _settled: true }; };
    inv(INV);
    const ct = fn('_lpCustomerText'), www = fn('_lpWhatWeHave');
    check('their chat turns are their words -- the lead\'s own chat, just below the marker: "touring", "Pre-owned", "Black"', () => {
      const t = quiet(() => ct(LEAD())); return [/accord touring/i.test(t), /Pre-owned/.test(t), /\bBlack\b/.test(t)]; }, [true, true, true]);
    check('...never the bot\'s turns, and not an older lead\'s chat further down ("a red Civic")', () => {
      const t = quiet(() => ct(LEAD({ conversationBrief: 'CONVERSATION TRANSCRIPT (newest first):\n---\n' + CHATBRIEF + OLDCHAT + '---' }))); return [/best phone number|new or pre-owned vehicle/i.test(t), /red Civic/.test(t), /\bBlack\b/.test(t)]; }, [false, false, true]);
    check('the trim comes from their words when the lead names none (new helper)', () => fn('_lpCustTrimFromWords')(INV, quiet(() => run('_lpModelFamilyKey'))('2026 Honda Accord'), 'a honda accord touring with a sunroof'), 'Touring');
    const ww = quiet(() => www(LEAD()));
    check('lead 2102225210: no pre-owned black Touring -- and the two new 2026 Accord Hybrid Touring in Crystal Black Pearl are named, as new, with the question which',
      () => [/The Accord Touring in black: NONE in stock today/.test(ww.text), /Brand NEW \(they asked for pre-owned\): 2026 Accord Hybrid Touring \(Crystal Black Pearl\) x2/.test(ww.text),
        /ask which they would rather: the new one, or for you to keep watching for a pre-owned Touring in black/.test(ww.text), /Urban Gray|SE \(/.test(ww.text)], [true, true, true, false]);
    check('...a pre-owned ask spans model years: the header is "THE ACCORD", not the bot\'s "2026"', () => /WHAT WE HAVE IN THE ACCORD RIGHT NOW/.test(ww.text), true);
    check('...and it reaches the prompt in place of "do not confirm the trim"', () => {
      const p = quiet(() => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); const d = LEAD(); sb.populateFromData(d); return sb.__lp.buildUserPrompt(Object.assign({}, d, { context: run('leadContext') })); });
      return [/INVENTORY: \S* ?WHAT WE HAVE IN THE ACCORD/.test(p), /Brand NEW \(they asked for pre-owned\)/.test(p)]; }, [true, true]);
    check('control: a pre-owned black Touring on the lot is the answer -- IN STOCK, and no new one is offered', () => {
      inv(INV.concat([U('cpo', 2024, '2024 Honda Accord Hybrid Touring', 'Crystal Black Pearl', 33991)])); const r = quiet(() => www(LEAD())); inv(INV);
      return [/IN STOCK -- 2024 Accord Hybrid Touring \(Crystal Black Pearl\)/.test(r.text), /Brand NEW/.test(r.text)]; }, [true, false]);
    check('a new-car lead for an "Accord Touring": the feed\'s "Accord Hybrid Touring" is that trim -- IN STOCK, not NONE', () => {
      const r = quiet(() => www(LEAD({ vehicle: '2026 Honda Accord Touring', condition: 'New', history: '', conversationBrief: '' })));
      return r && [/Touring: IN STOCK/.test(r.text), /NONE in stock/.test(r.text)]; }, [true, false]);
    check('control: a "Civic Sport" still means the gas Sport while the store has one (the Hybrid Sport is another trim)', () => {
      const r = quiet(() => www(LEAD({ vehicle: '2026 Honda Civic Sport', condition: 'New', history: '', conversationBrief: '' })));
      return r && [/IN STOCK -- 2026 Civic Sport \(Crystal Black Pearl\)\./.test(r.text), /Civic Hybrid Sport/.test(r.text)]; }, [true, false]);

    console.log(' 3. Fullpath: the page they opened, never the campaign\'s internal name:');
    const fpr = fn('_lpFullpath');
    check('lead 2102645799: what they opened is the trade-in value page; "Nurture Landing Page Nurture default" is kept aside as the campaign', () => {
      const r = fpr(FPLEAD()); return r && [r.kind, r.desc, r.campaign, r.trade]; }, ['page', 'the trade-in value page on our website', 'Nurture Landing Page Nurture default', true]);
    const fpp = quiet(() => { run('activeFlags = new Set(); leadContext = ""; window._lpGrabStartedAt = 0;'); const d = FPLEAD(); sb.populateFromData(d); return sb.__lp.buildUserPrompt(Object.assign({}, d, { context: run('leadContext') })); });
    check('the prompt: "What they opened: the trade-in value page on our website", their trade\'s worth is the reason, and HOW REACHED says the same',
      [/- What they opened: the trade-in value page on our website\. Lead with it\. They want to know what their vehicle is worth/.test(fpp), /on our website they opened the trade-in value page and sent their details/.test(fpp)], [true, true]);
    check('...the campaign name is named only to forbid it -- never "they opened the Nurture ..."', [/opened:? "?the Nurture|opened the Nurture/i.test(fpp), /"Nurture Landing Page Nurture default" is our marketing system's internal name[\s\S]{0,120}never say it, or "nurture"/.test(fpp)], [false, true]);
    check('the text rewrite: "They opened the trade-in value page on our website", not the campaign name', () => {
      const p = quiet(() => run('_lpBuildSmsRefinePrompt')('Test, pass one.', EMAIL, FPLEAD())); return [/They opened the trade-in value page on our website\./.test(p), /Nurture/.test(p)]; }, [true, false]);
    check('control: a Fullpath offer is unchanged -- "The offer they opened on our website"', () => {
      const r = fpr(FPLEAD({ fullpathConversion: 'By: System CONVERTED ON: Nurture Landing Page 2026 Honda Passport Lease for $399/mo for 36 months Lead Details: x Page converted on: Specials - Community Honda' }));
      return r && [r.kind, r.key, r.desc]; }, ['offer', '$399', '']);
  }
  await br.close();
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
