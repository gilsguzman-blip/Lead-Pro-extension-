# Lead Pro: trigger inventory

**Question:** which rules that turn lead text into an instruction for the model fire on evidence that isn't there?

**Built on:** extension v9.7.710 (`builds/dev`) and all captures uploaded to date.
- Captures cite by file id only. No customer names, phones or message bodies beyond short non-identifying fragments.

**Corpus**

| Source | Count | Notes |
|---|---|---|
| Full-prompt captures | 54 | **25 distinct leads**, 9/9 to 9/24. One lead was captured 13 times, so findings count leads, not captures. |
| Extension logs | 56 | |
| VinSolutions dumps | 9 | |

By store:

| Store | Captures |
|---|---|
| Kia Baytown | 31 |
| Honda Lafayette | 9 |
| Honda Baytown | 6 |
| Audi Lafayette | 5 |
| Toyota Baytown | 3 |

Audi and Toyota are thin.

**Method.** Three measurements, each on real data:
1. **Directive catalog.** Every conditional line Lead Pro wrote into the 54 prompts, split from the transcript and arc.
   - 259 directive lines. The ones below assert a fact about the customer derived from text; facts from a system feed (stock, hours, ZIP) are excluded.
2. **The shipped code, re-run.** The current concern block (`customerConcerns`, lifted verbatim from v9.7.710) is run over every capture's transcript twice:
   - on the full transcript, as production scans it;
   - on the customer's lines only.
   - A concern that fires on the first but not the second was set off by our messages or notes, even though its directive says "Customer raised / mentioned / referenced".
3. **Provenance.** Every quote a directive attributes to the customer is traced to the transcript entry it came from. Where a trigger logs what it matched, the logs give production truth.

**Rendered vs current.** Each capture shows the build that was live that day. A defect is listed as live only if it reproduces on v9.7.710, or appears on a capture made after the last change to its code. Everything else is marked fixed or unconfirmed.

---

## 1. Live defects, ranked

### 1. The customer's latest message is quoted with the CRM's routing header attached (High)
- **What:** `CONVERSATION STATE: The customer's last message was …` and `MOST RECENT CUSTOMER MESSAGE [sent TODAY]: "…"` quote the raw note, not the cleaned text the transcript uses. Examples of what gets prepended:
  - `Received from: (phone) Received by: Vinessa Virtual Assistant Community Kia …`
  - `Received by: <agent name> …`
  - on email replies: `Subject: Re:Subject:… By: <agent name> …`
- **Where:** 10 of the 13 leads with a customer reply (26 captures), through 9/24 on current builds.
- **Effect:** the one line the prompt calls "your response MUST directly address" opens with CRM plumbing. It carries the customer's phone number and a staff or bot name, all presented as the customer's words. The transcript itself already strips this (`_lpStripNoteMeta`, v9.7.623).
- **Fix:** run these two quotes through the same strip. Low risk.

### 2. "Customer has stated a specific budget … lead with their stated number" fires when they asked for OUR number (High)
- **What:** the flag is `_lpCustSaidMoney`, set by `/\bcash\b|\boffer\b|\$\s?\d|\bOTD\b|out the door/` on the customer's own lines (customer-scoped since v9.7.616, but still keyword-only).
- **Evidence:** the logs contain 13 distinct customer messages that set it.
  - 5 contain a figure of the customer's own ("$33k", "21k–21.5k OTD", "$2,500 down", …): correct.
  - 2 are questions asking for our number: "what kind of incentives and warranty do you all **offer**?" and "Just would need the **out the door** cost…". The directive then says "lead with their stated number". There is no such number.
  - 6 can't be classified from the logs, because the diagnostic cuts each message at 90 characters.
  - One lead (3 captures) carries the directive with no figure anywhere in the customer's text.
- **Fix:** "stated a number" requires a figure in the customer's own message. A request for our price is already covered by PRICE/PAYMENT CONCERN.

### 3. "TRIM/CONFIG PREFERENCE: Customer referenced EX-L / LX / Elite": half from our own text (Medium)
- **What:** `trimMatch` runs over `allTranscriptText`, which includes notes and call notes, and in practice our outbound, where the vehicle's own name ("CR-V EX-L") appears.
- **Evidence:** fires on 6 captures. On 3 leads (3b3913a7, 4650c8c1, 5469fb07) the customer never wrote the trim. This reproduces on v9.7.710 via the ablation.
- **Fix:** scan `customerOnlyText`, as the colour, credit, co-signer, timeline and comparison triggers already do.

### 4. "VEHICLE VARIANT MISMATCH: the customer's own words ask about a different configuration — "X"" names things that are not configurations (Medium)
- **Evidence:** production diagnostics on real runs.

  | "Configuration" named | Where | Correct? |
  |---|---|---|
  | **"awaits"** | 3 leads (Wrangler, Stinger, QX50), from our "…Awaits" email subjects | No |
  | **"https"** | 1 lead | No |
  | **"2022"**, a model year | Seltos lead, 3 captures | No |
  | "hybrid" | 2 leads | Yes |

- **Why:** the token after make + model is taken as a trim if it's not in a small stop-word list. The own-send filter (v9.7.641) drops our sends, but on real runs these still get through. The likeliest paths are the customer's reply quoting our subject line and Lead Pro's own "WHAT WE HAVE ALREADY TOLD THIS CUSTOMER" quote. This last part is not reproduced offline: the current block re-run on the captures does not fire.
- **Fix:** reject years, URL fragments and any token without a trim shape. Better: require the token to appear in a customer line.

### 5. OPEN THREADS extracts "questions" from URL fragments (Medium-low)
- **What:** `Customer asked question(s) that may not have been answered:` examples:
  - "com%2fsearch/one-owner-used/?"
  - "us%2f1y864y (no login required) | I?"
  - "m interested in this 2022 RAM 1500 and I?", a sentence cut at a curly apostrophe
- **Where:** 2 leads, most recently 9/21.
- **Effect:** the prompt tells the model the customer has an unanswered question that is a web address.
- **Fix:** strip URLs before splitting sentences, and normalise curly apostrophes before the question-mark split.

### 6. VEHICLE STATUS: SOLD stated flatly beside a line that says it may not be sold (Low, a decision for Gil)
- **What:** on 3 leads the same prompt says both of these:
  - "VEHICLE ON LEAD: … NOT confirmed available (inventory shows it **sold, pending, in transit, or unverified**)";
  - "🔴 VEHICLE STATUS: SOLD — this specific unit is no longer available … Tell the customer once, plainly".
- **Why:** the sold block keys on VinSolutions' inventory warning, which doesn't distinguish sold from transferred or feed lag.
- This is the store's designed pivot, so it's flagged, not proposed.

### 7. VISIT OVERRIDE has no age limit (Low)
- **What:** log242 (bc558f2f): "⚠ VISIT OVERRIDE: An agent note indicates the customer has already visited", from a **2023** showroom visit on a lease-end reply in 2026.
- The SHOWROOM FOLLOW-UP block has a 30-day window; this override doesn't.

### 8. RECURRING TOPICS quoted our email subject as a relationship topic (Low, watch)
- **What:** one lead (13 captures, 9/16) got "Let's Get You Behind the Wheel at Community Kia" as a topic example. The own-send guard (v9.7.594) should drop it.
- Later captures are clean, apart from one agent call note describing the customer, which is legitimate. The cause is not reproduced.

---

## 2. Found live today and already fixed (v9.7.707 to v9.7.710)

| Build | Directive | What it fired on |
|---|---|---|
| 707 | email BOUNCING | a Gmail 421 sender-reputation block, 13 months old and superseded |
| 708 | SOLD/DELIVERED, congratulations | the Lead Info "Status: Sold" label overruling a 2023 Sale Info date |
| 708 | post-sale "service concern" | the word "service" inside Lead Pro's own sold directive |
| 709 | confirming a price | "is your offer now 41,019?" answered "yes"; we never quoted it |
| 709 | TRADE-IN CONCERN, "TRADE is worth" | "title/lien payoff"; the customer had said "I won't be trading in" |
| 709 | "customer HAS described their trade" | the vehicle of interest written shorter |
| 709 | CREDIT CHALLENGE DISCLOSED | "repo" inside "AutoCheck report" |
| 709 | "customer verbally confirmed" | our own text "we will be here" |
| 710 | "A PERSON HAS ALREADY WRITTEN" | the prompt data never carried the sent-message list |
| 710 | SUGGESTED APPOINTMENT TIMES | printed beside two blocks that forbid naming times |
| 710 | "the customer's own words" | an empty "Comments ///" form field |

---

## 3. Measured and sound

| Directive | Fired (captures) | Supported by the transcript |
|---|---|---|
| LIVE CONVERSATION | 20 | 20 |
| TRADE-IN FLAG | 19 | 19 (trade on file or in the customer's words) |
| SENSITIVE FINANCE RULE | 16 | 16 (customer or note states credit score or negative equity) |
| NEVER REPLIED / ONE-SIDED | 11 | 11 |
| FINANCING CONCERN | 8 | 8 (all in customer lines on the re-run) |
| COLOR PREFERENCE | 6 | 6 |
| PRICE/PAYMENT CONCERN, TIMELINE | 4 each | 4 each |
| NOT TODAY | 3 | 3 ("won't be able to make it until Friday", "at the earliest next weekend", …) |
| VEHICLE PIVOT / CROSS-BRAND PIVOT / CUSTOMER NAMED A DAY | 3 / 1 / 1 | all |
| OPEN THREADS: agent committed | 36 quotes | 36 are ours, as labelled |
| OPEN THREADS: customer asked | 39 quotes | 32 are the customer's; 7 are item 5 or not in the visible transcript |
| PAUSE | 2 leads | the Ram lead's call note ("will let me know when he can come down") is fair. Older matches on "will reach out" came from builds before v9.7.687, which excluded our own sends. |

---

## 4. Limits

- **Triggers that never fired in 54 captures are unmeasured, not cleared.** These include CO-SIGNER, SPOUSE (fired once in the logs, on "my wife"), COMPARISON SHOPPING, FEATURE UNCERTAINTY, bereavement and the hearing limit.
- **Audi (5 captures) and Toyota (3) are thin.** More captures from those stores would widen coverage the most.
- **Item 4 is proven from production logs, not reproduced offline.** Its fix should be tested against a capture where it actually fired.
- **Item 2's split is bounded by the 90-character diagnostic.** Six messages couldn't be classified.

## 5. Re-running it

`tools/trigger-inventory/` holds the harness. The captures carry customer data: keep them and the outputs out of the repo.

```sh
python3 tools/trigger-inventory/parse.py <captures dir> <out dir>
node    tools/trigger-inventory/concerns.js <out dir>
python3 tools/trigger-inventory/quotes.py   <out dir>
python3 tools/trigger-inventory/evidence.py <out dir>
```

## 6. Recommendation

1. **Fix items 1 to 5 together in one build.** They are small, local changes, each with a capture to test against.
2. **Re-run the inventory on each batch of new captures.** That is the step that would have caught today's eleven before a customer saw them.
3. **Items 6 and 7 are yours to decide.**
