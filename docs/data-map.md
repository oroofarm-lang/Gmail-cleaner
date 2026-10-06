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
