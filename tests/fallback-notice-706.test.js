#!/usr/bin/env node
'use strict';
// (v9.7.706) Paired with proxy v7.77, Gil's items 4 and 7.
//   4  every /generate body carries extensionVersion, from the manifest (the feedback rows' source)
//   7  a _fallback envelope renders a failure notice with a retry button and NO draft: the fields are
//      emptied, their Copy buttons disabled until the next generation, and [LP FALLBACK DIAG] logged.
// Runs the whole popup.js. The notice handler is executed against a small fake DOM, and so is the
// fallback branch of generateAll itself, lifted verbatim from the shipped source (generateAll as a
// whole needs a live panel: tabs, storage and a grabbed lead).
//
// Usage: node tests/fallback-notice-706.test.js <dev popup.js> <commercial popup.js>
const path = require('path'), vm = require('vm'), fs = require('fs');
const loadPopup = require('./helpers/load-popup.js');
const BUILDS = process.argv.slice(2).filter(a => /popup\.js$/.test(a));
if (!BUILDS.length) { console.error('usage: fallback-notice-706.test.js <popup.js> [popup.js...]'); process.exit(2); }
let pass = 0, fail = 0;
function check(name, fn, want) {
  let got; try { got = (typeof fn === 'function') ? fn() : fn; } catch (e) { got = 'THREW: ' + e.message; }
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

// ── a small fake DOM: the three panes, their Copy buttons, and where the notice goes ────────────
function fakeDom() {
  const byId = {};
  function el(tag) {
    const e = { tagName: tag, value: '', textContent: '', style: {}, children: [], attrs: {}, disabled: false, listeners: {}, parentNode: null,
      classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, contains(c) { return this.s.has(c); } },
      get firstChild() { return this.children[0] || null; },
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      removeChild(c) { this.children = this.children.filter(x => x !== c); },
      insertBefore(n, r) { this.children.splice(this.children.indexOf(r), 0, n); n.parentNode = this; return n; },
      setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') byId[v] = this; },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      removeAttribute(k) { delete this.attrs[k]; },
      addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      click() { (this.listeners.click || []).forEach(f => f()); } };
    const px = new Proxy(e, { set(o, k, v) { o[k] = v; if (k === 'id') byId[v] = px; return true; } });
    return px;
  }
  const root = el('div'), outSec = el('div');
  outSec.classList.add('output-section'); root.appendChild(outSec);
  const fields = {}, copies = [];
  ['sms', 'email', 'vm'].forEach(k => {
    fields[k] = el('textarea'); fields[k].value = 'PREVIOUS ' + k + ' text'; byId['output-' + k] = fields[k];
    const b = el('button'); b.classList.add('btn-copy'); b.setAttribute('data-pane', k); copies.push(b);
  });
  const doc = {
    getElementById: id => byId[id] || null,
    querySelectorAll: q => {
      let m = q.match(/^\.btn-copy\[data-pane="(\w+)"\]$/); if (m) return copies.filter(b => b.getAttribute('data-pane') === m[1]);
      m = q.match(/^\.btn-copy\[data-lp-fallback="1"\]$/); if (m) return copies.filter(b => b.getAttribute('data-lp-fallback') === '1');
      return [];
    },
    querySelector: q => (q === '.output-section' ? outSec : null),
    createElement: el,
  };
  return { doc, fields, copies, byId };
}
const ENVELOPE = { candidates: [{ content: { parts: [{ text: JSON.stringify({
    sms: "Thanks for reaching out. I'm pulling your information together and will follow up shortly.", email: 'e', voicemail: 'v' }) }] },
  finishReason: 'STOP', _fallback: true, _fallbackMs: 23100, _requestId: 'rid-777', _lastError: 'Timeout after 8000ms', _lastTier: 'emergency', _lastModel: 'm-3' }],
  usageMetadata: { promptTokenCount: 0 } };

for (const f of BUILDS) {
  console.log('\n' + path.basename(path.dirname(f)) + '/' + path.basename(f));
  let sb; try { sb = loadPopup(f, { withAuth: true }); } catch (e) { console.log('  FAIL load: ' + e.message); fail++; continue; }
  const src = fs.readFileSync(f, 'utf8');

  console.log(' 4. the build stamp on /generate:');
  const withManifest = (mf, fn) => { const prev = sb.chrome; sb.chrome = { runtime: { getManifest: () => mf } };
    vm.runInContext('chrome = globalThis.chrome;', sb); try { return fn(); } finally { sb.chrome = prev; vm.runInContext('chrome = globalThis.chrome;', sb); } };
  check('a generate-shaped body gets extensionVersion from the manifest\'s version_name',
    () => withManifest({ version: '9.7.706', version_name: '9.7.706-dev' }, () => sb._lpAttachLicense({ system_instruction: {}, contents: [] }).extensionVersion), '9.7.706-dev');
  check('...falling back to v + version, exactly as the feedback row does',
    () => withManifest({ version: '9.7.706' }, () => sb._lpAttachLicense({ system_instruction: {} }).extensionVersion), 'v9.7.706');
  check('control: a body that is not a generate request is left alone (feedback carries its own)',
    () => withManifest({ version: '9.7.706', version_name: '9.7.706' }, () => 'extensionVersion' in sb._lpAttachLicense({ rating: 'up' })), false);
  check('control: no manifest (a harness, a broken runtime) → no field, and no throw',
    () => withManifest(null, () => 'extensionVersion' in sb._lpAttachLicense({ system_instruction: {} })), false);

  console.log(' 7. a _fallback envelope — the notice, no draft, nothing copyable:');
  {
    const D = fakeDom(); let retried = 0;
    sb.__logs.length = 0;
    try { sb._lpShowFallbackNotice(ENVELOPE, 'generate', () => { retried++; }, null, D.doc); } catch (e) { console.log('  (handler threw: ' + e.message + ')'); }
    const n = D.byId.lpFallbackNotice;
    check('all three fields are emptied — the previous text is gone', Object.values(D.fields).map(x => x.value), ['', '', '']);
    check('all three Copy buttons are disabled', D.copies.map(b => b.disabled), [true, true, true]);
    check('the notice says "Draft generation failed. Try again." and sits before the output', [n && n.children[0].textContent, n && n.parentNode && n.parentNode.children.indexOf(n) === 0],
      ['⚠ Draft generation failed. Try again.', true]);
    check('its retry button re-runs the generation, hides the notice and re-enables Copy', () => {
      n.children[1].click(); return [retried, n.style.display, D.copies.map(b => b.disabled)]; }, [1, 'none', [false, false, false]]);
    check('[LP FALLBACK DIAG] logs the tier, error, request id and time — and no draft text', () => {
      const l = sb.__logs.find(x => /^\[LP FALLBACK DIAG\]/.test(x)) || '';
      return [/generate \| proxy served _fallback/.test(l), /requestId:rid-777 \| lastTier:emergency \| lastModel:m-3 \| lastError:Timeout after 8000ms \| fallbackMs:23100/.test(l), /pulling your information/.test(l)]; },
      [true, true, false]);
  }
  {
    const D = fakeDom();
    try { sb._lpShowFallbackNotice(ENVELOPE, 'voicemail', () => {}, ['vm'], D.doc); } catch (e) { console.log('  (handler threw: ' + e.message + ')'); }
    check('a VOICEMAIL failure clears only the voicemail pane — the SMS and email the agent has survive',
      [D.fields.sms.value, D.fields.email.value, D.fields.vm.value, D.copies.map(b => b.disabled)],
      ['PREVIOUS sms text', 'PREVIOUS email text', '', [false, false, true]]);
  }
  {
    // THE SHIPPED BRANCH OF generateAll, lifted verbatim and run: from the fallback check to its return.
    const a = src.indexOf("if (data && data.candidates && data.candidates[0] && data.candidates[0]._fallback) {", src.indexOf('async function generateAll('));
    const b = src.indexOf('return;', a) + 'return;'.length;
    const branch = a > 0 ? src.slice(a, b) + '\n}' : '';
    const D = fakeDom(); let clicked = 0;
    const gen = D.doc.createElement('button'); gen.id = 'btnGenerate'; gen.addEventListener('click', () => { clicked++; });
    const run = (data) => {
      // The branch calls _lpShowFallbackNotice with no doc, i.e. the page's global document: point it at the fake.
      const prev = sb.document; sb.document = D.doc; vm.runInContext('document = globalThis.document;', sb);
      try {
        vm.runInContext('globalThis.__branch = function(data){ ' + branch + ' return "rendered"; }', sb);
        return sb.__branch(data);
      } finally { sb.document = prev; vm.runInContext('document = globalThis.document;', sb); }
    };
    check('control: generateAll\'s fallback branch returns before rendering anything (true since v9.7.379)', a > 0 ? (run(ENVELOPE) === undefined) : 'branch not found', true);
    check('...having emptied the fields and disabled Copy', [Object.values(D.fields).map(x => x.value), D.copies.map(x => x.disabled)], [['', '', ''], [true, true, true]]);
    check('...and its retry clicks Generate', () => { const prev = sb.document; sb.document = D.doc; vm.runInContext('document = globalThis.document;', sb);
      try { D.byId.lpFallbackNotice.children[1].click(); } finally { sb.document = prev; vm.runInContext('document = globalThis.document;', sb); } return clicked; }, 1);
    check('control: a normal envelope falls through the branch to rendering', a > 0 ? run({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }) : 'branch not found', 'rendered');
    check('generateAll and generateVoicemail clear the notice first thing',
      [/async function generateAll\(\) \{\n  try \{ _lpClearFallbackNotice\(\); \}/.test(src), /async function generateVoicemail\(\) \{\n  try \{ _lpClearFallbackNotice\(\); \}/.test(src)], [true, true]);
  }
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
