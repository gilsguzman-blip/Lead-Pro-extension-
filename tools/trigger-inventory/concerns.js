// Usage: node concerns.js <out dir from parse.py>
// Runs the SHIPPED concern block (builds/dev/popup.js) over each capture's transcript.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'builds', 'dev', 'popup.js'), 'utf8');
const caps = JSON.parse(fs.readFileSync(path.join(process.argv[2] || '.', 'caps.json'), 'utf8'));
const slice = (a, bAnchor, bAfter) => { const i = src.indexOf(a); if (i < 0) throw new Error('missing ' + a.slice(0, 40)); const j = src.indexOf(bAnchor, i); const k = src.indexOf(bAfter, j) + bAfter.length; return src.slice(i, k); };
const pre = (() => { const i = src.indexOf('    var recentTranscriptLines = transcript.filter'); const j = src.indexOf('    function _lpCustomerSaid() {', i); const k = src.indexOf('\n      return out;\n    }\n', j) + '\n      return out;\n    }\n'.length; return src.slice(i, k); })();
const conc = slice('      var customerConcerns = [];', "customerConcerns.push('FEATURE UNCERTAINTY", '\n      }\n');
const block = pre + '\n' + conc;
const helper = (name) => { const i = src.indexOf('    function ' + name + '('); const j = src.indexOf('\n    }\n', i); return src.slice(i, j + 6); };
const helpers = helper('_lpCustomerAuthoredPart') + '\n' + helper('_lpIsOurOwnSend');
function runBlock(lines, stubs) {
  const names = Object.keys(stubs);
  const body = helpers + '\n' + block + '\nreturn customerConcerns;';
  for (let tries = 0; tries < 40; tries++) {
    try { return { out: new Function(...names, body)(...names.map(n => stubs[n])), stubs: names }; }
    catch (e) {
      const m = /^(\w+) is not defined$/.exec(e.message);
      if (!m) return { err: e.message };
      stubs[m[1]] = undefined; names.push(m[1]);
    }
  }
  return { err: 'too many missing names' };
}
const line = e => '[' + e.date + '] [' + e.tag + '] ' + e.title + (e.body ? '\n  ' + e.body : '');
const results = [];
const missing = new Set();
for (const c of caps) {
  const tx = c.entries.filter(e => e.tag !== 'INQUIRY' && !/CURRENT LEAD SUBMITTED/.test(e.tag)).map(line);
  const cust = c.entries.filter(e => e.tag === 'CUSTOMER').map(line);
  const logs = [];
  const base = () => ({ transcript: null, _lpD: (x) => logs.push(String(x)), cutoffMs: 0 });
  const full = runBlock(tx, Object.assign(base(), { transcript: tx }));
  const logsFull = logs.splice(0);
  const only = runBlock(cust, Object.assign(base(), { transcript: cust }));
  (full.stubs || []).forEach(n => missing.add(n));
  const lab = r => (r.out || []).map(x => x.split(':')[0]).concat(r.err ? ['ERR ' + r.err] : []);
  results.push({ id: c.id, store: c.store, full: lab(full), custOnly: lab(only), logs: logsFull.filter(l => /SPOUSE|TIMING|TRADE SCOPE|COLOR|FRICTION/.test(l)) });
}
fs.writeFileSync(path.join(process.argv[2] || '.', 'concerns.json'), JSON.stringify(results, null, 1));
console.log('stubbed free names:', [...missing].filter(n => !['transcript', '_lpD', 'cutoffMs'].includes(n)).join(', '));
const tally = {};
for (const r of results) for (const l of r.full) { tally[l] = tally[l] || { fired: 0, notCustomer: 0, ids: [] }; tally[l].fired++; if (!r.custOnly.includes(l)) { tally[l].notCustomer++; tally[l].ids.push(r.id); } }
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1].fired - a[1].fired)) console.log(String(v.fired).padStart(3), 'fired |', String(v.notCustomer).padStart(3), 'NOT from customer lines |', k, v.notCustomer ? '| ' + v.ids.join(' ') : '');
