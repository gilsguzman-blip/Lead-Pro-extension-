// Minimal DOM/chrome stub environment for loading the Lead Pro extension scripts
// in Node (vm context) so specific functions can be exercised without a browser.
// This is NOT a full DOM — just enough surface for the boot path and the
// functions under test (classifyScenario, populateFromData, buildUserPrompt,
// and an extracted inlineScraper).
'use strict';
const vm = require('vm');

function makeElement(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    value: '', textContent: '', innerText: '', innerHTML: '',
    style: {}, dataset: {}, title: '', disabled: false, id: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    attributes: {},
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, removeChild() {}, focus() {}, click() {},
    // Return a cached child element per selector — UI code does
    // container.querySelector('#x').addEventListener(...) during boot.
    querySelector(sel) {
      this._children = this._children || {};
      if (!this._children[sel]) this._children[sel] = makeElement('div');
      return this._children[sel];
    },
    querySelectorAll: () => [],
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; },
    setAttribute(name, v) { this.attributes[name] = String(v); },
    cloneNode() { return makeElement(tag); },
  };
  el.parentNode = { replaceChild() {} };
  el.parentElement = { style: {} };
  return el;
}

// A fake note element matching the shapes inlineScraper reads:
// .notes-and-hsitory-item-date / .legacy-notes-and-history-title / .notes-and-history-item-content
function makeNote({ date, title, content, direction }) {
  const parts = {
    '.notes-and-hsitory-item-date': date || '',
    '.legacy-notes-and-history-title': title || '',
    '.notes-and-history-item-content': content || '',
  };
  const note = makeElement('div');
  note.innerText = (title || '') + '\n' + (content || '');
  note.innerHTML = '';
  note.attributes['data-direction'] = direction || '';
  note.querySelector = (sel) => {
    for (const key of Object.keys(parts)) {
      if (sel.indexOf(key.slice(1)) !== -1) {
        const child = makeElement('span');
        child.innerText = parts[key];
        child.textContent = parts[key];
        return child;
      }
    }
    return null;
  };
  note.querySelectorAll = () => [];
  return note;
}

function buildContext({ bodyText = '', notes = [], href = 'https://apps.vinsolutions.com/rims2.aspx' } = {}) {
  const elementCache = {};
  const document = {
    body: {
      innerText: bodyText, textContent: bodyText, innerHTML: '',
      classList: { add() {}, remove() {} },
      appendChild() {}, removeChild() {},
    },
    title: '',
    getElementById(id) {
      if (!elementCache[id]) { elementCache[id] = makeElement('div'); elementCache[id].id = id; }
      return elementCache[id];
    },
    querySelector() { return null; },
    querySelectorAll(sel) {
      if (sel && sel.indexOf('notes-and-history-item') !== -1) return notes;
      return [];
    },
    createElement(tag) { return makeElement(tag); },
    addEventListener() {},
  };

  const chrome = {
    storage: {
      sync:  { get: (k, cb) => cb({}), set: (d, cb) => cb && cb(), remove: (k, cb) => cb && cb() },
      local: { get: (k, cb) => cb({}), set: (d, cb) => cb && cb(), remove: (k, cb) => cb && cb() },
    },
    runtime: {
      getManifest: () => ({ version: '9.7.364', version_name: 'v9.7.364' }),
      onMessage: { addListener() {} },
      lastError: null,
    },
    tabs: { query: (o, cb) => cb([]) },
    scripting: { executeScript() {} },
    sidePanel: { setPanelBehavior: () => Promise.resolve(), open: () => Promise.resolve() },
    action: { onClicked: { addListener() {} } },
  };

  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, RegExp, String, Number, Boolean, Array, Object, Set, Map, Promise, Infinity, NaN,
    parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
    document, chrome,
    navigator: { clipboard: { writeText: () => Promise.resolve(), write: () => Promise.resolve() } },
    location: { href },
    alert() {}, confirm() { return false; },
    requestAnimationFrame(cb) { setTimeout(cb, 0); },
    fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
    URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    Blob: function () {},
    FileReader: function () { this.readAsText = () => {}; },
    performance: { getEntriesByType: () => [], timeOrigin: Date.now(), timing: { responseEnd: Date.now() } },
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false }),
    outerWidth: 400, innerWidth: 400, innerHeight: 600,
    close() {},
    _noteFactory: makeNote,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

module.exports = { buildContext, makeNote, makeElement };
