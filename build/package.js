#!/usr/bin/env node
'use strict';
/**
 * package.js — bump, check and package both builds.
 *
 * Exists because the build conventions are prose, and prose has been violated three
 * times with real consequences:
 *   - a missed manifest "version_name"  -> Chrome Web Store rejection
 *   - a zip built without the icons     -> Chrome Web Store rejection
 *   - a version number REUSED for changed code -> v9.7.535 was forked from a superseded
 *     v9.7.534 and silently shipped without that build's fix
 * Each of those is now a hard failure here rather than something to remember.
 *
 *   node build/package.js                              verify current state, repackage
 *   node build/package.js --dev 9.7.537 --comm 9.7.535 bump all three places, then package
 *
 * Add --no-zip to check without writing artifacts.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const _ARGV = process.argv.slice(2);
process.chdir(__dirname);
const ROOT = path.resolve('..');
const DIST = path.join(ROOT, 'dist');

const arg = n => { const i = _ARGV.indexOf('--' + n); return i > -1 ? _ARGV[i + 1] : null; };
const NO_ZIP = _ARGV.includes('--no-zip');

const SIDES = [
  { dir: 'dev',        label: 'DEV',        suffix: '-dev', want: arg('dev'),  zip: v => 'leadpro_DEV_v' + v.replace(/\./g, '_') + '.zip' },
  { dir: 'commercial', label: 'COMMERCIAL', suffix: '',     want: arg('comm'), zip: v => 'leadpro_COMMERCIAL_v' + v.replace(/\./g, '_') + '.zip' }
];

const EXPECTED_FILES = [
  'auth.js', 'background.js', 'config.js', 'content.js', 'dealer-config.js',
  'dealer-setup.js', 'icon128.png', 'icon48.png', 'manifest.json', 'popup.html', 'popup.js'
];

let failed = 0;
const ok   = m => console.log('  ✓ ' + m);
const bad  = m => { failed++; console.log('  ✗ ' + m); };

function headerVersions(src) {
  // every changelog line starts: // Lead Pro -- popup.js  v9.7.NNN[-dev] (
  return (src.split('\n').filter(l => /^\/\/ Lead Pro -- popup\.js\s+v/.test(l)))
    .map(l => (l.match(/v(\d+\.\d+\.\d+)(-dev)?/) || [])[1])
    .filter(Boolean);
}

for (const side of SIDES) {
  console.log('\n' + side.label);
  const pj = path.join(side.dir, 'popup.js');
  const mj = path.join(side.dir, 'manifest.json');
  let src = fs.readFileSync(pj, 'utf8');
  let man = JSON.parse(fs.readFileSync(mj, 'utf8'));

  // ── bump ────────────────────────────────────────────────────────────────
  if (side.want) {
    const prior = headerVersions(src);
    if (prior.includes(side.want)) {
      bad('version ' + side.want + ' already appears in the changelog — REUSING A VERSION NUMBER '
          + 'is what let v9.7.535 fork from a superseded build. Pick a higher one.');
      continue;
    }
    if (!/^\/\/ Lead Pro -- popup\.js\s+v/.test(src.split('\n')[0])) {
      bad('top line is not a changelog header — write the entry first, then bump');
      continue;
    }
    man.version = side.want;
    man.version_name = side.want + side.suffix;
    fs.writeFileSync(mj, JSON.stringify(man, null, 2) + '\n');
    ok('manifest bumped to ' + man.version + ' / ' + man.version_name);
  }

  // ── the three places must agree ─────────────────────────────────────────
  const headerV = headerVersions(src)[0];
  if (!headerV) bad('no changelog header found at the top of popup.js');
  else if (headerV !== man.version) bad('changelog header v' + headerV + ' != manifest version ' + man.version);
  else ok('changelog header, manifest.version agree at ' + man.version);

  if (!man.version_name) bad('manifest has NO version_name (this caused a store rejection)');
  else if (man.version_name !== man.version + side.suffix) bad('version_name "' + man.version_name + '" should be "' + man.version + side.suffix + '"');
  else ok('version_name = ' + man.version_name);

  // ── syntax + manifest parse ─────────────────────────────────────────────
  try { execFileSync(process.execPath, ['--check', pj], { stdio: 'pipe' }); ok('node --check clean'); }
  catch (e) { bad('node --check FAILED: ' + String(e.stderr || e).split('\n')[0]); }

  // ── file set ────────────────────────────────────────────────────────────
  const present = fs.readdirSync(side.dir).filter(f => !f.startsWith('.')).sort();
  const missing = EXPECTED_FILES.filter(f => !present.includes(f));
  const extra   = present.filter(f => !EXPECTED_FILES.includes(f));
  if (missing.length) bad('MISSING ' + missing.join(', '));
  else if (extra.length) bad('unexpected extra file(s): ' + extra.join(', '));
  else ok('all 11 files present (icons included)');

  side.version = man.version;
}

// ── parity: both sides ship the same file set ─────────────────────────────
console.log('\nPARITY');
const setOf = d => fs.readdirSync(d).filter(f => !f.startsWith('.')).sort().join(',');
if (setOf('dev') !== setOf('commercial')) bad('dev and commercial file sets differ');
else ok('dev and commercial ship the same 11 files');

if (failed) {
  console.log('\n' + failed + ' check(s) failed — not packaging.\n');
  process.exit(1);
}

// ── package ───────────────────────────────────────────────────────────────
if (NO_ZIP) { console.log('\nAll checks passed (--no-zip, nothing written).\n'); process.exit(0); }

console.log('\nPACKAGE');
fs.mkdirSync(DIST, { recursive: true });
const keep = SIDES.map(s => s.zip(s.version));
for (const f of fs.readdirSync(DIST)) {
  if (f.endsWith('.zip') && !keep.includes(f)) { fs.unlinkSync(path.join(DIST, f)); ok('pruned superseded ' + f); }
}
for (const side of SIDES) {
  const out = path.join(DIST, side.zip(side.version));
  if (fs.existsSync(out)) fs.unlinkSync(out);
  execFileSync('zip', ['-j', '-q', out].concat(EXPECTED_FILES.map(f => path.join(side.dir, f))));
  const listed = execFileSync('unzip', ['-Z1', out]).toString().trim().split('\n').sort();
  if (listed.join(',') !== EXPECTED_FILES.slice().sort().join(',')) bad(side.label + ' zip contents wrong: ' + listed.join(', '));
  else ok(side.label + ' -> dist/' + path.basename(out) + '  (' + listed.length + ' files, '
          + listed.filter(f => f.endsWith('.png')).length + ' png)');
}

console.log(failed ? '\n' + failed + ' failure(s).\n' : '\nDone. Not deployed.\n');
process.exit(failed ? 1 : 0);
