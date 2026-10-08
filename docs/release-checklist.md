# Release evidence checklist

Only `agents/release-manager.md` may declare READY FOR RELEASE. This repository's default is NOT READY for public real-mail release until every gate has evidence.

- Reproducible dependency install, lint, typecheck, core/integration/extension tests and application/extension build succeed on final source.
- Independent security, Gmail safety, accessibility, visual QA, privacy, compliance, AI red team, performance, Chrome, code quality and product UX reports include reproduction and retest.
- Browser evidence covers all views, mobile/reflow, keyboard, screen reader, dialogs and honest mode/status/error behavior.
- Authenticated gateway denial and cross-tenant/source isolation pass on deployed runtime; public audience verified.
- Real disposable Gmail account exercises OAuth/PKCE/replay, paginated scan/history recovery, fresh protected-message recheck, trash/partial failures/idempotency and exact undo.
- Scheduled jobs, watch renewal and Pub/Sub verification pass; quotas/cost bounds and pause controls work.
- AI sharing requires consent, fixed configured provider/model, bounded metadata and policy-reviewed retention; no model action authority.
- Extension live Chrome installation/link/forget/permission checks pass; pairing is not advertised.
- Public policy/terms/accessibility/contact pages and processor/retention facts approved; Google OAuth verification/security assessment and Chrome review completed where required.
- Secret/dependency review, token rotation/revoke, account export/deletion, log redaction, alert delivery and disaster recovery/tombstone drill pass.
- Verified hosting URL, rollback instructions, support owner and final artifact/version recorded. Private demo deployment is labelled distinctly.

Missing credentials, permissions, legal facts or live review evidence are blockers; document them with owner and fix. A test fixture, completed draft or successful deployment cannot substitute for its corresponding launch gate.
