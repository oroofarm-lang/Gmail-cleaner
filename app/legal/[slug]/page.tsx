import Link from "next/link";
const content: Record<string, { title: string; paragraphs: string[] }> = {
  privacy: {
    title: "Privacy, in plain language.",
    paragraphs: [
      "Private engineering preview — legal review and controller contact details are required before public launch.",
      "Inbox Agent stores message metadata, derived safety signals, approved rules, preferences and an activity trail. OAuth tokens are encrypted on the server and never sent to the browser. Raw message bodies are not stored.",
      "Privacy Mode uses deterministic metadata analysis. Smart Mode permits explicitly requested limited metadata analysis through OpenAI. Customer Gmail content is never used to train product models.",
      "Sites and Cloudflare host the app and relational database; Google provides Gmail access. OpenAI is a processor only when configured and Smart Mode is used. Provider contracts, processing regions and backup deletion commitments need verification.",
      "Disconnect revokes Google access where the provider confirms it and removes local credentials. If revocation fails, the app directs you to Google Account connections. Deleting app data removes owned analysis, rules and activity, not Gmail messages. A deleted-account marker remains to prevent silent recreation.",
      "No third-party analytics or tracking pixels are included. Authentication uses necessary session cookies supplied by the hosting gateway.",
    ],
  },
  terms: {
    title: "Your inbox. Your call.",
    paragraphs: [
      "Draft terms for a private engineering preview, not final commercial terms. Operator identity, support details, jurisdictions and contract review must be completed before launch.",
      "You approve cleanup plans and rules. Inbox Agent uses Gmail Trash or archive; it does not permanently delete messages. Recommendations may be wrong. Review the selected messages before approving.",
      "Google controls message recovery and normally removes Trash after 30 days. The app cannot promise recovery beyond Gmail’s limits.",
      "Do not use the service to access accounts without permission. No availability, data retention or recovery SLA has been established for this preview.",
    ],
  },
  accessibility: {
    title: "Built to be readable.",
    paragraphs: [
      "Accessibility target: WCAG 2.2 AA. Automated checks and keyboard testing are part of engineering verification; they do not constitute legal certification.",
      "The interface uses semantic headings, labelled controls, native dialogs, visible keyboard focus and reduced-motion preferences. Sticker collage remains decorative; meaningful text sits on opaque high-contrast surfaces.",
      "Public accessibility statement needs an accountable contact and qualified review, including applicable Israeli requirements before local launch. Report access problems to the operator once its support address has been configured.",
    ],
  },
  security: {
    title: "Good mail deserves protection.",
    paragraphs: [
      "Server-side tenant checks protect every mailbox operation. Cleanup plans expire, require approval and recheck metadata, reply history, attachments and protected senders. Permanent deletion is not implemented.",
      "OAuth uses session-bound single-use state and PKCE. Tokens use account-bound AES-GCM encryption. Client applications and the extension contain no provider secrets.",
      "Unsubscribe links are treated as attacker-controlled. Automated outbound unsubscribe is disabled until a transport can prove safe DNS and redirect handling.",
      "Native Codex Security scan could not start in this session. Manual adversarial tests were executed; gateway ingress controls and live-provider flows still require verification.",
      "Responsible disclosure: support/security contact must be established before public launch. Do not test other users’ data or perform destructive tests on live mailboxes.",
    ],
  },
  "ai-disclosure": {
    title: "AI suggests. You decide.",
    paragraphs: [
      "The demo assistant and exact rule compiler are deterministic. Where OpenAI is configured and Smart Mode is explicitly enabled, limited metadata analysis may be requested. No model can execute Gmail actions directly.",
      "Mail content is untrusted data. Model output is schema-validated and cannot remove a deterministic protection or turn off a safety rule. Every destructive operation goes through separate policy and approval checks.",
      "No customer Gmail content is used to train product models. AI processing is optional and disabled in Privacy Mode. Model IDs are controlled by server configuration.",
    ],
  },
};
export default async function Legal({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const doc = content[slug] ?? {
    title: "Document unavailable.",
    paragraphs: ["This document is not published. Return to the workspace."],
  };
  return (
    <main className="legal-page">
      <Link className="text-button" href="/?view=settings">
        ← Back to settings
      </Link>
      <div className="eyebrow">INBOX AGENT / ENGINEERING PREVIEW</div>
      <h1>{doc.title}</h1>
      {doc.paragraphs.map((p) => (
        <p key={p}>{p}</p>
      ))}
      <p className="muted">
        Last reviewed 6 October 2026. Draft; qualified review remains required.
      </p>
    </main>
  );
}
