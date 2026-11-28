#!/usr/bin/env node
'use strict';
// AUDIT B-2 STEP 2 -- THE REPLAY. Regex or model, per fact. For each lead in a folder of full-prompt dumps, rebuild the prompt
// with a build's own popup.js twice, against the clock of the dump:
//   A  the regex decides (as shipped since v9.7.851): the regex directive is in the prompt;
//   B  the regex directive is removed -- by the build's own path for that (authoritative switch on, a verified "none" verdict:
//      REMOVE for day-lock / off-franchise, SUPPRESSED for verbal-commit) -- and the one-line rule for that fact is added to
//      the system prompt.
// Then generate both through the proxy and write the pairs next to the draft that actually shipped (the dump's MODEL RAW
// RESPONSE). Only leads where the rebuild shows the regex directive (A differs from B) are generated.
//
// THE KEY. The director key is read from LEADPRO_DIRECTOR_KEY, or asked for at runtime with the input hidden. It is never
// written to the console, the results or any log: every string this script prints or writes passes through safe(), which
// replaces the key wherever it appears (M-7). It travels only in the request body to the proxy, as the extension sends it.
// --dry-run needs no key and makes no request.
//
// THE RESULTS. One JSON file and one Markdown file, lead IDs and dealer IDs only. Draft and directive text is masked before it
// is written: the customer's name, the agent's and the sales rep's names, phone numbers and email addresses are replaced.
// Pass --no-text to write the observations only, with no draft text at all.
//
// Usage:
//   node tools/b2-replay.js --dumps <folder> [--detector day-lock|off-franchise|verbal-commit|all] [--leads <file of lead IDs>]
//        [--build builds/dev/popup.js] [--samples 2] [--limit N] [--out <folder>] [--rules <rules.json>] [--dry-run] [--no-text]
//        [--proxy <url>]   (default: the build's own config.js)
// Placeholder-free by design: it reads the dumps you give it and writes only what is described above.
const fs = require('fs'), path = require('path'), vm = require('vm'), readline = require('readline');
const ROOT = path.resolve(__dirname, '..');
const loadPopup = require(path.join(ROOT, 'tests/helpers/load-popup.js'));
const panelPayload = require(path.join(ROOT, 'tests/helpers/panel-payload.js'));

// ── the one-line rule per fact (B). Override with --rules {"day-lock": "...", ...}. American spelling (CLAUDE.md). ──
const RULES = {
  'day-lock': 'If the customer named a day, offer times on that day only.',
  'verbal-commit': 'If a call note records the customer agreeing on the phone to a visit, a time or a next step, confirm what was agreed and move to the next step; do not ask them to commit again. A note that only describes them or what they drive is not a commitment.',
  'off-franchise': 'If the customer asks about a new vehicle of a make this store does not sell, do not offer to find, order or locate one; offer a used unit of that make only if we have one, and never as new.',
};
const SWITCH = { 'day-lock': 'LEADPRO_DAYLOCK_AUTHORITATIVE', 'verbal-commit': 'LEADPRO_VERBALCOMMIT_AUTHORITATIVE', 'off-franchise': 'LEADPRO_OFFFRANCHISE_AUTHORITATIVE' };

// ── arguments ──
const argv = process.argv.slice(2), opt = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]; if (!a.startsWith('--')) continue;
  const k = a.slice(2); if (['dry-run', 'no-text', 'help'].includes(k)) opt[k] = true; else opt[k] = argv[++i];
}
if (opt.help || !opt.dumps) {
  console.log('usage: node tools/b2-replay.js --dumps <folder> [--detector day-lock|off-franchise|verbal-commit|all] [--leads <file>]\n'
    + '       [--build builds/dev/popup.js] [--samples 2] [--limit N] [--out <folder>] [--rules <rules.json>] [--dry-run] [--no-text]\n'
    + 'The director key comes from LEADPRO_DIRECTOR_KEY or a hidden prompt; --dry-run needs none.');
  process.exit(opt.help ? 0 : 2);
}
const DETS = (!opt.detector || opt.detector === 'all') ? Object.keys(RULES) : [opt.detector];
if (DETS.some(d => !RULES[d])) { console.error('unknown --detector ' + opt.detector); process.exit(2); }
if (opt.rules) Object.assign(RULES, JSON.parse(fs.readFileSync(opt.rules, 'utf8')));
const BUILD = path.resolve(opt.build || path.join(ROOT, 'builds/dev/popup.js'));
const SAMPLES = Math.max(1, Math.min(5, parseInt(opt.samples || '2', 10) || 2));
const LIMIT = opt.limit ? parseInt(opt.limit, 10) : Infinity;
const OUT = path.resolve(opt.out || '.');
const WANT = opt.leads ? new Set(fs.readFileSync(opt.leads, 'utf8').match(/\b\d{6,12}\b/g) || []) : null;

// ── the key: env or hidden prompt; never printed ──
let KEY = '';
function safe(s) {
  let t = String(s == null ? '' : s);
  if (KEY && KEY.length >= 4) t = t.split(KEY).join('[director key]');
  return t;
}
const log = (...a) => console.log(safe(a.join(' ')));
function askHidden(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(q);
    rl._writeToOutput = () => {};   // no echo
    let done = false;
    rl.on('close', () => { if (!done) { done = true; resolve(''); } });
    rl.question('', (ans) => { done = true; rl.close(); process.stdout.write('\n'); resolve(String(ans || '').trim()); });
  });
}

// ── masking for anything written: lead IDs stay, people do not ──
function masker(lsd) {
  const people = [];
  const add = (v, tag) => String(v || '').split(/[\s,]+/).filter(w => w.length >= 3 && /^[A-Za-z'’-]+$/.test(w)).forEach(w => people.push([w, tag]));
  add(lsd.name, '[customer]'); add(lsd.firstName, '[customer]'); add(lsd.lastName, '[customer]');
  add(lsd.agent, '[staff]'); add(lsd.salesRep, '[staff]');
  return (s) => {
    let t = safe(s);
    t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]');
    t = t.replace(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '[phone]');
    people.forEach(([w, tag]) => { t = t.replace(new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), tag); });
    return t;
  };
}

// ── dumps ──
function sections(t) {
  const out = {}, rx = /^=== (.+?) ===$/gm; let m, last = null, lastAt = 0;
  while ((m = rx.exec(t))) { if (last) out[last] = t.slice(lastAt, m.index).replace(/^\n/, ''); last = m[1]; lastAt = m.index + m[0].length; }
  if (last) out[last] = t.slice(lastAt).replace(/^\n/, '');
  return out;
}
function readDump(file) {
  const t = fs.readFileSync(file, 'utf8');
  const head = t.match(/^=== LEAD (\d+) \| dealer (\d+) \| dumped ([^ ]+) ===/);
  if (!head) return null;
  const s = sections(t);
  const key = (p) => Object.keys(s).find(k => k.startsWith(p));
  const lsdTxt = s[key('WHAT LEAD PRO READ OFF THE PAGE')]; if (!lsdTxt) return null;
  let lsd; try { lsd = JSON.parse(lsdTxt.trim()); } catch (e) { return null; }
  let shipped = null; try { const r = s[key('MODEL RAW RESPONSE')] || ''; shipped = JSON.parse(r.slice(r.indexOf('{'), r.lastIndexOf('}') + 1)); } catch (e) {}
  return { lead: head[1], dealer: head[2], at: head[3], system: (s[key('SYSTEM PROMPT')] || '').replace(/\n$/, ''), lsd, shipped };
}

// ── rebuild one prompt with the build's own code ──
const SRC = fs.readFileSync(BUILD, 'utf8');
function rebuild(lsd, at, det, removeIt) {
  const sb = loadPopup(BUILD, { withAuth: true }), run = (e) => vm.runInContext(e, sb);
  const fix = new Date(at).getTime();
  run('(function(){ var RD = Date, FIX = ' + fix + '; function FD(){ if (!(this instanceof FD)) return new RD(FIX).toString(); return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(FIX); } FD.now = function(){ return FIX; }; FD.parse = RD.parse; FD.UTC = RD.UTC; FD.prototype = RD.prototype; Date = FD; })()');
  const verdicts = {};
  if (removeIt) {
    run(SWITCH[det] + ' = true;');
    verdicts[det] = { usable: true, fired: false, kind: 'none', quote: null, notesRead: 1, reason: 'b2-replay: directive removed' };
  }
  sb._lpFactVerdicts = verdicts;
  const L = JSON.parse(JSON.stringify(lsd)); sb.__L = L;
  const ol = sb.console.log, ow = sb.console.warn; sb.console.log = () => {}; sb.console.warn = () => {};
  try {
    run('activeFlags = new Set(); leadContext = ""; lastScrapedData = globalThis.__L;');
    sb.populateFromData(L);
    let ctx = String(run('leadContext') || '');
    ctx = run('_lpApplyFactOverrides')(ctx, verdicts, () => {}).text;   // what the generate path does before the payload
    return String(sb.__lp.buildUserPrompt(panelPayload(SRC, sb, { lsd: L, context: ctx })));
  } finally { sb.console.log = ol; sb.console.warn = ow; }
}
// The lines A has that B does not, counted (a line can appear in A twice and in B once): the directive the regex put in, and
// anything else in the prompt that keyed off the same regex (the day-lock also drives the visit decision).
function removedLines(a, b) {
  const left = new Map(); b.split('\n').forEach(l => left.set(l, (left.get(l) || 0) + 1));
  return a.split('\n').filter(l => { if (!l.trim()) return false; const c = left.get(l) || 0; if (c > 0) { left.set(l, c - 1); return false; } return true; });
}
function addedLines(a, b) { return removedLines(b, a); }

// ── generation, the way the panel sends it ──
function proxyUrl() {
  if (opt.proxy) return opt.proxy;   // a stand-in endpoint (the suite uses a local one); the default is the build's own config.js
  const cfg = fs.readFileSync(path.join(path.dirname(BUILD), 'config.js'), 'utf8');
  const m = cfg.match(/LEADPRO_PROXY_URL\s*=\s*['"]([^'"]+)['"]/); if (!m) throw new Error('LEADPRO_PROXY_URL not found in config.js');
  return /\/generate$/.test(m[1]) ? m[1] : m[1].replace(/\/$/, '') + '/generate';
}
async function generate(system, user) {
  const body = { system_instruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature: 0.5, maxOutputTokens: 2500, topP: 0.9, responseMimeType: 'application/json' },
    noEdgeCache: true, licenseKey: KEY, extensionVersion: 'b2-replay' };
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 90000);
  try {
    const r = await fetch(proxyUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal });
    const j = await r.json().catch(() => null);
    if (!r.ok) return { error: 'HTTP ' + r.status + (j && j.error ? ': ' + safe(j.error).slice(0, 120) : '') };
    const c = j && j.candidates && j.candidates[0];
    if (!c) return { error: 'no candidates' };
    if (c._fallback) return { error: 'proxy SAFE_FALLBACK (cascade exhausted)' };
    const txt = (c.content && c.content.parts && c.content.parts[0] && c.content.parts[0].text) || '';
    try { return JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)); } catch (e) { return { error: 'reply was not JSON' }; }
  } catch (e) { return { error: safe(e && e.name === 'AbortError' ? 'timed out (90s)' : (e && e.message) || e) }; }
  finally { clearTimeout(timer); }
}

// ── what each draft did, per fact (for the memo; the text is still read by hand) ──
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
function observe(det, draft, directive) {
  const t = String((draft && (draft.sms || '')) + ' ' + (draft && (draft.email || ''))).toLowerCase();
  const o = { days: DAYS.filter(d => new RegExp('\\b' + d + '\\b').test(t)).concat(/\btoday\b/.test(t) ? ['today'] : []),
    times: (t.match(/\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/g) || []).length };
  if (det === 'day-lock') {
    const named = DAYS.find(d => new RegExp('\\b' + d + '\\b', 'i').test(directive)) || '';
    o.namedDay = named; o.onlyThatDay = !!named && o.days.length > 0 && o.days.every(d => d === named);
  } else if (det === 'off-franchise') {
    o.promisesToSource = /\b(?:check what we have|look (?:it|that|one) up|find (?:you )?one|locate|order (?:you )?one|dealer trade)\b/.test(t);
  } else if (det === 'verbal-commit') {
    o.asksAgain = /\b(?:what (?:time|day) works|when (?:can|could|would) you|are you available|would you like to (?:come|schedule|set)|does .{0,20} work for you)\b/.test(t);
  }
  return o;
}

(async function main() {
  const files = fs.readdirSync(opt.dumps).filter(f => /leadpro_full_prompt.*\.txt$/.test(f)).sort();
  if (!files.length) { console.error('no leadpro_full_prompt_*.txt files in ' + opt.dumps); process.exit(2); }
  if (!opt['dry-run']) {
    KEY = String(process.env.LEADPRO_DIRECTOR_KEY || '').trim();
    if (!KEY && process.stdin.isTTY) KEY = await askHidden('Director key (input hidden): ');
    if (!KEY) { console.error('no key: set LEADPRO_DIRECTOR_KEY or type it at the prompt, or use --dry-run'); process.exit(2); }
  }
  const results = [], skipped = {};
  let n = 0;
  for (const f of files) {
    const d = readDump(path.join(opt.dumps, f));
    if (!d) { skipped['unreadable dump'] = (skipped['unreadable dump'] || 0) + 1; continue; }
    if (WANT && !WANT.has(d.lead)) continue;
    const mask = masker(d.lsd);
    for (const det of DETS) {
      if (n >= LIMIT) break;
      let A, B;
      try { A = rebuild(d.lsd, d.at, det, false); B = rebuild(d.lsd, d.at, det, true); }
      catch (e) { skipped['rebuild threw'] = (skipped['rebuild threw'] || 0) + 1; log('  ' + d.lead + ' ' + det + ': rebuild threw (' + safe(e.message).slice(0, 80) + ')'); continue; }
      if (A === B) { skipped['regex did not fire on rebuild'] = (skipped['regex did not fire on rebuild'] || 0) + 1; continue; }
      n++;
      const directive = removedLines(A, B).join('\n');
      const added = addedLines(A, B);
      const row = { lead: d.lead, dealer: d.dealer, dumped: d.at, detector: det, rule: RULES[det], directiveLines: removedLines(A, B).length, bOnlyLines: added.length };
      if (!opt['no-text']) { row.directive = mask(directive); if (added.length) row.bOnly = mask(added.join('\n')); }
      if (d.shipped) row.shipped = Object.assign({ observed: observe(det, d.shipped, directive) }, opt['no-text'] ? {} : { sms: mask(d.shipped.sms || ''), email: mask(d.shipped.email || '') });
      log('  ' + d.lead + ' ' + det + ': regex directive present (' + row.directiveLines + ' line(s))' + (opt['dry-run'] ? '' : ' -- generating ' + SAMPLES + ' x 2'));
      if (!opt['dry-run']) {
        const sysB = d.system + '\n\nFACT RULE (read it from the transcript yourself): ' + RULES[det];
        row.A = []; row.B = [];
        for (let i = 0; i < SAMPLES; i++) {
          for (const [arm, sys, user] of [['A', d.system, A], ['B', sysB, B]]) {
            const g = await generate(sys, user);
            row[arm].push(g.error ? { error: g.error } : Object.assign({ observed: observe(det, g, directive) }, opt['no-text'] ? {} : { sms: mask(g.sms || ''), email: mask(g.email || '') }));
          }
        }
      }
      results.push(row);
    }
    if (n >= LIMIT) break;
  }

  // ── write: lead IDs only, text masked ──
  fs.mkdirSync(OUT, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10), base = path.join(OUT, 'b2-replay-' + stamp + (opt['dry-run'] ? '-dry' : ''));
  const meta = { build: path.relative(ROOT, BUILD), firstLine: SRC.slice(0, SRC.indexOf('(')).replace(/^\/\/\s*/, '').trim(), dryRun: !!opt['dry-run'],
    samplesPerArm: opt['dry-run'] ? 0 : SAMPLES, detectors: DETS, rules: DETS.reduce((o, k) => (o[k] = RULES[k], o), {}), dumpsRead: files.length, skipped };
  fs.writeFileSync(base + '.json', safe(JSON.stringify({ meta, rows: results }, null, 2)));
  const md = ['# B-2 replay ' + stamp + (opt['dry-run'] ? ' (dry run: prompts only, nothing generated)' : ''), '',
    'Build: `' + meta.build + '`. Dumps read: ' + files.length + '. Pairs: ' + results.length + '. Samples per arm: ' + meta.samplesPerArm + '.', '',
    'A = the regex decides (the directive is in the prompt). B = the directive removed by the build\'s own path, plus the one-line rule.', '',
    'Skipped: ' + (Object.keys(skipped).map(k => k + ' ' + skipped[k]).join('; ') || 'none'), ''];
  for (const det of DETS) {
    const rows = results.filter(r => r.detector === det); if (!rows.length) continue;
    md.push('## ' + det + ' (' + rows.length + ')', '', 'Rule (B): ' + RULES[det], '');
    for (const r of rows) {
      md.push('### lead ' + r.lead + ' (dealer ' + r.dealer + ', dumped ' + r.dumped + ')');
      if (r.directive) md.push('', 'In A only (the regex directive, and anything keyed off it):', '', '```', r.directive, '```');
      if (r.bOnly) md.push('', 'In B only (what the prompt says instead):', '', '```', r.bOnly, '```');
      const fmt = (x) => x.error ? 'ERROR: ' + x.error : '`' + JSON.stringify(x.observed) + '`' + (x.sms !== undefined ? '\n\n> ' + String(x.sms).replace(/\n/g, '\n> ') : '');
      if (r.shipped) md.push('', '**Shipped:** ' + fmt(r.shipped));
      (r.A || []).forEach((x, i) => md.push('', '**A' + (i + 1) + ':** ' + fmt(x)));
      (r.B || []).forEach((x, i) => md.push('', '**B' + (i + 1) + ':** ' + fmt(x)));
      md.push('');
    }
  }
  fs.writeFileSync(base + '.md', safe(md.join('\n')));
  log('\n' + results.length + ' pair(s); results: ' + base + '.json and ' + base + '.md (lead IDs only; text masked' + (opt['no-text'] ? ', none written' : '') + ')');
})().catch((e) => { console.error(safe('b2-replay failed: ' + ((e && e.stack) || e))); process.exit(1); });
