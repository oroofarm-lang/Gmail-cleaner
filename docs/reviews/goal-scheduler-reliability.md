# Independent bounded scheduler reliability review

Result: **FAIL** for the reviewed implementation: two medium reliability findings. Tenant isolation/read-only/consent checks exercised locally PASS. This report does not certify the full product or waive other specialist gates.

UTC: 2026-10-07T06:44:00Z. Base HEAD: `1865ffb6bdb796e25e4241e0d7849ce91a31a727`; reviewed uncommitted implementation. Source-set SHA256: `8579412425a84775b7a6abcea5497c18924c87bf04d3440943651bef90fb61af`. Hash construction: concatenate each path, NUL, file bytes, NUL in this order: `lib/gmail-scheduler.ts`, `lib/gmail-server.ts`, `lib/gmail-sync.ts`, `lib/server.ts`, `packages/integrations/gmail.ts`, `build/sites-worker.ts`, `app/api/[...path]/route.ts`, `app/page.tsx`, `vite.config.ts`, `db/schema.ts`, `drizzle/0007_messy_dark_phoenix.sql`, `.env.example`. Scheduler file SHA256: `277e4b6aa9cb8d0be470c150f497bf0c901a9f66a13ff12a99e96b0caf185b2f`.

Instructions read independently: `docs/agent-system.md`, `docs/architecture.md`, `docs/capability-map.md`, and Gmail safety, code quality, performance, privacy reviewer instructions. Scope is scheduler implementation, its direct read/sync guards, lifecycle/config/state/export/UI/migration boundaries. No implementation edits, provider credentials, mailbox, external network, build or shared browser were used. Existing intercepted tests use synthetic token/crypto replacements, so they do not establish real token refresh behavior.

## Evidence

From repository root:

```sh
node --experimental-strip-types --test --test-name-pattern='scheduler:' tests/backend/dispatch.test.mjs
```

PASS: 10/10 tests. These cover opt-in/readiness and interval validation; five-message full/history work units; overlapping ticks; pause during in-flight read; transient failure backoff and five-failure suspension; successor-owner exclusion; disconnect; provider401 redaction; stale heartbeat; authenticated tenant identity and rejection of a browser tenant field. D1 tests load SQL migrations into isolated in-memory SQLite. Provider calls are intercepted, and sync fixture asserts GET methods.

Additional independent intercepted adversarial tests copied the harness to `/private/tmp/independent-scheduler-review.mjs`, changed its root to the absolute repository path and TypeScript import to the installed absolute module, then appended the tests below. They can be recreated by `/private/tmp/create-independent-scheduler-review.mjs` during this session. The following command FAILS both expectations:

```sh
node --experimental-strip-types --test --test-name-pattern='independent review:' /private/tmp/independent-scheduler-review.mjs
```

## Finding 1 — Medium: temporary Gmail quota403 permanently disables consent

Component: `lib/gmail-scheduler.ts` `failureCode` and `packages/integrations/gmail.ts` request/error contract.

Reproduction in intercepted scheduler fixture:

```js
const { control } = await schedulerFixture();
control.list = async () =>
  Response.json(
    { error: { errors: [{ reason: "userRateLimitExceeded" }] } },
    { status: 403 },
  );
await runGmailScheduler();
const row = sqlite
  .prepare("SELECT enabled,status,last_error FROM sync_schedules")
  .get();
assert.equal(row.enabled, 1);
assert.equal(row.status, "backoff");
```

Observed: `{"enabled":0,"status":"reauth_required","last_error":"reauth_required"}`. The adapter recognizes quota reasons but drops that classification when throwing `GmailApiError`; scheduler deliberately sets `maxRetries:0`, and all status403 errors become reauthentication failures. A temporary provider quota thus instructs the user to reconnect and stops unattended work.

Proposed fix: expose a bounded/redacted quota classification from the adapter and treat quota403 as transient backoff; retain suspension for actual authorization failures. Do not persist provider response text. Add quota and authorization403 cases.

Retest: **FAIL** on reviewed source; fix retest pending.

## Finding 2 — Medium: healthy manual scan contention counts toward auto-pause

Component: `lib/gmail-scheduler.ts` catch/failure counter; `lib/gmail-sync.ts` job claim.

Reproduction after `schedulerFixture()`:

```js
sqlite
  .prepare(
    "INSERT INTO jobs(id,tenant,source,cursor,processed,status,updated,lease,owner) VALUES('A:gmail:scan','A','gmail',NULL,0,'running',?,?, 'manual-owner')",
  )
  .run(Date.now(), Date.now() + 120000);
await runGmailScheduler();
const row = sqlite
  .prepare("SELECT enabled,status,failures,last_error FROM sync_schedules")
  .get();
assert.equal(row.failures, 0);
```

Observed: `{"enabled":1,"status":"backoff","failures":1,"last_error":"connection_or_ownership_changed"}` with no sync provider dispatch. `syncGmailPage` correctly denies a concurrent valid job lease, but scheduler counts it as a provider failure. Repeated valid manual-owner overlaps can exhaust the same five-failure budget and pause background consent even though the connection/provider are healthy.

Proposed fix: return a typed busy outcome or separately identify the valid existing job lease, defer the schedule without increasing provider failures, and continue enforcing generation/tenant/deleted fences. Add repeated busy-owner tests and verify genuine failures still suspend at five.

Retest: **FAIL** on reviewed source; fix retest pending.

## Other bounded observations and unverified boundaries

PASS by inspection: native scheduled entry point calls only `runGmailScheduler`, which does not import cleanup rule execution; no HTTP scheduler trigger was added. Due selection caps at three tenants; claims/renewals fence tenant, live credential generation, source and tombstone. Sync page writes preserve credential generation and job owner fences. Pause/disconnect/reconnect clear schedule ownership and consent. State/export project only interval/status/timing/fixed error/count, excluding token, generation and owner. UI explicitly asks to enable read-only scans, separates cleanup approval and explains in-flight read on pause. Operator/build opt-ins default off. Schedule enable route applies same-origin JSON mutation guard and strict schema. No AI adapter is called by scheduled sync.

Schema/index and worker handler are inspected, but runtime Cron registration, native Workers event lifetime/env binding, real D1 latency/limits, deployment, Google OAuth/token refresh, real mailbox reads, rate limits and large-dataset/deployed performance remain **UNVERIFIED**. No full lint/typecheck/build/release review was attempted in this bounded assignment. Required live-host/provider launch gates remain failed until exercised with disposable evidence by the appropriate reviewer/operator.

## Independent correction retest — 2026-10-07T11:33:18Z

Current bounded result: **PASS** for the two findings and previously exercised scheduler checks. The initial FAIL and reproduction evidence above are retained as historical evidence. Production/live-host/provider gates remain **UNVERIFIED**; this retest does not certify the product or waive any other review gate.

Corrected source-set SHA256, using the same ordered paths/hash construction above: `cd9f7fc5da087a3d7990f373a6f1f2a95d8043eea0fb3265a0c8d8d30d8bc7d6`. Changed component hashes:

- `lib/gmail-scheduler.ts`: `155abb7130690376133bbd9599986a2f7da131c33c876555024890bde828646c`
- `lib/gmail-sync.ts`: `66dc351a1098f88ae4a0e385a472c98600f56b204222744001d36da004dc09b3`
- `packages/integrations/gmail.ts`: `db095ab15c98c221817bad63020b50204ce1f9a533dafa3075688752764e2312`
- Permanent regression harness `tests/backend/dispatch.test.mjs`: `e896111f35a055950f918258ca59981be87222b3be384ac11303816589e8ce9e`

Independent source inspection confirms `GmailApiError` now preserves a boolean retryable classification for GET quota403/429/5xx; scheduler maps retryable403 to fixed transient error/backoff. Provider response text is not retained. `GmailScanBusy` is returned only after querying a running, unexpired job lease with current tenant, matching credential email/generation and live tenant. Scheduler defers this outcome for 60 seconds with unchanged consent/failure count and owner/enabled/live-lease fences; it does not count it in failed totals. Existing true failure handling still suspends at five.

Commands independently rerun from repository root:

```sh
node --experimental-strip-types --test --test-name-pattern='scheduler:' tests/backend/dispatch.test.mjs
node --experimental-strip-types --test --test-name-pattern='independent review:' /private/tmp/independent-scheduler-review.mjs
```

Results: permanent cases **12/12 PASS**; independent cases **3/3 PASS**. The permanent contention case exercises six overlaps with a pre-existing failure count of two and verifies consent/failure budget remain unchanged, with no list/history dispatch. The independently retained original failing tests now observe quota403 `{enabled:1,status:'backoff',last_error:'sync_unavailable'}` and manual contention `{enabled:1,status:'waiting',failures:0,last_error:null}`. An additional independent test cycles all three allowlisted403 reasons (`rateLimitExceeded`, `userRateLimitExceeded`, `quotaExceeded`) and verifies scheduling remains enabled; an `insufficientPermissions`403 still produces `reauth_required`.

The extra allowlist test initially had an isolated harness setup error (duplicate credential insertion from calling the same fixture repeatedly inside one test). Reusing its single isolated fixture and resetting schedule consent corrected the harness; the final 3/3 result above is from the corrected test. No implementation edit, real provider call, build, browser or credentials were used in this retest.
