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
