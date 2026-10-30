#!/usr/bin/env node
'use strict';
// RECORD-FIRST REPLAY. For each saved lead: build the record-first prompt from what the extension read off the page,
// send it through the live proxy (same model and tiers as production), and put the result beside the drafts Lead Pro
// actually produced on that lead at the time.
//
// Inputs (all local, all customer data -- results go to --out, which must be OUTSIDE the repo):
//   - leadpro_full_prompt_*.txt exports that carry lastScrapedData + inventory (v9.7.697+ dumps): the baseline drafts,
//     the signer, the clock and the inventory as they were at that moment
//   - vinsolutions-dump_*.html page saves of the same lead: the full note list, read by the scraper patched with
//     scraper-record.js. Emails in a page save are VinSolutions' previews; the expanded bodies the extension had are
//     taken from that dump's lastScrapedData.history where the date and title match.
//
// Requests carry extensionVersion "replay-record-first", so their perf rows are identifiable (and countable out).
//
// Usage: node tools/record-first/replay.js --uploads <dir> --out <dir> [--dry] [--lead 2094315571 ...]
const fs = require('fs'), path = require('path'), vm = require('vm');
const RF = require('./record-first.js');
const { patchScraper } = require('./scraper-record.js');
const loadPopup = require('../../tests/helpers/load-popup.js');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const UP = opt('--uploads'), OUT = opt('--out'), DRY = args.includes('--dry'), NOREAD = args.includes('--no-read');
const ONLY = args.reduce((a, x, i) => (args[i - 1] === '--lead' ? a.concat(x) : a), []);
const URL = opt('--url', 'https://leadpro-proxy.gilsguzman.workers.dev/');
if (!UP || !OUT) { console.error('usage: replay.js --uploads <dir> --out <dir> [--dry] [--lead id]'); process.exit(2); }
if (path.resolve(OUT).startsWith(path.resolve(__dirname, '../..'))) { console.error('--out must be outside the repository (customer data)'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

// ── parse a full-prompt export ─────────────────────────────────────────────────────────────────────────────────────
function section(t, name, next) {
  const a = t.indexOf('=== ' + name); if (a < 0) return '';
  const b = next ? t.indexOf('\n=== ', a + 5) : -1;
  return t.slice(t.indexOf('\n', a) + 1, b < 0 ? undefined : b);
}
function jsonIn(s) { const a = s.indexOf('{'), b = s.lastIndexOf('}'); return a < 0 ? null : JSON.parse(s.slice(a, b + 1)); }
function parseDump(file) {
  const t = fs.readFileSync(file, 'utf8');
  const head = t.split('\n')[0];
  const lead = (head.match(/LEAD (\d+)/) || [])[1], dealer = (head.match(/dealer (\d+)/) || [])[1], at = (head.match(/dumped (\S+)/) || [])[1];
  const user = section(t, 'USER PROMPT', true), raw = section(t, 'MODEL RAW RESPONSE', true), rw = section(t, 'SMS REWRITE STEP', true);
  let first = null; try { first = jsonIn(raw); } catch (e) {}
  const shipped = (rw.match(/--- text that shipped ---\n([\s\S]*?)\n--- /) || [])[1] || (first && first.sms) || '';
  const rwResult = (rw.match(/RESULT: ([^\n]*)/) || [])[1] || '';
  const L = (k) => ((user.match(new RegExp('^' + k + ':\\s*([^\\n←]*)', 'm')) || [])[1] || '').trim();
  const emailSig = (user.match(/EMAIL SIGNATURE[^\n]*\n((?:  [^\n]*\n){2,5})/) || [])[1] || '';
  const sigLines = emailSig.split('\n').map(s => s.trim()).filter(Boolean);
  const signer = { name: L('BD Agent') || sigLines[0] || '', title: sigLines.length >= 4 ? sigLines[1] : (L('Persona') || ''),
    store: L('Store'), phone: L('Agent Phone'), salesRep: L('Sales Rep') };
  return { file, lead, dealer, at, scraped: jsonIn(section(t, 'WHAT LEAD PRO READ OFF THE PAGE', true)),
    inv: jsonIn(section(t, 'INVENTORY AND INCENTIVES', true)), first, shipped, rwResult, signer };
}

// ── the record: patched scraper over the page save, expanded emails merged from the dump's history ──────────────────
async function scrapeRecord(br, htmlFile, src) {
  const html = fs.readFileSync(htmlFile, 'utf8').replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const a = src.indexOf('  function inlineScraper() {'), b = src.indexOf('  } // end inlineScraper', a);
  const fn = src.slice(a, b + 3);
  const page = await br.newPage(); await page.route('**/*', r => r.abort());
  await page.setContent(html, { waitUntil: 'domcontentloaded' }).catch(() => {});
  let res; try { res = await page.evaluate('(async()=>{' + fn + '\n; return await inlineScraper();})()'); } catch (e) { res = { __err: String(e.message).slice(0, 300) }; }
  await page.close();
  return res;
}
function historyBodies(history) {   // "[date] [WHO] Title\n  body" entries -> Map(date|title -> body)
  const m = new Map(), re = /^\[(\d\d\/\d\d\/\d{4} [^\]]+)\] \[[A-Z =]+\] ([^\n]*)\n([\s\S]*?)(?=^\[\d\d\/\d\d\/\d{4} |$(?![\s\S]))/gm;
  let x; while ((x = re.exec(history || ''))) m.set(x[1].trim() + '|' + x[2].trim().toLowerCase(), x[3].replace(/\s+\[SYSTEM:[\s\S]*$/, '').trim());
  return m;
}
function mergeExpanded(notes, history) {
  const hb = historyBodies(history); let n = 0;
  notes.forEach(note => {
    if (!/email/i.test(note.title)) return;
    let h = hb.get(note.when + '|' + note.title.toLowerCase());
    if (!h || h.length <= note.body.length + 40) return;
    // The history copy is flattened ("Subject: S By: NAME Hi ..."); the page preview still has its header lines. Keep the
    // preview's Subject/By lines and take the expanded text after "By: NAME", which is what the live page shows.
    const subj = (note.body.match(/^\s*Subject\s*:\s*([^\n]*)/im) || [])[1];
    const by = (note.body.match(/(?:^|\n)\s*(?:Sent by|By)\s*:\s*([^\n]+)/i) || [])[1];
    if (by) { const i = h.indexOf('By: ' + by.trim()); if (i >= 0) h = h.slice(i + ('By: ' + by.trim()).length).trim(); }
    note.body = (subj ? 'Subject: ' + subj.trim() + '\n' : '') + (by ? 'By: ' + by.trim() + '\n' : '') + h; n++;
  });
  return n;
}

// ── call the proxy ─────────────────────────────────────────────────────────────────────────────────────────────────
async function generate(sys, user) {
  const body = JSON.stringify({ system_instruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature: 0.5, maxOutputTokens: 3000, topP: 0.9, responseMimeType: 'application/json' },
    noEdgeCache: true, extensionVersion: 'replay-record-first' });
  const t0 = Date.now();
  try {
    const r = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const j = await r.json();
    let text = ''; try { text = j.candidates[0].content.parts[0].text; } catch (e) {}
    let draft = null; try { draft = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')); } catch (e) {}
    return { status: r.status, ms: Date.now() - t0, model: j._model || null, tier: j._tier || null, draft, raw: draft ? undefined : text.slice(0, 400) };
  } catch (e) { return { status: 0, ms: Date.now() - t0, error: String(e) }; }
}

(async () => {
  const files = fs.readdirSync(UP).filter(f => /leadpro_full_prompt/.test(f)).map(f => path.join(UP, f));
  const raws = fs.readdirSync(UP).filter(f => /vinsolutions-dump/.test(f)).map(f => path.join(UP, f));
  const dumps = files.map(f => { try { const t = fs.readFileSync(f, 'utf8'); return t.indexOf('=== WHAT LEAD PRO READ OFF THE PAGE') > 0 ? parseDump(f) : null; } catch (e) { return null; } })
    .filter(d => d && d.lead && d.scraped && (!ONLY.length || ONLY.includes(d.lead)));
  // one replay per lead: the capture closest to its page save (so both read the same notes), else the latest
  const byLead = new Map();
  dumps.forEach(d => { (byLead.get(d.lead) || byLead.set(d.lead, []).get(d.lead)).push(d); });
  const devSrc = patchScraper(fs.readFileSync(path.join(__dirname, '../../builds/dev/popup.js'), 'utf8'));
  const sb = loadPopup(path.join(__dirname, '../../builds/dev/popup.js'), { withAuth: true });
  const STORE_HOURS = vm.runInContext('STORE_HOURS', sb), closeOut = vm.runInContext('_lpCloseOutEligible', sb);
  const { chromium } = require('playwright');
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const results = [];
  for (const [lead, list] of byLead) {
    const raw = raws.find(f => fs.readFileSync(f, 'utf8').indexOf(lead) >= 0);
    const rawAt = raw ? (() => { const m = path.basename(raw).match(/(\d{4}-\d\d-\d\d)T(\d\d)(\d\d)(\d\d)/); return m ? new Date(m[1] + 'T' + m[2] + ':' + m[3] + ':' + m[4] + '-05:00').getTime() : 0; })() : 0;
    list.sort((a, b) => rawAt ? Math.abs(Date.parse(a.at) - rawAt) - Math.abs(Date.parse(b.at) - rawAt) : Date.parse(b.at) - Date.parse(a.at));
    const d = list[0];
    // the latest build's draft on this lead, only while the conversation had not moved on (same last customer message)
    const latest = list.filter(x => (x.scraped.lastInboundMsg || '') === (d.scraped.lastInboundMsg || '') && Date.parse(x.at) >= Date.parse(d.at))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
    let notes = [], start = 0, source = 'history', merged = 0;
    if (raw) {
      const s = await scrapeRecord(br, raw, devSrc);
      if (s && !s.__err && (s.recordNotes || []).length) {
        // nothing the capture could not have seen: VinSolutions stamps are Central time
        const cut = Date.parse(d.at) + 60000, before = s.recordNotes.length;
        notes = s.recordNotes.filter(n => { const t = Date.parse(String(n.when).replace(/\s+/g, ' ').trim() + ' GMT-0500'); return !isFinite(t) || t <= cut; });
        start = s.recordLeadStartMs || 0; source = 'page save' + (before > notes.length ? ' (' + (before - notes.length) + ' later notes dropped)' : '');
        merged = mergeExpanded(notes, d.scraped.history);
      }
    }
    if (!notes.length) {   // no page save: fall back to the dump's own history (already filtered -- noted in the report)
      const hb = historyBodies(d.scraped.history);
      notes = Array.from(hb.entries()).map(([k, body]) => { const [when, title] = k.split('|'); return { when, title, dir: '', tags: '', body }; });
    }
    const record = RF.rfBuildRecord(notes, start);
    const facts = RF.rfBuildFacts(d.scraped, { now: Date.parse(d.at), hours: STORE_HOURS[d.dealer] || null, signer: d.signer,
      inv: d.inv && d.inv.inv, incentives: d.inv && d.inv.vf && d.inv.vf.incentives, closeOut: (() => { try { return closeOut(d.scraped); } catch (e) { return null; } })() });
    const sys = RF.rfSystemPrompt(d.signer, { noRead: NOREAD }), user = RF.rfUserPrompt(facts, record);
    fs.writeFileSync(path.join(OUT, lead + '.prompt.txt'), '=== SYSTEM ===\n' + sys + '\n\n=== USER ===\n' + user);
    const row = { lead, dealer: d.dealer, at: d.at, capture: path.basename(d.file), page: raw ? path.basename(raw) : null, recordSource: source, emailsExpanded: merged,
      recordNotes: record.count, chars: { sys: sys.length, user: user.length },
      store: (d.scraped.store || ''), lastCustomer: d.scraped.lastInboundMsg || '', baseline: { at: d.at, first: d.first, shipped: d.shipped, rewrite: d.rwResult },
      latest: latest && latest !== d ? { at: latest.at, first: latest.first, shipped: latest.shipped, rewrite: latest.rwResult } : null, captures: list.length };
    if (!DRY) row.recordFirst = await generate(sys, user);
    results.push(row);
    console.log(lead, '| notes', record.count, '(' + source + ', ' + merged + ' emails expanded) | prompt', sys.length + user.length, 'chars',
      DRY ? '' : '| ' + (row.recordFirst.status) + ' ' + row.recordFirst.ms + 'ms ' + (row.recordFirst.draft ? 'ok' : 'NO DRAFT'));
  }
  await br.close();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  console.log('wrote', results.length, 'leads to', OUT);
})();
