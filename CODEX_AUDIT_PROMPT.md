# Codex audit brief — Lead Pro (DEV v9.7.538-dev / COMMERCIAL v9.7.536)

## What this codebase is

Lead Pro is a Chrome MV3 extension that runs inside the VinSolutions CRM. It scrapes a car
dealership sales lead out of the CRM's nested iframes, assembles a large system + user prompt
from that lead, sends it to an LLM, and returns an SMS, an email and a voicemail script that a
BDC agent sends to a **real customer**. There is no human review step between generation and
send in practice — agents copy the output straight out.

That is the stake to keep in mind for every finding: a logic error here does not throw an
exception, it sends a confident, well-written, **wrong** message to a customer. Recent live
failures include declining a sale on an in-stock car, inventing a trade-in the customer had
explicitly said they did not have, promising delivery the store does not offer, and texting a
customer who had opted out of SMS.

Two builds ship in parallel and must stay behaviourally identical in shared regions:

```
builds/dev/         DEV v9.7.538-dev   popup.js 19,093 lines / 1.83 MB
builds/commercial/  COMMERCIAL v9.7.536 popup.js 18,620 lines / 1.73 MB
```

Both also contain `content.js` (1,408 lines, the page-context scraper), `auth.js`,
`dealer-setup.js`, `dealer-config.js`, `background.js`, `config.js`, `popup.html`.
`popup.js` holds ~91 top-level functions and carries a 183-entry changelog in the header
comments.

## Prime directive: do not break what is already there

**Almost every guard, gate and regex in this file exists because of a specific live customer
incident.** The header changelog documents them by name, date, store and lead ID. A condition
that looks redundant, overly narrow, or bizarrely specific is usually load-bearing, and the
reason is written down.

Before you propose changing or removing any check:

1. Search the header changelog (lines 1–200 of `popup.js`) for the version tag near it —
   guards are tagged in-line like `(v9.7.411/409)`, `(v9.7.536/534)`.
2. Read that entry. It will usually tell you exactly which customer broke, how, and what a
   naive fix would re-break. Several entries explicitly warn against the "obvious" fix.
3. If the entry says a behaviour was **deliberately** chosen (e.g. v9.7.534 deliberately
   reverses the v9.7.518 carve-out on bare `STOP`), do not report it as a bug. Report it only
   if you have evidence the stated reasoning does not hold.

Deleting a guard because you cannot see what it is for is the single worst outcome of this
audit. "This looks unnecessary" is not a finding. "This is unreachable, and here is the
evaluation proving it" is.

## How to verify anything you claim

This codebase has a hard-won verification discipline. Follow it — findings that do not meet it
will be discarded.

- **Slice the shipped bytes.** Do not reimplement a detector to test it. Extract the real
  line(s) or block out of `popup.js` as a string, evaluate them, and run cases through. The
  existing tests show the pattern:
  - `tests/pivot.test.js` — slices the vehicle-pivot block from each build
  - `tests/trade-delivery.test.js` — slices individual detector lines by unique substring
  Run both: `node tests/pivot.test.js builds/dev/popup.js builds/commercial/popup.js`
  (10/10 and 14/14 expected, dev≡comm on every case).
- **Syntax gate:** `node --check builds/dev/popup.js && node --check builds/commercial/popup.js`
- **Manifests must parse** after any edit.
- **Parity:** for any shared region you touch or cite, diff it between the two builds and say
  whether it is byte-identical. Regions legitimately differ (DEV carries a build
  distinguisher and newer changelog entries) — call out only *behavioural* divergence.
- **Prefer a differential run** over an assertion. When you claim a change is narrowing-only
  or widening-only, generate a corpus of realistic inputs, run old vs new, and report the
  counts in each direction plus an audit of the cases that moved.

There is no lint config, no type checker and no CI. `node --check` plus the two test harnesses
are the whole safety net, which is exactly why static review matters here.

## Bug classes that actually occur in this file

These are not hypotheticals — each has shipped and reached a customer. Hunt for more instances
of each.

1. **Dead reads.** `d.context` is never assigned on the object `populateFromData` receives;
   `context` only exists on the new objects built for `buildUserPrompt`. v9.7.516 found
   **thirteen** readers, four of them completely dead branches that had never once fired.
   Look for more fields read on the wrong object at the wrong stage, and for conditions gated
   on a permanently-falsy value.

2. **Self-pollution — LP reading its own output back as evidence.** `populateFromData` appends
   its directives to `leadContext`, which becomes `data.context`, which downstream triggers
   then scan. In v9.7.538 the trade-conflation guard's own sentence ("if they are asking for a
   trade number") was matched by the trade-value regex and fabricated a customer trade.
   **Audit every full-arc scan for whether it can see LP-authored text**, not just scraped
   lead text. The marker to look for is `'\n\nVEHICLE/LEAD DETAILS:\n'`.

3. **Agent-text pollution.** Regexes meant for customer words matching the agent's own prior
   outbound or note bylines. v9.7.411: the bare token `kelley` (for Kelley Blue Book) matched
   BD agent "Roslynn Kelley" in note bylines. v9.7.400: a bare `\d{2,3} miles` pattern matched
   the agent's own "you're about 70 miles out". Check every pattern that reads the arc for
   whether a name, a byline, a system log line or prior outbound could trip it.

4. **Precondition mistaken for scope.** A trigger gated on "the customer must have spoken"
   while still *scanning the full arc* is not scoped — it is a boolean precondition with an
   unscoped search. This exact confusion survived v9.7.411 and caused v9.7.538. Look for
   `if (someoneSpoke) { fullArc.match(...) }` shapes.

5. **Contradictory directives in one prompt.** Two independent blocks can each be individually
   correct and jointly incoherent, and the model follows the more emphatic one. v9.7.537: the
   VOI-panel-authority directive said "never name the Honda Accord — it is stale" while the
   cross-brand block built the entire message around that Accord. **Grep for directive text
   that could co-occur and conflict**, especially around vehicle identity, availability,
   appointment vs no-appointment, trade, and SMS opt-out. The v9.7.536 header notes one still
   open: the SMS opt-out directive says "generate a very short opt-out confirmation" while the
   render layer blanks the field.

6. **First-match-wins truncating a search.** A loop that `break`s on the first hit, where a
   later candidate is the right one. Found in v9.7.537's pivot scan: rejecting a stale
   candidate discarded a genuine one behind it in list order.

7. **Field name matched, value ignored.** `Has trade-in: **No**` matching `/\btrade[- ]?in\b/`
   and reading as "trade discussed". Look for other structured `Label: Value` lead fields
   where a detector keys on the label.

8. **Low-signal text treated as intent.** Canned third-party lead-submission blobs (CarGurus,
   Cars.com, AutoTrader templates) are boilerplate, but several code paths treat them as the
   customer's own considered words. Two shipped incidents trace to this.

9. **Merge hazards.** Fields are merged across frames with first-truthy-wins, so a value in
   one field can describe a subject in another and the two halves can come from different
   frames (v9.7.507, v9.7.517). Look for field pairs that must move together and do not.

10. **Regex-on-sanitized-text traps.** v9.7.536: `[^\n]*` ran greedily on text whose newlines
    had already been collapsed to spaces by `sanitize()`, deleting an entire message body.
    Check for patterns whose correctness depends on newlines that an earlier stage removed.

11. **Prompt-assembly hygiene.** Duplicate blocks (`scenarioRules` is known to render twice per
    prompt), directives that contradict store policy, order-of-precedence problems where a soft
    directive is drowned by a prescriptive one, and token waste.

## Already known — do not re-report as new

Verify if you like, but these are on the record as open, with reasons:

- Pivot model lists hold only Toyota/Honda/Kia nameplates, so at an Audi (or other non-listed)
  rooftop every hit is structurally cross-brand; and the cross-brand copy asserts "we do NOT
  carry \<Brand\>", false of any store retailing off-brand pre-owned. Brand is standing in for
  inventory.
- The `custSpoke` gate treats a canned deal-builder blob as "the customer spoke".
- `lastInboundMsg` carries the routing header for every popup-side consumer.
- `m.isSmsOptOutOnly` arrives popup-side as `undefined`.
- The SMS opt-out directive vs render-layer contradiction described above.
- The EXIT SIGNAL scaffold leaking into the arc.
- The first-person "I am outside" subject-token gap in the on-premise detector.
- The on-premise same-clause rule loses genuine cross-clause presence signals (a known,
  accepted trade — a false "we know you're here" costs more than a missed one).
- `scenarioRules` renders twice per prompt; removing the duplicate changes prompt emphasis and
  needs an explicit product call.

## What I want from you

Audit **both** builds. Cover `popup.js` primarily, but do not skip `content.js`, `auth.js`,
`dealer-setup.js` and `dealer-config.js` — a scraper or auth defect is just as customer-facing.

Report findings ranked by customer impact, in this form:

- **What is wrong** — one sentence.
- **Where** — `file:line`, with the version tag of the guard involved if there is one.
- **Evidence** — the concrete input that produces the wrong output. Show the evaluation you
  ran against the shipped bytes. No "this could theoretically…".
- **Customer-visible consequence** — what the agent actually sends, and to whom.
- **Proposed fix** — minimal and surgical. State explicitly what it does *not* change.
- **Blast radius** — what else reads this code path, and which existing incident guard could
  regress. If you are not sure, say so.
- **Confidence** — high / medium / low, and what would raise it.

Separately, list **improvement opportunities** that are not bugs: dead code, duplicated logic
that has drifted between the two builds, diagnostics that report a fact nobody can act on,
missing diagnostics on paths that fail silently, and places where two code paths encode the
same fact and could disagree. Flag these; do not act on them.

## Rules of engagement

- **Do not refactor.** No reorganising, no renaming, no "modernising" `var` to `const`, no
  extracting helpers, no reformatting. The diff noise would bury the signal and the changelog
  is anchored to the current structure.
- **Do not delete a guard** because its purpose is unclear. Ask the changelog first; if it is
  still unclear, report it as a question, not a finding.
- **Do not change prompt wording** that encodes store policy (OTD/pricing discipline, delivery
  and transport phrasing, hold-vs-secure inventory rules, persona and signature blocks,
  compliance-related SMS opt-out behaviour) without flagging it as a **product decision** for
  a human. Several of these read like awkward English and are deliberately worded.
- **Preserve DEV/COMMERCIAL parity.** Any fix must apply to both, or explain why not.
- Prefer many small, independently verifiable findings over one sweeping rewrite.
- If you find nothing in a category, say so plainly. A short honest audit beats a padded one.

Start with a pass that produces the finding list only — no edits. I will pick what gets
implemented.
