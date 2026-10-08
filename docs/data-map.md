# Data inventory and trust boundaries

| Data                  | Location                                | Purpose                      | Access boundary                          | Current evidence                                  |
| --------------------- | --------------------------------------- | ---------------------------- | ---------------------------------------- | ------------------------------------------------- |
| Synthetic groups      | D1 `mail_groups`, source=demo           | Interactive demo             | Gateway tenant                           | Demo only; aggregate counts are fixtures          |
| Tenant settings/rules | D1 `tenants`, `rules`                   | Protections and policy       | Tenant-scoped repository                 | Validate all writes and disable rules on deletion |
| Gmail metadata        | D1 `messages`, source-bound jobs/groups | Scan/classification          | Server and authenticated owner           | Adapter exists; live ingestion unverified         |
| OAuth tokens          | D1 `credentials` encrypted envelope     | Provider authorization       | Server only, AES-GCM account binding     | Live credential lifecycle unverified              |
| OAuth transaction     | D1 `oauth_transactions`                 | PKCE/state replay prevention | Tenant/session bound, single consumption | Expiry/atomic consume require route tests         |
| Plans/actions         | D1 `plans`, `actions`                   | Preview, audit, undo         | Tenant + source                          | Demo results cannot establish Gmail undo          |
| AI input              | OpenAI HTTPS                            | Optional typed proposals     | Consent + bounded metadata               | Live credentials/consent path unverified          |
| Dashboard URL         | Chrome local storage                    | Open dashboard               | Device extension                         | No network requests or inbox data                 |
| Operational events    | Runtime logs                            | Reliability/security         | Operator                                 | Never include email text or tokens                |

Required flows: browser → gateway → same-origin API → tenant repository → deterministic policy → fixed-origin provider. Email headers/snippets and unsubscribe targets are attacker-controlled data. External destinations cannot become instructions. See threat model and retention plan.

## User export

Authenticated `POST /api/export` returns a manifest with preferences, safe schedule fields and six allowlisted collections: groups, messages, plans, actions, rules and jobs. Each collection uses tenant-scoped ID keyset pagination (200 rows). The browser completes all pages before downloading `inbox-agent-data.json`. Credentials, OAuth transactions and scan owner tokens are excluded. This is current paged data, not a transactionally consistent backup or restore artifact. Mail metadata/action details remain sensitive and are disclosed only to their owner.

## Synchronization working state

D1 `jobs.cursor` stores the current full/history phase, opaque page cursor, sweep/run IDs and pending changed message IDs. `jobs.history_id` advances only after all IDs for the history traversal have committed. `sync_seen` stores tenant/message/sweep markers to prune vanished local inventory after a complete full sweep. `sync_pages` stores tenant/run/SHA256 token keys to detect provider pagination cycles across many pages. Both internal tables are excluded from user export and contain no OAuth credentials, body text or provider mutation authority. They are cleared at successful sync boundaries and tenant data/account deletion; account replacement clears prior scan state. Timed retention and deployed cleanup evidence remain separate launch gates.

## Scheduled scans

`sync_schedules` stores explicit tenant opt-in, frequency, next due time, account generation, lease/owner and fixed status/error codes. Only safe preference/status fields are returned in state and export; owner, lease and generation are excluded. Disconnect, OAuth reconnection and data/account deletion pause or remove schedules. `scheduler_health` stores global runtime timestamps without tenant IDs, mailbox content or credentials. The scheduled worker reads only the five-message metadata unit and never executes rules or cleanup plans.

## OAuth application permission

Credentials contain a nonsecret app permission (`readonly` or `modify`) alongside encrypted tokens and account generation. State returns permission to explain available actions; credentials still remain excluded from export. OAuth transactions additionally record requested scope and, for upgrades, the pinned account email. They are server-only, single-use and epoch-fenced. Refresh preserves previously validated scope when the provider omits it. Neither a browser parameter nor a combined provider grant can upgrade the stored app permission without the explicit upgrade transaction.

## AI sharing consent and advisory flow

D1 `ai_consents` stores tenant, enabled state, disclosure version, purpose (`commands` or `metadata`), configured model ID, consent epoch and updated timestamp. State/export include preferences but exclude epoch. No model input/output is recorded in this table. Explicit revoke rotates epoch and enters Privacy Mode; re-grant cannot resume an older request. Gmail reconnect/disconnect revokes metadata purpose. Local data/account deletion removes consent. Old privacy snapshots and unrelated settings/protection changes cannot re-enable a revoked consent row.

Only command-only input or confirmed sender-domain/redacted-subject/system-label metadata goes to fixed-origin OpenAI Responses, without tools, bodies/snippets or custom labels. Both dispatch and response presentation check current consent. Fresh deterministic policy can only constrain AI advice; model results cannot create approved rules or authorize cleanup. This is synthetic actual-adapter evidence; real provider and deployed retention/restore remain UNVERIFIED.
