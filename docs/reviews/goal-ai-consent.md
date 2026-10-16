# Independent AI consent and privacy review

**Bounded result: PASS. Production AI sharing launch gate: FAIL / UNVERIFIED.**

Reviewed independently under `docs/agent-system.md`, `agents/ai-red-team-reviewer.md` and `agents/privacy-reviewer.md`, with architecture, capability/data maps and draft privacy/retention/processor documents read. Base HEAD: `efe20bfafa84fd6128c2c65814e34cee930e0b5f`. Scope is the current uncommitted AI consent implementation; no implementation edits were made. Review support files are synthetic test evidence only.

UTC: 2026-10-07T11:56:34.321144+00:00

## Findings and evidence

No actionable source defect reproduced in the bounded AI consent/privacy checks. PASS does not certify live model behavior, deployed D1 concurrency, provider retention, terms, or backup restoration.

1. **PASS — consent and transfer boundary.** Operator `AI_PROCESSING=enabled`, configured model/key, current version/model, matching tenant, enabled purpose and Smart Mode are required. Command-only consent cannot share mail metadata. Schema requires approval for each selected message; cross-origin and forged tenant requests cannot grant consent. Adapter authorization runs immediately before fixed-origin Responses fetch, with redirects rejected and no model tools. Metadata projection excludes snippet/body/attachments/account address/custom labels and minimizes sender to domain; subject is capped and email/HTTP URL/long numeric patterns redacted. This is partial redaction, not anonymization; UI explicitly discloses residual personal information.
2. **PASS — revocation and races.** Pre-dispatch revocation emits no request. Revocation during a synthetic dispatched response rejects advice and stops subsequent requests. Re-grant gives a fresh epoch and does not resurrect pending advice. Model change during dispatch rejects returned advice. Reconnect/disconnect invalidate metadata consent. Privacy Mode and model changes prevent subsequent sharing. A request already dispatched cannot be recalled, as disclosed in UI. The database-read-to-fetch boundary is a bounded authorization check, not an atomic transaction with the provider.
3. **PASS — AI has no Gmail authority.** Typed invalid/extra/unknown output, refusal, incomplete output, malformed JSON, excessive output and synthetic timeout fail closed. Injection in huge sender/subject/snippet is confined to minimized data and never causes a second destination or Gmail call. Confident trash advice is downgraded by fresh deterministic protections. A syntactically valid dangerous cleanup proposal returns an unapproved rule without creating a rule/action or issuing Gmail mutation. AI advice does not persist to policy or Gmail execution.
4. **PASS — tenant and persistence.** A second tenant with its own metadata consent still gets 404 for the first tenant's selected message and emits no provider request. Secret marker and model advice were absent from inspected tenants/consents/rules/actions/jobs tables. Consent exports omit epoch, credentials excluded in paginated privacy export, and account deletion removes consent and blocks sharing. API failure captures contain event/type only. UI source contains distinct Settings consent, per-message confirmation and revoke controls; browser interaction was not exercised in this bounded review.

## Required unresolved launch findings

- **High — real OpenAI integration and processor approval (UNVERIFIED, launch gate FAIL).** Components: deployed adapter/config, `docs/privacy.md`, `docs/subprocessors.md`. Repro: no real credential, real provider request or executed DPA/region/retention evidence was provided or permitted for this review. A synthetic intercepted successful response cannot establish actual strict-output behavior or retention. Fix: complete operator review of actual provider terms, permitted Google data use, processor identity/regions/subprocessors and retention; then separately authorize a disposable-mailbox test with explicit user consent. Retest: **UNVERIFIED**. Keep real metadata sharing disabled until complete; `store:false` alone is not zero retention proof.
- **High — production lifecycle and backup restore (UNVERIFIED, launch gate FAIL).** Components: deployed D1/runtime, backups/retention and tombstone restoration. Repro: execute the disposable-account scan/export/revoke/delete/backup-restore procedure specified in `docs/retention.md`; no backup system or production restore was exercised here. Fix: document actual stores/TTL and implement/validate deletion plus restored tombstone enforcement. Retest: **UNVERIFIED**. Local SQLite deletion/export checks do not waive this gate.

## Exact reproduction

Run from repository root, with Node satisfying package engines. No provider credentials are needed; all relevant provider boundaries use synthetic fixtures/intercepted fetches.

```sh
node --experimental-strip-types --test --test-name-pattern='AI:' tests/backend/dispatch.test.mjs
node --experimental-strip-types --test --test-name-pattern='AI ' tests/integrations/providers.test.ts
node docs/reviews/goal-ai-consent-run.mjs
node --experimental-strip-types --test --test-name-pattern='privacy export' tests/backend/integration.test.mjs
```

Retest results: **10/10**, **2/2**, **6/6**, **1/1**, all PASS. The independent runner creates a temporary copy of the current route fixture, appends six review-only cases, runs only those cases, and removes its temporary directory. No build, shared browser/Playwright run, live request or real credential was used. During test development the schema-error assertion originally expected 503; actual strict Zod validation returns 400. Assertion was corrected to accept either safe error status and all six cases reran successfully; this was a review assertion mismatch, not a product defect.

## Reviewed SHA-256 source snapshot

```
f4fedef8bcbca1979f9fb12c7c353806a3fd1960a101ee3054254e77683b08c9  lib/ai-consent.ts
4ce2006a63e8c61661313b101f08e1a4fd376e72c6a6347a3a887938a972d021  packages/integrations/ai.ts
aabbbbf29e1e8064dcc357977329ecaa38913a9cf0952195577d3939f24fc32b  packages/integrations/assistant.ts
458b8993864835f70e51095ea268831cee1d2abc7e897aa814b88c72ac5e1978  app/api/[...path]/route.ts
1c360bef307ef17213afd2da753b1a835ac058903215b3d704ea13a4229e9494  app/page.tsx
a64af9d7b97c713c73744a58ce285289b0d8bd364c5997921f49bd6775fb7a12  lib/gmail-server.ts
665ce8ba0362c77cebe68475e720c11d9ef1448d7b5139316fe7e3eb099ec104  lib/server.ts
d0ef18b69c74e3752e69d12917f97af0500703771069293991ca9e9f02312d87  drizzle/0009_familiar_enchantress.sql
d428021ae4a062964a9616eefa3b5edc823850db835b3f2f45ebe6160e879130  tests/backend/dispatch.test.mjs
723b9e17a278ee703bf356637ba2259ccff603e20059adee50df5390e048877a  docs/reviews/goal-ai-consent-cases.mjs
ff417bf4b3478c676ab68156e23f9074f7d3dc836970cd1d37c1ac30f9abf814  docs/reviews/goal-ai-consent-run.mjs
```
