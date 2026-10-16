# Goal initial independent Chrome extension review

Date: 2026-10-06 (Asia/Jerusalem). Source: `f1754dd7974873d2f4873370c2bc99a6ea153271`. Reviewer: independent extension/security boundary agent. Scope: extension sources, build script, extension tests, gateway identity helper, API entrypoint and deployment/data/privacy documentation. No implementation edits, secret access, live mailbox requests or live service changes were made. Other reviewer conclusions were not used.

Outcome: **FAIL release gate; PASS existing bounded companion tests.** The package is honestly a dashboard launcher and does not yet satisfy the requested secure connected extension. No critical vulnerability was demonstrated by this bounded review.

## Evidence actually executed

- `git rev-parse HEAD`: source hash above.
- `node --test tests/extension.test.mjs`: 2 passed, 0 failed.
- `node scripts/build-extension.mjs`: successful local `dist/extension` output; no source changes.
- URL helper probes: both `https://attacker.example/` and `https://dashboard.example/nested/` are accepted. This is consistent with the current arbitrary-address launcher, but cannot establish a trusted backend for future credential pairing.
- Source inspection: MV3; only `sidePanel`/`storage`; local scripts; no content scripts, host permissions, external messaging or web-accessible resources; `connect-src 'none'`; explicit pairing-unavailable disclosure; HTTPS-only links with credentials/query/fragment rejected and `noopener noreferrer` present.

Live Chrome installation, side-panel lifecycle, actual extension fetch/authentication transport and Web Store acceptance were not exercised. Dashboard E2E tests do not cover extension pages or Chrome APIs. Two static tests do not establish storage failure handling, keyboard behavior, contrast or device revocation.

## Findings and acceptance conditions

### High: connected extension protocol absent — engineering gap

Affected: `apps/extension/*`, `lib/server.ts`, `app/api/[...path]/route.ts`, database schema. Reproduce: build/open panel; its only stored state is `dashboardUrl`; server capability `extensionPairing` is false and no pairing/device authorization routes exist. This is an explicit missing capability, not a covert credential leak.

Fix: implement a bounded read-only device protocol or authenticated same-origin relay after verifying the host transport described below. All cleanup preview, approval, execution and Undo remain in the authenticated dashboard. Retest: **UNVERIFIED**, implementation absent.

Acceptance: explicit pair consent and account identification; one-time short-lived exchange; replay/expiry/concurrent claim rejection; device listing and revocation; no cross-tenant state; removed account and changed Gmail connection revoke or invalidate state; no mutation capability through extension credentials; extension storage contains neither Google nor AI credentials; stale/error/offline states are clear.

### Medium: Forget button text is invisible — accessibility defect

Affected: `apps/extension/sidepanel.css`, `.quiet`. Reproduce: save a valid URL, observe Forget dashboard address without hover. Global `button` sets white text; `.quiet` sets transparent background without overriding color; body background is white. The source computes to white text on white (1:1 contrast). Existing static tests do not exercise styles.

Fix: explicit opaque/readable foreground and hover/focus contrast; exercise the rendered panel. Retest: **UNVERIFIED**, no product edit by reviewer.

Acceptance: normal, hover and keyboard focus states meet text contrast; button is discoverable and usable with Tab/Enter; screen reader announces storage outcome.

### Medium: deployment identity trust is unverified — hosting gate

Affected: `app/chatgpt-auth.ts`, `build/sites-worker.ts`, `lib/server.ts`. Source identity is obtained from `oai-authenticated-user-*` request headers. That is safe only when the production gateway authenticates the request, strips client-supplied versions and blocks every alternate direct Worker route. This review does not establish a deployed bypass; local mock auth cannot certify the production trust boundary.

Fix: verify host guarantees and fail closed for any unsupported deployment; do not replace gateway auth with a browser tenant parameter. Retest: **UNVERIFIED** pending authorized private hosting tests.

Acceptance: unauthenticated access fails, spoofed user headers fail, user A cannot read B, direct Worker/custom-domain paths cannot bypass authentication, account tombstone remains enforced. Verify whether extension-origin bearer requests ever reach the Worker before designing their authorization protocol.

### Low: old colored border survives Sticker Bomb migration

Affected: `apps/extension/sidepanel.css` input border `#828a73`. Fix: neutral grayscale border while preserving 3:1 input-boundary contrast. Retest: **UNVERIFIED**.

## Proposed pairing protocol and transport decision

This is a design proposal, not a implemented or verified integration. Keep dashboard mutations behind the existing exact-origin JSON `mutationGuard` and gateway tenant. Never relax that guard globally for extension traffic.

First verify the production host permits narrowly routed extension requests without giving arbitrary callers authenticated gateway headers. If the gateway authenticates every request before Worker dispatch, a bearer-only extension API may be impossible on that origin without a supported host feature. In that case use an explicitly opened authenticated dashboard with an origin-restricted external-messaging relay. The same-origin dashboard requests its own tenant state and passes only the approved aggregate projection to the known extension ID; relay approval/device state and CSRF controls remain server-side. No hidden cookie copying, Gmail scraping, fake identity headers or alternate unprotected public Worker are acceptable workarounds.

If a dedicated authenticated device endpoint is supported:

1. Package with an exact trusted deployment origin as optional host permission. Request it only from an explicit Pair button. Do not add `https://*/*` merely to support arbitrary custom URLs; new deployment origins require an explicit trusted packaging/configuration path. The current free-text URL can remain a launcher but must not receive device secrets without this trust decision.
2. Extension generates a random high-entropy polling secret, sends only its hash, and receives a random pending-device ID plus short-lived user code. Limits apply by IP/device and account; polling is bounded with backoff. Neither tenant selection nor extension ID from a caller confers identity.
3. Open the exact deployment approval page. Gateway authenticates owner; show account, device label, code and read-only data fields. POST approval uses same-origin CSRF protection and atomically binds the pending request to that tenant. A pending ID alone cannot approve or exchange credentials.
4. Extension claims once using its polling secret; verify expiry and atomically consume before returning a random scoped device bearer. Store only a cryptographic token hash server-side, never the raw token in URLs/logs. Use `credentials: 'omit'` and fixed allowed URLs for extension fetches, reject redirects to untrusted origins. Bind issued token to tenant/device/known extension origin and `read:summary`, with finite lifetime and rotation if needed.
5. A separate endpoint returns only approved aggregate counts, connection state, scan state and recent action counts. No subjects, sender addresses, raw action JSON, email bodies, OAuth credentials, AI inputs, rule writes or cleanup operations. Origin/CORS allowlisting is additional hardening; token authorization remains required regardless of headers.
6. Device revoke is immediate server-side. Forget removes local token and permission, informs owner if offline server revocation could not be confirmed and provides the dashboard revoke route. Account deletion clears devices; disconnect/account replacement invalidates old account state. Restrict storage access to trusted extension contexts; no Chrome sync storage for bearer tokens.

Browser contract tests must run panel JS with mocked Chrome storage/permission/transport boundaries and real DOM: invalid/valid URLs, permission refusal, network errors, pending expiry, approve/cancel, reload, state loading, unauthorized/revoked/expired response, server payload rendering via text content, keyboard, narrow viewport and axe. Server tests cover wrong tenant, code-secret confusion, claim replay/concurrency, rate limits, token scopes, expiry/revoke/deletion/account switch, CSRF approval and mutation denial. A live unpacked Chrome test then verifies actual service-worker restarts, permission prompts, CSP, host access, relay/fetch behavior and token persistence. Store submission/privacy/controller ownership and Google approvals remain separate external gates after technical tests.

## Primary references checked

- [Chrome cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests): extension fetch requires host permissions; paths do not narrow host permission scope.
- [Chrome permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions): optional grants are requested from a user gesture.
- [Chrome storage API](https://developer.chrome.com/docs/extensions/reference/api/storage): restrict local storage access levels and avoid syncing device secrets.

The release manager must retest against the final implementation and current commit. This initial review neither certifies a release nor adopts previous CI or browser outcomes as current evidence.
