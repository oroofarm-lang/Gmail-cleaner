# Deployment

The connected host is Sites on Cloudflare Workers with D1. `.openai/hosting.json` identifies the private owner-only Site. Never create a second Site when that ID exists. Production source and migrations are packaged from the exact pushed commit through the supplied Sites source workflow; a native deployment tool then publishes the archive. Source deployment artifacts contain no `.env` secrets, test mailbox data or dev auth middleware.

Use host secret management for Google/OpenAI credentials. Google authorized redirect must match the final deployed origin exactly. A successful native deployment verifies upload/provisioning, not live OAuth or mailbox mutation. Deployed QA requires independent app/API/auth/database checks; private gateway may require owner sign-in.

Run public release gates before broad sharing. Private engineering-preview checks are explicitly scoped and cannot waive live-mail blockers. Release checker returns failure for public launch while blockers remain. GitHub Actions CI should run on the owner repository; no hosted CI success is claimed until its run is observed.

## Scheduled Worker packaging

Build-time `INBOX_BUILD_SYNC_CRON=true` includes a one-minute native cron trigger in the generated Worker configuration. Default builds contain no trigger. Apply migration0007 and configure runtime secrets/flag only through the approved host flow. Check the host accepts/preserves native scheduled exports and trigger configuration; source packaging alone is insufficient. Activation requires authorized live service changes and a dedicated authorized Gmail test account. Local tests use isolated D1 and blank provider keys. No deployment/cron activation was performed for this checkpoint.
