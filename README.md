# Inbox Agent

A safety-first Gmail cleanup workspace. Original Sticker Bomb branding: clean monochrome working screens, dense original grayscale collage, sharp black labels and restrained blood-red accents.

**Release status: NOT READY for public real-mail release.** This is a private engineering preview with a complete persistent synthetic demo and tested integration code. Missing live-provider, continuous-worker, extension pairing and external approval evidence is recorded, never substituted with demo results.

## Run

Node 24 (required for the real SQLite test harness); npm is the installed package manager.

```sh
npm ci
npm run dev
```

Development applies versioned Drizzle migrations to the local D1 emulator, then serves `http://127.0.0.1:5173`. The starter's local Sign in uses the synthetic `seedy@sites.test` identity; it does not authenticate a Google account. Production identity is supplied by the private Sites gateway. Mock auth is development-only and strips forged identity headers.

Click **Explore a demo**. The server seeds 13 synthetic aggregate groups representing 24,000 messages. Choose **Deep clean → select groups → review → approve → Activity → Undo**. Demo unsubscribe is explicitly simulated. A separate per-message fake Gmail adapter drives destructive and crash tests. The browser never renders tens of thousands of message rows.

## What works

- Authenticated tenant-scoped D1 state, report, sender groups, protected mail, subscriptions.
- Persistent demo cleanup with atomic plan claim, revision validation, idempotency, activity and Undo.
- Conservative deterministic rules; approved sender protection; rules/preferences export and deletion controls.
- Gmail OAuth PKCE/single-use state, AES-GCM encrypted tokens, refresh with account-bound compare-and-swap, revocation.
- Resumable bounded Gmail inventory using body-free MIME/metadata projection, persistent page cursor and lease.
- Message-level Gmail plans, explicit approval, fresh thread/protection/MIME checks, tenant serialization, provider action ledger, conservative uncertain state and Undo.
- Optional OpenAI Responses intent/classification adapters with strict schemas, no tools, metadata minimization and deterministic policy authority.
- Minimal MV3 sidepanel dashboard companion with original icons and no mailbox credentials.
- Keyboard, accessibility, viewport and functional regression test definitions; independent adversarial source/runtime tests.

## Deliberate limits

- Real Gmail and OpenAI require owner-configured credentials and live verification. No real mailbox was used for testing.
- Unsubscribe destinations cannot be DNS-pinned safely in this runtime; live unsubscribe is manual-required. No URL is fetched automatically.
- Unattended Autopilot and Guardian require a verified scheduled worker and Pub/Sub integration; UI refuses to enable unsupported execution.
- The extension currently opens authenticated dashboard actions; API pairing and current-sender intelligence are not implemented.
- A worker crash between Gmail mutation and database confirmation yields `uncertain` or a stuck execution. The app does not blindly retry or promise recovery. Operational reconciliation needs completion before public launch.
- Sites/Vinext uses Vinext 1.0.1, a hosting-compatible Next.js implementation. Private deployment is owner-only; public customer ingress/authentication needs verification.
- Large sender lists expose the largest 100 groups; report totals are computed across the entire inventory. Live message inspector paginates in batches of 50.

## Validation

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:security
npm run test:gmail-safety
npm run test:integration
npm run test:performance
npm run build
npm run build:extension
npm run test:e2e
npm run test:a11y
npm run test:visual
npm run release:check -- --preview
```

Playwright CI installs Chromium with `npx playwright install --with-deps chromium`. E2E uses the local synthetic auth and its own persisted local test data. It never logs into Google or changes real messages. `release:check` without `--preview` intentionally fails while public release blockers remain. Review results must be regenerated after material changes.

## Configuration

Copy `.env.example` to an ignored `.env.local` for development only. In production use the Sites environment-variable secret manager. Never put Google secrets, encryption keys or OpenAI keys in client code or the extension. `TOKEN_ENCRYPTION_KEY` is base64url of 32 random bytes; retain it securely for token decryption and incident response. Rotate with a migration plan.

Google callback: `<site-origin>/api/oauth/callback`. Use Gmail `gmail.modify` because reversible cleanup requires it; the broad permanent-delete scope is never requested. Restricted-scope verification/security-assessment obligations require Google review. See [Google launch guide](docs/google-oauth-launch.md).

## Architecture and operations

React 19 + TypeScript App Router on Cloudflare Workers through Sites, D1/SQLite relational persistence, Drizzle migrations, reusable `packages/core` and `packages/integrations`, standalone MV3 extension. Generated migrations are immutable once deployed. No raw body storage, third-party tracking or training on customer mail.

See [architecture](docs/architecture.md), [capabilities](docs/capability-map.md), [data map](docs/data-map.md), [security](docs/security.md), [operations](docs/operations.md), [reviewer system](docs/agent-system.md), [legal drafts](docs/legal/README.md), and [release report](docs/release-report.md). `/legal/*` serves plain-language preview disclosures with launch gaps visible.

GitHub target authorized by owner: `oroofarm-lang/Gmail-cleaner`. Sites has a separate private managed source repository used for exact-commit deployments. Do not push to unrelated repositories.
