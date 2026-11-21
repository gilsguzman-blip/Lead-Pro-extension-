# Lead Pro — working notes

## Packaging: the two channels must be distinguishable by filename alone

Two builds ship in parallel from `builds/dev/` and `builds/commercial/`, and Gil installs
both. A filename that differs only by a `-dev` suffix is not enough — the channel goes in
the name, capitalised, where it cannot be missed:

```
leadpro_DEV_v9_7_659.zip
leadpro_COMMERCIAL_v9_7_659.zip
```

Dots in the version become underscores. This is the convention the repo's own zip history
already uses (`leadpro_COMMERCIAL_v9_7_628.zip`), and it is the form to deliver in. Gil,
9/12: "please add commercial to the build name to completely distinguish from Dev."

Build them from inside each build directory so the manifest sits at the zip root:

```sh
(cd builds/dev        && zip -qr /path/leadpro_DEV_v9_7_659.zip        . -x '*.DS_Store')
(cd builds/commercial && zip -qr /path/leadpro_COMMERCIAL_v9_7_659.zip . -x '*.DS_Store')
```

## Before delivering any build

- `node --check` both `popup.js` files.
- Both manifests parse, and `version` **and** `version_name` are bumped (dev carries the
  `-dev` label, commercial does not).
- `bash tests/run-all.sh` fully green; the build header's assertion counts must match what
  the run actually printed, not what was planned.
- Byte-compare every changed region between `builds/dev` and `builds/commercial`.

## American spelling, always

Every word a customer can see is American English: color, gray, favorite, center, apologize,
recognize, organize, canceled, labeled, acknowledgment, inquiry, license. Gil, 10/16: "we should
always use American spellings of all words." The model copies the wording of its instructions
(log330: "what year range or colour should I watch for?" came from our own prompt), so:

- Prompt text the model reads (system prompt, user prompt, rewrite prompts, directives, examples)
  is written in American spelling. New code follows suit, comments included.
- Both LANGUAGE rules (main system prompt and `buildSystemPromptSmsRefine`) require it.
- `_lpAmericanSpelling` runs on every SMS, email and voicemail before render. It leaves "grey"
  alone because factory paint names keep the factory's spelling.
- Diagnostic log strings that tests match on may keep older wording; nothing customer-facing may.
