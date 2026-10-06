# Retention and deletion — proposed policy

This is a proposed operating policy, not a claim that timed deletion is running. Owner must approve periods, implement scheduled purge and measure deletion in all active stores/backups before publishing any commitment.

| Record                        | Proposed lifetime                       | Trigger / proof required                                   |
| ----------------------------- | --------------------------------------- | ---------------------------------------------------------- |
| OAuth state/verifier          | 10 minutes maximum                      | Atomic consume on callback; expiry purge                   |
| Cleanup preview               | 15 minutes actionable                   | Fresh-policy recheck and reject expired plans              |
| Gmail metadata                | Only while needed for connected service | Account deletion, disconnect policy and stale-record purge |
| Refresh/access tokens         | Connected service only                  | Revoke on disconnect, erase envelope, stop jobs            |
| Action audit/undo             | 30 days, data minimized                 | Provider undo limits disclosed; timed purge                |
| Privacy-safe operational logs | 30 days                                 | No email/token content; verify provider retention          |
| Backups                       | Proposed 30-day rolling window          | Tombstone replay prevents deleted account resurrection     |
| Chrome dashboard address      | Until forget/uninstall                  | `chrome.storage.local.remove` verified                     |

Separate disconnect from account deletion in UI, explain each, and do not imply that app deletion changes Gmail contents. Privacy export should include user settings/rules/actions and stored metadata, excluding secrets. Delete account with a transaction or durable purge job: disable jobs/rules, revoke credentials, delete tenant-scoped records, mark tombstone, purge exports/cache and prove no future refresh occurs. Backups require a documented delayed purge or cryptographic deletion model and reapplication of tombstones after restore. Relying on inaccessible copies disappearing is not deletion evidence.

Required test: create a real disposable account, scan, export, disconnect, observe denied action/refresh, delete, query every table/storage/log location, restore a backup and verify tombstone enforcement. Retention scheduler and backup TTL remain unverified launch blockers.
