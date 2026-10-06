# Data retention and deletion

Draft status: private engineering preview, 2026-10-05. Not an approved public notice or legal certification. Provider legal name, registered address, privacy/support contact and applicable terms require owner completion and qualified review before public real-mail launch. Owner fields have not been invented.

## Current implementation

OAuth transactions and cleanup plans have expiration checks; expiration prevents use and is not automatic physical purge. Plans currently expire after 15 minutes. Gmail undo rejects app actions older than 29 days, in addition to Google's own recovery limits. Active-store timed retention purge and backup expiry have not been demonstrated.

Disconnect revokes Google access, erases stored credential envelopes/OAuth transactions, cancels Gmail jobs and unexecuted Gmail plans and turns autopilot off. Stored analysis remains. Local deletion requires disconnect and removes tenant-owned mail groups, plans, actions, rules, jobs, messages and OAuth transactions; account deletion also marks the tenant disabled. Neither deletion option changes Gmail contents. Export currently includes settings/rules only.

## Proposed periods, subject to implementation and owner approval

OAuth state/verifier: at most 10 minutes. Expired preview records: purge after their 15-minute actionable window. Connected metadata: only for service necessity. Token envelopes: until disconnect/revocation. Minimized audit and operational logs: proposed 30 days. Encrypted backups: proposed 30-day rolling window with deletion tombstones reapplied after restore. The extension's dashboard URL persists locally until forget/uninstall.

These are proposed targets, not fulfilled SLAs. Before publishing a commitment, run purge jobs, inventory every store/cache/export/log/backup, measure latency and prove a deleted account cannot resurrect after restore. Identify rights-request contact and export full relevant personal data when legally required. No owner-approved fixed retention period or completed backup drill exists yet.
