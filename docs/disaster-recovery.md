# Disaster recovery — drill required

Proposed objectives for owner approval: RPO 24 hours, RTO 4 hours. These are goals, not measured promises. Hosting/database backup facilities and actual recovery permissions must be verified through the connected provider before public mail processing.

Backup code/config references and encrypted D1 state separately from encryption keys. Restrict backup access, record region/retention, verify encryption and restoreability. Backups must not contain plaintext token dumps. Maintain account-deletion tombstones outside the restored snapshot or replay an authoritative deletion log before admitting users.

Recovery: pause all mutation jobs; restore to isolated owner-only environment; apply schema version/migrations; replay deletion tombstones; reconcile outstanding actions against Gmail; invalidate stale plans; reauthorize where tokens revoked/keys unavailable; run cross-tenant safety and identity checks; resume read-only scan before cleanup. Never replay an old queued delete batch on restore.

Drill records must include snapshot timestamp, checksum, recovery duration, data lost, tombstone proof, decryption proof, API identity denial, action replay behavior and signoff. Do not claim backup readiness until a real D1 restore drill succeeds. Current status FAIL/UNVERIFIED; no live recovery exercise established.
