# Lead Pro: Full Audit, Phase 1 (findings only, no code changed)

**Audited at:** extension v9.7.694 (`builds/dev` + `builds/commercial`), proxy `worker/cloudflare-worker-v7.76.js`, reporter v1.22, Data Tool `datatool/index.html`.
**Method:** I read the code paths themselves, not the comments or changelogs. I tested the regexes against realistic dealership phrasing in node. I checked prompt effects against **44 real full-prompt captures** (9/9 to 9/22: Honda Baytown, Honda Lafayette, Toyota Baytown and Kia Baytown). There were no Audi captures, so the Audi findings are from code only.
**Line numbers** are from `builds/commercial/popup.js` unless stated. Every finding below is present in **both** builds (I grep-verified each one). DEV line numbers are offset by roughly +300.
**Privacy:** the captures hold real customer data. This report quotes only prompt scaffolding and cites captures by file id (e.g. `a8dc2954`), never by customer name, email or phone.

**Severity legend:** **Critical** = can put a compliance violation or a false fact in front of a customer with no guard. **High** = puts a false fact or a contradicting directive in front of the model on real traffic. **Medium** = wrong-but-bounded behaviour, or measurable waste. **Low** = dead code, drift, diagnostics.

---

## 0. Pipeline map (as built)

| Stage | Where | Notes |
|---|---|---|
| Scrape | `inlineScraper()` L7905–14584, serialised via `chrome.scripting.executeScript({func: inlineScraper, allFrames})` | Only the function body travels. Diagnostics must go through `_lpD` (relayed in `_lpDiag`); a `console.*` call here prints in the CRM tab. |
| Frame selection / merge | `grabLead` L7480 → results sort, PASS 1 active-frame priority, rescue broad-merge ~L16100–16140 | Protected. Reviewed, not changed. See P5. |
| Context build | `populateFromData` L4764 (writes `vehicleExtras`, flags) → `lastScrapedData` | Most regex-derived "facts" become directive text here. |
| Scenario | `classifyScenario` L16818 | Called 4× (once per path), cheap. |
| System prompt | `buildSystemPrompt` L17728: static head, then `⟦LP_CACHE_BREAKPOINT⟧` (L17981), then persona/identity tail | Head is 22,703–22,733 chars and **identical across all captured leads and stores** (md5-verified), so caching is working. |
| User prompt | `buildUserPrompt` L18821–24459 | 44k–58k chars per capture. The cost is here: see M4. |
| Comprehension | `_lpPrepareFactVerdicts` (awaited, 3 parallel probes, 4.5 s cap) → `_lpApplyFactOverrides` | Kill switches at L1578–1580 / L1621–1623, all ON. |
| Worker | `/generate`: cascade Luna 12 s → 5.4-nano 8 s → 4.1-nano 5 s, `TOTAL_BUDGET_MS` 24 s, escalated primary 18 s | Protected. Reviewed, not changed. |
| Parse / guards | `generateAll` L25275+: JSON extract → opt-out SMS blank (L25834) → refine pass (L25985) → opener name prepend → `enforceSmsSig` / `enforceEmailPhone` → render | |

---

## 1. Findings: Critical

None outside protected logic. The one Critical-severity issue I found is inside protected logic (SMS opt-out), so under the audit rules it is in section 5 as **P1**. Read P1 first.

---

## 2. Findings: High

### H1. The "declined alternative" detector turns ordinary replies into a ban on alternatives
- **Where:** scraper `declinedPatterns` L12002–12075 → `populateFromData` L6752 (only consumer). Tests: `declined-alternative.test.js`, `decline-attribution.test.js`.
- **What's wrong:** these patterns match everyday customer phrasing. Each one below was run through the exact patterns and the `_daContrast` gate:

  | Customer wrote | Fired | Matched |
  |---|---|---|
  | "Not a problem, just let me know when it comes in" | p4 | `Not a problem, just` |
  | "not a big deal, just wanted to see the numbers" | p4 | `not a big deal, just` |
  | "Not the best time, just got off work. Can you call tomorrow?" | p4 | `Not the best time, just` |
  | "I only want to know the out the door price" | p2 | `only want to know the out the door price` |
  | "I am only looking to trade in if the numbers work" | p0 | `only looking to trade in if the numbers work` |
  | "I would prefer to text only" | p5 | `prefer to text only` |
  | "not a rush only whenever you get a chance" | p4 | `not a rush only` |

  The only other gate is "some outbound note exists before it", which is true on almost every follow-up.
- **Customer impact:** the prompt gets `❌ CUSTOMER DECLINED ALTERNATIVE: The customer stated: "Not a problem, just". They were offered an alternative and said no, so that topic is closed. Do NOT reference alternatives under any phrasing … Any sentence containing the declined vehicle name is a violation`. That is a regex-made fact written as a directive. It stops a legitimate pivot to comparable units (sold/in-transit VOI) on exactly the leads that need one.
- **Proposed fix:** remove the directive. If the signal is still wanted, pass the customer's matched sentence as an observation with no "do not" attached, or route it through the comprehension probe the way day-lock is. At minimum: drop p4 and p5, and require the capture to contain a model/vehicle token.
- **Downstream:** L6752 only; the two test files above need their fixtures updated.
- **Confidence:** verified (regexes executed; consumer traced).

### H2. The zero-contact block's examples ask the exact question PHASE 5 bans, and claim a unit is on the lot
- **Where:** `buildUserPrompt` L24169–24187 (`else if (isZeroContactStalled)`). It always co-renders with the PHASE block at L23780–23905 (same `isZeroContactStalled` condition).
- **What's wrong:** hard-coded Audi examples go to every store:
  ```
  GOOD: "Tammy, still have the A3 here if you're still looking — any specific questions before you come check it out?"
  Examples: "Is the A3 still on your radar?" …
  GOOD EMAIL CLOSE: "Is the Audi A3 still something you're exploring, or has your search taken a different direction?"
  ```
  In the same prompt, PHASE 5 says: *"DO NOT ask whether they are still interested -- in ANY wording. THE TEST IS NOT THE WORDS, IT IS THE QUESTION…"*. The GOOD examples are that question. "still have the A3 here" is also an availability claim with no stock number, which contradicts NON-NEGOTIABLES ("Never confirm a specific unit … is available without a stock number or VIN").
- **Evidence:** all 7 Kia Baytown captures from 9/22 (`2ad7534a`, `d2fcbabc`, `a85519c4`, `fee448b2`, `3efae0d7`, `98cdb576`, `a8dc2954`) carry both blocks. The one rejected draft recorded in `a8dc2954` is a still-interested variant ("what's the best way to handle your … inquiry from here").
- **Customer impact:** a Kia or Honda customer is primed with Audi-shaped copy. The model gets a "GOOD" template for the move it is banned from making, and a "still have it here" template for vehicles with no stock number.
- **Proposed fix:** delete the SMS/EMAIL example, GOOD and BAD lines (L24176–24186). Keep `FACT:` / `GOAL:`, or fold them into the PHASE block so zero-contact has one owner (see M5).
- **Downstream:** `stalled-phase.test.js`, `message-constraints.test.js`, census ownership.
- **Confidence:** verified.

### H3. The trade-conflation guard fires on our own outbound text and states a history that isn't there
- **Where:** `populateFromData` L5549–5616 (`_tvMentioned`, `_tvBase`).
- **What's wrong:**
  - The trigger scans the whole arc, including agent outbound: `_tvArc = conversationBrief + context + history` against `/\btrade[- ]?in\b|…|\byour trade\b|\bapprais/`. `\byour trade\b` is by construction our own wording.
  - The 1,590-char block that follows says, unconditionally: *"IF AN EARLIER NOTE OR MESSAGE IN THIS THREAD ALREADY MAKES THAT MISTAKE … earlier notes in this thread are known to contain it, they are WRONG"* and *"if they are asking for a trade number…"*.
- **Evidence:** capture `a8dc2954` (Kia, 0 inbound / 23 outbound). The only trade mention is our own 8/11 email ("One thing I can't really do justice to in a message is your trade…"). The guard fired anyway. The same prompt's HARD CONSTRAINTS say *"TRADE-IN: Only discuss a trade if the customer raised one … A prior agent's boilerplate … does NOT count — ignore it."* The model is told both "ignore trade" and, at CRITICAL volume, how to talk about their trade.
- **Customer impact:** trade gets primed on customers who never mentioned one, and a false statement about the record ("notes are known to contain it") sits in the context.
- **Proposed fix:** compute `_tvMentioned` from customer-authored text (`_lpCustomerText(d)`) plus agent call/general notes (a human wrote "looking to trade in" on `f234f599`, which is legitimate), not outbound message bodies. Emit the "earlier notes contain it" sentences only when the conflation is actually detected (VOI short name within ~6 words of "trade" in the arc).
- **Downstream:** `[LP TRADE CONFLATION GUARD]` log; `trade-attribution.test.js`.
- **Confidence:** verified (capture + code).

### H4. Internet Director voice examples don't match the mode, and one asserts unit availability
- **Where:** `buildUserPrompt` L21694–21745; persona data in `builds/*/auth.js` L111–113.
- **What's wrong:**
  - For `first_touch` and `active` modes only `_voiceExample` (SMS) is overridden. `_voiceExampleEmail` and `_voiceExampleVoicemail` stay the stall-recovery versions. A first-touch lead gets: *"I'm not going to pretend this is a regular follow-up. When someone goes quiet at this point, it's usually one of two things…"* as its voice template.
  - The `active` SMS example is *"Got it — yes, the Blueprint with graphite is here. The trade conversation usually goes faster in person but I can give you a real ballpark right now"*. That asserts a specific unit is present and offers a trade number, against the availability NON-NEGOTIABLE and OTD/PAYMENT DISCIPLINE.
  - The stall SMS example *"Most people who go quiet are either still comparing or something changed — which is it for you?"* contradicts the STALLED directive in the same prompt (*"Do NOT guess at their personal circumstances or motivations"*). It is also a copyable template: two-option "which is it" is the shape the regen history kept catching.
- **Customer impact:** tone for the wrong situation on first touch. On active leads, a template that claims a unit is here.
- **Proposed fix:** in non-stall modes set the email/voicemail examples to `''` (the render already skips empty ones). Rewrite or remove the active example so it asserts nothing about inventory or numbers. Label all examples "for tone only, not content" the way v9.7.694 did for velocity.
- **Downstream:** `audi-persona.test.js` / census entries for persona blocks.
- **Confidence:** verified in code. No first-touch Director capture on hand to show it rendered.

### H5. The call-note boilerplate filter never matches, so every "no answer" call is fed in twice
- **Where:** scraper L12291–12306.
- **What's wrong:**
  ```js
  var isBoilerplate = /^(left message|no answer|…)/i.test(content.trim()) || /^left\s/i.test(content.trim());
  ```
  `content` is the raw note body, and in this CRM it always begins `By: <agent>\n…`, so the anchored `^` test never sees "no answer". The `By:` strip happens on the next line, *after* the test.
- **Evidence:** boilerplate call notes are present in AGENT CONTEXT in 38 of 44 captures, and 11 of them in each 9/22 Kia capture (`By: … \n  no answer`, `Left message`). Those same calls are already in the transcript and the arc.
- **Customer impact:**
  - It inflates `sbCalls`/`sbTotal` (L18939–18942), which is the root cause of M1's wrong count.
  - It adds ~1–2.5k chars of zero-information text per stalled lead, uncached.
- **Proposed fix:** test `cleanContent` (post-`By:` strip) instead of `content`.
- **Downstream, and a routing caution:** `sbTotal` feeds the SITUATION thresholds (`sbTotal >= 5`, `sbHungUp && sbTotal >= 3`, L21622/21636). Fixing the filter lowers `sbTotal`, which **can change which closeOverride branch fires**. Phase 2 must either keep threshold behaviour identical (read the displayed count from `relationshipSignals.totalOutboundCount` as L21630 already does) or run the routing-equivalence harness and show you the deltas.
- **Confidence:** verified.

---

## 3. Findings: Medium

### M1. The zero-contact SITUATION line shows a double-counted number
- **Where:** L21639: `'📋 SITUATION: ' + sbTotal + ' outreach attempts over …'`.
- **What's wrong:** v9.7.593 fixed the hang-up branch to prefer `relationshipSignals.totalOutboundCount` (L21629–21630) but left this branch on `sbTotal`.
- **Evidence (`a8dc2954`):** one prompt states **31** outreach attempts (SITUATION), **23** outreaches (TOUCH POSITION), **0 inbound / 23 outbound** (RELATIONSHIP READING), and **9 message(s)** (PHASE 5, texts + emails only). That is four counts for one fact.
- **Fix:** reuse the `sbAttempts` expression. Leave PHASE 5's "message(s)" count (it is correctly labelled) or drop it.
- **Confidence:** verified.

### M2. `d.hasShowroomVisit` is never assigned, so the distance rule is never suppressed for customers who already came in
- **Where:** `populateFromData` L7160 and L7172 read `d.hasShowroomVisit`. It exists only as a local inside `classifyScenario` (L17422); the scraper return never carries it.
- **What's wrong:** `!d.hasShowroomVisit` is always true. The stated intent ("Suppress for showroom-followup (already came in)") never happens. The distance flag toggles, and the distance rule renders, for customers with a showroom visit.
- **Fix:** read `d.isShowroomFollowUp || d.showroomVisitToday` (both are returned).
- **Caution:** this changes `activeFlags` (the distance flag), so it is a routing change. It needs your sign-off and the equivalence harness.
- **Confidence:** verified (grep: 4 occurrences, zero assignments).

### M3. `scenarioRules` is rendered twice in every user prompt
- **Where:** L22289–22296 (under SCENARIO) and again at L22864 (inside HARD CONSTRAINTS). Both carry the `closeOverride` appended at L21649.
- **Evidence:** in `a8dc2954` the "Read the conversation and use judgment…" and "📋 SITUATION…" lines appear verbatim in both places.
- **Fix:** delete the L22864 copy. Both `CLOSE: Two specific appointment times` filters are inert since v9.7.694 removed that line, and can go too.
- **Confidence:** verified.

### M4. About 22.5k chars (~5.6k tokens) of fixed instruction text sits below the cache boundary on every call
- **Measurement:** lines over 40 chars that appear byte-identical in the user prompts of three different leads at three different stores (`a8dc2954` Kia, `176c864c` Honda Lafayette, `67173f32` Toyota) total **100 lines / 22,457 chars**. None of it depends on the lead, so it is fixed text sitting where nothing can be cached. The largest pieces:
  - `AGENT CONTEXT — READ THIS FIRST…` (1,259)
  - `- TRADE-IN: Only discuss…` (1,015)
  - `⚠ THE CUSTOMER'S OWN DAY WORDS AGE…` (874)
  - `OTD / PAYMENT DISCIPLINE…` (819)
  - `- LANGUAGE: ALL responses…` (732)
  - `- LOGISTICAL CONSTRAINTS…` (713)
  - `⚠ RELATIVE DATE AGING…` (644)
  - `- EMOTIONAL CALIBRATION…` (625)
  - `8. HONOR THE CUSTOMER'S STATED POSITION…` (585)
  - `CLOSED DAYS ARE NEVER OFFERED…` (571)
  - the whole YOUR TASK question list and the "READ INTERNAL AGENT NOTES" bullet list.
- **Size today:** system ≈ 25k chars (22.7k cached) and user ≈ 44–58k (uncached). Worker v7.76 gives the primary tier 12 s, and the recurring 12000 ms primary timeouts sit on these ~20k-token requests.
- **Fix:** move lead-independent blocks into `buildSystemPrompt` above `⟦LP_CACHE_BREAKPOINT⟧`, or into one static preamble block right after it.
- **Caution:** position changes can move output. This must be done under the paired before/after harness. Expected effect: ~5.6k fewer uncached input tokens per call and a lower primary-tier latency tail. The latency effect is inferred; the token count is measured.
- **Confidence:** measurement verified; latency benefit inferred.

### M5. Zero-contact stalled leads get seven overlapping directive blocks of differing strength
- **Evidence (`a8dc2954`, in prompt order):**
  1. `🚫 ZERO-CONTACT LEAD — APPOINTMENT ENGINE DISABLED`
  2. `🚫 ZERO CUSTOMER RESPONSE … HARD RULE`
  3. `📋 SITUATION: 31 outreach attempts…`
  4. `⚠ NO APPOINTMENT TIME (UNLESS THE ARC SHOWS OTHERWISE)`
  5. `VARY YOUR ANGLE` plus `ONE-SIDED CONVERSATION`
  6. `🔴 STALLED`
  7. `STALLED LEAD RE-ENGAGEMENT -- PHASE 5` plus `ZERO-CONTACT RE-ENGAGEMENT — READ THIS BEFORE WRITING ANYTHING` (H2)

  One of these is hedged ("UNLESS THE ARC SHOWS OTHERWISE") and the others are absolute. The goals differ too: "Get their first reply. Nothing else." vs PHASE 5's "concede gracefully and make it easy to say stop."
- **Why it matters:** this is the "stacked competing directives" pattern. The model picks one unpredictably, and regens collapse onto whichever one is loudest.
- **Fix:** one owner per question (census). Keep the PHASE block (the only one with cadence logic) and the facts section. Reduce the rest to facts, or delete them.
- **Confidence:** verified (capture).

### M6. FORMAT RULES contradict the LEAD section and render rules that don't apply
- **Signature:** L24310 `'SMS signature: agent first name only + phone number (two lines). No title. No store name.'` vs L23703 `'SMS SIGNATURE — copy these three lines exactly … (name / store / phone)'`. `enforceSmsSig` (L25516+) replaces the signature deterministically with a tapered name/store/phone block, so both prompt instructions are dead weight and contradict each other. Suggest one line: "Your signature is added automatically; do not write one."
- **Duration and time format:** `'Duration to state before times: '` and `APPOINTMENT TIME FORMAT` (L24320–24321) render even when the prompt says APPOINTMENT ENGINE DISABLED / "DO NOT write duration" (`a8dc2954`). Gate both on the appointment engine being on.
- **JSON shape:** system asks for 4 fields including `subject` (L17987–17988, and "Always return all three formats" contradicts "ALL four fields"). The user-prompt tail says `Return ONLY the JSON object {"sms":"...","email":"...","voicemail":"..."}`, with no subject.
- **Confidence:** verified.

### M7. The "NO CUSTOMER REPLY YET" digest pushes trade and misstates who wrote the prior messages
- **Where:** L21325–21326.
- **What's wrong:** `'- Write a DIFFERENT follow-up: new angle, a specific detail about the vehicle or trade, …'` contradicts the TRADE-IN hard constraint (see H3). `'- The follow-up should feel like a different person picked up the thread'` is wrong when the signer wrote the prior outreach herself (`a8dc2954`: the unanswered 9/22 email is from the same BD agent who signs this draft).
- **Fix:** drop "or trade", and drop the "different person" line. The CRITICAL line after it already handles the case where the prior outreach was a different agent.
- **Confidence:** verified.

### M8. Comprehension probes run again on every regen with the same inputs
- **Where:** `generateAll` L24945 awaits `_lpPrepareFactVerdicts` on every generation, including regens. `_lpRunAllFactProbes` (L2033) always dispatches all three probes.
- **Impact:** up to 4.5 s of latency added before the main call on each regen, plus 3 Worker calls, for verdicts that cannot have changed.
- **Fix:** memoise the verdicts per `(activeLeadId, hash of the three probe inputs)` for the session. The telemetry flush can still post one row per generation from the cached verdict.
- **Protected note:** this sits next to comprehension-authoritative work. It changes caching only, never the verdict logic or the kill switches.
- **Confidence:** code path verified; latency figure inferred from the timeout cap.

### M9. Concierge (Audi) examples contradict the presence rule and hard-code a person's name
- **Where:** `auth.js` L91–93.
- **What's wrong:**
  - The SMS/email examples say *"I'll have the Audi pulled into our indoor delivery bay"*. The prompt's PRESENCE LANGUAGE line says *"Do NOT say you'll have the vehicle 'pulled up' or imply the specific unit is physically here"* whenever there is no stock confirmation.
  - The email and voicemail examples name *"Matthew, your Brand Specialist"*. That is a real-looking name, not a placeholder. If it is copied it becomes a false fact on any lead whose specialist isn't Matthew.
- **Scope:** the Concierge persona itself stays (your call from before). This is about the examples only.
- **Fix:** replace "Matthew" with `[Brand Specialist]`, and phrase the bay line conditionally.
- **Confidence:** code verified. No Audi capture on hand to show it copied.

---

## 4. Findings: Low

- **L1. Scraper diagnostics printed in the CRM tab.** They never reach the panel or the exported log: `console.log` at L10023 (`[LP CONTENT-TRUNCATION DIAG]`), L10036 (`[LP INCOMPLETE-NOTE DIAG]`), L11875 (`[LP SCHED SOURCE DIAG] day-lock SUPPRESSED…`) and L12740 (`[LP SPOUSE DIAG]`), all inside `inlineScraper`. Fix: `_lpD(...)`. Verified.
- **L2. Dead reads** (read, never assigned anywhere in either build):
  - `d.conditionalOffer` (L5813/5838; its own diag says "never assigned")
  - `d.lastServiceDate` (declared `''` L8688, never set; L5865–5868 unreachable)
  - `data/leadInfo/leadData.agentPhone` (L18888, 25528, 26545, 26550)
  - `leadData.salesManager` / `leadData.storeId` (L26535, 26955)
  - `sc.distanceBuyer` (L20654)
  - `window._leadProConfig` (L1462, 27835; the hard-coded worker URL fallback is always used)
  - `window._activeLeadDealerId` (see P5).

  These are all harmless fallbacks except P5. Fix: delete. Verified by a whole-file sweep plus a manual grep of every candidate.
- **L3. DEV/COMMERCIAL drift** (comment-stripped diff, 14 hunks). All intentional or cosmetic:
  - DEV-only diagnostics, all labelled diagnostic: stability diagnostic, `computeWinnerFromFrameCandidatesDiagOnly`, the `[LP DOM-VERIFY DIAG]` executeScript block, and the DEV distinguisher log.
  - `visViaFrameEl2/_fe2` vs `visViaFrameEl/_fe`: renamed, same logic.
  - DEV declares `var _hcaCurrentVehicle` **twice** (DEV L9881–9882; harmless re-declaration).
  - DEV's frame-candidate diag JSON lacks the `viaFe` field COMMERCIAL logs, so DEV diagnostics lag.
  - `auth.js` differs only in header comments; `popup.html` only by the DEV badge.
  - No logic drift found in guards or prompt text.
- **L4. "Chronological order" vs newest-first:** a static line tells the model to *"Read the complete conversation thread … in chronological order"*, but the transcript is newest-first (the arc is oldest-first). The marker explanation is consistent with the data. Only this one sentence is off.
- **L5. Data Tool: new/used is decided per file, not per unit.** `invDetectPool` (datatool L889) classifies a whole export as `new` or `used` from median model year ≥ `CUR_YEAR` and cert rate. Early in a calendar year, a new-car file dominated by prior-model-year stock gets median < `CUR_YEAR`, and **every new unit is labelled `used`**. That condition feeds the prompt's ground truth. Inferred (time-dependent), not observed.
- **L6. Data Tool expiry uses UTC dates (observation only).** `TODAY = new Date().toISOString()` is a UTC date, so after 7 PM Central an offer expiring "today" is dropped a few hours early. Expiry handling is **out of scope per your instruction**, so I'm noting it and leaving it alone.
- **L7. The Worker edge cache only catches repeat requests within the same minute.** `edgeCacheKey` hashes the full user prompt, which contains `CURRENT TIME: h:mm PM`, so a hit only happens inside the same clock minute: a double-click guard, not a cache. That's fine, but "edge cache hit rate" should not be read as a quality or cost metric.
- **L8. The Worker timeout budget itself looks fine.** Budget arithmetic (12 s + 8 s + slack; the escalated 18 s squeezes out the emergency tier), per-tier `cacheBreakpoints` gating and the degenerate-field guard are correct as built. **The lever for the 12000 ms timeouts is prompt size (M4, H5, M3, M5), not the tier timeouts.** No Worker change proposed.
- **L9. The feedback-pairs exporter isn't in this repo,** so I couldn't audit it. The earlier finding stands (its fixed row list drops `signal`, `trigger`, `chipCount`, `meta`, `workerRequestId`, `extensionVersion`, which v7.76 returns).

---

## 5. Protected logic I think may be wrong (flagged, not changed)

### P1. SMS opt-out: two paths let an SMS draft through when opt-out evidence exists. **Critical severity.**
- **Where:** scraper L11161–11164 (`rawStopSignal`), L11261 (`isSmsOptOut`), L11354 (`smsOptOutIsExit`), L11538 (`hasExitSignal`), L11561 (`isSmsOptOutOnly`); popup L25832–25839 (deterministic blank).
- **What reaches the popup:** only `isSmsOptOutOnly` and `hasExitSignal` (grep of the return object at L14478–14584). Raw `isSmsOptOut` and `smsOptOutIsExit` stay in the frame.
- **Path A (inferred from a boolean trace; no capture):**
  1. A CRM system opt-out note is present (`/opted out of text|sms status.*opt.?out|…/` fires `rawStopSignal`).
  2. The customer's newest inbound is not a bare "STOP", e.g. "still looking, email me instead".
  3. So `smsOptOutIsExit = true` (not bare, not new lead), so `isSmsOptOutOnly = isSmsOptOut && !smsOptOutIsExit && … = false`.
  4. But `hasExitSignal` requires `!recentCustomerActive`, and "still looking" sets `recentCustomerActive`, so `hasExitSignal = false`.

  Result: the popup sees neither flag, the L25834 blank does not fire (the newest message isn't bare STOP), and no "SMS = EMPTY" directive renders. **An SMS draft is produced for a number with opt-out evidence.**
- **Path B (verified in code; this is a rule conflict, not a code slip):** L11261 `isSmsOptOut = … (rawStopSignal && !hasNewLeadToday && !hasRecentReoptIn)`. A new lead clears the opt-out entirely, so SMS is drafted. The audit brief states the rule as *"A new lead is a new opt-in opportunity only for exit/farewell framing; SMS stays suppressed when opt-out evidence exists."* The code comment at ~L11342 also claims *"isSmsOptOut stays TRUE (untouched above)"*. The v9.7.437 comment records your earlier rule that a new lead "should disqualify OLD opt-outs on its own." **These disagree, and I need your ruling on which one is current.**
- **Proposed fix (if you rule "suppress"):** return one explicit `smsSuppressed` boolean from the scraper (any opt-out evidence, not superseded by an explicit re-opt-in). Have L25834 and the prompt's SMS-status line read only that. Leave exit/farewell framing on its current flags.

### P2. The exit detector reads our own outbound text and matches buying language
- **Where:** L11085 `recentTranscript = filteredTranscript.slice(0,5)` (all speakers) feeds `fullScanText` (L11086), which feeds `exitRaw` (L11362).
- **Tested phrasings:**

  | Customer wrote | Result |
  |---|---|
  | "I found one on your website I really like, is it still there?" | EXIT via `found one` |
  | "We decided to go with the Highlander, when can we come sign?" | EXIT via `decided to go with` |
  | "had a bad experience at another dealer so I want this to be easy" | EXIT via `bad experience` |
  | "I already bought my wife a Kia from you guys last year and loved it" | EXIT via `already bought` |
  | "…my husband wanted to go elsewhere but I talked him into you" | EXIT via `going…elsewhere` (greedy `.*`) |

- **Mitigation, partial:** `!recentCustomerActive` only rescues phrasings containing its own keywords ("still looking", "would like to", …). Agent boilerplate in the five newest lines ("if you already bought something…") also counts. That is plausibly the unexplained `exitSignal:true` on the Phone Up case the L11541 comment describes.
- **Suggestion:** scan customer lines only (`recentInbound`, already built at L11084), and drop `found (one|…)`, `decided to (…)` and `bad experience`, or send the exit verdict through a comprehension probe like day-lock.

### P3. Day-lock: the regex reads the customer's words backwards, and a leftover line escapes the comprehension override
- **Where:** `_lpDayScan` L11785–11793.
- **Tested phrasings:** every one of these produces "LOCK IN <day> - do NOT offer any other day":
  - "i work on saturdays so that wont work" → LOCK saturday
  - "i cant do this saturday" → LOCK saturday
  - "sorry i missed your call on monday" → LOCK monday
  - "my wife is in the hospital until friday" → LOCK friday
  - "…closing on the house next tuesday so after that" → LOCK tuesday
  - "i already bought something else on sunday" → LOCK sunday
- **What the comprehension layer covers:** it REMOVEs the fenced lock when the probe disagrees (L2229+).
- **What it doesn't cover:**
  - (a) the same match sets `customerSaidNotToday = true`, which emits `🚫 NOT TODAY: Customer said today does not work.` at L6741–6742, **outside the fence** (fence opens at L6798), so it survives the REMOVE;
  - (b) when probes fall back (timeout or error), the inverted lock ships as written.
- **Suggestion:** move the NOT TODAY lines inside the day-lock fence, or derive them from the final decision. I'd leave the regex itself alone while comprehension is authoritative.

### P4. Agent-note visit tags turn "return call" into "customer already visited"
- **Where:** L12271–12286 → `_overrideWarning0` / `_overrideWarning` (L12339+, L13100+).
- **Tested phrasings:**
  - "customer requested a return call after 5" → `⚠ RETURN VISIT PLANNED` plus `⚠⚠ RETURN VISIT OVERRIDE: An agent note indicates the customer has already visited AND has a plan to return`
  - "cust said she will be returning the rental" → same
  - "he will call back tomorrow…" → same (`back.*tomorrow`, with no date check on how old the note is)
  - "he came out of the hospital last week" → `⚠ CUSTOMER ALREADY VISITED`
  - "customer visited our website" → `⚠ CUSTOMER ALREADY VISITED`
- **Why it's flagged here:** the agent's note is protected hard evidence, but this is a regex reading of the note, not the note. The note text is already in the prompt verbatim.
- **Suggestion:** drop the tags and the override paragraphs and let the model read the note, or at least drop `return(ing)?` and the bare `visited` and gate "tomorrow" on note age.

### P5. The rescue broad-merge dealer check depends on a global that is never set
- **Where:** ~L16125: `var _activeDealerId = window._activeLeadDealerId ? … : (m.dealerId ? String(m.dealerId) : null);`
- **What's wrong:** `window._activeLeadDealerId` is never assigned anywhere (only `window._activeLeadId` is, at L7327). The guard therefore compares the rescue frame against the merged frame's own `dealerId`. When the winning frame had no `dealerId`, the cross-store identity block is inert.
- **Suggestion:** set `window._activeLeadDealerId` wherever `_activeLeadId` is resolved, or drop the dead global and document the fallback. This is wrong-rooftop-adjacent, so it's yours to rule on.

### P6. Cadence position vs lead age (question, low confidence)
- **What I saw:** `a8dc2954` states "Scheduled position: the day-24 touch of the 90-day sequence (reconciled)" on a lead the same prompt calls 55 days old and "Phase: reactivation (Day 31-60)".
- **Question:** if "day-24" is a touch index rather than a calendar day, the wording invites the model to read it as a date.
- **Next step:** not traced to a bug. Flagging it for you to confirm what "day-N" means before anyone touches the 90-day cadence.

---

## 6. What I checked and found sound

- **Static system head:** byte-identical across stores, personas and days (md5 over 10 captures), and the sentinel split in Worker v7.76 is correct.
- **CURRENT LEAD marker:** every slice site (L4812, L6614, L11293, L18933, L23782) keeps the part **above** the marker, which is correct for the newest-first transcript. No captured AGENT CONTEXT block contained a note older than the marker (0 of the 42 captures that have one).
- **Refine pass:** skipped when the first-pass SMS was blanked by opt-out (L18219), so it cannot resurrect a suppressed SMS.
- **Worker cascade:** the tier gating, the effort escalation (primary-only) and the 5.6-only parameter gating are all as intended.
- **Dealer-to-state map:** the distance rule's inline home-state map (`6189/6190/6191 → TX`, `24399/21135 → LA`, L7179) agrees with `content.js` `LA_DEALER_IDS = ['24399','21135']` and with the five rooftops in `DEALER_ID_MAP` (L3426).

---

## 7. Proposed Phase 2 order (after your approval)

1. **P1 ruling first** (compliance), then H1, H2, H3, H5 (with the routing-equivalence caveat), and H4.
2. The prompt-hygiene batch: M1, M3, M5, M6, M7, M9.
3. **M4** (moving static text above the cache boundary) last. It is a position change with the widest blast radius, and should go in only with paired before/after drafts across all five rooftops.
4. **M2 and M8** need your explicit OK (routing flag and probe caching).
5. The Low items can ride along with any of the above.
