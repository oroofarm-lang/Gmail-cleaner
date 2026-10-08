# Independent security review and primary retest

Native Codex Security Standard scan did not start: "The selected scan target changed while the scan was starting. Try again." The scan skill prohibited replacement workflow; no scan ID or certification was produced. The integration reviewer then performed a separately authorized manual source/runtime review with actual route code and SQLite transactions.

The reviewer identified a HIGH token refresh/reconnect race: account A refresh could overwrite newly connected account B credentials. Fix: compare-and-swap update constrained by tenant, pinned email and prior encrypted envelope; refuse returning old token if claim fails. Adversarial fixture swaps accounts exactly while provider refresh waits. Retest PASS in `tests/security/backend.test.mjs`.

Actual security tests: authentication absence, foreign-origin mutation, cross-tenant groups/plans/actions/rules, forged plan fields, stale protection, MIME/reply/starred safety, replay idempotency, single-use session-bound OAuth state, local credential removal on revoke failure, and refresh/reconnect race. Final primary retest: 8/8 PASS against actual TypeScript routes, schema SQL and mocked provider calls.

Scope limits: fixture authentication does not verify private hosting gateway identity-header stripping or private worker ingress. Real Google authorization/mutations/revocation and AI behavior remain untested without owner configuration. Source tests cannot certify public release. Browser/extension sessions and production D1 distributed races remain separate checks.

Status: bounded manual controls PASS; full real-mail release FAIL until production ingress and provider checks, unattended worker/recovery controls and external approvals are evidenced. Dependency audit is handled separately in release report. No claim of native security scan completion.
