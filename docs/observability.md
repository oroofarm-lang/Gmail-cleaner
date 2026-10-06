# Observability

Structured events should include event name, runtime/build version, opaque request/job/action ID, source mode, duration, outcome code and retry count. Do not include email headers, subject/snippet/body, raw URLs with tokens, OAuth state/verifier, Authorization or credential ciphertext. Tenant references should be pseudonymous and access-controlled.

Measure scan pages/messages committed, job lease age, history invalidation/full-resync rate, protected skips, action success/partial/failure, idempotency collisions, undo outcomes, OAuth errors, provider quota failures, key/decrypt errors and retention lag. Separate demo counters from real mailbox evidence. Size figures mean classified estimates; trashing is not verified storage recovery.

Required alerts: persistent auth/decrypt failure, stale jobs/watch renewal, repeated provider mutation failure, unexpected cross-tenant denial spikes, purge failures and error-budget breach. Set practical thresholds after observing baseline. No external monitoring provider or alert channel has been verified; local structured logging alone does not establish active monitoring. Test alert delivery with a synthetic failure and record recipient, latency and acknowledgement.

Health must expose only safe readiness/build metadata. Do not reveal secrets, account IDs, database rows or provider responses to unauthenticated callers. Logs and backups have retention/access review before activation.
