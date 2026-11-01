# MeterTrace verification record

Recorded November 1, 2026. This is a scenario-based engineering verification, not a guarantee that every possible input is correct or a penetration-test certificate.

## Release status

GitHub Pages target: https://iamomer2707.github.io/metertrace/. Publication, Pages activation, and live verification at this address are pending. Static build preparation is complete; the existing deployment remains available during migration.

Existing hosted origin: https://metertrace-chicago-case-lab.peachyghat.chatgpt.site

The managed host confirms successful deployment and public access. Live browser verification and the non-browser probe limitation are recorded below.

## Automated checks

The recorded `npm test` run passed **112 tests**, with no failures, skips, or cancellations. Build and ESM deployment-artifact validation passed during release preparation. The prepared GitHub Actions workflow repeats `npm ci`, `npm run build`, `npm test`, and `npm run validate` on Node.js 24. Its build job has read-only permissions; its separate main-only deployment job receives Pages write and OIDC permissions. Pull requests do not deploy. Official action references are pinned to commit hashes verified against their official repositories on November 1, 2026.

| Area | Cases covered |
| --- | --- |
| Reconciliation | Integer-cent arithmetic; one-cent differences; complete versus partial account identity; credit references and chronology; contradictory notices; repeated bills and postings; invalid dates and unsafe amounts; missing evidence; source-ID collisions; explicit reading units/multipliers; meter replacement boundaries; estimated sequence boundaries; bounded service-order threads |
| Import | Empty/unsupported/oversized files; mismatched declarations and signatures; HTML renamed as PDF/image; binary disguised as text; UTF-8/UTF-16 text; page and text limits; duplicate-byte hashes; cancelled reads; image raster-size limits, decode errors, and dimension agreement |
| Recovery and persistence | Reversible documents/records; original Blob preservation; Trash-aware duplicate and capacity checks; changed-case cancellation; stale-tab conflicts; atomic quota rollback; aborted saves; previous resident snapshots; explicit active/previous clear; preserved corrupted saved state |
| Backup and report | Strict shape/date/ID validation; invalid source references; unsafe object structures; active-evidence projection; exact-hash original reattachment without replacing reviewed records; exclusion of originals, Trash, and unsaved field drafts; escaped HTML; source anchors; printed record fields; explicit formulas and ambiguity notices |
| Static Pages packaging | Repository-subpath asset resolution; early meta CSP and static mode; no inline application JavaScript; local PDF worker; license and `.nojekyll` packaging; retained Worker HTML/API header behavior |
| API and deployment | AI disabled without both required secrets; mandatory access token; origin checks; UTF-8 byte-bounded request/provider streams; schema and chronology validation; source grounding; field projection; generic failure messages; burst limits; same-origin versioned assets and defensive headers |

The prior dependency audit reported no known production dependency advisories after the PDF.js patch. Advisory results describe the dependency database at audit time, not a permanent assurance.

## Browser checks performed

All test documents and identifiers were fictional.

- A mixed valid PDF / TXT / PNG batch imported successfully. PDF/text produced reviewable labelled records; the image required manual transcription.
- Empty files and HTML renamed as an image/PDF were rejected with visible guidance.
- Downloaded case-data JSON and HTML reports were checked to exclude Trash and binary originals, retain resident notes and manual-transcription provenance, preserve the fictional $166.40 credit discrepancy, escape hostile markup, and resolve every generated internal source anchor.
- A document field draft survived a trip to its source page and back. Discard removed the unsaved draft. Saved review status survived reload.
- An accidentally removed document moved to Trash. Reuploading identical bytes was detected there, and restoring it recovered the evidence.
- Record removal supported Undo/restore.
- A malformed backup was refused while leaving the same active case intact. A valid browser-generated backup restored a separate case copy with the same fictional $166.40 credit discrepancy, resident note, reviewed fields, and manual-transcription provenance.
- Restored documents correctly reported missing original files. Reimporting a matching original PDF reattached one file with zero new documents and preserved reviewed facts.
- Previous-case recovery restored the original workspace with its retained Trash item.
- Saved case notes reappeared after reload. A transcript draft survived closing and reopening its editor and was then saved.
- A distinct 50-page PDF import was cancelled without adding the pending document.
- An earlier evidence packet download was checked for source anchors, quoted evidence, print-visible record fields, and a restrictive packet CSP.
- Responsive viewport checks covered 1440px desktop, 390px phones, and 360px phones. Dashboard, document table, navigation, field editor, findings, and source drawers were examined. The 360px page and source drawer had no horizontal overflow. Mobile controls include larger tap targets, 16px form inputs, inert closed navigation, wrapping actions, and packet download controls before the long preview.

## Verification boundaries

Backup export/restore, original reattachment, previous-case recovery, and multiple-tab conflict behavior have automated coverage. Browser backup restore, original reattachment, and previous-case recovery were also exercised as recorded above. A real two-tab editing conflict run has not yet been recorded for this release. Quota rollback and corrupted-storage preservation were exercised through transactional persistence tests. Native device, cross-browser, screen-reader, and live provider accuracy testing are not complete.

Browser viewport checks are not physical-device tests. No live OpenAI request was made; provider responses were mocked. Automatic OCR and cloud synchronization are absent. Local originals and case state do not migrate automatically between localhost and the deployed origin.

Backups intentionally omit original binary files, Trash, previous-case recovery copies, and unsaved field/transcript drafts. Permanently clearing local case data removes active and previous saved cases, while downloaded exports remain elsewhere on the device.

## Repository credential scan

A pattern scan of 38 intended source files (tracked plus nonignored additions) at the time of the scan found zero matches for private-key blocks, GitHub access tokens, OpenAI secret keys, AWS access-key identifiers, Slack tokens, or credential-bearing URLs. This count excludes files added after that scan and is not a complete secret-scanner certification. Runtime credentials and resident documents must never be committed.

## Live deployment verification

The audited build was deployed successfully on November 1, 2026 at https://metertrace-chicago-case-lab.peachyghat.chatgpt.site. The hosting service confirms public access. The live application was opened and exercised in the browser. Live layout checks at 360px, 768px and 1440px found no page-wide horizontal overflow; mobile search and packet download ordering worked. These are viewport checks, not physical device tests.

The non-browser anonymous HTTP probe was rejected by Cloudflare with code 1010; its response was not treated as an application failure or as a passed anonymous HTTP smoke test. The host’s public policy and normal browser application were independently verified. TLS certificate validation was not bypassed. AI credentials remain unconfigured.

GitHub repository publication and Pages deployment are not yet recorded as complete. The prepared source includes a combined verification/deployment workflow; no resident documents or browser case data are included. Live subpath PDF import and mobile checks at the new URL must be recorded after deployment. The Pages build uses static meta policies, not the Worker-only HTTP headers; AI extraction is unavailable. Moving between the old and new origins requires explicit backup export/restore and exact-original reattachment.
