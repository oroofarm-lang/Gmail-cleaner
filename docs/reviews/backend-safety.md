# Independent backend safety review

Result: FAIL pending correction of concurrent Gmail operation ownership and Undo credential preflight.

Reviewed actual `lib/server.ts`, `lib/gmail-server.ts`, `app/api/[...path]/route.ts`, `db/schema.ts`, and generated SQLite migration. The independent test harness loads the actual TypeScript handlers through Node module hooks, applies the actual Drizzle migration to Node SQLite DatabaseSync, and provides a D1 statement/batch shim. D1 batches run inside SQLite transactions. Authentication identity and Cloudflare bindings are mocked. Gmail transport is mocked, while its access-token callback is invoked before each request to exercise actual credential lookup and account pinning.

Executed `node --test tests/backend/integration.test.mjs`: 11 tests, 9 passed, 2 failed at initial review. This differs from isolated domain unit testing: actual route claims, SQL, action ledger transitions, tenant predicates, and cleanup/Undo handlers execute.

## Findings

- HIGH, Gmail execution: distinct pending plans for one tenant can both claim execution and trash the same message after concurrent snapshot reads. Reproduction: approve two plans for `A:m1`, synchronize both thread reads, execute both; two Gmail trash calls occur. Proposed fix: serialize tenant Gmail operations with an atomic database-backed claim; reject another executing plan and serialize Undo too. Retest: initial reproduction FAIL.
- MEDIUM, Gmail Undo: after credential deletion, Undo claims the action as `restoring` before `clientFor()` rejects absent credentials outside the recovery try block. Reproduction: execute one plan, remove credentials, invoke Undo; HTTP 409 with ledger permanently `restoring`. Proposed fix: obtain a usable client before claiming the action, and guarantee claim rollback or uncertainty marking for later errors. Retest: initial reproduction FAIL.
- HIGH, account replacement (reported during review): old mailbox inventory, plans and activity must be bound to Gmail account identity or invalidated when reconnecting a different account. Client account pinning now stops an account switch during execution; test PASS. OAuth callback replacement invalidation and external provider behavior require separate verification.
- MEDIUM, interrupted Gmail jobs/plans: workers do not recover ambiguous action outcomes automatically. A crash with an executing plan or a partial/uncertain ledger requires documented manual recovery. Metadata inventories also have no incremental history/deletion reconciliation. Do not claim continuous production worker or full chaos resilience.

## Verified controls

Demo cleanup revalidates protected flags and revision inside the same transaction as group mutation and ledger insertion; a stale plan mutates nothing. Duplicate demo execution and Undo alter revisions only once. Tenant A plans, groups, rules, actions and message inventory are unavailable to tenant B through actual handlers. Strict schemas reject a forged tenant field. Missing authentication identity, cross-origin mutation and non-JSON POST requests are denied. Production Gmail handlers reload sender protections, protect sent-thread replies and newly starred mail, compare current metadata with preview metadata, suppress completed-plan duplicates, and restore Inbox membership through Undo.

## Limits

These tests do not verify the production authentication proxy strips forged identity headers; OAuth token encryption/HTTP behavior; live Gmail quotas or side effects; production D1 concurrency under multiple isolates; durable worker scheduling; or actual Google approval. The mocked Gmail transport cannot certify real Gmail safety. Metadata classifications remain heuristics, and Gmail cannot atomically condition a mutation on its previously read metadata. Public release remains blocked by failed tests and broader unfinished product requirements. Only Release Manager may declare readiness.

## Primary retest after fixes — 2026-10-06

13/13 actual-handler tests PASS. Pending Gmail plan claim now excludes another executing plan or restoring action for the tenant; Undo also excludes concurrent execution/restoration and obtains credentials before claiming. Account changes invalidate old inventory/plans/actions/jobs, and token access pins the account email. Metadata snapshots compare exactly; malformed/empty thread evidence fails closed. Fixture responses were corrected to include a real nonempty thread message list; assertions were not weakened.

Fixed initial HIGH concurrent-execution and MEDIUM Undo-preflight findings: RETEST PASS. OAuth state replay/account replacement and owned account deletion tests also PASS. Wider runtime/provider/worker limitations remain FAIL for public real-mail readiness.
