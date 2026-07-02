# Punch List Status — v9.7.364 audit fixes (applied 7/1/26)

Branch: `claude/lead-pro-audit-sczb7s`

## Environment note (read first)

This repo contained only the old v8.63-era `popup.js`; the v9.7.364 source was not
tracked here. The **COMMERCIAL v9.7.364** build (from the uploaded zip) is now
committed under `leadpro_COMMERCIAL_v9.7.364/` — first as a pristine baseline
commit, then with the fixes as reviewable diffs on top.

**The DEV v9.7.364 build was not available in this environment**, so it is NOT
patched. Since the two builds' `popup.js` differ by only one console.log line, apply
the exported patch files to the DEV tree:

```
cd <dev build dir>
git apply --directory=. -p2 patches/section1-items1-4.patch   # or apply hunks by hand
git apply --directory=. -p2 patches/section2-item5.patch
node --check popup.js
```

If `git apply` complains about paths, the hunks are small — search on the quoted
context lines and hand-apply; every hunk is also shown in the commit diffs.

## Section 1 — applied and verified ✅

| # | Fix | Commit | Verified |
|---|-----|--------|----------|
| 1 | Velocity-response crash (`agentFirst` ReferenceError in `populateFromData`) | "Section 1 punch-list fixes" | Harness: baseline throws `agentFirst is not defined` on a velocity lead; patched completes and renders the agent's first name in the directive |
| 2 | System-note opt-out scan dead (`data.phone` ReferenceError in `inlineScraper`) | same | Harness: constructed a System "Status has been changed to Opt-Out" note that only this scan can catch — baseline `isSmsOptOutOnly=false`, patched `=true`; clean lead stays `false`. Temporary `[LP OPTOUT DIAG]` log added — **remove after a few days** once you've seen how often it fires in production |
| 3 | `isLeaseMature` read ~80 lines before assignment (dead exclusion on `vehicleSold`) | same | Harness: `"Csc-Off Lease Financing-Tfs"` lead + "no longer available" transcript — baseline wrongly fires `vehicleSold`, patched suppresses it; a genuine `VEHICLE STATUS: SOLD` lead still fires; `isLeaseMature` value identical pre/post across 8 test sources |
| 4 | CarFax hard-rule contradiction (never-say-Carfax vs MUST-mention-CarFax) | same | Harness: patched CarFax first-touch prompt contains both the NAMED SOURCE block and the reconciliation NOTE; system prompt still carries the product-name rule |

`node --check popup.js` passes. Full harness: **20/20 checks pass**
(`node audit-tests/run-tests.js` — loads both builds in a stubbed-DOM vm,
reproduces each bug on the baseline, confirms each fix on the patch).

### What the harness could NOT verify
These are stubbed-DOM tests, not live VinSolutions. The punch list's "test after
applying" notes still apply as live smoke tests before shipping:
- Fix 1: grab a real <90-second-old lead, confirm Generate enables and drafts.
- Fix 2: find a lead with a real System opt-out note, confirm SMS suppression.

## Section 2 (item 5) — applied on branch, separate commit, NOT production-ready ⚠️

Commit: "Section 2 (item 5): gate PASS-2 history/boolean merge…" — deliberately its
own commit so it can be reverted/cherry-picked independently.

Logic verified by extracting the actual PASS-2 merge loop from both builds and
running it against synthetic frames: stale ID-less frame bleeds transcript/flags on
baseline, blocked on patch; AI-Buying-Signal path (no PASS-1 frame) and
customerId-verified frames merge unchanged; PASS-1 values never overwritten.

**Still required before merging to production** (per punch list): the 15–20
real-lead before/after batch (fresh, repeat-customer, multi-tab leads) comparing
`vehicle` / `leadSource` / `convState` / transcript population — the gate is
stricter than before and only live leads can prove nothing legitimate went empty.

## Section 3 (item 6) — RESOLVED: Option B applied (registry pipeline deleted) ✅

Gil's call: delete. The registry's classification (`s._registryScenario`) was never
read anywhere; `classifyScenario`'s regex chain was and remains the real classifier.

Removed (own commit, `patches/section3-item6-option-b.patch` for the DEV build):
- `lead-source-registry.js` and `onboarding.js` (files + their `<script>` tags)
- popup.js: the unused `s._registryScenario` assignment, `initRegistry` boot block,
  `window._leadProSourceRegistry` global, registry load inside
  `checkAndShowOnboarding` (its dealer-data refresh is kept, so boot behavior is
  unchanged), the Director "Push Registry to Worker" button, and the
  "Manage Lead Source Mappings" settings wiring
- popup.html: the onboarding overlay and the Lead Source Mappings settings section

Deliberately NOT removed:
- Director Export/Import Settings backup (generic full-storage backup — it shared an
  `if` block with the push button; the block's guard now keys on the export button)
- The Cloudflare worker's `/registry` GET/POST endpoints — server-side, out of scope
  for the extension. They become unused once this ships; retire them in a worker
  release whenever convenient. A stale `leadpro_source_registry` key may remain in
  agents' chrome.storage.sync — harmless (nothing reads it), can be left to rot.

Verified: full harness re-run post-deletion is 20/20, and the patched build now
boots in the harness *without* the deleted files (exercises the whole script load
path, `classifyScenario`, `populateFromData`, `buildUserPrompt`).
Live smoke test still recommended: open the extension, check the profile panel
renders (Export/Import intact, no mappings button), grab + generate one lead.

## Section 4 (item 7) — scheduled, not done 📋

content.js beacon-only reduction (~1,300 → ~40 lines). Confirmed inert code, zero
correctness cost today. Do as its own pass after Sections 1–2 have shipped and
settled. Not touched in this branch.

## Files added
- `leadpro_COMMERCIAL_v9.7.364/` — v9.7.364 source: pristine baseline commit + fix commits
- `patches/section1-items1-4.patch`, `patches/section2-item5.patch`,
  `patches/section3-item6-option-b.patch` — for the DEV build
- `audit-tests/stub-env.js`, `audit-tests/run-tests.js` — regression harness (`node audit-tests/run-tests.js`)
