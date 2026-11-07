# Lead Pro — Full System Audit (Phase 1, findings only)

Audited 11/3/2026 against the current sources:

- **Extension:** 9.7.849 (`builds/dev`, `builds/commercial`)
- **Proxy:** `worker/cloudflare-worker-v7.91.js`
- **Reporter:** `worker/leadpro-reporter-v1.24.js`
- **Data Tool:** `datatool/index.html`
- **Dashboard:** `dashboard/index.html`, v1.11
- **Feedback gatherer:** `tools/feedback-gatherer`

No code was changed.

**How findings were verified**
- Line numbers are in `builds/dev/popup.js` unless a file is named. Commercial carries the same code at an offset; parity is covered in H-list item 8.
- "Verified" means the code path was read end to end and, where noted, executed in the test sandbox against the shipped file.
- **INFERRED** marks anything not proven by execution or live data.
- Customer and staff names are left out. One live license key was found in shipped code (C-1); its value is not repeated here.

---

## Summary

| ID | Sev | Component | One line |
|---|---|---|---|
| C-1 | High | Extension (`auth.js`) | A real agent license key sits in a comment that ships in every zip |
| B-1 | High | Scraper | Bereavement rule 3 fires on "she passed the credit check" / "my son passed his road test" and forces an exit |
| B-2 | High | Extension + proxy | The three fact probes are awaited on every generation (+0.9–1.9 s, ~40% of proxy calls) and changed 0 directives |
| B-3 | High (INFERRED) | Proxy | License enforcement depends on `REQUIRE_LICENSE`, which can't be read from source; the client fails open |
| M-1 | Med | Prompt | An unread lead age becomes 0 → "LEAD AGE: submitted today" plus the fresh-lead guard |
| M-2 | Med | classifyScenario | The prose "sold" regex scans the whole transcript, prior leads included, and doesn't check which vehicle; 6+ detectors decide availability |
| M-3 | Med | Prompt helpers | 14 helpers read `leadContext` on the panel but raw `history` on refine/render: one fact, two texts |
| M-4 | Med | Reporter | Recovered tier failures count as failures; latency and request totals mix contracts; a static "observer only" line is false |
| M-5 | Med | Data Tool | Date ranges return the **start** date as the expiry; month-day dates with no year never roll over |
| M-6 | Med | Packaging | `popup.js` is 4.4 MB, ~62% comments; 1.4–1.5 MB of build headers ship with customer and staff names |
| M-7 | Med | Extension | Customer phone and email, and the full Director key, go to the console; logs get shared |
| M-8 | Med | `content.js` | A 1,400-line scrape runs in every VinSolutions frame; only its `lp_lastActiveLead` beacon is used |
| M-9 | Med | Cache | ~12k chars of unconditional static user-prompt text sits in the uncached message; one fleet-wide cache key |
| M-10 | Med | Feedback/dashboard | The pairs export drops `workerRequestId`; the dashboard join needs `perf.agent` |
| L-1…L-11 | Low | various | Consolidation, dead switches, stranded log, unknowable assertions, minor gaps |

---

## Critical / High

### C-1 — A live license key ships inside `auth.js`
- **Severity:** High
- **Component:** Extension packaging. Both builds' `auth.js`, header lines 1–2 (the v9.7.466/467 and v9.7.471/472 notes).
- **Evidence:** Both header comments quote a real agent's license key in full, with the agent's name. `auth.js` is loaded by `popup.html` and zipped into every build.
- **Impact:** Anyone holding any build's zip can read a working key. If `REQUIRE_LICENSE` is on, that key buys generation calls billed to us; if it's off, see B-3. The key is also in git history.
- **Fix:**
  1. Revoke the key in KV and issue that agent a new one. This is a dashboard/KV action, not code.
  2. M-6's comment strip at packaging also removes it from future zips.
  3. Per your rule, leave history alone.
- **Regression risk:** None for code. The agent re-enters a new key once.
- **Verify:** `unzip -p leadpro_*_v9_7_NNN.zip auth.js | grep -c 'LP-[A-Z0-9]\{8\}'` returns 0.

### B-1 — Bereavement rule 3 over-matches, scans agent notes, and forces an exit
- **Severity:** High
- **Component:** Scraper (`inlineScraper`)
  - `popup.js:16060`: rule 3 `subject + died/passed`
  - `:15611`: scan scope
  - `:16201`: un-gated join into `hasExitSignal`
- **Evidence:** I executed the shipped rule-3 regex. It fires on:
  - "my daughter passed her driving test so she needs a car"
  - "she passed the credit check"
  - "he passed the inspection"
  - "my son just passed his road test"
  - "he passed it along" (the lookahead only checks the *next* word)

  It doesn't fire on "the car died" or "he passed on the offer", which are the cases it was written against. The scan text is `recentInbound + recentTranscript`, and `recentTranscript` is the first 5 transcript lines **of any author**. An agent note like "customer passed the credit check, she passed the appraisal" qualifies.
- **Impact:** A false fire writes condolences and offers to close the file: the most irreversible directive in the system. Credit-check and road-test wording is ordinary in this business.
- **Fix (per philosophy, smallest):**
  - Rule 3 keeps relationship nouns only (drop bare `he|she`).
  - Accept only `died` or `passed away`, plus `passed` followed by end of sentence or a time word ("passed last week").
  - Scan `[CUSTOMER]` lines only.

  Rule 1 (`passed away / deceased / funeral / obituary`) and rule 2 (`lost my <relative>`) carry real notices.

  The better long-term shape is to stop asserting an exit at all. A death notice is in the thread; the model reads it if the prompt says "if the thread contains a death notice, write only condolences."
- **Regression risk:** The original incident (a reply to a birthday email, "Sorry to inform…") was caught by rule 1 or 2 vocabulary. Keep it as a fixture.
- **Verify:** A harness running the shipped `_brvRules` over:
  - the five false-fire strings above (expect no fire);
  - "my husband passed away last month", "my mother passed last week", "funeral is Saturday" (expect fire);
  - one agent-note line (expect no fire).

### B-2 — Two readers decide each of three facts, and the second one costs a second per generation
- **Severity:** High (performance and consolidation)
- **Component:** Extension
  - `popup.js:32775–32792`: `await _lpPrepareFactVerdicts(...)`
  - `:2559–2604`: the three `*_COMPREHENSION` and three `*_AUTHORITATIVE` switches, all `true`
- **Evidence:**
  - Every generation awaits three probe calls (verbal-commit, day-lock, off-franchise) before `buildUserPrompt`.
  - Logged "all probes settled" times across log380–log389: 892, 997, 1,047, 1,047, 1,086, 1,444, 1,470, 1,876 ms. It's 1 ms only when the customer has written nothing.
  - The 11/2 report's comprehension table: 430 rows, agreement 100%, **Changed: 0** for every detector (`changedDirective`, reporter:1254).
  - The 11/2 morning had 2,605 proxy requests for ~300 drafts. The proxy's own comment puts fact probes at "~40% of calls".
- **Impact:** About a second of agent wait on most follow-ups. A third of proxy volume pays for a reader that agrees with the regex every time. It's also the "two independent signals that must both stay correct" shape you want gone.
- **Fix, in two steps:**
  1. **Now, behavior-neutral:** stop awaiting. Fire the probes in parallel with the main generation and keep them as observers, with the regex verdict deciding as it already does on every day measured.
  2. **After a week of data:** pick one source. Per philosophy, drop the regex directives and let the main model read the transcript, keeping the probe only if a disagreement ever shows up.
- **Regression risk:** Step 1 changes nothing customer-visible while Changed stays 0.
- **Verify:**
  - `[LP FACT DIAG] all probes settled` appears *after* `API response` in the log.
  - Generation latency drops by the probe time.
  - Reporter rows still arrive.

### B-3 — License enforcement can't be confirmed, and the client fails open (INFERRED)
- **Severity:** High if `REQUIRE_LICENSE` is off
- **Component:**
  - Proxy: `cloudflare-worker-v7.91.js:2373`, and the matching checks on `/generate` and `/appointment-invite`
  - Extension: `auth.js:170–210`
- **Evidence:**
  - Without `REQUIRE_LICENSE='true'`, the proxy only logs "no licenseKey … (REQUIRE_LICENSE off — fleet-readiness signal)".
  - `auth.js` returns `valid:true` ("Dev Mode") on a 404/501 from validation or on any network error.
  - The proxy URL is in `config.js`, and CORS is `*`.
  - Environment variables can't be read from source or from the Cloudflare tool here.
- **Impact if off:** Anyone with the URL can make paid model calls with no key, from any website.
- **Fix:** Check Cloudflare → Workers → leadpro-proxy → Settings → Variables. If it's off, turn it on; every build since 9.7.379 sends the key. Optionally stop the client fail-open on network errors (show "can't reach license server" instead).
- **Regression risk:** An agent on a pre-379 build would be locked out. The dashboard's builds column shows who's on what.
- **Verify:** A `/generate` POST with no key returns 403.

---

## Medium

### M-1 — An unread lead age is stated as "submitted today"
- **Component:** Payload `popup.js:32983` (`leadAgeDays: lastScrapedData.leadAgeDays || 0`) and prompt `:28934–28935`.
- **Evidence:** The frames log `[LP AGE DIAG] leadAgeDays NOT scraped … treating age as UNKNOWN, not 0`, but the payload collapses unknown to 0. The prompt then prints `LEAD AGE: submitted today`, and the fresh-lead guard (`ageDays: 0`) zeroes the staleness signals. The cadence calendar treats 0 as "lead age unknown" (`:4183`), so the same 0 means "today" in one place and "unknown" in another.
- **Impact:** On a lead whose Created date and PageData both fail, an old lead is written to as a fresh inquiry. Frequency is INFERRED; PageData usually recovers it.
- **Fix:**
  - Carry `null` for unknown and print nothing (or "lead age not available") in that case.
  - Downstream consumers that switch on: the LEAD AGE line, the fresh-lead guard, the stalled rungs (`_lpStalledCalendarRung` already returns 1 for unknown), and `_lpCloseOutEligible` (already "not eligible" for unknown).
- **Regression risk:** Code doing arithmetic on `data.leadAgeDays` must handle `null`. Grep shows `parseFloat` / `|| 0` on most reads; each needs listing in the build.
- **Verify:** The panel payload with `leadAgeDays` unset never contains "submitted today".

### M-2 — "Sold" is decided by a whole-transcript prose regex, among 6+ availability detectors
- **Component:** `classifyScenario` `popup.js:22946–22951`.
- **Evidence:** `vehicleSold` is true when the transcript contains any of:
  - `no longer available`
  - `sorry.*(vehicle|car|it).*sold`
  - `unfortunately.*sold`
  - `vehicle sold`
  - and similar

  The scope is the transcript fence: the whole thread, **prior leads below the marker included**. Nothing checks which vehicle the sentence is about.

  Separately decided availability facts:
  - `inventoryWarning` (regex and PageData)
  - `inventoryWarningFromNotes`
  - `vehiclePendingSale`
  - `isInTransit`
  - `_lpInvConfirmedAvailable` (feed)
  - `_lpRepNotOnLot`
  - our own claims (`selfClaims` sold/available/unavailable)
  - `isSoldDelivered`
- **Mitigation already in place:** a feed-confirmed unit can't be "sold". So the false-sold risk is limited to units not in the feed: used units just added, other stores, no stock number.
- **Fix (one source of truth):**
  - Availability = the live feed (`_lpInvConfirmedAvailable` + PageData status), which is ground truth.
  - What *we told them* = `selfClaims`, our own sends on this lead only, which already exist.
  - Drop the prose regex. Agent notes about a deposit or a sale are in the transcript for the model to read.
- **Regression risk:** A unit not in the feed that an agent texted "sold" stays covered by `selfClaims` → "WE SAID IT SOLD".
- **Verify:** Fixtures:
  - a prior-lead "that car has sold" below the marker → not sold;
  - "the 4:00 slot is no longer available" → not sold;
  - our own current-lead "that one has sold" → the WE SAID IT SOLD line.

### M-3 — The same helper reads two different texts depending on the stage
- **Component:** `_lpPromptInputData` (`popup.js:32817`) carries `context: leadContext` but not `history`. These 14 helpers read `d.history || d.context`:
  - `_lpThreadEntries`, `_lpOurEntries`, `_lpCustEntries`
  - `_lpLastCall`, `_lpStopIsCurrent`, `_lpPitchOut`, `_lpReactivated`, `_lpNewestNote`
  - `_lpOtdAsk`, `_lpCallWants`, `_lpApprovalFirst`, `_lpLeadHasContact`, `_lpCustomerStateHold`
  - `_lpMmSuggestedVoi` (history only)
- **Evidence:**
  - On the panel they parse `leadContext`: the AGENT CONTEXT header (which re-quotes call notes, as seen in the 11/2 Toyota dump) plus the transcript fence plus the extras.
  - On the text rewrite and render checks (`lastScrapedData`) they parse the raw `history`.
  - `tests/payload-808.test.js:31–34` lists `history` as an intended fallback.
- **Impact:** A verdict can differ between the prompt and the guard on the same draft. The duplicated call notes in the header are double-counted by entry walkers. `_lpMmSuggestedVoi` gets `''` on the panel (no fallback). Customer-visible impact is INFERRED.
- **Fix:** Add `history: lastScrapedData.history` to the payload. Every helper above then switches to the raw transcript on the panel, the same text the guards use.
- **Regression risk:** Helpers that today only "work" because the header repeats a note would lose that. Each needs a fixture run (the payload-808/809 harnesses exist).
- **Verify:** Run every 8xx suite with the payload carrying `history`. Diff the prompt for the 11/2 dumps before and after.

### M-4 — Reporter metrics that can mislead
- **Component:** `worker/leadpro-reporter-v1.24.js`
  - `:340–345` (`failReqs` = any request with a failed tier)
  - `:411–412` (Completion and Regen Rate)
  - `:826` (Total Requests)
  - `:813` (static footnote)
- **Evidence:**
  1. A request whose primary failed but whose fallback or emergency **succeeded** counts in "Failures (N)" and against "Completion Rate". On 11/2, "Failures (2)" were both recovered, yet the "By reason" line counts tier events (3). Units are mixed. No count of requests that actually served the canned safe fallback exists.
  2. "Total Requests", "Median latency 147 ms" and the hourly counts mix drafts, rewrites, fact probes, translations and edge hits. The 147 ms median is fact probes and edge cache, not drafts; the primary median is 1,959 ms.
  3. "Regen Rate" is the proxy's own classifier regen, not agent regenerates. Same word, different thing from the feedback section.
  4. The comprehension footnote "Observer only — no comprehension verdict has ever changed a customer-facing message" is static text (`:813`) while the AUTHORITATIVE switches are on. Only the computed "Changed" column (`:1254`) is evidence.
- **Fix:**
  - Split "Recovered" (a later tier succeeded) from "Served safe fallback" (all tiers failed).
  - Report latency and counts per contract, full drafts first (`fullDraft` is already on perf rows).
  - Rename to "Classifier regen".
  - Compute the footnote from `changedDirective`.
- **Regression risk:** Report-only.
- **Verify:** Re-render the 11/2 day. 2 recovered, 0 served safe fallback; draft median ≈ 2 s.

### M-5 — Data Tool expiry: ranges and year rollover
- **Component:** `datatool/index.html:406–432` (`ipDetectExpiration`).
- **Evidence (executed):**

  | Input | Result |
  |---|---|
  | "Offer valid 10/1/2026 - 11/2/2026" | `2026-10-01` (start date) |
  | "Valid Oct 1 through Nov 30, 2026" | `2026-10-01` |
  | "Expires Jan 4", read in 2026 | `2026-01-04` (already past) |
  | "Offers through 1/4/2027" | `2027-01-04` (correct) |

- **Impact:** Expiry is the kill switch. An offer with a date range is either dropped as expired or published to the wrong date. December pages listing January end dates are mis-yeared.
- **Fix:**
  - Prefer a date after `through|thru|ends?|expires?|until|to|-`.
  - Otherwise take the **latest** date found.
  - A month-day with no year that is earlier than "now − 60 days" rolls to next year.
- **Regression risk:** The comments record real past fabrication bugs ("APR 24-60", "APR 72"). Keep those as fixtures.
- **Verify:** A table test with the five strings above plus the two historic ones.

### M-6 — The shipped `popup.js` is mostly history, with names in it
- **Component:** Packaging.
- **Evidence:**
  - Dev `popup.js`: 4,379,369 bytes; 2,731,349 of them in `//` comment lines. 476 build-header lines (1.51 MB).
  - Commercial: 4,279,665 bytes, 372 header lines (1.36 MB).
  - Headers name live customers (e.g. the 546/547 and 631 notes) and staff.
- **Impact:** Every agent install carries customer names. The side panel parses 4.4 MB on every open.
- **Fix:** A packaging step that writes a comment-stripped copy into the zip only. Source and repo history stay as they are. Keep only the first header line as the build's identity.
- **Regression risk:**
  - Tests that read headers or comments run against source, not the zip. Unaffected.
  - The stripper must not touch strings or regex literals; a line-start `//` filter only is safe for this codebase's style.
  - `node --check` the stripped file, and run one suite against it.
- **Verify:** The zipped `popup.js` is under 1.8 MB, passes `node --check`, and a grep of the zipped files for the PII scan's name list returns nothing.

### M-7 — Contact details and the Director key in the console
- **Component:**
  - `popup.js:34258` (`[LP RAW DIAG] phone value:` full number)
  - `:10775` (`[LP EMAIL DIAG]` full email)
  - the `[LP PHONE DIAG]` `contextSample` (transcript text)
  - `auth.js:543` (`directorKey.substring(0,12)`; keys are 11 characters, so the whole key)
- **Impact:** The logs you share carry customer contacts and, during provisioning, the Director key.
- **Fix:** Mask as `[LP PROMPT CUSTOMER PHONE]` already does (`***-0200`), mask the email (`d***@domain`), and log only the last 3 key characters.
- **Regression risk:** None.
- **Verify:** Grep a fresh log for 10-digit numbers or `@`.

### M-8 — `content.js` scrapes every frame for a beacon
- **Component:** `builds/*/content.js` (1,408 lines).
- **Evidence:**
  - The popup never sends `LEADPRO_SCRAPE_NOW` or `LEADPRO_FORCE_RESCRAPE_IDENTITY`; there's no `tabs.sendMessage` anywhere. Only `lp_lastActiveLead` is read (`popup.js:11587`).
  - `content.js` still runs its full scrape (ECCS scrape, buying signals, identity re-extraction timers) in every VinSolutions and Cox frame (`all_frames: true`), plus 17 console logs into the CRM page.
- **Impact:** CPU on the agent's CRM tab and console noise, for nothing but the beacon.
- **Fix:** Reduce `content.js` to the beacon. It needs lead ID, dealer, lead source (service-source gate), visibility and scraper version.
- **Regression risk:** The beacon's inputs (`isLeadFrame`, `autoLeadId` extraction) must be kept byte-identical. Lift them, don't rewrite.
- **Verify:**
  - `[Lead Pro] Pre-scrape winner … storage beacon` still appears on a grab.
  - The beacon carries `scraperVersion`.
  - The popup's version check still passes.

### M-9 — Cache: static text below the breakpoint, and one key for the fleet
- **Component:**
  - Extension: system prompt `popup.js:23447–23760`; sentinel at `:23724`
  - Proxy: `cloudflare-worker-v7.91.js:3792–3840` (breakpoint) and `:4714` (`promptCacheKey`)
- **Evidence:**
  - **System prompt (measured in the sandbox):** 35,365 chars; cached head 33,424; uncached tail 1,920 (persona and identity). The system prompt is not where the waste is.
  - **User message (measured across 6 real dumps, 6 different leads):** 68 lines totalling **12,007 chars** are byte-identical in all six, scattered from the top of the prompt to the bottom. Examples: "8. HONOR THE CUSTOMER'S STATED POSITION", the 1–8 reasoning steps, "CLOSED DAYS ARE NEVER OFFERED", "TIME-OFFER VARIETY", "⚠ CUSTOMER NAME SOURCE", the vehicle-status signal list, "CRITICAL JSON RULES". The user message is never cached, so these are paid for in full every call. Your ~19.7k figure is likely the same measure over fewer leads (lines common to 2 dumps rather than 6).
  - **Cache key:** `promptCacheKey` hashes the first 200 chars of the system prompt, so all full drafts share one key.
  - **Hourly load (11/2 report):** 08:xx 561 req, 40% cache; **09:xx 1,343 req (~22/min), 33% cache**; 10:xx 481 req, 39%. The worst hour is the busiest. That fits an overflowing key, but it's INFERRED: those counts include fact probes, which use a different system prompt and key.
- **Fix:**
  1. Move unconditional static blocks from the user message to the system head, above the sentinel. Only blocks that never depend on the lead; position-sensitive closers ("Return ONLY the JSON…") need a test that output shape is unchanged.
  2. Before partitioning the key: log per request `cacheKey`, `fullDraft`, `cachedTokens/promptTokens` and the minute. The report then shows full-draft requests per key per minute against hit rate. Partition (e.g. by store) only if hit rate drops above ~15/min.
- **Regression risk:** Moving text can shift the model's attention; it needs a paired before/after batch on live traffic.
- **Verify:** `cachedTokens` per full draft rises by ~3k tokens; draft quality is unchanged in the paired batch.

### M-10 — The pairs export can't be joined to its generation
- **Component:**
  - `tools/feedback-gatherer/index.html:460–475` (export rows)
  - Proxy `_agentBreakdown` (`cloudflare-worker-v7.91.js:1840–1872`)
- **Evidence:**
  - The gatherer's export keeps id, ts, rating, regens, chips, store, `meta.agent` (the lead's BD agent, not the person who pressed Generate), scenario, source, convState, IDs and drafts. It drops `workerRequestId`, `signal`, `trigger` and `extensionVersion`, though `/feedback/drafts` returns `workerRequestId` (`:2205`).
  - Any join from an exported pair to its proxy row must fall back to lead ID + time. That's ambiguous whenever a lead has more than one generation (every regenerated or chipped lead), which is exactly the pairs population.
  - The dashboard's join (`joined`) needs a perf row whose `agent` was resolved from the license key in that request; rows without a key credit nothing.
- **Fix:**
  - Carry `workerRequestId`, `signal`, `trigger` and `extensionVersion` through the export.
  - Join on `workerRequestId` alone.
  - Report the unmatched rows by reason: no ID on the row, no perf row (14-day TTL), or perf row without agent.
- **Regression risk:** Export shape gains fields; nothing reads it programmatically except you.
- **Verify:** Re-export 11/2. Every row from 9.7.564+ carries a request ID, and the join rate is measured, not inferred.
- **INFERRED:** I couldn't reproduce your "~3%" figure without the join you ran. The missing `workerRequestId` is the cause I could verify.

---

## Low

**L-1 — CRM entry parsing exists in six forms.**
- Two walkers:
  - `_lpWalkCrmEntries` (`:1754`, 11 callers): text and date only, no tag, no time, no marker.
  - `_lpThreadEntries` (`:4496`, 16 callers): tag, title, body, time; current lead only.
- Four inline splitters (`:4456`, `:5544`, `:31521`, and the scraper's own array), each with its own date parsing.
- Measured: one prompt build calls `_lpThreadEntries` 35 times on the same text. populateFromData plus buildUserPrompt total ~95 ms for a 60-entry thread, so this is consolidation, not a speed problem.
- **Fix:** One `_lpEntries(text)` returning `{date, t, tag, title, body, raw, current}`, memoized per text, with the others as thin filters over it.
- **Verify:** Every 8xx suite passes with the old functions re-pointed.

**L-2 — `[LP INVITE CANARY]` is stranded in the page console.** It's in `_lpInviteScrapeAppts` (`:36299`), which is injected into frames. It should be returned in the result and logged popup-side.

All other injected functions are clean:
- `inlineScraper` (`:12028–19926`) has **zero** `console.*` calls; everything goes through `_lpD`.
- The stability and DOM-verify `console.log`s are popup-side.

**L-3 — Switches that never change, and dead code.**
- `LEADPRO_DELIVERY_MATCH = false` (`:3614`): an off observer.
- `LEADPRO_CADENCE_AUTO = false` (`:4035`): observes and logs on every generation.
- The dead `toggleFlag('distance', true)` (`:11032`; the v9.7.547 note says it can't fire).
- `LEADPRO_API_KEY = ''` in `config.js`.
- `ARC_SPINE`, `ARC_STATE` and the six COMPREHENSION/AUTHORITATIVE switches are permanently `true`.
- Recommendation: remove the off observers; turn the always-on switches into plain code once B-2 is decided.

**L-4 — An SMS opt-out other than a bare "STOP" still becomes a full exit.**
- `smsOptOutIsExit` (`:16017`) is false only for a bare carrier STOP; "please stop texting me" escalates to exit.
- Your ruling was "STOP is text-only". Decide whether "stop texting me" is also text-only (my read: yes) and whether only "stop contacting me / leave me alone" is an exit.

**L-5 — Prompt lines that assert what the model can't know.**
- `:23608`: "The customer has read every message you sent and chosen not to respond." Delivery and reading are unknown. Suggested: "has not replied to any of them".
- `:31049`: "Customer is driving 30-60+ minutes". Since 847 the tier is "outside the local ZIP list, under 75 miles".

**L-6 — `stalledTouches` counts automated messages.**
- `:31487–31491` counts every "Outbound Text Message" and "Email reply to prospect" on the current lead, including the assistant's welcome and opt-in texts.
- It **does** have a calendar cap since v9.7.702 (`_rgFinal = min(countRung, calendarRung)`, `:31500`), so its worst effect, close-out talk on a young lead, is already bounded.
- No threshold change recommended without data.

**L-7 — Merge fields with no gate.**
- In PASS 2, customer-level frames may fill `leadSource`, `pdVoiList`, `customerStatedColor`, `voiEngine`/`voiTransmission`/`voiDrivetrain` and `vrMonthlyPayment` when PASS 1 left them empty (the gate lists are at `:20825–20847`).
- Separately, a sibling lead's rims2 frame whose own lead-ID read failed looks "customer-level", passes the **customer**-ID check, and is trusted for vehicle fields.
- INFERRED: no live incident seen, and `[LP VOI DIAG][conflict]` would flag a second model family.
- **Fix:** Require a lead ID on any frame donating vehicle or lead fields, and add `leadSource` to the identity gate.

**L-8 — Packaging leftovers.**
- The `tabs` permission is likely unnecessary: host permissions already expose VinSolutions and Cox tab URLs, and the code only reads those.
- `icon48.png` is shipped but unused.
- Admin-only `innerHTML` with unescaped typed values: `auth.js:570`, `dealer-setup.js:242+`.

**L-9 — gpt-4.1-mini dependency.** It is both the emergency tier and the classifier (`:1501`, `:1553`). It retires Jan 14, 2027. Already on the Dec 1 reminder.

**L-10 — Proxy KV reads are one get per key.**
- `/feedback/*`, `/perf`, `/agents` and `/degenerate` list a prefix, then `get` every key (parallel per page, `:1786–1825`).
- At ~5k perf rows a day, that's thousands of KV operations per dashboard call. Finished days are cached (`rangeday:` / `agentsday:`), which limits it.
- **Fix:** Write the few fields the dashboard needs as KV **metadata** at put time; `list` returns metadata with no gets.
- INFERRED: the per-invocation operation limit risk on large ranges.

**L-11 — Data Tool `parseVehicle` takes the first word as make.** "Land Rover", "Alfa Romeo" and "Aston Martin" split wrong. It only matters for off-brand used units.

---

## Performance: the 12-second timeout

- **Where it is:** The 12,000 ms ceiling is the proxy's **primary-tier** timeout (`cloudflare-worker-v7.91.js:1498`, gpt-6-luna; total budget 24,000, fallback 8,000, emergency gets the remainder). The extension's own timeouts are 90 s for drafts and 25 s for the rewrite.
- **How often** (reports read: 10/9, 10/12, 10/14, 10/19, 10/26–10/30, 11/2):
  - Primary timeouts at exactly 12,000 ms: 10/19 (1), 10/26 (1), 10/27 (3). Not daily in this sample.
  - The **daily** failure is primary "degenerate" output at 2–4 s (1–7 per day), recovered by the fallback.
  - The fallback timed out at 8,000 ms behind a degenerate primary on 10/9, 10/19, 10/26 and 11/2. The emergency tier then still had 13 s.
- **Where the time goes:** Not measurable from source. Perf rows already record `userChars`, `effort`, `tier`, `latency` and `fullDraft`.
- **Next step (no code):** Pull `/perf` and `/degenerate` for 10/19, 10/26 and 10/27 and read the timed-out request IDs. Check whether they're escalated regens, very long prompts (log384-class 85k user prompts), or one hour.
- **Budget math, checked:**
  - Normal path: 12,000 + 8,000 leaves 4,000 → emergency runs at 3,700 ms.
  - Escalated regen: 18,000 leaves ~5,700 → the fallback gets 5,700 and the emergency tier can't be admitted. That's a known trade-off, written in the code at `:2924–2936`.
- **Per-grab time:** no end-to-end grab timing is logged. Recommend one popup-side line `[LP GRAB TIMING]` with phase splits (pre-scrape, frame poll, email expand, key-info wait, merge, probes, API, rewrite). The key-info wait walks `querySelectorAll('*')` per 150 ms poll for up to 2 s in dashboard frames (`:20064–20076`).

---

## Checked and healthy (no need to re-audit)

1. **Current-lead marker slices:** all 12 `indexOf('=== CURRENT LEAD SUBMITTED HERE ===')` sites, plus the 5 loop scans, take the current lead from the newest-first side (`slice(0, mk)`, or break on the marker). None is inverted. Prior-lead slices (`slice(mk)`, `:4451`) are deliberate.
2. **Direct payload reads:** of 84 `data.*` reads in `buildUserPrompt`, only `agentPhone` and `isDistanceBuyer` are absent from the payload, both documented dead and allowed in `payload-808`.
3. **Frame-side diagnostics:** zero `console.*` in `inlineScraper`; all relay through `_lpD`. The one stranded log is L-2.
4. **Control and invisible characters:** none in any shipped extension file, the proxy, the reporter, the Data Tool or the dashboard (C0, DEL, zero-width, bidi, BOM, soft hyphen, U+FFFD).
5. **Dev ↔ Commercial parity:** `auth.js`, `content.js`, `config.js`, `dealer-config.js`, `dealer-setup.js` and `background.js` are identical apart from header comments. `popup.html` differs only by the DEV badge. `popup.js` code differs only by the intended Dev diagnostics (stability poll, DOM-verify, the "DEV build distinguisher" log) plus one log string.
6. **Proxy model parameters:** effort is resolved per tier (none sent to non-reasoning tiers). `prompt_cache_options.ttl='30m'` goes only to breakpoint tiers; the legacy `prompt_cache_retention` goes to gpt-4.1-mini, per the v7.64 fix. A non-string system message makes the breakpoint path warn rather than fail silently.
7. **Proxy KV reads are batched:** `Promise.all` per list page, not sequential.
8. **Provisioning is checked server-side:** only a Director key can mint licenses (`:2000`).
9. **Shipped code:** no `eval` or `new Function`; no remote scripts in `popup.html`; Manifest V3; no `web_accessible_resources`.
10. **`stalledTouches` has a calendar cap** (v9.7.702).
11. **Escaping:** history and copy paths escape customer text before `innerHTML`.

---

## Prioritized build plan (safe batches)

**Batch 0: no code, today**
- Revoke and reissue the key in C-1.
- Check `REQUIRE_LICENSE` (B-3).
- Pull `/perf` and `/degenerate` for 10/19, 10/26 and 10/27 (12-second timeouts).

**Batch 1: extension 850, customer-safety and privacy, small diffs**
- B-1: bereavement rule 3, customer lines only.
- M-7: mask console contact details and keys.
- L-2: relay the invite canary.
- L-5: the two assertion wordings.
- Packaging: the M-6 comment strip and the C-1 removal from zips.
- Each with a harness from real captured text. Proxy unchanged, so safe in any deploy order.

**Batch 2: extension 851, latency**
- B-2 step 1: the probes stop blocking (observer, parallel).
- `[LP GRAB TIMING]` diagnostic.
- Behavior-neutral by construction. Verify against the reporter's "Changed" column for a week.

**Batch 3: reporter v1.25 + gatherer + dashboard, measurement**
- M-4: recovered vs served-fallback, per-contract latency, computed footnote.
- M-10: export carries `workerRequestId` / `signal` / `trigger` / `extensionVersion`.
- M-9 step 2: per-key, per-minute instrumentation, reading fields perf rows already have.
- Report-side only. Safe in either deploy order.

**Batch 4: Data Tool**
- M-5: expiry ranges and year rollover, with a fixture table including the historic APR cases.

**Batch 5: extension 852–853, one source of truth (needs your approval per item)**
- M-2: availability from the feed plus our own claims; prose regex retired.
- M-1: lead age `null` when unknown.
- M-3: payload carries `history`.
- B-2 step 2: drop the regex or the probe for each fact.
- L-4: opt-out wording decision.

Each item gets a before/after prompt diff on the 11/2 dumps and the 8xx suites.

**Batch 6: consolidation, after 5 settles**
- L-1: one entry walker, memoized.
- M-8: `content.js` reduced to the beacon.
- L-3: dead switches out.
- M-9 step 1: static prompt blocks move above the cache breakpoint, with a paired live batch.
- L-7: lead-ID gate on donor frames.
- L-8: permissions and leftovers.

**Batch 7: proxy, independent**
- L-10: KV metadata.
- L-9: the gpt-4.1-mini replacement before Jan 14, 2027.
