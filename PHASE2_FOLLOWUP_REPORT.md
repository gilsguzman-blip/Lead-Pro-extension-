# Lead Pro: Phase 2 follow-up report

Builds v9.7.702 to v9.7.704 (DEV and COMMERCIAL paired), branch `claude/audi-honda-brand-mismatch-ybifph`.
Extension only. Proxy v7.76 and reporter v1.22 were not changed.
Leads are cited by log or capture id only. Where a log holds several leads, `#n` is the order in which the lead first appears in that log (by the panel's active lead id); the same lead keeps the same `#n` throughout.

## Item 1: Worker cache numbers for M4 (report only)

**There is no "after" traffic to measure yet.** The three Worker log exports cover 9/11 15:01 to 9/17 21:42 UTC. M4 shipped in v9.7.700 on 9/23. All 94 primary-tier draft calls in the exports are "before" calls, and none has `sysChars` of 30k or more.

Draft calls only (cache key `lp_773499b2`); the probe and classifier keys are excluded.

| | Before M4 (`sysChars` 20–25k) | After M4 (`sysChars` about 32.5k) |
|---|---|---|
| Calls | 94 | **0** |
| Cached input tokens, median / mean | 3,993 / 4,194 | — |
| Uncached input tokens, median / mean | 11,777 / 11,383 | — |
| Output tokens | not in the Worker logs; 479 used (harness median) | — |
| Primary-tier cache hit rate | 93 of 94 (cached > 0); 28.4% of prompt tokens cached on average | — |
| Cost per call, mean (median) | $0.00294 ($0.00302) | — |
| Cost per 1,000 calls | $2.94 (input $2.36, output $0.57) | — |

**Rates used** (primary model gpt-5.6-luna, per 1M tokens, from the OpenAI model page, developers.openai.com/api/docs/models/gpt-5.6-luna):
- $0.20 input
- $0.02 cached input
- $0.25 cache write
- $1.20 output

These calls are well under the 272K-token long-context tier.

**Before-side cache misses.**
- Only 1 of 94: export 3742498d, 9/17 21:09 UTC. It wrote 5,053 tokens to the cache, and the next call using that prefix, at 21:12, hit all 5,053.
- The calls around it were caching 4,385 tokens under the same key, so two different cached prefixes existed at once.
- The pre-M4 static head therefore varied by persona or store, and the first call of a new variant paid a cache write.

**After M4, the head does not vary.** The cached head above `⟦LP_CACHE_BREAKPOINT⟧` is byte-identical across all 5 personas × 5 stores (checked on all 50 combinations; `step5-700` asserts it across the five personas). No bug to report.

**Projection, not a measurement.** If the roughly 1,900 tokens M4 moved are read from cache on every call, the saving is about $0.00034 per call, or $0.34 per 1,000.

**What's needed to measure it:**
- A Worker log export of fleet traffic on v9.7.700 or later, with at least about 100 draft calls where `sysChars` is 30k or more (a day or two of normal use).
- Optionally, the harness window on 9/23 from 17:24 to 17:36 UTC. Only the a24e7a8c pair in that window carried the real v9.7.700 head.
- Output tokens are not logged by the Worker. For a measured output figure, add `usage.output_tokens` to the `CACHE` line in v7.77.

## Item 2: N1 and H5 threshold impact (report only)

**Where the data comes from.**
- Channel fatigue and one-sided are replayed from the 52 logs. 131 of the 141 generations (49 logs, 70 leads) log the inputs these rules need; the other 10 generations are from logs that predate the outreach-count diagnostic.
- Hang-up and zero-contact depend on inputs the logs don't record, so they are counted on the 50 full-prompt captures.

**Correction to my Phase 2 report.** Section 4 said all four rules now need a lead at least 3 days old. That was wrong:
- N1 (the 3-day minimum and the lead-bounded streak) applies only to channel fatigue and one-sided.
- H5 moved hang-up and zero-contact onto the real outreach count. Zero-contact keeps its own 2-day minimum.

**Fire counts by build:**

| Rule | Pre-H5 | H5 only | Current (H5 + N1) |
|---|---|---|---|
| Hang-up (50 captures) | 1 | 1 | 1 (816dd801, checked by hand) |
| Zero-contact SITUATION (50 captures) | 10 | 10 | 10 |
| Channel fatigue (131 generations) | 59 | 59 | 48 |
| One-sided (131 generations) | 24 | 24 | 21 |

- **H5 changed no firing count on this data.** It changed the numbers the prompt displays: for example, the 55-day Kia Baytown lead reads 23 lead outreaches instead of 31 notes, and 5100d637 reads 13 instead of 20. Every zero-contact lead was still over the threshold.
- **N1 removed 11 fatigue firings and 3 one-sided firings.**

**Every lead where a rule stopped firing** (one generation each):

| Log | Rule | Lead age | True outreach on the lead | What the prompt gives instead |
|---|---|---|---|---|
| 0c3b3001 #4 | one-sided | unknown | 9 | VARY YOUR ANGLE only (or the stalled-phase block, where it owns the lead). **Flag** |
| 88613535 #4 | one-sided | unknown | 10 | VARY YOUR ANGLE only (or the stalled-phase block, where it owns the lead). **Flag** |
| 74860a66 #4 | one-sided | 1d | 14 | VARY YOUR ANGLE (or the stalled-phase block), plus the young-lead line below |
| 0c3b3001 #5 | fatigue | 1d | 3 (6 on the whole record) | "3 outbound messages on this lead with no reply yet — on a lead this young that is our cadence running, not the customer going cold." |
| 1b4bfd9f #3 | fatigue | 1d | 5 | Same young-lead line (5) |
| ac9d9aaf #4 (same lead as 1b4bfd9f #3) | fatigue | 1d | 5 | Same young-lead line (5) |
| 61c8cb58 #4 | fatigue | 1d | 7 | Same young-lead line (7) |
| 74860a66 #3 | fatigue | 1d | 4 | Same young-lead line (4) |
| 74860a66 #4 | fatigue | 1d | 14 | Same young-lead line (14) |
| 9a9de264 #2 | fatigue | 1d | 3 (7 on the whole record) | Same young-lead line (3) |
| 9a9de264 #3 | fatigue | 1d | 13 (streak 4) | Same young-lead line (4) |
| 9a9de264 #4 (capture 634c4a67) | fatigue | 2d | 10 | Same young-lead line (10) |
| f7873f6b #1 | fatigue | 1d | 7 | Same young-lead line (7) |
| fac92efa #3 | fatigue | unknown | 2 (streak 21 on the whole record) | Nothing. The 21-message streak was earlier leads on the same customer |

**Should any still have fired?**
- **Yes, probably the two flagged rows.** One-sided reads unknown age as 0 days, so it never fires when the age is missing. Channel fatigue treats unknown age as old enough. A lead with 9 or 10 unanswered outreaches and no known age is exactly where the one-sided directive belongs.
- The fix is one line (treat unknown age as old enough, as fatigue does). I left it alone because this item was report-only.
- **The other twelve are what N1 intended.** They are 1–2-day leads where the streak is our own cadence, plus one case where the whole customer record inflated the streak.

## Item 3: calendar check for the stalled-lead rungs (v9.7.702)

### The bands, chosen before looking at the numbers

The rung is the **lower** of the count rung and the calendar rung. The count thresholds are unchanged: 1 / 2 / 3 / 4 / 5 or more texts and emails on this lead.

The calendar bands follow the lead-age phases the prompt already states (TOUCH POSITION: first touch 0–1, engagement 2–7, persistence 8–30, reactivation 31+). That way a rung never speaks to a silence that the phase line in the same prompt says hasn't happened yet.

| Rung | Earliest day | Why |
|---|---|---|
| 1 VALUE / OPTIONS | 0 | Useful information needs no history |
| 2 MICRO QUESTION | 2 | Engagement phase |
| 3 TIMING CHECK | 8 | Persistence phase. "Acknowledge their silence" needs a week of it |
| 4 PATTERN INTERRUPT | 15 | The cadence's day-15 touch, after which its spacing widens |
| 5 GRACEFUL CLOSE-OUT | 21 | Your existing close-out rule (21 days and 5 outreaches) |

- **Why rung 5 starts at day 21, not 31.** Day 31 would have lined up with the reactivation phase, but it would have taken the close-out away from leads aged 21 to 30 days. That is a close-out routing change, which this item rules out. At day 21, the calendar can never change who is closed out: rung 5's calendar floor is the same as the resolver's floor.
- **Lead age source.** `data.leadAgeDays`, the scraped value P6 reads.
- **Unknown age** (missing, 0, or not a number) gives rung 1.
- **A customer's own exit or pause is not capped.** The resolver lets it win at any age, and so does the calendar.
- **Diagnostic.** `[LP STALLED RUNG DIAG]` logs, in the panel, the outreach count (texts and emails), lead age, count rung, calendar rung, final rung, and why the rung was capped.

### Rung deltas on the 52 logs

- **Totals.** 24 generations reached the stalled ladder. They belong to **8 distinct leads**, and **7 change rung**.
- **Correction to Phase 2.** The Phase 2 report said 10 leads, because it counted a generation with no lead id as a separate lead. Keyed by the panel's active lead id, it is 8.

| Log | Store | Lead age | Touches | Before | After |
|---|---|---|---|---|---|
| 9a9de264 #4 (capture 634c4a67, dump a24e7a8c) | Audi Lafayette | 2d | 8 | PHASE 4 | **PHASE 2** |
| 8ac9e0ed #4 | Audi Lafayette | 4d | 7 | PHASE 4 | **PHASE 2** |
| 8ac9e0ed #5 = b5a89316 #3 (3 generations there) | Audi Lafayette | 4d | 6 | PHASE 4 | **PHASE 2** |
| 8ac9e0ed #2 | Audi Lafayette | 6d | 6 | PHASE 4 | **PHASE 2** |
| 8ac9e0ed #1 | Audi Lafayette | 7d | 11 | PHASE 4 | **PHASE 2** |
| fac92efa #2 (2 generations) | Honda Lafayette | 8d | 14 | PHASE 4 | **PHASE 3** |
| fac92efa #1 | Honda Lafayette | 9d | 13 | PHASE 4 | **PHASE 3** |
| 066b03c1 and 6 other logs (13 generations) | Kia Baytown | 55d | 9 | PHASE 5 | PHASE 5 (unchanged) |

**The six top-rung rows aged 7 days or less** (9a9de264 #4, 8ac9e0ed #1, #2, #4 and #5, b5a89316 #3) all move from PHASE 4 to PHASE 2. They are five distinct leads, because 8ac9e0ed #5 and b5a89316 #3 are the same lead. Why none of them got the close-out before:
- **Before v9.7.702:** at the top rung, but the v9.7.595 gate had already stripped the close-out, so they got the no-exit PHASE 4.
- **Now:** a micro question.

### Paired drafts

- 5 leads, each run twice before and twice after with the sides alternated: 20 calls.
- 19 returned on the primary tier. One "before" call for the Kia pair came back on the fallback model and is excluded.
- Only Audi Lafayette leads have a real prompt: the capture or dump for 634c4a67/a24e7a8c and 5100d637. The Honda Lafayette leads that moved have no capture.
- So three pairs are **synthetic**. Each uses a logged shape on another store with a placeholder customer, and is labelled as such.

**a24e7a8c, Audi Lafayette. Real, rebuilt by code on both builds. 2 days, 8 touches. PHASE 4 → PHASE 2.**
- **Before:**
  - One draft opened with "I know you've had a few messages about…" and asked "Would you like to come take a look?"
  - The other offered a menu ("space, mileage, or features?").
- **After:** both drafts were one light question ("has your timing changed?" / "did your timeline change?").
- **Verdict:** fits better. Two days in, "I know you've had a few messages" and a visit ask both read as if the customer had gone quiet on us.
- **One mismatch:** "did your timeline change?" is an odd question two days after an inquiry. See the note after the pairs.

**5100d637, Audi Lafayette. Real capture from 9/11; only the two rung lines swapped. 4 days, 6 touches. PHASE 4 → PHASE 2.**
- **Before:** both SMS opened "I realize we haven't connected yet".
- **After:** the SMS asked a small question with no reference to the silence ("Would a few additional photos answer what you need to know?" / "Is there one detail you'd like clarified?").
- **Verdict:** fits better for 4 days.
- **Not caused by the rung:**
  - The emails kept "we haven't connected yet", which comes from the capture's old zero-contact block.
  - One draft on each side mentioned the customer's home state. This 9/11 capture predates the distance rule.

**Synthetic (the fac92efa #2 shape), Honda Lafayette. 8 days, 14 touches. PHASE 4 → PHASE 3.**
- **Before:** both drafts asked which color to check.
- **After:** both named the silence ("I know I've sent a few notes about the CR-V without hearing back. Did your timeline shift, or have you just been busy?").
- **Verdict:** fits. After a week and 14 touches, acknowledging the silence is honest. It's the one pair where the new rung clearly changes the voice.

**Synthetic (the 8ac9e0ed #1 shape), Toyota Baytown. 7 days, 11 touches. PHASE 4 → PHASE 2.**
- **Before:** a color question.
- **After:** "new only, or would you consider pre-owned too?" / "did your timeline change?".
- **Verdict:** about the same. Both are light and neither mentions the silence. The v9.7.595 gate had already made the old PHASE 4 gentle.

**Synthetic (the 8ac9e0ed #4 shape), Kia Baytown. 4 days, 7 touches. PHASE 4 → PHASE 2.**
- **Before:** a color question (the primary-tier draft).
- **After:** "Has your timing changed, or are you mainly comparing options right now?" / "set on the EX, or would another Sorento trim work?".
- **Verdict:** about the same.

**Overall:**
- The calendar matters most at the edges: a 2-day lead no longer reads as a lapsed one, and an 8-to-9-day lead now gets its silence acknowledged.
- On 4-to-7-day leads the drafts were already gentle, because the v9.7.595 gate had removed the close-out wording, so the change is mostly in which question is asked.
- 4 of the 8 PHASE 2 drafts used the rung's own example "Did your timeline change?", which is a strange question for a 2-to-4-day lead. **Changed in v9.7.703**, below.

### No other routing changes

v9.7.701 was compared with v9.7.702 on the Audi Lafayette dump, and on 420 synthetic stalled leads across all five stores (ages from unknown to 55 days, 1 to 13 touches):

- **Prompt text:** every line other than the phase name and the `YOUR APPROACH` line is identical.
- **Logs:** every log line outside the stalled ladder is identical. That covers `classifyScenario`, the persona resolver, director check, source acknowledgement, `isZeroContactStalled`, close-out gate, distance, outreach count, anti-restate, stuck-choice, VOI family, pivot scope and window, and phone.
- **P6 cadence:** computed after the prompt, from the prompt text. Its result and `[LP CADENCE DIAG]` line are identical on 200 of 200 leads and on the dump.
- **Diff on the dump:** only the phase name, the approach line, and the diagnostic lines that name the phase.

### Tests

- **New `stalled-rung-702.test.js`:** 26 checks per build, 52 total. It runs `_lpStalledCalendarRung` and `buildUserPrompt` on synthetic stalled leads and reads the rendered phase and the new diagnostic.
- **Non-vacuity:** run against v9.7.701, 20 of 26 fail. The 6 that pass are labelled controls: the unchanged touch count, the day-16 lead the resolver already held at PHASE 4, and leads where the count rung is already the lower one.
- **`stalled-phase.test.js`:** 5 assertions changed on purpose.
  - The 4-day lead is now PHASE 2.
  - The no-exit PHASE 4 gate is pinned on an 18-day lead.
  - The v9.7.583 "observation only" check is inverted, because the flag now acts.
- **Harness updates:** `refine-prohibitions` and `stalled-phase` now load the new helper.
- **run-all:** 125 suites, **5,978 assertions, 0 failed** (5,926 at v9.7.701).
- **Build checks:**
  - `node --check` is clean on both builds.
  - Both manifests parse, with `version` and `version_name` bumped.
  - The changed lines are byte-identical between DEV and COMMERCIAL.

## v9.7.703: the PHASE 2 question is about the car, not the timeline

Your follow-up to the finding above.

**The PHASE 2 `YOUR APPROACH` line.**

Before (v9.7.702):
> Ask a low-effort question. NOT "are you still interested?" Instead: "Are you leaning more new or pre-owned?" or "Did your timeline change?"

After (v9.7.703):
> Ask a low-effort question. NOT "are you still interested?" Make it about what they are shopping for, easy to answer in a few words. The kind of question (tone only -- make it about THIS lead's vehicle): "Are you set on the [trim], or open to others?" or "Leaning more new or pre-owned?" Do NOT ask whether their timeline, timing or plans changed -- that is the timing-check rung's question, and this lead is not there yet.

- **The timing question hasn't gone away.** It belongs to PHASE 3 (TIMING CHECK, from day 8), which is unchanged.
- **The ask is still uncounted.** My first draft said "Ask one low-effort question". `message-constraints` and `regen-variance` caught it against your 9/23 ask-rule decision, and it was restored to "a".

**Paired drafts.**
- Setup: v9.7.702 against v9.7.703 on the four PHASE 2 pairs, 3 drafts per side, sides alternated.
  - Two real Audi Lafayette leads: dump a24e7a8c and capture 5100d637.
  - Two synthetic leads, labelled as such: Toyota Baytown and Kia Baytown.
- One after-side draft came back on the fallback model and is excluded.

| | v9.7.702 | v9.7.703 |
|---|---|---|
| Drafts asking about timeline or timing | **6 of 12** | **0 of 11** |

- **a24e7a8c (2 days).** All three before-drafts asked "Did your timeline change?" / "has your timeline shifted?". One also opened with "it's been quiet since your online inquiry", two days in. All three after-drafts asked whether the EX trim is a must-have.
- **5100d637 (4 days).** Two before-drafts asked "Did your search go a different direction?", which comes from this old capture's own zero-contact example. After: whether they're set on the Lone Star trim.
- **Toyota and Kia (synthetic, 7 and 4 days).** The timing questions were replaced by color, trim, new-or-pre-owned, and must-have-feature questions.
- **Worth watching:** 7 of the 11 after-drafts used the trim example's shape ("set on X, or open to other trims?"). It suits a young lead, but it's the new default phrasing.

**Tests.**
- `stalled-rung-702` gains 4 checks (30 per build, 60 total):
  - The example is gone.
  - The timeline question is banned, and the ban says why.
  - The question is aimed at the vehicle, and the ask is uncounted.
  - A PHASE 3 control: that rung still carries the timing check.
- **Non-vacuity:** run against v9.7.702, the 3 wording checks fail and the control passes.
- **run-all:** 125 suites, **5,986 assertions, 0 failed**.
- **Build checks:**
  - `node --check` is clean on both builds.
  - Both manifests are at 9.7.703 / 9.7.703-dev.
  - The changed lines are byte-identical between DEV and COMMERCIAL.

## v9.7.704: PHASE 2 examples rotate with the lead

Your request: "add more examples and have them rotate as needed in context." In v9.7.703, 7 of 11 drafts copied the first example's shape.

**The pool.** PHASE 2 now shows **three examples, taken from a pool of eight** (all tone only):

| Topic | Example | Offered when |
|---|---|---|
| trim | "Are you set on the [trim], or open to other trims?" | the lead's vehicle has a trim |
| new vs pre-owned | "Leaning more new or pre-owned?" | always |
| color | "Is there a color you have your heart set on?" | no specific unit (a stock number or VIN fixes the color) |
| must-have feature | "Is there a feature it has to have?" | always |
| photos / video | "Want a quick walkaround video of this one?" / "Would a few photos help?" | always; "this one" only when there is a unit |
| what it is for | "What will it mostly be doing -- daily driving, family, work?" | always |
| size | "Is the size right, or are you weighing something bigger or smaller?" | always |
| a detail on the unit | "Anything specific you'd like me to check on this one?" | only when a unit is on the lead |

**How "as needed in context" works:**
- **Fit.** An example that can't apply to this lead is never offered.
- **Already asked.** A topic is dropped when our own texts or emails on this lead already asked it, or when a rejected draft asked it (a Regenerate). The model is also told: "Already asked on this lead, so do not ask it again: color, photos / video."
- **Rotation.** From what is left, three are offered, starting at a point that moves with every new touch and every Regenerate.
  - The same lead state always gives the same three.
  - If every fitting topic has been asked, it still offers three and tells the model to come at it from a new angle.

**Still in force:**
- The timeline ban.
- The uncounted ask ("Ask a low-effort question").
- No still-interested question, no numbers, no trade.

`[LP RUNG2 EXAMPLES DIAG]` logs what was offered, what was already covered, the fit and fresh counts, the rotation offset, the touch count and the number of rejected drafts.

**Paired drafts.** v9.7.703 against v9.7.704, same four PHASE 2 leads, 3 drafts per side. Two drafts on the fallback model are excluded.

| Question asked | v9.7.703 | v9.7.704 |
|---|---|---|
| Trim ("set on the X, or open to other trims?") | 6 of 10 | **0 of 11** |
| What it is for | 0 | 5 |
| Must-have feature | 1 | 3 |
| Size | 1 | 2 |
| Photos / video | 0 | 1 |
| Color | 3 | 0 |
| Timeline | 0 | 0 |

- **Within one lead, drafts still agree** (the Kia lead asked about a must-have feature three times). The three offered examples only change when the lead's state changes, so the variety shows across touches and Regenerates, as below.
- **Regenerate chain.** Four Regenerates in a row on the synthetic Kia lead, each rejected draft fed back as the panel does. The question moved **trim → color → what it's for → photos**, and each prompt named the topics already covered. The third draft came back on the fallback model.
- **For 5100d637,** the examples were taken from the Audi dump's context, because this old capture can't be rebuilt by code. One after-draft kept "I know we haven't connected yet", which comes from the capture's own zero-contact block.

**Tests.**
- **New `rung2-examples-704.test.js`:** 21 checks per build, 42 total. It covers:
  - Pool safety.
  - Fit (trim, unit, color).
  - Covered topics, from our outbound and from rejected drafts, including the "set on the XLE?" wording.
  - Rotation across touches and Regenerates.
  - The rendered prompt and the diagnostic.
- **Non-vacuity:** against v9.7.703, 19 of 21 fail. The 2 that pass are labelled controls: the kept v9.7.703 guarantees, and the untouched PHASE 3.
- **Existing tests:**
  - `regen-variance` names the new draft-history reader, per its rule that every reader is named on purpose.
  - `stalled-phase` and `refine-prohibitions` now load the pool.
- **run-all:** 126 suites, **6,028 assertions, 0 failed**.
- **Build checks:**
  - `node --check` is clean on both builds.
  - Both manifests are at 9.7.704 / 9.7.704-dev.
  - The changed lines are byte-identical between DEV and COMMERCIAL.

## Left alone

- **P1** (SMS always drafted, opt-out shown as a notice), as confirmed.
- **Worker v7.77** fixes from the earlier review (list-licenses pagination, `/feedback/summary` byScenario, UTC vs Central dates, no `extensionVersion`, safe-fallback text). Not built; the offer stands. Logging output tokens in the `CACHE` line would complete item 1.
- **One-sided reading unknown age as 0 days** (item 2, flagged). One line; not changed in a report-only item.
- **The other rungs' wording.** Only PHASE 2's approach line changed (v9.7.703).
- **Count thresholds.** Unchanged, as asked.
