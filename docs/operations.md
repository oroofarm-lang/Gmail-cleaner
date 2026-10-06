# Operations runbook

Private demo and real-mail production are distinct operational modes. Keep real provider processing disabled until OAuth consent, credentials, encryption key, permissions, audience and scheduling are verified. Configure secrets only through deployment secret storage, never committed files or browser configuration.

Startup checks: valid D1 binding/migrations, expected gateway auth, selected runtime versions, safe source mode, configured scopes, provider origins and key format. OAuth failure must lead to reauthentication, not silent infinite retries. History 404 triggers controlled full resync. Watch expiry requires renewal before expiration; verify real scheduler and authenticated Pub/Sub audience before enabling.

For mutation incidents pause jobs first, preserve privacy-safe correlation/action identifiers, reconcile each provider message against the action ledger, then restore only confirmed app-owned actions at the user's request. Do not rerun a bulk cleanup based on the group count. For key exposure revoke credentials, rotate keys/secrets, redeploy, invalidate affected sessions and follow the incident notification assessment with counsel. Never paste email/tokens into tickets.

Public release requires a named owner and support channel, working alerts, escalation rotation, provider quota/cost ceilings, bounded job leases, documented rollback and restore evidence. None is inferred from a successful UI build. Routine checks: health/version, auth denial, job age, failed/partial actions, watch renewal age, revoked-token refresh attempts, rate limits, storage growth and purge lag.
