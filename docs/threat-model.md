# Threat model

Assets: mailbox integrity, OAuth tokens, metadata/identity, tenant settings/rules, action ledger and availability. Actors: user, other tenant, malicious email sender, compromised dependency, model output, operator and external provider. Boundaries: browser/gateway, route/repository, tenant/source, policy/provider, mail/model, local extension/dashboard and operator/key store.

| Attack / failure                      | Required control                                           | Verification                                                      |
| ------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| Forge tenant identity                 | Gateway-derived tenant, deny unauthenticated APIs          | Tenant A tries every B identifier; expect denial without metadata |
| Replay/tamper cleanup                 | Expiring immutable plan + fresh protection + idempotency   | Replay key/plan, change sender protection after preview           |
| Email prompt injection                | Treat email as data, typed output, deterministic authority | Snippet instructs bulk delete/exfiltration; no action allowed     |
| Token disclosure or wrong-account use | Server-only envelope, nonce + account AAD                  | Search client artifacts; decryption under other account fails     |
| CSRF/state replay                     | Origin checks + session PKCE state single-use              | Foreign origin, expired state, double callback rejected           |
| SSRF via unsubscribe                  | No automatic network fetch or mail sending                 | Private IP/redirect/rebinding candidate stays manual              |
| Provider failure/duplicates           | Durable per-message ledger and bounded retries             | Timeout after mutation, restart and reconcile without duplication |
| Cross-source contamination            | Demo/Gmail partitions                                      | Demo action never invokes Gmail adapter                           |
| Model/data exfiltration               | Consent, metadata bounds, fixed API origin                 | No AI request before consent; secrets omitted                     |
| Fake companion state                  | Visible pending pairing, no mailbox claims                 | Side panel never says connected after saving a URL                |
| Deleted data resurrected              | Tombstones reapplied to restore                            | Restore after deletion; account stays absent                      |
| Supply-chain/remote code              | Lockfile, scanners, bundled extension code                 | Inspect build CSP/dependencies and actual release artifact        |

Residual risks: provider-controlled trash lifecycle, irreversible actions outside this app, confidential information in subject/snippet, credential operator access, provider retention, framework compatibility differences and unavailable background scheduler. D1 concurrent writes, live OAuth and provider recovery require deployed tests, not just fake adapters. This threat model must change when backend pairing, automatic unsubscribe or public accounts are added.
