'use strict';
// Loads a whole popup.js into a vm sandbox with inert DOM/chrome stubs, so module functions
// (buildUserPrompt, buildSystemPrompt, ...) can be executed directly.
const fs = require('fs'), vm = require('vm');
function stub(name) {
  const f = function () { return stub(name + '()'); };
  return new Proxy(f, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'then') return undefined;
      if (k === 'length') return 0;
      if (k === 'value' || k === 'textContent' || k === 'innerText' || k === 'innerHTML') return '';
      if (k === 'checked' || k === 'disabled') return false;
      if (k === 'classList') return { add(){}, remove(){}, toggle(){}, contains(){ return false; } };
      if (k === 'style' || k === 'dataset') return {};
      if (k === 'querySelectorAll' || k === 'getElementsByClassName' || k === 'getElementsByTagName') return () => [];
      if (k === 'getElementById' || k === 'querySelector') return () => null;
      if (k === 'addEventListener' || k === 'removeEventListener') return () => {};
      return stub(name + '.' + String(k));
    },
    apply() { return stub(name + '()'); },
    construct() { return stub('new ' + name); },
    set() { return true; }
  });
}
module.exports = function loadPopup(file, opts) {
  opts = opts || {};
  const src = fs.readFileSync(file, 'utf8');
  const logs = [];
  const store = {};
  const document = {
    getElementById: (id) => stub('#'+id), querySelector: (q) => stub(q), querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}, createElement: () => stub('el'),
    body: stub('body'), documentElement: stub('docEl'), readyState: 'complete'
  };
  const chrome = stub('chrome');
  const sandbox = {
    console: { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')), info(){}, debug(){} },
    document, chrome, navigator: { userAgent: 'node', clipboard: stub('clip') },
    localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, requestAnimationFrame: () => 0,
    fetch: () => new Promise(() => {}), MutationObserver: function () { return { observe() {}, disconnect() {} }; },
    location: { href: 'chrome-extension://x/popup.html' }, alert() {}, confirm: () => false,
    Blob: function () {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    AbortController: function () { return { signal: {}, abort() {} }; }, TextEncoder, TextDecoder,
    crypto: require('crypto').webcrypto,
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  sandbox.addEventListener = () => {}; sandbox.removeEventListener = () => {};
  vm.createContext(sandbox);
  // opts.withAuth: run the build's own auth.js first, as popup.html does, so the persona layer
  // (LEADPRO_AUTH, the voice profiles) is present exactly as it is in the panel.
  if (opts.withAuth) {
    const authFile = require('path').join(require('path').dirname(file), 'auth.js');
    vm.runInContext(fs.readFileSync(authFile, 'utf8'), sandbox, { filename: authFile });
  }
  vm.runInContext(src + '\n;this.__lp = { buildUserPrompt: typeof buildUserPrompt === "function" ? buildUserPrompt : null, buildSystemPrompt: typeof buildSystemPrompt === "function" ? buildSystemPrompt : null };', sandbox, { filename: file });
  sandbox.__logs = logs;
  return sandbox;
};
