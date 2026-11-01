# MeterTrace

MeterTrace turns Chicago water-billing records into a reviewable evidence case: a chronology, source-page excerpts, explicit calculations, and precise questions. The cyber-futuristic interface works on desktop and narrow phone screens.

Live website: [MeterTrace](https://iamomer2707.github.io/metertrace/). Public source: [iamomer2707/metertrace](https://github.com/iamomer2707/metertrace). The HTTPS GitHub Pages deployment is live and has been exercised with fictional evidence on a 360px mobile viewport. The previous [MeterTrace site](https://metertrace-chicago-case-lab.peachyghat.chatgpt.site) remains available for exporting cases saved at that origin. See [QA.md](QA.md) for recorded checks and verification limits.

## Run locally

Node.js 24 is recommended; the project supports Node.js 22 or newer.

```sh
npm ci
npm run build
npm run dev
```

Open http://localhost:4173. Rebuild and restart the preview after source changes.

```sh
npm test
npm run validate
```

The GitHub Actions workflow runs installation, build, tests, and artifact validation on Node.js 24. Pull requests receive verification only; a successful main-branch build can deploy the static site in a separate job with narrowly scoped Pages/OIDC permissions. Official action dependencies are pinned to commit hashes. The recorded verification run passed **112 automated tests**. Browser verification also covered malformed-backup refusal, valid backup restoration, original-file reattachment, previous-case recovery, draft handling, and saved-note persistence.

## Resident workflow

1. Explore the clearly labelled fictional sample, then start a personal case.
2. Import bills, credit notices, meter-change records, and correspondence. Files are read on the device.
3. Check suggested fields against their numbered source pages. Leave undocumented facts unknown. Scanned pages and images require a manual transcript.
4. Review potential contradictions, missing records, estimated periods, meter events, and credit-reference questions.
5. Add context, choose clarification questions, and download a standalone HTML evidence packet. Open that report in a browser to print or save as PDF.
6. Export case data and keep the original files separately before clearing storage or changing devices.

## Upload and recovery safeguards

- PDF, TXT, Markdown, CSV, PNG, JPG, and WebP inputs are checked against supported formats. Text encoding, page limits, and file signatures are validated. Images must also pass a native browser decoder.
- Limits: 20 files per batch, 20 MB per file, 50 pages per document, and 200 documents / 100 MB per case including Trash. Image dimensions are capped at 10,000 pixels per side and 25 megapixels. Dense text exports may need splitting.
- Original-byte SHA-256 hashes detect repeated uploads, including documents already in Trash. A duplicate does not create another bill or credit record. For newer case-data backups that retain a byte hash, importing the exact original can reattach missing file bytes when hash, size, and MIME agree, while preserving the saved record IDs and reviewed fields.
- Imports are staged and cancellable. Cancelled or late results cannot be committed to a different case. Saved state changes only after a successful persistence transaction.
- Removing a document or record moves it to recoverable Trash and excludes it from findings and exports. Restore it from Trash or use Undo. Permanently emptying Trash affects that workspace’s removed items; a previous-case recovery copy remains separate.
- Switching from a resident case retains one previous resident workspace, including retained original files. Use the case switcher to recover it. A demo or empty case does not overwrite that resident recovery copy.
- A permanent local clear removes the active case and the previous-case recovery copy. It cannot remove downloaded exports or copies already shared elsewhere.
- Concurrent browser tabs cannot silently overwrite newer saved work: stale saves fail with reload guidance. Quota failures and cancelled saves leave the prior saved transaction intact. Unreadable stored data is preserved for deliberate recovery rather than silently replaced.

Document field and transcript drafts stay in the current tab while navigating between sources and review screens. Save them to retain changes after reload; Discard restores saved values. Case notes save separately. Unsaved field/transcript drafts are excluded from reports and backups.

## What calculations establish

Reconciliation is deterministic. Records need an existing numbered page and matching source quotation. Credit checks require a complete account identity, explicit adjustment reference, and usable chronology. Partial account digits, conflicting notices, ambiguous repeated postings, invalid dates, unsafe numbers, and unsupported assumptions generate review prompts rather than reliable monetary totals.

Arithmetic uses integer cents. Reading-difference checks require explicit compatible units and a documented multiplier; meter replacement boundaries are treated separately. Water-only charge checks use the documented rate and denominator, not the total bill. Multiple credit references are reconciled individually; an over-posting on one reference does not cancel an untraced amount on another.

A finding is a question supported by the available records. An absent posting may reflect an incomplete document set. Reviewing a finding records that the resident examined it; it does not mean the City resolved the dispute. Review all extraction suggestions before relying on a result.

## Local data and exports

A public website does **not** publish visitors’ cases. Original document Blobs, extracted text, saved review fields, Trash, and the previous-case recovery copy remain in IndexedDB in that browser profile and site origin. There is no server document database or cloud synchronization. Browser storage is not encrypted by MeterTrace, may be cleared or evicted, and is accessible to others using that browser profile. GitHub project sites under `iamomer2707.github.io` share one origin; a separate repository path does not isolate browser storage from other JavaScript hosted on that owner hostname. A dedicated custom domain can provide a separate origin.

JSON case-data backups and HTML evidence packets include active saved evidence and source text. They exclude original binary files, Trash, previous-case recovery copies, and unsaved field/transcript drafts. They can contain account details; inspect them before sharing. Keep original files separately. Clearing or switching site origins does not migrate local data. Before moving from the previous site to GitHub Pages, export case data there; restore that backup at the new address and reattach the exact original files. Backups omit Trash and unsaved drafts, so save drafts and restore any removed evidence you intend to carry over first. Keep the previous site available until you have checked the restored case.

## Optional AI extraction

Local import, manual review, reconciliation, and packet generation work without an AI provider. The GitHub Pages build is static and has no AI endpoint; AI extraction is unavailable there. An independent Worker deployment can support optional extraction, which requires **both** a server-side `OPENAI_API_KEY` and a 32–256-character `METERTRACE_API_TOKEN`. `OPENAI_MODEL` can select another compatible structured-output model.

When enabled, a visitor explicitly consents before selected document page text is sent through the server to OpenAI. Original binary files are not sent. Provider responses are source-checked suggestions requiring human review; AI never performs the reconciliation arithmetic. Provider requests use `store:false`, which is not zero-retention certification. Live AI behavior was not exercised in this verification; provider responses were mocked.

Never put runtime secrets in the browser bundle, source repository, or case exports. See [README-deployment.md](README-deployment.md) and [SECURITY.md](SECURITY.md) for the API contract, access controls, and public-service limits.

## Deploy

`npm run build:pages` produces the static `public-site/` directory. Asset paths and the local PDF worker work beneath `/metertrace/`. The supplied GitHub workflow runs the complete build, regression suite, and artifact validation, then uploads only `public-site/`. The public `iamomer2707/metertrace` repository uses **Settings → Pages → Build and deployment → Source: GitHub Actions**. Select the same setting if deploying your own copy. The deployment job uses the `github-pages` environment and only runs for `main`, never pull requests. No API keys or personal access tokens are needed for static hosting.

Pages uses a supported meta CSP and a no-referrer meta policy. It cannot apply this project's optional Worker HTTP security headers, including `frame-ancestors`, `X-Content-Type-Options`, and `Permissions-Policy`. See [SECURITY.md](SECURITY.md) for the resulting boundaries and [README-deployment.md](README-deployment.md) for setup and migration steps.

`npm run build` also produces an independent Cloudflare-compatible Worker ES module at `dist/server/index.js`. It embeds browser assets and exports `default.fetch(request, env, ctx)`. No D1/R2 bindings or server document database are required. Configure your own Worker account and runtime secrets for that deployment. The generic `.openai/hosting.json` contains no live Sites project ID.

A broadly available paid AI service needs authenticated per-user access, distributed rate limits, spending controls, and an appropriate privacy/retention process; the optional shared extraction token is not a multi-tenant account system.

## Architecture

| File | Responsibility |
| --- | --- |
| `src/app.js`, `src/styles.css` | Responsive workspace, draft handling, review dialogs, source drawers, and recovery UI |
| `src/engine.js` | Deterministic reconciliation and conservative labelled-field extraction |
| `src/documents.js` | Format validation, safe local originals, hashing, PDF/text extraction, and image checks |
| `src/case-state.js`, `src/storage.js` | Case limits, reversible removals, cancellation, atomic persistence, and previous-case recovery |
| `src/report.js`, `src/case-data.js` | Safe report/backup generation and backup validation |
| `src/server.js` | Optional access-controlled, source-checked AI extraction |
| `src/demo.js`, `tests/fixtures/` | Wholly fictional demonstration and test records |
| `scripts/`, `tests/` | Build/package validation and regression scenarios |

## Scope and limits

No finite test suite covers every possible upload, browser, or billing history. The application has no official City rate table, automatic OCR, cloud sync, or automatic dispute submission. It is independent of the City of Chicago and does not certify bills, legal claims, or refunds. The [May 6, 2026 OIG audit](https://igchicago.org/publications/water-billing-audit/) motivates scrutiny of administrative records; it does not establish an error for an individual account. No award outcome, including Webby approval, can be guaranteed.
