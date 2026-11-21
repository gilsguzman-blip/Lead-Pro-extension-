#!/usr/bin/env node
'use strict';
process.env.TZ = 'America/Chicago';   // VinSolutions renders store-local Central; pinned before any Date is built
require('./lib/fatal-guard.js')('lead-start-762.test.js');
// (v9.7.762) A LEAD THAT BEGAN WITH A PHONE CALL. Kia Baytown, 10/5 (log281/282): the lead opened with an inbound phone
// call ("Auto generated from adding customer", 9/25/2026 5:15 PM) and has no "Lead received" note. Gil: "The inbound
// phone call was the point of inception for this lead." No marker was placed (markerFound:false), for three reasons:
//   (1) labelValue('Created') returned the adjacent "Status:" cell, and a non-empty wrong answer stopped the TEXT
//       fallback in its `||` from running, so leadCreatedMs stayed 0 and every window test below failed;
//   (2) the source scrapes as "Dealers WebSite" (the page shows "(Phone)"), so the phone-up rule never applied, and the
//       internet rule wants a Lead received note that does not exist;
//   (3) the phone-up rule took the FIRST inbound call met while reading newest-first -- the newest, 5:19 "transfer to
//       manager" -- which would leave the 5:15 call that opened the lead and 5:18 "leasing options" below the marker.
// Now: the Created date falls back to the page text, then PageData's LeadCreatedUTC; with no Lead received note in the
// lead window, the OLDEST inbound call in it starts the lead (phone-up leads use the oldest too). Verified separately by
// running the shipped scraper on Gil's dump of that lead. Executes slices of the shipped scraper. Placeholder data only.
//
// Usage: node tests/lead-start-762.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), vm = require('vm'), path = require('path');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: lead-start-762.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const slice = (src, a, b) => { const i = src.indexOf(a); if (i < 0) return null; const j = src.indexOf(b, i); return j < 0 ? null : src.slice(i, j + b.length); };
const item = (title, date) => ({ querySelector: sel => sel === '.legacy-notes-and-history-title' ? { innerText: title } : (sel === '.notes-and-hsitory-item-date' ? { innerText: date } : null) });
// The log282 lead, newest first (as VinSolutions lists it). Placeholder content; titles and times as on the page.
const LEAD = [
  item('General Note', '10/05/2026 2:10 PM'), item('Outbound Text Message', '10/02/2026 5:11 PM'),
  item('General Note', '09/28/2026 12:22 PM'), item('Outbound Text Message', '09/26/2026 5:11 PM'),
  item('Inbound phone call', '09/25/2026 5:19 PM'), item('Inbound phone call', '09/25/2026 5:18 PM'),
  item('Lead Log', '09/25/2026 5:16 PM'), item('Inbound phone call', '09/25/2026 5:15 PM'),
  item('Outbound Text Message', '04/28/2025 2:46 PM'), item('Inbound Text Message', '10/07/2023 4:28 PM'),
  item('Lead received', '09/27/2023 1:00 PM')];
const PAGE = 'Lead Info\nStatus:\tActive\nSales Rep:\tRep Name\nBD Agent:\tAgent Name\nCreated:\t9/25/26 5:16p (10d)\nSource:\tDealers WebSite (Phone)\n';

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  const src = fs.readFileSync(f, 'utf8');
  const sCreated = slice(src, '    if (!leadCreatedMs) {\n      try {\n        var _lcAltTxt', '      } catch (eLcAlt) {}\n    }\n');
  const sScan = slice(src, "    var _puStartDate = '', _puNoLeadReceived = false;", "      } catch (ePu) { _puStartDate = ''; _puNoLeadReceived = false; }\n    }\n");
  const sDecide = slice(src, '        var isCurrentLeadStart = false;', '        if(isCurrentLeadStart) {');
  const created = (text, pd) => { if (!sCreated) return 'no fallback (new code)';
    const box = { leadCreatedMs: 0, TEXT: text, _pdCreatedH: pd || '', transcriptCutoffMs: 0, createdRaw: 'Status:', _lpD: () => {} };
    vm.createContext(box); vm.runInContext(sCreated, box); return box.leadCreatedMs ? new Date(box.leadCreatedMs).toDateString() : 0; };
  // The whole decision, as the loop runs it: newest first, the first note that qualifies starts the lead.
  const start = (notes, createdMs, phoneUp) => {
    const box = { leadCreatedMs: createdMs, isPhoneUpLead: !!phoneUp, noteEls: notes, _lpD: () => {} };
    vm.createContext(box);
    if (sScan) vm.runInContext(sScan, box); else { box._puStartDate = ''; box._puNoLeadReceived = false; }
    for (const n of notes.slice(0, 150)) {
      const title = n.querySelector('.legacy-notes-and-history-title').innerText, date = n.querySelector('.notes-and-hsitory-item-date').innerText;
      const noteMs = new Date(date).getTime();
      Object.assign(box, { title, date, isLeadReceived: /lead received/i.test(title),
        withinLeadWindow: createdMs > 0 && noteMs > 0 && Math.abs(noteMs - createdMs) < 2 * 86400000 });
      vm.runInContext(sDecide.replace(/\s*if\(isCurrentLeadStart\) \{$/, ''), box);
      if (box.isCurrentLeadStart) return date;
    }
    return null;
  };
  const C = new Date('9/25/26').getTime();

  console.log(' 1. the lead\'s Created date when the Created cell is misread:');
  check('log282 shape: labelValue gave "Status:" -> the date comes from the page text (Fri Sep 25 2026)', () => created(PAGE, '2026-09-25T22:16:00'), 'Fri Sep 25 2026');
  check('no Created text on the page -> PageData LeadCreatedUTC, as its Central calendar day', () => created('Lead Info\nStatus:\tActive\n', '2026-09-25T22:16:00'), 'Fri Sep 25 2026');
  check('control (new code): nothing to go on -> still 0 (unknown), as before', () => created('Lead Info\n', ''), 0);

  console.log(' 2. where the lead starts:');
  check('log282 shape: web source, no Lead received note in the window -> the FIRST inbound call, 5:15 PM', () => start(LEAD, C, false), '09/25/2026 5:15 PM');
  check('a phone-up lead with three calls -> the oldest (5:15), not the newest (5:19)', () => start(LEAD, C, true), '09/25/2026 5:15 PM');
  const WEB = [item('Outbound Text Message', '09/26/2026 9:00 AM'), item('Inbound phone call', '09/25/2026 6:00 PM'),
    item('Lead received', '09/25/2026 5:10 PM'), item('Inbound Text Message', '10/07/2023 4:28 PM')];
  check('control: a web lead WITH a Lead received note in the window -> that note, even though a call follows it', () => start(WEB, C, false), '09/25/2026 5:10 PM');
  check('control: an old Lead received note from 2023 does not count as being in the window (log282 has one)', () => start(LEAD.filter(n => !/Inbound phone/.test(n.querySelector('.legacy-notes-and-history-title').innerText)), C, false), null);
  check('control: no Created date known -> no inbound-call start (the old fallback to the first Lead received stands)', () => start(LEAD, 0, false), '09/27/2023 1:00 PM');
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
