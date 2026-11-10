# Lead Pro — Full Audit #2: performance and logic (Phase 1, findings only)

Audited 11/10/2026 against the current sources, read from the repo:

- **Extension:** 9.7.866 (`builds/dev`, `builds/commercial`), commit `834b57c`
- **Proxy:** `worker/cloudflare-worker-v7.91.js` (unchanged since audit #1)
- **Reporter:** `worker/leadpro-reporter-v1.25.js`
- **Dashboard:** v1.12 · **Feedback gatherer:** v1.6 · **Data Tool:** `datatool/index.html`

No code was changed by this audit.

**How findings were verified**

- Line numbers are in `builds/dev/popup.js` at 9.7.866 unless a file is named.
- **EXECUTED** means the shipped function was run in the test sandbox (the same loader the suites use) and the output is
  quoted. **READ** means the code path was read end to end. **MEASURED** means a number taken from real data on file.
  **INFERRED** marks anything not proven by one of those.
- Lead IDs only. No customer names, contacts or keys.

**The data this audit could use, stated plainly**

This session's container was reset before build 865, and the replay corpus (117 prompt dumps) went with it. What is on
file now:

| Real data | What it gave |
|---|---|
| 2 full prompt dumps, 11/9 (leads 2112149909, 2112000019), both rebuilt on 866 | prompt size, static text, duplicate blocks, real contradictions |
| logs 415 and 416 | 4 `[LP GRAB TIMING]` lines (3 leads), frame and key-info reads |
| Reporter v1.25 page for 11/9, 08:30–17:53 CT | per-contract latency, cache per key per minute, failures, comprehension |
| Feedback export for 11/9 (28 rows) | regenerated and rejected sessions by lead |

So "across all dumps on file" means **two dumps**. Where a finding needs frequency across the fleet, it is marked and a
measurement is proposed instead of a guess (see MS-1). If you re-send grabs, the scripts written for this audit re-run
on them unchanged.

---

## Summary

| ID | Sev | Area | One line |
|---|---|---|---|
| SC-1 | **High** | Logic, scope | Scenario flags are set by finding phrases anywhere in the context: any author, any lead. Our own "no worries if not today" becomes "Customer said they cannot come in TODAY" |
| PF-1 | **High** | Grab speed | Every grab waits 4.0 s for frames that have no lead on them. About 4.2 of the 4.3 s grab is that wait |
| CT-1 | **High** | Contradiction | From about 3:45 PM to the same-day cutoff, one prompt says "today is the default", suggests tomorrow's times, and says "appointments are for tomorrow" |
| SC-2 | Med | Logic, scope | Two different definitions of "this lead": a date cutoff in the scraper, the marker in the popup. With no Created date the scraper reads 180 days |
| DR-1 | Med | Directive | "The customer wants to know what their TRADE is worth" fired on a real lead whose last message was "Stop", after a visit |
| DR-2 | Med | Directives | 328 directive labels in code; real prompts carry 81–87 "do not / never" instructions and up to 7 lines each claiming the lead |
| CT-2 | Med | Contradiction | A real prompt with five owners of the message at once (lead 2112149909) |
| ST-1 | Med | One source | Store hours live in two tables; the same-day cutoff lives only in one of them |
| ST-2 | Med | One source | Appointment state is decided four ways; two of them are prose matches with no writer |
| PF-2 | Med | Proxy load | Each Grab refetches all five stores' inventory and incentives: about 4,550 of 11/9's 5,454 proxy requests |
| PF-3 | Med | Grab speed | The key-information wait hit its 2 s cap on all 4 grabs and found 0 rows in all 18 reads |
| PF-4 | Med | Prompt cost | The user prompt is 53–54k chars on ordinary leads; 12–18k of it is static, and the conversation is sent twice |
| PF-5 | Med | Cache | Do **not** partition the draft key (99–100% warm at every load). The text rewrite splits into ~57 keys because the agent's name is at character 8 |
| PF-6 | Med | Proxy | The phone-ask classifier runs inline on 302 drafts to flag 2; its latency is not logged |
| MS-1 | Med | Measurement | The report cannot label 83% of requests, and nothing counts which directives fire |
| B-2 | Decision | Readers | Step 2 is still open. 11/9: 5 disagreements in 248 usable verdicts, 4 of them the model seeing what the pattern missed |
| SC-3, ST-3, CN-1…CN-6 | Low | various | Agent lines in an exit suppressor, a dead pause field, consolidation, dead switches, repo leftovers |

---

## Part 1 — Status of audit #1

Every "fixed" item was re-verified in the 9.7.866 code. "Verified" below says how.

| ID | Status now | Re-verified in 866 |
|---|---|---|
| C-1 key in `auth.js` | **Held** (owner). Source comments still carry the pattern (3 hits per build); the packaged zips do not | EXECUTED: `unzip -p … auth.js \| grep -c 'LP-[A-Z0-9]{8}'` returns 1 in both 866 zips, and that one hit is the login field's placeholder (a single repeated character), not a key. Revoke and reissue is still yours |
| B-1 bereavement rule 3 | **Fixed in 850** | EXECUTED the shipped regex (`:16980`): 0 of 7 false-fire strings ("she passed the credit check", "my son just passed his road test" …), 4 of 4 real notices. Rule 3 reads customer lines only (`:16985`) |
| B-2 two readers | **Step 1 fixed in 851; step 2 open** | READ: the three `*_AUTHORITATIVE` switches are `false` (`:2813–2815`), the probes are started and not awaited (`:34055`). MEASURED: all 4 timing lines say "probes … in parallel, not waited on"; the 11/9 report says the authoritative switch was on for 0 of 850 rows |
| B-3 `REQUIRE_LICENSE` | **Held** (owner checks) | Not re-audited, per your instruction |
| M-1 unknown lead age | **Fixed in 854** | READ: the payload, dump and feedback row carry `_lpAgeNum(…)`, `null` when unknown (`:34276`, `:34306`, `:37138`); one fallback `_lpLeadAgeFallback` (`:6003`). See SC-2 for a neighbor that is still open |
| M-2 prose "sold" regex | **Fixed in 856**, extended in 863 | READ: `vehicleSold` (`:23973`) is the sold marker or our own counted claim; the prose match is logged and decides nothing. See SC-1: the *other* flags in the same function still use the retired technique |
| M-3 one text for helpers | **Fixed in 853** | READ: `_lpPromptInputData` carries `history` |
| M-4 reporter metrics | **Fixed in reporter v1.25** | MEASURED on the 11/9 page: Recovered 1, Served safe fallback 0, per-contract table, "Classifier regen", computed footnote ("on for 0 of 850 rows"). Two gaps remain, in MS-1 |
| M-5 Data Tool expiry | **Partly fixed** | READ: year rollover is in (`rollFloor`, `datatool/index.html:418–423`). I did not re-run the range cases ("10/1/2026 - 11/2/2026"); treat ranges as **not re-verified** |
| M-6 comments in the zip | **Fixed in 850** (packaging) | MEASURED today: `popup.js` 4,491 KB → 1,714 KB in the 866 zip, literal-identical, tree-identical |
| M-7 contacts and key in console | **Fixed in 850** | READ: masked samples (`:11570`), Director key last 3 characters (`auth.js:543`). Still open and not in M-7's scope: `[LP RAW DIAG] rawSms / rawEmail` print whole drafts, which carry the customer's first name (`:35559–35560`) |
| M-8 `content.js` | **Open** | READ: 1,408 lines, `all_frames: true`, 17 console calls, unchanged |
| M-9 cache | **Step 2 (measure) fixed in reporter v1.25; step 1 (move static text) open** | MEASURED: see PF-4 and PF-5. The measurement answers the partition question: no |
| M-10 pairs join | **Fixed in gatherer v1.6** | MEASURED: every 11/9 export row carries `workerRequestId`, `signal`, `trigger`, `extensionVersion` and a `join` result |
| L-1 six-way entry parsing | **Open**, and grown | EXECUTED: one prompt build calls `_lpThreadEntries` 45 times (was 35). See CN-1 |
| L-2 invite canary | **Fixed in 850** | READ: returned in the result and logged popup-side (`:37816`). The page-side `console.warn` is still there too (`:37636`); harmless |
| L-3 dead switches | **Open** | READ: all still present. List in CN-2, with new ones |
| L-4 opt-out wording | **Fixed in 852** | READ only |
| L-5 unknowable assertions | **Partly fixed** | READ: "has read every message … chosen not to respond" is now "has not replied to any of them" (`:24640`). New ones in DR-1 and CT-2 |
| L-6 `stalledTouches` | **Unchanged** (no change recommended) | — |
| L-7 merge fields | **Open**, still INFERRED | READ: the gate structure is intact (`:21836–21870`); the sibling-frame-without-lead-ID shape was not reproduced |
| L-8 packaging leftovers | **Open** | READ: `tabs` permission and `icon48.png` still present |
| L-9 gpt-4.1-mini retirement | **Open** (Jan 14, 2027) | READ: still the emergency tier (`:1501`) and the classifier (`:1553`) |
| L-10 KV reads per key | **Open** | READ: no KV metadata use in v7.91. PF-2 adds a larger, measured read cost |
| L-11 `parseVehicle` make | **Open** | READ only |

---

## Part 2 — Logic

### A. Scope sweep

**Method.** Two passes with the shipped file parsed into a syntax tree:

1. Every top-level function that reads `history`, `context`, `conversationBrief`, `lastInboundMsg`, `leadContext` or
   calls a reader primitive: **89 functions**.
2. Inside the five large functions, every pattern test and what text it is applied to: **1,170 tests**
   (`inlineScraper` 643 on 220 subjects, `buildUserPrompt` 248, `populateFromData` 144, `classifyScenario` 94,
   `generateAll` 41).

A table of 1,170 rows would not help you, so the table below is by **scan text**: what it holds, who wrote it, which
lead, how many detectors read it, and what they feed. Flagged rows are the findings that follow.

| Scan text (where) | Holds | Author scope | Lead scope | Readers | Feeds | Flag |
|---|---|---|---|---|---|---|
| `_lpThreadEntries(d)` (`:4739`) → `_lpOurEntries`, `_lpCustEntries`, `_lpCustSignals` (`:1155–1173`) | parsed entries above the marker | tagged: ours / customer / note / call note | **current lead** (sliced at the marker) | 37 helpers; 23 + 18 + 8 + 15 call sites | pitch-out, OTD, call wants, timeline, owed asks, first touch … | Healthy. Marker missing → see SC-2 |
| `_lpCustomerText(d)` (`:953`) | `lastInboundMsg` + customer lines | customer | current lead on the popup side; `lastInboundMsg` is scraper-scoped | 17 call sites, 6 helpers | trade declined, interior ask, what-we-have, deal condition | Scope depends on SC-2 |
| `_lpWalkCrmEntries` (`:1959`) | every dated entry | **none** (no tag) | **any lead** (no marker) | 5 helpers: `_lpPricePushback`, `_lpOtdFigureSent`, `_lpWalkArc`, `_lpRunCommitComprehension`, `_lpBuildFactInputs` | price pushback, OTD figure sent, the arc, the fact probes | **Author- and marker-unaware.** CN-1 |
| `ctx` in `classifyScenario` (`:23463`) | the whole `leadContext`, lowercased: our scaffold + the transcript | **any** | **any** | 24 tests | 11 scenario flags and the TASK | **SC-1** |
| `data.conversationBrief` lines + `_ddCtxArc` in the deal-condition block (`:30352–30358`) | every line an attribution pattern matches ("customer wants…") | agent notes about the customer | **any lead**, no recency bound | trade-value, deal condition | "RESPOND TO WHAT THE CUSTOMER ACTUALLY ASKED" | **DR-1** |
| `data.context` in `buildUserPrompt` (13 tests) and `ctx_sb` (13) | `leadContext` | any | any | 26 | first-touch, showroom, chat, source wording | Mostly scaffold reads; same technique as SC-1, lower risk |
| `filteredTranscript` (scraper, `:16493`) | transcript lines newer than the **date cutoff** | any | cutoff, not marker | source of the three below | — | **SC-2** |
| `recentInbound` (`:16516`) | newest 5 `[CUSTOMER]` lines of that | customer | cutoff | `exitRaw`, `boughtElsewhere`, `exitByRemoval`, `recentCustomerActive`, bereavement rule 3 | **exit** | SC-2 |
| `fullScanText` (`:16518`) | newest 5 customer lines **plus newest 5 lines of any author** | any | cutoff | `keepingTrade`, bereavement rules 1, 2, 4 | exit suppressor; bereavement exit | **SC-3** |
| `recentInboundText` (`:19105`) | newest 3 inbound messages | customer | cutoff | `dayCommit`, `waitingOn`, `pendingDecision` | day-lock, pause wording | SC-2 |
| `customerOnlyText`, `allTranscriptText` (`:18581–18582`) | concern scan lines, our own sends removed | customer / mixed | cutoff | 11 | `customerConcerns` (co-signer, color, spouse …) | SC-2 |
| `ntText` (`:17463`) | newest customer text for schedule reading | customer | cutoff | 11 | arrival time, schedule constraint, out of town | SC-2 |
| `TEXT` (scraper) | the frame's page text | system (page) | the frame | 57 | IDs, Created, stock, sold label, address | Ground truth. Healthy |
| `content` / `title` / `t` / `c` (scraper note loop) | one note at a time | per note (title tells the type) | per note; scope applied by date | 150+ | note typing, call notes, internal exits (855), pending notes (856) | Healthy where 855/856 scoped them |

**Marker missing.** EXECUTED: with no marker in the transcript, a two-year-old customer "not today" and an old
"Sold/Delivered" note set `notToday` and `isSoldDelivered`, and the prompt carried "EARLY FOLLOW-UP — THE CUSTOMER HAS
REPLIED". The popup helpers built on `_lpThreadEntries` behave as documented (no marker → the whole text is "current").

**Age unknown.** READ: `null` since 854, and the readers handle it. The scraper's cutoff does not follow: see SC-2.

---

### SC-1 — Scenario flags are set by finding phrases anywhere in the context

- **Severity:** High
- **Component:** `classifyScenario`, `:23463–24013`
- **Evidence (READ).** `ctx` is the whole `leadContext`, lowercased: Lead Pro's own scaffold **and the transcript**.
  Eleven flags are substring tests on it:

  | Flag | Test | Who writes that phrase into the context |
  |---|---|---|
  | `isApptConfirmation` | `'appointment already set'` | **Nobody.** No code writes it. It can only come from transcript text |
  | `isMissedAppt` | `'missed appointment'` | **Nobody** as a label. Transcript text only (a task title, a note) |
  | `isShowroomFollowUp` | `'showroom stage'` (or the real field) | **Nobody** (the code's own v9.7.194 comment says so) |
  | `notToday` | `'not today'` | the `🚫 NOT TODAY` line (`:11406`, `:11414`) **and** any message |
  | `isSoldDelivered` | `/sold\/delivered/` (or the real field) | the `🎉 SOLD/DELIVERED` line (`:8968`) **and** any note |
  | `isStalled` | `'stalled lead'` (or the real field) | `:11823` and any note |
  | `isLoyaltyVehicle`, `isLeaseMature` | `'loyalty vehicle'`, `maturity date`, `account type.*lease` | `:11903` and any note |
  | `isExitSignal`, `isPauseSignal` | `'exit signal'`, `'pause signal'` | the scraper's action map (`:18353–18354`) |
  | `noCustomerPhone` | `'no customer phone number'` | `:11405` |
  | `noSpecificVehicle` | `'no specific unit'` or `'No stock number or VIN'` | prompt lines; the second test can never match (a capital N in lowercased text) |

- **Evidence (EXECUTED, shipped 866 code, placeholder lead).** Baseline flags: follow-up, standard. Then one line added:

  | Line added | Where | Result |
  |---|---|---|
  | our own text "No worries if not today, tomorrow works too." | current lead, **our** message | `notToday` → "TIMING NOTE: Customer said they cannot come in TODAY. Do NOT offer same-day times." |
  | our own text "Is your appointment already set with another store?" | current lead, **our** message | `isApptConfirmation` → "TASK: Appointment is already confirmed. Write a warm confirmation m…" |
  | note "missed appointment follow up call, left voicemail" | current lead, **our** note | `isMissedAppt` |
  | customer "not today, I am working" | **prior lead**, 200 days old, below the marker | `notToday`, the TIMING NOTE, the suggested times removed, and "NO CUSTOMER REPLY YET" replaced by "THE CUSTOMER HAS REPLIED" |
  | note "Lead status changed to Sold/Delivered" | **prior lead**, 400 days old | `isSoldDelivered`; suggested appointment times removed |
  | note "appointment already set for Saturday" | **prior lead** | `isApptConfirmation`; suggested times removed |
  | task note titled "Missed Appointment" | **prior lead** | `isMissedAppt` |
  | note "lease maturity date is next March" | **prior lead** | `isLeaseMature` |
  | note "stalled lead, no response" | **prior lead** | `isStalled` |

  Real data: the 11/9 dump for lead 2112149909 has an entry below the marker in its prompt, so prior-lead text does
  reach this function in production.
- **Customer-visible impact.** A message written for a situation that does not exist: a confirmation of an appointment
  nobody booked, "you said today doesn't work" to someone who never said it, no times offered on a fresh lead because an
  old one was delivered. Frequency is **INFERRED** (two dumps on file; neither trips it).
- **Why this is the same bug as M-2.** It is the retired "prose sold regex" technique, still in use for the ten flags
  next to it. Lead Pro writes a label into prose, then searches all prose for the label. Per your philosophy this is a
  detector manufacturing a fact, and it reads Lead Pro's own output as the record.
- **Proposed fix (smallest).** Each flag reads the field that already holds the fact, and nothing else:
  - `notToday` ← `data.customerSaidNotToday` / the schedule constraint (the fields that write the NOT TODAY line).
  - `isSoldDelivered` ← `data.isSoldDelivered` only.
  - `isStalled` ← `data._isStalled`; `isShowroomFollowUp` ← `data.isShowroomFollowUp`.
  - `isExitSignal` / `isPauseSignal` ← `data.hasExitSignal` / `convState`.
  - `isApptConfirmation` ← `data.hasApptSet` (see ST-2), or delete the flag. **Your decision:** today nothing can set it
    correctly, so deleting it changes no correct behavior.
  - `isMissedAppt` ← `data.hasMissedAppt` (the scraper's own reading, which the fresh-lead guard at `:23603–23619`
    already corrects for prior leads).
- **Downstream consumers of each flag** (so nothing is switched on or off unseen):
  `isApptConfirmation` `:27599, :28212, :33079, :33268, :37214` · `notToday` `:33132` ·
  `isMissedAppt` `:23603–23619, :27128, :37213` · `isStalled` `:24210, :27879, :27995–28104, :37179` ·
  `isSoldDelivered` (scenario) `:27077, :28212, :33079, :37215` · `isLeaseMature` `:23973, :24099, :24149, :24209,
  :27421, :28212, :37210`. The `:37xxx` lines are the feedback row's scenario labels, so the report's scenario mix shifts
  slightly too.
- **Regression risk.** A lead where the flag is *right* today only because of the prose match (the field is false but a
  note says it). Before/after prompt diff on every dump on file is the check; I expect the diff to be small and to be
  exactly the false fires.
- **Verify.** The nine rows above as executed assertions (each must set nothing); controls with the real field set
  (each must still set its flag).

### SC-2 — "This lead" is defined two ways, and one of them falls back to 180 days

- **Severity:** Medium
- **Component:** scraper `:15189–15239` (cutoff) and `:16493` (`filteredTranscript`); popup `_lpThreadEntries` (marker)
- **Evidence (READ).** The scraper scopes by **date**: `transcriptCutoffMs` starts at now − 180 days and is tightened to
  the lead's Created date when that is read. The popup scopes by **position**: entries above the marker. They agree on
  an ordinary lead. They part in two cases:
  1. Created is not read (the M-1 case). Age is now `null`, but the cutoff stays at 180 days, so `exitRaw`,
     `boughtElsewhere`, `keepingTrade`, bereavement rules 1, 2 and 4, `dayCommit`, `waitingOn` and the concern scan read
     up to six months of earlier leads.
  2. A re-submitted lead on an old record: the cutoff moves only when the new lead note is 30+ days after Created
     (`:15421–15425`).
- **Customer-visible impact.** INFERRED. The 855 build closed this for internal notes ("a match cannot end the
  conversation on its own when the start cannot be found") and 852 for `exitByRemoval`. The customer-line exit patterns
  did not get the same rule.
- **Proposed fix.** One definition: the marker's timestamp (`_lpMarkerMs`, already computed at the marker) is the
  cutoff whenever it exists; when neither marker nor Created exists, apply 855's rule to every exit path (a match is
  logged, and cannot end the conversation alone).
- **Regression risk.** An exit that is real and sits just before the marker. The standing rule already says a new lead
  supersedes prior exits, so this is the intended behavior.
- **Verify.** The 855 suite's shapes, run with Created unread, for `exitRaw` and `boughtElsewhere`.

### SC-3 — An exit suppressor reads our own lines (Low)

`keepingTrade` (`:17016`) tests `fullScanText`, which includes the newest five lines of any author. An agent's "you can
just keep your truck and add this one" cancels a real exit in `hasExitSignal` (`:17197`). READ only; no incident known.
Fix: test `recentInbound`.

---

### B. Directive inventory

**Method.** Every string literal in the shipped file that opens with an ALL-CAPS label, with its enclosing function:
**328 distinct labels** (`buildUserPrompt` 160, `populateFromData` 82, `inlineScraper` 37, the text rewrite 11, other 38).

**How often they fire — what can and cannot be said.** On the two real prompts, rebuilt on 866: **42 and 31** labels
present; **26** in both (these are static or near-static); **47** in at least one. That is two leads at one store on one
morning, so it says nothing about the other 281. I am not going to rank 328 directives on two samples. MS-1 proposes the
measurement that makes this table real in one day of traffic.

**What can be said now** is the class of each family and what should happen to it:

| Family | Source detector | Class | Known incidents | Recommendation |
|---|---|---|---|---|
| Inventory answers (`VEHICLE ON LEAD`, `WHAT WE HAVE`, `NO <COLOR> ONE IN STOCK`, `INVENTORY STATUS`) | the feed, PageData, page banner | **Ground truth** | 606, 856, 859, 862, 865, 866 | **Keep.** This is the machinery that earns its place |
| Time and hours (`STORE STATUS`, `SUGGESTED APPOINTMENT TIMES`, closed days) | clock + hours tables | **Ground truth**, but two tables | 497, 638, 642, 865, 866 | **Keep, one source** (ST-1, CT-1) |
| What we sent (`OUR PITCH IS ALREADY OUT`, `WE SAID IT SOLD`, `WE ASKED THEM FOR SOMETHING`, first reach) | our own entries on this lead | **Ground truth** (our record) | 816, 859, 860, 865 | **Keep.** Check they do not each claim the message (CT-2) |
| Appointment state | structured field + two prose matches | mixed | SC-1 | **Keep the field, delete the prose** (ST-2) |
| Scenario flags from context text | substring on `leadContext` | **Manufactured** | SC-1 | **Replace with the field** |
| "What the customer wants" (`RESPOND TO WHAT THE CUSTOMER ACTUALLY ASKED`: trade value, deal condition, deadline, distance) | patterns over customer text and attributed note lines | **Conversational interpretation** | DR-1; 709 (a lien read as a trade) | **Replace with one line**: "Answer what their newest message asks before anything else." The model reads the message |
| Day named / verbal commitment / off-franchise | pattern, with the model as observer | **Conversational interpretation** | 857 (orphaned header); 4 pattern misses on 11/9 | **B-2 step 2**: one prompt rule each |
| Customer concerns (color, co-signer, spouse, budget) | concern scan | **Conversational interpretation** | 741, 743, 747, 865 (color fixed four times) | **Replace with the fact only**: what the unit on the lead *is* (ground truth). Drop "they want X" |
| Posture and touch (`TOUCH POSITION`, `EARLY FOLLOW-UP`, stalled rungs, quiet customer) | counts and calendar | Heuristic over ground truth | 702, 736, 737, 858 | **Keep the calendar facts** (your standing rule), trim the prose around them |
| Static rules restated per prompt (`CLOSED DAYS ARE NEVER OFFERED`, `TIME-OFFER VARIETY`, name source, 8 reasoning steps) | none (always on) | Static | — | **Move to the system prompt** (PF-4). Not a logic change |

**Replacement candidates ranked by risk and value** (highest value, lowest risk first):

1. SC-1's ten flags → fields. Removes a proven false-fire path; no prompt text changes when the field agrees.
2. The trade-value / deal-condition block → one line (DR-1). Removes an assertion the model cannot check.
3. The concern scan's "they want" lines → the unit's own facts. Four builds have patched color alone.
4. B-2 step 2, per fact.
5. Posture prose. Lowest urgency; largest text.

### DR-1 — "The customer wants to know what their TRADE is worth" on a lead that said "Stop"

- **Severity:** Medium
- **Component:** `buildUserPrompt` `:30352–30362`, `:30404`
- **Evidence (MEASURED, real lead 2112149909, rebuilt on 866).** The prompt carries "⚠⚠ RESPOND TO WHAT THE CUSTOMER
  ACTUALLY ASKED — LEAD WITH INFO, NOT A SHOWROOM TIME: The customer wants to know what their TRADE is worth — they
  asked for a NUMBER, not an appointment. Lead with the value". The same prompt's CONVERSATION STATE says the customer's
  last message was "Stop", and the lead has a showroom visit on it.
- **Evidence (READ).** The match text is `_lpCustomerText(data)` plus **every line of `conversationBrief`** that an
  attribution pattern matches ("customer wants", "she asked", "needs"), with no marker slice and no age limit. One agent
  note keeps the directive alive for the life of the record.
- **Impact.** A directive that says "lead with" and states as fact something that was true before the visit.
- **Fix (per philosophy).** Delete the four-way detector. Keep one sentence: "If their newest message asks a question,
  answer it first." If you want to keep the detector, the smallest safe form is: the customer's own messages only, above
  the marker, newer than our last reply to them.
- **Regression risk.** The 9/2025-era incidents this block was written for (a price counter answered with appointment
  times). The deal-condition hold in the visit decision (`_LP_VISIT_HARD`) still covers that case.
- **Verify.** Rebuild both dumps; the line is gone from 2112149909. Fixture: a current-lead "what's my trade worth?"
  still gets its answer first.

### DR-2 — Rule volume

- **MEASURED** on the two real prompts (866 rebuild, transcript lines excluded): 260 and 215 instruction lines; **87 and
  81** "do not / never" instructions; 12 and 8 "must / always"; **7 and 2** lines that each claim the lead or the one job
  of the message.
- **Why it matters.** Each rule was added for a real incident. Together they are the stacked independent signals your
  philosophy names. The model's attention is finite, and CT-2 shows what the stack looks like on one lead.
- **Fix.** Not a rewrite. First measure which directives fire and which co-fire (MS-1), then prune by evidence.

---

### C. Contradictions

### CT-1 — Late afternoon: "today is the default", tomorrow's times, "appointments are for tomorrow"

- **Severity:** High (it is every late-afternoon generation at every store)
- **Component:** status line `:30531–30552`; slot engine `computeAppointmentTimes` `:33574–33740`; timing block
  `:33230–33260`
- **Evidence (EXECUTED at fixed clocks, Baytown, closes 8 PM).** At 4:00, 5:00 and 6:00 PM the same prompt carries all
  three:

  ```
  STORE STATUS RIGHT NOW: OPEN. Closes at 8 PM (3h 0m remaining today). OFFER THE SOONEST REAL OPENING FIRST. There is
    still usable time TODAY, so today is the default: lead with a today time, or today plus tomorrow. …
  SUGGESTED APPOINTMENT TIMES (fallback only — see rule below):
  Option: 9:15 AM
  Option: 10:30 AM Wednesday, November 11
  TIMING — NEXT-DAY: Appointments are for tomorrow. Be proactive, not urgent.
  ```
- **Cause (READ).** The slot engine adds a 2-hour buffer and needs two slots 45 minutes apart that start by the cutoff
  (6:30 PM Baytown). So it gives up on today at about **3:45 PM** at the Baytown stores, 3:15 PM in Lafayette, 1:45 PM on
  an Audi Saturday. The status line reads only the closing time. Build 866 aligned the two **after** the cutoff; the
  window before it is still split, and it is the window agents work evening leads in.
- **Second defect in the same lines.** The first option has no day ("Option: 9:15 AM") and the second does. That is
  where "tomorrow at 9:15 AM or Tuesday, November 10, at 10:30 AM" came from. 866(d) repairs the sentence at render;
  the source should print both options the same way ("9:15 AM or 10:30 AM, both tomorrow, Wednesday November 11").
- **Customer-visible impact.** The model picks: some drafts offer times today that the engine did not check, some offer
  tomorrow with three hours of open store left. The 11/6 and 11/9 "tonight at 7:30" drafts were the after-cutoff half of
  this.
- **Needs your decision.** What is the last time of day to offer a same-day visit, and how much notice? Today the code
  has three answers (2 hours' notice with two slots; the 6:30 PM cutoff; "until closing"). One rule, in one place, read
  by the status line, the slot engine, the timing block and the Add Appt line.
- **Smallest fix once decided.** `computeAppointmentTimes` returns `sameDayOpen` (true or false) and its slots under that
  one rule; the status line and the TIMING block print from that result and nothing else.
- **Regression risk.** The 497 incident (drafts drifting a week out at 11 AM). The fixture for it stays.
- **Verify.** The prompt built at 10 AM, 2 PM, 4 PM, 6 PM, 7 PM and 8:30 PM per store: never "today is the default"
  beside tomorrow-only options.

### CT-2 — Five owners of one message (real lead 2112149909, rebuilt on 866)

- **Severity:** Medium
- **Evidence (MEASURED).** In one prompt:
  1. "RESPOND TO WHAT THE CUSTOMER ACTUALLY ASKED … Lead with the value" (trade; DR-1).
  2. "CLOSE WITH ONE CONCRETE OFFER … and the offer BRINGS THEM BACK IN" (showroom follow-up block, `:8974–8978`).
  3. "OUR PITCH IS ALREADY OUT AND UNANSWERED … do not offer times or a visit".
  4. "WE ASKED THEM FOR SOMETHING THAT MOVES THEIR DEAL … Ask, simply, whether…" (865).
  5. "lead with their stated number as the anchor" (budget concern).

  Plus two facts that disagree: (3) says our message "told them the car is here", and PRESENCE LANGUAGE says "its
  presence on the lot is NOT confirmed".
- **What arbitrates today.** The VISIT DECISION line settles the visit ask (2 against 3). Nothing settles who opens the
  message.
- **Fix.** The visit decision's design, applied once more: one "THIS MESSAGE IS ABOUT" line chosen by a short fixed
  order (their newest question → something we owe them → something we asked them for → the standing offer), and the
  losing blocks drop their "lead with / close with" sentence and keep only their fact.
- **Regression risk.** Medium: it changes which block leads on multi-signal leads. Needs the before/after diff on every
  dump and your read of the changed ones.

### Lines that assert what the model cannot know

- "they asked for a NUMBER, not an appointment" (DR-1): asserted from a pattern over notes.
- "TIMING NOTE: Customer said they cannot come in TODAY" when the phrase was ours or from an old lead (SC-1).
- "TASK: Appointment is already confirmed" from a phrase match (SC-1).
- "OUR PITCH … they have not answered it", on a lead where a customer "Stop" follows. **INFERRED**: I could not confirm
  the order of the two from the dump without quoting the thread; worth one look when the lead is open.
- `:32140` area, "Customer is driving 30-60+ minutes" (audit #1 L-5): now only in a comment. Healthy.

---

### D. Single source of truth

| Fact | Decided by (866) | One source? | Finding |
|---|---|---|---|
| **Sold / availability** (after M-2) | page banner and PageData (`inventoryWarning`), notes on this lead (`inventoryWarningFromNotes`, `vehiclePendingSale`), our own counted claim (`_lpSoldClaimCounts`), then the feed (`_lpFeedUnitCheck`), plus `_soldHard` for delivered (863) | **Yes, in the order you ruled**: a person outranks the feed. The prose regex decides nothing | Healthy. One leftover: the scenario's `isSoldDelivered` also matches prose (SC-1) |
| **Exit and opt-out** | `hasExitSignal` joins six readers (`:17197`): `exitRaw`, `boughtElsewhere`, `exitByRemoval`, two internal-note readers, bereavement. SMS evidence is separate and drives only the agent notice | One join, but the six do not share a lead scope (SC-2) and one suppressor reads our lines (SC-3) | SC-2, SC-3. `isSmsOptOut` is hard-coded `false` (`:16833`) with `smsOptOutIsExit` still in the join: dead (CN-2) |
| **Vehicle of interest** | PASS 1 lead frame only (gated since 9.7.51), then `_lpVoiIsTrade` (864), agent-declared VOI, Mastermind suggestion | Yes | Healthy. L-7's sibling-frame case stays INFERRED |
| **Appointment state** | `hasApptSet` (structured, 35 references), `hasMissedAppt` (scraper), **and** `isApptConfirmation`, `isMissedAppt` from prose | **No** | **ST-2** |
| **Lead age** | `leadAgeDays` (`null` when unknown) with one fallback | Yes on the popup side | The scraper's cutoff does not follow the same rule (SC-2) |
| **Store / rooftop** | `dealerId` → `DEALER_ID_MAP`; the dropdown for the feedback row | Identity: yes. **Hours: no** | **ST-1** |

### ST-1 — Store hours in two tables

- **Evidence (READ).** `STORE_HOURS` (`:720`, keyed by dealer ID) feeds the status line and the calendar.
  `computeAppointmentTimes(store)` (`:33583–33612`) has its own hours, keyed by whether the store **name** contains
  "audi" or "lafayette", else Baytown. The same-day cutoffs exist only in the second. Today the two agree.
- **Impact.** Change one (holiday hours, a new rooftop, a renamed store) and the prompt offers times the status line
  calls closed, or the reverse. A sixth store whose name contains neither word silently gets Baytown hours.
- **Fix.** `computeAppointmentTimes(dealerId)` reads `STORE_HOURS`; the cutoff becomes a field of that table.
- **Verify.** A suite that edits `STORE_HOURS` in the sandbox and sees the slots move.

### ST-2 — Appointment state decided four ways

`hasApptSet` is the scraper's reading of the Appointments grid and is what "a live appointment outranks everything"
should mean. `isApptConfirmation` and `isMissedAppt` are prose matches (SC-1), and `isApptConfirmation` switches the
TASK (`:33079`). Fix with SC-1: the task follows `hasApptSet`.

### ST-3 — A pause field that is never true (Low)

The scraper sets `const hasPauseSignal = false` (`:17239`). It has 20 downstream references, including 865's
`_lpColorIsLive`. Pause really arrives through `convState === 'pause'`. Either delete the field or have it mirror
`convState`; today readers that check only the field never see a pause.

---

### E. Frame / merge

- **READ:** PASS 2's gates are intact: customer-level frames cannot supply identity, vehicle, conversation or lead-state
  fields without a customer-ID match (`:21836–21870`), and key-info rows are taken or rejected with a logged reason
  (`:21885`).
- **L-7 stays open and INFERRED.** A sibling lead's frame whose own lead-ID read failed still looks customer-level. No
  incident on file. The fix is unchanged: require a lead ID on any frame donating vehicle or lead fields.
- **Co-buyer shape.** Not reproducible from the data on file (no co-buyer record among the two dumps). **Not audited.**
- **Duplicate lead IDs.** The agent-declared VOI path (`:9243–9328`) handles a customer with N duplicate leads. Not
  re-tested.
- **One new merge-side item, verified:** build 866's VIN-in-stock-field fix normalizes the stock number in
  `populateFromData`; the merge still carries the raw value between frames, which is correct (the feed is not loaded
  frame-side).

---

## Part 3 — Performance (real data)

### What an agent waits for, end to end (MEASURED)

Four `[LP GRAB TIMING]` lines, three leads, build 864/865:

| Phase | Lead 2112545296 | same, regenerate | Lead 2112149909 | Lead 2112000019 |
|---|---|---|---|---|
| pre-scrape | 9 ms | 3 ms | 4 ms | 9 ms |
| frame poll (the lead frame) | 0 ms | 2,211 ms | 0 ms | 0 ms |
| email expand | 1 ms | 0 ms | 418 ms | 358 ms |
| key-info wait | **2,027 ms** | **2,062 ms** | **2,045 ms** | **2,066 ms** |
| **frame wait, wall clock** | **4,223 ms** | **4,274 ms** | **4,261 ms** | **4,227 ms** |
| frames that waited out the 4,000 ms cap | 6 of 7 | 6 of 7 | 6 of 7 | 6 of 7 |
| scrape + merge | 96 ms | 70 ms | 121 ms | 105 ms |
| **grab total** | **4,328 ms** | **4,347 ms** | **4,386 ms** | **4,341 ms** |
| probes (not waited on) | 1,153 ms | memo | 1,431 ms | 1,151 ms |
| API (first draft) | 4,668 ms | 4,315 ms | 5,166 ms | 4,652 ms |
| text rewrite | 1,467 ms | 1,623 ms | 3,121 ms | 1,551 ms |
| **generate total** | **6,178 ms** | **5,951 ms** | **8,356 ms** | **6,236 ms** |

Fleet-wide for 11/9, from the proxy (MEASURED): full draft median 4,086 ms, P95 6,065, max 8,728 (380 requests); text
rewrite median 1,612 ms, P95 2,941 (305); fact probe median 951 ms (217).

So a typical grab-to-drafts is **about 10.5 seconds: 4.3 waiting on the page, 4.1–5.2 on the first draft, 1.5–3.1 on
the rewrite.** Prompt build is 33 ms (EXECUTED, 61-entry thread). The page wait is as long as the model call.

### PF-1 — Every grab waits 4.0 seconds for frames that have no lead

- **Severity:** High (it is ~40% of the agent's wait, on every grab)
- **Component:** the injected wait, `:20950` (the 4,000 ms cap) and `:21054–21113`
- **Evidence (READ + MEASURED).** One `executeScript` runs the wait in every frame, and its callback fires when **all**
  frames resolve. A frame with no lead markers (the top frame, ECCS, the loading frame) never becomes ready, so it
  resolves at `maxWait` = 4,000 ms. In all four samples 6 of 7 frames did exactly that, while the lead frame was ready in
  0–2.2 s. The code's own comment says "frames that don't have either marker … just wait out the maxWait timeout".
- **Fix (smallest).** Stop waiting when the lead frame is done, not when every frame is:
  - inject the wait per frame and continue on the first frame that reports both markers plus a short grace (about
    300 ms) for a second lead frame; or
  - let a frame that has neither marker after about 1 s **and** a complete document resolve early.
- **Expected gain.** Grab total from ~4.3 s to ~2.1 s with the key-info wait as it is, or ~0.5 s where PF-3 also lands.
  INFERRED from the phase numbers above, not yet measured.
- **Regression risk.** The 4-second cap exists for slow lead frames (the rims2 count = 0 race). A lead frame that shows
  its markers late must still be waited for; the first option keeps the full cap for exactly that case (no frame ready
  yet → keep waiting to 4 s).
- **Verify.** `[LP GRAB TIMING]` already reports it: "frame wait wall" falls to the slowest ready frame; "0 of N frames
  waited out the cap" on a normal grab; every field the dumps show today is still read (diff `lastScrapedData` before
  and after on the same lead).

### PF-2 — Each Grab refetches all five stores' inventory and incentives

- **Severity:** Medium (proxy load and KV reads, not agent wait)
- **Component:** `:36764–36770` (Grab), `_lpPrefetchValueFacts` (`:7137–7210`), proxy `/inventory` (`:2717–2725`)
- **Evidence (READ).** Grab calls the prefetch for every key of `DEALER_ID_MAP` with a 60-second freshness: two requests
  per store, **10 requests per grab**. The proxy answers `/inventory` with a KV read, a parse and a re-stringify of that
  store's whole feed. One store's feed is 132,239 chars in the dump; log416 shows 153–319 units per store, 1,149 units
  in all.
- **Evidence (MEASURED).** The 11/9 report: 5,454 requests, of which **4,550 are "Unknown (no START line)"**, median
  102 ms. That day had about 450 grabs (380 full drafts, 510 feedback rows). 10 × ~455 ≈ 4,550. The match is
  **INFERRED** (the proxy does not label these), but nothing else in the extension fires at that rate.
- **Who needs the other stores.** One consumer: the store-group check (`:1540`) reads sister stores' units.
- **Fix.**
  1. On Grab, refetch the lead's own store and its group's sister stores, not all five.
  2. Better: `/inventory?dealer=X&since=<generated>` answers `{unchanged:true}` when the feed has not changed (the feed
     changes a few times a day). Safe in either deploy order: an old proxy ignores `since` and returns the feed.
- **Regression risk.** `_lpInvBehindGrab` treats inventory that did not arrive during this grab as unconfirmed. An
  "unchanged" answer must count as arriving.
- **Verify.** The report's Unknown row falls by an order of magnitude; `[LP STOCK CLAIM DIAG]` still says confirmed on
  an in-stock unit grabbed twice within a minute.

### PF-3 — The key-information wait: 2 seconds, nothing found

- **Evidence (MEASURED).** All four grabs hit the 2,000 ms cap (2,027–2,066 ms). All 18 `[LP KEYINFO DIAG]` /
  `[LP AMP DIAG]` reads in logs 415–416 show **0 rows**.
- **What that does and does not prove.** Four grabs on three leads. Either these leads had no key-information rows, or
  the read is missing them again (the 807/808 shadow-root history). I cannot tell which from a log.
- **Fix.** Measure first: add the row count to `[LP GRAB TIMING]` and to the feedback row. If rows are found on a small
  share of grabs, end the wait as soon as the panel shows it is empty, or cut the cap. If rows are **never** found, the
  selector is broken again and that is the finding.
- **Detail.** While it waits, the poll walks `querySelectorAll('*')` every 150 ms to find shadow roots (`:21090`), about
  13 full-document walks per grab in the customer dashboard frame. Cache the roots after the first walk.

### PF-4 — Prompt size and cost

- **MEASURED** (two real dumps): system prompt 36,400 and 36,472 chars, identical for the first 34,561. User prompt
  **53,060 and 54,420 chars** on two ordinary leads (22 and 31 entries). Largest sections: CONTEXT & HISTORY 20–21k,
  CONVERSATION ARC 7.6–7.8k, BEFORE YOU WRITE 4.2k, TIME & DATE 3.0–3.6k.
- **The 85k outliers:** none on file. INFERRED from audit #1 (log384). Perf rows carry `userChars`; the report does not
  show its distribution (MS-1).
- **Static text below the cache breakpoint (M-9 step 1, still open).** 134 lines, **18,581 chars**, are byte-identical
  between the two dumps. Audit #1 measured 12,007 chars across six leads at three stores; two leads at one store
  overstate it. Call it **12k–18k chars, about 3–4.5k tokens, paid in full on every one of ~380 drafts a day.** The
  report's cache ceiling is 45.1%: more than half of every prompt can never be cached as it is laid out now.
- **A duplicate block, new.** The CONVERSATION ARC is the same conversation as the transcript, in the other order.
  MEASURED: 81% and 77% of the arc's 8-word runs also appear in CONTEXT & HISTORY. That is about **6k chars, 1.5k
  tokens, per draft**, sent twice.
  - **Needs your decision.** `LEADPRO_ARC_SPINE` was added so the model reads the story oldest to newest. Per "give the
    system one thing to trust", send the conversation once, in the order the model reads best. This needs a paired
    batch on live traffic; I would not change it on reasoning alone.
- **No within-prompt line duplication** otherwise (one repeated note line in one dump).
- **Fix order.** Static blocks to the system head first (no information changes), with the output-shape test; the arc
  decision second.

### PF-5 — Cache: do not partition; fix the rewrite's key

- **MEASURED** (reporter v1.25, 11/9). The full-draft key `lp_773499b2`: 380 requests, peak 7 per minute.

  | Requests per minute on the key | Minutes | Requests | Warm hits |
  |---|---|---|---|
  | 1 | 156 | 156 | 99% |
  | 2–3 | 86 | 192 | 99% |
  | 4–6 | 6 | 25 | 100% |
  | 7–10 | 1 | 7 | 100% |

  Warm rate does not fall as load rises. **Recommendation: do not partition the draft key.** The 26–40% hourly "Cache"
  figure that prompted the question mixes in every other request type; on the draft key the prefix is warm.
- **Where the cold starts are.** 335 cold starts (37% of 900 logged). The text rewrite is spread over many keys (57 keys
  labeled that day): the three largest have 25, 22 and 18 requests with warm rates of 84%, 86% and 72%, and at one
  request per minute 81%, 80% and 67%.
- **Cause (EXECUTED).** `buildSystemPromptSmsRefine("Alpha", …)` and `("Bravo", …)` differ from **character 8**: the
  prompt opens with the agent's name and store. The proxy's key hashes the first 200 characters, and the provider's
  cache is a prefix cache, so no agent can reuse another agent's 8,455-character rewrite prompt.
- **Fix.** Put the agent, store and phone at the **end** of the rewrite system prompt, as the main system prompt already
  does (its last ~1,900 chars are the persona and identity). Same length, so the `sms-refine` size test is unaffected.
- **Expected gain.** One rewrite key for the fleet, warm like the draft key: roughly 2k cached tokens on ~300 rewrites a
  day, and a faster rewrite on the cold ones. INFERRED until measured.
- **Regression risk.** Low. The rewrite's instructions do not change, only their order; run the rewrite suites and a
  paired batch.
- **Verify.** The next day's "Cache Load per Key" shows one SMS-rewrite key near 99%.

### PF-6 — The phone-ask classifier runs inline on every draft with a phone on file

- **Evidence (READ + MEASURED).** After the primary answers, the proxy runs two `gpt-4.1-mini` calls (text and email)
  and waits for both before returning (`:3009–3040`). 11/9: **302 drafts classified, 2 flagged**; "Classifier regen
  0.0%".
- **Cost.** About 600 model calls a day and their latency on every draft. The latency is **not logged**, so its size is
  INFERRED (the two calls run in parallel; a few hundred milliseconds to a second).
- **Fix.** Measure first: log the classifier's milliseconds on the FINAL line. Then choose:
  - keep it inline (if it is cheap and the two catches matter);
  - check popup-side at render, where "phone on file" and the draft text are both in hand: our own draft is ground
    truth, and a render check costs nothing; or
  - run it without blocking and only log.
- **Needs your decision** once the number is in. It also carries the Jan 14, 2027 model retirement (L-9).

### PF-7 — Timeouts and degenerate output

- **MEASURED (11/9):** one failed tier all day: PRIMARY `gpt-6-luna`, degenerate at 2,137 ms (16:00:06), recovered by
  the fallback. No timeouts. Completion 100.0%.
- **Cascade budget under an escalated regenerate (READ, unchanged from audit #1 because v7.91 is unchanged):** primary
  12,000 ms, or 18,000 ms escalated; total 24,000; after an 18,000 ms escalated timeout about 5,700 ms remain, enough
  for the fallback and not for the emergency tier. Documented in the code (`:2924–2936`). With one degenerate and no
  timeout on the day measured, I recommend no change.
- **By tier and model over more days:** not on file. The report for one day is all I have.

### PF-8 — KV read cost on dashboard calls (L-10)

Open and unchanged (READ): list a prefix, then one `get` per key. PF-2 is the larger KV cost and is measured; do PF-2
first. L-10's fix (fields as KV metadata) stands.

### PF-9 — Extension runtime

- **Repeated work in one generation (L-1), EXECUTED:** on a 61-entry thread, one prompt build calls `_lpThreadEntries`
  45 times, `_lpCustEntries` 10, `_lpOurEntries` 7, `_lpCustSignals` 8, `_lpCustomerText` 6, `_lpFeedUnitCheck` 2. One
  parse costs 0.12 ms, so all of it is about 5 ms of a 33 ms build. **This is consolidation, not a speed problem.**
- **`content.js` (M-8):** open, unchanged. Its cost is on the CRM tab, not in the panel, and is not measured by any log
  on file. INFERRED as before.
- **Panel load:** the unpacked `popup.js` is 4.6 MB; the packaged one is 1.7 MB. Parse time is not logged. Low.

### MS-1 — What cannot be measured today

1. **83% of proxy requests have no contract label** ("Unknown (no START line)", 4,550 of 5,454). The report's "all
   requests" latency (median 125 ms) and hourly cache percentages are dominated by them. Fix: a one-line START-style
   log on `/inventory`, `/valuefact`, `/feedback`, `/commit-comprehension`, `/clickpath` and license validation, and a
   row per route in the contract table.
2. **Nothing counts which directives fire.** Part 2B cannot be finished from two dumps. Fix (popup-side, behavior
   neutral): when the prompt is built, collect the labels present and send the list with the feedback row. One day of
   traffic then gives every directive's rate, its co-firing pairs, and the regenerate rate behind each.
3. **Prompt length distribution** is recorded per row (`userChars`) and not reported. Add median, P95 and max.
4. **The report's "By note type" table is all "unknown"** (256 of 256 on 11/9): a dimension that is never filled.
5. **Key-information rows found per grab** (PF-3) and **classifier milliseconds** (PF-6).

### B-2 step 2 — where the data stands

MEASURED (11/9): 850 rows, 248 usable verdicts, **5 disagreements** (4 the model saw and the pattern missed; 1 the
pattern fired and the model saw nothing), 0 fabricated quotes, Changed 0. Both readers "fired" together **zero** times;
the pattern fired once all day.

Under the decision rule in the batch 5 plan this is "too little fired data" on any one day, and a consistent direction
across the days reported (the model sees commitments the pattern misses). The five leads to read by hand:
2109282165, 2110385633, 2104815319 (twice), and 2095430382 (the pattern-only one).

**Needs your decision.** My recommendation, per your philosophy and this direction: retire the three pattern directives
and the three probes together, and put one rule per fact in the prompt ("if they named a day, offer times on that day
only"). That removes ~217 probe calls a day and one of the two readers. If the five leads show the model wrong on any,
keep the probe as the single reader for that fact instead.

---

## Part 4 — Consolidation

| ID | What can go | What replaces it | What breaks if this is wrong |
|---|---|---|---|
| CN-1 | The no-tag, no-marker walker `_lpWalkCrmEntries` (5 callers) and the inline splitters (audit #1 L-1) | `_lpThreadEntries`, memoized per text, with thin filters | The arc and the fact-probe inputs currently span prior leads on purpose or by accident; each of the 5 callers needs a fixture saying which. `_lpPricePushback` and `_lpOtdFigureSent` reading prior leads is the SC-2 class of leak |
| CN-2 | Permanently set switches and unreachable code: the three `*_AUTHORITATIVE` (false) and `_lpApplyFactOverrides`; `LEADPRO_DELIVERY_MATCH` (false); `LEADPRO_CADENCE_AUTO` (false, still observes and logs each generation); `ARC_SPINE`, `ARC_STATE`, four `*_COMPREHENSION` (true); `isSmsOptOut = false` and `smsOptOutIsExit`; `hasPauseSignal = false`; `toggleFlag('distance', true)` (`:11928`); `LEADPRO_API_KEY = ''`; `ctx.includes('No stock number or VIN')` | Plain code for the always-on ones; deletion for the always-off ones, after B-2 step 2 | A switch someone flips for a test. Keep one build with them logged before removal |
| CN-3 | Labels nothing writes: `'appointment already set'`, `'showroom stage'`, `'missed appointment'` | The fields (SC-1) | Covered in SC-1 |
| CN-4 | `content.js` beyond the beacon (M-8) | The beacon's ~100 lines | The beacon's inputs must be lifted byte-identical; the version check must still pass |
| CN-5 | Render guards that repair what our own code prints: `_lpSameDayOnce` (866) repairs the slot engine's own option format | Print both options with the same day at the source (CT-1) | Nothing, once the source is fixed; keep the guard one build as a net |
| CN-6 | Repo leftovers: a v8.46 copy of the extension at the root (`popup.js`, `content.js`, `manifest.json`, `popup.html`), 59 zips, 55 worker versions (13 MB), an empty file named `your` (a stray shell redirect from the 636 commit) | `builds/`, the newest worker, release assets | Anything that loads the root copy by mistake. Nothing in `tests/` does (they take paths as arguments) |
| CN-7 | Two store-hours tables (ST-1) | `STORE_HOURS` | Covered in ST-1 |
| CN-8 | The four-way "what the customer wants" detector (DR-1) and the concern scan's "they want" lines | One sentence each | The price-counter incident class; the visit decision's hard hold covers it |

Superseded paths confirmed gone or inert (no action): the prose sold regex (logs only), the awaited probes, the
`|| 0` lead age.

---

## Checked and healthy

1. **Audit #1 fixes hold in 866:** B-1 (executed), B-2 step 1, M-1, M-2, M-3, M-4, M-6, M-7, M-10, L-2, L-4.
2. **The packaged zips carry no key:** the only pattern hit in the zipped `auth.js` is the login placeholder.
3. **The draft cache key is not overflowing:** 99–100% warm from 1 to 7 requests a minute.
4. **Sold / availability has one order of precedence**, and the feed is last, as ruled.
5. **Current-lead helpers:** the 37 helpers built on `_lpThreadEntries` are author-tagged and sliced at the marker.
6. **No top-level function is declared twice** in `popup.js` (checked by name).
7. **Prompt build time:** 33 ms for a 61-entry thread; not where the wait is.
8. **No degenerate or timeout trend on 11/9:** one recovered primary failure in 380 drafts.
9. **Fabricated quotes from the fact probes:** 0 of 248.
10. **Frame-merge gates** for identity, vehicle, conversation and lead-state fields are intact.
11. **Dev ↔ Commercial:** every region changed in 866 is byte-identical between the builds.
12. **No line repeated within a prompt** beyond one note line, apart from the arc (PF-4).

---

## Prioritized build plan (safe batches)

Items marked **★** need your decision before they are built.

**Batch A — measurement, behavior-neutral (extension 867 + reporter v1.26, either deploy order)**
- MS-1.2: the fired-directive list on the feedback row. This unlocks Part 2B and every pruning decision after it.
- MS-1.5: key-information rows found and the classifier's milliseconds.
- MS-1.1, 1.3, 1.4: label the unlabeled routes; report `userChars`; drop or fill "By note type".
- Verify: one day of data; no prompt changes (before/after diff on every dump must be empty).

**Batch B — speed, no prompt change (extension 868)**
- PF-1: stop waiting on frames that have no lead. The largest single gain: about 2 seconds per grab.
- PF-3: end the key-information wait early, per Batch A's number; cache the shadow roots.
- PF-2 step 1: refetch only the lead's store and its sister stores on Grab.
- PF-5: agent, store and phone to the end of the rewrite system prompt.
- Verify: `[LP GRAB TIMING]` before and after on the same leads; `lastScrapedData` identical field for field.

**Batch C — scope, small diffs with fixtures (extension 869)**
- SC-1: the ten flags read their fields. ★ Delete `isApptConfirmation`, or point it at `hasApptSet`?
- ST-2 (with SC-1), SC-3, ST-3.
- SC-2: the marker's time as the scraper's cutoff; 855's rule for every exit path when the start is unknown.
- Each with executed fixtures from this report and the before/after diff on every dump.

**Batch D — one clock (extension 870)**
- ★ CT-1: the last same-day offer time and the notice required. One rule.
- ST-1: `computeAppointmentTimes` reads `STORE_HOURS`.
- CN-5: both options printed with their day.

**Batch E — fewer directives (extension 871+, one family per build, each ★)**
- DR-1: the "what the customer wants" detector → one sentence.
- CT-2: one "this message is about" line; the other blocks keep their facts and lose their "lead with".
- B-2 step 2: after you read the five leads.
- The concern scan's "they want" lines.
- Each needs the paired live batch; Batch A's data picks the order.

**Batch F — prompt cost (after E, so text is not moved twice)**
- PF-4: static blocks to the system head. ★ The arc and the transcript: send the conversation once?
- PF-6 ★: the classifier's place, per its measured cost.

**Batch G — proxy and housekeeping, independent**
- PF-2 step 2 (`since=`), L-10 (KV metadata), L-9 (the Jan 14, 2027 retirement).
- CN-2, CN-4, CN-6, L-8.

**Still yours, unchanged:** C-1 (revoke and reissue the key), B-3 (`REQUIRE_LICENSE`).

**Not audited, said plainly:** the co-buyer merge shape; Data Tool date ranges (M-5); `content.js` CPU on the CRM tab;
timeouts by tier over more than one day; anything that needs the 117 dumps that are no longer on file.
