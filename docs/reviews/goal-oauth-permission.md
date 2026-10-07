# OAuth permission goal review

Status: bounded local PASS after correction; live-provider launch gate FAIL / UNVERIFIED.

Reviewed independently under docs/agent-system.md, agents/gmail-safety-reviewer.md and agents/security-reviewer.md. UTC: 2026-10-07T11:44:03Z. Baseline HEAD: be248e13579e722a066cbadb96e293e2a00b59a2. Scope: current uncommitted OAuth read-only/modify permission change, credential migration, callback/account binding, refresh/dispatch fences, Undo and UI confirmation. No implementation files edited by reviewer; no builds, Playwright, provider network, real credentials or live mailbox actions used.

## Finding F1 — HIGH, corrected and independently retested PASS

Affected component: lib/gmail-server.ts upgrade account capture and OAuth intent creation (initial reviewed source SHA256 806a0f2330f5a7829bb96900ad159c3e720cd29c1c59d39772935bb3123cca70).

The original upgrade read account A before its asynchronous transaction creation and unconditional connection_epoch increment. An already consumed older read-only callback could commit account B between those operations. The new modify transaction then stored account_email A with a newer epoch. A modify callback for A was accepted, replacing current B and clearing B's inventory/action history. This violates the promised upgrade of the connected account and can remove recovery provenance. This is a concurrency/consent binding defect, not unauthenticated mailbox access.

Exact synthetic reproduction sequence:

1. Create connected A and an epoch-0 pending read-only callback whose intercepted profile returns B. Hold its profile response.
2. Start POST /api/oauth/upgrade with same-origin JSON {"approved":true}; pause the UPDATE tenants SET connection_epoch immediately before execution, after it captures A.
3. Release the old B profile response. Assert old callback returns 302 and credentials now contain B.
4. Release the upgrade epoch update. Original implementation returns 200 and creates a modify transaction bound to A.
5. Intercept the new callback token/profile results as modify grant for A. Original callback returns 302; expected 409. Observed assertion: 302 !== 409.

Reproduction used a private /tmp copy of the repository's actual route/SQLite/Gmail adapter fixture, with synthetic token and profile interception. Original command: `node --experimental-strip-types --test --test-name-pattern='independent review' /tmp/oauth-permission-review.test.mjs` (initially FAIL on the expected callback 409 assertion).

Proposed fix: make upgrade intent creation conditional on captured credential email and generation; require modify callback batch writes and final settings commit to match the current connected account as well as tenant epoch. Implementer applied both fixes. Retest pauses at the same atomic epoch UPDATE, commits B, and now receives upgrade 409, preserves B, and creates no new modify transaction: PASS. Independent callback profile-time account replacement also returns 409 and preserves B and inventory: PASS.

## Bounded checks

Independent intercepted adversarial command above: final 5/5 PASS. Covered upgrade-start account switch race, callback current-account switch, missing/foreign Origin upgrade denial (403 and no transaction), permission downgrade at final cleanup attempting CAS (zero HTTP mutations), and permission downgrade during Undo token wait (zero further mutations).

Repository checks run:

```sh
node --experimental-vm-modules --experimental-strip-types --test tests/backend/dispatch.test.mjs tests/backend/integration.test.mjs tests/security/backend.test.mjs tests/integrations/*.test.ts tests/core/safety.test.ts
```

Initial run: 109/109 PASS. After two implementation regression cases were added: 110/111 PASS; the callback regression fixture's beforeQuery hook targeted credentials INSERT, but batch executes directly and does not invoke that hook. This fixture failure was reported immediately; independent callback account-switch test passed. After the regression hook was corrected, final rerun: **111/111 PASS**, exit 0, 2026-10-07T11:44:47Z. This includes both permanent account-switch regression cases.

Source inspection plus tests confirm: GET start ignores browser permission input and requests readonly; strict same-origin POST upgrade requires approved=true and a connected account; transaction stores requested_scope/account_email; migration 0008 defaults legacy/new credentials and transactions to readonly; callback grant validation cannot turn a combined Google modify grant into app modify permission for a readonly intent; wrong grant/account cannot overwrite credentials; denied callback consumes state; clientFor refuses mutation for readonly credentials and for absent modify token scope; refreshed token scope omission retains prior scope without changing app permission; current credentials/generation/permission are checked after token acquisition and before mutation dispatch; final cleanup CAS and Undo dispatch lease fence include permission=modify. OAuth state is tenant-bound/single-use, and later intent/disconnect/delete epoch fences stale callback commits. Mutation scope check is defense alongside app permission, not a source of permission escalation.

UI source review: initial/reconnect labels disclose read-only; current app permission is visible; a distinct confirmation explains reversible mailbox changes, broader Google grant, per-plan approval and no permanent delete before POST upgrade. Runtime visual/accessibility behavior was not exercised in this bounded review.

## Source hashes at corrected retest

| File                            | SHA256                                                           |
| ------------------------------- | ---------------------------------------------------------------- |
| lib/gmail-server.ts             | 0849f73733e7f5863972e3e98df59670f04d52bedcd8c845b6cd2717fbaace48 |
| lib/server.ts                   | c27aa10633ce73dc1692a92c93bc10bcefacf8d7bd04bb3c9e6c7c1619a7efa3 |
| db/schema.ts                    | e91f9b04d5a8d15dc2fa82177b3237d1dd0b51bda941eea7fc4ae9dc5fa27a26 |
| app/page.tsx                    | 981260c318fab2380ff0506a93e06f725c8ee6473f2d2fe69b67bce38f6ce1da |
| drizzle/0008_fancy_eternity.sql | 0c308bf06ff6ccbf7e7e23b00d15277cc24590e82ca520178e17c262c2cb6ba7 |
| app/api/[...path]/route.ts      | 2b6d5fbdaa0f193001c644aa16cde7e735dd61c86cd7bded6a48384ca1c32c2c |
| packages/integrations/oauth.ts  | 556e1ffa0e49e075ca12eda4509bfc41f426e38ab9b0433c15e54b975758d4bc |
| tests/backend/dispatch.test.mjs | 59628af9452aa4736672873f4ca69c1f7fbdfdf3193d74579cdc89559ff10552 |
| /tmp independent retest fixture | 4e15489f9bbef12b50824c80640b6548d7b8ce300caf0a3cfb9cdefdcbabc261 |

## UNVERIFIED boundaries

Live Google consent/incremental combined grants, refresh behavior, deployed gateway authentication/CSRF/cross-tenant behavior, applied production D1 migration, and disposable-mailbox trash/exact Undo are UNVERIFIED. Required specialist launch evidence is absent, so production launch gate remains FAIL. No release certification or waiver of another reviewer is given.
