# Operations diagnostics: independent bounded security/privacy review

Result: PASS for local bounded checks; deployed authentication gateway and external alert delivery UNVERIFIED (production launch gates remain failed/unverified). No release-readiness declaration.

UTC: 2026-10-16T05:03:17Z. Base commit: bd7f53b9ecc3430f36fdf8e1748854c24e91746d; reviewed uncommitted source, including final native Worker scheduled-failure change.

Read docs/agent-system.md, agents/security-reviewer.md, agents/privacy-reviewer.md, docs/architecture.md, docs/capability-map.md and relevant implementation/tests. Scope is operator diagnostics, API application exception events, scheduled exceptions and migration 0015; this is not a full security/privacy audit.

## Evidence

- `node --experimental-strip-types --test tests/operations.test.mjs tests/backend/integration.test.mjs`: PASS, 40/40. Authenticated operator exact identity enforced; absent configuration disables endpoint; unauthenticated 401, wrong identity 403, configured identity 200. Tenant identity comes from gateway-auth helper, not query/body. Production header stripping/authentication not exercised.
- `node --experimental-vm-modules --experimental-strip-types --test tests/security/backend.test.mjs`: PASS, 8/8.
- `node --experimental-strip-types docs/reviews/goal-operations-status-privacy-probe.mjs`: PASS. Independent null/future/exact-age completion checks fail closed for both jobs. Actual Worker scheduled method transpiled with mocked imports executes rejection branch: exactly one scheduled_failure event, fixed thrown message, no injected provider error content. No shared build or browser used.
- Source trace: status returns static issue codes, booleans, clock and capped aggregates, without tenant/message/action identifiers. All seven aggregate counts select at most 101 rows, expose max 100 plus capped flag. Status/lease, started and pre-existing expiry indexes support queries. Oldest admission selects one indexed row. No provider calls occur. Returned error incident is an independent random UUID; emitter accepts only three literal codes and serializes no error/request object.
- Health verifies schema cursor and retention table access; explicitly labels application-database scope and providerVerification not_assessed. It does not claim scheduler/provider readiness. Enabled scheduler/retention status rejects missing, stale or future completion data. Disabled jobs are explicitly marked disabled.
- Outer withAdmission covers health and diagnostics as well as other API routes: paused maintenance yields 503 before tenant/heartbeat writes. Status cannot bypass maintenance or release/drain tickets; includesStatusRequest makes its own ticket visible. API unexpected failures emit generic codes; expected ApiError and admission-paused messages remain fixed application errors.

## Findings

No actionable local findings in this bounded diff. Initial unused Worker emitter was corrected by the implementation owner; final native rejection probe PASS. No implementation edits made by reviewer.

Live limitations: deployed gateway identity/header boundary and external monitoring/alert sink UNVERIFIED. Reproduction: deploy privately, exercise unauthenticated/forged-auth-header/operator requests and inject one application/scheduled failure while observing configured sink. Proposed follow-up: retain actual gateway response evidence and sink receipt before claiming production verification; retest UNVERIFIED. Platform/framework logging outside these application branches was not assessed and is not claimed sanitized.

## SHA-256 source manifest

```text
16b04660a07a6bd15e4fca7edec89493d36b8d5f788cd85e9e084b9d87fef442 packages/operations/status.ts
609c8c01944290a6ac7ce6e49ae8a14912a28275495c7b5b9ae906b68e01bd9d packages/operations/telemetry.ts
2be3ac9a246d7114d7243172048097fc5866869565657fa44267d7feec335bb0 lib/operations.ts
2404f404f6d24ad68adb396f4de5a4e1a7706e2990540caddea9ac2f1872830f app/api/[...path]/route.ts
e60df9a92dd302120ac8fab701891bf06185b57f417e8d4d6105946248f72a6b build/sites-worker.ts
65c589e2014cd316cd1eaa66719314548b3b6b32bd456149d5c4dc5f75c4d2cb drizzle/0015_lovely_lucky_pierre.sql
b527eef6bc418a6d9e6c7a190ebb02bb0ad4851d2096e6fdd7537beed845a159 tests/operations.test.mjs
4599a81f9d0e5d3047dfb7d2cb2e235e5fdaf0ead84f3d12b0c98ca4d0152c56 tests/backend/integration.test.mjs
```
