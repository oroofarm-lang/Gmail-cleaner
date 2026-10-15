# Retention privacy review

Result: **PASS for bounded local checks**. Production/provider/host boundaries: **UNVERIFIED; launch gate fails until exercised**. This is not release certification.

UTC: 2026-10-15T20:25:29.580561+00:00

Scope: independent inspection of uncommitted retention source/migration, admission integration and focused synthetic SQLite tests. Read repository review contract, privacy-reviewer instructions, architecture and capability map. No provider calls, shared build or browser work.

## Evidence

- `node --experimental-strip-types --test tests/retention.test.mjs`: PASS, 2 tests. Three tables delete at most 100 rows each per invocation; repeated runs drain 205 fixtures and then return zero. Action-backed plans preserve success, undone, attempting, restoring and both uncertainty states. Credentials and crashed drain ticket remain. Injected missing table rolls back the local transactional batch; renewed device survives.
- `node --experimental-strip-types --test --test-name-pattern='retention requires operator' tests/backend/integration.test.mjs`: PASS, 1 test. Absent operator flag returns disabled without health writes; exact enabled flag runs; paused admission denies purge.
- `node --experimental-strip-types docs/reviews/goal-retention-privacy-probe.mjs`: PASS. Exact expiry/lease boundary is eligible; fresh, executing, partial and leased plans survive. Invalid negative/fractional/infinite/unsafe clocks reject. Query planner uses plans_expiry and covering actions_plan; it also needs a temporary B-tree for the id ordering suffix.
- Static trace: purge targets only oauth_transactions, plans and extension_devices. Plan selection excludes every action-linked plan, including unknown future action statuses. It never targets actions, credentials, metadata, consent, active_operations or tombstones. Atomic statements re-evaluate stored expiry; no stale read-then-delete selection. Concurrent batches serialize under SQLite/D1 transaction assumptions; deletion is idempotent. Maintenance insertion and durable release are delegated to existing withAdmission. Health records contain timestamps/status only; catch text excludes provider/mail content.

## Findings / limits

1. **Low — operational boundedness**, packages/operations/retention.ts / plans_expiry. LIMIT bounds deletion count, not scan work. An arbitrary backlog of old executing/action-backed plans can be examined repeatedly before 100 eligible rows are found; equal-expiry rows require a temporary ordering tree. Reproduction: run the probe and inspect EXPLAIN output; populate many old ineligible plans to observe growing work. Proposed follow-up: document this limit and, if bounded SQL work is a requirement, use a persistent candidate cursor/window with a suitable composite index; retain atomic eligibility rechecks. Retest: **UNVERIFIED** for backlog-scale/native D1 resource limits. No observed evidence loss.
2. **Low — documentation**, docs/retention.md. It still describes scheduled ephemeral purge as open/unimplemented. Reproduction: read proposed-policy preamble and companion-device row alongside the new opt-in worker. Proposed fix: distinguish implemented local opt-in mechanism from unverified native delivery, and retain the wider metadata/action/backup policy gaps. Retest: **UNVERIFIED**; no documentation edits by this reviewer.

No blocking privacy/data-preservation defect found in exercised scope. Local mocks do not establish native D1 rollback behavior, simultaneous worker delivery, native cron provisioning, operator activation, production deletion measurements, backups, consent captures, revoke/account-delete lifecycle or actual Gmail/AI behavior. All remain UNVERIFIED here; existing lifecycle/launch blockers are not waived.

## Source SHA-256

- `packages/operations/retention.ts`: `860a6ff56e7e1b56456f592fe6cb035a055375669bef0966a8e562ed75851a97`
- `lib/retention.ts`: `48061b773efff48b786ca71004fbbc3b7c9437b782360cab0aa7230a5c0758fc`
- `build/sites-worker.ts`: `22a355bd33d322eb14145f7afc99ae507f820d85e4bb0ddbab95b7edccc0901f`
- `db/schema.ts`: `3b3643318ebbaf917e96d484d8f0804fd587320cddc512155bc095a4fa28478b`
- `drizzle/0013_massive_dorian_gray.sql`: `7fff0f73a11553a87c7caccd3a56dfb1eca2aed72f1cbe30f4e03c47c46ea695`
- `drizzle/meta/0013_snapshot.json`: `b44772d409f9b5c0a54e095ead98a8eeff8a60a3091bbc58b5b946577ee34586`
- `drizzle/meta/_journal.json`: `781471d7a8522cd2cf8cabef8c7392cab8be2b3f01390016ba61e7153cb6b915`
- `tests/retention.test.mjs`: `0063bca63a500a50132a6e3e660e6e65b35862a0e193656615a9218ffbe4ad55`
- `tests/backend/integration.test.mjs`: `ce2ebea63e7e5861d0e59ae2ed4c5fd683c30f399c09effbea0b4e77e25640c5`
- `packages/operations/admission.ts`: `656d893fbeee80d4e14b80e494ac37a99502242b79a100be138c1fe409731ffe`

## Follow-up retest — 2026-10-15T20:26:43.038630+00:00

Result: **PASS for updated bounded local scope**. Original findings and hashes above are preserved as historical review evidence.

- Original finding 1: **resolved; retest PASS**. Migration0014 supplies composite `(expires,id)` plans/device and `(expires,state)` OAuth indexes plus durable plans cursor. New candidate SELECT is limited to100 before eligibility evaluation; EXPLAIN uses covering plans_expiry with tuple lower bound and expiry upper bound, without temporary sorting. DELETE searches only candidate IDs and covering actions_plan. Cursor revision compare-and-swap is in the same batch as deletions; stale overlapping runs cannot regress progress. Underfill wraps to revisit earlier insertions/expiry/eligibility changes. At most100 candidates and100 deletes per target table per call; no backlog-wide eligibility scan remains.
- `node --experimental-strip-types --test tests/retention.test.mjs`: **PASS,3 tests**, including progression beyond205 retained executing plans and overlapping invocation behavior. Transaction failure still rolls back deletes.
- `node --experimental-strip-types --test --test-name-pattern='retention requires operator' tests/backend/integration.test.mjs`: **PASS,1 test**.
- `node --experimental-strip-types docs/reviews/goal-retention-privacy-probe.mjs`: **PASS**. In addition to prior boundary/clock checks, mutates candidates after selection before batch execution: renewed expiry, newly inserted uncertain action, renewed lease and executing status all prevent deletion. Candidate queryplan assertion verifies covering index and absence of temp sort.
- Original finding2: documentation follow-up remains owned by primary agent; this retest does not establish its resolution.

Native host/D1/provider/cron and production lifecycle/backup boundaries remain UNVERIFIED; no release certification.

### Retested source SHA-256

- `packages/operations/retention.ts`: `b4babd02e739b272de385ac2e95d92308690c775e1d797bcb2639582091a2686`
- `lib/retention.ts`: `48061b773efff48b786ca71004fbbc3b7c9437b782360cab0aa7230a5c0758fc`
- `build/sites-worker.ts`: `22a355bd33d322eb14145f7afc99ae507f820d85e4bb0ddbab95b7edccc0901f`
- `db/schema.ts`: `2ff4d7e4b2a90b6ffe3e576935ffb5e349fc55cd0d71095ca1856525225d3466`
- `drizzle/0013_massive_dorian_gray.sql`: `7fff0f73a11553a87c7caccd3a56dfb1eca2aed72f1cbe30f4e03c47c46ea695`
- `drizzle/0014_bitter_giant_girl.sql`: `993797e66cf8263d4d2de080c9ce74d2b00b4eb73c3cc91e3111fcc9e5b21770`
- `drizzle/meta/_journal.json`: `530455b1f445e9f2b340a83164cbafb4327f2f7b95d7e142ab1cee8d38334439`
- `tests/retention.test.mjs`: `976999f0d57ac4c37be8545ec33cc34a3f259aaaf69be236e222e6fbb830d73a`
- `tests/backend/integration.test.mjs`: `ce2ebea63e7e5861d0e59ae2ed4c5fd683c30f399c09effbea0b4e77e25640c5`
