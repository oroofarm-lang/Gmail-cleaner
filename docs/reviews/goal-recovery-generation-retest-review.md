# Independent recovery generation correction review

UTC review: 2026-10-15T10:54:09Z. Base commit `b4740039990ca02b6a33ee395ba9e3906c190aba` plus uncommitted recovery changes. Node v24.18.0. Initial examined source/probe hashes are preserved in `goal-recovery-generation-retest-initial.sha256`.

Initial retest verdict: **FAIL**, due to the new medium finding below. Final corrected bounded verdict: **PASS** (2026-10-15; exact final hashes in `goal-recovery-generation-final.sha256`). The original high resurrection race is **PASS for the bounded correction tests**. Hosted recovery/launch remains **FAIL / UNVERIFIED**.

Read `docs/agent-system.md`, `agents/security-reviewer.md`, `agents/privacy-reviewer.md`, architecture, capability map, current recovery implementation, deletion route and prior finding evidence. This is a fresh independent review. No implementation files, services, browser, provider keys or build outputs were changed. Only review/probe evidence was created. Synthetic SQLite fixtures were temporary and removed.

## Original high finding: receipt before snapshot before purge — correction PASS

`validatedRecovery` now compares tenant data generations against deletion receipts rather than their wall-clock order. Actual API deletion records the pre-purge generation externally, and fences every child-table delete plus final tenant update with the expected generation and absence of current Gmail credentials. The batch advances the generation with the purge.

The adapted probe captures an actual SQLite snapshot after the receipt but before local purge, completes the purge and generation advance, collects the external journal and restores. Restored old-message count is zero. A second probe verifies post-purge generation data survives the older receipt and an account receipt remains terminal regardless of generation. Original failure evidence in `goal-recovery-independent-initial.tap` and its original probe were not changed.

Exact command:

```sh
node --experimental-strip-types --test docs/reviews/goal-recovery-generation-retest-probes.mjs
```

Result: **6/6 PASS**; `goal-recovery-generation-retest.tap`. Includes missing/uninitialized/wrong-key journal and failed durable-write rejection, 20,001-message inventory, 1,005-receipt pagination and malformed listing rejection, authenticated tamper and target file/symlink preservation.

## Medium: recovery does not advance the generation above all applied deletion receipts

Affected component: `scripts/recovery-store.mjs`, tenant restore assignment `row.data_epoch = Number(row.data_epoch) + 1`.

A g0 snapshot can be restored after successful data deletions at generations g0 and g1. Both receipts are applied, but the restored tenant generation is only g1. New data written after this recovery still uses g1. On a subsequent snapshot/recovery, the already-applied g1 receipt erases that legitimate new data. This is reproducible metadata loss across successive recoveries; it does not resurrect deleted data.

Exact command:

```sh
node --experimental-strip-types --test --test-name-pattern='restored generation must advance' docs/reviews/goal-recovery-generation-floor-probe.mjs
```

Initial result: **FAIL**; `goal-recovery-generation-floor-initial.tap`. `restoredGeneration: 1`, `restoredNewMessages: 0`; expected new-message count 1.

Proposed fix: compute each restored tenant generation above the maximum of its snapshot generation and every already-applied external deletion generation, and fail closed before target creation if that cannot be represented safely. Advancing only the snapshot generation is insufficient after multiple deletes. Correction retest: **PASS**. The implementation now carries a per-tenant maximum across snapshot and every receipt generation, rejects an unadvanceable relevant receipt before creating a target, and restores at maximum + 1. The exact original failing probe now yields `restoredGeneration: 2`, `restoredNewMessages: 1`. Initial failure remains preserved.

```sh
node --experimental-strip-types --test docs/reviews/goal-recovery-generation-floor-probe.mjs
node --experimental-strip-types --test docs/reviews/goal-recovery-generation-final-probes.mjs
```

Outputs: `goal-recovery-generation-floor-correction.tap` (**7/7 PASS**) and `goal-recovery-generation-final.tap` (**8/8 PASS**). The final suite additionally confirms a relevant MAX_SAFE_INTEGER receipt rejects before any target file is created.

## Actual API bounded evidence

```sh
node --experimental-strip-types --test tests/backend/integration.test.mjs
```

Result: **33/33 PASS**; `goal-recovery-api-independent.tap`. This executes the actual route and migration SQL against isolated SQLite through the D1 test shim, with synthetic gateway and provider adapters. Missing/outage journal produces 503 and retains rows/generation; Gmail reconnect during journal persistence produces 409 and retains rows/deleted state/generation; a competing generation produces 409 and preserves newly current data. It is not a deployed D1 proof. Repeated against the generation-floor correction: **33/33 PASS**, `goal-recovery-api-final.tap`.

## Unverified release boundaries

Actual hosted gateway denial and cross-tenant behavior, R2 journal binding, initialization/access controls/durability/retention, D1 export/import transport, operational keys and key custody, quiescence/admission covering journal collection and restore, provider reconciliation and full recovery drill remain **UNVERIFIED**. The five-minute journal timestamp check does not establish completeness or exclude deletion after journal export. A trusted store that omits objects is not detected by authenticated individual envelopes alone. The offline CLI and synthetic fixtures cannot waive these gates. This report does not certify the entire repository or authorize release; all specialist and release-manager requirements remain in force.
