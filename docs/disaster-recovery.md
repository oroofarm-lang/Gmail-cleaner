# Disaster recovery — drill required

Proposed objectives for owner approval: RPO 24 hours, RTO 4 hours. These are goals, not measured promises. Hosting/database backup facilities and actual recovery permissions must be verified through the connected provider before public mail processing.

Backup code/config references and encrypted D1 state separately from encryption keys. Restrict backup access, record region/retention, verify encryption and restoreability. Backups must not contain plaintext token dumps. Maintain account-deletion tombstones outside the restored snapshot or replay an authoritative deletion log before admitting users.

Recovery: pause all mutation jobs; restore to isolated owner-only environment; apply schema version/migrations; replay deletion tombstones; reconcile outstanding actions against Gmail; invalidate stale plans; reauthorize where tokens revoked/keys unavailable; run cross-tenant safety and identity checks; resume read-only scan before cleanup. Never replay an old queued delete batch on restore.

Drill records must include snapshot timestamp, checksum, recovery duration, data lost, tombstone proof, decryption proof, API identity denial, action replay behavior and signoff. Do not claim backup readiness until a real D1 restore drill succeeds. Current status FAIL/UNVERIFIED; no live recovery exercise established.

## Implemented isolated SQLite recovery

The engineering tool is `node --experimental-strip-types scripts/recovery.mjs`. It requires a current-schema SQLite file, Node 22.13+ with TypeScript stripping/SQLite support, and operator-supplied `INBOX_RECOVERY_KEY` (canonical base64url encoding of 32 random bytes) and `INBOX_RECOVERY_NAMESPACE` (deployment UUID). Supply secrets through the private operator environment; never commit or print them. Keep the key separate from the artifacts and use a namespace dedicated to this deployment.

```sh
node --experimental-strip-types scripts/recovery.mjs snapshot /private/source.sqlite /private/new-snapshot.enc.json
node --experimental-strip-types scripts/recovery.mjs restore /private/snapshot.enc.json /private/current-journal.enc.json /private/new-isolated.sqlite
```

Snapshot uses a single read transaction and an exact migration hash. AES-256-GCM authenticates version, purpose, deployment namespace and key identity. Files are created exclusively with 0600 permissions; an existing target is rejected. The bounded in-memory tool rejects plaintext larger than 250 MB; size-limit rejection is not a partial backup. Six allowlisted collections preserve tenant data and action evidence. Credentials, OAuth transactions, AI/device authorization, scan state, schedules, leases and queued jobs are excluded. Restore cancels plans, disables rules, marks interrupted actions uncertain, advances connection/data generations and forces Privacy Mode/demo source/autopilot off. It never calls Gmail. Reconciliation and fresh user consent remain mandatory before reconnecting a restored account.

## Independent erasure journal

The application deletion endpoint now requires an initialized independent object-store binding named `RECOVERY_JOURNAL` plus the private recovery key/namespace. Missing configuration, wrong root/key or failed durable receipt write returns 503 before purging local data. The application does not initialize an empty journal automatically. Operator-only `initializeJournal`, `appendDeletion` and `collectDeletionJournal` in `packages/recovery/journal.ts` implement the R2-compatible get/put/list interface; an authenticated root distinguishes an initialized store from an empty or wrong store. Receipt paths hash tenant IDs and use random immutable object names. They contain encrypted erasure intents, not message content.

Receipt persistence precedes the atomic database purge. Every child deletion and the final tenant update require the captured data generation and absence of current Gmail credentials. Reconnect or competing purge returns 409 without deleting that generation. The successful transaction advances the generation; restore discards data at or below an erasure receipt's generation and preserves subsequent generations. Account erasure is terminal. A persisted intent may conservatively suppress restoration even when the later database transaction fails; operators must retain and investigate that intent, never silently remove it to make recovery pass.

Restore requires an authenticated, current journal collected independently from the backup. Pagination, missing objects, duplicate keys and looping cursors fail closed. The five-minute freshness check does **not** prove a complete journal or protect against deletions after collection. Keep admission and writers paused, collect the authoritative journal, restore in isolation, replay/revalidate through the final admission boundary, and verify the pause before exposing data. API and scheduler admission now use durable drain tickets (migration0012); the restore tool forces recovery mode and ordinary resume cannot reopen it. Hosted operator transport, authoritative journal export and final recovery admission/cutover remain incomplete technical release blockers.

## Outstanding hosted recovery gates

The checked-in hosting configuration has no R2 binding configured. No store was provisioned and no live hosting setting was changed. The CLI accepts SQLite files; it does not export/import the hosted D1 service. Actual D1 consistent capture/import transport, independent journal provisioning/access policy/durability, journal initialization/export, maintenance/admission enforcement, backup expiry, key custody/rotation and a measured hosted restore drill remain UNVERIFIED or incomplete. Do not substitute a stale journal, an empty array, the ordinary paged user export, or an old database snapshot for those gates. Local synthetic recovery success does not establish production backup readiness.

Permanent tests: `node --experimental-strip-types --test tests/recovery.test.mjs` and the backend integration suite. Independent evidence is under `docs/reviews/goal-recovery-*`; its original high-severity failure is preserved alongside the generation correction retest.
