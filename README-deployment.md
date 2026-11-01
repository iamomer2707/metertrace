# MeterTrace runtime and privacy

MeterTrace supports a static GitHub Pages build and an optional Cloudflare-compatible Worker deployment with bundled browser assets. The public website provides a browser-local workspace: case records, original document Blobs, extracted page text, review status, and recovery items live in IndexedDB in the current browser profile. There is no server document store, account database, or cloud synchronization. A public website does not make visitors’ local cases public.

Browser storage is not a cloud backup and is not encrypted by the application. Anyone with access to that browser profile may read its saved case. Browsers may clear or evict storage. Keep original files and export case data. Local deletion does not delete already downloaded packets or exports elsewhere on the device.

## GitHub Pages

The live public address is https://iamomer2707.github.io/metertrace/. The [public repository](https://github.com/iamomer2707/metertrace), [initial successful deployment](https://github.com/iamomer2707/metertrace/actions/runs/41358665631), anonymous HTTPS response, and live application were verified on November 1, 2026. Use these steps for later deployments or your own copy:

1. Publish this source in the public `iamomer2707/metertrace` repository, with `main` as its default branch.
2. In **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source. Keep HTTPS enabled when the control is available.
3. Push to `main` or run **Verify and deploy MeterTrace** from the Actions tab. Its build job installs the lockfile, builds, runs the tests, and validates the Worker artifact. Only after those checks pass is `public-site/` uploaded and deployed by the separate `github-pages` environment job.
4. Check the Actions deployment result and open the reported URL. Verify local import, PDF parsing, report download, and narrow-screen layout at the `/metertrace/` path.

The workflow is pinned to official action commit hashes. Build and pull-request execution have read-only permissions; Pages write and OIDC permissions are confined to the deployment job. Pull requests cannot publish. No long-lived GitHub token, provider secret, or resident document belongs in the static artifact.

For a manual static build, run `npm ci` then `npm run build:pages` and serve `public-site/`. GitHub Pages cannot execute `src/server.js`; the static UI reports AI extraction unavailable. Its supported CSP and no-referrer policy are HTML meta tags. Headers such as `frame-ancestors`, `X-Content-Type-Options`, and `Permissions-Policy` need a host that can set HTTP response headers and are not claimed for Pages.

### Storage origin and migration

All project sites beneath `iamomer2707.github.io` share the same browser origin. Repository paths are not a security boundary for IndexedDB. The application uses an app-specific database name, which avoids accidental name collisions but cannot prevent another script on the same owner hostname from reading it. Use a dedicated custom domain for a separate origin if hosting untrusted projects on that hostname.

Moving from the previous site changes the origin. In the old site, save drafts, restore any Trash evidence you want to include, and export case data. At the new site, restore the backup and import the exact original files to reattach binary originals. Check the restored sources, findings, and notes before relying on it. Backups do not carry original binary files, Trash, previous-case recovery copies, or unsaved drafts. Keep the old site accessible during migration; the new deployment cannot read or clear its browser-local storage.

## Optional Worker deployment

`npm run build` writes `dist/server/index.js`, a Cloudflare-compatible module exporting `default.fetch(request, env, ctx)`. Configure your own Worker deployment with this entry point and appropriate compatibility date. The Worker serves the same local app with HTTP security headers and can provide the optional extraction API below. It needs no D1/R2 storage or document database. The generic hosting metadata is not bound to the previous Sites project.

## Optional AI extraction

Local PDF/text extraction, manual editing, deterministic reconciliation, and packet generation do not require an AI provider. GitHub Pages does not support the extraction API. On a separately deployed Worker, extraction remains disabled until configured. Enabling it requires **both** Worker runtime secrets:

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Server-side OpenAI API secret. Never put it in the browser bundle or a case export. |
| `METERTRACE_API_TOKEN` | Required 32–256-character access secret, generated randomly. Authorized visitors enter it in the extraction dialog, which sends it as `x-metertrace-token`; the app does not persist it. Never commit or publish the value. |
| `OPENAI_MODEL` | Optional structured-output-capable Responses API model. Default: `gpt-4.1-mini`. |

A provider key alone never enables extraction. `GET /api/health` reports AI available only when both secrets meet the configuration checks. For a public multi-user AI service, replace the shared secret with an authenticated gateway and per-user authorization, distributed rate limits, spending controls, monitoring, and an appropriate provider/privacy agreement. A shared extraction secret is not a user-account system.

`POST /api/extract` accepts `{documentId, pages:[{pageNumber,text}]}`. It sends selected document page text to OpenAI only after the visitor explicitly requests and consents in the UI. No original file binary is sent. Requests use strict structured output and `store:false`. Provider retention policies still apply; this is not a claim of zero data retention. Scanned PDFs and images need manually supplied text; there is no automatic OCR.

The API rejects cross-origin requests, requires the access token, bounds request bodies to 400,000 UTF-8 bytes while reading, validates numbered pages and total text, and bounds provider responses. Tokens are compared using fixed-length SHA-256 digests. Returned records are projected to the supported schema, require exact page quotations, and always need human review. A quotation check establishes that the words exist, not that every extracted field is correct. Mathematical reconciliation never relies on a language model.

There is a per-Worker-isolate burst guard, not a distributed rate limiter. It does not constitute a global spending cap. No application code logs document bodies, tokens, or provider error bodies.

## API failures

AI disabled/incomplete server configuration: HTTP 503, while local work remains available. Invalid input: 400/413. Wrong content type: 415. Wrong origin/token: 403/401. Burst limit: 429. Provider failures, incomplete output, or oversized/invalid provider output: 502 with a generic message. Failed extraction leaves saved local records unchanged.

Provider responses are tested with mocks; no live AI request or extraction accuracy certification is included in the test results. Implementation reference: [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).
