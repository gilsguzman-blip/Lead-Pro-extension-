# Lead Pro Build Audit — DEV v9.7.428 / COMMERCIAL v9.7.426

Auditor: Fable 5 · Date: 2026-07-13
Scope: `popup.js` (deep, both builds), `manifest.json`, `content.js` (guard surface), merge/rescue pipeline, prompt construction, output enforcement.

**Build delta:** the two builds are functionally identical. A full non-comment diff shows DEV adds only the measurement-only stability diagnostic (`runStabilityDiagnostic` / `computeWinnerFromFrameCandidatesDiagOnly`) and the "DEV build distinguisher" log line. **Every finding below affects BOTH builds.**

---

## 1. Findings table

| # | Sev | One-line description | Location (grep anchor) | Builds |
|---|-----|---------------------|------------------------|--------|
| F1 | HIGH | Split-frame rescue relaxation (v9.7.383 SF-1) can never fire — `rescued` never carries `_voiFromPanel`, so `_splitFrameSafe` is always false | `rescueComplete` → `!!d._voiFromPanel && _otherLeadFrameCount === 0`; builder loop near `[LP SOURCE-RESCUE]` | both |
| F2 | HIGH | `rescueFrameResults` is out of lexical scope inside `rescueComplete` — ReferenceError swallowed by silent catch; competing-frame count is always 0 (fabricated diag data + vacuous safety gate) | `_otherLeadFrameCount = (rescueFrameResults \|\| [])` near `[SPLIT-FRAME DIAG] competing lead-like frames` | both |
| F3 | HIGH | JSON Recovery 2 references undefined `fieldType` — throws exactly when `finishReason === 'MAX_TOKENS'` (the truncation case it exists for), silently downgrading to the garbage Recovery-3 raw split | `extractField` in generateAll catch, near `Voicemail cut short` | both |
| F4 | HIGH | Stale-appointment guard reads raw `d.leadAgeDays` before any fallback — a scrape-miss on an old lead injects the false fact "current lead was submitted today as a NEW inquiry" and suppresses live appointment history | `var _leadAgeForAppt = parseFloat(d.leadAgeDays \|\| 0)` near `freshestApptEventDays` | both |
| F5 | MEDIUM | Three more raw `d.leadAgeDays` reads in populateFromData with 0-ambiguity: trade "JUST submitted" override, `isStalled >= 2`, `isNewLeadToday === 0` (loyalty gating) | `This trade is in the deal the customer JUST submitted`; `Stalled check —`; `var isNewLeadToday` | both |
| F6 | MEDIUM | Voicemail path skips the generateAll leadAgeDays normalization — VM generated first on an age-miss lead gets "submitted today" + Director FIRST-TOUCH mode on a 90-day ghost | `generateVoicemail` (no `NORMALIZE leadAgeDays` equivalent) | both |
| F7 | MEDIUM | First-touch incentive overrides mutate `_incFirstTouch`, un-gating SIMILAR VEHICLES and ALTERNATE CONDITION on genuine first-touch leads — up to 3 sales angles injected into a first message | overrides `_incFirstTouch = false` … gates at `SIMILAR VEHICLES IN STOCK` / `ALTERNATE CONDITION AVAILABLE` | both |
| F8 | MEDIUM | `sc.storeBrand` is never assigned (classifier sets `aiBSStoreBrand`) — interests-based CROSS-BRAND ALERT never fires; PLAY A/judgment lines degrade to "this brand"/"us" | `CROSS-BRAND ALERT` / `(sc.storeBrand \|\|` (4 sites) | both |
| F9 | MEDIUM | Day-off override scans full context unbounded (agent notes + prior-lead history; "dropped off on Friday" matches) and ignores closed days — can command "Sunday ONLY" while the calendar says Sunday (CLOSED) | `CUSTOMER DAY-OFF OVERRIDE — CRITICAL` | both |
| F10 | MEDIUM | Two divergent Director-mode resolvers: buildSystemPrompt SITUATION vs user-prompt persona block compute first-touch/stall from different inputs (LP-command stall override only in one; `sc.isExitSignal`/`isZeroContactStalled` only in the other) — mixed voice instructions in one prompt | `Director mode:` (system) vs `_isStallContext` in persona block near `VOICE FOR THIS RESPONSE` | both |
| F11 | LOW | Manual "Trade-In" chip cannot trigger the sales persona escalation: resolver reads `s.hasTrade` before manual flags assign it (end of classifyScenario); also `s.isAudi`/`s.hasApptSet` read pre-assignment (log-only impact) | persona resolver `(s.hasTrade \|\| data.hasTrade \|\| s.isHighIntent)` | both |
| F12 | LOW | Rejected-name guard blanks `d.name`, which disables Generate (`canGenerate` requires a name) — contradicting its own injected "use a generic greeting" directive | `name guard — rejected non-name` vs `const canGenerate` | both |
| F13 | LOW | SOLD→INCENTIVE PIVOT not gated on adversarial/exit state (general incentive block is) — exit-signal + sold-unit stacks "lead with the incentive, move forward" against "customer is stepping back" | `SOLD → INCENTIVE PIVOT` block (runs before `_incAdversarial` computed) | both |
| F14 | LOW | `_lpVehicleTotaledNow` scans full context including years-old below-marker history — a wreck+insurance co-occurrence from a prior purchase cycle can fire the totaled-vehicle directive on a fresh unrelated lead | `_vehicleTotaled = _lpVehicleTotaledNow((d.context \|\| ''))` | both |
| F15 | LOW | Duplicate `fill('leadSource', d.leadSource)` call (twice back-to-back); polish only | populateFromData `persist source to DOM` | both |

---

## 2. Finding detail

### F1 — Split-frame rescue relaxation is structurally dead (`_voiFromPanel` never copied)
**Scenario:** Cars.Com Finance Intent lead on a slow-hydrating session (the Hector Solis class this fix was built for). Initial scrape is sparse → passive-wait rescue runs. The rescue loop copies `vehicle, stockNum, vin, condition, color, phone, leadSource` (plus `autoLeadId`/`dealerId` provenance) into `rescued` — but never `_voiFromPanel`. Inside `rescueComplete`, `_splitFrameSafe` requires `!!d._voiFromPanel`, which is always `undefined` → always false. If the vehicle-supplying frame had no leadId marker and the dealer isn't positively verified, `_blockVehicleMerge` stays true — the VOI is blocked on exactly the grabs the v9.7.383 changelog says are now fixed. The agent generates with no vehicle; live precedent produced "we don't have Fords on our lot" about an in-stock unit. The `SPLIT-FRAME vehicle ACCEPTED (rescue)` log line is unreachable code.
**Root cause:** provenance-copy fix (v9.7.372) stamped IDs but not the panel-source flag the later gate depends on.
**Minimal fix:** in the rescue field-copy loop, alongside `rescued.vehicle = rd.vehicle;` add:
```js
if (rd._voiFromPanel) rescued._voiFromPanel = true;
```
(The main-merge SF-1b path is unaffected and works.)

### F2 — `rescueFrameResults` ReferenceError swallowed; competing-frame guard always 0
**Scenario:** any rescue-path grab. `rescueComplete` is defined in the outer executeScript-results callback; `rescueFrameResults` is a parameter of a *different, later* callback (the 7s re-scrape). Lexical scoping means the identifier inside `rescueComplete` is unresolved → `(rescueFrameResults || [])` throws ReferenceError (`||` does not protect undeclared identifiers) → caught by `catch(e){}` → `_otherLeadFrameCount` stays 0.
**Consequences:** (a) every `[SPLIT-FRAME DIAG] competing lead-like frames: 0` logged since v9.7.375 is fabricated — the dataset used to justify the relaxation never measured anything; (b) once F1 is fixed, the "zero competing lead frames" safety condition is vacuously true — a stale old-lead frame with its own leadId (the exact disqualifier the condition encodes) would NOT disqualify the relaxation.
**Minimal fix:** pass the results in explicitly — change the call to `rescueComplete(rescued, rescueFrameResults)` and the signature to `function rescueComplete(d, rescueFrameResults)`. Fix F1 and F2 together; F1 without F2 opens the relaxation with a dead safety check. This is also the audit's requested "silent catch that swallows a ReferenceError from a genuine bug" — it exists and it's this one.

### F3 — Recovery 2 crashes on the exact input it was built for
**Scenario:** model response truncated at `maxOutputTokens` (finishReason `MAX_TOKENS`), JSON unterminated → strict parse fails → Recovery 0/1 fail → Recovery 2's `extractField('sms')` evaluates `fieldType === 'voicemail'` — `fieldType` does not exist (the parameter is `key`; `fieldType` only exists inside the later `flattenField`). ReferenceError → caught → "Recovery 2 failed" → Recovery 3 splits raw JSON text on blank lines, so the agent sees JSON fragments (`{"sms":"Hi Tammy...`) rendered as drafts. When finishReason isn't MAX_TOKENS the `&&` short-circuits and hides the bug — which is why Recovery 2 appears to work in normal-failure tests.
**Minimal fix:** replace `fieldType === 'voicemail'` with `key === 'voicemail'` — or delete the clause outright (extractField is only ever called with `'sms'`/`'email'`, so the voicemail-ellipsis branch is dead by construction).

### F4 — False "submitted today" injected by the stale-appointment guard
**Scenario:** 90-day-old lead with a no-show 90 days ago; scraper misses `leadAgeDays` (the confirmed Charles Underwood failure mode, ageDays unset at populate time). `_leadAgeForAppt` reads 0 → `<= 1` passes; `freshestApptEventDays >= 60` passes → the prompt asserts "The current lead was submitted today as a NEW inquiry… Do NOT reference these old appointments." Both halves are wrong: the lead is old, and the appointment history it suppresses is this lead's live context. This is fabrication-adjacent (a false runtime fact asserted to the model) and the same pipeline-ordering class fixed in v9.7.81/420/428 — the appointment block simply sits ~500 lines BEFORE the v9.7.428-hoisted fallback.
**Minimal fix (also resolves F5):** normalize once at the top of `populateFromData`:
```js
// (fix) resolve leadAgeDays ONCE before any consumer reads it — same 3-tier
// fallback as v9.7.420/428, written back so every consumer inherits it.
if (!parseFloat(d.leadAgeDays || 0)) {
  var _ladCtx = (d.context || d.pageSnippet || d.history || '');
  var _ladM = _ladCtx.match(/Created[^(]*\((\d+)d\)/i);
  var _ladV = _ladM ? parseInt(_ladM[1]) : 0;
  if (!_ladV) { var _dm = _ladCtx.match(/\[(\d{1,2}\/\d{1,2}\/\d{4})/g) || [];
    if (_dm.length) { var _ms = new Date(_dm[_dm.length-1].replace('[','')).getTime();
      if (_ms > 0) _ladV = Math.floor((Date.now() - _ms) / 86400000); } }
  if (_ladV > 0) { d.leadAgeDays = _ladV; console.log('[Lead Pro] leadAgeDays normalized at populate:', _ladV); }
}
```
Then the v9.7.428 local `_incLeadAge` fallback becomes redundant (keep or simplify), and F5's three consumers are fixed for free. Caveat this does NOT resolve: a lead that is *genuinely* day-0 and a scrape-miss both still read 0 — the fallback distinguishes them only when transcript dates exist; that residual ambiguity is inherent.

### F5 — Remaining raw `leadAgeDays` consumers in populateFromData
- **Trade "JUST submitted" override** (`(d.leadAgeDays || 0) === 0`): on a scrape-miss, an old lead's genuine "not trading" decline is overridden with "this trade is their CURRENT intent… superseded" — the model may tell a customer their months-old decline doesn't stand. Fabrication-adjacent.
- **`isStalled` (`>= 2`)**: scrape-miss → 0 → stalled treatment silently never applied to a lead that has been worked for weeks (opposite failure direction: feature silently off).
- **`isNewLeadToday` (`=== 0`)**: a scrape-miss makes an OLD loyalty lead take the stricter "new lead today" loyalty-gating branch. Low impact but same class.
All three are inside `populateFromData` and inherit the F4 fix automatically.
**Diagnostic that settles it live** (if you want confirmation before shipping): log `[LP AGE DIAG] populate-time leadAgeDays: <raw> | fallback: <derived>` at the top of populateFromData and watch for `raw:0 fallback:>0` pairs — each one is a lead that hit F4/F5 in current builds.

### F6 — Voicemail-first path misses age normalization
`generateVoicemail` → `classifyScenario` (has its own fallback — persona routing OK) but then `buildUserPrompt` (LEAD AGE line, phase framing, Director persona block) and `buildSystemPrompt` (`_ageDays = parseFloat(_d.leadAgeDays || 0)` → `_isFirstTouch`) read raw. Clicking VOICEMAIL before Generate on an age-miss lead produces a first-touch-framed VM for a long-dormant ghost. The F4 populate-time fix covers this too (normalization moves upstream of both paths); alternatively extract the generateAll normalization into a helper and call it at the top of generateVoicemail.

### F7 — Override side-effect un-gates secondary-touch facts on first touch
The three deliberate first-touch overrides (customer-asked, generic-VOI, in-transit) express "allow the incentive" by setting `_incFirstTouch = false`. But `_incFirstTouch` is also the gate for the two v9.7.414 engagement blocks whose own comments say "secondary-touch tool, not a first-impression pitch," and for the angle-discipline block. **Scenario:** fresh day-0 generic-VOI lead (exactly the v9.7.428 case) → override fires → first message gets STORE INCENTIVE + SIMILAR VEHICLES IN STOCK + possibly ALTERNATE CONDITION. The similar-vehicles directive even tells the model "Never lead a first-touch… with an unsolicited alternative" — injecting a fact wrapped in an instruction not to use it is pure token cost plus risk.
**Minimal fix:** capture the pristine value before the overrides and gate the engagement blocks on it:
```js
var _incIsFirstTouchReal = _incFirstTouch;   // before any override mutates it
...
if (d.vehicle && !d.isSoldDelivered && !_incAdversarial && !_incIsFirstTouchReal && !_voiCrossSellSuppressed) { /* similar vehicles */ }
```
(Same at the ALTERNATE CONDITION and angle-discipline gates. The incentive path keeps the mutated flag — that's its intended behavior.)

### F8 — `sc.storeBrand` vs `sc.aiBSStoreBrand`
`classifyScenario` sets `s.aiBSStoreBrand`; four matrix read-sites use `sc.storeBrand` (never assigned):
1. The interests-based `CROSS-BRAND ALERT` requires `_storeBrand` non-empty → never fires (redundant reinforcement of the aiBSIsCrossBrand path, so no wrong output — just a dead directive).
2–4. PLAY A example, judgment-guide line degrade to "this brand"/"us" — the model never learns the store's own brand name in the play text.
**Minimal fix:** `var _sbLabel = sc.aiBSStoreBrand ? sc.aiBSStoreBrand.charAt(0).toUpperCase() + sc.aiBSStoreBrand.slice(1) : '';` and use it at the four sites.

### F9 — Day-off override: unbounded scan + no closed-day pivot
The `CUSTOMER DAY-OFF OVERRIDE` scans all of `data.context` (agent notes, prior-lead history below the marker) with patterns loose enough that `"dropped off on Friday"` (third alternation: `/off (?:on |this )?(friday)[\s,.]/`) or a months-old "I'm off Friday" fires a "REQUIRED / CRITICAL: Offer ' + day + ' ONLY" directive. Worse, unlike the populateFromData `CUSTOMER SPECIFIED DAY` handler (which pivots closed days via `_lpDayOpen`, v9.7.245), this injection never checks store hours — a customer off on **Sunday** yields "Offer appointment times on Sunday ONLY" in the same prompt whose calendar marks `Sunday (CLOSED)`. That is the Jenny-Fortenberry contradiction reintroduced one layer up.
**Minimal fix:** (a) bound the scan to above the CURRENT-LEAD marker and to customer-attributed lines (or just `lastInboundMsg` + `[CUSTOMER]` lines, the v9.7.350 pattern); (b) before pushing, check `_lpDayOpen(data.dealerId, offDay)` and, when closed, reuse the closed-day pivot wording with `_lpNextOpenDay`.

### F10 — Two Director-mode resolvers disagree (relevant to the 75–78% persona gap)
`buildSystemPrompt` and the user-prompt persona block each independently compute `_isFirstTouch`/`_isStallContext` and select a Director mode. Divergent inputs:
- LP-command "lead is still active" stall-override exists **only** in buildSystemPrompt.
- `sc.isZeroContactStalled`, `sc.isExitSignal`, `sc.isPauseSignal` feed `_isStallContext` **only** in the user-prompt block.
**Scenario:** stalled lead with an agent note "[LP: lead is still active, keep going]" → system prompt says ACTIVE/FIRST-TOUCH situation; user-prompt persona block still selects the stall-recovery voice example ("pattern-break the silence… give them a clean exit"). One prompt, two contradictory postures. Since Director auto-fires precisely on messy leads, incoherent stacking here plausibly contributes to the Director's 75–78% positive rate vs BDC's 92%.
**Minimal fix:** resolve the mode once (buildSystemPrompt already writes `window._leadProRouteTrace.directorMode`) and have the persona block read that instead of recomputing.
**Cheap analysis with data you already collect:** `meta.route.directorMode` ships in feedback (v9.7.311). Segment the 👎 rate by `directorMode` — if `stall` carries the gap, it's cohort difficulty + F10; if `first_touch`/`active` are also low, it's the voice itself.

### F11 — Manual trade chip never escalates to sales persona
The persona resolver IIFE runs at the top of `classifyScenario`; `s.hasTrade` is only set from manual flags at the very bottom. So `base === 'bdc' && (s.hasTrade || …)` sees only `data.hasTrade` (scraped). An agent who lights the Trade-In chip on a lead the scraper missed gets no sales-persona routing. (Also `s.isAudi` at `_isAudiStore` and `s.hasApptSet` in the Director check are read before assignment — both have working fallbacks, log-cosmetic only.) Minimal fix: read `(data.activeFlags||[]).indexOf('trade') !== -1` in the resolver clause.

### F12 — Rejected-name guard vs Generate gate
`_lpLooksLikeName` rejection sets `d.name = ''` and injects a directive planning for a generic-greeting message — but `canGenerate` requires `d.name`, so Generate stays disabled and that directive can never run unless the agent hand-types something into the name field (which then contradicts the "real name is unknown" note). Minimal fix: `const canGenerate = !!((d.name || d._rejectedName) && …)`.

### F13 — SOLD pivot ignores adversarial state
The SOLD→INCENTIVE PIVOT block runs before `_incState/_incAdversarial` are computed and has no equivalent gate. Exit/negative-reply + sold-VOI leads get "lead the pivot with THIS [incentive]… move forward with the alternative" stacked against the exit-signal SITUATION override ("customer is stepping back"). Minimal fix: compute `var _convLow = (leadConvState||'').toLowerCase();` before the inventory-warning block and skip the incentive-led variant (fall back to the generic no-price pivot, or nothing) when `_convLow === 'exit' || _convLow === 'negative-reply'`.

### F14 — Totaled-vehicle scan unbounded
`_lpVehicleTotaledNow` deliberately scans full context, but full context includes below-marker prior-purchase history. Pattern (B) (wreck word + insurance word anywhere in the blob) can co-occur across years-old notes ("GAP" in an old F&I note + "accident" in old service history) and fire the strong NOT-a-normal-trade directive on a lead with a perfectly healthy trade. Minimal fix: truncate the scanned text at `=== CURRENT LEAD SUBMITTED HERE ===` (the same bounding used by the arc spine and attempt counters); keep `lastInboundMsg` unbounded.

---

## 3. Improvement opportunities (ranked, honest)

1. **Centralize `leadAgeDays` normalization at populate time** (F4/F5/F6 in one ~15-line diff). This bug class has now been fixed four separate times one consumer at a time (v9.7.81, v9.7.420, v9.7.428, plus the persona resolver's private fallback); each fix left siblings broken. One write-back at the top of `populateFromData` retires the class. Impact: high (customer-facing false facts). Effort: small.
2. **Fix F1+F2 together and re-collect the SPLIT-FRAME data.** The rescue relaxation you believe shipped in v9.7.383 has never executed, and the diagnostic justifying it has never measured anything. After the fix, the `[SPLIT-FRAME DIAG]` counts become real — re-validate "competing frames is reliably 0" before trusting the relaxation, since the prior evidence is void. Impact: high. Effort: small (two lines + one param).
3. **Unify the Director mode resolver (F10) and segment 👎 by `meta.route.directorMode`.** You already ship the trace; the analysis costs nothing and tells you whether the 75–78% Director score is cohort difficulty or voice. My read from the code: the stall-recovery default fires whenever the mode heuristics miss, and the two-resolver disagreement puts contradictory posture instructions in one prompt — fix that before touching the persona's dos/donts. Impact: likely the biggest lever on the persona gap. Effort: small-medium.
4. **Edge-cache hit rate: round CURRENT TIME to 15-minute granularity.** The user prompt embeds `CURRENT TIME: h:MM AM/PM` and `(Xh Ym remaining today)` — minute-precision text near the top of the prompt. The worker edge cache is keyed on date+system+user prompt, so a regenerate one minute later is a guaranteed miss, and any prefix-style caching dies at line ~3 of the user prompt. Time awareness is load-bearing, but nothing downstream needs minute precision except the closing-soon urgency tier, which is bucketed in hours. Round displayed time to :00/:15/:30/:45 (keep exact math internal). Impact: real cost reduction on regen/chip flows. Effort: tiny. (Also consider moving DATE/TIME below the big static scenario/system-adjacent text if you ever adopt provider-side prompt caching on the user message.)
5. **Prompt-size trims with zero behavior risk:** (a) the DISTANCE hard-rule directive (~1,400 chars) fires on nearly every non-Audi lead — it can say the same thing in a third of the tokens; forbidden-phrasing lists of 8 examples don't outperform 3 plus "and any paraphrase". (b) The arc spine duplicates up to 60 turns that appear verbatim in CONTEXT & HISTORY below — you kept it flag-gated for A/B (good); if the A/B never resolved, resolve it: on 30k-char prompts the spine is ~10–15% of tokens. (c) F7's fix removes injected-but-forbidden facts from first-touch prompts.
6. **classifyScenario/persona double-run:** confirmed it runs 2–3× per generation (updatePersonaBar at populate, buildUserPrompt at generate, again on VM). It's pure regex over ≤50KB — a few ms, not worth memoizing, and the escalation cache already handles cross-pass divergence. The real cost is doubled `[LP *]` console noise; if that bothers anyone, gate the resolver's logs on a `_quiet` param for the persona-bar call. Verdict: leave the computation alone.
7. **Unused scraped data worth surfacing:** `daysOnLot` and `conditionalOffer` are already wired as "forward hooks" in the value-fact resolver but the scraper never captures them — they're free wins whenever scrape-side work reopens (**scrape-side change — separate from everything above, requires scraperVersion bump**). Also `_lpValueFactCache[..].inv.units[].daysOnLot` is used only as a comparables tiebreaker; an honest "this unit has been on the lot N days" fact is a legitimate value-touch angle the GSM asked for and the data is already in the cache.

---

## 4. What was checked and found clean

- **`_lpModelLine` dedupe (the "5th site" hunt):** all four incentive-line consumers (SOLD pivot + its diag, OFFER ENDING SOON, general STORE INCENTIVE, first-touch variants) route through `_lpModelLine`. No fifth manual `model + ' — ' + line` prepend exists in either build. Clean.
- **`_lpValueFactCache` race handling:** `pending` flag is set before both fetches, cleared only after both settle (`.finally` on each, `_settled >= 2`); TTL (30 min) and both-null retry logic are correct; the load-time warm of all five dealers is present in both builds; the populate-time and beacon-time calls are correctly no-op'd by the pending guard. The v9.7.422 `_soldVfc` fix (reading the cache directly instead of the later-assigned `_vfc`) is correct as shipped. Clean.
- **PASS-1/PASS-2 merge gates:** vehicle (v9.7.51), leadSource (v9.7.292), conversation fields (v9.7.365), lead-state fields incl. the leadAgeDays falsy-zero inheritance (v9.7.379 F1), service-frame rejection (v9.7.307/263/264), anchor-mismatch hard stop (F5), customerState verified-frame rule (F9), split-frame main-merge relaxation (SF-1b) — all verified present and internally consistent. I found no new cross-lead/cross-frame bleed path in the **main** merge; the rescue path's issues are F1/F2 above.
- **First-touch incentive suppression gates:** the three overrides themselves are as tight as documented (customer-asked regex is conservative; generic-VOI requires BOTH vin+stock absent AND non-aggregator source AND the leadAgeDays-fallback freshness check; in-transit inherits the Toyota-only `isInTransit`). The hole is the side effect on other gates (F7), not the gates themselves.
- **`isInTransit` Toyota-only invariant:** holds everywhere, including `_lpUnitInTransit` for inventory units and both first-touch override and comparables disclosure paths. Clean.
- **STOP/opt-out chain:** scraper flag → prompt directive alignment (v9.7.379 F3) → deterministic SMS discard at render → opt-out overlay/status UX with per-lead reset. Consistent end to end. Clean.
- **JSON pipeline happy path:** brace-depth root extraction, control-char escaping walk, and the relocation of the trailing-period repair into the catch (v9.7.379 F6) are all correct. The one defect is Recovery 2 (F3 above).
- **Signature/phone enforcement:** `enforceSmsSig` block-anchor strip + cascade, `enforceEmailPhone` wrong-signer strip, `_correctOurPhone` (same-prefix-6, differing last-4 only) — no over-strip or customer-number-rewrite path found; mid-message name mentions are protected by punctuation anchors. Clean.
- **Regex traps (the `$469→$46` class):** spot-checked all lookahead/lookbehind money- and number-adjacent patterns in popup.js; none can shorten a match to dodge an assertion; no misplaced `\b` found on classification patterns I read. **Caveat:** the inline scraper body (~3,400 lines, `inlineScraper` 2869–6260) got a scan-level review (structure, merge-relevant fields, flagged patterns), not a line-by-line one; scrape-side regexes are pinned behind scraperVersion v9.7.51 and I am not proposing changes there.
- **Silent catches:** 96 `catch{}`-empty blocks enumerated; all but two wrap environmental failures (storage/DOM/fetch) or have interior diagnostics added in v9.7.415/417/421. The two that swallow genuine code bugs are F2 (rescueComplete) and F3 (Recovery 2), detailed above.
- **Beacon integrity:** single-use clear, 10s trust window, scraperVersion enforcement (v9.7.379 F2), hidden-frame write guard (F4), service-source beacon block — all present in content.js/popup.js in both builds. Clean.
- **manifest.json:** identical between builds except version/version_name; permissions minimal and unchanged; side-panel + content-script scoping correct. Clean.
- **computeAppointmentTimes:** reviewed at flow level (same-day/next-day labels, close-time math feeding the urgency tiers) — no defect found, but this function did not get the same line-by-line depth as the rest; noted for honesty.
- **Not proposed anywhere above:** any change to `content.js` scrape logic or scraperVersion (item 7's forward hooks are the only scrape-side suggestion, explicitly flagged), any loosening of the incentive gates, any async refactor of the GRAB LEAD callback chain (F1/F2 are specific correctness fixes within the existing structure, exactly the kind the architecture notes invite).

---

*Instrument-first notes are embedded per finding; the only one that needs live confirmation before shipping is the F4/F5 populate-time normalization interplay with genuinely-day-0 leads — the `[LP AGE DIAG]` line specified in F5 settles it in one day of real grabs.*
