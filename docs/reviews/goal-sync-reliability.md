# Read-only Gmail synchronization reliability review

Result: **PASS, bounded corrected synthetic scope**. Initial source failed two reliability checks; both findings and independent correction evidence are preserved below. UTC: 2026-10-07T06:31:35Z. Base commit: `ee3b173fd62a0b363b6246ecb3b833551c9a92cc`, branch `codex/sticker-bomb`, uncommitted synchronization patch.

This is an independent review of newly implemented read-only synchronization, not certification of earlier dispatch/security corrections. Final specialist reviews for the entire product remain pending. Live Gmail/OAuth, deployed D1 transaction/runtime behavior, scheduling and production launch are **UNVERIFIED**. No live accounts, provider network calls, implementation edits or shared Playwright runs were used. Existing action tests passed locally but do not supersede a prior blocked review or certify destructive dispatch.

Read: docs/agent-system.md, agents/code-quality-reviewer.md, agents/gmail-safety-reviewer.md, docs/architecture.md, docs/capability-map.md, docs/goal-progress.md. Scope: sync engine, scan/client account binding, history page-size adapter, migrations0005/0006, tenant sweep cleanup and synthetic actual-route/adapter evidence.

## Initial findings — FAIL

1. **Medium — pagination cannot progress beyond1000 stored page tokens.** Initial `lib/gmail-sync.ts` hash `4d69a36e9f435de4e2a7cb7ac7bc65443b4bae060cc64c2f9c9574134be973f3` rejected a distinct valid next token whenever `cursor.seen.length >=1000`. Reproduction: create synthetic connected tenant; seed its job cursor with version1/full/baseline100/sweep, page token1000 and seen token1 through token1000; intercept list response with valid m1 and next token1001; POST gmail/scan. Actual502: “Gmail pagination did not advance. Restart synchronization.” Cursor remained token1000. Restarting repeats the prefix for sufficiently large mailboxes. Proposed fix: persistent per-run repeat detection with bounded cursor memory and no total-page cap. Correction retest **PASS**:1005 separate intercepted full pages completed, followed by history catch-up; a token repeated after40 pages was rejected even after leaving the last32 cursor window.

2. **Medium — final inventory prune performs quadratic sweep lookup.** Initial migration0005 hash `81d120cee8ea1e89d3f3fb3b8c1be9558a10353d5b06cce5c344544382c3b620` created only primary-key id for sync_seen; prune looked up tenant/gmail_id/generation instead. Reproduction: apply repository migrations to synthetic SQLite; insert15000 matched messages/sync_seen rows; EXPLAIN and execute `DELETE FROM messages WHERE tenant=? AND NOT EXISTS(SELECT 1 FROM sync_seen s WHERE s.tenant=messages.tenant AND s.gmail_id=messages.gmail_id AND s.generation=?)`. Initial query plan contained correlated `SCAN s`, runtime6971ms; isolated control index lowered it to5ms. Proposed fix: a migration and schema composite lookup index. Correction retest **PASS**: migration0006 produced covering `sync_seen_tenant_message` lookup and15000-row prune5ms. These timings are local evidence, not deployed D1 latency predictions.

## Correction validation

Commands, executed from repository root:

```sh
node --experimental-strip-types --test tests/backend/dispatch.test.mjs tests/backend/integration.test.mjs
node --experimental-strip-types --test --test-name-pattern='independent sync:' /tmp/sync-reliability-review.mjs
node --experimental-strip-types --test --test-name-pattern='independent sync: tenant delete' /tmp/sync-reliability-review.mjs
```

Repository suites:54/54 PASS. Independent temporary harness:7/7 PASS; added sync_pages tenant-deletion assertion retest1/1 PASS. The temporary harness derives route loading and intercepted-fetch fixtures from dispatch.test.mjs, adds independent cases, and resolves actual current repository source/migrations. It never invokes original remote fetch: “original” is the setupLive synthetic fetch implementation. SHA256 of final temporary script: `5d056a939184e788c5b5661e8df9138a5c231ab71cf6bb5f6d00d7d776479f96`.

Bounded invariants verified:

- Full work requests25 messages; history work fetches at most25 current metadata records per invocation and persists excess IDs. A31-ID history page followed by a second provider page kept history_id100 through both chunks, then committed112 only after the final page.
- Inventory/cursor/history commits share a SQLite transaction. Failed metadata reads preserved prior cursor/inventory. Vanished inventory was retained during an incomplete full sweep, pruned only after completion, then history caught up from pre-sweep profile baseline.
- History404 preserved inventory and reset to full sweep with a new profile baseline and null committed history checkpoint. Repeated tokens and backwards checkpoints failed without advancing committed history.
- Concurrent first scans issued one provider list request, one request returned409; successor ownership survived stale-owner failure. Final-batch cancellation and same-address credential generation replacement each returned409 without metadata/checkpoint commit.
- Account replacement during scan prevented old metadata insertion; clientFor pins expected email/generation and checks current credentials around token acquisition. No cross-account sync commit reproduced.
- sync_seen and sync_pages tenant deletion removed A and preserved B. Both tables appear in OAuth account-replacement cleanup. Full/history boundaries clear persistent token state; over1000 pages remain resumable and last32 cursor token window stays bounded.
- Intercepted sync adapter fixtures assert GET for every Gmail request. Sync calls profile, messages list, safety metadata and history only; no trash/archive/delete/modify/watch dispatch occurs.

## Corrected source hashes

| File                               | SHA256                                                           |
| ---------------------------------- | ---------------------------------------------------------------- |
| lib/gmail-sync.ts                  | f76af359ee6e15244971ce75cd966143c9e1c061fff69ae26dd85a5262ab37b2 |
| lib/gmail-server.ts                | 2b3b642ed01376abc2586052eed3f3ddb74270de13d27507743cbd8ff6001510 |
| packages/integrations/gmail.ts     | 24cca576524b2c5d91b175e1baf3e91e2c915b0fb0e91df722d6153f23914758 |
| drizzle/0005_wise_firebird.sql     | 81d120cee8ea1e89d3f3fb3b8c1be9558a10353d5b06cce5c344544382c3b620 |
| drizzle/0006_rainy_jack_power.sql  | 53eb6784f9cd3645bc2e9ccc780a4401e7044f23819d101d53eb7298c59bfc1b |
| app/api/[...path]/route.ts         | f96daf09cc9853cacb9ccd116390a83bc1ff98d0a02908d592a196f8c311c4b0 |
| db/schema.ts                       | 32b195b1d14f0f6ff376e6cbd0c81f7937bae4705322a17d90e73e1d11fde657 |
| tests/backend/dispatch.test.mjs    | 6c66160619924202cd6d6f4f7976d55ea3c58db4984fcb18ae1235400a9772d0 |
| tests/backend/integration.test.mjs | 80ecd503f6ea42f682fdfb5ff48f403c3581256ad62ac5532330109cac874d21 |

No outstanding reproduced defect in this bounded corrected scope. Production readiness remains unverified; only the release manager can declare release readiness after required specialist evidence.
