#!/usr/bin/env node
'use strict';
require('./lib/fatal-guard.js')('b2-replay-tool.test.js');
// AUDIT B-2 STEP 2: tools/b2-replay.js, run for real against a local stand-in for the proxy. The key comes from the environment
// and never appears in the console, the results or the logs (M-7), even when the endpoint echoes it back in an error; it is
// sent only in the request body, as the panel sends it. A = the regex directive in the prompt; B = removed by the build's own
// path plus the one-line rule in the system prompt. The results carry lead IDs, and the customer's and staff names, phones and
// emails are masked. --dry-run needs no key and makes no request. Placeholder data only (a synthetic dump built here).
//
// Usage: node tests/b2-replay-tool.test.js <dev popup.js> <commercial popup.js>
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), cp = require('child_process');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: b2-replay-tool.test.js <popup.js> [popup.js...]'); process.exit(2); }
const TOOL = path.join(__dirname, '..', 'tools', 'b2-replay.js');
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = fn(); } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}
const KEY = 'LP-TESTKEY1';   // a placeholder in the key's shape; never a real key
const E = (d, time, tag, title, body) => '[' + d + '/2026 ' + time + '] [' + tag + '] ' + title + '\n  ' + body + '\n';
const MARK = '[10/13/2026 9:00 AM] [=== CURRENT LEAD SUBMITTED HERE ===]\n  This is when the current inquiry was submitted.\n';
const H = E('10/13', '2:43 PM', 'AGENT', 'Outbound Text Message', 'Test, thanks for the call.') + MARK;
const LSD = { autoLeadId: 'TEST001A', name: 'Test Buyer', firstName: 'Test', agent: 'Agent Name', salesRep: 'Rep Name', vehicle: '2026 Honda Civic Sport',
  condition: 'New', stockNum: '', dealerId: '6191', store: 'Community Honda Baytown', leadSource: 'Phone Up', convState: 'active-follow-up', leadAgeDays: 0,
  hasOutbound: true, hasCustomerReply: false, totalNoteCount: 3, phone: '(555) 010-0199', email: 'test@example.com', lastInboundMsg: '',
  relationshipSignals: { unansweredQuestions: [] }, history: H, conversationBrief: H,
  customerScheduleConstraint: 'CUSTOMER SPECIFIED DAY: Customer said Saturday is when they are available. LOCK IN Saturday - do NOT offer any other day. Offer two specific times on Saturday only. Do NOT try to pull them in sooner.' };
const SHIPPED = { sms: 'Hi Test, Saturday at 10am or 11am? Rep Name, (555) 010-0100', email: '', subject: '', voicemail: '' };
const DUMP = '=== LEAD 1000000001 | dealer 6191 | dumped 2026-10-13T20:00:00.000Z ===\n\n=== SYSTEM PROMPT (15 chars) ===\nYou are a test.\n'
  + '=== USER PROMPT (1 chars) ===\nx\n=== MODEL RAW RESPONSE ===\n' + JSON.stringify(SHIPPED) + '\n'
  + '=== WHAT LEAD PRO READ OFF THE PAGE (lastScrapedData) ===\n' + JSON.stringify(LSD, null, 2) + '\n=== FACT CHECK VERDICTS ===\n{}\n';
const REPLY = { sms: 'Hi Test Buyer, Saturday at 10am or 11am works. Call (555) 010-0199 or test@example.com. Rep Name', email: 'Hi Test, see you Saturday.', subject: 'Saturday', voicemail: '' };

function serve(mode) {
  return new Promise((resolve) => {
    const seen = [];
    const srv = http.createServer((req, res) => {
      let b = ''; req.on('data', c => b += c); req.on('end', () => {
        let j = {}; try { j = JSON.parse(b); } catch (e) {}
        seen.push(j);
        if (mode === 'echo-403') { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'bad key ' + j.licenseKey })); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(REPLY) }] } }] }));
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, seen, url: 'http://127.0.0.1:' + srv.address().port + '/generate' }));
  });
}
function runTool(args, env) {
  return new Promise((resolve) => {
    const p = cp.spawn(process.execPath, [TOOL].concat(args), { env: Object.assign({}, process.env, { LEADPRO_DIRECTOR_KEY: '' }, env || {}), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; p.stdout.on('data', c => out += c); p.stderr.on('data', c => out += c);
    p.on('close', (code) => resolve({ code, out }));
  });
}
const readAll = (dir) => fs.readdirSync(dir).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');

(async function () {
  for (const f of BUILDS) {
    console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b2r-')), dumps = path.join(tmp, 'dumps'), out = path.join(tmp, 'out'), dry = path.join(tmp, 'dry');
    fs.mkdirSync(dumps); fs.writeFileSync(path.join(dumps, 'x-leadpro_full_prompt_2026-10-13_20-00-00.txt'), DUMP);

    console.log(' 1. a real run against a stand-in proxy:');
    const s = await serve('ok');
    const r = await runTool(['--dumps', dumps, '--build', f, '--detector', 'day-lock', '--samples', '1', '--out', out, '--proxy', s.url], { LEADPRO_DIRECTOR_KEY: KEY });
    s.srv.close();
    const files = fs.existsSync(out) ? readAll(out) : '';
    check('it ran and wrote a JSON and a Markdown file', () => [r.code, fs.existsSync(out) ? fs.readdirSync(out).sort().map(x => path.extname(x)) : []], [0, ['.json', '.md']]);
    check('two generations (A and B), the key in each request body, labeled as the replay', () =>
      [s.seen.length, s.seen.every(j => j.licenseKey === KEY), s.seen.every(j => j.extensionVersion === 'b2-replay' && j.noEdgeCache === true)], [2, true, true]);
    const sys = (j) => j.system_instruction.parts[0].text, usr = (j) => j.contents[0].parts[0].text;
    check('A carries the day-lock directive and no rule; B the rule and no directive', () =>
      [/CUSTOMER NAMED A SPECIFIC DAY/.test(usr(s.seen[0])), /FACT RULE/.test(sys(s.seen[0])),
       /CUSTOMER NAMED A SPECIFIC DAY/.test(usr(s.seen[1])), /FACT RULE \(read it from the transcript yourself\): If the customer named a day, offer times on that day only\./.test(sys(s.seen[1]))],
      [true, false, false, true]);
    check('the key is in neither the console nor the results', () => [r.out.includes(KEY), files.includes(KEY)], [false, false]);
    check('the results carry the lead ID; names, phones and emails are masked', () =>
      [files.includes('1000000001'), /Test Buyer|\bTest\b|Rep Name|Agent Name|010-0199|010-0100|test@example\.com/.test(files), /\[customer\]/.test(files), /\[staff\]/.test(files), /\[phone\]/.test(files), /\[email\]/.test(files)],
      [true, false, true, true, true, true]);
    const j = JSON.parse(fs.readFileSync(path.join(out, fs.readdirSync(out).find(x => x.endsWith('.json'))), 'utf8'));
    check('the pair records what each draft did (the named day, only that day)', () =>
      [j.rows.length, j.rows[0].detector, j.rows[0].A[0].observed.namedDay, j.rows[0].A[0].observed.onlyThatDay, j.rows[0].B[0].observed.onlyThatDay, j.rows[0].shipped.observed.onlyThatDay],
      [1, 'day-lock', 'saturday', true, true, true]);

    console.log(' 2. the key stays out even when the endpoint echoes it back:');
    const s2 = await serve('echo-403'), out2 = path.join(tmp, 'out2');
    const r2 = await runTool(['--dumps', dumps, '--build', f, '--detector', 'day-lock', '--samples', '1', '--out', out2, '--proxy', s2.url], { LEADPRO_DIRECTOR_KEY: KEY });
    s2.srv.close();
    const files2 = fs.existsSync(out2) ? readAll(out2) : '';
    check('the error is recorded, the key replaced', () => [r2.code, files2.includes(KEY), r2.out.includes(KEY), /HTTP 403: bad key \[director key\]/.test(files2)], [0, false, false, true]);

    console.log(' 3. --dry-run needs no key and sends nothing:');
    const s3 = await serve('ok');
    const r3 = await runTool(['--dumps', dumps, '--build', f, '--dry-run', '--out', dry, '--proxy', s3.url]);
    s3.srv.close();
    check('no request; the prompts are compared and the directive written (masked)', () =>
      [r3.code, s3.seen.length, /1 pair\(s\)/.test(r3.out), /CUSTOMER NAMED A SPECIFIC DAY/.test(readAll(dry))], [0, 0, true, true]);
    const r4 = await runTool(['--dumps', dumps, '--build', f, '--out', path.join(tmp, 'nokey'), '--proxy', s3.url], {});
    check('with no key and no terminal, it stops before sending anything', () => [r4.code !== 0, /no key/.test(r4.out)], [true, true]);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log('\n' + (fail ? 'FAILED' : 'PASSED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
