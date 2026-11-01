# Security and data boundaries

MeterTrace is a public website with local document processing and browser-local case storage. Publishing its source or website does not publish visitors’ documents. This repository contains fictional fixtures and application source; it must never contain resident cases, downloaded evidence packets, API keys, or extraction access tokens.

## Implemented controls

- Same-origin, self-hosted JavaScript, styles, and PDF worker. The static Pages artifact carries a supported meta Content Security Policy and no-referrer meta policy. The optional Worker additionally sets HTTP CSP with `frame-ancestors`, nosniff, and a Permissions-Policy disabling camera/microphone/geolocation. Those Worker-only headers are not claimed for GitHub Pages.
- Escaping of document names, notes, excerpts and field values in the UI and self-contained HTML packet. Exported packets disable scripts and network resources with their own CSP.
- Safe original-file MIME handling; original document content is not inserted as HTML in the application.
- IndexedDB storage scoped to the visitor’s current browser profile and site origin; no document upload during local import.
- Optional AI endpoint disabled unless both a provider secret and a 32–256-character access token are configured. A key alone cannot expose a paid anonymous endpoint.
- Cross-origin checks, mandatory token authentication, byte-bounded request/provider streams, strict payload validation, conservative output validation and supported-field projection.
- Exact source-page quotations for extracted records, manual-review status on AI results, and deterministic arithmetic independent of AI.
- Runtime secrets excluded from source and exports. Generic provider errors avoid leaking credentials or upstream response bodies.

## Limits

Browser-local storage is not encrypted by MeterTrace and may be cleared or evicted. GitHub project paths on `iamomer2707.github.io` share an origin: code hosted by another repository on that owner hostname can access same-origin browser storage. The app-specific database name prevents accidental collisions, not deliberate access. A dedicated custom domain provides a separate origin. Pages does not support arbitrary application HTTP security headers; a meta CSP cannot enforce `frame-ancestors`, so the Pages deployment does not claim frame-embedding protection. Anyone sharing the browser profile may access its saved case. Keep originals and backups; downloaded exports can contain sensitive account text. Deleting data here cannot recall copies shared elsewhere.

The GitHub Pages deployment is static, has no extraction API, and cannot enable AI by supplying a browser key. The optional Worker deployment ships without AI credentials. If its AI is enabled, visitors deliberately transmit selected page text to the configured provider. `store:false` is not zero-retention certification. Exact quotation validation cannot prove that an AI field was interpreted correctly.

The optional shared access token and per-isolate burst guard are appropriate only for controlled extraction access. They do not supply multi-user identity, distributed rate limits, a global spending cap, or tenant isolation for a hosted document database. Add an authenticated gateway and provider spending controls before offering broadly available paid AI.

Tests establish behavior for the documented scenarios; they are not a penetration-test certificate or a guarantee that no defect exists. No component certifies a bill, a legal claim, a refund, or an award outcome.

## Reporting an issue

Use the repository’s security advisory reporting feature when available. Do not put resident documents, account identifiers, tokens, or provider keys in a public issue. A minimal fictional reproduction, expected behavior, affected version, and relevant browser are usually sufficient.
