# Independent safety checkpoint

Current result: **PASS** for the corrected bounded changes. Original checkpoint: **FAIL**, preserved below. This is not a production readiness judgment.

Reviewed at 2026-10-06T11:03:42.397357+00:00 (UTC), against Git baseline `f1754dd7974873d2f4873370c2bc99a6ea153271`.

Bounded diff SHA-256: `89476c1b7faf13c173064bfe4769eef45691eea7976f5253c2bc6c9bb1d4efed`.

Hash construction: concatenate `git diff --binary BASELINE --` for the ordered paths below, followed by `git diff --no-index --binary -- /dev/null PATH` for each untracked path in that same order; hash those bytes. Review/test reports are excluded.

Paths: `lib/gmail-server.ts`, `packages/integrations/gmail.ts`, `db/schema.ts`, `drizzle/meta/_journal.json`, `drizzle/0001_complete_weapon_omega.sql`, `drizzle/meta/0001_snapshot.json`.

Reviewed instructions: `docs/agent-system.md`, `agents/gmail-safety-reviewer.md`, `agents/security-reviewer.md`, `agents/privacy-reviewer.md`; context: `docs/architecture.md`, `docs/capability-map.md`. No other reviewer report was read or used. Implementation was not edited. No live mailbox/service was accessed.

## High, corrected: Undo accepted actions that never reached a mutation attempt

Component: `lib/gmail-server.ts`, execution catch and expanded Undo eligibility.

An exception during fresh safety reads, including `getThread`, changes a pending action to `uncertain` even though no trash/archive request occurred. The new Undo selection accepts every uncertain action. A later independent manual trash can therefore be undone by this application, contrary to the documented requirement that Undo restore actions actually moved by this app.

Exact reproduction: `node --experimental-strip-types --test docs/reviews/goal-safety-checkpoint.test.mjs`.

The final test creates a synthetic mailbox candidate and invokes the actual preview and execute routes. Its thread-read fixture throws before mutation; captured provider mutations remain empty. It then simulates a user manually trashing that message. Actual Undo returns HTTP 200 and untrashes/restores it; expected HTTP 409. Overall fresh adversarial suite: **4 PASS, 1 FAIL**.

Proposed fix: persist a separate terminal failed/pre-attempt state when execution fails before the durable `attempting` transition; restrict uncertain recovery to genuinely attempted mutations. Preserve recoverability for response loss after the mutation request. Retest the fresh test plus existing lost cleanup/Undo response tests. Fix retest: **UNVERIFIED**, no implementation changes made by this reviewer.

## Bounded passing evidence

- Own actual route test: expired owner, unchanged owner UUID, cannot insert new inventory; HTTP 409 and zero stored messages.
- Own actual route test: tenant tombstone during a provider read prevents inventory insertion.
- Own actual route test: missing messages, empty thread, or mismatched thread ID prevents cleanup.
- Own actual route test: archive Undo whose Inbox restoration succeeds but loses its response can be retried after inspection without duplicate provider mutation.
- Existing actual route/provider suites: `node --experimental-strip-types --test tests/backend/integration.test.mjs tests/integrations/providers.test.ts`: **34 PASS**, zero failures. This includes simultaneous first scans, account replacement during scanning, successor owner fencing, multi-message conversation protection, lost trash response recovery, lost untrash response recovery, and disabled mutation retries.
- Both actual-route harnesses apply the SQL migration chain to fresh in-memory SQLite. The new nullable owner column is present and the changed SQL executes successfully. Migration adds the column without destructive table rewriting.

## Concrete remaining risks and limits

- Process termination can leave action `restoring` or plan `executing` indefinitely; those locks have no expiry/reconciliation mechanism. This is a pre-existing recovery limit, and the new retry behavior only covers caught failures.
- New deterministic scan job identity does not adopt old random-ID jobs/cursors. An upgraded tenant may restart inventory from the beginning and retain an unused old job row; upserts prevent duplicate messages. No realistic populated upgrade/D1 migration execution was performed.
- Provider reads and mutations remain separate operations: a user may change thread state or labels after the last safety read. These tests establish fail-closed behavior for observed state, not atomicity with Gmail.
- Deployed D1 concurrency and transaction behavior, live OAuth, real Gmail label semantics, token revocation and disposable-mailbox trash/Undo are **UNVERIFIED**. Required live launch gates remain failed/unverified under repository instructions.

Source SHA-256 anchors:

| Path                                   | SHA-256                                                          |
| -------------------------------------- | ---------------------------------------------------------------- |
| lib/gmail-server.ts                    | 00df30d620168fb07bc0a3c3016b290459d5f7afa8015e182996cab6d0642393 |
| packages/integrations/gmail.ts         | a663562a55dec03df3ca384ae5db9959e00d5dfcdbdca88a4a61613b88f8a90b |
| db/schema.ts                           | 38f47a2da74a7e2e9ed6431efb3b36137eb7767422933a834e3c169073b00bd4 |
| drizzle/meta/_journal.json             | eec6c5835a6c54fe4fc148d5861deee860369e0f8724851653b2690b2ac3ea42 |
| drizzle/0001_complete_weapon_omega.sql | 5d3b63b2c21d722684f5a19cfce43dc3dc5f4d743ea08e2398aa5cb28a238433 |
| drizzle/meta/0001_snapshot.json        | 3a89e90394f0cb8e91399883b4b7b3aaec1dc72ff1de5096739a3f461d2a9f7c |

## Correction retest

Retested at 2026-10-06T11:04:41.969420+00:00 (UTC), against the same Git baseline `f1754dd7974873d2f4873370c2bc99a6ea153271`. Corrected bounded diff SHA-256, using the construction above: `3619d4749f96d24ffb6716c8ac8739b1fbc5b5f62085754e6bb3e47da7cbdc61`. Corrected `lib/gmail-server.ts` SHA-256: `48b0e9e4c4fa3ab944b1f968528d1ec84265b7b72daf10b57c6dc25ddbe92f66`. The earlier source/diff hashes remain preserved as the original failed checkpoint.

The root agent changed the execution catch to map only persisted `attempting` actions to `uncertain`; earlier failures become `failed`. Existing `success` and `skipped` statuses remain protected. The independent reproduction now receives HTTP 409 for Undo and preserves the later manual trash. The implementation was not edited by this reviewer.

Retest command: `node --experimental-strip-types --test docs/reviews/goal-safety-checkpoint.test.mjs tests/backend/integration.test.mjs tests/integrations/providers.test.ts`. Result: **40 PASS, 0 FAIL** (5 fresh independent route checks, 23 repository backend checks, 12 provider checks). Both cleanup response loss and Undo response loss remain recoverable. Finding fix retest: **PASS**.

Crash/reconciliation blocker remains separate from this bounded PASS: a killed Worker after durable `attempting`, `executing`, or `restoring` state can leave irreversible application locks or an ineligible recovery action. No restart reconciliation/lease recovery for those states was introduced or demonstrated. Live integration launch gates remain **UNVERIFIED**, and this review does not authorize production release.
