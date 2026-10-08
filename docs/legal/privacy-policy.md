# Privacy Policy

Draft status: private engineering preview, 2026-10-05. Not an approved public notice or legal certification. Provider legal name, registered address, privacy/support contact and applicable terms require owner completion and qualified review before public real-mail launch. Owner fields have not been invented.

## Who operates this service

Inbox Agent is the product name. The actual controller's legal identity, postal address and privacy contact have not been supplied. Public use must wait until these are provided and this notice is approved.

## What the current preview does

Inbox Agent analyzes Gmail metadata to identify cleanup candidates and protect important messages. Users authenticate through the Sites hosting gateway. Demo mode stores synthetic sender groups representing a 24,000-message inbox; it never acts on real mail. The Gmail path requires owner-configured Google OAuth and server encryption secrets; it has not been certified or proven against a live mailbox in this preview.

When users authorize live Gmail functionality, the server may store account email address; message identifier/thread, sender and subject; dates, labels, size, mailing-list/unsubscribe headers and reply/attachment signals; classifications; protections/preferences; rules; inventory progress; plans and per-message actions. The current scanner requests metadata; routine cleanup does not need message bodies or attachments. OAuth tokens are held server-side in an encrypted authenticated envelope, not browser or extension storage.

The local Chrome companion stores only your configured HTTPS dashboard address on your device. It does not read Gmail, scrape websites or call a mailbox API. Opening a link navigates to the authenticated dashboard. Forget address or uninstall clears the saved address.

## Purpose and sharing

We use data to provide the inbox functions you choose, apply safety protections, show action history and operate securely. We do not sell Google data, target ads with it or use it to train product models. The current assistant is deterministic and does not call the optional OpenAI adapter, even if a provider key is configured. Smart Mode is a preference awaiting a complete live AI path; do not interpret it as a guarantee that a request used a model.

The implemented OpenAI analysis feature remains disabled pending completed processor review and live validation. Settings requests versioned, purpose-specific consent, followed by separate confirmation for each message. The classifier shares sender domain, capped partially redacted subject and standard Gmail labels; bodies, snippets, attachments, custom labels and account identity are excluded. Commands and subjects may still contain confidential personal information. Redaction is not anonymization. Sharing can be revoked; previously dispatched requests cannot be recalled. `store:false` is not a guarantee of zero provider retention. New processing must update this notice first.

Potential infrastructure providers are the Sites hosting/auth platform and Cloudflare Workers/D1, with Google as the mailbox/OAuth provider and OpenAI only if an optional API path is later activated. Actual contractual entities, regions, DPA and retention are unverified; see the draft processor inventory. No advertising/analytics processor is configured by this preview.

## Your choices and data rights

Use Settings to export settings/rules, disconnect/revoke Google access, delete stored app data or delete the account. The current export is preferences/rules, not a complete personal-data access export. Disconnect revokes access and cancels Gmail jobs/plans; stored analysis remains until deletion. Deleting local data leaves your Gmail contents unchanged and requires disconnect first. Account deletion disables reuse; an explicit new signup path is not yet implemented. You can also revoke access from your Google account.

The preview has no verified automatic retention purge or backup deletion SLA. See the retention draft for current limits and proposed policy. Rights/access/correction/deletion requests require the owner-provided privacy contact before public launch. Backup regions, deletion timing and restore behavior must be measured before promises are published.

## Google Limited Use

Intended production commitment: Inbox Agent's use and transfer of Google API information will adhere to the Google API Services User Data Policy and Chrome Web Store User Data Policy, including their Limited Use requirements. Human access requires an applicable disclosed exception such as explicit support consent, security necessity or legal obligation. This draft commitment is not Google approval.

## Changes

Material changes to data purposes/recipients must be reviewed and communicated before activation. Public launch remains blocked until controller/contact facts, processor agreements, legal review and actual lifecycle evidence are complete.
