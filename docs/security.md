# Security boundaries and release requirements

Authentication must come from the verified Sites gateway, never request JSON or query tenant IDs. D1 repositories scope every read/write by tenant and source. Same-origin mutation routes validate origin and strict schema. Demo and Gmail actions remain separate. Fresh protections and plan expiry are checked at execution; models cannot authorize operations.

Credentials stay server-side under authenticated AES-256-GCM encryption with independent 96-bit nonce and account-bound additional data. The key is an environment secret; rotate by decrypting old envelopes and atomically re-encrypting under a new managed key version. Do not log authorization headers, token bodies, state/verifier, email text or export contents. No credential may reach client bundle, extension storage or analytics.

No permanent-delete Gmail method is exposed. Trash must have fresh per-message authorization, durable idempotency and an action ledger; undo targets only app-owned successful actions and handles partial failures honestly. Providers must have deadlines, retry classification, bounded concurrency and stale-job leases. Unsubscribe remains manual because arbitrary mail-provided URLs cannot be safely fetched without DNS/egress controls and authentication verification.

Security tests require cross-tenant attempts, preview tampering, protected messages, state replay, repeated page tokens, provider failures, malformed model output, prompt injection, refresh revocation and idempotent undo. Static assertions are insufficient for a live authorization claim. Add dependency/secret scans and verify actual deployed headers and gateway denial. Threat model: `threat-model.md`; independent reviewer: `agents/security-reviewer.md`.

Known gaps: Vinext production compatibility, public auth audience, live OAuth, production key custody/rotation, durable scheduler, provider mutations, incident monitoring, restore drills and retention are not fully proven. Public real-mail launch must fail until supported by evidence.
