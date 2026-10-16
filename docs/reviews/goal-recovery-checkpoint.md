# Recovery checkpoint independent review

Result: **FAIL** for bounded stale-owner mutation safety. The crash-state transitions, tenant boundaries and export checks listed below passed locally. Live Gmail and deployed D1/Worker behavior are **UNVERIFIED**, and this report does not establish production readiness.

UTC checkpoint: 2026-10-06T11:11:07.212831+00:00. Baseline HEAD: `253a94a5753f5bf263a6157e9a435240c6762ebe`. Tracked scoped diff SHA-256: `8399f790ed5385e65861a35af559d7fac111d26c1f28e73e280ddea7f9aff74d`. Combined patch SHA-256: `5a410f3a91ecc0817fd5bf83cd4b62774e265219a926281ed39e122cf6c7bc79`. Route source SHA-256: `75e44a8f8c3f28ab9e38f073c3627e6f39d69d528a126c4baa92a70ec7974956`.

Hash definition: tracked binary diff from baseline over `app/api/[...path]/route.ts`, `app/page.tsx`, `db/schema.ts`, `drizzle/meta/_journal.json`, `lib/gmail-server.ts`, `tests/backend/integration.test.mjs`, followed by NUL + repository-relative path + NUL + bytes of each untracked `drizzle/0002_spotty_bucky.sql` and `drizzle/meta/0002_snapshot.json`, in that order. Reports and unrelated Obsidian artifacts are excluded. This records a mutable working-tree checkpoint; later edits require a retest and new hash.

Reviewed repository instructions: `docs/agent-system.md`, `agents/gmail-safety-reviewer.md`, `agents/security-reviewer.md`, `docs/architecture.md`, `docs/capability-map.md`. No implementation files were edited, no real mailbox/live service was accessed, and no shared browser artifacts were removed.

## High finding: stale cleanup dispatch can undo a confirmed restoration

Affected components: `lib/gmail-server.ts:509–526`, `lib/gmail-server.ts:670–679`, `packages/integrations/gmail.ts:119–125`.

Execution validates its owner before invoking `trashMessage`, but the Gmail adapter asynchronously obtains an access token before dispatch. That await can outlive the action lease. Reconciliation then releases the action and plan, and Undo can return `restored:true`. When the original credentials await resumes, it still dispatches Trash. Confirmation SQL correctly refuses to overwrite the successor, leaving the mailbox in Trash while the durable action stays `undone`. The UI consequently says “Restored.” and offers no Undo for that action. The fetch timeout is installed after token acquisition and cannot close this gap.

Exact local reproduction command:

```sh
node --experimental-strip-types --test /tmp/recovery-lease-route-review.mjs
```

Harness SHA-256: `69ea93ff7c4d46058968cf52e254f80bfb5a0b0cd3e7bd2dcaed602eabd19106`. Output: `/tmp/recovery-lease-route-review.log`. The harness copies the existing actual-route SQLite migration test setup, adds a pause after the credentials SELECT while the action is `attempting`, then uses a synthetic clock advance of 120001 ms. It calls the real `gmail/reconcile` and `gmail/undo` routes, waits for Undo success, and resumes the suspended cleanup. The Gmail boundary is synthetic; its token-await behavior matches the production adapter.

Observed output:

```json
{
  "reconcile": { "actions": 1, "plans": 1, "replayed": false },
  "undo": { "restored": true },
  "execute": {
    "status": 200,
    "data": { "total": 0, "skipped": 0, "failed": 1, "action": "trash" }
  },
  "labels": ["CATEGORY_PROMOTIONS", "TRASH"],
  "actionStatus": "undone",
  "calls": [["trash", "m1"]]
}
```

Proposed fix: fence provider mutations at dispatch after credentials resolution and before every retry, checking both current owner and unexpired lease, including Undo mutations. Add a regression that asserts zero stale provider calls after reconciliation and successor completion. Explicitly document remaining uncertainty for a provider request already sent when its response is lost or the worker dies; database ownership alone cannot fence an already accepted remote request. Retest: **FAIL**, defect reproduced at the recorded source checkpoint; no fix reviewed yet.

## Bounded checks and evidence

The reproduction harness ran 30 tests with zero runner failures, comprising all 28 existing backend tests plus two independent review checks. The race test intentionally asserts the unsafe observed state to prove the defect; runner success does **not** mean safety passed.

- **PASS** migration 0002 applies after 0000/0001 to in-memory SQLite; legacy rows receive nullable owner and lease default 0. Existing action/plan insertion paths continue to work.
- **PASS** expired interrupted execution becomes partial; attempting becomes uncertain; no provider call is sent by reconcile and the old plan cannot execute again.
- **PASS** expired restoration becomes restore_uncertain; only an explicit subsequent Undo invokes recovery.
- **PASS** a preflight pending crash becomes failed and cannot gain Undo authority.
- **PASS** active plan leases are not released; cross-tenant reconciliation does not release another tenant’s plan. Existing routes also reject cross-tenant action/plan access.
- **PASS** preflight owner replacement prevents mutation; owned completion SQL refuses successor overwrite in the reproduced token-await race.
- **PASS** lost cleanup/Undo responses remain explicitly recoverable without automatic Trash replay, within the existing bounded provider model.
- **PASS** independently inserted `secret-owner` and lease values are absent from plans/actions privacy exports; state activity projects explicit safe columns as inspected in `lib/server.ts`.
- **PASS** UI source labels attempting/restoring/pending/failed/uncertain/restore_uncertain without claiming mail moved; reconciliation text discloses zero provider mutations, and Undo remains explicit. **FAIL** the stale-dispatch race invalidates the resulting `undone` UI statement.

## Remaining limitations

This bounded review uses SQLite and synthetic Gmail at the actual API route boundary. It does not establish deployed D1 transaction scheduling, live OAuth/token refresh latency, real Gmail request cancellation/idempotency, provider completion ordering after a lost response, or browser runtime accessibility. No Playwright was run. Live mailbox and deployed unauthenticated/cross-tenant checks required by the specialist launch contracts remain **UNVERIFIED** and cannot be waived by these local results.
