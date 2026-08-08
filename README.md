# Lead Pro

AI-powered BDC response tool for Community Auto Group. Chrome MV3 extension (side panel)
that reads a VinSolutions lead and drafts SMS / email / voicemail.

## Layout

```
build/dev/           DEV extension source        — v9.7.536-dev
build/commercial/    COMMERCIAL extension source — v9.7.534
build/*.js           verification harnesses (see below)
worker/              Cloudflare Worker source    — v7.47
dist/                packaged .zip for the current build pair only
```

`build/dev` and `build/commercial` are **the source of truth**. They are full, unpacked
extensions (11 files each: `popup.js`, `popup.html`, `auth.js`, `content.js`,
`background.js`, `config.js`, `dealer-config.js`, `dealer-setup.js`, `manifest.json`,
`icon128.png`, `icon48.png`).

> Until v9.7.536 the repo root held a `popup.js` / `content.js` / `manifest.json` /
> `popup.html` / `cloudflare-worker.js` from the v8.75 era — roughly 400 extension
> versions and 4 worker major versions stale. Anyone opening them was reading dead code.
> They were deleted, not moved: nothing referenced them and `build/` supersedes all of it.

## The changelog lives in the source

Every version's reasoning is a comment line at the top of `popup.js`, newest first. These
entries are long on purpose — they record *why* a behaviour exists, which incident forced
it, and which hypotheses were tried and disproved. **Read the header before changing
detector logic.** Several entries exist specifically to stop a later reader from
"restoring" behaviour that was removed deliberately.

## Building

DEV and COMMERCIAL ship together and their changed regions must be byte-identical.

1. Edit both `build/dev/popup.js` and `build/commercial/popup.js`; diff the changed region.
2. Bump the version in **three** places — the top-of-file changelog header, `manifest.json`
   `"version"`, and `manifest.json` `"version_name"`. A missed `version_name` once caused a
   Chrome Web Store rejection.
3. `node --check` both builds.
4. Package with `zip -j` including `*.png` — **11 files**. A build that omitted the icons
   was rejected.
5. Confirm both `manifest.json` files parse.

```sh
cd build/dev        && zip -j ../../dist/leadpro_DEV_v9_7_536.zip        *.js *.json *.html *.png
cd build/commercial && zip -j ../../dist/leadpro_COMMERCIAL_v9_7_534.zip *.js *.json *.html *.png
```

`dist/` holds only the current pair. Superseded zips are removed on each build so there is
exactly one artifact per side — v9.7.535 shipped a regression precisely because it was
forked from a superseded build carrying an already-used version number. **Never reuse a
version number for changed code.**

## Verification

Every harness loads the **real shipped bytes** — it string-slices the region under test out
of `popup.js` and evaluates it. None of them reimplement the logic. This matters: a suite
built on reconstructed inputs has twice passed while the real page failed (v9.7.533,
v9.7.534).

All of them run from any directory — CLI paths resolve against your shell's cwd, internal
paths against `build/`.

Self-contained (work from a fresh clone):

| command | what it covers |
|---|---|
| `node build/verify.js build/dev/popup.js` | SMS carrier-STOP / exit-signal decision, 21 cases |
| `node build/repro_gerra.js build/dev/popup.js` | reproduces the Gerra incident from log99 field-for-field |
| `node build/leadpro.test.js` | 125 scenario tests (see caveat below) |

Comparative — these diff **two** builds, so they need a prior `popup.js` on disk. Stage it
in `build/orig/` (what `differential.js` and `gerra_e2e.js` expect) or pass paths directly:

| command | what it covers |
|---|---|
| `node build/differential.js` | SMS region vs `build/orig/dev/popup.js`, 4,800 lead shapes |
| `node build/gerra_e2e.js` | flags → `convState` → emitted directive, before/after |
| `node build/op_verify.js <old> <new>` | `_onPremise` detector, 25 cases |
| `node build/op_differential.js <old> <new>` | `_onPremise` fuzz, 2,592 notes |

To stage a prior build: `mkdir -p build/orig/dev && unzip -j <previous>.zip popup.js -d build/orig/dev`.

Fixtures must use the **real VinSolutions note shape**. Note `innerText` is multi-line with
routing headers (`Received from:` / `Received by:` / body), and the transcript entry is that
content *after* `sanitize()` collapses the newlines. A fixture like `[CUSTOMER] STOP` tests
a shape the page never produces.

`leadpro.test.js` currently reports **106/125**. The 19 failures are stale expectations from
v8.07 asserting prompt wording that has since changed — they need per-test triage, not a
blanket fix, and are left failing rather than silenced.

`build/orig/` and `build/new/` are gitignored scratch directories used to hold prior builds
for differential runs.

## Not in the repo

Store credentials, the incentive KV data, and dealer API keys. The worker proxies model
calls; the extension talks only to it and to VinSolutions.
