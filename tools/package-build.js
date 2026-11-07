#!/usr/bin/env node
'use strict';
// (v9.7.850) AUDIT M-6: THE SHIPPED ZIP CARRIES CODE, NOT HISTORY.
// popup.js is about 4.4 MB, and most of it is whole-line `//` comments: build headers and the reasoning behind each fix.
// That history belongs in the repo, where it stays. The zip loads into every agent's browser, so this script ships a copy
// with line-start `//` comments removed. Line 1 of popup.js is kept: it is the build identity the console prints.
//
// It refuses to write a zip unless, for every .js file:
//   1. node --check passes on the stripped file;
//   2. every string, regex, number and template piece is byte-identical before and after (acorn: each Literal.raw and each
//      TemplateElement.value.raw, in order) -- so no line that merely LOOKED like a comment, inside a template literal or a
//      continued string, was removed;
//   3. the whole syntax tree, positions aside, is identical -- so nothing else changed either (ASI included).
// The repo and the builds/ folders are never modified; the stripping happens in a staging copy.
//
// Usage:
//   node tools/package-build.js <build dir> <out.zip> [--stage <dir>] [--acorn <node_modules dir>]
// acorn and acorn-walk are resolved from --acorn, then $LP_ACORN_PATH, then the normal module path.
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); if (i < 0) return ''; const v = args[i + 1]; args.splice(i, 2); return v; };
const acornDir = opt('--acorn') || process.env.LP_ACORN_PATH || '';
let stageDir = opt('--stage');
const [buildDir, outZip] = args;
if (!buildDir || !outZip) { console.error('usage: package-build.js <build dir> <out.zip> [--stage <dir>] [--acorn <node_modules dir>]'); process.exit(2); }

function load(name) {
  if (acornDir) { try { return require(path.join(acornDir, name)); } catch (e) {} }
  return require(name);
}
let acorn, walk;
try { acorn = load('acorn'); walk = load('acorn-walk'); }
catch (e) { console.error('acorn / acorn-walk not found. Install them (npm i acorn acorn-walk) and pass --acorn <node_modules dir>.'); process.exit(2); }

// Remove whole lines whose first non-blank characters are `//`. keepFirst keeps line 1 even when it is a comment.
function strip(src, keepFirst) {
  const lines = src.split('\n');
  const out = [];
  let removed = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^[ \t]*\/\//.test(lines[i]) && !(keepFirst && i === 0)) { removed++; continue; }
    out.push(lines[i]);
  }
  return { text: out.join('\n'), removed };
}

function parse(src, file) {
  for (const sourceType of ['script', 'module']) {
    try { return acorn.parse(src, { ecmaVersion: 'latest', sourceType, allowHashBang: true }); } catch (e) { if (sourceType === 'module') throw new Error(file + ': ' + e.message); }
  }
}
function literals(ast) {
  const out = [];
  walk.full(ast, (n) => {
    if (n.type === 'Literal') out.push(n.raw);
    else if (n.type === 'TemplateElement') out.push(n.value.raw);
  });
  return out;
}
function shape(ast) {
  return JSON.stringify(ast, (k, v) => (k === 'start' || k === 'end') ? undefined : v);
}

const files = fs.readdirSync(buildDir).filter(f => fs.statSync(path.join(buildDir, f)).isFile() && f !== '.DS_Store');
if (!files.includes('manifest.json')) { console.error(buildDir + ': no manifest.json'); process.exit(2); }
const ownStage = !stageDir;
if (ownStage) stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-pkg-'));
fs.mkdirSync(stageDir, { recursive: true });

let failed = 0, totalLits = 0, before = 0, after = 0;
for (const f of files.sort()) {
  const src = fs.readFileSync(path.join(buildDir, f));
  before += src.length;
  if (!/\.js$/.test(f)) { fs.writeFileSync(path.join(stageDir, f), src); after += src.length; continue; }
  const text = src.toString('utf8');
  const s = strip(text, f === 'popup.js');
  const dst = path.join(stageDir, f);
  fs.writeFileSync(dst, s.text);
  after += Buffer.byteLength(s.text);
  let why = '';
  try { cp.execFileSync(process.execPath, ['--check', dst], { stdio: 'pipe' }); } catch (e) { why = 'node --check failed: ' + String(e.stderr || e.message).split('\n').slice(0, 4).join(' '); }
  let litA = [], litB = [];
  if (!why) {
    try {
      const a = parse(text, f), b = parse(s.text, f);
      litA = literals(a); litB = literals(b);
      if (litA.length !== litB.length) why = 'literal count changed: ' + litA.length + ' -> ' + litB.length;
      else { const i = litA.findIndex((x, j) => x !== litB[j]); if (i >= 0) why = 'literal #' + i + ' changed: ' + JSON.stringify(litA[i]).slice(0, 120) + ' -> ' + JSON.stringify(litB[i]).slice(0, 120); }
      if (!why && shape(a) !== shape(b)) why = 'syntax tree changed (positions aside)';
    } catch (e) { why = 'parse failed: ' + e.message; }
  }
  totalLits += litA.length;
  if (why) { failed++; console.log('  FAIL ' + f + ': ' + why); }
  else console.log('  ok   ' + f + ': ' + s.removed + ' comment lines removed, ' + litA.length + ' literals identical, tree identical, ' + (src.length / 1024).toFixed(0) + ' KB -> ' + (Buffer.byteLength(s.text) / 1024).toFixed(0) + ' KB');
}
if (failed) { console.log('REFUSED: ' + failed + ' file(s) failed the gate; no zip written.'); process.exit(1); }

const absZip = path.resolve(outZip);
try { fs.unlinkSync(absZip); } catch (e) {}
cp.execFileSync('zip', ['-q', '-j', '-X', absZip].concat(files.sort().map(f => path.join(stageDir, f))));
const zipped = cp.execFileSync('unzip', ['-Z1', absZip]).toString().trim().split('\n');
const missing = files.filter(f => !zipped.includes(f));
if (missing.length) { console.log('REFUSED: zip is missing ' + missing.join(', ')); process.exit(1); }
console.log('PACKAGED ' + path.basename(absZip) + ': ' + zipped.length + ' files (' + files.filter(f => /\.png$/.test(f)).length + ' PNG), '
  + totalLits + ' literals identical, ' + (before / 1048576).toFixed(2) + ' MB -> ' + (after / 1048576).toFixed(2) + ' MB unpacked, '
  + (fs.statSync(absZip).size / 1048576).toFixed(2) + ' MB zipped');
if (ownStage) fs.rmSync(stageDir, { recursive: true, force: true });
else console.log('stripped copy kept at ' + stageDir);
