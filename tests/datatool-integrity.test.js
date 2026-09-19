#!/usr/bin/env node
'use strict';
// (v9.7.621) Registered BEFORE anything can throw. See tests/lib/fatal-guard.js.
require('./lib/fatal-guard.js')('datatool-integrity.test.js');

/**
 * datatool-integrity.test.js — datatool/index.html. THE FILE THAT WAS NEARLY LOST.
 *
 * The Data Tool publishes incentives to all five rooftops and its source lived ONLY in a deployed
 * Cloudflare Worker — nowhere in this repo. On 9/4 that worker was overwritten by a deployment of
 * the dashboard page and the source was gone. It is in the repo now, which is the actual fix; this
 * suite is what keeps it honest.
 *
 * HOW IT WAS RECOVERED, and why the first attempt was refused. The first artifact available was a
 * browser "Save As" pasted into the conversation. Pasting had stripped EVERY newline — 0 newlines
 * across 360 KB — and the app carries 194 `//` line comments, each of which then ran to end of
 * file. The script could not parse, and reinserting the breaks by heuristic (the original
 * indentation survives as runs of spaces) got 158 of them and still failed. That path was dropped
 * rather than nudged until it parsed: a comment boundary placed one token wrong silently deletes a
 * live statement and still compiles, and this is the tool that publishes dollar figures.
 *
 * The second artifact was a saved view-source page, where the browser renders each source line as
 * its own table row — so the line structure survived as markup. 1,027 rows in, 1,027 lines out.
 *
 * CROSS-VALIDATED, which is the part that makes this trustworthy: the two captures were taken
 * independently, and after whitespace normalisation they differ by exactly 144 single spaces, each
 * one sitting at a line boundary. No content differs between them anywhere.
 *
 * WHAT WAS REMOVED — all of it injected by the browser, all of it sitting after the app's own
 * closing </script>: three <simplycodes-ui> elements each carrying a nested copy of the whole page
 * in a shadow template (why a 67 KB app saved as 360 KB), <scribe-shadow>, a Grammarly integration
 * node, <protonpass-root>, a chrome-extension:// stylesheet <link>, and the marker attributes
 * those extensions stamped on <html>, <body> and the two .send-body divs.
 *
 * THE ONE LINE THAT IS NOT VERBATIM: saving rewrote the Google Fonts <link> to a local folder path
 * that would 404 when served. It is restored to fonts.googleapis.com with the weights the page's
 * own CSS uses (500/600/700) for the two families it names. Chrome's Save As also swapped the
 * charset <meta> for its http-equiv equivalent; both declare UTF-8, so it is left as captured.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const FILE = process.argv.slice(2).find(a => /\.html$/.test(a)) ||
             path.join(__dirname, '..', 'datatool', 'index.html');
const src = fs.readFileSync(FILE, 'utf8');

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        expected ' + w + '\n        got      ' + g); }
}

console.log('\ndatatool/index.html — the source that only existed on a Worker');
console.log('file: ' + path.relative(process.cwd(), FILE));

// ── IT MUST RUN ──────────────────────────────────────────────────────────────
// The whole recovery turned on this. A capture that lost its newlines produced a file that looked
// complete and could not execute a line of it.
console.log('\nthe app executes:');
const i = src.indexOf('<script>', 100), j = src.indexOf('</script>', i);
check('the inline app script is present', i > -1 && j > i, true);
const app = src.slice(i + 8, j);
let parsed = '';
try { new vm.Script(app, { filename: 'datatool' }); parsed = 'ok'; } catch (e) { parsed = e.message; }
check('...and it PARSES', parsed, 'ok');
check('...with its line structure intact', app.split('\n').length > 700, true);
// The exact failure that made the first capture worthless: no newlines, so the first // comment
// swallowed the rest of the file.
check('line comments are terminated by real newlines',
  app.split('\n').filter(l => /(^|[^:])\/\//.test(l)).length > 150, true);

// ── NOTHING THE BROWSER ADDED MAY SHIP ───────────────────────────────────────
console.log('\nno browser-injected content survives:');
[['simplycodes', 'SimplyCodes shadow DOM'], ['SCExtension', 'SimplyCodes ids'],
 ['scribe', 'Scribe recorder'], ['grammarly', 'Grammarly'], ['protonpass', 'Proton Pass'],
 ['crxjs', 'crxjs host'], ['chrome-extension://', 'an extension stylesheet'],
 ['Data Tool_files', 'the Save As local asset folder'], ['saved from url', 'the Save As comment']
].forEach(([needle, what]) => check('  ' + what + ' is gone', src.indexOf(needle), -1));
check('the fonts link points at Google, not a local folder',
  /<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*IBM\+Plex\+Mono[^"]*" rel="stylesheet">/.test(src), true);

// ── THE SURFACE IS WHOLE ─────────────────────────────────────────────────────
// Both tabs, both submodes, both upload paths. A restoration missing one control would look fine.
console.log('\nboth panels and every control are present:');
const IDS = ['panel-inv','inv-drop','inv-file','inv-filelist','inv-go','inv-dl','inv-msg',
  'inv-summary','inv-statline','inv-rows','inv-ep','inv-lk','inv-post','panel-inc','submode-sheet',
  'inc-drop','inc-file','inc-filelist','submode-page','inc-page-store','inc-page-expires',
  'inc-page-drop','inc-page-file','inc-page-filelist','inc-page-msg','inc-go','inc-dl','inc-msg',
  'inc-summary','inc-statline','inc-rows','inc-warn','inc-ep','inc-lk','inc-post'];
const present = IDS.filter(id => src.indexOf('id="' + id + '"') > -1);
check('all ' + IDS.length + ' element ids', present.length, IDS.length);
if (present.length !== IDS.length) check('  missing', IDS.filter(x => present.indexOf(x) < 0), []);
check('the tab wiring survived',      (src.match(/data-tab=/g) || []).length, 2);
check('the submode wiring survived',  (src.match(/data-sub=/g) || []).length, 2);
check('every handler is still bound', (src.match(/addEventListener/g) || []).length, 13);

// ── THE FACTS IT PUBLISHES WITH ──────────────────────────────────────────────
console.log('\nthe rooftops and endpoints it publishes to:');
['6189','6190','6191','24399','21135'].forEach(d =>
  check('  dealer ' + d + ' is mapped', src.indexOf('"' + d + '"') > -1, true));
check('the inventory endpoint',  /id="inv-ep" value="https:\/\/leadpro-proxy\.gilsguzman\.workers\.dev\/inventory"/.test(src), true);
check('the valuefact endpoint',  /id="inc-ep" value="https:\/\/leadpro-proxy\.gilsguzman\.workers\.dev\/valuefact"/.test(src), true);
check('the expiry kill-switch is still enforced at publish time',
  /never publish an already-expired fact/.test(src), true);

// ── NO CREDENTIAL IN THE FILE ────────────────────────────────────────────────
// This one ships to a Worker with a public URL. The key is typed in, never stored.
console.log('\nit carries no credential:');
check('both license-key fields are empty password inputs',
  (src.match(/<input id="in[cv]-lk" class="lk" placeholder="paste license key" type="password">/g) || []).length, 2);
check('no license key is baked into the source', /LPDEV-|value="LP[A-Z0-9-]{6,}"/.test(src), false);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
