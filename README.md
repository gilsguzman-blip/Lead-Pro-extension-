# Lead Pro

AI-powered BDC response tool for Community Auto Group. Chrome MV3 extension (side panel)
that reads a VinSolutions lead and drafts SMS / email / voicemail.

## Layout

```
build/dev/           DEV extension source        — v9.7.536-dev
build/commercial/    COMMERCIAL extension source — v9.7.534
build/*.js           verification harnesses (see below)
worker/worker.js     Cloudflare Worker source    — v7.48 (deployed: v7.47)
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
2. Write the changelog entry as the new top line of both `popup.js` files.
3. Bump and package:

```sh
node build/package.js --dev 9.7.537 --comm 9.7.535
node build/package.js              # no bump: re-check and repackage the current pair
node build/package.js --no-zip     # check only, write nothing
```

`package.js` sets `manifest.version` and `version_name`, then refuses to package unless
every convention holds. It exists because these were prose, and prose got violated three
times with real consequences — each is now a hard failure:

| guard | the incident it prevents |
|---|---|
| version already in the changelog | v9.7.535 forked from a superseded v9.7.534 and shipped without that build's fix |
| `version_name` missing or mismatched | Chrome Web Store rejection |
| all 11 files present, 2 `.png` | a zip without icons was rejected |
| `node --check` both builds | broken syntax reaching a package |
| changelog header vs `manifest.version` | silent version drift between the two places |
| dev/commercial file sets match | one side shipping a file the other lacks |

All six are covered by a self-test that deliberately breaks each one and confirms it fails.

`dist/` holds only the current pair; `package.js` prunes superseded zips so there is exactly
one artifact per side. **Never reuse a version number for changed code** — that is what the
first guard is for. Repackaging is content-stable but not byte-stable: `zip` records mtimes,
so re-running produces a different blob with identical contents.

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
| `node build/worker_verify.js` | worker prefilter recall/precision + edge-cache key behaviour |

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

## The worker

`worker/worker.js` is the Cloudflare Worker (model proxy, prompt caching, phone-ask
classifier, edge cache). It deploys **separately** from the extension and is not packaged by
`package.js`. Its changelog is the header comment, same convention as `popup.js`.

Reading its logs: `POST /` is a generation and prints `START` → `PRIMARY OK` → `CLASSIFY` →
`FINAL`. `FINAL total` minus `PRIMARY total` is the phone-ask classifier's cost (~545 ms
measured). `[EDGE-CACHE] HIT/MISS/STORED` reports the edge cache, and `[PREFILTER] shadow`
reports the prefilter's would-be verdict without acting on it.

> **v7.48 is unreleased.** It carries the prefilter in shadow mode: it logs `wouldSkip` and
> `miss` but gates nothing. Turn the skip on only when real traffic shows `wouldSkip` is
> common **and** `miss` has stayed at zero. `miss=true` means a draft that genuinely asked for
> a phone number would have gone out unregenerated — the exact defect the classifier exists to
> prevent. Expect `wouldSkip` to be lower than the phrase list suggests: `numbers` is
> overloaded by ordinary price talk, which trips the filter on drafts that ask for nothing.

## Not in the repo

Store credentials, the incentive KV data, and dealer API keys. The worker proxies model
calls; the extension talks only to it and to VinSolutions.
