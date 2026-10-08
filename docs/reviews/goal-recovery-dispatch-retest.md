# Recovery dispatch correction review

Result: **FAIL** (one high blocking defect). Bounded synthetic checks pass except the independently reproduced account replacement race. Required live Gmail and deployed cross-tenant boundaries are **UNVERIFIED** and fail their launch gates. No live mailbox, provider request, shared Playwright run, or implementation edit was performed.

Review timestamp: 2026-10-06T16:07:40Z. Fresh independent Gmail/security review of the uncommitted patch against `253a94a5753f5bf263a6157e9a435240c6762ebe`. Read `docs/agent-system.md`, Gmail/security reviewer instructions, architecture and capability map. No earlier reviewer conclusions were used.

## High: cancelled Undo can dispatch against old Gmail credentials after reconnect

Component: `lib/gmail-server.ts` (`clientFor`, lines 71–113; `renewLease`, lines 36–54; Undo mutation callback, lines 650–652; disconnect, lines 239–274).

`clientFor` checks the pinned email before awaiting token decryption. For a token that does not need refresh, it returns the decrypted token without checking whether the credential row changed during that await. Undo's post-token callback renews its owner lease using only credential existence. Disconnect cancels plans/jobs and deletes credentials, but does not fence the restoring action. A subsequent credential row therefore re-enables the stale owner's lease, allowing its captured old token to reach the actual adapter's mutation fetch.

Exact synthetic reproduction:

1. Execute an approved one-message trash plan using the actual route and actual `GmailClient`, with SQLite D1 emulation and a fake local Gmail fetch.
2. Begin Undo and pause its second `decryptTokens` call: the initial safety GET has completed, and the token row for `/untrash` has already been read.
3. POST `gmail/disconnect`; then insert a new credential row for the same tenant with email `replacement@gmail.example` and different encrypted credential value.
4. Release decryption. The actual Gmail adapter dispatches `/messages/m1/untrash` with `Bearer synthetic-old-account-token` despite completed disconnect and replacement account connection. The following token lookup detects the account change; Undo returns HTTP 503 and records `restore_uncertain` after the old-account mutation already occurred.

Observed harness output: `REPRO account replacement: old-account untrash sent; handler later returns 503 state= restore_uncertain`.

Proposed fix: bind mutation authorization to the connection generation/account identity captured for the operation, and fence active restoring actions when disconnect/reconnect invalidates their connection. Recheck credentials after token decryption/refresh, and after other asynchronous work before dispatch, so existence of any replacement credential cannot authorize a captured old token. Maintain recoverable provenance for an already dispatched restore.

Retest: **FAIL** on reviewed checkpoint; defect reproduction assertion passed. A successful correction must make step 4 send zero mutation requests while preserving normal response-lost Undo recovery.

## Bounded test evidence

Commands (Node v24.18.0):

```sh
node --experimental-strip-types --test /private/tmp/recovery-dispatch-actual.mjs
node --experimental-strip-types --test tests/core/safety.test.ts tests/integrations/providers.test.ts tests/backend/integration.test.mjs
```

Actual adapter isolated harness: 6/6 assertions passed. One intentionally asserts the defect is reproducible; this does **not** establish a passing safety review. The harness imports the actual route and actual `packages/integrations/gmail.ts`, runs actual migration SQL in an in-memory SQLite database, stubs OAuth encryption/token handling, and replaces global fetch with a purely synthetic mailbox. Fake token text is synthetic. No network calls are made.

The five passing adversarial checks were:

- Token completion after expired cleanup and reconciliation cannot dispatch. Pending preflight records become failed and cannot authorize Undo.
- A new STARRED label during the mutation token wait stops cleanup; the failed action cannot authorize Undo.
- Provider trash success followed by lost response remains uncertain, is never automatically retried, and explicit exact Undo restores Inbox. Duplicate Undo is blocked.
- Disconnect without reconnect during Undo's token wait suppresses dispatch.
- Expired Undo completion after reconciliation and successor Undo cannot dispatch or overwrite the successor's `undone` status.

Existing selected repository tests: 56/56 passed. These include policy protection overrides, replied/multi-message threads, tenant boundaries, owner lease isolation, fresh post-token authorization and adapter deadline rejection. The existing backend harness replaces `GmailClient` with a proxy; the independent six-case harness closes that evidence gap for the listed cases.

## Source checkpoint

SHA-256 at the inspected checkpoint:

```text
c9c85c86a469727175f7e317f2f2c692e4538521c96872f4dbb2599f2bd1c080  lib/gmail-server.ts
7c1134ffd912c0b54fd67b1c0b796f55ac4785e26f5e4da24b9208fa304c28b1  packages/integrations/gmail.ts
2a912049f0ea6d6a2eb1c1db60de535099a0fc45c3800da0a12cb3118d2d2859  app/api/[...path]/route.ts
35a5749f56454060c457819be1dedb5a1cd1f3f211491714ab54b2554d5cb76c  db/schema.ts
cef6e723e365a02427937e641305af882b6b177734e82063ddef654b64509ee5  drizzle/0002_spotty_bucky.sql
be3dd4255b734724addbc492b54c70afc395b2e8d55874119e286976ab578661  /private/tmp/recovery-dispatch-actual.mjs
```

These are source-specific bounded findings, not certification of production readiness. Only the release manager may declare readiness.

## Correction retest — 2026-10-06T16:14:11Z

**FAIL overall. Original captured-old-token finding: corrected, bounded retest PASS. Two additional high cancellation/account-binding races remain.** Earlier FAIL evidence above is retained intact.

Reviewed correction adds credential generations, rotates them on OAuth success, checks email/generation after token decryption and refresh, fences refresh CAS and final lease renewal with generation, records the cleanup account email, and cancels active plan/job/action owners atomically before disconnect revocation. These checks correctly reject the original delayed-decrypt race, including same-account replacement with a new generation.

Commands:

```sh
node --experimental-strip-types --test tests/backend/dispatch.test.mjs
node --experimental-strip-types --test /private/tmp/recovery-dispatch-retarget.mjs
```

Repository actual-adapter regression assertions: 8/8 passed. The independently extended temporary actual-adapter harness: 10/10 assertions passed; two explicitly confirm defects, so the review is FAIL despite green assertion totals. Fetch remains entirely synthetic. No live accounts/secrets/services or shared Playwright were used. No implementation was edited.

### High: account can change between completed-action lookup and Undo client construction

Component: `lib/gmail-server.ts`, Undo initial action query, client construction, lock, final callback.

The initial SELECT checks `actions.data.accountEmail` against the current credentials email. That SELECT is followed by an awaited `clientFor` credential SELECT. A replacement between them makes the client pin the replacement email/generation. The final callback checks that replacement's generation, but never checks it against the selected action's `accountEmail`. The Undo lock also omits that action-account predicate. Therefore a completed action for mailbox A can dispatch `untrash` and `restoreInbox` against mailbox B if their message IDs coincide.

Exact isolated reproduction: execute the synthetic trash plan; before Undo's `SELECT email,generation FROM credentials` in `clientFor`, change the credential email to `replacement@gmail.example` and generation to `new-generation`; leave the existing completed action with `accountEmail=a@gmail.example`. Undo then returns HTTP 200 and sends both mutations for `m1` while the connection is for the replacement email.

Observed: `REPRO action lookup race status= 200 calls= [["undo","m1"],["restoreInbox","m1"]] connected= replacement@gmail.example action account= a@gmail.example`.

Proposed fix: parse action provenance before constructing the client, require the client-pinned email to equal `accountEmail`, and retain that predicate in the atomic Undo ownership claim and final generation-bound dispatch authorization. Matching before an awaited client construction alone does not fence the operation.

Retest: **FAIL** at this checkpoint; independent reproduction assertion passed. Expected corrected result: zero provider mutations for this interleaving.

### High: already consumed OAuth callback restores credentials after completed disconnect

Component: `lib/gmail-server.ts`, OAuth callback commit and disconnect cancellation.

Callback consumes/deletes its OAuth transaction before awaiting token exchange/profile/encryption. Disconnect removes remaining transactions and credentials, but does not invalidate an already consumed callback's eventual commit. The old callback can therefore recreate credentials and switch source back to Gmail after the user's disconnect completed.

Exact isolated reproduction: insert a synthetic unexpired OAuth transaction; start actual callback and pause its actual adapter profile fetch; complete `gmail/disconnect`, verify zero credential rows; resume synthetic profile fetch. Callback returns HTTP 302 and inserts credentials again.

Observed: `REPRO OAuth callback after disconnect status= 302 credentials restored= a@gmail.example`.

Proposed fix: record a tenant connection/OAuth epoch for each transaction and atomically fence callback commit to that epoch; increment/invalidate the epoch on disconnect. Deleting transactions cannot invalidate callback work that has already consumed its transaction.

Retest: **FAIL** at this checkpoint; independent reproduction assertion passed. Expected corrected result: no recreated credential row and no re-enabled Gmail source after disconnect.

Source checkpoint SHA-256:

```text
12051c025dee0b6f1347f73db88ad8f2eb2826be9ee382b6f89b6103d78d1929  lib/gmail-server.ts
7c1134ffd912c0b54fd67b1c0b796f55ac4785e26f5e4da24b9208fa304c28b1  packages/integrations/gmail.ts
8167f68dd65e465cfe51c38ca56c6fb554b740f25227096e325926206d02c86d  db/schema.ts
a38b43268a3d038aa4e93119b106f91a8b2a72c027016acda09dc5ac7f829e9c  drizzle/0003_talented_talisman.sql
7bcd51e587dbcc49ad87b3e0ac5213e6ae5432a1d3b67f125d57f6346532072d  tests/backend/dispatch.test.mjs
47ad170e9e51600f5e9bd299a9420a62fc3a415c4aa11ec2e5ee12984c9c0eba  /private/tmp/recovery-dispatch-retarget.mjs
```

Required live Gmail/deployment/OAuth boundaries remain UNVERIFIED. This retest is local regression evidence only.

## Epoch/account-lookup correction retest — 2026-10-06T16:17:02Z

**Prior two reproduced defects: bounded PASS. Overall FAIL: one remaining high final dispatch generation gap.** All earlier evidence remains intact.

Repository actual-adapter suite now passes 10/10, including no-dispatch acceptance for the account lookup/client gap and no-reconnect acceptance for the consumed OAuth callback. Independent tests also verify that a newer actual OAuth start fences an older consumed callback's credential/settings/inventory commit, deleted tenants cannot receive callback commits, and a current-epoch callback still connects and rotates credential generation. These three additional checks pass.

The corrected Undo final callback now compares the pinned account email with the action's recorded email, and its atomic claim retains the action/current-credential email predicate. OAuth cleanup, credential upsert, and tenant settings updates are fenced to a live tenant's connection epoch, with disconnect/newer start advancing that epoch. These changes address the prior failures.

### High: final attempting transition omits the credential generation fence

Component: `lib/gmail-server.ts`, execute `authorizeMutation` final `UPDATE actions SET status='attempting',data=?`.

After the final generation-bound lease renewals, execute authorization awaits another database write to move the action into `attempting`. That write checks action owner/status/lease but omits the pinned email/generation. Same-account OAuth replacement rotates the generation without clearing the action owner. If replacement commits while this last database write is awaiting execution, the write succeeds and the callback returns a still-valid lease deadline, so the actual Gmail adapter dispatches the captured old token after replacement.

Exact synthetic reproduction: install `beforeRun` hook for `UPDATE actions SET status='attempting',data=?`; in that hook change the credential generation to `new-final-generation` for the same tenant/email; continue actual route execution. Result: HTTP 200 with `{total:1,skipped:0,failed:0,action:"trash"}`, and one intercepted trash POST. This is an awaited database interleaving, not a theoretical synchronous gap after the adapter deadline check.

Proposed fix: bind the final atomic attempting transition itself to the active tenant and pinned credential email/generation; retain a live owning plan fence as well. Retest must assert zero mutation requests when replacement commits before this final transition executes.

Retest: **FAIL**, reproduced in the last assertion of the independently extended harness.

```sh
node --experimental-strip-types --test tests/backend/dispatch.test.mjs
node --experimental-strip-types --test /private/tmp/recovery-dispatch-final.mjs
```

Results: repository 10/10; independent extended harness 14/14 assertions, with the fourteenth intentionally confirming this remaining defect.

Checkpoint SHA-256:

```text
d9b5b1f6bbdea6963770c61df3cb04041b7a8eccb96c6daa8e93414243ecc9d4  lib/gmail-server.ts
7c1134ffd912c0b54fd67b1c0b796f55ac4785e26f5e4da24b9208fa304c28b1  packages/integrations/gmail.ts
36da0c5dd6e45bd27e8b98b7a14526c91bd4a732885cd1514333a14fc7724c99  db/schema.ts
2fac8a8785526ca58adb0f9467552d5a5f57305f8b722a4a73a71956c0ce4563  tests/backend/dispatch.test.mjs
1d34286410ccd603f2f9a1b68df37711e1282583faf3db9e316b36f2162f2393  drizzle/0004_nostalgic_weapon_omega.sql
```

All tests are synthetic, use intercepted fetch and SQLite, and inspect no real credentials. No implementation edits or shared Playwright runs. Live boundaries remain UNVERIFIED.
