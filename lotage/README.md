# Lot Age (phone web app)

Shows every in-stock unit of a model, **oldest first**, so the salesperson shows the aged unit first.
Works on iPhone and Android with no app store: open the link, then use "Add to Home Screen."

## Where the data comes from
- `GET /inventory?dealer=<id>` on the Lead Pro proxy. This is the same per-store blob the extension
  reads, published from the vAuto Merchandising export with the Data Tool.
- Age = vAuto's **Age** column as of the export date + the days since that export. Units with no
  Age show "?" and sort last. The header shows the export date and warns once it's 2+ days old.
- Sign-in uses a Lead Pro license key (`POST /validate-license`). No proxy change is needed.

## Hosting (it needs an HTTPS address)
Upload the files in this folder as-is to any static host. The easiest option, since Lead Pro already
uses Cloudflare: **Cloudflare dashboard → Workers & Pages → Create → Pages → Upload assets** →
drag in this `lotage` folder → deploy. You get a link like `https://lotage.pages.dev`.

To update, upload the folder again. Phones pick up the new version the next time the app is opened.

## Files
- `index.html`: the app
- `lot-core.js`: sorting, age and model grouping (tested by `tests/lotage-core.test.js`)
- `sw.js`, `manifest.webmanifest`, `icon*`: lets the app install and open with no signal
