# Initial Goal review: Gmail safety, OAuth and recovery

Date: 2026-10-06 (Asia/Jerusalem). Source reviewed: `f1754dd7974873d2f4873370c2bc99a6ea153271`. Scope: independent source inspection and synthetic execution of the actual route handlers with SQLite; no implementation edits, no live mailbox, no secrets, no provider calls. Instructions: `agents/gmail-safety-reviewer.md`, `agents/security-reviewer.md`, architecture, capability map, data map and security guidance. Other reviewer conclusions were not read.

**Result: FAIL for this component's release gate.** Existing bounded protection checks pass, but four additional adversarial scenarios reproduce defects and continuous scanning is not implemented. Live OAuth/Gmail mutation, provider refresh/revocation and deployed authentication remain **UNVERIFIED**. This is an initial review, not a final release review.

## Evidence actually executed

- `npm run test:gmail-safety`: 25/25 passed (12 core policy tests and 13 actual route/SQLite tests).
- `node --experimental-strip-types --test tests/integrations/providers.test.ts`: 11/11 passed with injected provider responses.
- `node --experimental-strip-types --test /tmp/inbox-goal-gmail-review.mjs`: 17/17 observation assertions passed, including all 13 existing route tests and four new defect reproductions. Passing these observation assertions means defects were reproduced; it does not mean these behaviors are safe.

The temporary review harness copies `tests/backend/integration.test.mjs`, rewrites its root and imports to absolute project paths, and adds the scenarios below. The injected Gmail implementation deliberately acts on synthetic in-memory messages. OAuth/crypto functions in the route harness are stubs; actual crypto/PKCE checks run separately in the provider tests. A mocked Gmail backend cannot establish real Gmail behavior.

Observed baseline strengths: no permanent-delete method; tenant-scoped reads/writes; CSRF guard in actual route tests; single-use tenant-bound OAuth state; encrypted token primitive resists tampering/substitution; preview expiry; refreshed per-message safety metadata/protected senders; SENT-thread protection; overlapping cleanup-plan serialization; successful per-message Undo; fail-closed account switch before provider mutation. These strengths do not waive findings below.

## Findings

### G1 — HIGH: received conversations can be trashed

Component: `lib/gmail-server.ts:456`–`465` (initial source). Thread protection tests only empty/mismatching threads and a `SENT` label. A thread with two received messages, neither carrying SENT, passes. Individual headers might identify some conversations, but are not sufficient when the current candidate omits References/In-Reply-To. The user explicitly requires protecting conversations and uncertain content.

Reproduction: use the existing `setupLive()` candidate, replace `gmail.getThread()` with `{id:'t1',messages:[{id:'m1',labelIds:['INBOX','CATEGORY_PROMOTIONS']},{id:'m2',labelIds:['INBOX']}]}`, then preview `A:m1` and execute the approved plan. Actual handler returns `{"total":1,"skipped":0,"failed":0,"action":"trash"}` and calls the trash adapter once.

Proposed fix: require a verified single-message thread matching the candidate ID for automatic cleanup, or another explicit conservative conversation policy that protects all conversational/unknown siblings. Apply this at preview and fresh execution. Add a regression expecting zero provider mutations for multiple received messages, protected siblings and malformed thread membership.

Retest: **FAIL** on reviewed source; independently reproduced, fix not applied by this reviewer.

### G2 — HIGH: in-flight scan persists old-account inventory after account replacement

Component: `lib/gmail-server.ts:299`–`331`, account replacement cleanup at `179`–`188`. `clientFor()` checks the pinned email before each provider call, but there is no connection-generation/fencing check before committing the result. A provider request already in flight can return after account replacement and insert old messages into the new account's tenant inventory. Disconnect/deletion can likewise race the commit. It is a data-integrity and privacy problem; matching Gmail IDs across account replacement can create misleading previews.

Reproduction: inject `getSafetyMessage()` that first copies the old synthetic message, updates `credentials.email` to `new@gmail.example`, deletes the old tenant's messages and Gmail jobs (the callback's replacement behavior), then returns the captured old message. Execute `gmail/scan`. It returns HTTP 200, reports one processed message, and the old message is again present in `messages` for the tenant even though the scan job was removed.

Proposed fix: persist a monotonic connection generation; bind scan jobs/inventory/actions/plans to it, and atomically verify current credential generation plus lease token before every scan batch commit. Replacement, disconnect and tenant deletion must invalidate it. Do not rely only on email equality; switching away and back to the same address must fence the older job too.

Retest: **FAIL** on reviewed source; independently reproduced, fix not applied by this reviewer.

### G3 — MEDIUM: concurrent first scans bypass the job lease

Component: `lib/gmail-server.ts:260`–`285`. Looking up a resumable job and inserting a new one are separate operations. Two requests can both observe no job, insert distinct jobs, and claim their own lease. There is no unique active-job constraint or tenant/connection lock. Later commit/release does not fence by lease owner; a job taking longer than 120 seconds can also be superseded and then overwrite the newer cursor.

Reproduction: use `setupLive()`, inject `listMessages()` with a barrier released on its second invocation, then `Promise.all([request('gmail/scan',{}),request('gmail/scan',{})])`. Both adapter calls execute and both return HTTP 200 with different job IDs. The reviewed harness observed two independent complete jobs.

Proposed fix: a unique per-tenant/connection scan state, atomic get-or-create/claim, unpredictable lease-owner token, compare-and-swap commit and explicit expiry/reclaim. Bound the invocation below lease duration or renew with fencing. Verify two simultaneous new scans produce exactly one provider scan, and a stale owner cannot update/release a renewed job.

Retest: **FAIL** on reviewed source; independently reproduced, fix not applied by this reviewer.

### G4 — HIGH: lost-response mutations cannot be reconciled or recovered through the product

Component: `lib/gmail-server.ts:473`–`519`, `522`–`578`; `packages/core/index.ts` has fake-only recovery behavior which is not used by this route. The durable ledger correctly records `attempting` before mutation, but a mutation that succeeds remotely and loses its response becomes `uncertain`. `gmail/undo` accepts only `success`; no reconcile endpoint exists. A process interruption can also leave a plan `executing` or an action `restoring` indefinitely, blocking unrelated tenant work. Documentation instructing manual operator reconciliation does not implement it.

Reproduction: inject `trashMessage(id)` that sets synthetic remote labels to `['CATEGORY_PROMOTIONS','TRASH']` then throws a lost-response error. Approved execution returns `total:0,failed:1`; ledger status is `uncertain`; provider message is in Trash. Calling `gmail/undo` with that action returns HTTP 409. The current UI's undo button is available only for success. The successful core test named "timeout after Gmail mutation is reconciled" concerns the in-memory service, not this live route implementation.

Proposed fix: implement explicit account-bound reconciliation of attempting/uncertain/restoring/restore_uncertain states without blindly replaying provider mutations. Track intended transitions and enough original/post-action state to avoid claiming unrelated external mutations as app-owned. Only confirmed or explicitly resolved app-owned actions become Undo candidates. When attribution is impossible, retain an honest manual-review state with a direct, clear Gmail recovery path; do not silently enable cleanup retries. Recover abandoned leases/plans with evidence rather than marking everything successful or rerunning it.

Retest: **FAIL** on reviewed source; independently reproduced, fix not applied by this reviewer.

### G5 — HIGH: continuous inventory synchronization and durable scheduling are absent

Component: `lib/gmail-server.ts:258`–`345`, `db/schema.ts` jobs history field, provider history/watch methods. The app routes never call `listHistory`, `iterateHistory`, `watch` or `stopWatch`, and no scheduled worker/queue processing exists in reviewed app/lib/config. Each HTTP scan processes one 25-message page, requiring additional manual calls. Completed scans restart a full listing and upsert rows without removing messages that disappeared, were externally trashed, or changed outside the product. The `history_id` column is unused.

Reproduction/source evidence: `rg -n 'historyId|history_id|iterateHistory|stopWatch|\.watch\(|scheduled\(|cron' app lib scripts wrangler*.json*` finds no implemented inventory history loop or scheduler. Provider unit tests validate request construction only. A completed inventory is stale until manual scans and still retains removed rows.

Proposed fix: implement bounded durable full-sync and incremental-history state transitions, only advance committed history after all pages apply, handle expired History IDs with a fenced full resync, represent deletions/label changes, and make scheduling an explicit host-supported, authenticated mechanism. Polling is acceptable if reliable and documented; Pub/Sub is optional unless chosen. No background cleanup without a specifically approved plan. Cover pagination loops, repeated/expired tokens, interruption, duplicate history events, missed-event fallback, disconnect and schedule disable.

Retest: **FAIL**: implementation missing; live scheduler **UNVERIFIED**.

### G6 — MEDIUM: lifecycle failure cases lack route-level evidence

Component: `lib/gmail-server.ts:55`–`83`, `packages/integrations/oauth.ts:97`–`149`. Refresh has encryption/CAS protection, but token endpoint errors are generic and there is no persisted reconnect-required state or invalidate/revoke classification. Route tests stub refresh/exchange/revocation and never expire test tokens; they therefore do not test actual refresh concurrency, invalid_grant, 401-after-apparently-valid-access-token, denied callback state consumption, or revoke failure. GmailClient retries 429/5xx for all methods; mutation retries occur without a fresh protection check between attempts.

Proposed fix: test and implement explicit reconnect-required behavior for revoked grants and provider 401; make refresh concurrency recover from a sibling's successful CAS where safe; distinguish genuine connection replacement; consume/cancel denied OAuth transactions; avoid automatic mutation retries unless each retry is freshly authorized and protected. Test these boundaries using injected HTTP responses before live verification.

Retest: **UNVERIFIED** for the unexercised lifecycle behavior, source-level gaps confirmed. Live provider lifecycle **UNVERIFIED**.

## Required owner evidence before this release gate can pass

Configure Google OAuth client/redirect and server token-encryption custody without disclosing secrets; supply explicit disposable mailbox/test scope approval; exercise OAuth, refresh, denial/revoke, account replacement, bounded scan/history, reversible Trash/Archive and Undo against that mailbox. Review deployed tenant authentication and supported scheduler configuration independently. No real mailbox access or actions were attempted in this review.

Priority: G1/G2/G4 block safe live operation; G3/G5 block reliable processing; G6 needs implementation and failure-boundary tests. All require fresh independent retests after fixes on the final commit. This report does not declare the project complete or ready for release.
