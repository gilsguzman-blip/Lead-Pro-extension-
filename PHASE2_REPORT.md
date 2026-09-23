# Lead Pro: Phase 2 report

Builds v9.7.695 to v9.7.701 (DEV and COMMERCIAL paired), branch `claude/audi-honda-brand-mismatch-ybifph`.
Extension only. Proxy v7.76 and reporter v1.22 were not changed or redeployed.
Leads are cited by capture or log id, never by name.

## 1. Where things stand

| | v9.7.696 (start of Phase 2 changes) | v9.7.701 (now) |
|---|---|---|
| Test suites | 119 | 124 |
| Assertions | 5,656 | 5,926, 0 failed |
| New suites | | `step2-697`, `prompt-hygiene-698`, `cadence-calendar-699`, `step4-699`, `step5-700` |

- **New test tool.** `tests/helpers/load-popup.js` runs the whole `popup.js` (and its `auth.js`) in a sandbox. Tests can now check the prompt the model actually receives, not just the source. On the Audi Lafayette dump it reproduces the captured prompt line for line (the only differences were changes made after the capture).
- **Non-vacuity.** Every new suite was also run against the build before it. Every fix fails there; the only checks that pass on the old build are labelled controls.

## 2. Changes, by item

### P1: SMS opt-out (your ruling superseded the audit)
- **v9.7.695:** a single SMS opt-out switch, scoped to the current lead.
- **v9.7.696 (your call):** an SMS is always drafted.
  - The opt-out evidence is still detected, logged, and shown to the agent as a one-line notice.
  - A written "stop contacting me" still exits the lead.

### High
- **H1: "declined alternative" detector.** Removed the ban on alternatives. The customer's own words now render only when they name a vehicle. "Text only" and "don't call" are carried as the customer's channel preference.
- **H2: zero-contact examples.** Removed the A3 examples. They claimed a unit was on the lot and asked the banned still-interested question. Replaced with one line: no times, nothing that assumes a visit.
- **H3: trade-conflation guard.**
  - It reads customer text and call/agent notes, not our own outbound.
  - It only says "the notes contain the error" when they do.
- **H4: voice examples.**
  - Director first-touch and active modes drop the stalled-lead examples.
  - Every example is labelled "tone only".
  - `auth.js` examples use [Vehicle] and [Brand Specialist], and make no presence claims and quote no numbers.
- **H5: call boilerplate.**
  - Boilerplate call notes ("no answer", call-tracking rows) no longer count as contacts.
  - The hang-up and zero-contact thresholds, and the SITUATION count, read the scraper's outreach tally (this covers M1 too).

### Protected logic
- **P2: exit detector.** Reads the customer's lines only. "Found one", "decided to" and "bad experience" are no longer exits.
- **P3: "not today".** Needs the customer's own words or an out-of-town constraint.
- **P4: General Notes.** Pass through verbatim, with no visit tags.
- **P5: dealer id.** The active dealer id is reset on every grab and set from the active frame.
- **P6: cadence position.** Now by calendar (section 4).

### Medium
- **M2: showroom visit.** Now read from `isShowroomFollowUp || showroomVisitToday`. The field it used before was never assigned.
- **M3: duplicate scenario rules.** They render once.
- **M4: cached prompt.** The lead-independent rules sit above the cache breakpoint (section 3).
- **M5: zero-contact stack.** Zero-contact stalled leads had seven overlapping blocks. The stalled-phase block now owns the appointment ban, the "don't repeat" rule and acknowledging the silence. The others stand down or become a one-line fact. On a test lead the prompt drops from 26.3k to 23.9k characters.
- **M6: format rules.**
  - The SMS signature instruction no longer contradicts the lead section.
  - The duration and time-format lines appear only when times are offered.
  - The JSON instruction names the subject field.
- **M7: no-reply instructions.** Dropped "or trade" and "a different person picked up the thread".
- **M8: fact-probe caching.** Verdicts are cached per lead and exact probe inputs. A regen with unchanged inputs makes 0 probe calls instead of 3, and waits 0 ms instead of up to 4.5 s. Only real answers are cached.
- **M9: Concierge examples.** Say [Brand Specialist], and the delivery-bay line is conditional.

### Low
- **L1:** four scraper diagnostics are now relayed to the panel log.
- **L3:** removed a duplicate variable in DEV only.
- **L4:** fixed the "chronological order" sentence.

### Your follow-up requests
- **Sources (the Facebook lead).** The second, SMS-rewrite pass was dropping "on Facebook".
  - The rewrite now keeps where the customer came from, or ships the first draft.
  - Follow-ups name the source once, in passing.
  - TradePending resolves to its own name.
- **Bounced email.** The SMS asks once for a good email address. Bounce notices are no longer treated as outreach or as customer text.
- **Stock and presence (two Toyota Baytown leads, log238).** "It's here" needs the live feed to hold the same vehicle. A stock number that only a page-wide text match finds is refused.
- **First-contact incentives (log239).** Closed the "generic" and "in transit" exceptions.
- **Lease-maturity follow-ups (Log240, Audi Lafayette).** AFS/TFS/KMF follow-ups no longer re-open with the maturity date as the hook. Repeat customers got the same fix.
- **Length rules (your ruling).** All removed. Kept: 20–30 seconds for voicemail and the subject-line rule.
- **Distance (your ruling).** No draft states how far the customer is, on any lead. Details in section 3.
- **Dump helper.** `window._lpDumpLead()`.

## 3. M4 and distance: the paired harness

Setup:
- 11 real leads: two captures per store, plus the Audi Lafayette dump rebuilt by code with and without M4.
- Each lead sent before and after the change, twice per side, with the sides alternated and the edge cache bypassed.
- 44 calls. All returned 200 on the primary tier, with no fallbacks.

| | Before M4 | After M4 |
|---|---|---|
| Uncached prompt (Audi dump) | 50,400 chars | 42,777 chars (-7,623, about 1.9k tokens moved into the cached part) |
| Captured prompts | | about -7.5k chars each; all 23 rules found in every capture |
| Worker latency, median | 5.15 s | 5.56 s |
| Worker latency, mean | 5.28 s | 5.96 s |
| Output tokens, median | 479 | 477 |
| Volunteered OTD/payment, lists, non-English | 0 | 0 |
| Subject present | 21/22 | 22/22 |
| Trade mentioned | 2 | 5 (all on leads whose prompt includes a trade-discussed instruction) |

- **Latency: no improvement.** 7 of 11 leads were slower after, but the call-to-call spread (about 1.5 s) is larger than the difference. Latency here is set by output generation, not by reading the prompt.
- **Cost: not measured client-side.** The Worker returns total prompt tokens but not how many were cached. The split is in the Worker's own `CACHE primary cached=` log lines; the "after" requests are the ones with `sysChars` around 32.5k. Any saving is from billing the moved text at the cached rate.
- **Quality: comparable.** Drafts were equally specific (vehicle, color, trade and benefit named on both sides), with no systematic change in tone.
- **Routing: identical.** Every diagnostic line `buildUserPrompt` logs (scenario, source acknowledgment, zero-contact, distance, stalled phase, close-out) matches with and without M4, on the Audi dump and four synthetic leads.

**Distance.**
- **What the captures showed:** drafts said things like "before you make the drive from McComb" and "before making the trip from Louisiana".
- **Rule alone:** added to every prompt and to the SMS rewrite pass, it still let 1 of 6 drafts say "before you make the trip".
- **Root cause:** our own prompt text kept feeding the trip back:
  - "encourage the soonest workable time so the trip is worth it"
  - two examples that said "before you make the trip"
  - the Address Distance regenerate chip, which said "Acknowledge the trip directly"
- **With all of it fixed:** the Louisiana lead came back clean in 3 of 3 drafts.
- **Left alone on purpose:** "safe travels" for a customer's own trip, and acknowledging a wasted trip they already made to us.

## 4. Routing and cadence changes

- **P6 cadence, on 52 logs (141 generations, 81 leads):** 22 leads change position.
  - 12 had a touch and are now paused by a recent reply.
  - 8 had been rejected as over-counted and now get their calendar touch.
  - 1 moves later (the 55-day lead: day 24 to day 53).
  - 1 moves earlier (a 4-day lead: day 8 to day 4).
  - The old logs don't record when the last message was sent, so these are position changes only, not due-versus-covered counts. `[LP CADENCE DIAG]` now logs both readings, with a SHIFT marker.
- **Stalled-lead rungs (reported only, thresholds unchanged):** 10 stalled leads, all on rung 4 or 5. Six got there on leads 7 days old or younger, where the calendar says day 4, 7 or 8. The rungs count raw texts and emails with no calendar check.
- **M2:** 0 of 140 captured generations affected (none had a showroom visit).
- **H5 and N1:** the hang-up, zero-contact, channel-fatigue and one-sided thresholds now read the real outreach count, and a lead must be at least 3 days old. They fire less often. This wasn't counted on logs.
- **Remote buyers:** no suggested times, and the next step is remote.
- **M5:** three directives stand down on zero-contact stalled leads, where the stalled-phase block renders.
- **M4:** no routing change (above).

## 5. Left alone, and why

- **Stalled-lead rung thresholds.** Not changed, per your P6 ruling. The data is above if you want a calendar term added.
- **Things M4 didn't move:**
  - The three appointment-time rules that are swapped out when a customer is waiting on a deal condition. The no-appointment rule that replaces them has to come last to win.
  - "Read the complete conversation thread" and the "customer's messages are the record" block, which refer to their own position.
  - Your Task.
  - The agent-context preamble, which the scraper builds and the scaffolding filters match.
- **AI Buying Signal branches.** No follow-up version, by design (they follow their own situation matrix).
- **L2 dead reads.** Harmless; mostly left.
- **L5.** Report only, as ruled.
- **L6–L9.** No action, as ruled.
- **Out of scope:** incentive expiry, the bot appointment rule, the Concierge persona, and the Translate chip as the only path to non-English.

## 6. Found along the way

- **Distance rule that never ran.** The distance rule populate writes (v9.7.405) was added after the lead details had already been assembled, so it never reached a prompt (0 of 50 captures). Removed; the rule now lives once in the cached part of the prompt.
- **Signature step deleting the SMS close.** When an SMS's last body line mentioned the store keyword ("audi", or "Community" elsewhere), the signature step deleted it, often the closing question. Fixed in v9.7.701. 0 of 40 harness SMS drafts were affected, so it's rare.
- **Time-bomb test.** `bot-authorship.test.js` had a hard-coded 9/16 date, which made it fail on its own on 9/23. It's now relative to today. Many suites still hard-code 2026 dates; flagged, not swept.
- **Address Distance chip label.** The instruction behind it changed (it no longer names the distance); the label still says "Address Distance". Rename it if you like.
