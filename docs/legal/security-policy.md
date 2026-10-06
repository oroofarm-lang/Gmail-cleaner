# Security overview

Draft status: private engineering preview, 2026-10-05. Not an approved public notice or legal certification. Provider legal name, registered address, privacy/support contact and applicable terms require owner completion and qualified review before public real-mail launch. Owner fields have not been invented.

Inbox Agent derives authenticated tenant identity from the Sites gateway and scopes relational data by tenant/source. Email content and model proposals are untrusted. Deterministic policy and fresh metadata/protection checks govern mailbox action plans. Gmail permanent-delete methods are not exposed. Each action has a ledger status; uncertain results require manual reconciliation rather than blind replay.

Server-held OAuth tokens use authenticated AES-GCM encryption bound to the account. State and PKCE protect the OAuth exchange; the callback atomically consumes a tenant-bound transaction. The encryption key, provider secret and optional AI key belong in deployment secret storage. They must never enter extension/browser bundles, logs or exports.

The extension contains local code, minimal sidePanel/storage permissions and no website/Gmail access. The unsubscribe adapter does not fetch arbitrary targets because safe egress and DKIM verification are unimplemented. Continuous guardian scheduling and extension pairing are unimplemented.

These are source-level controls, not a statement that an independent security assessment, provider certification or live authorization audit has completed. Public processing requires final independent review, secret/dependency checks, deployed auth/tenant tests, live revoke/mutation/undo and monitored incident/restore operations. Security reporting contact is awaiting owner completion; see responsible disclosure draft.
