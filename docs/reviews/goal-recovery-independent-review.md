# Independent bounded recovery security/privacy review

UTC initial review: 2026-10-08T06:08:33Z. Base commit: `b4740039990ca02b6a33ee395ba9e3906c190aba`, plus uncommitted recovery source. Node v24.18.0. Exact examined source/evidence hashes: `goal-recovery-independent-initial.sha256`.

Initial bounded result: **FAIL**. Production recovery/launch result: **FAIL / UNVERIFIED**. This report does not establish full release readiness.

## High: completed data deletion can be resurrected by an intermediate snapshot

Affected components: `packages/recovery/snapshot.ts` (`e.at >= s.created` filter), `app/api/[...path]/route.ts` (`await recordDeletion` before `db.batch`), and `scripts/recovery-store.mjs` (capture/restore).

The API writes an independent deletion receipt before purging local rows. A concurrent snapshot can capture the still-present rows after that receipt was recorded. The snapshot creation timestamp then exceeds the receipt timestamp. Even after the API purge completes, restore ignores the data receipt because its timestamp predates the snapshot. One synthetic deleted message was restored; expected count was zero. Account erasure is always honored and does not have this particular timestamp-filter bug.

Reproduce from repository root:

```sh
node --experimental-strip-types --test docs/reviews/goal-recovery-independent-probes.mjs
```

Original output is preserved in `goal-recovery-independent-initial.tap`: four tests, three passing, one failing; `restoredMessages: 1`. The probe faithfully exercises the permitted API ordering using actual snapshot/journal/restore functions and isolated SQLite files; it does not claim a live request race was exercised.

Proposed fix: couple deletion and snapshot state through a durable per-tenant data generation. Record the pre-purge generation in the external receipt, advance it atomically with successful purge, snapshot it transactionally, and erase snapshot data when its generation is at or before the receipt generation. Preserve newer data written after successful deletion. A blanket policy honoring all historical data receipts would avoid resurrection but also erase legitimate later data.

Retest: pending correction; original failure retained. Implementation owner has been informed.

## Passing bounded adversarial evidence

- The independent 20,001-message inventory was encrypted and restored with the exact row count, 0600 target permissions, and no provider interaction. Original measured snapshot/restore time was 465 ms and ciphertext length 3,917,790 characters. This small synthetic payload does not establish the maximum 250 MB envelope's memory or operational performance.
- A journal with 1,005 deletion receipts traversed multiple pages. Repeated pagination cursors, duplicate keys and missing listed objects were rejected. No truncated listing silently succeeded in these probes.
- Altering the authenticated IV rejected restore before a target existed. Invalid tenant settings removed the newly created target on failure. Existing recovery files and SQLite targets, including symlinks, were not overwritten.
- Existing `tests/recovery.test.mjs` passed all three tests: account/data tombstones after snapshot, credentials/consents/jobs excluded, restored mutation authority disabled, tenant connection epoch advanced, wrong key/purpose/namespace/version/tamper/stale/missing journal rejected, orphan rows rejected, source preserved. Output: `goal-recovery-independent-baseline.tap`.

Exact baseline command:

```sh
node --experimental-strip-types --test tests/recovery.test.mjs
```

## Boundaries and remaining gates

Read the repository review contract, security/privacy reviewer instructions, architecture, capability map, operations and disaster recovery/release checklist. No implementation files, shared builds, browser state, live services, credentials or provider configuration were changed by this reviewer. All fixtures were synthetic and isolated; temporary database files were removed.

The CLI operates on local SQLite files. Actual hosted D1 snapshot/restore, R2 binding/provisioning/durability/access controls/retention and authoritative external journal export transport are **UNVERIFIED**. Local authenticated envelopes do not prove completeness of a maliciously truncated trusted-store listing. Current journal freshness limits are not proof of an admission barrier covering deletions after export; the documented pause/isolation/replay procedure must be exercised before real recovery admission. These are operational trust boundaries and live gates, not passing claims.

Actual deployed gateway identity denial/cross-tenant access, scheduler/provider reconciliation, decryption against operational keys, RPO/RTO measurement, rollback/region/retention proof and named-owner signoff remain **UNVERIFIED**. No specialist gate is waived and only the release manager can decide the overall release result.

Historical evidence note (2026-10-15): the original probe was formatted only to satisfy repository Prettier requirements. The initial hashes and original failing TAP remain historical evidence. Its old signature reproducer belongs to the initial implementation; current generation-adapted probes and correction hashes/results are in goal-recovery-generation-retest-review.md.
