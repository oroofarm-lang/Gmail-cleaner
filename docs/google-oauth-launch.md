# Google OAuth public-launch gate

Checked 2026-10-05 against [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes) and [server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).

`gmail.readonly` and `gmail.modify` are restricted Gmail scopes. Start with read-only for scan; request modify only when a user explicitly chooses supported mailbox actions. Do not use `https://mail.google.com/` merely for convenience. Restricted scopes need OAuth verification for a public app; server storage/transmission of restricted-scope data also triggers Google's security assessment requirements, subject to Google's documented applicability and exceptions. A private test deployment is not public verification.

Before submission establish a real Google Cloud project, owned authorized domains, exact HTTPS redirect URI, consent-screen branding, working privacy/terms pages and support contact. Supply a scope justification mapping each scope to visible product behavior, a complete reviewer demo video and test account instructions. Configure production audience and document refresh-token limits/testing expiry. Never promise that a test OAuth client can operate unattended indefinitely.

Implementation gates: session-bound state + PKCE, atomically consume state, reject expired/replayed/wrong-session callbacks, code exchange on server, persist AES-GCM refresh tokens under a managed key, rotate keys safely, distinguish reauth from transient failures, revoke and stop all jobs on disconnect, suppress secrets in error logs. Test real read-only pagination/history invalidation; explicitly approve one trash operation in a disposable account and undo exactly that action. Watch renewal and authenticated Pub/Sub delivery require separate live evidence.

Current outcome: FAIL public launch; credentials, verified consent screen, production redirect exercise, live provider tests and required assessment evidence not established. Adapters and fake-provider tests cannot satisfy these gates. Verification status is set by Google, never by this repository.
