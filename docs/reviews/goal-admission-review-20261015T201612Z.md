# Bounded admission security review — PASS

UTC: 2026-10-15T20:16:12Z. Independent review of the uncommitted admission change against the source hashes below. Read docs/agent-system.md, agents/security-reviewer.md, docs/architecture.md and docs/capability-map.md. Scope is maintenance admission, API/scheduler drain, interrupted tickets and closed recovery; this is not a full security/release certification.

## Findings

No actionable defects found in this bounded scope. Severity: none. Components: packages/operations/admission.ts, actual API wrapper, scheduler wrapper, maintenance commands and recovery restore. Proposed fix: none. Retest: PASS locally.

Admission uses one conditional INSERT statement: pause and admission serialize at the SQLite write boundary. Already admitted requests retain their tickets across asynchronous work, while work whose INSERT runs after pause cannot enter. Maintenance uses BEGIN IMMEDIATE and an expected generation to prevent stale operators from resuming/pause transitions; it refuses resume while any ticket remains. There is no age-based ticket expiry. Failed ticket deletion propagates an error while retaining the ticket as a blocker.

The API GET/POST exports both pass through withAdmission before route handling. The actual backend test exercises paused API and scheduler entry and verifies no tenant or scheduler heartbeat writes. Scheduler invokes withAdmission around the entire tick and awaits Promise.allSettled for all concurrently mapped units before propagating a rejection, so an early rejected unit cannot release the tick ticket while a sibling is running. This scheduler sibling-error property was verified by source inspection; independent concurrent ticket lifecycle probes cover the helper, rather than a deployed scheduler event.

Restore initializes the target into recovery mode inside its restore transaction. The restored database has zero tickets but cannot use ordinary resume, and withAdmission rejects it. Existing tests exercise the encrypted snapshot/restore path.

## Exact reproduction and results

Run from repository root with Node v24.18.0:

```sh
node --experimental-strip-types --test tests/admission.test.mjs tests/backend/integration.test.mjs
node --experimental-strip-types --test docs/reviews/goal-admission-probes.mjs
```

First command: 36 passed, zero failed. Second command: three passed, zero failed. Independent probes exercise three simultaneous request/scheduler tickets, rejection of one while siblings remain active, admission delayed until after pause, database failure before admission and database failure during ticket release. Existing admission tests additionally exercise stale generations, synthetic crashed tickets and closed restore.

UNVERIFIED: deployed D1 consistency and runtime interruption behavior, live authenticated/cross-tenant network requests, provider services and production scheduler dispatch. These remain failed/unverified launch gates under the repository contract; bounded PASS does not waive them. No live services, builds or browser runs performed. No implementation changed.

## SHA-256 source identities

```text
656d893fbeee80d4e14b80e494ac37a99502242b79a100be138c1fe409731ffe  packages/operations/admission.ts
5fd9df4efa874d79313c9134a1e6c098fda4aaa4d8e500a81ca3539f668080f3  app/api/[...path]/route.ts
edef70f6069fa98b6b4717532bfbc340abd28b454362dab949d6d0d8c0b40adc  lib/gmail-scheduler.ts
f5b33650399d4433f36a20ba27aa7f7af2814cf69583627a12deb602d2eeb8ae  scripts/maintenance-store.mjs
1b400a8bc5a8771ea9d036c1096bb0bcb8e164da086a55d2933ee2ecfa9e511c  scripts/maintenance.mjs
c0fcdbf3d782df81956024ad4896203dd985371535360e3047ba9a2d8db7cf56  scripts/recovery-store.mjs
4248af50d958bfd7e838a4b34bc2565f51a1a9598a3539bf9d62e906f6d0266f  drizzle/0012_lying_union_jack.sql
a5b8a3c6c59a0c3cae808c3e4111564651e84f97aa7b8fab6c5768397906cc12  tests/admission.test.mjs
c31d3cce707461b61daafe41dbf7e2de656dd2e9787305e4b2d626f6bd8557cc  tests/backend/integration.test.mjs
919d3893ab09f404eb46b4d403a73c050d97adfa4aef023126ad02159bbb04b1  docs/reviews/goal-admission-probes.mjs
```

## Addendum: isolated E2E state and scheduler regression — bounded PASS

Independent source review found no actionable defect in playwright.config.ts, scripts/dev-inbox.mjs, vite.config.ts and tests/e2e/cleanup.mjs. Default Playwright configuration creates one fresh temporary state directory, inherits it into worker processes and passes it to the server via INBOX_LOCAL_STATE. Migration --persist-to and Cloudflare persistState.path use that same value. Installed Cloudflare Vite plugin source resolves the custom root with a v3 suffix, matching local Wrangler persistence. Existing server reuse is disabled; port conflicts fail instead of silently attaching to a previous server. Cleanup requires a matching inbox-e2e- basename directly under the system temp directory. Independent cleanup probes passed: owned directory deleted, foreign temporary directory retained, missing state no-op.

The new permanent scheduler regression was independently executed successfully. It exercises the actual runGmailScheduler implementation while one claim rejects and a sibling claim remains held; the admission ticket persists until the held sibling settles. This upgrades the sibling-error evidence described above from source inspection to an executed local backend test.

Exact additional commands:

```sh
node --experimental-strip-types --test --test-name-pattern='scheduler admission remains active' tests/backend/dispatch.test.mjs
node --test docs/reviews/goal-admission-e2e-cleanup-probe.mjs
```

Each command passed one test. No browser, shared build, server or live services executed. Actual complete E2E suite rerun remains outside this addendum; local fixture isolation wiring is source-reviewed and cleanup behavior is directly tested. No implementation edits made.

SHA-256:

```text
5a804b82d8268aaf01448b6f858fbcdb8192e4d16529f4a331bcc1c6003f2ba7  playwright.config.ts
ae93b84ccd267b6450bee0b5ee893d6d9c912f27afbf921bf7ab8ad596be406e  scripts/dev-inbox.mjs
512a7df5f9e0d2babb70a14f26b2733b98fb03ad6f499c41bad8fc95605338ef  vite.config.ts
893d2e17185f5735bc1d4981c88629dc2f572810c73612a5ebe1b3af1c49e5f4  tests/e2e/cleanup.mjs
7b3cf57601b33c0e8d357b6048521ff5da4e4f9576237c53c6012a926590b939  tests/backend/dispatch.test.mjs
```
