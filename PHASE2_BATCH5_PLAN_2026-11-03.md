# Lead Pro — Phase 2, Batch 5 plan (plan only; nothing here is built)

From `AUDIT_2026-11-03_FULL_SYSTEM.md`, as scoped by the owner's Phase 2 brief. Every line number below is in the 9.7.851
`builds/dev/popup.js`. Commercial matches it below line 1. Lead IDs only; no customer details.

The measurements below were run in a sandbox against the shipped code. Two corrections to the audit came out of them, and
each section names its own:

- **L-4:** "please stop texting me" does **not** become an exit today. The real gaps are different phrases (see L-4).
- **M-2:** the feed **already overrides** two kinds of "sold" evidence today, which is the opposite of the rule you set.

---

## M-1 — `leadAgeDays` is `null` when it is unknown

**Where unknown starts:** the scraper (`:13000–13022`) sets `leadAgeDays = 0` and `_leadAgeScraped = false` when neither the
Created text nor PageData `LeadCreatedUTC` can be read. It logs `[LP AGE DIAG] … treating age as UNKNOWN, not 0`. Every
reader then sees 0, which also means "submitted today".

**The change:**

- The scraper returns `null` when `_leadAgeScraped` is false.
- The two transcript fallbacks (`populateFromData :8061`, `generateAll :32715`) keep their `Created (Nd)` match.
- **Owner call needed:** the fallbacks' second rule, "oldest dated note = lead age", reads the oldest note on the
  *customer*. That includes prior leads, so it overstates a returning customer's age. I propose keeping only the
  `Created (Nd)` match and leaving the age `null` otherwise. That is your call.
- The payload (`:33091`) carries `null` through instead of `|| 0`.

**Every consumer, and how it handles `null`.** "Today" is what it does when it reads 0 for unknown. "Plan" is what it must do
with `null`.

| Line | Reader | Today (unknown → 0) | Plan (`null`) |
|---|---|---|---|
| 1518 | `_lpReachedRecently` | reads `leadAgeDaysForFatigue`, already null-safe | no change |
| 3979 | `_lpBuildArcState` | `parseFloat(x \|\| 0) \|\| 0` → age 0 | carry `null`. The arc's age-based wording says nothing when unknown |
| 4161 | `_lpComputeCadenceTouch` | `!(age > 0)` → "lead age unknown — no touch" (0 and NaN alike) | already correct for `null`. Add a fixture |
| 4241 | `_lpCadenceByCalendar` | `!(age > 0)` → "lead age unknown" | already correct for `null`. Add a fixture |
| 4298 | `_lpCadence` (deps) | `parseFloat(x) \|\| 0` → 0 | pass NaN/`null` through to 4322 |
| 5501 | `_lpStalledCalendarRung` | NaN → rung 1 | already correct |
| 5656 | `_lpCloseOutEligible` | NaN → not eligible | already correct |
| 5707 | `_lpResolveDirectorMode` | `\|\| 0` → 0 | treat `null` as "not fresh, not old": no age-driven mode |
| 7605 | `_lpMissedApptIsPrior` | NaN → falls back to fatigue age | already correct |
| 8378 | appointment age (`populateFromData`) | `\|\| 0` → 0 | `null`: no same-day appointment framing from age |
| 10002 | incentive age | `\|\| 0` → 0 | `null`: no "just submitted" incentive framing |
| 10575 | `(x \|\| 0) === 0` branch | **treated as submitted today** | `null` takes the not-today branch |
| 10958 | `(x \|\| 0) >= 2` | false | `null` → false (same result, now explicit) |
| 10969 | fresh-lead guard `ageDays` | **0 zeroes the staleness signals** | `null`: the guard does not run |
| 11025 | `isNewLeadToday` | **true for unknown** | `null` → false |
| 15685 | `hasNewLeadToday` (scraper) | already requires `_leadAgeScraped` | no change |
| 20938 | frame merge (lead-state fields) | each frame reports 0 for unknown, so frames cannot be told apart | a frame with a number wins over a frame with `null`. Fixture: one frame unknown, one known |
| 22569 | `classifyScenario` `ageDays` | 0 | `null`: age-based scenario flags off |
| 25617 | `_lpApptEngineOff` (≥31) | false | false (same) |
| 26274 | Mastermind days old | 0 | `null`: omit the days-old clause |
| 27838 | promo age | 0 | `null`: promo age rules do not fire |
| 28897–28903 | SITUATION "N attempts over D days" | gated on age ≥ 2, so off | same (gate stays) |
| 29026 | **`LEAD AGE:` line** | **"submitted today"** | `null`: the line is left out. Proposed: print nothing; the model reads the dated transcript |
| 29513 | `_lad` | 0 | `null` path: no age-tier wording |
| 29937 | acknowledgment age | 0 | `null`: no "thanks for reaching out today" |
| 30129 | `_asFresh` (≤ 1) | **true for unknown** | `null` → false |
| 30285, 30365 | one-sided gate (age ≥ 3) | false | same |
| 31136 | diag | prints 0 | prints `unknown` |
| 31559 | `scrapedAge` | 0 | `null` |
| 31589 | stalled rung `_rgAgeRaw` | `null !== undefined` → `parseFloat(null)` = NaN → unknown | already correct |
| 33121, 33682 | dump inputs, signal age | 0 | `null` |
| 35937, 35953 | feedback meta | 0 | `null`. The gatherer already prints `?` for null. Reporter: check the by-age tables bucket `null` as "unknown" |

**Risk:** the five bold rows (10575, 10969, 11025, 29026, 30129) are where unknown becomes "fresh". That is the behavior M-1
removes; every other row is arithmetic that already handles NaN or is gated off.

**Tests:**

- An executed suite through the panel payload with the age unset: no "submitted today", no fresh-lead guard, no
  `isNewLeadToday`.
- A control with the age set to 0 that came from a real scraped `Created (0d)`: "submitted today" is still printed.
- The cadence, stalled and close-out suites run with `null`.

---

## M-2 — Retire the prose "sold" regex. The feed never outranks a person who said sold, deposit or pending

### What the code does today (measured)

`classifyScenario :23038`:

```
vehicleSold = !inTransit && !data._lpInvConfirmedAvailable && … && (
  ctx.includes('vehicle status: sold')            // Lead Pro's own SOLD line (built from inventoryWarning)
  || /the vehicle … sold|vehicle sold|that (car|vehicle|unit) … sold|sorry.*…sold|unfortunately.*sold|no longer available/i.test(transcript))
```

`_lpInvConfirmedAvailable` (`:9477–9488`) is computed only when there is no page warning and no General/Vehicle note saying
sold. Those two kinds of evidence therefore already win over the feed. Two do not:

1. **Our own outbound text** ("that one has sold") is not a General Note, so only the prose regex sees it. That regex is
   switched off whenever the feed lists the unit (`!data._lpInvConfirmedAvailable`). **Today the feed overrides it.**
2. **A deposit is not detected at all.** `vehiclePendingSale` (`:14116`) matches "being sold", "pending sale", "sold
   pending" and "may be sold", and only in notes titled General Note or Vehicle. "Customer put a deposit on it" in a
   General Note, or "pending funding" in a call note, reads as nothing. The feed then says available.

The prose regex also reads the whole fenced transcript, prior leads included, with no check of which vehicle the sentence
is about.

### The change

| Evidence | Source of truth | Outranks the feed? |
|---|---|---|
| Live page banner / PageData status (inventory warning) | `inventoryWarning`, `_pdInventoryWarning` | **Yes** (already) |
| An agent's note on the **current lead**: sold, deposit, pending, spoken for, on hold | `inventoryWarningFromNotes` / `vehiclePendingSale`, widened (below) | **Yes**. Already true for sold notes; new for deposit/pending |
| What **we told them**, on this lead: sold / not in stock | `selfClaims` (`WE SAID IT SOLD`, `WE SAID IT IS NOT IN STOCK`) | **Yes**. New: today the feed wins |
| The live inventory feed / VinSolutions active status | `_lpInvConfirmedAvailable` | Only when none of the above exist |
| Prose anywhere in the transcript ("no longer available", "unfortunately … sold") | **removed** | — |

How the note readers change:

- The note scan takes any note type on the current lead (call notes included), not only General/Vehicle titles. It stays
  scoped to notes above the current-lead marker.
- Pending gains `deposit (placed|put|taken|on it)`, `spoken for`, `on hold for`, `pending (funding|approval|delivery)` and
  `customer is buying`.
- The **newest** human statement wins between them. A later note "deal fell through, back on the lot" clears an earlier
  "deposit". That needs a back-available pattern (`fell through|back (on|in) (the )?(lot|stock|inventory)|available again`).

### How the prompt presents it (the part you asked to see before anything is built)

**Case A: the feed lists it, and a newer agent note says deposit.** Placeholder data.

```
VEHICLE ON LEAD: 2024 Honda CR-V LX — SPOKEN FOR (see INVENTORY STATUS). Name it to the customer by year/make/model ("2024 Honda CR-V LX"). Stock #TEST0H1 is an INTERNAL identifier for matching only — NEVER put a stock number in a customer-facing message.
🟠 INVENTORY STATUS — A PERSON AT THE STORE SAYS THIS UNIT IS SPOKEN FOR, AND THAT OUTRANKS THE FEED:
  • 11/03 10:14 AM, Rep Name's note on this lead: "customer put a deposit on it, pending funding".
  • The inventory feed still lists it as available. The feed can lag a recent sale or deposit by a day or more, so it does not override a person who has the deal in front of them.
  • Do not tell the customer it is available, here, or ready to see, and do not offer times to see this unit. Do not say it sold either: a deposit is not a sale. If they ask, it is being held for another customer right now; offer to let them know if that changes, and lead with what you do have.
```

**Case B: the feed lists it, and our own text on this lead told them it sold.**

```
VEHICLE ON LEAD: 2024 Honda CR-V LX — SOLD per our own message on this lead (see INVENTORY STATUS). …
🔴 INVENTORY STATUS — WE ALREADY TOLD THIS CUSTOMER IT SOLD, AND THAT OUTRANKS THE FEED:
  • [2026-11-03] WE SAID IT SOLD: "that one has sold, but I have two similar ones…"
  • The inventory feed still lists it as available. The feed can lag a recent sale, so it does not override what we told them.
  • Do not re-announce the sale (they were told) and do not write as though it is available. Continue from what we offered instead.
```

**Case C: the feed lists it, and nothing human says otherwise (today's behavior, unchanged).**

```
VEHICLE ON LEAD: 2024 Honda CR-V LX — confirmed in stock. …
```

**Case D: the feed does not list it, and nothing human says sold.** Unchanged:
`— NOT confirmed available … Do NOT tell the customer it is here`. It never says "sold". The prose regex is what used to
turn this case into SOLD.

**Case E: "that car has sold" sits on a prior lead, below the current-lead marker.** Not sold. It is history; the model
reads it in the transcript.

**Case F: "the 4:00 slot is no longer available."** Not sold. This is the regex's best-known false positive, and it goes
with the regex.

### Diagnostics

`[LP SOLD SIGNAL DIAG]` names which row of the table decided, with the note date and the quoted words. When a human
statement and the feed disagree it adds one line: `feed says available, <who> on <date> says <sold|deposit|pending> — the
person wins`.

### Tests

- Fixtures A–F as executed prompt assertions through the panel payload.
- The audit's three, which are E, F and "our own current-lead 'that one has sold' → WE SAID IT SOLD".
- "Deal fell through" after a deposit → available again.
- Controls: the Audi all-available policy and the customer's own vehicle (`_lpVoiIsPriorSale`) are unchanged.

---

## M-3 — The payload carries `history`

**Change:** `_lpPromptInputData` (`:32817`) gains `history: lastScrapedData.history`. Then the 14 helpers that read
`d.history || d.context` read the raw transcript on the panel too, as the rewrite and render checks already do:

- `_lpThreadEntries`, `_lpOurEntries`, `_lpCustEntries`
- `_lpLastCall`, `_lpStopIsCurrent`, `_lpPitchOut`, `_lpReactivated`, `_lpNewestNote`
- `_lpOtdAsk`, `_lpCallWants`, `_lpApprovalFirst`, `_lpLeadHasContact`, `_lpCustomerStateHold`
- `_lpMmSuggestedVoi` (history only)

### Before/after on the 11/2 dumps (measured, sandbox, 9.7.851 code)

Each dump's `lastScrapedData` went through `populateFromData` and `buildUserPrompt` via the shipped panel payload, at the
dump's own timestamp. The prompt was built twice: once as shipped, and once with `history` added.

| Lead | Dealer | history chars | Prompt (as shipped → with history) | Changed lines |
|---|---|---|---|---|
| 2108628902 | 6189 | 3,692 | 33,348 → 33,348 | **0** |
| 2108537212 | 6190 | 3,669 | 36,589 → 36,589 | **0** |
| 2107319795 | 24399 | 1,442 | 26,719 → 26,719 | **0** |
| 2108597971 | 6190 | 3,800 | 31,502 → 31,502 | **0** |
| 2108726978 | 6189 | 1,922 | 28,548 → 28,548 | **0** |

**Non-vacuity of the measurement:** the same run with a deliberately different `history` (a lone current-lead "STOP")
changes 13, 8, 4, 6 and 1 lines. The payload field is read, and on these five leads the raw transcript and the panel's
`leadContext` lead every helper to the same verdict.

**Caveat:** the rebuilt prompts are not byte-identical to the dumped ones, because the sandbox does not load inventory or
the click path. The comparison is between the two rebuilds, so it isolates `history`.

**So:**

- On real 11/2 traffic, M-3 changes no prompt. Its value is that the prompt and the guards can no longer disagree, and that
  `_lpMmSuggestedVoi` stops getting `''`.
- The risk named in the audit (helpers that only work because the AGENT CONTEXT header repeats a call note) does not show
  up on these five.
- The build still runs every 8xx suite with `history` in the payload, and repeats this diff on every dump on file
  (not only 11/2) as its verification.

---

## B-2 step 2 — Regex or model, per fact (after a week of 9.7.851 data)

**The week starts when 9.7.851 is the fleet build.** The reporter's version table shows when that is.

**What the week produces:**

- Reporter v1.25's comprehension section, per detector:
  - rows and lead+detector pairs;
  - agree, and disagree in both directions (regex-only = the regex fired and the model did not; comprehension-only = the
    reverse);
  - fabricated quotes;
  - Changed, which must read 0 with the switches off.
- The Disagreements table gives lead IDs to open by hand.
- `[LP GRAB TIMING]` gives the latency we got back.

**Decision rule, per fact, leaning toward the model as you asked:**

1. Read every disagreement pair, by lead ID. A regex-only pair the notes don't support is a regex false positive (the 9/1
   shape). A comprehension-only pair the notes do support is a regex miss.
2. **Model wins** if the regex shows any false positive the model got right, or if there are no disagreements at all.
   Equal accuracy goes to the model, because it removes a reader.
   - *Model* means: drop the regex directive, and let the main generation read the transcript under one prompt rule per fact.
   - Day-lock example: "If the customer named a day, offer times on that day only."
   - The fact probe is then retired too, unless a disagreement showed the main model missing a fact the probe caught. Only
     then does the probe stay, as the reader, and it is awaited for that one fact.
3. **Regex stays** only if the model shows a false positive the regex got right, or fabricates a quote.
4. **Too little data:** fewer than about 20 fired pairs for a detector in the week (likely for day-lock and off-franchise;
   most rows are AGREE-NONE). That detector's decision waits another week rather than being decided on silence.

**What I will bring you:**

- one table per fact: pairs, disagreements by direction with lead IDs and my reading of each, fabricated quotes,
  recommendation;
- the prompt rule text that would replace each regex directive.

---

## L-4 — "Stop texting me" is a channel preference; only "stop contacting me" is an exit

### What the code does today (measured, shipped regexes)

Since v9.7.696 `isSmsOptOut` is `false` on every lead (`:15985`), so `smsOptOutIsExit` is never true and no opt-out wording
reaches an exit through that path. The audit's "please stop texting me escalates to exit" is stale. The SMS channel is
decided by `smsOptOutEvidence` (current-lead scoped, `:15896–15975`); the exit by `exitRaw` (`:16087`, customer lines only).

| Customer wrote | SMS suppressed today | Exit today | Wanted |
|---|---|---|---|
| "please stop texting me" | yes (`_ssAskStopRe`) | no | SMS off, email proceeds ✓ |
| "no more texts" | yes | no | ✓ |
| "don't text me, email is fine" | **no** | no | **SMS off**, email proceeds |
| "stop contacting me" | no | yes (`stop.*contacting`) | exit ✓ |
| "leave me alone" | no | **no** | **exit** |
| "take me off your list" | no | **no** (`remove.*from.*list` only) | **exit** |
| "not interested" | no | **no** (only "not interested in (the car\|…)") | **exit** |
| bare "STOP" | yes | no | unchanged ✓ |

### The change

- **Channel:** `_ssAskStopRe` gains `don'?t text|do not text|no (more )?texting|quit texting|stop (sending )?(me )?texts?`
  (as a request, not a mention: "you don't text back fast" stays out). It stays current-lead scoped, so prior-lead wording
  is superseded as today.
- **Exit:** `exitRaw` gains `leave me alone`, `take me off (your|the) (list|contact list|mailing list)` and a bounded bare
  `not interested`. Bounded means the message, or a clause, is "not interested" with nothing after it but
  `anymore|thanks|thank you|at this time|right now`.
- "not interested in financing" / "not interested in the red one" stay out. They are preferences, not exits, and are
  fixtures.

### Fixtures (executed through the scraper's real evidence and exit code, as the v9.7.534 suite does)

- **SMS suppressed + email proceeds:** "please stop texting me", "no more texts", "don't text me, email is fine".
- **Exit, unchanged:** "stop contacting me", "please remove me from your list".
- **Exit, new:** "leave me alone", "take me off your list", "not interested".
- **Not an exit:** "not interested in financing, I'll pay cash", "not interested in the red one".
- **Unchanged shapes:**
  - bare STOP (SMS off, no exit);
  - a current-lead STOP followed by a vehicle question (the v9.7.792/793 shape: SMS off, no farewell);
  - a prior-lead opt-out superseded by a new lead (the v9.7.518 incident shape: SMS restored, no farewell);
  - the `hasRecentReoptIn` restore path (an opt-in note after the STOP re-enables SMS).

### SMS is never re-enabled on any path (the v9.7.534 differential)

- Generate the shape matrix: wording × current/prior lead × re-opt-in before/after × new lead today × bare/written.
- Run it through the 9.7.851 build and the candidate, and assert that **every shape suppressed by 851 is still suppressed**.
- The only allowed differences are suppressed-where-851-was-not ("don't text me") and exit-where-851-was-not (the three new
  exit phrases).
- Print the full difference list for review, as v9.7.534 did.

---

## Order and size

Suggested build order, smallest blast radius first:

1. L-4: one regex each side, plus the differential.
2. M-3: the measured no-op on 11/2, plus suite runs.
3. M-1: about 30 readers, five behavioral.
4. M-2: the prompt change, after you approve the presentation above.

B-2 step 2 is a decision memo after the data week, not a build.
