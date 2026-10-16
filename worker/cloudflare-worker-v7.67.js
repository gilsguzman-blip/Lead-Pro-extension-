/**
 * v7.61: A REASONING EFFORT THIS PROXY DOES NOT RECOGNISE WAS SILENTLY REPLACED WITH 'low'.
 *   Three changes, all from the GPT-5.6 API guidance.
 *
 *   (1) THE VALIDATION WAS A THREE-VALUE ALLOW-LIST written when three values existed:
 *         (gen.reasoningEffort === 'low' || 'medium' || 'high') ? gen.reasoningEffort : 'low'
 *       GPT-5.6 supports none, low, medium, high, xhigh and max. Anything outside the old three
 *       was swapped for 'low' with NO error and NO log line — so a caller asking for 'none' would
 *       get 'low', see no complaint, and reasonably believe it had shipped. That is the same
 *       silent-substitution shape as v7.60's compKind clamp and v7.58's MIN_CONTENT_CHARS floor,
 *       and it is the third instance this week. The set is now the model's real set, and EVERY
 *       substitution is LOGGED with what was asked for and what was used.
 *
 *   (2) PER-TIER GATING, because the set is not uniform. 'none' and the two new high efforts are
 *       5.6-family features; the fallback and emergency tiers are older models that may reject
 *       them outright, and a 400 on the fallback tier turns a recoverable primary failure into a
 *       SAFE_FALLBACK. Each tier now declares the efforts it accepts, and a request for one a
 *       tier cannot take degrades to that tier's nearest supported value rather than 400ing.
 *
 *   (3) prompt_cache_retention -> prompt_cache_options.ttl, the replacement the guidance names.
 *       v7.42 correctly gated the deprecated field away from Luna, which left it split: the
 *       PRIMARY tier got no retention hint at all while the two older tiers still got the
 *       deprecated field. Both now get the current one in the form their family supports.
 *
 *   NOT ADOPTED, and stated so nobody re-litigates it from the same doc: the Responses API (LP is
 *   single-turn with no tools, so its reasoning-persistence and tool-calling benefits do not
 *   apply), pro mode (the guidance explicitly excludes routine, latency-sensitive, high-volume
 *   work, which is exactly this), and Programmatic Tool Calling (there are no tools).
 *
 * v7.60: THE compKind CLAMP WAS DESTROYING TWO OF THE THREE DETECTORS' ANSWERS. v7.59 made
 *   /commit-comprehension per-detector but left compKind clamped to ['firm','soft','none'] — the
 *   verbal-commit vocabulary, and the only one that existed when the clamp was written. Day-lock
 *   answers with a WEEKDAY ("Saturday") and off-franchise with a MAKE ("Ram"); both fell through
 *   the clamp and were stored as 'none', which is indistinguishable from "found nothing". Every
 *   positive verdict those two detectors ever produced would have been silently recorded as a
 *   negative, and the report would have read them as working-but-quiet rather than broken.
 *   Caught before it bit: v9.7.568's first live rows (log130, 8/22) are all AGREE-NONE, so no
 *   real answer has been lost yet — the clamp only destroys POSITIVES.
 *   FIXED per detector: verbal-commit keeps firm/soft/none exactly; day-lock accepts the seven
 *   weekday names; off-franchise accepts a short alphanumeric make token. Anything unrecognised
 *   still collapses to 'none', so the clamp is still a clamp — it just knows what each detector
 *   is allowed to say. Storage stays bounded and no free-form model text can land in KV.
 *
 * v7.59: /commit-comprehension becomes PER-DETECTOR, for extension v9.7.566 (Phase 3). The
 *   comprehension pass now answers three separate conversational-fact questions — verbal-commit,
 *   day-lock and off-franchise — each with its own kill switch and its own authoritative flag, so
 *   one KV row per generation per detector rather than one per generation. `detector` is clamped
 *   to the three known ids; a row without one is stored as 'verbal-commit', which is what every
 *   pre-v9.7.566 row is by construction. Also stores `authoritative` and `sourceUsed` so the
 *   report can separate "the comprehension pass would have disagreed" from "it actually changed
 *   the shipped directive" — those are different questions and only the second carries risk.
 *   Two new deltas: AGREE-FIRED (both readers found the fact) and NO-COMPREHENSION-VERDICT (the
 *   probe produced nothing usable, so there is no comparison). Purely additive; every v7.58 field
 *   is untouched and the /feedback handler is unchanged.
 *
 * v7.58: RESPONSE CONTRACTS. Live, 8/21 15:04-16:02 UTC: 17 requests failed all three tiers
 *   and returned SAFE_FALLBACK. Every one of them was the extension's Phase 2 comprehension
 *   OBSERVER PROBE, not a customer draft — proven, not inferred: all 17 carry
 *   cacheKey=lp_fd4886ea, which is promptCacheKey() of the probe's own system string
 *   ("You extract one fact from CRM notes and answer in JSON..."), computed and matched.
 *   In the same window the 71 real generations (cacheKey=lp_773499b2) were 71/71 OK. The
 *   partition is perfect and no customer draft was ever a fallback.
 *
 *   ROOT CAUSE, and it is this file's: MIN_CONTENT_CHARS. The floor is 150 and it is applied
 *   to every response at every tier. The probe's CORRECT answer is
 *   {"kind":"none","note":null,"quote":null} — 40 characters. A firm verdict carrying a
 *   53-char quote is 89. So every possible correct probe answer was rejected as
 *   "Empty response (finish=stop)", at all three tiers, deterministically. Not a rate limit,
 *   not a quota, not a provider issue, and NOT token starvation — callerMax is shadowed by
 *   spec.tokens on all three tiers, so the logged tokens=300 never reached OpenAI. The models
 *   answered correctly in ~1s and this Worker threw the answer away.
 *
 *   WORSE THAN THE FAILURE: SAFE_FALLBACK_TEXT is valid JSON. The observer JSON.parse'd it,
 *   found no "kind" key, defaulted to kind:'none', and recorded + PERSISTED that as a real
 *   comprehension verdict. All 17 rows in the 8/21 dataset read AGREE-NONE / NO-REGEX-VERDICT
 *   and every one is fabricated: the comprehension pass never ran. Since the 150 floor predates
 *   the observer, this is true of EVERY comprehension row ever collected.
 *
 *   FIX, in two independent layers:
 *   1. `responseContract` on the request. 'draft' (default, and the default for anything
 *      unrecognised or absent — a caller can never weaken the draft path by omission) keeps
 *      MIN_CONTENT_CHARS and hasDegenerateField exactly as they are. 'fact' replaces both with
 *      the floor that actually fits a one-fact answer: it must parse to a non-array object with
 *      at least one own key. isLikelyJson and isParseableJson apply to both — any JSON contract
 *      requires JSON. Contract is logged on the START line so the next occurrence is one grep.
 *   2. A NON-DRAFT contract NEVER receives SAFE_FALLBACK_TEXT. Handing a canned three-field
 *      draft to a caller that asked a yes/no question is what turned a visible failure into
 *      silent fabricated data. It now gets an explicit error envelope with no candidates.
 *
 *   ALSO: _requestId is returned on the SUCCESS envelope, not just the fallback one. Until now
 *   a generation's requestId existed only in these logs, so a /feedback row could never be tied
 *   to the generation it rated — the correlation was genuinely impossible, by one missing field.
 *
 *   /commit-comprehension accepts PROBE-FAILED and stores probeOk, so a dead probe is countable
 *   instead of arriving disguised as agreement.
 *
 *   NOT CHANGED, deliberately: the degenerate-field guard. 4 PRIMARY failures in the same window
 *   were "Degenerate field content" on gpt-5.6-luna with the email field holding a nested
 *   {"subject":...} object — the exact second shape v7.45/7.46 was built for. The guard is
 *   model-agnostic, it FIRED, and FALLBACK rescued all 4. It needs no extension for Luna. The
 *   "…" in those log lines is DEGENERATE_SAMPLE_CHARS truncating the log, not the model
 *   truncating its output.
 *
 * v7.57: /commit-comprehension accepts the NO-REGEX-VERDICT delta and stores regexRan, for
 *   extension v9.7.563. A row where the verbal-commit regex was gated off entirely is not a
 *   disagreement and must not be counted as one — log121's only two DISAGREE rows were exactly
 *   that, a stale verdict from a previous lead read as if it were current. Purely additive.
 *
 * v7.56: /commit-comprehension stores the NOTE TYPE on both sides (regexNoteType /
 *   compNoteType) plus the per-type read counts, for extension v9.7.560 which widened both
 *   readers from [CALL NOTE] to [CALL NOTE] + [NOTE]. Clamped to the two known tags so an
 *   arbitrary string cannot be stored. A type tag is not content and carries no PII — the
 *   v9.7.489 posture is unchanged. Purely additive; every v7.55 field is untouched.
 *
 * v7.55: POST /commit-comprehension — durable storage for the Phase 2 comprehension observer
 *   (extension v9.7.559). The observer exists to answer "how often do the regex and the
 *   comprehension pass disagree, and in which direction" off live traffic; console-only logging
 *   could never produce a sample. Same validation discipline, same KV namespace and the same
 *   90-day TTL as POST /feedback, and the same v9.7.489 locator-only privacy posture — CRM record
 *   locators so a row can be opened in VinSolutions, never contact data and never note text. The
 *   ONE exception is narrow and deliberate: an UNVERIFIED comprehension quote is stored (capped
 *   at 300 chars) because that string is model-generated and by definition is not in the lead, so
 *   a QUOTE-FABRICATED row could not otherwise be audited at all. Verified quotes are never
 *   stored — the note they came from is already in the CRM.
 *
 * v7.54: byDay gains incomplete / engaged / engagedShippedRate / engagedFirstTryRate, so a per-day
 *   series can be drawn on the SAME denominator as every tile and bucket. byDay's posRate has
 *   always been shipped/total, while aggregate() and _bucketRates() moved to shipped/engaged in
 *   v7.50 (engaged = total - abandoned - incomplete) — a session that never rendered a draft, or
 *   rendered one nobody used, is not a quality failure and does not belong in a quality
 *   denominator. The mismatch is not cosmetic: on 8/15 the same rows read 70% on the total basis
 *   and 86% on the engaged basis, so a trend line and the tile above it disagreed by 16 points.
 *   byDay also never emitted `incomplete` at all, so a consumer could not compute engaged itself
 *   even if it wanted to. posRate/shippedRate/firstTryRate are LEFT AS THEY ARE for any existing
 *   consumer; the engaged pair is added beside them.
 *
 * v7.53: top-level implicitDown, so a renderer can disclose the split it is asked to make.
 *   aggregate() has emitted explicitUp / explicitDown / implicitUp since v7.49 and the per-bucket
 *   split since v7.51, but the top level never carried implicitDown — the one number a tile needs
 *   to say "0 explicit, 27 regenerated or chipped then left unsent". A renderer could derive it as
 *   ratings.down - explicitDown, but the reporter Worker emits it directly (v1.8) and the two
 *   aggregations are supposed to agree field-for-field; a consumer reading one and then the other
 *   should not find the disclosure present in one and absent in the other. /feedback/range's byDay
 *   rows gain it too, beside the explicitUp/explicitDown/implicitUp they already carry.
 *   CONTEXT — THIS IS NOT THE 8/15 DASHBOARD BUG. The live dashboard showed EXPLICIT 👎: 27 on a
 *   day with zero explicit thumbs; the fix for that is in the DASHBOARD's renderer, which is not
 *   in this Worker (this Worker serves no HTML) and not in this repo. aggregate() already returns
 *   explicitDown: 0 for that day — verified against the real 35-row export in
 *   tests/dashboard-explicit-down.test.js. This change only removes the last reason a renderer
 *   would have to compute anything itself.
 *
 * v7.52: retroactive normalisation of pre-v9.7.541 'abandoned' rows that carry no meta — they
 *   never rendered a draft, so they re-render as 'incomplete'. Applied in aggregate() AND in the
 *   /feedback/range byDay loop, which counts raw entries itself. Mirrors reporter v1.11.
 *
 * v7.51: per-bucket explicit/implicit down split (byStore/byPersona/byLeadSource/byFlag), so a
 *   renderer's 👎 column can stop merging a thumbs-down with a regen-then-abandoned session.
 *   Mirrors reporter v1.10.
 *
 * v7.50: mirrors reporter v1.9 — 'incomplete' (extension v9.7.541) excluded from every quality
 *   denominator; adds produced/usedRate. A session that never rendered a draft is a generate
 *   reliability signal, not a rejection.
 *
 * v7.49: EXPLICIT/IMPLICIT SPLIT surfaced from aggregate(), plus 'abandoned' recognition.
 *
 *   THE BUG, reproduced against two real production days. Any tile labelled "EXPLICIT" that
 *   renders ratings.up overstates by the entire implicit-copy count. ratings.up was never an
 *   explicit number: the extension's _lpFeedbackDeriveRating returns 'up' for an explicit
 *   thumbs-up AND for a copied-as-is draft, separated only by `signal`. So
 *   ratings.up === implicit_copy + explicit_up, by construction, every single day.
 *     8/8:  implicit_copy 244 + explicit_up 5  -> ratings.up 249  (Daily Report tile: 249)
 *     8/10: implicit_copy 445 + explicit_up 63 -> ratings.up 508  (Daily Report tile: 508)
 *   The live KV dashboard renders the same blended number but discloses it ("508 (+445 implicit
 *   copy)"); the 8AM Daily Report shows it bare. The arithmetic is identical in both -- this is
 *   one upstream ambiguity surfacing in two renderers, not two independent rendering bugs.
 *
 *   THE SECOND-ORDER PROBLEM, which is why the fix belongs here and not in a template: a
 *   renderer could infer the true count as (signals.explicit - ratings.down). That identity
 *   holds only while EVERY 'down' is explicit -- true until now purely because the implicit
 *   rejection paths were unreachable. Extension v9.7.540 makes them reachable, so that
 *   subtraction begins undercounting explicit ups the day the fleet updates. A renderer-side
 *   fix built on it would break silently and look correct.
 *
 *   CHANGES, all additive -- no existing field changes value or disappears, so the current
 *   Daily Report and KV dashboard keep working untouched until their templates are updated:
 *     - explicitUp / explicitDown  true thumb counts; use these for any "EXPLICIT" tile
 *     - implicitUp                 the copied-as-is count that was being folded in
 *     - ratings.abandoned          extension v9.7.540's rating for a generate never used;
 *                                  previously landed in `total` but in no bucket, silently
 *                                  deflating every rate
 *     - engaged / engagedShippedRate / engagedFirstTryRate
 *                                  abandoned-excluded basis, reproducing the pre-v9.7.540
 *                                  denominator so an existing chart series does not appear to
 *                                  collapse on fleet-update day. shippedRate/posRate/
 *                                  firstTryRate keep the all-rows denominator, which is the
 *                                  honest product metric now that it contains the unused drafts.
 *     - byDay gains abandoned / explicitUp / explicitDown / implicitUp
 *     - per-bucket (byStore/byPersona/byLeadSource/byFlag) gains the same abandoned handling
 *       and engaged rates, so per-store totals cannot drift from the top line
 *
 *   RENDERER-SIDE WORK STILL REQUIRED (leadpro-reporter, not in this file): point the
 *   "EXPLICIT 👍" tile at explicitUp, or keep the composite and relabel it with the disclosure
 *   the KV dashboard already carries. Both dashboards must be checked -- they share this
 *   computation.
 *
 *   Verified by tests/worker-aggregate.test.js (18/18) against functions sliced out of this
 *   file: both real days reproduce, the split reconstructs the old blend exactly, the stale
 *   inference is demonstrated failing on a post-v9.7.540 arc, and bucket totals reconcile.
 */
/**
 * Lead Pro — Cloudflare Worker v7.48 (OpenAI)
 *
 * v7.48: LATENCY REVIEW — ONE REAL FIX, ONE INSTRUMENTATION-ONLY CHANGE, AND A RETRACTION.
 *   Prompted by "a few long waits" against the 8/8 log window (13:04-13:19). What the log
 *   actually shows: 3 generations at 4443 / 5094 / 5335ms, feedback at 154-179ms, KV config
 *   reads at ~0ms, zero errors, zero retries, zero SAFE_FALLBACK, finish=STOP on all three.
 *   The worker is healthy. Of a 5309ms request, 4765ms (90%) is the single primary model call
 *   on ~9.4-11.1k input tokens at effort=low, and ~545ms (10%) is the phone-ask classifier.
 *   (1) EDGE CACHE TTL 604800s -> 120s. Unambiguous dead weight, and the one behavioural change
 *       here. edgeCacheKey() hashes today + systemText + userText, and the user prompt embeds
 *       "CURRENT TIME: h:mm AM/PM Central" from an UNROUNDED getMinutes() popup-side (verified
 *       in popup.js: _now_min = String(_cal_now.getMinutes()).padStart(2,'0')). The key turns
 *       over every clock minute, so a 7-day entry is unreadable ~60s after it is written. The
 *       log agrees: 3 MISS, 3 STORED, 0 HIT. 120s preserves the only case the key can serve —
 *       a double-clicked Generate or a retry inside the same minute, which otherwise buys a
 *       second model call — and stops the write amplification.
 *   (2) CLASSIFIER SKIP REASONS ARE NOW LOGGED. They were computed into classifyDiag and never
 *       printed; the only console.log lived in the running branch. That is why one of the three
 *       8/8 generations showed FINAL total == PRIMARY total with no CLASSIFY line and NOTHING in
 *       the log could say which gate skipped it — phoneOnFile false, or both drafts <=20 chars.
 *       The reason was reaching the popup as envelope._classify and dying there.
 *   (3) PHONE-ASK PREFILTER, SHADOW MODE ONLY, ZERO BEHAVIOUR CHANGE. The tempting fix is to
 *       regex-skip the classifier when a draft plainly contains no phone request. Its saving is
 *       ~545ms (measured twice: 5086-4539=547, 5309-4765=544) times the fraction of runs that
 *       could be safely skipped — and that fraction is UNKNOWN. Both runs on record returned NO;
 *       n=2 is not a rate, and the run rate itself was unmeasurable until (2). So the prefilter
 *       computes a verdict and logs agreement with the model, gating nothing. A false skip
 *       reintroduces the exact defect the classifier prevents (asking for a phone number already
 *       on the lead), so the gate ships only once wouldSkip is common AND miss has held at zero
 *       on real traffic. Note the ceiling honestly: CLASSIFIER_PROMPT_PREFIX names "just send the
 *       best one to use" as a positive and it contains no phone word at all — a regex covers that
 *       by a targeted alternative, not by understanding it.
 *   RETRACTED FROM THE PRIOR ANALYSIS: I attributed part of the wait to "6.3s of scrape
 *   stabilisation" from log99's [LP STABILITY DIAG] windowMs:6309. That number measures nothing
 *   of the sort. runStabilityDiagnostic is POLL_INTERVAL_MS=300 x MAX_POLLS=20 = ~6000ms BY
 *   CONSTRUCTION, fire-and-forget, DEV-only, and it starts AFTER the pre-scrape has already
 *   committed — it never blocks a generation and would read ~6300 on a fast lead and a slow one
 *   alike. The related "10.6s panel-warm to START" gap is wall-clock containing the agent
 *   navigating and clicking, not latency. Where the non-worker portion of the wait goes is
 *   therefore UNMEASURED; settling it needs a popup log from the same window or client-side
 *   timing that does not exist yet. Verified offline against the extracted real bytes: 30-case
 *   prefilter corpus (recall 15/15 on phone-ask phrasings incl. all three the classifier prompt
 *   names, 15/15 silent on non-asking drafts), and an edge-key test proving the key changes
 *   across a one-minute boundary and is stable within it. No deploy — worker ships separately.
 * v7.47: REGRESSION IN THE v7.45/7.46 GUARD — not a pre-existing bug; the degenerate-field
 *   guard shipped in v7.45 and extended in v7.46 introduced this, and the version history is
 *   the only reason it was traceable at all. LIVE, all three tiers, 8/6. The daily report
 *   moved against 8/5 in three places at once: completion 99.7% → 98.8%, fallback hits 1 → 13,
 *   failures 5 → 22. Worker logs for 8/6 tabulate 27 tier failures, 26 of them "Degenerate
 *   field content (finish=stop)" — 12 PRIMARY, 8 FALLBACK, 7 EMERGENCY (the 27th was a lone
 *   12s PRIMARY timeout, unrelated and not addressed here). At 21:13-21:15 UTC six consecutive
 *   requests failed all three tiers and shipped SAFE_FALLBACK — the agents got the canned
 *   message instead of a draft. All three models rejecting identically, including gpt-4.1-nano
 *   from outside the GPT-5 family, ruled out model flakiness and pointed at deterministic
 *   input-driven rejection.
 *   ROOT CAUSE: hasDegenerateField treated the three fields inconsistently. voicemail was
 *   explicitly exempted when empty (`.trim().length > 0 &&`); sms and email were not — and
 *   isDegenerateFieldValue returns true on `trimmed.length === 0`. So ANY legitimately empty
 *   sms or email field rejected the ENTIRE response, at every tier, every retry. Real leads
 *   produce exactly that: an SMS-opt-out lead where only email should send, a DNE lead where
 *   only SMS should, a lead with no email on file. Deterministic, which is precisely why the
 *   21:13 retries clustered instead of recovering.
 *   FIX: judge only fields that HAVE content — sms and email are now exempted when empty on
 *   the same terms voicemail already was. An intentionally empty field is a valid scenario,
 *   not a degenerate one. Both bugs the guard exists for are NON-empty (a bare "{", and a
 *   complete {"subject":"..."} object), so this does not weaken it — verified, not assumed.
 *   W2 NOT RE-OPENED: individually-legitimate empties must not add up to a wholly empty
 *   response, so an explicit all-present-fields-empty check now sits in hasDegenerateField.
 *   MIN_CONTENT_CHARS (150) does catch the canonical 36-char {"sms":"","email":"",
 *   "voicemail":""} shape and fires FIRST in guard order — measured, it is the guard actually
 *   doing that work — but it is a total-LENGTH check, so an all-empty response padded past
 *   150 chars by any other key slips it. That padded shape was caught by the old blanket
 *   empty-rejection and would have been re-opened by this fix alone; the new check closes it
 *   at the field layer where it belongs, independent of total length.
 *   DIAGNOSTICS: the failure line was bare "Degenerate field content (finish=stop)", which is
 *   why this took a report-level anomaly to notice and inference to diagnose. It now carries
 *   the offending field name and a whitespace-collapsed sample of the rejected value, HARD
 *   TRUNCATED at 40 chars — these logs are retained and reviewed, and a full email body in a
 *   Worker log is customer content in a place it does not belong. 40 chars is plenty to tell
 *   "" from "{" from '{"subject":...'. For email the sample is taken from the body AFTER the
 *   "Subject: ...\n\n" strip — the same string the guard actually judged, and sampling the
 *   raw value instead would have spent all 40 chars on the subject line. Existing prefix kept
 *   verbatim so anything keyed on "Degenerate field content" still matches.
 *   VERIFIED by extracting the guards from the shipped file and running 13 constructed
 *   payloads before and after: 3 legitimate-empty shapes go REJECTED → ALLOWED, the 5 shapes
 *   the guard exists for (bare brace, complete-JSON body, punctuation-only, 3-char sms,
 *   all-fields-empty) plus the two padded all-empty probes stay REJECTED, and both controls
 *   (all-real, empty-voicemail-only) still pass. 13/13 after, 10/13 before.
 *   WHAT MIGHT BREAK: a tier that returns a genuinely empty sms or email for the WRONG reason
 *   (a reasoning burn that happens to blank one field while filling another) is now allowed
 *   through where it previously fell to the next tier. That is the intended trade — the shape
 *   is indistinguishable from the legitimate opt-out case at this layer, and the wholly-empty
 *   version is still caught. Expect fallback hits and the degenerate-failure count to return
 *   to 8/5 levels; if they do not, the new field/sample suffix says which field and what it
 *   contained, in one line.
 *
 * v7.46: NEAR-MISS on v7.45's length threshold, live incident. Daniel/Samantha Gonzalez
 *   (Community Kia Baytown, 8/5): rawEmail came back as `"Subject: A quick note about your
 *   inquiry\n\n{"subject":"White Telluride Hybrid search"}"` — same failure family as v7.45
 *   (Adhhd Adjjdjd), but this time the model got 3 characters further before aborting, and
 *   v7.45's "starts with {/[ and under 40 chars" rule was a length HEURISTIC standing in for
 *   the real question — is this JSON or prose — so a 43-char body slipped straight past it.
 *   Added a length-independent check alongside the original: if the body starts with {/[ AND
 *   the WHOLE thing parses as complete, valid JSON, it's degenerate regardless of size — real
 *   prose is never valid JSON at any length. Kept the original short-aborted check too: a bare
 *   "{" (the v7.45 case) does NOT parse as valid JSON on its own, so the new check alone would
 *   NOT have caught it — the two conditions cover different halves of the same failure family.
 *
 * v7.45: PER-FIELD DEGENERATE-CONTENT GUARD. Adhhd Adjjdjd (Community Kia Baytown, 2026 Kia
 *   Carnival EX, lead 2061639103, 8/4): rawEmail came back as `"Subject: Your Carnival EX
 *   offer\n\n{"` — the entire body was a single unclosed brace. finish=STOP (the model ended
 *   generation on its own, not a token-limit cutoff), and the outer JSON was syntactically
 *   valid, so it sailed past both existing guards: MIN_CONTENT_CHARS (502 chars total — the
 *   sms field alone carried the length) and isParseableJson (the envelope parses fine; only
 *   one field's VALUE is garbage). W2 (v7.30) caught the all-fields-empty shape; this is the
 *   same failure family at single-field granularity, and needed its own check.
 *   Added hasDegenerateField(text): parses the response, and for sms/email (voicemail too
 *   when present) rejects a field whose content — after stripping "Subject: ...\n\n" for
 *   email — is empty, is made ONLY of braces/brackets/quotes/punctuation/whitespace (the
 *   exact "{" shape above), looks like an aborted nested-JSON open (starts with { or [ and is
 *   under 40 chars — the same shape as the v9.7.511 double-JSON-encoding bug on the extension
 *   side, caught here one step earlier before it ever leaves the Worker), or is under a
 *   field-type floor (25 chars email, 15 sms — both well under any real minimal draft).
 *   Wired into callOpenAI right alongside isParseableJson: on failure, returns ok:false with a
 *   descriptive error and lets the EXISTING cascade do the recovery — no new regen path, no
 *   new cache-exemption tracking to get wrong. A tier that produces a degenerate field is
 *   treated exactly like a tier that produces truncated/unparseable JSON, which already
 *   correctly falls through to the next model and is already excluded from the edge cache.
 *   Deliberately does NOT flag on a short-but-real message (e.g. the single-question
 *   stall-recovery style already in use) — thresholds are floors far below anything seen in
 *   real drafts, not a quality bar.
 *
 * v7.44: STATIC-HEAD CACHE BREAKPOINT — pairs with extension v9.7.521/518, and layered ON TOP
 *   of v7.43 rather than replacing it (v7.43's merge of the /feedback/* KV parallelization and
 *   the D1/D2/D3 defect fixes is untouched and verified still present).
 *   v7.41/42 put the breakpoint at the END of the system message. Correct, but it cached a
 *   SEPARATE prefix per persona/agent/store: live data showed sysChars varying 19,629-22,010,
 *   only 35% of requests warm (43 of 123), ~80 writes bought for ~43 reads — barely net-positive
 *   at the 1.25x write rate. The ~4,449-token static head is byte-identical across every
 *   persona/agent/store/day, but that boundary lived in the extension only as a JS SOURCE
 *   COMMENT, never delivered, so the Worker had nothing to split on. The extension now emits a
 *   sentinel there; splitting on it gives every request ONE shared prefix.
 *   Integrated with v7.42's D2 fix: the split sets _bpApplied, so prompt_cache_options stays
 *   bound to whether a breakpoint actually attached. D1's retention gating is untouched.
 *   SENTINEL IS STRIPPED on FALLBACK/EMERGENCY, which do not take the splitting path — without
 *   that it would ride into the system prompt as literal junk on the degraded path (caught in
 *   testing on the extension-side build before ship).
 *   BACKWARD COMPATIBLE BOTH WAYS: no sentinel falls back to v7.41/42 end-of-system behaviour,
 *   so Worker and extension deploy in either order. Guards the 1,024-token minimum.
 *   Expect the WARM RATE to rise above 35%; per-request cached_tokens share stays bounded by the
 *   same ~22-49% ceiling (system tokens over total) since the per-lead prompt dominates.
 * v7.43: MERGE — two independent lineages had both been tagged v7.41 off the same v7.40 base
 *   and diverged without either seeing the other: (a) this file's v7.41/v7.42, the GPT-5.6
 *   explicit-cache-breakpoint work plus its v7.42 defect fixes (D1/D2/D3, external review);
 *   (b) a separate v7.41 that parallelized the three /feedback/* KV read loops
 *   (/feedback/range, /feedback/summary, /feedback/drafts) — each was doing one `await get()`
 *   per key in series, which on a real diagnostic pull (8/1, 7-day range) was 1,564 chained
 *   gets and 17.4s wall time (a same-shape call the day before hit 20.4s and got canceled
 *   client-side). This version has BOTH: the cache-breakpoint/D1-D2-D3 work untouched, and the
 *   KV gets in all three /feedback/* handlers now `Promise.all(page.keys.map(key =>
 *   env.LEADPRO_LICENSES.get(key.name)))` per page instead of the serial loop. Deploying either
 *   sibling alone would have silently regressed the other's fix — verified this file has both
 *   before shipping. Nothing else from either lineage was touched.
 *
 * v7.42: THREE DEFECTS IN v7.41's BREAKPOINT WORK (external review). v7.41's diagnosis and
 *   core fix are correct and stand — this only closes gaps around them.
 *   (1) MUST-FIX: prompt_cache_retention was still sent UNCONDITIONALLY, including to Luna,
 *       where it is DEPRECATED. v7.41 carefully gated the 5.6-only fields away from older
 *       models but missed the same trap in the other direction. Now pre-5.6 tiers only.
 *   (2) prompt_cache_options.mode='explicit' was set independently of whether a breakpoint
 *       actually got attached. Since a request with no explicit breakpoint does not use
 *       prompt caching AT ALL, any future change to the message shape would have silently
 *       disabled caching for the primary tier, indistinguishable from a cold start. The two
 *       are now bound together, with a warning on the fallback path.
 *   (3) The classifier's prompt_cache_key/retention are inert (~100-token prefix, well under
 *       the 1,024 minimum, and the variable text precedes the suffix). Documented, not
 *       deleted, so they are not later mistaken for working caching.
 *   NOT CHANGED — needs measurement first: promptCacheKey() returns ONE key fleet-wide. The
 *   docs cap a single key at ~15 requests/minute before requests start missing cache. The
 *   v7.39 "coarse is correct" reasoning still holds (hashing the full prompt remains a
 *   regression); the fix, if the rate warrants it, is partitioning into a SMALL fixed number
 *   of keys by a stable dealerId/agent hash — all still sharing the identical static head.
 *   Log per-key request rate before touching it.
 *
 * v7.41: GPT-5.6 PROMPT CACHE BREAKPOINTS — we were not set up for 5.6's caching semantics,
 *   and this CORRECTS a wrong conclusion I gave earlier. GPT-5.6 caches at BREAKPOINTS and,
 *   unlike earlier models, does NOT fall back to the longest matching unmarked prefix. The
 *   default implicit breakpoint sits on the LATEST user message — for us the ~8-9k-token
 *   per-lead prompt — so the entire [system+user] had to match byte-for-byte to hit. That
 *   exactly explains the bimodal pattern the v7.39 instrumentation captured: 91-99% cached on
 *   an immediate identical repeat of the same lead, a hard 0% on every distinct lead, never
 *   partial. I attributed that gap to cache RETENTION and told Gil the prompt layout was fine
 *   and not worth touching. Wrong on the cause: it was the missing breakpoint. The layout
 *   advice happened to stay correct, but for the wrong reason.
 *   COST, not just missed savings: on 5.6 cache WRITES bill at 1.25x the uncached input rate.
 *   With the implicit breakpoint at the end of a volatile prompt, we were likely writing a
 *   ~13k-token prefix on most requests that could never be read again — a real regression
 *   introduced by the Luna switch, invisible because cache_write_tokens was never logged.
 *   CHANGES: (1) explicit prompt_cache_breakpoint at the end of the system message (~4,449
 *   tokens, comfortably over the 1,024-token minimum); (2) prompt_cache_options.mode='explicit'
 *   to disable the implicit breakpoint so we stop paying to write the per-lead suffix;
 *   (3) cache_write_tokens now logged alongside cached_tokens, so writes can be weighed against
 *   reads — high writes with low reads would mean the breakpoint is misplaced.
 *   GATING TRAP, worth stating explicitly: prompt_cache_options and prompt_cache_breakpoint are
 *   REJECTED WITH 400 by pre-5.6 models. The existing spec.gpt5 flag is TRUE for gpt-5.4-nano
 *   too, so using it as the gate would have 400'd the FALLBACK tier during exactly the
 *   incidents where the fallback is needed. Added a separate per-tier cacheBreakpoints flag set
 *   only on Luna; both older tiers receive a byte-for-byte unmodified payload.
 *   REGEN BONUS: the regen call sends systemText + REGEN_CONSTRAINT_TEXT concatenated. The
 *   system message is split into two blocks with the breakpoint after the BASE system text, so
 *   a regen now reads the SAME cached prefix as the original call instead of writing a second
 *   near-identical one.
 *   VERIFIED by simulating payload construction for all three tiers and both call paths: Luna
 *   normal gets one system block with the breakpoint and an untouched user message; Luna regen
 *   gets two blocks with the breakpoint after the base system text and NOT on the constraint,
 *   with block 0 byte-identical to the normal call's system text (so the prefix is shared);
 *   fallback and emergency get no prompt_cache_options and a plain-string system message.
 *   NOTE: prompt_cache_key is unchanged and is now REQUIRED on 5.6 for the reliable matching —
 *   the coarse 200-char key remains correct (it routes all traffic to one backend). Per-key
 *   traffic guidance is ~15 req/min; our peak hour measured ~4.75/min, so a single key is fine.
 *   Expect cached_tokens to rise from ~15-20% toward the ~34% structural ceiling (system tokens
 *   over total), NOT to 100% — the per-lead prompt legitimately dominates and is uncacheable.
 * v7.40: TIMEOUT-FLOOR CORRECTION from an external code review (finding S3). Both cascade
 *   admission gates checked `remaining < MIN_TIMEOUT_MS` (2500) but the very next line computes
 *   `Math.min(spec.timeout, remaining - TIMEOUT_SLACK_MS)` — so a tier admitted at exactly
 *   remaining==2500 actually ran with a 2200ms timeout, 300ms below the floor the gate was
 *   expressing. Fixed in the main cascade (789) and the regen path (848) to gate on
 *   MIN_TIMEOUT_MS + TIMEOUT_SLACK_MS. Re-verified worst case is unchanged: 12000 + 8000 + 3700
 *   = 23700ms of the 24000ms budget, all three tiers intact. Cosmetic in practice, but the gate
 *   now means what it says. No other v7.39 behavior touched.
 * v7.39: LUNA TUNING PASS, driven by the first full day of real v7.38 traffic (7/31, 1516
 *   requests). Four changes:
 *   (1) TIMEOUT REBALANCE — the 10s primary timeout had become the binding constraint. Luna's
 *       measured PRIMARY-call latency that day: median 4815ms, P95 8180ms, P99 9615ms, max
 *       9798ms — the tail was landing within ~200-400ms of the ceiling, so most of that day's
 *       27 fallback hits were requests still working that would have returned shortly after.
 *       Under the previous primary (gpt-5.4-nano, faster) 10s was comfortable; under Luna it
 *       was marginal. Primary 10000→12000ms. Fallback 10000→8000ms, which is REQUIRED, not
 *       incidental: at 12000+10000 the worst case leaves only 2000ms of the 24000ms budget,
 *       below MIN_TIMEOUT_MS (2500), and the emergency tier would be SKIPPED entirely.
 *       Verified by simulating the actual cascade arithmetic — worst case is now
 *       12000+8000+3700 = 23700ms with all three tiers intact, and both of the day's tail
 *       figures (9615ms, 9798ms) now complete on primary instead of timing out.
 *   (2) EMERGENCY TIER BACK OUT OF THE GPT-5 FAMILY — gpt-5.4-mini → gpt-4.1-nano, restoring
 *       the cross-family backstop v7.38 knowingly gave up. 7/31 produced the first real
 *       evidence it matters: at 17:06 UTC four requests failed across ALL THREE tiers in
 *       73-243ms each — far too fast to be timeouts, consistent with a 429 or a provider-side
 *       event hitting one model family at once. gpt-4.1-nano is NOT a reasoning model
 *       (gpt5:false, temperature restored to 0.3), so its 2000-token budget carries no
 *       reasoning-token overhead — ample for the ~400-token JSON payload.
 *   (3) FAILURE DIAGNOSTICS — callOpenAI now returns the HTTP status on non-ok responses and
 *       the cascade FAIL log line includes it. The 17:06 event was undiagnosable from the
 *       daily report because only tier and latency were recorded, making a rate-limit and a
 *       5xx indistinguishable from a timeout. The next occurrence will name itself.
 *   (4) TRUNCATION GUARD — isLikelyJson() only inspects the FIRST character, so a response cut
 *       off mid-object still starts with '{' and passed as ok:true; the malformed JSON then
 *       failed to parse downstream rather than falling through to the next tier — the worst
 *       place to discover it, since emergency has nothing behind it. Added isParseableJson()
 *       (full JSON.parse, tolerates ```json fences) applied regardless of finish_reason, since
 *       a model can also emit malformed JSON on a clean STOP. Verified against a real truncated
 *       payload (old check passed it, new one rejects), valid JSON, fenced JSON, and prose.
 *   (5) CACHE SPLIT INSTRUMENTATION — logCacheHit() now logs sysChars/userChars, an estimated
 *       system-token count, the per-request ceiling (sysTokens/total), cachedOfSys (what share
 *       of the system prompt actually came back cached), and the routing key in use. The bare
 *       cached/total line could not distinguish "the shared prefix caches fine, the user prompt
 *       just dominates" (expected, unfixable, ~28-34% ceiling) from "the prefix is not being
 *       RETAINED" (TTL/backend affinity — a different problem). Those look identical as a low
 *       percentage and were being told apart by reading extension source rather than by data.
 *       A cachedOfSys near 100% on warm requests confirms the boundary is where the static
 *       read predicted; persistently ~0% with a stable key points at retention instead. Also
 *       labels the legitimate >100% case (an identical repeat caches past the system prompt
 *       into the user message — observed live 7/31 21:48, 0/9733 then 9730/9733 twenty-eight
 *       seconds later) so it is not misread as an arithmetic bug. Token counts are prorated
 *       from character share rather than re-tokenized — exact enough for the boundary question,
 *       and no tokenizer dependency for a log line. Backward compatible: called without the new
 *       arguments it emits exactly the old line. Diagnostic only, zero behavior change.
 *   CACHE-KEY CHANGE MADE, THEN REVERTED BEFORE DEPLOY — worth recording because the reasoning
 *   was backwards. I changed promptCacheKey() to hash the FULL system prompt, on the theory
 *   that personas sharing opening boilerplate were wrongly collapsing onto one key, and
 *   "verified" it by demonstrating exactly that collapse. Measuring the real prompt layout
 *   showed the collapse is the DESIGN: prompt_cache_key is a ROUTING hint, and what every
 *   request shares is buildSystemPrompt's ~4,449-token static head — byte-identical across
 *   every persona, agent, store and day (the extension marks the split point itself:
 *   "VARIABLE SUFFIX (changes per persona/agent/store — cache boundary here)"). A 200-char
 *   sample lands wholly inside that static head, so all traffic keys alike and routes to the
 *   same backend, keeping the shared prefix warm. Hashing the full prompt would have varied
 *   the key per persona/agent/store, scattering requests and making the shared head COLD more
 *   often — a regression, not a fix. Reverted; the original coarse key stands.
 *   CACHE HEADROOM, measured rather than assumed: the static head is ~4,449 of ~13,230 prompt
 *   tokens, so the structural ceiling is ~34%, against ~15.4% observed — the gap is cache
 *   RETENTION (TTL/backend affinity), not prompt layout. Reordering the user prompt would NOT
 *   help: the prefix already diverges upstream at the system prompt's variable suffix, so
 *   everything in the user message is past the break regardless of its order. Closing that gap
 *   properly would mean moving persona/agent/store out of the system prompt entirely so the
 *   whole system message is static — a load-bearing change (IDENTITY LOCK, persona voice) for
 *   roughly $5-6/month of token spend. NOT RECOMMENDED on that trade; documented so the next
 *   person does not re-derive it.
 *
 * v7.38: MODEL CASCADE UPDATED — primary gpt-5.4-nano → gpt-5.6-luna (Gil: "the price
 *   reduction on Luna makes this the best option"). Full cascade: primary gpt-5.6-luna,
 *   fallback gpt-5.4-nano (demoted from primary, proven workhorse), emergency gpt-5.4-mini
 *   (promoted from fallback). NOTE: this puts all three cascade tiers in the GPT-5 family —
 *   the previous emergency tier (gpt-4.1-nano) was deliberately a DIFFERENT family specifically
 *   as a backstop against the documented v7.30/W2 "GPT-5-family reasoning-burn failure shape"
 *   (empty/degraded output across an entire model family at once). That cross-family safety
 *   net is gone from this cascade as of this version — flagged to Gil before shipping, his
 *   call to proceed on the cost case. gpt-4.1-nano remains CLASSIFIER_MODEL (unchanged, binary
 *   YES/NO classification is a different failure surface). Emergency tier keeps the tighter
 *   token/timeout budget (2000/5000ms) that "last resort, most of TOTAL_BUDGET_MS already
 *   spent" implies, rather than inheriting gpt-5.4-mini's prior fallback-tier numbers
 *   (3500/10000ms) — a judgment call, not something Gil specified; worth a look if it feels
 *   off in practice.
 *
 * v7.37: License key validation is now case/whitespace-normalized (trim + uppercase) at the
 *   single choke point (validateLicenseRecord) instead of nowhere at all. Confirmed real gap
 *   from a live incident: Gil provisioned a fresh key for a new agent (Veronica Villanueva,
 *   "LP-EAB3HY6L") and it was rejected as "not recognized" on her login attempt. Provisioned
 *   keys are always uppercase (the /provision-license charset is A-Z/2-9 only), but the KV
 *   lookup (env.LEADPRO_LICENSES.get) is an exact case-sensitive string match, and nothing —
 *   not the client login form, not this function — ever normalized the entered key. A
 *   lowercase-typed (or copy-paste-with-whitespace) entry of a genuinely valid key silently
 *   failed as "License not found." Also fixed the /validate-license agentEmail write-back,
 *   which was writing under the RAW un-normalized request value instead of the key that
 *   actually matched — on a case-mismatched login this created a stray duplicate KV entry
 *   instead of updating the real record. Paired client-side fix (extension v9.7.471/466):
 *   the login screen's license-key placeholder said "LMPRO-XXXX-XXXX-XXXX," a stale format
 *   that never matched what /provision-license actually generates ("LP-XXXXXXXX") — likely
 *   contributing to agents second-guessing or reformatting a correct key. Verified the
 *   normalization against 5 input variants (exact, lowercase, mixed case, trailing space,
 *   leading/trailing whitespace) — all now resolve correctly.
 *
 * v7.36: /appointment-invite now enforces REQUIRE_LICENSE — it was the ONE route with no
 *   licenseKey check (open relay for dealership-branded invite emails via Resend to anyone
 *   with the URL). Mirrors the exact /generate and /feedback enforcement pattern, including
 *   the fleet-readiness console log while the flag is off, so pre-v9.7.462/457 extension
 *   builds are visible in logs before the flip. Extension side shipped in v9.7.462/457
 *   (payload wrapped in _lpAttachLicense). DEPLOY ORDER: this Worker is safe to deploy NOW
 *   (flag off = today's behavior + logging); flip REQUIRE_LICENSE='true' only after the
 *   fleet is confirmed on v9.7.462/457 — at that moment all three routes (/generate,
 *   /feedback, /appointment-invite) enforce together. NOTE: /validate-license and
 *   validateLicenseRecord (active/expired/Director-key checks) already existed — auth.js's
 *   client call in v9.7.462/457 lands on the real route immediately; its 404 fail-open
 *   never triggers against this Worker.
 *
 * v7.35: GET /valuefact accepts an optional ?year=YYYY param, narrowing returned incentive
 *   lines to that model year (companion to the extension's client-side _lpYearFilterIncentives
 *   fix — Toyota confirmed running 2025 AND 2026 Tundra incentives simultaneously, with year
 *   previously invisible to the client-side matcher's tokenizer). Fully backward-compatible:
 *   omitting ?year reproduces today's exact behavior; lines with no year tag (pre-migration KV
 *   data) always pass through regardless of the requested year. Nothing calls this with ?year=
 *   yet — safe to deploy ahead of the extension update that will start sending it.
 *
 * v7.34: Reminder alarms (from v7.33) now include the vehicle when known — "your 2026
 *   CR-V appointment tomorrow" instead of a generic nudge. Falls back to no vehicle
 *   phrase if vehicleText wasn't supplied.
 *
 * v7.33: Added VALARM reminders (1 day + 1 hour before) directly into the appointment
 *   invite .ics — guaranteed to fire on the customer's calendar regardless of their own
 *   app's default reminder settings, rather than relying on client-side defaults.
 *
 * v7.32: Fixed InvalidCharacterError on real sends — buildICS's SUMMARY line used a
 *   Unicode en-dash, which raw btoa() cannot encode (Latin1-only). Replaced with a
 *   UTF-8-safe base64 encoder (utf8ToBase64) and swapped the en-dash for a plain hyphen.
 *   Root cause confirmed via live Worker logs (InvalidCharacterError on first real send).
 *
 * v7.31: APPOINTMENT INVITE. New POST /appointment-invite endpoint — generates an .ics
 *   calendar attachment for a booked appointment and emails it to the customer via Resend.
 *   Logs each send to LEADPRO_LICENSES KV under invite:<leadId>:<ts> (90-day TTL, mirrors
 *   feedback: pattern). Sender: appointments@notify.mycommunityauto.com (verified domain).
 *   Requires secret: RESEND_API_KEY.
 *
 * v7.30: FINAL-AUDIT FIX BATCH — worker side of the Fable 5 last-chance audit (W1/W2/W3/W5/W6).
 *   W1  A positively-flagged phone-ask draft can no longer be edge-cached. The store condition was
 *       (i===0 && !regenerated); when the classifier flagged a draft and the regen then FAILED
 *       (timeout/budget) — or the classifier itself errored — regenerated stayed false and the
 *       known-bad draft was cached for 7 days, served on every HIT with the classifier never
 *       running again. New `flagged` / `classifyFailed` trackers gate the cache.put.
 *   W2  Degraded-response guard restored: MIN_CONTENT_CHARS 2 → 150. An empty-fields JSON
 *       ({"sms":"","email":"","voicemail":""}, 38 chars) passed isLikelyJson, shipped with finish
 *       STOP, and rendered three empty boxes with no error and no tier fallback — the known
 *       GPT-5-family reasoning-burn failure shape. A real minimal draft is always well over 150.
 *   W3  AUTH. All /feedback/* GETs (summary, range, drafts — drafts contains customer PII) now
 *       require a DIRECTOR key via ?key= or X-LP-Key header, enforced immediately (only the
 *       director queries these). POST /generate and POST /feedback require a valid licenseKey in
 *       the body when env.REQUIRE_LICENSE === 'true' — DEPLOY ORDER: ship extension v9.7.377/379
 *       (which attaches the key) to the whole fleet FIRST, then flip the flag; until then the
 *       worker logs missing keys for fleet-readiness visibility without rejecting. The /feedback
 *       KV key now uses a SERVER timestamp (attacker-chosen ts+id could overwrite entries;
 *       client ts is preserved in the value). X-LP-Key added to CORS allow-headers.
 *   W5  CENTRAL-day basis (same class as the cross-midnight reporter bug, fixed once in v7.29 for
 *       /feedback/drafts only): edgeCacheKey daily rotation, GET /valuefact expiry comparison,
 *       and syncValueFacts expiry filtering all moved from UTC-today to centralTodayStr() —
 *       incentives no longer die at 7 PM CT on their last (month-end-critical) evening.
 *   W6  (a) Cron valuefact blob keeps the MAX line expiry instead of MIN — one incentive expiring
 *       tomorrow no longer suppresses the store's entire fact set; tradeoff: a single line can
 *       linger ≤24h past its own expiry until the daily cron heals it (better failure mode).
 *       (b) Same-key clobber guard: the cron now skips a dealer whose valuefact blob is a
 *       same-day Data Tool upload (v7.26 shape, has .incentives) instead of silently overwriting
 *       it. (c) /list-licenses filters feedback:* keys out of its unprefixed list() — with 90-day
 *       feedback retention it was parsing feedback objects as "licenses" and burning ~1000 KV gets.
 *
 * v7.29: GET /feedback/drafts is now CENTRAL-day aware. Keys carry a UTC timestamp, so a Central
 *   calendar day spans a UTC window crossing two UTC dates (e.g. CDT 6/15 = UTC 6/15 05:00 →
 *   6/16 05:00) — which is why a late-evening pair captured at 9:52 PM CT landed under 2026-06-16.
 *   The endpoint now resolves date= as a Central day (DST-correct via America/Chicago), lists both
 *   overlapping UTC-date prefixes, and filters to the exact instant window, so you query the day you
 *   mean with no UTC math. Response gains "tz":"America/Chicago". ONLY this endpoint changed; the
 *   reporter cron and the summary/range endpoints stay on their existing UTC basis (unchanged).
 *
 * v7.28: 👎/correction draft capture (read + store side). Pairs with extension v9.7.311.
 * v7.26: Data Tool uploads (inventory + valuefact, model-keyed incentives w/ per-line expiry).
 * v7.25: Tier-B value-fact store + daily CSV sync cron.
 * v7.24: Phone-ask regen is a surgical EDIT, not a blank-slate rewrite.
 * v7.23: Per-request reasoning effort (COMPLEXITY ROUTER).
 * v7.22: HONEST QUALITY METRICS in feedback aggregation (shipped/firstTry/down).
 *
 *   primary    — gpt-5.6-luna   (12s timeout as of v7.39 — Luna’s P99 is ~9.6s)
 *   fallback   — gpt-5.4-nano   (8s timeout as of v7.39, to preserve budget for emergency)
 *   emergency  — gpt-4.1-nano   (RESTORED v7.39 — deliberately OUTSIDE the GPT-5 family so a
 *                                family-wide provider event cannot take out all three tiers)
 *   classifier — gpt-4.1-nano   (binary YES/NO, fastest cheapest — unchanged)
 *
 * Secrets:    OPENAI_API_KEY (required)
 *             DIRECTOR_KEYS  (optional — comma-separated dev fallback keys)
 *             RESEND_API_KEY (required for /appointment-invite — v7.31)
 * KV (req.):  LEADPRO_LICENSES   — agent license records
 * KV (opt.):  LEADPRO_REGISTRY   — source registry storage
 */

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

const REASONING_EFFORT = 'low';
const VERBOSITY        = 'low';

// (v7.61) The efforts GPT-5.6 actually supports, weakest to strongest. Ordered so a tier that
// cannot take a requested effort can degrade to its nearest supported neighbour rather than 400.
const EFFORT_LADDER = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
// What each tier will accept. Deliberately per-tier: 'none' and the two high efforts are
// 5.6-family features, and a 400 on the FALLBACK tier is worse than a weaker answer — it turns a
// recoverable primary failure into a SAFE_FALLBACK for the caller.
const TIER_EFFORTS = {
  'gpt-5.6-luna':            ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  // (v7.62) 'none' ADDED. The GPT-5.4 guidance states that 5.4 supports 'none' as its lowest
  // reasoning effort and that it is the DEFAULT for the family; the parameter-compatibility note
  // contrasts 5.4/5.2 against "older GPT-5 family model such as gpt-5, gpt-5-mini, or gpt-5-nano",
  // placing 5.4-nano in the newer group, and the migration table maps gpt-4.1-nano -> gpt-5.4-nano.
  // WHY THIS MATTERED: the probes ask for 'none' (v9.7.571). With 'none' missing from this list the
  // resolver degraded them UPWARD to 'low' on the fallback tier — the probe paid for reasoning it
  // had explicitly declined, on the slow path, exactly when the primary had already failed.
  // WHY WIDENING IS SAFE HERE, since this is an inference from a doc and not a measurement: an
  // unsupported value returns 400, 400 is NOT in the fatal set (401/403/404), so the ladder simply
  // continues to the emergency tier. The cost of being wrong is one fast wasted call, and
  // resolveEffort logs the substitution either way. It is one list entry to revert.
  'gpt-5.4-nano-2026-03-17': ['none', 'low', 'medium', 'high'],
  'gpt-4.1-nano':            []      // not a reasoning model; the field is not sent at all
};
// Resolve a requested effort for one model. Returns the effort to send plus WHY, so the caller
// can log a substitution instead of performing one invisibly.
// (v7.63) TIER-AWARE ESCALATION — this is the guard that v9.7.219 did not have.
// v9.7.219 removed a complexity reasoning router because "medium reasoning blew through the
// entire cascade — PRIMARY timing out at 10000ms, FALLBACK also timing out, leads landing on
// SAFE_FALLBACK after 23s". The root cause was NOT that medium is too slow for the primary tier.
// It was that the elevated effort was applied to EVERY tier, so when the primary timed out the
// fallback was ALSO reasoning hard and timed out behind it, and the emergency tier could not
// cover a 23-second hole. An expensive draft became no draft at all.
//
// THE RULE: an effort ABOVE the baseline is a request for the PRIMARY tier to think harder. It is
// never applied to the recovery tiers, which exist to return something quickly after the primary
// has already failed. An effort AT OR BELOW the baseline (the probes' 'none') still applies
// everywhere, because it makes the recovery tiers faster, not slower.
//
// So a regen gets ONE high-effort attempt on the full primary budget; if that times out, the
// fallback answers at 'low' and the agent gets a real draft. The v9.7.219 failure mode is
// structurally unreachable: a slow escalation costs latency, never a SAFE_FALLBACK.
function isEscalation(want) {
  const b = EFFORT_LADDER.indexOf(REASONING_EFFORT);
  const w = EFFORT_LADDER.indexOf(String(want || '').toLowerCase());
  return w > b && b >= 0;
}
function resolveEffort(model, requested, tier) {
  const want = String(requested || '').toLowerCase();
  const supported = TIER_EFFORTS[model];
  // ORDER MATTERS. The "tier takes no reasoning_effort" test comes FIRST: an earlier draft of this
  // function ran the escalation clamp above it and so returned 'low' for the non-reasoning
  // emergency tier — reintroducing, one layer up, the exact bad-field-on-a-non-reasoning-model
  // failure that v7.61 added this table to prevent. Caught by the suite, not by review.
  if (!supported || !supported.length) return { effort: null, note: 'tier takes no reasoning_effort' };
  if (tier && tier !== 'primary' && isEscalation(want)) {
    return { effort: REASONING_EFFORT,
             note: 'ESCALATION "' + want + '" is primary-tier only — recovery tiers stay at "'
                   + REASONING_EFFORT + '" (v9.7.219: escalating every tier produced SAFE_FALLBACK)' };
  }
  if (!want)                      return { effort: REASONING_EFFORT, note: 'defaulted (none requested)' };
  if (EFFORT_LADDER.indexOf(want) < 0)
    return { effort: REASONING_EFFORT, note: 'UNKNOWN effort "' + want.slice(0, 16) + '" — not a GPT-5.6 value' };
  if (supported.indexOf(want) >= 0) return { effort: want, note: '' };
  // Supported by the family but not this tier: step toward it along the ladder.
  const wantIx = EFFORT_LADDER.indexOf(want);
  let best = supported[0], bestDist = Math.abs(EFFORT_LADDER.indexOf(best) - wantIx);
  supported.forEach(function (e) {
    const d = Math.abs(EFFORT_LADDER.indexOf(e) - wantIx);
    if (d < bestDist) { best = e; bestDist = d; }
  });
  return { effort: best, note: 'tier cannot take "' + want + '" — nearest supported is "' + best + '"' };
}

const MODEL_CASCADE = [
  { model: 'gpt-5.6-luna',            tokens: 3500, timeout: 12000, temperature: null, tier: 'primary',   gpt5: true,  cacheBreakpoints: true  },
  { model: 'gpt-5.4-nano-2026-03-17', tokens: 3500, timeout:  8000, temperature: null, tier: 'fallback',  gpt5: true,  cacheBreakpoints: false },
  { model: 'gpt-4.1-nano',            tokens: 2000, timeout:  5000, temperature: 0.3,  tier: 'emergency', gpt5: false, cacheBreakpoints: false },
];

const TOTAL_BUDGET_MS    = 24000;
const MIN_TIMEOUT_MS     = 2500;
const TIMEOUT_SLACK_MS   = 300;
// (v7.64) Primary-tier timeout for an ESCALATED request only (a regen). See the comment at the
// tier loop for why this exists and what it trades away.
const ESCALATED_PRIMARY_TIMEOUT_MS = 18000;
const DEFAULT_MAX_TOKENS = 2500;
const MAX_TOKEN_CAP      = 8192;
const MIN_CONTENT_CHARS  = 150;
// ── (v7.58) RESPONSE CONTRACTS ────────────────────────────────────────────────────────────
// Every content guard below MIN_CONTENT_CHARS was written for ONE response shape: a three-field
// customer draft. That was the only shape this Worker served until the extension's comprehension
// observer started asking it a one-fact question, whose correct answer is 40 characters long.
// The guards did exactly what they say and rejected it at every tier, forever.
//
// The contract is declared by the REQUEST, not inferred from the response. Inferring it would
// mean "a response with no sms/email/voicemail key isn't a draft, so judge it loosely" — which
// is precisely the enumeration trap this codebase keeps getting caught by, and it would wave a
// genuinely broken draft straight through. Declaring it means the strict path is the default and
// an unknown, malformed or absent value falls back to 'draft'. A caller cannot loosen the draft
// guards by accident, only by asking for a different contract by name.
const RESPONSE_CONTRACT_DRAFT   = 'draft';
const RESPONSE_CONTRACT_FACT    = 'fact';
const RESPONSE_CONTRACTS        = [RESPONSE_CONTRACT_DRAFT, RESPONSE_CONTRACT_FACT];
function normalizeContract(v) {
  return RESPONSE_CONTRACTS.indexOf(v) >= 0 ? v : RESPONSE_CONTRACT_DRAFT;
}
// The 'fact' floor. Not a length — a length is the wrong instrument for a short answer, which is
// how we got here. A usable fact answer is a JSON OBJECT WITH AT LEAST ONE KEY. That still
// rejects everything the length floor was actually catching on this path: "", "{}", "[]", a bare
// "{" (unparseable), and a reasoning burn that returns nothing.
function factContractFailure(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { return 'not JSON'; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'not a JSON object';
  if (Object.keys(parsed).length === 0) return 'empty JSON object';
  return null;
}
// (v7.45) Per-field floors — deliberately far below any real minimal draft (the shortest
// legitimate sms in production logs runs well over these). These exist to catch a field that
// never really started, not to enforce a quality bar.
const MIN_FIELD_CHARS_EMAIL = 25;
const MIN_FIELD_CHARS_SMS   = 15;
// (v7.47) Hard cap on how much of a rejected field value reaches the failure log. Enough to
// identify the failure shape, far too little to leak a draft. Do not raise this.
const DEGENERATE_SAMPLE_CHARS = 40;

const CLASSIFIER_MODEL      = 'gpt-4.1-nano';
const CLASSIFIER_TIMEOUT_MS = 3000;
const CLASSIFIER_MAX_TOKENS = 4;
const CLASSIFIER_TEMP       = 0.0;
const REGEN_CONSTRAINT_TEXT =
  "\n\n━━━ CRITICAL OVERRIDE — EDIT, DON'T REWRITE ━━━\n" +
  "Your previous draft (the assistant message below) asked the customer for a phone " +
  "number, but their phone IS ALREADY ON FILE. Return the SAME JSON with ONLY the " +
  "phone-number request removed — never ask for, mention, or reference a phone number " +
  "in any form. Do not write 'send me your number', 'what's the best number', " +
  "'I don't have a phone number on file', 'send the best one', or any variation. " +
  "Preserve every other field and every other sentence exactly as written: same " +
  "substance, same tone, and ESPECIALLY any status facts the draft already stated — a " +
  "vehicle that is SOLD or no longer available, a placed deposit, another agent working " +
  "the deal, a pending approval. Do NOT soften, drop, or talk around those facts. Do NOT " +
  "add appointment offers, pivots, or new angles the draft did not already have. Output " +
  "the complete JSON object with all original fields. Change only the phone-number ask.\n" +
  "━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";

const CACHE_KEY_PREFIX = 'lp';
// (v7.61) The retention hint, in the field the 5.6 families take. '24h' was the value carried by
// the deprecated prompt_cache_retention; the guidance notes 5.6 governs retention through
// prompt_cache_options.ttl instead, where '30m' is currently the only supported value. Sending an
// unsupported ttl risks a 400 on the primary tier, so this is set to the documented value rather
// than the old one — and named CACHE_TTL so nothing silently keeps meaning "retention".
const CACHE_TTL        = '30m';
// (v7.64) The pre-5.6 field, restored for the two older tiers and the classifier. This is not a
// deprecated leftover — it is the field those models accept, and sending them the 5.6 field
// instead is what took the recovery ladder down between v7.61 and v7.64.
const CACHE_RETENTION_LEGACY = '24h';

// (v7.48) TTL CUT FROM 604800s (7 DAYS) TO 120s. The old value could never be reached:
// edgeCacheKey() hashes centralTodayStr() + systemText + userText, and the USER prompt
// carries "CURRENT TIME: <h>:<mm> <AM/PM> Central", built popup-side from an unrounded
// getMinutes(). The key therefore turns over every clock minute, so an entry written with a
// 7-day TTL is unreadable roughly 60 seconds after it is stored. Measured on the 8/8 log:
// 3 generations, 3 MISS, 3 STORED, 0 HIT — the cache was pure write amplification.
// 120s keeps the ONE case the key can actually serve — a double-clicked Generate or a client
// retry landing inside the same minute, which would otherwise pay for a second model call —
// and stops hoarding entries nothing will ever read. If [EDGE-CACHE] HIT stays at zero over a
// real week, delete the lookup and the store outright; the log line is what tells you.
const EDGE_CACHE_TTL = 120;

const DEALER_INFO = {
  '6189':  { name: 'Community Toyota',          address: '4701 East Fwy, Baytown, TX 77521',
             mapsUrl: 'https://maps.app.goo.gl/sEhPfmP56MobvuKh9' },
  '6191':  { name: 'Community Honda',           address: '5700 East Fwy, Baytown, TX 77521',
             mapsUrl: 'https://maps.app.goo.gl/XqzEaJaNu1KETued7' },
  '6190':  { name: 'Community Kia',             address: '4141 East Fwy, Baytown, TX 77521',
             mapsUrl: 'https://maps.app.goo.gl/Tjvo2UmxZPRskfZM6' },
  '24399': { name: 'Community Honda Lafayette', address: '2503 SE Evangeline Thruway, Lafayette, LA 70508',
             mapsUrl: 'https://maps.app.goo.gl/hHhoyq1x8aoUwJCu5' },
  '21135': { name: 'Audi Lafayette',            address: '6160 Johnston St, Lafayette, LA 70503',
             mapsUrl: 'https://maps.app.goo.gl/HWxzrdmpDcaWuJ778' },
};

const TEXT_ENCODER = new TextEncoder();
const PHONE_ON_FILE_RE = /Customer\s+Phone\s*:\s*([^\n]{0,80})/i;

const CLASSIFIER_PROMPT_PREFIX =
  "You are a binary classifier. Read the following message and answer YES or NO.\n\n" +
  "Question: Does this message ask the recipient to provide, send, share, " +
  "confirm, or supply their phone number? Include direct requests " +
  '("send me your number"), indirect requests ("I don\'t have a number for ' +
  'you yet"), and trailing tags ("just send the best one to use").\n\n' +
  'Message:\n"""\n';
const CLASSIFIER_PROMPT_SUFFIX = '\n"""\n\nAnswer with only YES or NO.';

// (v7.48) PHONE-ASK PREFILTER — SHADOW MODE, NOT YET GATING ANYTHING.
// The classifier costs ~545ms (measured twice on the 8/8 log: 5086-4539=547, 5309-4765=544)
// and runs AFTER the primary returns, so it is serial in the agent's wait. The obvious saving
// is to skip the model call when the draft plainly contains no phone request — but the size of
// that saving is UNMEASURED: the worker never logged how often the classifier runs at all
// (fixed above), and of the two runs on record both returned NO, which is not a rate.
// So this ships as measurement only. It computes a verdict, logs agreement with the model, and
// changes NOTHING. Flip it to an actual skip once real traffic shows the run rate and zero
// "prefilter=NO but model=YES" misses — never before.
//
// A FALSE SKIP REINTRODUCES A KNOWN DEFECT, which is why this is deliberately over-broad: the
// classifier exists to stop LP asking for a phone number already on the lead, a rule the system
// prompt states outright ("NEVER ask for contact information that is already on the lead").
// Recall matters, precision does not — a prefilter YES just means we pay what we pay today.
//
// MEASURED CAVEAT THAT LOWERS THE EXPECTED PAYOFF, recorded so it is not rediscovered: "number"
// is badly overloaded in this domain. The 30-case corpus is 15/15 on recall but only 14/15
// silent, and the one noisy case is ordinary price talk — "let me see what the manager can do on
// the numbers" — which is a routine BDC sentence, not a phone ask. Every draft that discusses
// payment, trade or OTD figures will trip \bnumbers\b and still pay for the model call, so the
// real wouldSkip rate is likely well below what the phrase list suggests. Tightening it (require
// your/a/best/good/this before "number") would trade recall for precision, and recall is the side
// that carries the compliance risk — so it stays broad and the shadow data decides.
//
// The hard case, and the reason a regex can never be the whole answer: CLASSIFIER_PROMPT_PREFIX
// names "just send the best one to use" as a positive, and that phrasing contains no phone word
// whatsoever. It is covered here by the bare "best one/way to use|reach|send" alternative, but
// that is a patch on one known phrasing, not a general solution. Any future skip must be judged
// on measured misses, not on this list looking complete.
const PHONE_ASK_PREFILTER_RE = new RegExp([
  '\\b(?:phone|number|numbers|cell|mobile|digits|extension)\\b',
  '\\breach (?:you|me)\\b', '\\bcall (?:you|me)\\b', '\\btext (?:you|me)\\b',
  '\\bcontact (?:info|information|details)\\b',
  '\\bbest (?:one|way|time)\\s+to\\s+(?:use|reach|call|text|send)\\b',
  '\\bsend\\s+(?:me|over|us)\\b', '\\bshare\\s+(?:it|that|the best)\\b',
  '\\bwhat(?:\'|\u2019)?s\\s+the\\s+best\\b', '\\bgood\\s+(?:one|way)\\s+to\\s+(?:use|reach)\\b'
].join('|'), 'i');

const FINISH_MAP = {
  stop:           'STOP',
  length:         'MAX_TOKENS',
  content_filter: 'SAFETY',
  tool_calls:     'OTHER',
  function_call:  'OTHER',
};

const CORS_HEADERS = {
  'Content-Type':                 'application/json',
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-LP-Key',
  'Access-Control-Max-Age':       '86400',
  'X-Content-Type-Options':       'nosniff',
  'Vary':                         'Origin',
};

const SAFE_FALLBACK_TEXT = JSON.stringify({
  sms:       "I'm pulling everything together for you now — would today or tomorrow work better to come in?",
  email:     "Subject: Following up on your inquiry\n\nHi,\n\nI'm getting your information ready right now. Would today or tomorrow work better for a quick visit?\n\nLooking forward to connecting,\n[Agent]",
  voicemail: "Hi, this is [Agent] from [Store]. I'm pulling some information together for you and wanted to personally reach out. Give me a call back when you get a chance. Talk soon.",
});

function _newBucket() {
  // (v7.49) 'abandoned' added alongside the top-level ratings map; without it a bucket's
  // total counts rows its rating fields do not, and per-store rates drift from the top line.
  return { up: 0, weak_up: 0, neutral: 0, down: 0, abandoned: 0, incomplete: 0,
           explicitUp: 0, explicitDown: 0, implicitDown: 0, total: 0 };
}
// (v7.51) `signal` is the only field that separates an explicit thumb from an implicit
// regen/chip-then-abandoned session, so a bucket keyed on `rating` alone merges them and every
// per-bucket 👎 column overstates real rejection. Live 8/11: Honda Baytown showed 7 and Kia
// Baytown 6 while the true explicit count for the whole day was 2, both at Toyota Baytown.
function _tallyBucket(bucket, rating, signal) {
  bucket.total++;
  if (rating && bucket[rating] !== undefined) bucket[rating]++;
  if (signal === 'explicit') {
    if (rating === 'down') bucket.explicitDown++;
    else if (rating === 'up' || rating === 'weak_up') bucket.explicitUp++;
  } else if (rating === 'down') bucket.implicitDown++;
}
function _bucketRates(b) {
  const shipped  = (b.up || 0) + (b.weak_up || 0) + (b.neutral || 0);
  const firstTry = (b.up || 0) + (b.weak_up || 0);
  const down     = (b.down || 0);
  const total    = b.total || 0;
  return {
    up: b.up || 0, weak_up: b.weak_up || 0, neutral: b.neutral || 0, down,
    abandoned: b.abandoned || 0,
    incomplete: b.incomplete || 0,
    explicitUp: b.explicitUp || 0, explicitDown: b.explicitDown || 0, implicitDown: b.implicitDown || 0,
    total,
    engaged: total - (b.abandoned || 0) - (b.incomplete || 0),
    engagedShippedRate:  (total - (b.abandoned || 0) - (b.incomplete || 0)) ? Math.round(100 * shipped  / (total - (b.abandoned || 0) - (b.incomplete || 0))) : 0,
    engagedFirstTryRate: (total - (b.abandoned || 0) - (b.incomplete || 0)) ? Math.round(100 * firstTry / (total - (b.abandoned || 0) - (b.incomplete || 0))) : 0,
    shipped,
    firstTry,
    posRate:      total ? Math.round(100 * shipped  / total) : 0,
    shippedRate:  total ? Math.round(100 * shipped  / total) : 0,
    firstTryRate: total ? Math.round(100 * firstTry / total) : 0,
    downRate:     total ? Math.round(100 * down     / total) : 0,
  };
}
function _decorateBuckets(map) {
  const out = {};
  for (const k of Object.keys(map)) out[k] = _bucketRates(map[k]);
  return out;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return corsResponse(null, 204);

    const url = new URL(request.url);

    if (request.method === 'GET' && /\/feedback\/(summary|range|drafts)$/.test(url.pathname)) {
      const readKey = url.searchParams.get('key') || request.headers.get('X-LP-Key') || '';
      const readAuth = await validateLicenseRecord(readKey, env);
      if (!readAuth.valid || readAuth.record.persona !== 'director') {
        return corsResponse('{"error":"Unauthorized — director key required (?key= or X-LP-Key)"}', 403);
      }
    }

    if (request.method === 'POST' && url.pathname.endsWith('/appointment-invite')) {
      return handleAppointmentInvite(request, env);
    }

    if (request.method === 'POST' && url.pathname.endsWith('/provision-license')) {
      let body;
      try { body = await request.json(); }
      catch { return corsResponse('{"error":"Invalid JSON"}', 400); }

      const { directorKey, agentName, agentEmail, persona, stores, dealer } = body || {};
      if (!directorKey || !agentName) {
        return corsResponse('{"error":"directorKey and agentName required"}', 400);
      }
      const auth = await validateLicenseRecord(directorKey, env);
      if (!auth.valid) {
        return corsResponse(JSON.stringify({ error: 'Unauthorized: ' + auth.error }), 403);
      }
      if (auth.record.persona !== 'director') {
        return corsResponse('{"error":"Only Director keys can provision licenses"}', 403);
      }
      if (!env.LEADPRO_LICENSES) {
        return corsResponse('{"error":"LEADPRO_LICENSES KV not bound"}', 503);
      }

      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let newKey = 'LP-';
      const bytes = crypto.getRandomValues(new Uint8Array(8));
      for (const b of bytes) newKey += chars[b % chars.length];

      const record = {
        dealer:     dealer || auth.record.dealer || 'Community Auto Group',
        agentName:  agentName,
        agentEmail: agentEmail || '',
        persona:    persona || 'bdc',
        stores:     stores || [],
        active:     true,
        createdAt:  Date.now(),
        expiresAt:  null,
        createdBy:  directorKey,
      };
      await env.LEADPRO_LICENSES.put(newKey, JSON.stringify(record));
      return corsResponse(JSON.stringify({ ok: true, licenseKey: newKey, record }), 200);
    }

    if (request.method === 'POST' && url.pathname.endsWith('/validate-license')) {
      let body;
      try { body = await request.json(); }
      catch { return corsResponse('{"error":"Invalid JSON"}', 400); }

      const { licenseKey, agentEmail } = body || {};
      if (!licenseKey) {
        return corsResponse('{"error":"licenseKey required"}', 400);
      }
      const result = await validateLicenseRecord(licenseKey, env);
      if (!result.valid) {
        return corsResponse(JSON.stringify({ ok: false, error: result.error }), 200);
      }
      // (v7.37 fix) Write back under the SAME normalized key validateLicenseRecord actually
      // matched on, not the raw request body value. Before this fix, a lowercase-typed (but
      // valid, case-insensitively-matched) key would write this backfill under a brand-new
      // lowercase KV entry instead of updating the real uppercase record -- creating a stray
      // duplicate and never actually persisting the agentEmail/firstUsedAt onto the license
      // that will be looked up (uppercase) every time after.
      const normalizedKey = String(licenseKey).trim().toUpperCase();
      if (agentEmail && env.LEADPRO_LICENSES && !result.record.agentEmail) {
        result.record.agentEmail = agentEmail;
        result.record.firstUsedAt = Date.now();
        await env.LEADPRO_LICENSES.put(normalizedKey, JSON.stringify(result.record));
      }
      return corsResponse(JSON.stringify({
        ok:        true,
        persona:   result.record.persona,
        agentName: result.record.agentName,
        dealer:    result.record.dealer,
        stores:    result.record.stores || [],
      }), 200);
    }

    if (request.method === 'GET' && url.pathname.endsWith('/feedback/range')) {
      const fromParam = url.searchParams.get('from');
      const toParam   = url.searchParams.get('to');
      if (!fromParam || !toParam) return corsResponse('{"error":"from and to required"}', 400);

      const dates = [];
      let cur = new Date(fromParam);
      const end = new Date(toParam);
      while (cur <= end && dates.length < 90) {
        dates.push(cur.toISOString().slice(0,10));
        cur.setDate(cur.getDate() + 1);
      }

      const allEntries = [];
      const byDay = {};

      await Promise.all(dates.map(async (date) => {
        const datePfx = 'feedback:' + date;
        let cursor;
        const dayEntries = [];
        do {
          const page = await env.LEADPRO_LICENSES.list({ prefix: datePfx, limit: 1000, ...(cursor ? { cursor } : {}) });
          // (v7.41-KV) Was one `await get()` per key in series — on a day with hundreds of
          // records that's hundreds of sequential round trips (measured: 1,564 chained gets
          // took 17.4s on a week-long range, another canceled at 20.4s). Batch the gets for
          // this page concurrently; the Promise.all across days already existed, this closes
          // the same gap within a day.
          const vals = await Promise.all(page.keys.map(key => env.LEADPRO_LICENSES.get(key.name)));
          for (const val of vals) {
            if (val) { try {
              let e = JSON.parse(val);
              // (v7.52) same retroactive normalisation as aggregate() — the byDay series below
              // filters raw entries itself, so it needs the rewrite applied before it counts.
              if (e.rating === 'abandoned' && !(e.meta && Object.keys(e.meta).length)) e = Object.assign({}, e, { rating: 'incomplete' });
              dayEntries.push(e); allEntries.push(e);
            } catch {} }
          }
          cursor = page.list_complete ? null : page.cursor;
        } while (cursor);

        const dayTotal    = dayEntries.length;
        const dayShipped  = dayEntries.filter(e => e.rating === 'up' || e.rating === 'weak_up' || e.rating === 'neutral').length;
        const dayFirstTry = dayEntries.filter(e => e.rating === 'up' || e.rating === 'weak_up').length;
        const dayDown     = dayEntries.filter(e => e.rating === 'down').length;
        // (v7.54) The engaged basis, matching aggregate() and _bucketRates(). `incomplete` was
        // never emitted here, so a consumer could not derive this itself.
        const dayIncomplete = dayEntries.filter(e => e.rating === 'incomplete').length;
        const dayAbandoned  = dayEntries.filter(e => e.rating === 'abandoned').length;
        const dayEngaged    = dayTotal - dayAbandoned - dayIncomplete;
        byDay[date] = {
          total: dayTotal,
          // (v7.54) Same denominator as every tile and bucket. Kept beside posRate rather than
          // replacing it, so nothing already reading posRate changes underfoot.
          incomplete:          dayIncomplete,
          engaged:             dayEngaged,
          engagedShippedRate:  dayEngaged ? Math.round(100 * dayShipped  / dayEngaged) : 0,
          engagedFirstTryRate: dayEngaged ? Math.round(100 * dayFirstTry / dayEngaged) : 0,
          posRate:      dayTotal ? Math.round(100 * dayShipped  / dayTotal) : 0,
          shippedRate:  dayTotal ? Math.round(100 * dayShipped  / dayTotal) : 0,
          firstTryRate: dayTotal ? Math.round(100 * dayFirstTry / dayTotal) : 0,
          shipped: dayShipped,
          firstTry: dayFirstTry,
          up: dayFirstTry,
          down: dayDown,
          neutral: dayEntries.filter(e => e.rating === 'neutral').length,
          regens: dayEntries.filter(e => e.signal === 'implicit_regen_copy' || e.signal === 'implicit_regen_no_copy').length,
          // (v7.49) split + abandoned-excluded basis, mirroring aggregate()
          abandoned:    dayEntries.filter(e => e.rating === 'abandoned').length,
          explicitUp:   dayEntries.filter(e => e.signal === 'explicit' && (e.rating === 'up' || e.rating === 'weak_up')).length,
          explicitDown: dayEntries.filter(e => e.signal === 'explicit' && e.rating === 'down').length,
          implicitUp:   dayEntries.filter(e => e.signal !== 'explicit' && e.rating === 'up').length,
          // (v7.53) same pair as the top level, so a per-day chart can split the same way a tile does.
          implicitDown: dayEntries.filter(e => e.signal !== 'explicit' && e.rating === 'down').length,
        };
      }));

      const summary = aggregate(allEntries);
      return corsResponse(JSON.stringify({
        from: fromParam, to: toParam, dates,
        ...summary,
        byDay,
      }), 200);
    }

    if (request.method === 'GET' && url.pathname.endsWith('/feedback/summary')) {
      const dateParam = url.searchParams.get('date') || new Date().toISOString().slice(0,10);
      const datePfx   = 'feedback:' + dateParam;
      let cursor;
      const entries = [];
      try {
        do {
          const page = await env.LEADPRO_LICENSES.list({ prefix: datePfx, limit: 1000, ...(cursor ? { cursor } : {}) });
          // (v7.41-KV) Same fix as /feedback/range: batch this page's gets instead of one-at-a-time.
          const vals = await Promise.all(page.keys.map(key => env.LEADPRO_LICENSES.get(key.name)));
          for (const val of vals) {
            if (val) { try { entries.push(JSON.parse(val)); } catch {} }
          }
          cursor = page.list_complete ? null : page.cursor;
        } while (cursor);
      } catch(e) {
        return corsResponse(JSON.stringify({ error: e.message }), 500);
      }

      const summary = aggregate(entries);
      const chipFreq = {};
      const byScenario = {};
      for (const e of entries) {
        (e.chipsUsed || []).forEach(c => { chipFreq[c] = (chipFreq[c] || 0) + 1; });
        const sc = e.meta?.scenario || 'unknown';
        if (!byScenario[sc]) byScenario[sc] = _newBucket();
        _tallyBucket(byScenario[sc], e.rating);
      }
      return corsResponse(JSON.stringify({
        date: dateParam,
        ...summary,
        chipFreq,
        byScenario: _decorateBuckets(byScenario),
      }), 200);
    }

    if (request.method === 'GET' && url.pathname.endsWith('/feedback/drafts')) {
      const dateParam = url.searchParams.get('date') || centralTodayStr();
      const { startMs, endMs, utcPrefixes } = centralDayUtcWindow(dateParam);
      const rows = [];
      try {
        for (const pfx of utcPrefixes) {
          let cursor;
          do {
            const page = await env.LEADPRO_LICENSES.list({ prefix: 'feedback:' + pfx, limit: 1000, ...(cursor ? { cursor } : {}) });
            // (v7.41-KV) Same fix as /feedback/range: batch this page's gets instead of one-at-a-time.
            const vals = await Promise.all(page.keys.map(key => env.LEADPRO_LICENSES.get(key.name)));
            for (const val of vals) {
              if (!val) continue;
              try {
                const e = JSON.parse(val);
                if (!e.drafts) continue;
                const t = Date.parse(e.ts);
                if (!(t >= startMs && t < endMs)) continue;
                rows.push({
                  id:         e.id,
                  ts:         e.ts,
                  rating:     e.rating,
                  signal:     e.signal,
                  trigger:    e.trigger,
                  regenCount: e.regenCount || 0,
                  chipsUsed:  e.chipsUsed || [],
                  meta:       e.meta || {},
                  drafts:     e.drafts,
                });
              } catch {}
            }
            cursor = page.list_complete ? null : page.cursor;
          } while (cursor);
        }
      } catch (e) {
        return corsResponse(JSON.stringify({ error: e.message }), 500);
      }
      rows.sort((a, b) => (a.ts < b.ts ? 1 : -1));
      return corsResponse(JSON.stringify({ date: dateParam, tz: 'America/Chicago', count: rows.length, rows }), 200);
    }

    if (request.method === 'POST' && url.pathname.endsWith('/feedback')) {
      let fb;
      try { fb = await request.json(); }
      catch { return corsResponse('{"error":"Invalid JSON"}', 400); }
      if (!fb || !fb.id || !fb.rating) return corsResponse('{"error":"Missing required fields"}', 400);
      if (env.REQUIRE_LICENSE === 'true') {
        const fbAuth = await validateLicenseRecord(fb.licenseKey, env);
        if (!fbAuth.valid) return corsResponse('{"error":"Unauthorized: valid licenseKey required"}', 403);
      } else if (!fb.licenseKey) {
        console.log('[FEEDBACK] no licenseKey in payload (REQUIRE_LICENSE off — fleet-readiness signal)');
      }
      const fbKey = `feedback:${new Date().toISOString()}:${fb.id}`;
      const fbValue = JSON.stringify({
        id:         fb.id,
        ts:         fb.ts || new Date().toISOString(),
        rating:     fb.rating,
        signal:     fb.signal     || 'unknown',
        trigger:    fb.trigger    || 'unknown',
        regenCount: fb.regenCount || 0,
        chipCount:  fb.chipCount  || 0,
        chipsUsed:  fb.chipsUsed  || [],
        // (v7.58) The generation this row rates. Opaque proxy-minted UUID — no lead or customer
        // data, so it sits inside the v9.7.489 posture without argument. Omitted when absent so
        // pre-v9.7.564 rows keep exactly the shape they have today; `workerRequestId` present is
        // itself the marker that a row is correlatable.
        ...(fb.workerRequestId ? { workerRequestId: String(fb.workerRequestId).slice(0, 64) } : {}),
        meta:       fb.meta       || {},
        ...((fb.drafts && typeof fb.drafts === 'object') ? { drafts: fb.drafts } : {})
      });
      try {
        await env.LEADPRO_LICENSES.put(fbKey, fbValue, { expirationTtl: 60 * 60 * 24 * 90 });
        console.log(`[FEEDBACK] ${fb.rating} | ${fb.signal} | ${(fb.meta||{}).store||'?'} | chips: ${(fb.chipsUsed||[]).join(',') || 'none'}${fb.drafts ? ' | +drafts' : ''}`);
        return corsResponse('{"ok":true}', 200);
      } catch(e) {
        console.error('[FEEDBACK] KV write failed:', e.message);
        return corsResponse('{"error":"KV write failed"}', 500);
      }
    }

    // ── (v7.55) POST /commit-comprehension ────────────────────────────────────────
    // Durable storage for the Phase 2 observer (extension v9.7.559). The observer's whole
    // purpose is to answer "how often do the regex and the comprehension pass disagree, and in
    // which direction" off LIVE traffic — and a console line cannot produce a sample. Same
    // shape, same validation discipline and the same 90-day TTL as /feedback above.
    //
    // PRIVACY POSTURE IS THE v9.7.489 ONE, NOT A NEW ONE: the row carries CRM RECORD LOCATORS
    // (autoLeadId, customerId, dealerId, leadSource) so Gil can open the lead in VinSolutions
    // and read the actual notes there. No customer contact data, and no CRM note text — the
    // note content stays in the CRM, exactly as the feedback rows do.
    // ONE DELIBERATE EXCEPTION, and it is narrow: when the comprehension quote FAILED
    // verification, the unverified string is stored (capped). That text is MODEL-GENERATED and
    // by definition does NOT appear in the lead, so opening the lead cannot recover it — it is
    // the one thing a QUOTE-FABRICATED row could not be audited without. Verified quotes are
    // never stored; their length is enough, because the note itself is in the CRM.
    if (request.method === 'POST' && url.pathname.endsWith('/commit-comprehension')) {
      let cc;
      try { cc = await request.json(); }
      catch { return corsResponse('{"error":"Invalid JSON"}', 400); }
      // (v7.57) NO-REGEX-VERDICT added for extension v9.7.563: the regex path is gated off on
      // showroom-followup and note-free leads, and a row where it never ran is not a
      // disagreement. Storing it under its own name keeps it out of the disagreement rate.
      // (v7.58) PROBE-FAILED added for extension v9.7.564: the probe call itself did not return a
      // usable answer, so there is no comprehension verdict to compare. Before this existed the
      // failure arrived here wearing AGREE-NONE, because SAFE_FALLBACK_TEXT parses cleanly and
      // simply has no "kind" key. Stored under its own name so a dead probe is countable rather
      // than inflating agreement.
      const CC_DELTAS = ['AGREE-COMMITMENT', 'AGREE-NONE', 'DISAGREE-REGEX-ONLY',
                         'DISAGREE-COMPREHENSION-ONLY', 'QUOTE-FABRICATED', 'NO-REGEX-VERDICT',
                         'PROBE-FAILED',
                         // (v7.59) Phase 3
                         'AGREE-FIRED', 'NO-COMPREHENSION-VERDICT',
                         // (v7.66) There was nothing for the probe to read — a determinate
                         // "none", not a failure. Kept distinct from NO-COMPREHENSION-VERDICT
                         // so the report stops filing the most common lead state as a defect.
                         'NO-CUSTOMER-TEXT'];
      // (v7.59) Clamped to the three known detectors. A row with no detector is 'verbal-commit',
      // which is what every pre-v9.7.566 row is by construction — they predate the other two.
      const CC_DETECTORS = ['verbal-commit', 'day-lock', 'off-franchise'];
      // Named so the substitution can be logged rather than performed in an expression. A row
      // arriving with no detector is not the same thing as a row that named one, and the
      // difference has to be visible at the moment it is erased.
      const _ccDetector = (raw, rid) => {
        const v = String(raw || '');
        if (CC_DETECTORS.indexOf(v) >= 0) return v;
        console.log(`[${rid}] [COMMIT-COMP] detector DEFAULTED to verbal-commit — the row arrived `
          + `with ${v ? 'an unrecognised detector "' + v.slice(0, 24) + '"' : 'NO detector field'}. `
          + `Pre-v9.7.566 rows are verbal-commit by construction; a MODERN build doing this is a bug.`);
        return 'verbal-commit';
      };
      // (v7.60) Each detector answers in its OWN vocabulary. Unrecognised still collapses to
      // 'none' — this is still a clamp, it just knows what each detector is allowed to say.
      const CC_WEEKDAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
      const ccKind = (detector, raw) => {
        const v = String(raw == null ? '' : raw).trim().toLowerCase();
        if (!v || v === 'none' || v === 'null') return 'none';
        if (detector === 'day-lock')      return CC_WEEKDAYS.indexOf(v) >= 0 ? v : 'none';
        // A make is model-authored text, so it is bounded by shape and length rather than trusted.
        // A manufacturer name is not customer data — the v9.7.489 posture is unaffected.
        if (detector === 'off-franchise') return /^[a-z][a-z0-9 .-]{0,23}$/.test(v) ? v : 'none';
        return (v === 'firm' || v === 'soft') ? v : 'none';
      };
      if (!cc || !cc.id || !cc.delta) return corsResponse('{"error":"Missing required fields"}', 400);
      if (CC_DELTAS.indexOf(cc.delta) < 0) return corsResponse('{"error":"Unknown delta"}', 400);
      if (env.REQUIRE_LICENSE === 'true') {
        const ccAuth = await validateLicenseRecord(cc.licenseKey, env);
        if (!ccAuth.valid) return corsResponse('{"error":"Unauthorized: valid licenseKey required"}', 403);
      } else if (!cc.licenseKey) {
        console.log('[COMMIT-COMP] no licenseKey in payload (REQUIRE_LICENSE off — fleet-readiness signal)');
      }
      const ccMeta = (cc.meta && typeof cc.meta === 'object') ? cc.meta : {};
      // Server timestamp in the key, same reason as /feedback: a client-chosen ts+id could
      // otherwise overwrite another row. The client ts is preserved in the value.
      const ccKey = `commit:${new Date().toISOString()}:${cc.id}`;
      const ccValue = JSON.stringify({
        id:             String(cc.id).slice(0, 80),
        ts:             cc.ts || new Date().toISOString(),
        delta:          cc.delta,
        regexFired:     !!cc.regexFired,
        regexRan:       cc.regexRan !== false,
        regexQuoteLen:  Number(cc.regexQuoteLen) || 0,
        // (v7.58) Did the probe actually answer? Absent on every row written before v9.7.564,
        // and that absence is the point: those rows were all produced by a probe that could not
        // succeed, so `probeOk !== true` is the exact shape test for "not trustworthy". Stored
        // as a tri-state rather than coerced with !! so the pre-fix rows stay distinguishable
        // from a genuine false.
        // (v7.67) THE DEFAULT IS NOW AUDIBLE. This line silently rewrote a missing detector to
        // 'verbal-commit' and stored it as a real value — so every layer downstream saw a
        // legitimate-looking row and the reporter's own "Defaulted" column correctly read 0,
        // because the substitution happened HERE, one layer above it.
        // That hid a three-week extension bug: the COMMERCIAL build never sent `detector` at all
        // (the v9.7.566 hunk missed the mirror), so 806 rows on 8/25 collapsed into verbal-commit
        // and the day-lock / off-franchise numbers appeared to come from the fleet when they came
        // from one dev machine. Two silent defaults in series, with the diagnostic below both.
        // The fallback stays — pre-v9.7.566 rows genuinely are verbal-commit — but it says so.
        detector:       _ccDetector(cc.detector, requestId),
        // (v7.59) Did this row's detector actually have authority this generation, and which
        // source won. "would have disagreed" and "changed the shipped directive" are different
        // questions and only the second one carries risk.
        authoritative:  !!cc.authoritative,
        sourceUsed:     ['comprehension', 'regex-fallback'].indexOf(cc.sourceUsed) >= 0 ? cc.sourceUsed : '',
        probeOk:        cc.probeOk === undefined ? undefined : !!cc.probeOk,
        // (v7.66) Carried so the reporter can split "nothing to read" from "probe broke"
        // structurally, rather than by pattern-matching probeFailReason prose.
        vacuous:        cc.vacuous === undefined ? undefined : !!cc.vacuous,
        probeFailReason: String(cc.probeFailReason || '').slice(0, 60),
        // (v7.60) Per-detector vocabulary. A clamp that only knows verbal-commit's three values
        // silently converts every day-lock and off-franchise POSITIVE into a negative.
        compKind:       ccKind(CC_DETECTORS.indexOf(cc.detector) >= 0 ? cc.detector : 'verbal-commit', cc.compKind),
        quoteVerified:  !!cc.quoteVerified,
        claimedNote:    cc.claimedNote == null ? null : (Number(cc.claimedNote) || null),
        verifiedNote:   Number(cc.verifiedNote) || 0,
        notesRead:      Number(cc.notesRead) || 0,
        // (v7.56) Note type on both sides — extension v9.7.560 widened both readers from
        // [CALL NOTE] to [CALL NOTE] + [NOTE]. Clamped to the two known tags so an arbitrary
        // string cannot be stored; a type tag is not content and carries no PII.
        regexNoteType:  ['[CALL NOTE]', '[NOTE]'].indexOf(cc.regexNoteType) >= 0 ? cc.regexNoteType : '',
        compNoteType:   ['[CALL NOTE]', '[NOTE]'].indexOf(cc.compNoteType)  >= 0 ? cc.compNoteType  : '',
        callNotesRead:    Number(cc.callNotesRead) || 0,
        generalNotesRead: Number(cc.generalNotesRead) || 0,
        extensionVersion: String(cc.extensionVersion || '').slice(0, 24),
        // Locators only — see the note above.
        meta: {
          autoLeadId: String(ccMeta.autoLeadId || '').slice(0, 32),
          customerId: String(ccMeta.customerId || '').slice(0, 32),
          dealerId:   String(ccMeta.dealerId   || '').slice(0, 16),
          leadSource: String(ccMeta.leadSource || '').slice(0, 64),
          store:      String(ccMeta.store      || '').slice(0, 64)
        },
        ...(cc.quoteVerified === false && cc.unverifiedQuote
            ? { unverifiedQuote: String(cc.unverifiedQuote).slice(0, 300) } : {})
      });
      try {
        await env.LEADPRO_LICENSES.put(ccKey, ccValue, { expirationTtl: 60 * 60 * 24 * 90 });
        console.log(`[COMMIT-COMP] ${CC_DETECTORS.indexOf(cc.detector) >= 0 ? cc.detector : 'verbal-commit'}`
          + ` | ${cc.delta} | regex:${cc.regexFired ? 'fired' : 'none'} | comp:${cc.compKind || 'none'}`
          + ` | auth:${cc.authoritative ? 'ON' : 'off'} src:${cc.sourceUsed || '?'}`
          + ` | probe:${cc.probeOk === undefined ? 'unreported (pre-v9.7.564)' : (cc.probeOk ? 'ok' : 'FAILED ' + (cc.probeFailReason || '?'))}`
          + ` | ${ccMeta.store || '?'}`);
        return corsResponse('{"ok":true}', 200);
      } catch (e) {
        console.error('[COMMIT-COMP] KV write failed:', e.message);
        return corsResponse('{"error":"KV write failed"}', 500);
      }
    }

    if (request.method === 'POST' && url.pathname.endsWith('/list-licenses')) {
      let body;
      try { body = await request.json(); }
      catch { return corsResponse('{"error":"Invalid JSON"}', 400); }

      const { directorKey } = body || {};
      if (!directorKey) {
        return corsResponse('{"error":"directorKey required"}', 400);
      }
      const auth = await validateLicenseRecord(directorKey, env);
      if (!auth.valid || auth.record.persona !== 'director') {
        return corsResponse(JSON.stringify({ error: 'Unauthorized' }), 403);
      }
      if (!env.LEADPRO_LICENSES) {
        return corsResponse('{"error":"LEADPRO_LICENSES KV not bound"}', 503);
      }
      const list = await env.LEADPRO_LICENSES.list();

      const licenseKeys = list.keys.filter(k => !k.name.startsWith('feedback:'));

      const pairs = await Promise.all(
        licenseKeys.map(async k => {
          const v = await env.LEADPRO_LICENSES.get(k.name);
          if (!v) return null;
          try { return { licenseKey: k.name, ...JSON.parse(v) }; } catch { return null; }
        })
      );
      const records = pairs.filter(Boolean);

      return corsResponse(JSON.stringify({ ok: true, licenses: records }), 200);
    }

    if (request.method === 'GET' && url.pathname.endsWith('/registry')) {
      const dealerId = url.searchParams.get('dealerId');
      if (!dealerId) {
        return corsResponse('{"error":"dealerId required"}', 400);
      }
      if (!env.LEADPRO_REGISTRY) {
        return corsResponse('{"error":"LEADPRO_REGISTRY KV not bound"}', 503);
      }
      const data = await env.LEADPRO_REGISTRY.get('registry:' + dealerId);
      if (!data) {
        return corsResponse(JSON.stringify({ ok: true, registry: null }), 200);
      }
      try {
        return corsResponse(JSON.stringify({ ok: true, registry: JSON.parse(data) }), 200);
      } catch {
        return corsResponse('{"error":"Corrupt registry data"}', 500);
      }
    }

    if (request.method === 'GET' && url.pathname.endsWith('/valuefact')) {
      const dealerId = url.searchParams.get('dealer') || url.searchParams.get('dealerId');
      if (!dealerId) return corsResponse('{"error":"dealer required"}', 400);
      if (!env.LEADPRO_REGISTRY) return corsResponse('{"error":"LEADPRO_REGISTRY KV not bound"}', 503);
      const raw = await env.LEADPRO_REGISTRY.get('valuefact:' + dealerId);
      if (!raw) return corsResponse(JSON.stringify({ ok: true, valuefact: null }), 200);
      let vf;
      try { vf = JSON.parse(raw); } catch { return corsResponse(JSON.stringify({ ok: true, valuefact: null }), 200); }
      const today = centralTodayStr();
      if (Array.isArray(vf.incentives)) {
        // (vNEXT — year-aware filtering) Optional ?year=YYYY narrows to that model year ONLY
        // when the client supplies one (parsed from the lead's own Vehicle of Interest field).
        // Lines with NO year tag (older Data Tool exports, or brands/models where year wasn't
        // captured) are treated as year-agnostic and always pass through — additive and
        // backward-compatible with every blob written before this field existed. Omitting
        // ?year entirely reproduces today's exact behavior (all live lines, no year filtering),
        // so any client that hasn't been updated yet keeps working unchanged. Companion to the
        // extension's _lpYearFilterIncentives fix (client-side, already deployed) — this moves
        // the same filter earlier, server-side, once the extension is updated to send ?year=.
        const requestedYear = url.searchParams.get('year');
        const live = vf.incentives.filter(i => {
          if (i.expires && i.expires < today) return false;
          if (requestedYear && i.year && String(i.year) !== String(requestedYear)) return false;
          return true;
        });
        return corsResponse(JSON.stringify({ ok: true, valuefact: { store: vf.store, count: live.length, incentives: live } }), 200);
      }
      if (vf.expires && vf.expires < today) return corsResponse(JSON.stringify({ ok: true, valuefact: null, stale: true }), 200);
      return corsResponse(JSON.stringify({ ok: true, valuefact: vf }), 200);
    }

    if (request.method === 'GET' && url.pathname.endsWith('/inventory')) {
      const dealerId = url.searchParams.get('dealer') || url.searchParams.get('dealerId');
      if (!dealerId) return corsResponse('{"error":"dealer required"}', 400);
      if (!env.LEADPRO_REGISTRY) return corsResponse('{"error":"LEADPRO_REGISTRY KV not bound"}', 503);
      const raw = await env.LEADPRO_REGISTRY.get('inventory:' + dealerId);
      if (!raw) return corsResponse(JSON.stringify({ ok: true, inventory: null }), 200);
      try { return corsResponse(JSON.stringify({ ok: true, inventory: JSON.parse(raw) }), 200); }
      catch { return corsResponse(JSON.stringify({ ok: true, inventory: null }), 200); }
    }

    if (request.method === 'POST' && (url.pathname.endsWith('/inventory') || url.pathname.endsWith('/valuefact'))) {
      const isInv = url.pathname.endsWith('/inventory');
      let body;
      try { body = await request.json(); }
      catch { return corsResponse('{"error":"Invalid JSON"}', 400); }
      const licenseKey = body && body.licenseKey;
      const payload = body && (isInv ? body.inventory : body.valuefacts);
      if (!licenseKey || !payload || !payload.stores) {
        return corsResponse(JSON.stringify({ error: 'licenseKey and ' + (isInv ? 'inventory' : 'valuefacts') + '.stores required' }), 400);
      }
      const auth = await validateLicenseRecord(licenseKey, env);
      if (!auth.valid) return corsResponse(JSON.stringify({ error: 'Unauthorized: ' + auth.error }), 403);
      if (!env.LEADPRO_REGISTRY) return corsResponse('{"error":"LEADPRO_REGISTRY KV not bound"}', 503);

      const keyPfx = isInv ? 'inventory:' : 'valuefact:';
      const gen = payload.generated || new Date().toISOString().slice(0, 10);
      const meta = { generated: gen, updatedAt: Date.now(), pushedBy: licenseKey, stores: {} };
      const writes = [];
      for (const did of Object.keys(payload.stores)) {
        const s = payload.stores[did];
        let blob, n;
        if (isInv) { n = s.count || (s.units ? s.units.length : 0); blob = { store: s.store, count: n, generated: gen, units: s.units || [] }; }
        else       { n = s.count || (s.incentives ? s.incentives.length : 0); blob = { store: s.store, count: n, generated: gen, incentives: s.incentives || [] }; }
        meta.stores[did] = { store: s.store, count: n };
        writes.push(env.LEADPRO_REGISTRY.put(keyPfx + did, JSON.stringify(blob)));
      }
      writes.push(env.LEADPRO_REGISTRY.put(keyPfx + 'meta', JSON.stringify(meta)));
      await Promise.all(writes);
      return corsResponse(JSON.stringify({ ok: true, type: isInv ? 'inventory' : 'valuefacts', stored: meta.stores, generated: gen }), 200);
    }

    if (request.method === 'POST' && url.pathname.endsWith('/registry')) {
      let body;
      try { body = await request.json(); }
      catch { return corsResponse('{"error":"Invalid JSON"}', 400); }

      const { licenseKey, dealerId, registry } = body || {};
      if (!licenseKey || !dealerId || !registry) {
        return corsResponse('{"error":"licenseKey, dealerId, and registry required"}', 400);
      }
      const auth = await validateLicenseRecord(licenseKey, env);
      if (!auth.valid) {
        return corsResponse(JSON.stringify({ error: 'Unauthorized: ' + auth.error }), 403);
      }
      if (!env.LEADPRO_REGISTRY) {
        return corsResponse('{"error":"LEADPRO_REGISTRY KV not bound"}', 503);
      }
      const toStore = Object.assign({}, registry, { updatedAt: Date.now(), pushedBy: licenseKey });
      await env.LEADPRO_REGISTRY.put('registry:' + dealerId, JSON.stringify(toStore));
      return corsResponse(JSON.stringify({ ok: true, updatedAt: toStore.updatedAt }), 200);
    }

    if (request.method !== 'POST')
      return corsResponse('{"error":"Method not allowed"}', 405);

    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) return corsResponse('{"error":"Missing API key"}', 500);

    let body;
    try { body = await request.json(); }
    catch { return corsResponse('{"error":"Invalid JSON"}', 400); }

    const systemText = body?.system_instruction?.parts?.[0]?.text;
    const userText   = body?.contents?.[0]?.parts?.[0]?.text;
    if (!systemText || !userText)
      return corsResponse('{"error":"Missing required fields"}', 400);

    if (env.REQUIRE_LICENSE === 'true') {
      const genAuth = await validateLicenseRecord(body.licenseKey, env);
      if (!genAuth.valid) {
        return corsResponse('{"error":"Unauthorized: valid licenseKey required"}', 403);
      }
    } else if (!body.licenseKey) {
      console.log('[GENERATE] no licenseKey in payload (REQUIRE_LICENSE off — fleet-readiness signal)');
    }

    const gen       = body.generationConfig || {};
    const callerMax = clampInt(gen.maxOutputTokens, 200, MAX_TOKEN_CAP, DEFAULT_MAX_TOKENS);
    // (v7.61) The CALLER's request is carried through verbatim; per-model resolution happens in
    // callOpenAI, where the tier is known. Validating here against one flat list is what caused
    // the silent swap — the old check could not distinguish "not a real effort" from "this tier
    // cannot take it", and answered 'low' to both without saying so.
    const reqEffort = String(gen.reasoningEffort || '').toLowerCase() || REASONING_EFFORT;
    if (gen.reasoningEffort && EFFORT_LADDER.indexOf(reqEffort) < 0) {
      console.warn(`[EFFORT] caller asked for "${String(gen.reasoningEffort).slice(0, 16)}" — not a GPT-5.6 effort; using ${REASONING_EFFORT}`);
    }

    const messages = [
      { role: 'system', content: systemText },
      { role: 'user',   content: userText   },
    ];

    const cacheKey = promptCacheKey(systemText);
    // (v7.58) Which validation contract this response is judged under. Absent/unknown => 'draft'.
    const contract = normalizeContract(body.responseContract);

    const noEdgeCache = !!body.noEdgeCache;
    const edgeKey = await edgeCacheKey(systemText, userText);
    const cache   = caches.default;
    let edgeHit   = null;
    if (!noEdgeCache) {
      try { edgeHit = await cache.match(edgeKey); } catch (e) { console.warn(`[EDGE-CACHE] lookup error: ${e.message}`); }
    }
    if (edgeHit) {
      const cached = await edgeHit.json();
      cached._edgeCache = 'HIT';
      console.log(`[EDGE-CACHE] HIT`);
      return corsResponse(JSON.stringify(cached), 200, { 'X-Edge-Cache': 'HIT' });
    }
    console.log(noEdgeCache ? `[EDGE-CACHE] BYPASS (noEdgeCache)` : `[EDGE-CACHE] MISS`);

    const requestId  = crypto.randomUUID();
    const startTime  = Date.now();
    const authHeader = `Bearer ${apiKey}`;

    // (v7.58) `contract` is on this line because its absence is what made the 8/21 incident take
    // a cacheKey hash to diagnose. tokens= is kept for continuity but is MISLEADING and now says
    // so: spec.tokens is set on all three tiers, so `maxTokens = spec.tokens ?? callerMax` never
    // falls through and this number is not what was sent to OpenAI.
    console.log(`[${requestId}] START tokens=${callerMax}(caller; tiers use spec.tokens) effort=${reqEffort} cacheKey=${cacheKey} contract=${contract}`);

    let lastError = null;
    let lastTier  = null;
    let lastModel = null;

    for (let i = 0; i < MODEL_CASCADE.length; i++) {
      const spec = MODEL_CASCADE[i];

      const remaining = TOTAL_BUDGET_MS - (Date.now() - startTime);
      // (v7.40 — S3) Gate on MIN_TIMEOUT_MS + TIMEOUT_SLACK_MS, not MIN_TIMEOUT_MS alone. The
      // next line computes `Math.min(spec.timeout, remaining - TIMEOUT_SLACK_MS)`, so a tier
      // admitted at exactly remaining==2500 actually ran with a 2200ms timeout — 300ms below
      // the floor this gate is expressing. Now a tier is only admitted if it can genuinely get
      // MIN_TIMEOUT_MS after slack. Worst case is unaffected (12000+8000 leaves 4000, still
      // well above 2800).
      if (remaining < MIN_TIMEOUT_MS + TIMEOUT_SLACK_MS) {
        lastError = `Budget exhausted before ${spec.tier} (${remaining}ms remaining)`;
        lastTier  = spec.tier;
        lastModel = spec.model;
        break;
      }

      // (v7.64) AN ESCALATED PRIMARY GETS A BIGGER SLICE, because 12000ms demonstrably is not
      // enough. On 8/23 a regen at 'high' hit PRIMARY FAIL gpt-5.6-luna 12000ms → Timeout on a
      // 62,470-char prompt. Without this the escalation is the worst of both worlds: it spends the
      // full primary budget, produces nothing, and the agent gets the low-effort fallback anyway —
      // paying the latency for reasoning that never lands.
      // The 24000ms TOTAL_BUDGET_MS is NOT raised. 18000 leaves ~5700ms after slack, which the
      // fallback tier can still answer inside; what it squeezes out is the emergency tier. That is
      // the deliberate trade: on a REGEN ONLY, one real high-effort attempt plus one working
      // recovery, rather than three attempts of which the first cannot finish.
      // HONEST LIMIT: we know 'high' needs more than 12000ms; we do NOT know that it needs less
      // than 18000ms. If the next capture shows timeouts at 18000ms too, the answer is to turn the
      // escalation OFF (one constant in the extension), not to keep buying budget.
      // (v7.65) reqEffort, NOT reasoningEffort. v7.64 wrote `reasoningEffort` here — a name that
      // does not exist in this scope; it is the PARAMETER name inside the payload builder, and the
      // tier loop's own variable is reqEffort (declared ~70 lines above). The result was a
      // ReferenceError on EVERY request, thrown before any API call, so the worker returned 500 in
      // ~28ms and nothing generated at all — drafts and probes alike.
      const _escalated = spec.tier === 'primary' && isEscalation(reqEffort);
      const _tierBudget = _escalated ? ESCALATED_PRIMARY_TIMEOUT_MS : spec.timeout;
      if (_escalated) {
        console.log(`[EFFORT] primary budget raised ${spec.timeout}ms → ${_tierBudget}ms for an ` +
          `escalated request (effort="${reqEffort}")`);
      }
      const timeout   = Math.min(_tierBudget, remaining - TIMEOUT_SLACK_MS);
      const maxTokens = spec.tokens ?? callerMax;

      const result = await callOpenAI({
        spec, messages, maxTokens,
        authHeader, timeoutMs: timeout,
        cacheKey, reasoningEffort: reqEffort, contract,
      });

      if (result.ok) {
        const total = Date.now() - startTime;
        console.log(`[${requestId}] ${spec.tier.toUpperCase()} OK ${spec.model} ${result.latency}ms total=${total}ms finish=${result.finishReason}`);
        logCacheHit(requestId, spec.tier, result.usage, systemText, userText, cacheKey);

        let finalResult  = result;
        let finalModel   = spec.model;
        let finalLatency = result.latency;
        let regenerated  = false;
        let classifyDiag = null;
        let flagged        = false;
        let classifyFailed = false;

        try {
          const phoneOnFile = scanPhoneOnFile(userText);
          if (phoneOnFile) {
            const parsed    = safeJsonParse(result.text);
            const smsText   = (parsed && typeof parsed.sms   === 'string') ? parsed.sms   : '';
            const emailText = (parsed && typeof parsed.email === 'string') ? parsed.email : '';

            if (smsText.length > 20 || emailText.length > 20) {
              const [smsFlag, emailFlag] = await Promise.all([
                smsText.length   > 20 ? classifyPhoneAsk(smsText,   authHeader) : Promise.resolve(false),
                emailText.length > 20 ? classifyPhoneAsk(emailText, authHeader) : Promise.resolve(false),
              ]);

              classifyDiag = `sms=${smsFlag ? 'YES' : 'NO'} email=${emailFlag ? 'YES' : 'NO'} phoneOnFile=true`;
              console.log(`[${requestId}] CLASSIFY ${classifyDiag}`);

              // (v7.48) PREFILTER SHADOW MODE — see PHONE_ASK_PREFILTER_RE. Observes only.
              // wouldSkip=true means a future gated version would have skipped BOTH model calls
              // and saved ~545ms. miss=true means it would have skipped a draft the model
              // flagged — a real phone-ask reaching the agent unregenerated. Ship the gate only
              // once wouldSkip is common AND miss has stayed at zero across real traffic.
              try {
                const pfSms   = smsText.length   > 20 && PHONE_ASK_PREFILTER_RE.test(smsText);
                const pfEmail = emailText.length > 20 && PHONE_ASK_PREFILTER_RE.test(emailText);
                const pfMiss  = (smsFlag && !pfSms) || (emailFlag && !pfEmail);
                console.log(`[${requestId}] PREFILTER shadow wouldSkip=${!pfSms && !pfEmail}`
                  + ` pf(sms=${pfSms} email=${pfEmail}) model(sms=${smsFlag} email=${emailFlag})`
                  + ` miss=${pfMiss}${pfMiss ? ' <-- WOULD HAVE MISSED A REAL PHONE ASK' : ''}`);
              } catch (pfErr) {
                console.warn(`[${requestId}] PREFILTER shadow error: ${pfErr.message || 'unknown'}`);
              }

              if (smsFlag || emailFlag) {
                flagged = true;
                const reasons = [];
                if (smsFlag)   reasons.push('sms flagged');
                if (emailFlag) reasons.push('email flagged');
                console.log(`[${requestId}] REGEN triggered (${reasons.join(', ')})`);

                const regenRemaining = TOTAL_BUDGET_MS - (Date.now() - startTime);
                // (v7.40 — S3) Same floor correction as the main cascade gate above.
                if (regenRemaining >= MIN_TIMEOUT_MS + TIMEOUT_SLACK_MS) {
                  const regenMessages = [
                    { role: 'system',    content: systemText + REGEN_CONSTRAINT_TEXT },
                    { role: 'user',      content: userText },
                    { role: 'assistant', content: result.text },
                    { role: 'user',      content: "Revise the JSON you just returned per the CRITICAL OVERRIDE: remove ONLY the phone-number request and keep every other field, sentence, and status fact identical (including any sold / no-longer-available / deposit / pending-approval status). Return the complete JSON object with all original fields." },
                  ];
                  const regenTimeout = Math.min(spec.timeout, regenRemaining - TIMEOUT_SLACK_MS);

                  const regenResult = await callOpenAI({
                    spec, messages: regenMessages, maxTokens: spec.tokens,
                    authHeader, timeoutMs: regenTimeout,
                    cacheKey, reasoningEffort: reqEffort,
                  });

                  if (regenResult.ok) {
                    const regenTotal = Date.now() - startTime;
                    console.log(`[${requestId}] REGEN OK ${spec.model} ${regenResult.latency}ms total=${regenTotal}ms`);
                    logCacheHit(requestId, 'regen', regenResult.usage, systemText + REGEN_CONSTRAINT_TEXT, userText, cacheKey);
                    finalResult  = regenResult;
                    finalLatency = regenResult.latency;
                    regenerated  = true;
                  } else {
                    console.warn(`[${requestId}] REGEN FAIL ${spec.model} ${regenResult.latency}ms → ${regenResult.error} (keeping primary output)`);
                  }
                } else {
                  console.warn(`[${requestId}] REGEN SKIPPED — budget exhausted (${regenRemaining}ms remaining)`);
                }
              }
            } else {
              // (v7.48) LOG THE SKIP, DO NOT JUST RECORD IT. Both skip reasons below were
              // already being written to classifyDiag, but the only console.log sits inside the
              // RUNNING branch above — so a skip was invisible in worker logs and surfaced only
              // popup-side via [LP WORKER CLASSIFIER] reading envelope._classify. On the 8/8 log
              // that made one of three generations unexplainable: it showed FINAL total ==
              // PRIMARY total with no CLASSIFY line, and nothing in the log could say which of
              // the two gates skipped it. Without this line the classifier's run rate cannot be
              // measured worker-side, and the run rate is exactly what sizes the prefilter below.
              classifyDiag = `skipped (sms+email too short)`;
              console.log(`[${requestId}] CLASSIFY ${classifyDiag}`);
            }
          } else {
            classifyDiag = `skipped (no phone on file)`;
            console.log(`[${requestId}] CLASSIFY ${classifyDiag}`);
          }
        } catch (err) {
          console.warn(`[${requestId}] CLASSIFY ERROR → ${err.message || 'unknown'} (keeping primary output)`);
          classifyDiag = `error: ${(err.message || 'unknown').slice(0, 60)}`;
          classifyFailed = true;
        }

        const finalTotal = Date.now() - startTime;
        console.log(`[${requestId}] FINAL total=${finalTotal}ms regenerated=${regenerated} flagged=${flagged} classifyFailed=${classifyFailed}`);

        const envelope = wrapAsGemini(finalResult, finalModel);
        // (v7.58) THE SUCCESS ENVELOPE NOW CARRIES ITS requestId. Until this line it existed only
        // in Worker logs, so a /feedback row could never be tied to the generation it rated —
        // "did the agent copy THIS draft" was not an answerable question from stored data, only
        // an inference from timestamps. The extension echoes this back on the feedback row.
        // It is an opaque UUID: no lead data, no customer data, nothing to scrub.
        envelope._requestId = requestId;
        if (i > 0) envelope[`_${spec.tier}Used`] = true;
        if (regenerated)  envelope._regenerated = true;
        if (classifyDiag) envelope._classify    = classifyDiag;

        envelope._edgeCache = 'MISS';

        const envelopeJson = JSON.stringify(envelope);

        if (i === 0 && !regenerated && !flagged && !classifyFailed) {
          try {
            const cacheResponse = new Response(envelopeJson, {
              headers: { 'Content-Type': 'application/json', 'Cache-Control': `s-maxage=${EDGE_CACHE_TTL}` },
            });
            ctx.waitUntil(
              cache.put(edgeKey, cacheResponse)
                .then(() => console.log(`[EDGE-CACHE] STORED ttl=${EDGE_CACHE_TTL}s`))
                .catch(e => console.warn(`[EDGE-CACHE] store error: ${e.message}`))
            );
          } catch (e) { console.warn(`[EDGE-CACHE] store setup error: ${e.message}`); }
        }

        return corsResponse(envelopeJson, 200, {
          'X-Request-ID':    requestId,
          'X-Model':         finalModel,
          'X-Tier':          spec.tier,
          'X-Total-Latency': String(finalTotal),
          'X-Regenerated':   regenerated ? 'true' : 'false',
          'X-Edge-Cache':    'MISS',
        });
      }

      console.warn(`[${requestId}] ${spec.tier.toUpperCase()} FAIL ${spec.model} ${result.latency}ms${result.status ? ` status=${result.status}` : ''} → ${result.error}`);

      lastError = result.error;
      lastTier  = spec.tier;
      lastModel = spec.model;

      if (result.fatal) break;
    }

    return safeFallback(requestId, startTime, { lastError, lastTier, lastModel, contract });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(syncValueFacts(env));
  },
};

async function handleAppointmentInvite(request, env) {
  try {
    return await _handleAppointmentInviteInner(request, env);
  } catch (err) {
    console.error('[INVITE] Unhandled error:', err && err.message, err && err.stack);
    return corsResponse(JSON.stringify({ error: 'Internal error: ' + (err && err.message || 'unknown') }), 500);
  }
}

async function _handleAppointmentInviteInner(request, env) {
  let payload;
  try { payload = await request.json(); }
  catch { return corsResponse('{"error":"Invalid JSON"}', 400); }

  // (v7.36) License enforcement — this was the ONE Worker route with no licenseKey check,
  // leaving /appointment-invite an open relay for dealership-branded invite emails via
  // Resend to anyone who found the URL. Extension v9.7.462/457 now attaches the key via
  // _lpAttachLicense on invite sends; this mirrors the exact /generate (:616) and
  // /feedback (:428) pattern, including the fleet-readiness log while REQUIRE_LICENSE is
  // off, so the reporter/console shows exactly which agents still run pre-462/457 builds
  // before the flag is flipped. Same flag governs all three routes — one flip, no
  // per-route sequencing.
  if (env.REQUIRE_LICENSE === 'true') {
    const invAuth = await validateLicenseRecord(payload.licenseKey, env);
    if (!invAuth.valid) {
      return corsResponse('{"error":"Unauthorized: valid licenseKey required"}', 403);
    }
  } else if (!payload.licenseKey) {
    console.log('[INVITE] no licenseKey in payload (REQUIRE_LICENSE off — fleet-readiness signal)');
  }

  const required = ['customerName', 'customerEmail', 'date', 'time', 'dealerId'];
  const missing = required.filter(f => !payload[f]);
  if (missing.length) {
    return corsResponse(JSON.stringify({ error: `Missing fields: ${missing.join(', ')}` }), 400);
  }

  const dealer = DEALER_INFO[String(payload.dealerId)];
  if (!dealer) {
    return corsResponse(JSON.stringify({ error: `Unknown dealerId: ${payload.dealerId}` }), 400);
  }

// ═══════════════════════════════════════════════════════════════════════════
// APPOINTMENT INVITE REBUILD (2026-07-28). Fixes: (1) timezone bug — invites
// went out 5-6 hours early because appointment times were run through a bare
// new Date() with no offset, which Cloudflare's UTC runtime parsed as UTC;
// (2) unescaped commas in dealer addresses (RFC 5545); (3) METHOD:REQUEST
// with no organizer/attendee — replaced with the correct PUBLISH default;
// (4) branded HTML email with the correct dealer logo embedded inline via
// Resend's CID mechanism (no external hosting to break) — was plain text
// only before. Everything else in this file (license/auth, /generate,
// /feedback, aggregate, etc.) is untouched. See DEPLOY_NOTES.md.
// ═══════════════════════════════════════════════════════════════════════════

  // (FIX) Parse the wall-clock digits directly — no Date() timezone guessing.
  var wcStart = parseWallClock(payload.date, payload.time);
  if (!wcStart) {
    return corsResponse('{"error":"Invalid date/time"}', 400);
  }
  var wcEnd = addMinutesWallClock(wcStart, 60);

  const icsContent = buildICS({
    customerName: payload.customerName,
    wcStart, wcEnd,
    dealerName:  dealer.name,
    address:     dealer.address,
    mapsUrl:     dealer.mapsUrl,
    vehicleText: payload.vehicleText,
  });

  const sent = await sendAppointmentInvite(env, {
    customerName:  payload.customerName,
    customerEmail: payload.customerEmail,
    dealerName:    dealer.name,
    dealerId:      payload.dealerId,
    address:       dealer.address,
    mapsUrl:       dealer.mapsUrl,
    vehicleText:   payload.vehicleText,
    wcStart,
    icsContent,
  });

  if (env.LEADPRO_LICENSES) {
    // (FIX) The old log called dtstart.toISOString() on a Date object that was
    // itself miscalculated by the same bug this patch fixes — so every past KV
    // record's dtstart field has ALSO been wrong by the same 5-6 hours. Going
    // forward, log an explicit, correct, DST-aware Central offset instead of a
    // bare Z-suffixed value that invites the same misreading.
    await env.LEADPRO_LICENSES.put(
      `invite:${payload.leadId || 'unknown'}:${Date.now()}`,
      JSON.stringify({
        leadId: payload.leadId || null,
        dealerId: payload.dealerId,
        customerEmail: payload.customerEmail,
        dtstartCentral: centralIsoString(wcStart), // e.g. "2026-07-29T10:30:00-05:00"
        sent,
        timestamp: new Date().toISOString(), // this one IS a real instant — correct as-is
      }),
      { expirationTtl: 60 * 60 * 24 * 90 }
    );
  }

  return corsResponse(JSON.stringify({ success: sent }), sent ? 200 : 502);
}

const LOGO_ASSETS = {
  '6189': { // Community Toyota
    filename: 'toyota-baytown.jpg',
    contentType: 'image/jpeg',
    contentId: 'dealer-logo-6189',
    base64: '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',
  },
  '6190': { // Community Kia
    filename: 'kia-baytown.jpg',
    contentType: 'image/jpeg',
    contentId: 'dealer-logo-6190',
    base64: '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',
  },
  '6191': { // Community Honda
    filename: 'honda-baytown.jpg',
    contentType: 'image/jpeg',
    contentId: 'dealer-logo-6191',
    base64: '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',
  },
  '24399': { // Community Honda Lafayette
    filename: 'honda-lafayette.jpg',
    contentType: 'image/jpeg',
    contentId: 'dealer-logo-24399',
    base64: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAQDAwMDAgQDAwMEBAQFBgoGBgUFBgwICQcKDgwPDg4MDQ0PERYTDxAVEQ0NExoTFRcYGRkZDxIbHRsYHRYYGRj/2wBDAQQEBAYFBgsGBgsYEA0QGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBj/wAARCABeARgDASIAAhEBAxEB/8QAHQAAAgIDAQEBAAAAAAAAAAAABwgABgQFCQMBAv/EAFcQAAEDAwIEAwQDBwoTCQAAAAECAwQFBhEABwgSITETQVEUImFxFTKBIzdCUnWhsxgzOGJjcnSRssEJFhcZJTZDU1RVZHOCg5OxwtHSJDREVpWjxNPh/8QAGwEAAgMBAQEAAAAAAAAAAAAAAAQBAgMFBgf/xAA2EQABAwIEAwYFAwMFAAAAAAABAAIDBBEFITFBBhJhE3GBkbHwFCIyUcFSYtFCcrIjNDWSof/aAAwDAQACEQMRAD8Af7XwkJBJOAPM6+6XHiNv6pLd/qf0KSthpTYXU3miQpYUMpZBHYY95XqCB2zkAQrHe/E/txaM12nQFzLjnNEpWilpSWkKHkXlEJP+jzaoTXGlCMkJe23qKGc9VoqLalY/elAH59DXb3ZSs7hVJxuF4UKnxyEvznUEpQT2SlI+srHXHQDzI6ZMbvCFbZp5SxdlSTLx0cXHbLef3gwcf6WpsEIh2Bvzt5uHJbgUypOwKov6tOqSAy6s+iDkpX8kkn4aJmlMtXhYqydwPCut5gUOIpLvjw3MKmdeiE/hN9veJ6j8E9cho6jU6TbdvO1GqzWIFOht8zj76+VKEjp1J+wepPqdCFsNTS3XFxg2xAqK49t2lVa00g4El51MRC/ikEKVj5ga/NvcYVtTqgiPcloVWjNKODJZdTLQj4qACVY+QOoshMnqawaNWaVcNEj1iiT2J0GSjnakMK5kqH/PyI7g99aq9L4tywLZXXblnezxwrkbQhPO48vGQhCR1Urp8h3JA0IVj1NKxO4y2UzFJpe3Ex+OD0clVFLSyP3qUKA/j1c7S4qNvq7TZTtfZm23KjtF0sSR4yXgPwWloHvK/akAnyzoshHTU0rlU4yYjdQW3RNvJ0uKFe69LnIYUoevIlC8fadXXbriZtC+K2zRKnTpdu1KQoIYTKWl1l5R7IS6nGFHyCgM9h16aLIRu1NQnAzoB31xVWja9aepNvUiXc0hhRQ6+w6liMFDoQlwgleDnqlOPQnQhHzU0sNE4x6ZIqKGbisSfToylYVIhy0yigepQUoJHyyfhqy3pxV2Nbzjce2oUu6X1oDhVGUGGEZGQCtYzzeoCTjscHposhHnU0rtJ4yYTs9Ddc2+nw45VhT0OciQpI9eRSUZ+w6Yq17poV5WxHr9uz0TIL4PKtIIKSOhSpJ6pUD3B66ELcaml+n8VNEg7kSLQVZlZW8zUzTDIS8zyFQe8LnxnOM9fXGmBz00IU1NL/WeKiiUbcibaDlm1l56LUjTTIQ8yEKUHPD5wCc4z19dHCt1yk25b8qt1yc1CgRUFx5909Ej/eST0AHUkgDQhbDU0sVc4xqVGqDjNu2JUKjHScJkS5SYvP8AEICVkD54Pw1t7N4tLUrtXap9z0GbbZdIQmWp5MmOkn8dQCVIHxKcDzI1NkJhtTXg9Jbbp7ktOHEJbLg5CDzADPQ6BFj8UtEvfcCk2rGs6sw3ai6WkvvvMlDeEKVkhJz+D5ahCP2ppdri4tKHbt31WgPWRXH3KfLdiKebeZCVltZSVDJzg4z11rP1Ztvf+Qq//t2P+rRZCZzU0Jtp99KfuxVKrBp1tVGmuU9hD5VLdbIc5lFISOUnHbz9dU5XFrQ4N3mgV2xq9SnWZfsktx51lQjEL5VqUArJCep6dwOmhCYrU1izKjCgUd+qS5DbUNhlT7jxPupbSOYqz6YGdAS2uKqnXbekC2qJYFeelTpAZaUp5kAJ7lauuQkJBUfQDQhMLqampoQoe2kvvis0GZuXX5Euqxw8Z7yVJUTlPKspA7eQSBp0D21zp36p0m0uIS44T7akNS5BqMdR6Bbb3vZHyVzp+aTqQVBTy7WU6FTtpKImByKbkRkylOI/uinPfKvzgfIDVx0BeF7c+k3XtdFtF6WhFcojfgqjrV7z0cH7m4keYAISfQgZ7jR55h6jUKV90rPERWZ9xXqLYbdWKXSwla2kn3XX1J5io+vKkgD0JVplma3R5NdlUOPVIbtSitodfhoeSXWkLzyqUgHIBwcZ0km9V4Vu3d/Llpy/A5ESUvNpU0CVIU2hSevn0ONSFBRu234crSZtmNVLzgGpVCSgO+yrcUhqOkjIThJHMrHcnpnoB0yfTcThxs+VbUioWbTjTKlHQXEx23FKakADJThRPKo+RHn30aaFVoNdtqBWaa6h2JMjtyGVpOQUqSCP9+vSq1OFRqHMq1ReSzEiMrkPOKOAlCUlRJ+waLqUsHD1WZ9tX0LcW6s0uq5+5KPutvhOUrA8ioApPr7vpr98Rzcqt7mw4DhUYsGEktoz05nFEqVj1ISkfZoc7Q3nWrj39tqAwGeR6eXlISyAUtpSpavlhI1u+JS8anRd+ZEGLJQ22KfGXylCT1IV5kfDU7qEX9r9ibEXtvBqVx0JmqT6g0JC1yFKw0lXVKUAEYwMZPfOdBTcfbKHae5E6kU4OKg4Q/H5zkpQsZ5SfPBChnzAGm12zlOTdmrVmOq5lvUmM4ogYyS0k6VziavCp0TfUwYklLbf0bHXgoSepU56j4agaoRb2x2KsFe21PqNw0FiqVCeyH3HJClENhXVKUAEAYGOvfOeugtuZthCtLciZS6UHRBUlEiNzKJU2lX4Oe55VA4PftprNq5bk7ZO1JjyuZx6lR3FKAxklsHS0cT13VKh73MQoklLbZpbDnKUJPUrdHmPhoGqEc7jr1Vf4Ul1YPLTUZVKZaW6D73M5ytrVnyPVR0CNn9qKRdt+qYrjCl02Ex47jAUU+MchKUEjqB3Jx6Y89Ea4q9MZ4AYdeS8BJVTYSy5yjGVPNg9O3nqq8KF01Cv3zcTEyQlxLUBpaQEBOCXSPIalCs282yVm0+xVXBa9HapkiG4gPNxyeR1tRCeqSThQJByPjnQ+2e2qo92364zX2Fu0+HHMhbAUU+MrmCUpJHXl6knHoNMDv5UX6Tw73JUIywh1ptopUQDjL7Y7H56C3CjdVQr24lfjzJCXEtU5CwAgJwfFx5DUDRFlbd49kbLg2A7X7YozVLlQloLiI5PI82pQScpJIyMg5Hoc6wuGVMul16u0bmV7I8wiVyHslxKuQkfNJAP70aJm+1QepXDzc9QjrCHWY6ClRAOPuqB5/PQN4VLqqNe3RrcaZIS4hul84CUJHXxkDyHx0bIVTrVupXv9NleH3uJTmcf5VnTxDtpDLh3Dmwt/qlEcERDDNxLbUpTfUJErBJOfTT5/g6CgJHrst0O7/1eV4f1q+pecf5QDoy8TSpU2kUGhtqWIzrzsp1I7KUgJSjPy51H540Cbo3Dmf1f6rEjCGtj+mFbKFeHkke08vfOilxZ3LOoFUtRMN9LQealFWUBWcKa9R8dShZuyOy9pVi2JFw3TSm6ktx9TMeO+T4baU4BVgEZJJI69gPjqqb07S0S07uiPW9EVHp09pSxG5ipLTiSAoJz15SFJOD26+WjFw2VaRWtg4U+U4HHFS5KSoJA6B0jy1QuLa5J1vuWl7G+lrxva+bmQFZx4XqPjqN0Im7PyZcrh/hR5i1uORW34iVLOSUIKggfYnA+zS47O28Im+FsyfDxySCc4/cljRy4eazJq/Df9IyXA477RMHMEgD3VHHQaXrZS+6nVN+rVgPrjlt6SUqCWgD+srPf7NShNHdOz22sum1msvWfT3Ki80/JXIIVzKdKVKKvrd89dLZtJYdIrO7FIp9eprU6A6h3xWHgeVZDKiM4x5gHTkXO6pix6u+nHMiC+sZ69m1HSacPl71Ksb/27T5C45bdbfJCGgD0jrPf7NQEJu7Y29syzJUiTa9vRKY7JQlt5bHNlaQSQDknzJ0EOIzaxiTUm78p0YfduWPUUpT3V2bdPzHuH5J0yusWpU+LVaTIp05oOx5DZacQfMHpqApSpVS/qnUeHOHYKlPGaF+ySXznK4iMFAz6nog/BB9dXvhz2xZoNOevaoRwJs1BZhhQ6tsZ95XwKyB/opHrpd7ZuedV936VacqQ0YsmsIp7i0spCygvch+RIH59dAGGWo0ZuOw2ltptIQhCRgJAGAB9mrFQvTU1NTVVKmg9v/sdE3gtBpUCQ1AuWnhRgTHB7iweqmXcdeRRAOR1Seoz1BMOpoQuRdy0rcDaa8EM3BT6tbNViuczEoKU0CR+Ey+k8qx8Un5+mt89xPbzPUkwHNzKoGCOUrSWUOY/zgQFfbnOugNzXtOc3nh7eTLMj1OjS/D8R2SyXecKBJcAIKOVPY59D26a8r9tWwbKtn+mCjbT2lKml9DZX9DsgNA599XKjPkB5dSNNGkl5mNtm/MZjdKCuhLZH7MNjkdkjWxlv713RubDujbePNbkNvcz9en84hlJPvh5xX68FDuhPMo/AgENZxK7EVzcGiRLxtRDD11QIwZlQ2z4aag0OuEFR6LSSrl5j1BwTkDR4tipO1Kx6fU3aWYLjscL9jSnl5OnZIIGAemPgRrSWHedWuqTUWqlRfYUxiORSQoYJJHIrm/CGPLVOwfZx/TqtPiY7sH6tMvFc/rI4kN0dki9ajzDXs7K1Zo1wR3G1RlE5VydUrQCeuOqcnIHXX2+eJfdDehtu02WWG4shaQaRQI7ji5SgcgL6qWsA4PKMDIyQdPpeMmDMvinUKq2VTa1FdCPus6Il8+8og8nMkgcvc5/NrbTafRbHoD8617WpcRZKUqTCiIZGCe6uQAkDUGF/wAv7tFIqIzzH9OqC3C/sNV7Dju3xfLCWbgmM+DFgZCjBZVgqKyOniqwMgfVAxnJOl24y6wIXFLLZLqU/wBiYZwT6heuhtEqD9ToEadIj+zuupyW8Hp1xkZ8j31qKVMRXKzLbqNDjJLXQOLaBUMHASokd/PVezd83TVWEzfl66LXbMO+Nw62M9nPPQYas/NlOki40asIXE+WC6lP9hohwT+2d0/sypPQKnGgRYQLKgAOVJHTOMJx0GNZFTjQiwqU7To0l0ADLjSVHGfUjONV5CLdVIkbn0VR2Od8fhssR7OeehRFZ/1SdJhxsVYQuJeKyXQn+wcZWCf3V7XQWCsKgN4ZSyAMBCRgAfAemvzIhU2Q94kqLFdcxjmdbSo4+ZGo0KuCDmlXu+eEf0KanzisAGjU082fWQ1qjcCNTE7c670BwK5aWweh/dlaeX2eG5EEQsMKYAA8LkBTgdunbXyPBhRFqVFiMMqUMEtthJP8Q1CEJeKiR7Lwi3lI5gnkZY6n+EtDS4cCdUE/du62w4FctIaV0P7vp7HkRn2lMyEtOIPdCwCD8wdecaFAjLK4kWO0ojBLTaU5H2DQhCvihkey8JN6v5xyxGzn/Xt6WTgXqgn73XK0HQrlofN0P+UN6fV1lp9lTL7aHG1d0LSFA/YdeUeBCiOFcWHHZURgqbbSkkfYNCFz/wCKva25rM3Pqd8U+nSJVsVh0y1y2EFYhvq/XEO4+oCrKkqPT3iM5GtRC42tzYdgot5K6E9KbY9nRWXUKMkADAURzcilgfhEd+pB10dWhLiChaQpJGCCMgj01W17c7fOSzKXYttKkE83jKpbBXn1zyZ0ISC8N22l0bn7qU24pUKUi2adLTNmVJ9BCJK0K50tNqP64pSwOYjIAzk5IBI3HpURArlipLgTzsTj1PfCmdOu000wyhlltDbaBypQgABI9AB215yIUOWUmVFYfKfq+I2FY+WRoQgPwbShM4Vqa+FBWahNGQfR46FvHvURAdsLKwnnE/ufTwNOaxHYjMhqOy20gHPK2kJH8Q1+JEOJL5faorL/AC/V8VsKx8sjQhLvwkzBL4OzICgr/tVQGc+izpROGuuJk8VNjMB5KueaoYCh/g7uuorMaPHY8Fhhtpvr7iEhI69+g1jtUilR3kvMU2I24jqlaGUpI+RA0IWtvVfh7ZXAvOOWmST/AOyrXOjhKraZfFhaDAeSoqaldAoH/wAI4dOVevEZQLOvepWrNtqpTHIaktrdacaCF8yEq6BRzjCsddXfbe4aDfFmxrspNAbpqXHHGkIW22HE8iik9Ujz05Nh9RDEJpG2abWOW+YSMGJ0s8zoI33eL3Ge2RV1HbXw9vt191NJp5crNuq6l3i6tuOH0kqu5tGOYf4WRrqnrCRR6U2+HkUyGlwK5wsMIBB9c476zdCFNTU1NCFNYNZWtu3Z7jailaYzhSpJwQQg9dZ2vGZGRMp78RxSkpebU2SnuAQR0/j1ZpsQSqvBLSAkJgOT3XI7JlPlboSRzPK68wB69dXe45sxxdCUubIViiQ8czqs9Uq+Ov1NsiLRdzHKMzOfdYgVWBTAtaQFrS63krOOgI5e2PPW63MtddAu+nUmAzPksR6fHhIkOMnDziQrokgYJxgkDX0OSpiklYBuL+n8hfMY6WWOJ5dsbHzP8FYtHkTVWTVmEzHiHJETKfFVg9Xe/X4D82tnZ70n+m6lOpkO+7LaBPiHPVQGs/b22G6zZdeel+2xw0luWy6lvDbwbDhwFEYPU4ODrZbbW2xPuOMX5TqQ3DYqY5EjuF/U+Xx7651RPG0Sj7fwF1KankcYSN/wStE0++p5RVIdJUokkuHzPnqyzHpC4NKJfdITCSOqz/fHB/NqvLiPsTnmlRZLfKvol1spUAo+7kY6EjV+l2+2LSoUpapLL75ahLadRjk95ZJwcHuf4tL1D2tLSfeSZpo3uDrbfysSmOPpodSy8sBaGj9c9fumNZFNcdFQjkOrBDqMe8fxhrNp9ISdv5E9svuvuKDAabTzD3HSc9BnWLSGVuVSL9ydUjnSo8iSTyhQyflpIuaefv8Awn2sc3kv9vytglThkrJWolSyc8x69Trc8y/Z4oK1dGz5/tzrGnU9EOqvNIdUoNBC/eHU8yj/AM9bSfDERxhpsOLSlBBWR0yVEgfPrpJ72m1k+xjhe6zqQT4yup+r/PpQuJlxxO/T4S4tI+j4/QKI/H031ISQ4olKu2AcfHSf8Tf3/H/yfH/49dbhr/fH+0/hcXiv/jh/cPyiDwjLWuBdvOtSsOxfrEnHuuaZbSc8Pe5lo7ew7gRdE5+Mqa4wpkNxlvcwQlYVnlBx9Yd9Gr9UptP/AI6m/wDp73/TqmOYfUy10j44yQbZgH7BacP4nSQ4fHHLK0OF8iRfUpTdyXXRvLdgDrgAq8roFn++q02XDYpSuH2mlSio+0yepOf7srSf3rU4dZ3Jr9Yp7inIkyoPyGVqSUlSFrJBIPUdD203/DV+x8pv8Jlfpla7PEbS3DowRndvoVweF3B2KSkHKzv8gi7qaFW6e+Vv7cPfRTMc1auKQF+xtr5Esg9lOr68ue4SASR16DroCzOKHcuRKLkZuiRG89GkRVLwPiVLydeZo8Cq6pnaMbZp3OV16yu4ioqN5ie67hqAL2/Cc/U0q9o8VtSRPbj3tQ4zsZRAVLpoUhbfxLaiQofIg/PTN0qrU6uUSNV6TMalwpTYcZfaOUrSfP8A/PLS1dhlRRECZtgdDsm8PxamrwTA65Go0KzdTSrVjinuim3FUKc3a9IWiLKdYStT7oKghZSCfj0173DxWTm6ZBZtqhw3Jyoza5kiUVlpt0pBU22gEFQSenMT18h56dHDtcbWZr1CRPFGHgOu/Tof/E0WppUbZ4rq43Vmm7uoMF+ApQC3qcFtutj8YJUohePTIOmkp1ShVajxqpTpKJMSS0l5l5s5C0KGQR9mkq7DKihIEzcjodk9h2LU2IAmB1yNRoVlah7HS/7n8SkS2a1It+z4EeqTY6i2/NkKPs7Sx0KEhPVZHmcgA9OuhxTuKfcCPUEu1KnUWdFz77KGVsqx+1WFHB+YOnIOHq2aPtGtsDpc2J99UjUcTUEEpic4kjWwuB76XVR32/ZEXR/n2/0DemX4af2PtP8A4VK/SnSnbj3LDvHdCrXNT2nmo85TbiW3gApBDSElJx06FJ6+emx4av2PtP8A4VK/SnXoMeYWYVExwsRy/wCJXmuHXtkxiZ7DcHmI/wCwRe1NArdXiLgWbWX7dteCzVaqweSQ+8siPHX+J7vVah5gEAds5yNCuFxTbiMVBLs2DQ5cfPvMBhbRI+Cgs4PxIOvP0/D9bPGJWtsDpc2v76r01VxNQU0pic4kjWwuB76JydTSr1fiyqQqWaFa8NUMtIViY6sOIWU++k8vQgKzgjuMdtGnZ6/p+4+3q7hqMCNCeTMcjeFHUpScJCTnKuufe0vVYPVUsXbTNsO8Jmkxujq5uwgdd3cVf9TU1NcxdZTU1NTQhL3WaZRahxHTrdave3U3BKqsGrooq3l+1hhhlSl5Ry4zynmHXGOuRorXras65ZlAdhyGGk0+eJTvik5KOUj3cDvk/DSruE/16RodcfQX/wAE6t+72++7T3E/H2K2OotCcrMeGmfUZ9cyW0AoDnKACAEhKkZV1JKwABjJcdXSuLXE/SLDyt6JFuHwtD2gfUbnzv6o40OiLtDZN2k1yow2BEhyFPyyshlpJ51FRUQMJAOSfgdCjhw3Is3cS7ayi0KjJnN0SmRob77kRTDbylLWQpoq6qT7h7hJ7dNBeqb6b47i7Xb+2Nc1DtamVO2qSpp+NHQvlQ0VrRKw4XFBavCSooxjqR31WNqt89ytiuBamVh2hW7Og1SUYFohAV4pcL8hUlyWAocwSpICEjBPMMnA1Q1chDx+rMrQUcQLCP6BYJ4q7ZVTqlyT6gxKiobkLiqSlZVkeEfez0/i/m1YbhpEirtQEx3G0GPMbkK5yeqU5zjHn10o6t9eKGxt8NtNvd0qBZcZu6ag2yuXAbW4tTS3UIWjo5yocRz98EHmHfGtjD4s7l28vzc+yd741GZqttxFTqE7T2Vx0VZPZtAC1qypwOMqGD0HiZ+rqpqHnlvtp6KwpYxzW/q187/lNPb9IkUm3TAkONqcK3FczecYUSR31iUK3plLmx3n3WVJbjqaUEE5JKyrp07Y0mtT4vN37c2Tsup3HTrZiXLe0hyRBeVAkezU2nIUlAecaQpbjq1qUpaQnOEJBwSoDX5/VH7kbgbQ7r2CpNDq1QiW2/OgXJCp8unxZMVISJaFNvpStDyWluFBGAVI8+hNTM436qwgYOXponTqFFky6jIkNuNJS4ltICs5905OtnNjLksIQhSQUuJV1+B1yoq1U3f/AK2vQ3prlITZX08RDlNPOfSCleJI5gs82MeJz4/ahOjjXeKXdSx2bM2uqjlp0O4VUtEyrV12FKnxmGVBRjIbZY5lqWWktlSiCOZeOgBOqmQm3RWEbRfqnpiMKjsKQogkrKunx0l/E39/x/8AJ8b/AI9Fnhi33ru8VKuKm3TTYzNWoUhCBUIEZ+PFqLDnOEPNoeAWg/czlJ9UnAzgCbia+/4/+T43/Hr0XCxvWk/tPqF5jjAWoAP3D8qt7b7SXBuezUXKHPpsUQFNpd9tUscxWFEcvKk/inV6/UoX/wD49tz/AGj3/wBerVwif9wu3/Oxf5LmmX07i+PVdLVvhjIsLbdAVz8F4coquijnlB5jffqQua1cpEigXRUaFLcackQJLkV1bRJQpSFFJIzg46eenD4fJiKdwyMT3BzIjrmPKHqEuKV/NpVNyvvzXZ+V5X6VWmu4dorU3hsiQ3wS087LbWB5hTqgfzHT/ET+egjc/ct9CudwuzkxKVjNg4DzCTSr1ebXK1MrlSeU9KmOqkurPUlSuv5uw+AGm0284crHTYUKZdkJyq1ObHQ+4oyHG0Mc6QQhAQR2BHU5yc9h00rF1WzUbQu+fbdVZUiRDcLeSMBxH4Cx6hScEH46PFhcT8eh2VFot1UObMkwmUstS4SkfdkpGE86VEYUAACRnPfA01jLKqWnZ8AcuhtltbolMCfRw1UgxIZ/uFxe+d+qGm8+3MfbbcJNMp8hx+nTGBKi+KcrbHMUqQo+eCOh8wR550YOE24Zb9Jr9sPuKXHiuNTI4P4HicyVgfAlKT8yfXQL3L3BqG5N8rr0yOmKyhsR4sVKubwWwScFXmokkk/8tMHwrWjMplo1S65rSmk1VbbUVKhgqab5sr+SlKIH73PnpbF+ZmE8tUfny87+ttfFNYLyPxouox/p5+VvS9reCWG6P7fK5+UZP6VWmk2r2IsCo7R0qrXHSPpOoVOMmUt5b7iPCCxlKUBJGMAjr1JOflpW7p/t7rn5Rk/pVafPar7x1p/kmP8AoxqvEVTLBSxdk4tudstlfhelhqKyXtmh1huL7pFr5oDFrbl1y3YrrjseDMWy0tw5UUd05+OCBpnLPuOZb3Aj9ORnFJlRYMlthYPVCi+ttBHyKgfs0ve8f3+7s/KCv5KdMXtzbi7u4JUW40QHpkSU20ScDxA+tSM/DmCdWxh7XUdM+bMczCfI3VcDjc2uqo4MiGvA8xZKNToEiq1uJS4pCpEt9EdsrPQrWoJBJ+Z66cincMm2se2EwKhHnzJxRhyo+1Lbc5sdShIPKkZ7Ag/HOk3SqfSK0FcrkSfDfBwoYWy6hXmD5hQ/NpnKbxZ0tNrpNVtacqsJRgpjOIEdxXrzKPMgH0wcfHW2Ox17ww0RNt7G3d4Jfh2TDozIK8C+1xfv8fYS935aj1kbi1W133/aPY3QlD2MeI2pIWhRHkeVQyPXOmY2krbtt8GU6usfr0Jue81+/C1cv58aV26rkqF33lULkqnJ7VOd8RSUfVQMAJSnPkEgAfLTV7K0NNy8IkigLUE+3pnRgo9klS1AH7Dg6zx27aKL4jXmbzeRutOHbOr5vhshyu5fMWShIRJnT0t8ynpMhwJ5lnqtalYyT8Sfz6cihcMm3kO1kQ62xKqVTU392nCStrlXjr4aUkAAHtkE+udJ3Nh1CjVl+BOaciz4bxadQeim3EHr/ER/u0zNB4sIDVqtt3Fbk56sNthKlw1oDL6gPre8QUZ8xg48ta46ytkYw0RNt7G3d4LLh2SgjfIMQAvtzC43v46IEbk2WuwNyqhbHtJkss8rrD6hhS2lp5k8w/GHUH4jTQcLP3jnvyrI/ko0qV63dUb4vidc1UQht6UocrTfVLSEjlSgZ74A7+ZyfPTW8LP3jnvyq/8AyUaXx8SDDGib6rtv32zTPDRiOLPMH0WdbuuLI26mpqa+fL6YpqampoQln3W4SHdx995O6VL3Wrtp1N6O1GSKXHwttKG/DOHUuJV7w7j46w69wbqqT1sXDSN4bpo970aJ7FIuhoFb9Qb5llJc+6BQWErLfNznKQkEHGmk1NCEtFlcH9Nsyl7kQ07h1mqqveluU6RKqEdDj7JXzczql833VZKyTnGdbSRwm2lU+Eik7G1quTZbdJfclwa02ylp5l5TriwrkyUkYdUgpJ6jzBwQwepoQlUonBnMibk2bfFz72XRdFTtiW0+19JshxC2mlpWhlHM4otjocnKs5zgY0NuIG2qFxFf0QG1tr6HCbULfhk3NV2D7yWAsOKYJHQFIUEA9wt8g/V0+msSPS6bEnPTYtPisSX8l15plKVuZOfeUBk9evXQhCvd3h9t3dGm205Bq060q5azgcodWpKU80MDlwjkOApA5EEDIIKRg4JB1dA4frgj2teUO9N57tu+p3NSnqSqRNV4cSEh1soK2YYWWwvt1+GBjKsnPU0IS4VDhKps/g/pOwxvWW3Fp9RVUBVRBQVuEuOr5S3z4A+64zny1tb94Z2Llu63b4s+/atZd6USnIpaKzBYQ8mSyhBSA6yogE4Kh37HBBwMHrU0IQ92n2zqO29DnM1rcK5r1qk9/wAeRUK3KUtKcZwhloqKWUdScDuT3wABotxdgaTuJe67kmXDUILqmG2PBYabUnCM4OVdfPRf1NMU1VLSv7SF1ilqujhq2dnO241Q82s2np+1rNUbgViXUBUFNqUZDaE8nIFAY5fXm/Noh6mpqs88lRIZZTdxV6enjpoxFELNGyA1w8MFDuC7anXnrrqjLk+U5KU0hlopQVqKiASM4GdFDb2yYu31ix7Zhzn5rTLjjgeeSlKjzqKj0HTz1adTTE+JVNRGIpX3aNskrT4XS00pmiZZx3z3VK3A2stPceC2iuxVtzGUlLE+MoIeaHfGcEKTnrykEfLQQmcI00ST9H3wwpny9ogEKA+PKvB/NppNTWlJi9XSt5In2H2yPqsqzBKKsdzzR3d98x6aoBWjwsWvSJzc26Ku/XlIIUIqWvZ2Cf2wBKlD4ZA9QdHlllqPHQww2hpptIShCEhKUgdAAB2A9NemprCrrp6t3NO6/v7Jijw+nom8tOwNv711S/VLhVoNSrUyoru2qtqlPuPqQlhohJWoqIHT46Nls0Nq2rNplvMPrfbgRW4yXXAApYQkDJA6Z6a2upq1TiFRUtDJnXA00UUuGU1I8vgZYnXVA27OGmi3Xe1TuSRdFSjOz3y+pltlspQSAMAkZ8tE6w7QjWJYUG1osx6YzE8TleeSEqVzLUvqB0/CxqyamifEKieMQyOu0aDLbJRT4ZTU8rp4mWcb3Oe5v6oUbk7CWruDUF1ht56jVhYHiS4yApD2BgFxs4Cj5cwIPrnQ6pvCOlNRSqr3qXYiT7zcSF4bix6cylkJ+eDpnNTW8GNVsEfZMky8D6paowCgqJO1kjHN4i/eAbIB1jhVtOo1l2XArtQpkZQQluIw0haWwlIT9ZXUk4JJPmTopbe2RF2+sZi2Yk5+a0y444Hn0pSo86iojA6eerVqaxqMSqaiMRSvu0JimwqkppDNCwBx99yGO5Wx1q7jSfpN1btKrHKEmfFSD4oHQBxB6LwOx6HyzjQvhcIyxUUmo3wFRAcqTGgcrih6AqWQPng6Z7U1tT4zWU8fZRyZeB9QsKnAaCpk7WWO7vEX77FASs8K1o1Cph+nVuo0uOlptpMdptDg91OCoqV1KlHJJ9Tol7bWBE22s1dvQqjIntKkrk+K+hKVZUEjGE9Me7q4amsZ8Tqp4+ylfdq2p8JpKaUzQxgO9+CmpqamkV0V/9k=',
  },
  '21135': { // Audi Lafayette
    filename: 'audi-lafayette.jpg',
    contentType: 'image/jpeg',
    contentId: 'dealer-logo-21135',
    base64: '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',
  },
};

function escapeICSText(str) {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\n|\r/g, '\\n');
}

const CENTRAL_VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Central Standard Time',
  'X-LIC-LOCATION:America/Chicago',
  'BEGIN:STANDARD',
  'DTSTART:20241103T020000',
  'RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11',
  'TZNAME:CST',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0600',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:20250309T020000',
  'RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3',
  'TZNAME:CDT',
  'TZOFFSETFROM:-0600',
  'TZOFFSETTO:-0500',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
].join('\r\n');

function parseWallClock(dateStr, timeStr) {
  var dm = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  var tm = String(timeStr || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!dm || !tm) return null;
  return {
    y: +dm[1], mo: +dm[2], d: +dm[3],
    h: +tm[1], mi: +tm[2],
  };
}

function icsLocalString(wc) {
  var p2 = function(n){ return String(n).padStart(2, '0'); };
  return '' + wc.y + p2(wc.mo) + p2(wc.d) + 'T' + p2(wc.h) + p2(wc.mi) + '00';
}

function addMinutesWallClock(wc, minutes) {
  var ms = Date.UTC(wc.y, wc.mo - 1, wc.d, wc.h, wc.mi) + minutes * 60000;
  var d = new Date(ms);
  return {
    y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
    h: d.getUTCHours(), mi: d.getUTCMinutes(),
  };
}

function formatWallClockHuman(wc) {
  var WD = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var MO = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var d = new Date(Date.UTC(wc.y, wc.mo - 1, wc.d, wc.h, wc.mi));
  var h12 = wc.h % 12; if (h12 === 0) h12 = 12;
  var mer = wc.h < 12 ? 'AM' : 'PM';
  var mi2 = String(wc.mi).padStart(2, '0');
  return {
    weekday: WD[d.getUTCDay()],
    dateStr: MO[wc.mo - 1] + ' ' + wc.d,
    timeStr: h12 + ':' + mi2 + ' ' + mer,
    full: WD[d.getUTCDay()] + ', ' + MO[wc.mo - 1] + ' ' + wc.d + ' at ' + h12 + ':' + mi2 + ' ' + mer,
  };
}

function centralIsoString(wc) {
  var nthSunday = function(year, month, n) { // month: 1-12, returns UTC-anchored day-of-month
    var d = new Date(Date.UTC(year, month - 1, 1));
    var firstSunday = 1 + ((7 - d.getUTCDay()) % 7);
    return firstSunday + (n - 1) * 7;
  };
  var marchSecondSunday = nthSunday(wc.y, 3, 2);
  var novFirstSunday = nthSunday(wc.y, 11, 1);
  var isDST = (wc.mo > 3 && wc.mo < 11)
    || (wc.mo === 3 && wc.d >= marchSecondSunday)
    || (wc.mo === 11 && wc.d < novFirstSunday);
  var offset = isDST ? '-05:00' : '-06:00';
  var p2 = function(n){ return String(n).padStart(2, '0'); };
  return wc.y + '-' + p2(wc.mo) + '-' + p2(wc.d) + 'T' + p2(wc.h) + ':' + p2(wc.mi) + ':00' + offset;
}

function buildICS({ customerName, wcStart, wcEnd, dealerName, address, mapsUrl, vehicleText }) {
  var uid = crypto.randomUUID() + '@mycommunityauto.com';
  var descRaw = [
    'Thank you for scheduling your visit!',
    vehicleText ? 'Vehicle: ' + vehicleText : '',
    'Directions: ' + mapsUrl,
  ].filter(Boolean).join('\n');

  var vehicleSuffix = vehicleText ? (' for your ' + vehicleText) : '';

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Community Auto Group//LeadPro//EN',
    // (FIX) No METHOD line -> defaults to PUBLISH. The old METHOD:REQUEST
    // implied a negotiated meeting invite (organizer/attendee RSVP flow) with
    // no ORGANIZER or ATTENDEE ever supplied — a real mismatch. This is a
    // one-way appointment notice; PUBLISH is what it actually is, and it's
    // what the sample .ics uses.
    CENTRAL_VTIMEZONE,
    'BEGIN:VEVENT',
    'UID:' + uid,
    // DTSTAMP is the one place UTC is CORRECT to use — it means "when was
    // this file generated", which is a real instant, not a wall-clock
    // appointment time. new Date().toISOString() -> Z format is right here.
    'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z',
    // (FIX) TZID-anchored local time, no UTC conversion anywhere in this path.
    'DTSTART;TZID=Central Standard Time:' + icsLocalString(wcStart),
    'DTEND;TZID=Central Standard Time:' + icsLocalString(wcEnd),
    'SUMMARY:' + escapeICSText(dealerName + ' Appointment - ' + customerName),
    // (FIX) escaped — dealer addresses all contain commas.
    'LOCATION:' + escapeICSText(address),
    'DESCRIPTION:' + escapeICSText(descRaw),
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    'DESCRIPTION:' + escapeICSText('Reminder: ' + dealerName + ' appointment' + vehicleSuffix + ' tomorrow'),
    'END:VALARM',
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    'DESCRIPTION:' + escapeICSText('Reminder: ' + dealerName + ' appointment' + vehicleSuffix + ' in 1 hour'),
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function utf8ToBase64(str) {
  var bytes = new TextEncoder().encode(str);
  var binary = '';
  for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function buildEmailHtml({ customerName, dealerName, address, mapsUrl, vehicleText, wcStart, dealerId }) {
  var when = formatWallClockHuman(wcStart);
  var logo = LOGO_ASSETS[String(dealerId)];
  var logoImg = logo
    ? '<img src="cid:' + logo.contentId + '" alt="' + dealerName + '" style="max-width:220px;height:auto;display:block;margin:0 auto 24px;">'
    : '';
  var vehicleRow = vehicleText
    ? '<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Vehicle</td></tr>'
      + '<tr><td style="padding:0 0 16px;color:#111827;font-size:16px;font-weight:600;">' + escapeHtml(vehicleText) + '</td></tr>'
    : '';

  return [
    '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Arial,sans-serif;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">',
    '<tr><td align="center">',
    '<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">',
    '<tr><td style="padding:32px 32px 8px;text-align:center;">',
    logoImg,
    '<h1 style="margin:0 0 4px;font-size:20px;color:#111827;">Your appointment is confirmed</h1>',
    '<p style="margin:0 0 24px;color:#6b7280;font-size:15px;">' + escapeHtml(customerName) + ', we\'ll see you soon.</p>',
    '</td></tr>',
    '<tr><td style="padding:0 32px;">',
    '<table role="presentation" width="100%" style="background:#f9fafb;border-radius:8px;padding:20px;">',
    '<tr><td style="padding:0 4px;">',
    '<table role="presentation" width="100%">',
    '<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">When</td></tr>',
    '<tr><td style="padding:0 0 16px;color:#111827;font-size:18px;font-weight:700;">' + escapeHtml(when.full) + '</td></tr>',
    '<tr><td style="padding:4px 0;color:#6b7280;font-size:14px;">Where</td></tr>',
    '<tr><td style="padding:0 0 16px;color:#111827;font-size:16px;font-weight:600;">' + escapeHtml(dealerName) + '<br><span style="font-weight:400;color:#374151;font-size:14px;">' + escapeHtml(address) + '</span></td></tr>',
    vehicleRow,
    '</table>',
    '</td></tr>',
    '</table>',
    '</td></tr>',
    '<tr><td style="padding:24px 32px 32px;text-align:center;">',
    '<a href="' + mapsUrl + '" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:600;">Get Directions</a>',
    '</td></tr>',
    '<tr><td style="padding:0 32px 28px;text-align:center;">',
    '<p style="margin:0;color:#9ca3af;font-size:12px;">A calendar invite is attached to this email. Reply to this email if you need to reschedule.</p>',
    '</td></tr>',
    '</table>',
    '</td></tr>',
    '</table>',
    '</body></html>',
  ].join('');
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function sendAppointmentInvite(env, { customerName, customerEmail, dealerName, dealerId, address, mapsUrl, vehicleText, wcStart, icsContent }) {
  if (!env.RESEND_API_KEY) {
    console.warn('[INVITE] RESEND_API_KEY not bound — cannot send');
    return false;
  }

  var icsBase64 = utf8ToBase64(icsContent);
  var attachments = [
    { filename: 'appointment.ics', content: icsBase64 },
  ];
  var logo = LOGO_ASSETS[String(dealerId)];
  if (logo) {
    attachments.push({
      filename: logo.filename,
      content: logo.base64,
      content_id: logo.contentId,
    });
  }

  var html = buildEmailHtml({ customerName, dealerName, address, mapsUrl, vehicleText, wcStart, dealerId });
  var when = formatWallClockHuman(wcStart);

  let res;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.RESEND_API_KEY.trim()}`,
      },
      body: JSON.stringify({
        from: `${dealerName} <appointments@notify.mycommunityauto.com>`,
        to: [customerEmail],
        subject: `Your appointment at ${dealerName} — ${when.dateStr} at ${when.timeStr}`,
        text: `Your appointment at ${dealerName} is confirmed for ${when.full}.\nLocation: ${address}\nDirections: ${mapsUrl}\nSee attached calendar invite.`,
        html: html,
        attachments: attachments,
      }),
    });
  } catch (err) {
    console.warn(`[INVITE] Resend fetch threw: ${err && err.message}`);
    return false;
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.warn(`[INVITE] Resend send failed: ${res.status} ${errBody.slice(0, 200)}`);
  }

  return res.ok;
}

function aggregate(entries) {
  // (v1.11/v7.52) RETROACTIVE NORMALISATION. Extension v9.7.541 is what labels a session
// that never rendered a draft as 'incomplete'; rows written by v9.7.540 -- which is what ran on
// 8/11 -- recorded the same thing as 'abandoned'. Re-rendering an old day cannot change what the
// extension already wrote, so those rows would keep inflating the used-rate denominator forever.
// They are identifiable without guessing: _lpFeedbackCaptureMeta runs only after a generation
// succeeds, so an EMPTY meta is positive evidence no draft was ever produced. Normalise here and
// every historical day re-renders correctly. Rows from v9.7.541 onward already carry the right
// rating and pass through untouched.
  entries = (entries || []).map(e => (e && e.rating === 'abandoned' && !(e.meta && Object.keys(e.meta).length))
    ? Object.assign({}, e, { rating: 'incomplete' })
    : e);
  const total = entries.length;
  // (v7.49) 'abandoned' is the extension v9.7.540 rating for a generate the agent never used.
  // Without it here the row lands in `total` but in no bucket, so every rate silently deflates.
  const ratings = { up: 0, weak_up: 0, neutral: 0, down: 0, abandoned: 0, incomplete: 0 };
  // (v7.49) EXPLICIT vs IMPLICIT SPLIT. `rating` alone cannot carry this: the extension's
  // _lpFeedbackDeriveRating returns 'up' BOTH for an explicit thumbs-up and for a copied-as-is
  // draft, distinguished only by `signal`. So ratings.up has always been implicit_copy +
  // explicit_up, and any tile labelled "EXPLICIT" that renders it is overstating by the entire
  // implicit-copy count. Reproduced against real production days: 8/8 implicit_copy=244 +
  // explicit_up=5 -> ratings.up=249 (tile showed 249); 8/10 implicit_copy=445 + explicit_up=63
  // -> ratings.up=508 (tile showed 508). Emit the split so a renderer never has to infer it.
  // The old inference (signals.explicit - ratings.down) is ALSO about to break: it holds only
  // while every 'down' is explicit, and extension v9.7.540 makes implicit rejections reachable
  // for the first time, so that subtraction will start undercounting explicit ups.
  let explicitUp = 0, explicitDown = 0, implicitUp = 0, implicitDown = 0; // (v7.53) implicitDown added
  const signals = { explicit: 0, implicit_copy: 0, implicit_chip_copy: 0, implicit_regen_copy: 0, implicit_regen_no_copy: 0, implicit_chip_no_copy: 0, no_interaction: 0 };
  const byStore = {}, byPersona = {}, byLeadSource = {}, byFlag = {};
  let totalRegens = 0, totalChips = 0;

  for (const e of entries) {
    if (ratings[e.rating] !== undefined) ratings[e.rating]++;
    if (signals[e.signal]  !== undefined) signals[e.signal]++;
    if (e.signal === 'explicit') {
      if (e.rating === 'down') explicitDown++;
      else if (e.rating === 'up' || e.rating === 'weak_up') explicitUp++;
    } else if (e.rating === 'up') implicitUp++;
    else if (e.rating === 'down') implicitDown++;   // (v7.53) regenerated or chipped, then unsent
    totalRegens += e.regenCount || 0;
    totalChips  += e.chipCount  || 0;

    const store = e.meta?.store || 'unknown';
    if (!byStore[store]) byStore[store] = _newBucket();
    _tallyBucket(byStore[store], e.rating, e.signal);

    const persona = e.meta?.persona || 'unknown';
    if (!byPersona[persona]) byPersona[persona] = _newBucket();
    _tallyBucket(byPersona[persona], e.rating, e.signal);

    const ls = e.meta?.leadSource || 'unknown';
    if (!byLeadSource[ls]) byLeadSource[ls] = _newBucket();
    _tallyBucket(byLeadSource[ls], e.rating, e.signal);

    (e.meta?.flags || []).forEach(f => {
      if (!byFlag[f]) byFlag[f] = _newBucket();
      _tallyBucket(byFlag[f], e.rating, e.signal);
    });
  }

  const shipped  = ratings.up + ratings.weak_up + ratings.neutral;
  const firstTry = ratings.up + ratings.weak_up;
  const posRate      = total ? Math.round(100 * shipped  / total) : 0;
  const firstTryRate = total ? Math.round(100 * firstTry / total) : 0;
  const downRate     = total ? Math.round(100 * ratings.down / total) : 0;

  // (v7.49) `engaged` excludes abandoned rows. shippedRate/posRate/firstTryRate keep their
  // existing all-rows denominator -- that is the honest product metric now that the denominator
  // finally contains the drafts nobody used -- while engaged*Rate reproduces the pre-v9.7.540
  // basis so an existing chart series does not appear to collapse on the day the fleet updates.
  // (v7.50) 'incomplete' = extension v9.7.541, a session that never rendered a draft (failed or
  // aborted generate). Not a rejection, so it belongs in no quality denominator.
  const produced            = total - ratings.incomplete;
  const engaged             = produced - ratings.abandoned;
  const engagedShippedRate  = engaged ? Math.round(100 * shipped  / engaged) : 0;
  const engagedFirstTryRate = engaged ? Math.round(100 * firstTry / engaged) : 0;

  return {
    total, posRate, shippedRate: posRate, firstTryRate, downRate,
    shipped, firstTry,
    // (v7.49) Use these for any tile labelled "explicit". explicitUp/explicitDown are the true
    // thumb counts; implicitUp is the copied-as-is count that was being folded in with them.
    // (v7.53) implicitDown completes the set: explicitDown + implicitDown === ratings.down, so a
    // tile can show the honest number AND disclose what the other bucket contains without doing
    // arithmetic of its own. A renderer showing ratings.down under an "EXPLICIT" label is the
    // defect this pair exists to prevent.
    explicitUp, explicitDown, implicitUp, implicitDown,
    engaged, produced, engagedShippedRate, engagedFirstTryRate,
    usedRate: produced ? Math.round(100 * shipped / produced) : 0,
    ratings, signals,
    byStore:      _decorateBuckets(byStore),
    byPersona:    _decorateBuckets(byPersona),
    byLeadSource: _decorateBuckets(byLeadSource),
    byFlag:       _decorateBuckets(byFlag),
    avgRegens: total ? +(totalRegens/total).toFixed(2) : 0,
    avgChips:  total ? +(totalChips/total).toFixed(2)  : 0,
  };
}

async function validateLicenseRecord(licenseKey, env) {
  if (!licenseKey) return { valid: false, error: 'No license key' };

  // (v7.37 fix) Normalize before any comparison/lookup. Confirmed real gap: provisioned keys
  // are always generated uppercase (the charset in /provision-license is A-Z/2-9 only), but
  // nothing anywhere -- client login form, this function, the KV .get() itself -- ever
  // normalized case or stray whitespace on the way in. A KV lookup is an exact string match,
  // so an agent who typed a freshly-issued key in lowercase (nothing in the UI told them it
  // was case-sensitive) got a silent, correct-looking "License not found" rejection on a key
  // that was, in fact, valid. Trim + uppercase once here so every caller (login, provisioning
  // auth check, invite/generate/feedback enforcement) benefits without duplicating the fix.
  const key = String(licenseKey).trim().toUpperCase();

  if (env.DIRECTOR_KEYS) {
    const allowed = env.DIRECTOR_KEYS.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (allowed.includes(key)) {
      return {
        valid:  true,
        record: {
          persona:   'director',
          agentName: 'Director',
          dealer:    'Community Auto Group',
          stores:    [],
          active:    true,
        },
      };
    }
  }

  if (!env.LEADPRO_LICENSES) return { valid: false, error: 'KV not bound' };

  const raw = await env.LEADPRO_LICENSES.get(key);
  if (!raw) return { valid: false, error: 'License not found' };

  let record;
  try { record = JSON.parse(raw); }
  catch { return { valid: false, error: 'Corrupt license record' }; }

  if (record.active === false) return { valid: false, error: 'License inactive' };
  if (record.expiresAt && record.expiresAt < Date.now()) {
    return { valid: false, error: 'License expired' };
  }
  return { valid: true, record };
}

async function callOpenAI({ spec, messages, maxTokens, authHeader, timeoutMs, cacheKey, reasoningEffort, contract }) {
  const _contract = normalizeContract(contract);   // (v7.58) unknown/absent => strict draft path
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();

  // (v7.41) GPT-5.6 EXPLICIT PROMPT CACHE BREAKPOINT.
  // GPT-5.6 changed caching semantics: it caches at BREAKPOINTS and, unlike earlier models,
  // does NOT fall back to the longest matching unmarked prefix. The default implicit
  // breakpoint sits on the LATEST user message — which for us is the ~8-9k-token per-lead
  // prompt — so the whole [system+user] had to match byte-for-byte to hit. That exactly
  // explains the bimodal data the v7.39 instrumentation captured: 91-99% cached on an
  // immediate identical repeat of the same lead, a hard 0% on every distinct lead, never
  // partial. I previously attributed that gap to cache RETENTION; that was wrong — it was
  // the missing breakpoint. Worse, on 5.6 cache WRITES bill at 1.25x the uncached rate, so
  // the implicit breakpoint was likely writing a ~13k-token prefix on most requests that
  // could never be read again — a real cost regression introduced by the Luna switch, and
  // invisible because cache_write_tokens was never logged.
  // Fix: mark the end of the system message as an explicit breakpoint (the system prompt is
  // ~4,449 tokens, comfortably over the 1,024-token minimum) and set mode:'explicit' so the
  // implicit breakpoint is disabled and we stop paying to write the volatile suffix.
  // GATING: prompt_cache_options / prompt_cache_breakpoint are REJECTED WITH 400 by older
  // models. The existing spec.gpt5 flag is TRUE for gpt-5.4-nano as well, so it is the wrong
  // gate — using it would 400 the fallback tier during exactly the incidents that need it.
  // Hence a separate per-tier cacheBreakpoints flag, set only on Luna.
  let _msgs = messages;
  let _bpApplied = false;
  // (v7.44) STATIC-HEAD BREAKPOINT — pairs with extension v9.7.521/518.
  // v7.41/42 placed the breakpoint at the END of the system message. Correct, but it cached a
  // SEPARATE prefix per persona/agent/store combination: live data showed sysChars varying
  // 19,629-22,010 across requests, only 35% of requests hitting warm (43 of 123), and ~80 cache
  // writes bought for ~43 reads — barely net-positive at GPT-5.6's 1.25x write rate.
  // The static head of buildSystemPrompt (~4,449 tokens) is byte-identical for every persona,
  // agent, store and day. That boundary existed in the extension only as a JS SOURCE COMMENT,
  // never delivered, so the Worker had nothing to split on. The extension now emits a sentinel
  // line there; splitting on it means EVERY request shares ONE cached prefix.
  const _LP_SENTINEL = '\u27E6LP_CACHE_BREAKPOINT\u27E7';
  // Strip the sentinel on tiers that do NOT take the splitting path. The extension emits it
  // unconditionally, so without this it would ride into the system prompt as literal junk on a
  // FALLBACK/EMERGENCY call — precisely the degraded path where the prompt most needs to be
  // clean. Older models also reject the breakpoint params, so they just need the marker gone.
  if (!spec.cacheBreakpoints && Array.isArray(messages) && messages[0] && messages[0].role === 'system'
      && typeof messages[0].content === 'string' && messages[0].content.indexOf(_LP_SENTINEL) > -1) {
    _msgs = [{ role: 'system', content: messages[0].content.split(_LP_SENTINEL).join('') }]
              .concat(messages.slice(1));
  }
  if (spec.cacheBreakpoints && Array.isArray(messages) && messages[0] && messages[0].role === 'system'
      && typeof messages[0].content === 'string') {
    const _sysRaw = messages[0].content;
    const _blocks = [];
    const _sIdx = _sysRaw.indexOf(_LP_SENTINEL);
    if (_sIdx > -1) {
      // Sentinel present: split at the static/variable boundary. The variable tail still carries
      // the regen constraint when present — it sits after the boundary either way, so the base
      // static head (and therefore the cached prefix) is identical for normal and regen calls.
      const _head = _sysRaw.slice(0, _sIdx);
      const _tail = _sysRaw.slice(_sIdx + _LP_SENTINEL.length);
      // Guard the 1,024-token minimum (~4 chars/token): below it the prefix is not cacheable at
      // all, so fall back to one block rather than emit a breakpoint the service will ignore.
      if (_head.length >= 4096) {
        _blocks.push({ type: 'text', text: _head, prompt_cache_breakpoint: { mode: 'explicit' } });
        _blocks.push({ type: 'text', text: _tail });
      } else {
        _blocks.push({ type: 'text', text: _head + _tail, prompt_cache_breakpoint: { mode: 'explicit' } });
      }
    }
    // No sentinel (older extension build): fall back to the v7.41/42 end-of-system behaviour, so
    // Worker and extension can deploy in either order without a broken window.
    else if (REGEN_CONSTRAINT_TEXT && _sysRaw.endsWith(REGEN_CONSTRAINT_TEXT)) {
      _blocks.push({ type: 'text', text: _sysRaw.slice(0, _sysRaw.length - REGEN_CONSTRAINT_TEXT.length),
                     prompt_cache_breakpoint: { mode: 'explicit' } });
      _blocks.push({ type: 'text', text: REGEN_CONSTRAINT_TEXT });
    } else {
      _blocks.push({ type: 'text', text: _sysRaw, prompt_cache_breakpoint: { mode: 'explicit' } });
    }
    _msgs = [{ role: 'system', content: _blocks }].concat(messages.slice(1));
    _bpApplied = true;
  }

  const payload = {
    model:                 spec.model,
    messages:              _msgs,
    max_completion_tokens: maxTokens,
    response_format:       { type: 'json_object' },
  };
  // (v7.42) Send mode:'explicit' ONLY when a breakpoint was actually attached. Per the docs,
  // "if the conversation contains no explicit breakpoints, the request does not use prompt
  // caching or incur cache-write charges" — so v7.41 set these two independently, and any
  // future change to the message shape (system not first, or content already an array) would
  // have silently turned caching OFF ENTIRELY for the primary tier. cached=0/written=0 looks
  // identical to a cold start, so nothing would have surfaced it. Fail loudly instead: keep
  // the default implicit behavior (still cached, just less efficiently) and log.
  if (_bpApplied) {
    payload.prompt_cache_options = { mode: 'explicit' };
  } else if (spec.cacheBreakpoints) {
    console.warn(`[CACHE] breakpoint NOT applied for ${spec.model} — unexpected message shape ` +
      `(role0=${messages && messages[0] ? messages[0].role : 'none'}, ` +
      `contentType=${messages && messages[0] ? typeof messages[0].content : 'none'}). ` +
      `Falling back to implicit caching; expect low cached_tokens and high cache_write_tokens.`);
  }


  if (spec.temperature !== null) payload.temperature = spec.temperature;

  if (spec.gpt5) {
    // (v7.61) Resolved against THIS tier, and any substitution is logged rather than silent.
    const _eff = resolveEffort(spec.model, reasoningEffort, spec.tier);
    if (_eff.effort) payload.reasoning_effort = _eff.effort;
    if (_eff.note) {
      console.log(`[EFFORT] ${spec.tier} ${spec.model}: requested "${reasoningEffort || '(none)'}" → `
        + `${_eff.effort || 'omitted'} — ${_eff.note}`);
    }
    payload.verbosity        = VERBOSITY;
  }

  if (cacheKey) {
    // prompt_cache_key is REQUIRED on 5.6+ for the reliable prefix matching, and is a useful
    // routing hint on every tier — always send it.
    payload.prompt_cache_key = cacheKey;
    // (v7.42) prompt_cache_retention is DEPRECATED on GPT-5.6 and later families, where
    // retention is governed by prompt_cache_options.ttl instead (default — and currently the
    // only supported value — '30m'). This is the SAME gating trap v7.41 documented, in the
    // opposite direction: v7.41 correctly kept 5.6-only fields away from older models, but
    // left this older-model field going unconditionally to Luna. At best it is ignored; if it
    // is rejected rather than ignored, the PRIMARY tier 400s on every single request.
    // Consequence worth knowing: primary-tier retention drops from 24h to "at least 30m", so
    // a cold cachedOfSys=0% after a quiet period is now expected, not a defect.
    // (v7.61) prompt_cache_retention is REPLACED by prompt_cache_options.ttl. v7.42 correctly kept
    // the deprecated field away from Luna, which left the PRIMARY tier with no retention hint at
    // all while the older tiers still got a deprecated one. Both now get the current field.
    // Luna already has prompt_cache_options set by the breakpoint path above, so the ttl is merged
    // into it rather than overwriting mode:'explicit'.
    // (v7.64) THE LIVE INCIDENT OF 8/23, AND IT WAS CAUSED BY THE LINE THAT USED TO BE HERE.
    // v7.61 set `payload.prompt_cache_options = { ttl: CACHE_TTL }` in this else-branch — which is
    // reached on exactly the tiers where cacheBreakpoints is FALSE, i.e. the two older models. The
    // gating comment ~90 lines above this one already said, in v7.41's own words, that
    // prompt_cache_options is "REJECTED WITH 400 by older models" and that is why the separate
    // cacheBreakpoints flag exists. The else-branch handed the field to precisely those models.
    //
    // WHAT IT COST: every request to the fallback AND emergency tiers returned
    //   status=400 "prompt_cache_options is not supported on this model"
    // so from the moment v7.61 deployed, LP HAD NO WORKING RECOVERY LADDER AT ALL. It was
    // invisible because the primary tier answers almost every request — the breakage only shows
    // when the primary fails, which is the one moment the ladder exists for. On 8/23 a regen at
    // reasoningEffort:'high' timed the primary out at 12000ms, both recovery tiers 400'd in under
    // 250ms each, and the agent got SAFE_FALLBACK after 12.5s. The regen escalation did not cause
    // this; it was the first thing that reliably failed the primary and so EXPOSED it.
    //
    // THE RULE, restored: prompt_cache_options belongs to the 5.6 family and is gated on
    // spec.cacheBreakpoints, the same flag that gates the breakpoint itself. Older tiers get the
    // field they actually accept — prompt_cache_retention — exactly as v7.42 had it.
    if (spec.cacheBreakpoints) {
      payload.prompt_cache_options = Object.assign({}, payload.prompt_cache_options || {}, { ttl: CACHE_TTL });
    } else {
      payload.prompt_cache_retention = CACHE_RETENTION_LEGACY;
    }
  }

  try {
    const res = await fetch(OPENAI_ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': authHeader,
        'Accept':        'application/json',
      },
      body:   JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const status  = res.status;
      const errBody = await res.json().catch(() => null);
      const errMsg  = errBody?.error?.message || `HTTP ${status}`;
      const fatal   = status === 401 || status === 403 || status === 404;
      // (v7.39) status surfaced so the failure log can distinguish a 429 rate-limit or a
      // provider 5xx from a plain timeout — today's all-three-tiers-failed-in-<250ms event
      // (2026-07-31 17:06 UTC) was undiagnosable because only tier+latency were recorded.
      return { ok: false, fatal, status, latency: Date.now() - t0, error: errMsg.slice(0, 140) };
    }

    const data         = await res.json();
    const choice       = data?.choices?.[0];
    const text         = choice?.message?.content || '';
    const openaiFin    = choice?.finish_reason || 'stop';
    const finishReason = FINISH_MAP[openaiFin] || 'STOP';

    // (v7.58) The 150-char floor is a DRAFT floor. It is right for a three-field draft and it is
    // wrong for every other shape — a correct 40-char fact answer is not an empty response.
    // Message prefix kept verbatim for the draft path so anything keyed on "Empty response"
    // still matches.
    if (_contract === RESPONSE_CONTRACT_DRAFT) {
      if (text.length < MIN_CONTENT_CHARS)
        return { ok: false, latency: Date.now() - t0, error: `Empty response (finish=${openaiFin})` };
    } else {
      const factFail = factContractFailure(text);
      if (factFail)
        return { ok: false, latency: Date.now() - t0, error: `Empty response (finish=${openaiFin}) [fact contract: ${factFail}]` };
    }

    if (finishReason === 'STOP' && !isLikelyJson(text))
      return { ok: false, latency: Date.now() - t0, error: 'Non-JSON content with STOP finish' };

    // (v7.39) TRUNCATION GUARD. isLikelyJson only inspects the FIRST character, so a response
    // cut off mid-object still starts with '{' and sailed through as ok:true — the malformed
    // JSON then failed to parse downstream instead of falling through to the next tier, which
    // is exactly the wrong place to discover it (the emergency tier has nothing behind it).
    // A truncated draft is unusable either way, so fail it here and let the cascade recover.
    // Verified parseable-ness rather than trusting finish_reason alone, since a model can also
    // return malformed JSON on a clean STOP.
    if (!isParseableJson(text)) {
      return {
        ok: false,
        latency: Date.now() - t0,
        error: `Unparseable JSON (finish=${openaiFin}${finishReason === 'MAX_TOKENS' ? ', truncated — token budget too low' : ''})`,
      };
    }

    // (v7.45) A field can be degenerate (e.g. "{") inside an otherwise well-formed envelope —
    // isParseableJson only verifies the envelope. Same treatment as the truncation guard
    // above: fail here so the existing cascade retries the next tier, and this tier's output
    // never reaches the edge cache.
    // (v7.47) Prefix kept verbatim — log parsing and alerting keyed on "Degenerate field
    // content" still matches — with the offending field and a hard-truncated sample appended.
    // (v7.58) hasDegenerateField judges sms/email/voicemail. A 'fact' response has none of those
    // fields, so on that contract it is not "clean" — it is INAPPLICABLE, and running it would be
    // asking a draft question about a non-draft. The fact floor above is that contract's guard.
    const degenerate = (_contract === RESPONSE_CONTRACT_DRAFT && isLikelyJson(text))
      ? hasDegenerateField(text) : null;
    if (degenerate) {
      return {
        ok: false,
        latency: Date.now() - t0,
        error: `Degenerate field content (finish=${openaiFin}) [${degenerate.field}: "${degenerate.sample}"]`,
      };
    }

    return {
      ok: true,
      text,
      finishReason,
      latency: Date.now() - t0,
      usage:   data.usage || null,
    };
  } catch (err) {
    const timedOut = err.name === 'AbortError';
    return {
      ok: false,
      latency: Date.now() - t0,
      error:   timedOut ? `Timeout ${timeoutMs}ms` : (err.message || 'fetch failed').slice(0, 140),
    };
  } finally {
    clearTimeout(timer);
  }
}

function wrapAsGemini({ text, finishReason, latency, usage }, model) {
  return {
    candidates: [{
      content:      { parts: [{ text }], role: 'model' },
      finishReason,
    }],
    usageMetadata: {
      promptTokenCount:     usage?.prompt_tokens     || 0,
      candidatesTokenCount: usage?.completion_tokens || 0,
      totalTokenCount:      usage?.total_tokens      || 0,
    },
    _model:   model,
    _latency: latency,
  };
}

function safeFallback(requestId, startTime, diag = {}) {
  const totalTime = Date.now() - startTime;
  const { lastError, lastTier, lastModel } = diag;
  const contract  = normalizeContract(diag.contract);
  const diagSuffix = lastError
    ? ` lastTier=${lastTier} lastModel=${lastModel} lastError="${lastError}"`
    : '';

  // (v7.58) SAFE_FALLBACK_TEXT IS A DRAFT ARTEFACT. It is a three-field customer message with
  // unfilled [Agent]/[Store] placeholders, and it exists so a draft request never returns
  // nothing. Handing it to a caller that asked a one-fact question is not a graceful
  // degradation — it is an answer to a different question, in a shape the caller will parse.
  // That is exactly what happened on 8/21: the comprehension observer parsed this JSON, found no
  // "kind" key, read kind:'none' off it, and persisted 17 fabricated agreements. A non-draft
  // contract gets an explicit failure with NO candidates array, so there is nothing to misread.
  if (contract !== RESPONSE_CONTRACT_DRAFT) {
    console.warn(`[${requestId}] TIERS EXHAUSTED (contract=${contract}, no safe fallback served)${diagSuffix}`);
    return corsResponse(JSON.stringify({
      error:      'All model tiers failed',
      _fallback:  true,
      _contract:  contract,
      _fallbackMs: totalTime,
      _requestId: requestId,
      _lastError: lastError || null,
      _lastTier:  lastTier  || null,
      _lastModel: lastModel || null,
    }), 200, { 'X-Request-ID': requestId, 'X-Fallback': 'none-served' });
  }

  console.warn(`[${requestId}] SAFE_FALLBACK after ${totalTime}ms${diagSuffix}`);

  return corsResponse(JSON.stringify({
    candidates: [{
      content:      { parts: [{ text: SAFE_FALLBACK_TEXT }], role: 'model' },
      finishReason: 'STOP',
      _fallback:    true,
      _fallbackMs:  totalTime,
      _requestId:   requestId,
      _lastError:   lastError || null,
      _lastTier:    lastTier  || null,
      _lastModel:   lastModel || null,
    }],
    usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
  }), 200, { 'X-Request-ID': requestId, 'X-Fallback': 'safe' });
}

function corsResponse(body, status = 200, extra) {
  return new Response(body, {
    status,
    headers: extra ? { ...CORS_HEADERS, ...extra } : CORS_HEADERS,
  });
}

function centralOffsetMinutes(date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  const hh = p.hour === '24' ? '00' : p.hour;
  const asWallUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +hh, +p.minute, +p.second);
  return Math.round((asWallUTC - date.getTime()) / 60000);
}

function centralTodayStr() {
  const now = new Date();
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return dtf.format(now);
}

function centralDayUtcWindow(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const offMin = centralOffsetMinutes(probe);
  const startMs = Date.UTC(y, m - 1, d, 0, 0, 0) - offMin * 60000;
  const endMs   = startMs + 24 * 60 * 60 * 1000;
  const startPfx = new Date(startMs).toISOString().slice(0, 10);
  const endPfx   = new Date(endMs - 1).toISOString().slice(0, 10);
  const utcPrefixes = startPfx === endPfx ? [startPfx] : [startPfx, endPfx];
  return { startMs, endMs, utcPrefixes };
}

const VALUEFACT_DEALERS    = ['6189', '6190', '6191', '24399', '21135'];
const VALUEFACT_CATEGORIES = ['incentive', 'price_reduced', 'new_arrival'];
const VALUEFACT_MAX_PER_STORE = 6;
const VALUEFACT_MAX_LINE      = 120;

function parseCsvRows(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch === '\r') { /* skip CR */ }
      else field += ch;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function syncValueFacts(env) {
  const csvUrl = env.VALUEFACT_CSV_URL;
  if (!csvUrl) { console.log('[valuefact] no VALUEFACT_CSV_URL set — skip'); return; }
  if (!env.LEADPRO_REGISTRY) { console.log('[valuefact] LEADPRO_REGISTRY not bound — skip'); return; }

  let csv;
  try {
    const r = await fetch(csvUrl, { cf: { cacheTtl: 0 } });
    if (!r.ok) { console.log('[valuefact] CSV fetch ' + r.status + ' — keep last blobs'); return; }
    csv = await r.text();
  } catch (e) { console.log('[valuefact] CSV fetch error ' + e + ' — keep last blobs'); return; }

  const rows = parseCsvRows(csv);
  if (rows.length < 2) { console.log('[valuefact] empty/headers-only CSV — skip'); return; }

  const header = rows[0].map(h => h.trim().toLowerCase());
  const ci = {
    dealer:   header.indexOf('dealer_id'),
    category: header.indexOf('category'),
    line:     header.indexOf('line'),
    expires:  header.indexOf('expires'),
  };
  if (ci.dealer < 0 || ci.category < 0 || ci.line < 0 || ci.expires < 0) {
    console.log('[valuefact] header missing required columns — skip'); return;
  }

  const today = centralTodayStr();
  const stores = {};
  let kept = 0, skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const dealer = (r[ci.dealer] || '').trim();
    const cat    = (r[ci.category] || '').trim().toLowerCase();
    let   line   = (r[ci.line] || '').replace(/[\r\n]+/g, ' ').trim();
    const exp    = (r[ci.expires] || '').trim();
    if (!VALUEFACT_DEALERS.includes(dealer))     { skipped++; continue; }
    if (!VALUEFACT_CATEGORIES.includes(cat))     { skipped++; continue; }
    if (!line)                                   { skipped++; continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exp) || exp < today) { skipped++; continue; }
    if (line.length > VALUEFACT_MAX_LINE) line = line.slice(0, VALUEFACT_MAX_LINE).trim();
    if (!stores[dealer]) stores[dealer] = { incentive: [], price_reduced: [], new_arrival: [], expires: exp, _count: 0 };
    if (stores[dealer]._count >= VALUEFACT_MAX_PER_STORE) { skipped++; continue; }
    stores[dealer][cat].push(line);
    stores[dealer]._count++;
    if (exp > stores[dealer].expires) stores[dealer].expires = exp;
    kept++;
  }

  const writes = [];
  for (const dealer of Object.keys(stores)) {
    const s = stores[dealer];
    delete s._count;
    s.updated = today;
    try {
      const existingRaw = await env.LEADPRO_REGISTRY.get('valuefact:' + dealer);
      if (existingRaw) {
        const existing = JSON.parse(existingRaw);
        if (Array.isArray(existing.incentives) && existing.generated >= today) {
          console.log('[valuefact] skip ' + dealer + ' — same-day Data Tool upload present (generated ' + existing.generated + ')');
          continue;
        }
      }
    } catch (e) { /* unreadable existing blob — cron write proceeds */ }
    writes.push(env.LEADPRO_REGISTRY.put('valuefact:' + dealer, JSON.stringify(s)));
  }
  await Promise.all(writes);

  const noData = VALUEFACT_DEALERS.filter(d => !stores[d]);
  console.log('[valuefact] synced ' + Object.keys(stores).length + ' stores, ' + kept +
    ' lines, ' + skipped + ' skipped' + (noData.length ? ' | NO DATA THIS SYNC: ' + noData.join(',') : ''));
}

function clampInt(v, lo, hi, def) {
  const n = Number.isFinite(+v) ? Math.floor(+v) : def;
  return Math.max(lo, Math.min(hi, n));
}

function isLikelyJson(s) {
  const first = s.trimStart()[0];
  return first === '{' || first === '[';
}

// (v7.45) Field-level content check — see version header for the failure this catches
// (Adhhd Adjjdjd, 8/4: email field = "Subject: ...\n\n{" with finish=STOP). Distinct from
// isParseableJson: that verifies the ENVELOPE parses; this verifies a given field's VALUE
// inside an already-valid envelope isn't degenerate.
// (v7.46) NEAR-MISS on the v7.45 length threshold, live incident: Daniel/Samantha Gonzalez
// (Community Kia Baytown, 8/5) — email field = 'Subject: A quick note about your
// inquiry\n\n{"subject":"White Telluride Hybrid search"}'. Body is 43 chars, the "aborted
// nested-JSON, length<40" rule's whole reason to exist -- and it slipped through by 3
// characters because that rule was a length HEURISTIC standing in for the real question,
// which is structural: is this JSON, or is it prose? A body that starts with {/[ and is
// short was always a proxy for "the model tried to nest a JSON object here instead of
// writing prose" -- checking whether the ENTIRE body successfully parses as JSON tests that
// directly, with no length threshold to slip past. Kept the original bare-brace/punctuation-
// only check alongside it (still needed: JSON.parse('{') itself throws, so the new check
// alone would NOT have caught the original v7.45 case -- the two conditions cover different
// halves of the same failure family, short-aborted vs. complete-but-still-JSON).
// (v7.47) The email "Subject: ...\n\n" strip, factored out of isDegenerateFieldValue so the
// diagnostic sample in the failure line is taken from the SAME body the guard judged. Sampling
// the raw value instead would spend the whole 40-char budget on the subject line and render
// the v7.45 bare-brace and v7.46 complete-JSON cases indistinguishable in the log.
function degenerateFieldBody(raw, isEmail) {
  if (typeof raw !== 'string') return '';
  if (!isEmail) return raw;
  const m = raw.match(/^Subject:.*?\n\n([\s\S]*)$/i);
  return m ? m[1] : raw;
}

// (v7.47) Whitespace-collapsed, HARD-truncated sample of a rejected field value for the
// failure line. Truncation is not cosmetic: these logs are retained and reviewed, and a full
// draft body is customer content that does not belong in a Worker log. 40 chars distinguishes
// "" from "{" from '{"subject":"..."' — which is the entire diagnostic job here.
function degenerateFieldSample(raw, isEmail) {
  const flat = degenerateFieldBody(raw, isEmail).replace(/\s+/g, ' ').trim();
  return flat.length > DEGENERATE_SAMPLE_CHARS
    ? flat.slice(0, DEGENERATE_SAMPLE_CHARS) + '…'
    : flat;
}

function isDegenerateFieldValue(raw, isEmail) {
  if (typeof raw !== 'string') return true;

  const body = degenerateFieldBody(raw, isEmail);

  const trimmed = body.trim();
  if (trimmed.length === 0) return true;

  // Body is ONLY braces/brackets/quotes/colons/commas/whitespace — the exact "{" shape.
  if (/^[{}\[\]"'\s:,]+$/.test(trimmed)) return true;

  // Starts with { or [ and is short — an aborted nested-JSON attempt, not real prose.
  if (/^[{\[]/.test(trimmed) && trimmed.length < 40) return true;

  // The whole body IS valid, complete JSON — real prose email/sms bodies never are, at any
  // length, so this needs no size threshold. Catches the "{"subject":"..."}" shape whole.
  if (/^[{\[]/.test(trimmed)) {
    try { JSON.parse(trimmed); return true; } catch (e) { /* not JSON — fine, real prose can start with a brace-like char in rare cases */ }
  }

  const floor = isEmail ? MIN_FIELD_CHARS_EMAIL : MIN_FIELD_CHARS_SMS;
  if (trimmed.length < floor) return true;


  return false;
}

// Parses the (already envelope-valid) JSON and checks sms/email — and voicemail when the
// scenario includes it — for the degenerate shape above. Never throws; a parse failure here
// just means isParseableJson will catch it on its own pass, so this returns null (not
// degenerate) rather than duplicating that error.
// (v7.47) Returns null when clean, or { field, sample } naming the offending field, so the
// failure line can say WHICH field and WHAT it contained. Truthy/falsy either way, so the
// call site's condition is unchanged in shape.
// (v7.47) EMPTY IS NOT DEGENERATE. v7.45 exempted an empty voicemail but not an empty sms or
// email, and isDegenerateFieldValue treats empty as degenerate — so an SMS-opt-out lead, a DNE
// lead, or a lead with no email on file rejected the whole response at every tier, every time.
// All three fields are now judged only when they have content. The all-empty case below is the
// reason this is safe to do per-field.
function hasDegenerateField(text) {
  let parsed;
  try {
    let t = text.trim();
    if (t.startsWith('```')) t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(t);
  } catch { return null; }

  if (!parsed || typeof parsed !== 'object') return null;

  const fields = [
    ['sms',       parsed.sms,       false],
    ['email',     parsed.email,     true ],
    ['voicemail', parsed.voicemail, false],
  ];

  const emptyNames = [];
  let present = 0;

  for (const [name, raw, isEmail] of fields) {
    if (typeof raw !== 'string') continue;
    present++;
    if (raw.trim().length === 0) { emptyNames.push(name); continue; }
    if (isDegenerateFieldValue(raw, isEmail))
      return { field: name, sample: degenerateFieldSample(raw, isEmail) };
  }

  // (v7.47) W2 (v7.30) all-fields-empty reasoning-burn shape. Exempting empty fields
  // INDIVIDUALLY must not add up to accepting a wholly empty response. MIN_CONTENT_CHARS (150)
  // catches the canonical 36-char version upstream and fires first, but it is a total-LENGTH
  // check — an all-empty response padded past 150 by any other key slips it. Verified: that
  // padded shape was rejected before this version and stays rejected because of this check.
  if (present > 0 && emptyNames.length === present)
    return { field: 'all-empty', sample: emptyNames.join(',') };

  return null;
}

// (v7.39) Full parse check, used to reject truncated/malformed drafts at the tier that
// produced them rather than letting them fail downstream. Tolerates ```json fences, which
// models occasionally emit around an otherwise-valid object.
function isParseableJson(s) {
  if (!s || typeof s !== 'string') return false;
  let t = s.trim();
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (!isLikelyJson(t)) return false;
  try { JSON.parse(t); return true; } catch { return false; }
}

async function edgeCacheKey(systemText, userText) {
  const today = centralTodayStr();
  const data = TEXT_ENCODER.encode(today + '\n' + systemText + '\n---SEP---\n' + userText);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return new Request(`https://edge-cache.leadpro.internal/key/${hashHex}`);
}

function promptCacheKey(systemPrompt) {
  if (!systemPrompt || typeof systemPrompt !== 'string') {
    return `${CACHE_KEY_PREFIX}_default`;
  }
  // (v7.39 REVERTED — see below) This intentionally hashes only the FIRST 200 CHARS.
  // I briefly changed it to hash the full system prompt on the theory that distinct personas
  // deserved distinct keys, and "verified" it by showing three personas collapsed onto one
  // identical key under the old code. That collapse is the DESIGN, not a defect, and the
  // change was a regression — caught before deploy by measuring the actual prompt layout.
  // prompt_cache_key is a ROUTING hint: it steers requests to the same backend so a shared
  // prefix stays warm there. What all requests share is buildSystemPrompt's ~4,449-token
  // static head, which is byte-identical for every persona, agent, store and day (the
  // extension marks the divergence point explicitly: "VARIABLE SUFFIX (changes per
  // persona/agent/store — cache boundary here)"). Hashing only the first 200 chars lands
  // wholly inside that static head, so EVERY request produces the same key and routes
  // together — exactly what you want for a universally-shared prefix. Hashing the full
  // prompt instead makes the key vary by persona/agent/store, scattering requests across
  // backends and making the shared head COLD more often. Coarse is correct here.
  let hash = 5381;
  const sample = systemPrompt.slice(0, 200);
  for (let i = 0; i < sample.length; i++) {
    hash = ((hash << 5) + hash + sample.charCodeAt(i)) | 0;
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return `${CACHE_KEY_PREFIX}_${hex}`;
}

function logCacheHit(requestId, label, usage, systemText, userText, cacheKey) {
  if (!usage || typeof usage !== 'object') return;
  const total  = usage.prompt_tokens || 0;
  const cached = usage.prompt_tokens_details?.cached_tokens || 0;
  // (v7.41) cache_write_tokens bills at 1.25x uncached on GPT-5.6+. Logged so writes can be
  // weighed against subsequent reads — a high write count with a low read count means the
  // breakpoint is in the wrong place and we are paying a premium for nothing.
  const written = usage.prompt_tokens_details?.cache_write_tokens || 0;
  if (total <= 0) return;
  const pct = ((cached / total) * 100).toFixed(1);
  // (v7.39) SPLIT INSTRUMENTATION. The bare cached/total line could not answer the question
  // that actually matters: is the shared prefix being cached and simply not RETAINED, or is
  // the cacheable region smaller than believed? Both look like a low percentage. The system
  // prompt's static head was measured at ~4,449 tokens by reading the extension source, which
  // predicts a per-request ceiling of sysTokens/total (~34% on a typical lead) and predicts
  // that on a warm hit `cached` should land at or just under sysTokEst. Logging the split
  // turns both into observations instead of inferences:
  //   ceiling%    — the maximum this request could ever cache, given its own system/user ratio
  //   cachedOfSys — what fraction of the system prompt actually came back cached. ~100% means
  //                 the prefix works and any low overall % is just the user prompt dominating
  //                 (expected, not fixable). Persistently ~0% with a stable cacheKey means a
  //                 RETENTION problem (TTL/backend affinity), which is a different fix.
  //   cacheKey    — the routing hint actually used, so misses can be correlated to whether
  //                 requests are landing on the same backend at all.
  // Token estimates are prorated from character share rather than re-tokenized: exact enough
  // to answer the boundary question, and cheaper than pulling in a tokenizer for a log line.
  let split = '';
  if (typeof systemText === 'string' && typeof userText === 'string') {
    const sysChars = systemText.length;
    const usrChars = userText.length;
    const allChars = sysChars + usrChars;
    if (allChars > 0) {
      const sysShare   = sysChars / allChars;
      const sysTokEst  = Math.round(total * sysShare);
      const ceilingPct = (sysShare * 100).toFixed(1);
      const cachedOfSys = sysTokEst > 0 ? ((cached / sysTokEst) * 100).toFixed(0) : '0';
      split = ` | sysChars=${sysChars} userChars=${usrChars} sysTokEst=${sysTokEst}`
            + ` ceiling=${ceilingPct}% cachedOfSys=${cachedOfSys}%`;
      // cachedOfSys can legitimately exceed 100%: on an IDENTICAL repeat request the cached
      // prefix runs past the system prompt into the user message. That is a distinct and
      // useful state (observed live 7/31 21:48 — 0/9733 then 9730/9733 twenty-eight seconds
      // later on the same lead), so label it rather than leaving a >100% figure that reads
      // like an arithmetic bug.
      if (cached > sysTokEst * 1.1) split += ' [FULL-PREFIX: cache extended past system into user prompt — identical repeat]';
    }
  }
  if (cacheKey) split += ` key=${cacheKey}`;
  console.log(`[${requestId}] CACHE ${label} cached=${cached}/${total} (${pct}%) written=${written}${split}`);
}

function scanPhoneOnFile(userText) {
  if (!userText || typeof userText !== 'string') return false;
  const m = PHONE_ON_FILE_RE.exec(userText);
  if (!m) return false;
  const valuePart = m[1] || '';
  let digits = 0;
  for (let i = 0; i < valuePart.length; i++) {
    const c = valuePart.charCodeAt(i);
    if (c >= 48 && c <= 57 && ++digits >= 7) return true;
  }
  return false;
}

function safeJsonParse(text) {
  try { return JSON.parse(text); }
  catch { return null; }
}

async function classifyPhoneAsk(messageText, authHeader) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLASSIFIER_TIMEOUT_MS);

  const classifierPrompt = CLASSIFIER_PROMPT_PREFIX + messageText + CLASSIFIER_PROMPT_SUFFIX;

  try {
    const res = await fetch(OPENAI_ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': authHeader,
        'Accept':        'application/json',
      },
      body: JSON.stringify({
        model: CLASSIFIER_MODEL,
        messages: [{ role: 'user', content: classifierPrompt }],
        max_completion_tokens: CLASSIFIER_MAX_TOKENS,
        temperature: CLASSIFIER_TEMP,
        // (v7.42) Both fields below are INERT here and are kept only for the day this prompt
        // grows. CLASSIFIER_PROMPT_PREFIX is ~406 chars (~100 tokens), far below the
        // 1,024-token minimum cacheable prefix, so nothing is ever cached on this call — and
        // the variable messageText sits BEFORE the suffix, so there is no stable prefix to
        // cache regardless. Documented rather than deleted so nobody later reads these and
        // assumes classifier caching is doing work. (gpt-4.1-nano is pre-5.6, so
        // prompt_cache_retention is still the correct field for this tier.)
        prompt_cache_key:       `${CACHE_KEY_PREFIX}_classifier`,
        // (v7.64) REVERTED from v7.61's prompt_cache_options. The comment directly above this
        // already said gpt-4.1-nano is pre-5.6 and prompt_cache_retention is the correct field for
        // this tier — and v7.61 contradicted it two lines later. This call 400'd on every request
        // and the failure was SILENT: the classifier's error path is `if (!res.ok) return false`,
        // so a 400 is indistinguishable from a genuine negative classification.
        prompt_cache_retention: CACHE_RETENTION_LEGACY,
      }),
      signal: controller.signal,
    });

    if (!res.ok) return false;
    const data = await res.json();
    const answer = (data?.choices?.[0]?.message?.content || '').trim().toUpperCase();
    return answer.startsWith('YES');
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}