# Independent extension relay security / Chrome / privacy review

UTC review date: 2026-10-08. Base commit: `a6963a498c8f1bec655ae946670b92ed00bd64ee`. Scope: uncommitted relay source, API routes, migration 0010, dashboard settings, extension background/relay/side panel and build script. This reviewer started in a fresh context, read repository reviewer contracts and component sources, and did not use previous reviewer conclusions. No implementation files were edited by this reviewer.

Status: **bounded security / Chrome protocol / privacy disclosure PASS after corrections**. This is not a release approval. Required live Google Chrome 116+ panel/action/reopen tests, actual hosted gateway unauthenticated/cross-tenant requests and store disclosure validation remain **UNVERIFIED** and their launch gates **FAIL**. Extension/package/framework builds and browser QA are owned by the coordinating agent; this reviewer did not run or independently certify them.

## Findings and preserved evidence

### F1 — Medium: server invalidation leaves local approval without a dashboard recovery path (fixed locally)

Affected: `components/inbox/extension-settings.tsx`, `apps/extension/relay.js`, `lib/extension-relay.ts`.

Initial reproduction: create local hello; start and approve server device; deliver one valid summary; increment tenant connection epoch (synthetic Gmail reconnection); request hello again. Local hello remains `paired:true`, but `/summary` rejects with 403. Initial dashboard branch always selected summary when `hello.paired`, so it never offered fresh approval. Device revoke and 30-day server expiry had the same shape. An interrupted approval/packet-delivery or dashboard reload also needed an idempotent exact challenge start.

Evidence: `goal-extension-relay.initial-test.log` (four independent synthetic checks); `goal-extension-relay.original-failure.log` preserves the deliberately failing diagnostic assertion that hello was not a fresh challenge. This historical diagnostic is intentionally expected to fail for the original protocol; current behavior should be evaluated using the explicit-reset retest, not that diagnostic environment flag.

Original reproduction command: `RELAY_EXPECT_AUTOMATIC_RECOVERY=1 node --test --test-name-pattern='original recovery defect' docs/reviews/goal-extension-relay.support.mjs`.

Proposed fix: offer an explicit dashboard recovery action that clears the matching local challenge, revokes this tenant's prior device, creates a new nonce/id and requires explicit approval. Exact current pending/active challenge starts may be idempotent; wrong nonce/tenant/epoch must remain rejected.

Retest: **PASS**. Fresh source implements the explicit action. Independent harness confirms wrong origin/nonce reset rejection, rotated challenge, stale packet rejection, no summary before new approval, successful fresh approval and strict idempotent start binding. UI handler was reviewed directly; live UI/Chrome exercise remains UNVERIFIED.

### F2 — Medium: privacy disclosure omits locally stored Gmail-derived aggregate summary (initial FAIL)

Affected: `docs/privacy.md`, `docs/data-map.md`, `docs/retention.md`, `apps/extension/sidepanel.html`.

Initial privacy notice said the extension saves only the dashboard URL; data map said no inbox data; visible panel said “No email data stored here.” Actual local storage contains device id, nonce, tab binding, approval expiry and the projection (source, connection state, message/protected/action counts, issued/expiry timestamps). The D1 table also stores tenant-bound hashed nonce and approval metadata.

Reproduction: `node --test --test-name-pattern='expired local projection' docs/reviews/goal-extension-relay.support.mjs`. At projection expiry `validProjection` returns false, but raw projection and nonce remain in local storage until Forget/uninstall/replacement. Thus the two-minute projection TTL is a display/freshness boundary, not immediate storage erasure. Settings accurately minimize shared fields but do not correct contradictory privacy documents/panel wording.

Proposed fix: disclose exact browser/server fields and retention/removal boundaries; distinguish hidden expired projections from deletion; explain local Forget versus server Revoke and two-minute residual display after revocation. Do not promise a deployed timed purge.

Retest: **PASS**. Final privacy notice, legal privacy policy, data map, retention table, extension README and visible panel now disclose local challenge/count retention, server hashed approval metadata, two-minute display freshness, Forget versus Revoke, and unfinished timed purge. No assertion of immediate projection deletion remains.

### F3 — Low: documented top-level sender boundary was not enforced (fixed locally)

Affected: `apps/extension/relay.js`, `apps/extension/README.md`.

The README stated only top-level dashboard messages were accepted, but the original sender predicate accepted `frameId:1` and missing frame IDs with an allowed root URL and tab id. This is a concrete contract mismatch; no cross-origin data exploit was demonstrated. Original reproduction: `node --input-type=module -e "import {trustedSender} from './apps/extension/relay.js'; console.log(trustedSender({url:'https://app.example/',tab:{id:7},frameId:1},'https://app.example'))"`. Original output `true` is preserved in `goal-extension-relay.frame-original.log`.

Proposed fix: require `sender.frameId === 0` in the browser-authenticated sender predicate and provide the real Chrome field in synthetic fixtures.

Retest: **PASS** in the independent harness: main frame accepted, subframe and missing-frame senders rejected before challenge disclosure. A transitional existing extension fixture lacked `frameId` and correctly failed after the stricter predicate; preserved in `goal-extension-relay.frame-fixture-failure.log`. The final complete-suite result is recorded below.

## Bounded adversarial results

Independent harness `docs/reviews/goal-extension-relay.support.mjs` imports actual relay/server relay functions with a minimal synthetic server binding and real in-memory SQLite migrations. No real gateway, provider, mailbox, secret or remote service is used.

- Seven independent checks **PASS**: tenant/source separation, hashed nonce at rest, current connection-epoch fence, foreign origin/path/extension sender rejection, simultaneous replay serialization, bounded allowlisted projection rejection, nonce-bound reset/new approval, exact idempotent challenges, ten-device limit, pending/active expiry and deleted-tenant rejection.
- `node --experimental-strip-types --test tests/extension.test.mjs tests/backend/dispatch.test.mjs`: initial run **62/62 PASS**. This exercises actual mocked route dispatch for gateway absence, tenant identity and read-only approved projection; synthetic success does not prove hosted auth.
- `node --experimental-vm-modules --experimental-strip-types --test tests/security/backend.test.mjs`: **8/8 PASS**, preserved in `goal-extension-relay.security-test.log`.
- `node --test docs/reviews/goal-extension-relay.support.mjs`: fresh recovery source **7/7 PASS**, preserved in `goal-extension-relay.retest.log`.

No reproduced cross-tenant projection disclosure, nonce-bearing API credential export, Gmail mutation authority, content scraping, remote code or broad Gmail host permission was found. Source manifest requests only `sidePanel,storage`; CSP keeps scripts local and network disabled. Opt-in build adds exact configured externally-connectable origin, while background validates root dashboard origin and requires a browser tab. Local storage access is restricted to trusted extension contexts. The extension nonce never substitutes for gateway identity: every server API operation still derives tenant from authenticated gateway context and checks same-origin JSON for mutations.

Migration 0010 holds only device approval metadata; account deletion includes its tenant rows, and export selects safe metadata without nonce/hash. Summary projects only allowlisted bounded aggregates for selected source, uses `no-store`, and checks active approval, tenant tombstone, connection epoch and expiry in the projection statement. Server/device expiry does not imply automatic physical row purging; no production retention/restore guarantee is made here.

## First recorded source hashes

SHA-256 captured during the first test pass, while the coordinating agent had already begun recovery corrections. These are intermediate hashes, not a claim that all files are the original failing source. The initial missing recovery branch was observed in the earlier independent source read; its protocol state and failure evidence are preserved above. Final hashes are separately recorded below.

| File                                    | SHA-256                                                          |
| --------------------------------------- | ---------------------------------------------------------------- |
| lib/extension-relay.ts                  | f93a4a144f435cbf7cdc5826d13442f85e9a724bc265bf69b742ff5ad8202647 |
| apps/extension/relay.js                 | 1729c1b63bc782595f752aaebb3f4ebcb240f7177d0c5a2b5743e8e9ad55c3da |
| components/inbox/extension-settings.tsx | e7c02880f392e4453664fedc1dc6602f4d336d5a3b09accd804549047027a0b5 |
| docs/data-map.md                        | eac5361c22519ed57b58b883c029987454d23f4d446301ff174a75f1ed19801e |
| docs/privacy.md                         | 725cbf4331f92b4353a6a24225b6a60e50103c5bf24291e97dd2728c940b9c73 |
| docs/retention.md                       | 74a6c729d4db1f109d88267458dd228e073c83cbc401a997b2d96209caffa51e |
| apps/extension/sidepanel.html           | c447f768c7271f41a56eaebd3a7bbc8656ecf688d3324b537540e4b8e55a737f |
| app/api/[...path]/route.ts              | a76b0e3319660894c82c9806a1a6b9c5ac18cc95460e996bcf14e224a21b4e28 |
| apps/extension/background.js            | 9606a5517d33187234136970f5cbf3223cdf5e216896531f4d99afe76c0e8694 |
| scripts/build-extension.mjs             | 60cb6628857e1e9c2f37f1885fb9784acc6da0023236fee29d1cfa63b3beed7b |
| drizzle/0010_narrow_marvel_boy.sql      | 78aac1c2fdffa62676d88614737d51942d023923a0e8aee5f7abd8e85f7b9226 |

## Final retest and source identity

Final retest UTC: `2026-10-08T05:55:11Z`. All three findings are **corrected and bounded retest PASS**, with no unresolved reproduced security/privacy protocol defect in the reviewed scope. Independent synthetic checks are **7/7 PASS**; final existing backend/extension tests are **62/62 PASS** after providing `frameId:0` in the real-browser sender fixture. The earlier strict-frame fixture failure remains preserved separately rather than being discarded.

Exact final source/support SHA-256 inventory: `docs/reviews/goal-extension-relay.final.sha256`. Verify from repository root with `shasum -a 256 -c docs/reviews/goal-extension-relay.final.sha256`. Replay checks with `node --test docs/reviews/goal-extension-relay.support.mjs`; the support harness does not contact providers. The command using `RELAY_EXPECT_AUTOMATIC_RECOVERY=1` is a historical failing diagnostic, not the acceptance command for the explicit recovery design.

This reviewer did not independently execute or certify the coordinating agent's isolated Chromium runtime checks. Production hosted identity boundaries, real Google Chrome panel/store behavior, actual provider lifecycle, scheduled physical purge and backup restoration remain **UNVERIFIED**; their required launch gates remain **FAIL**. This review grants no release readiness waiver.
