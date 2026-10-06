# Delivery and release evidence — 2026-10-06

## PRODUCT

Inbox Agent includes inbox reports, conservative cleanup previews, reversible Trash/Archive with Undo, protection controls, rule approval, subscriptions inventory, activity, settings, privacy export/deletion, demo onboarding and draft legal pages. The demo is explicitly synthetic. The accepted Sticker Bomb design replaces the earlier lime/pop palette: clean working screens, a single original collage asset in selected areas, black square labels, blood-red accents and eye badges. No garment artwork was copied from the reference.

## ARCHITECTURE

React 19, Next 16 APIs on Vinext 1.0.1 / Cloudflare Workers, D1 with Drizzle migrations, tenant-scoped server APIs, deterministic safety policy, OAuth PKCE and authenticated encrypted credentials. Gmail REST and optional OpenAI Responses adapters have mocked provider tests; no live-mail success is asserted.

## AGENTS

Twelve reviewer/manager instructions are in `agents/`. Three independent agents contributed core safety, integrations and extension/privacy documentation. Source review reports are in `docs/reviews/`. These are bounded reviews; eleven separate independent final release reviews have not been executed. Native Codex Security scan failed to start and is not counted as a passed scan.

## CONNECTED CAPABILITIES

Sites was used to provision one owner-only private site and initialize its source workflow. GitHub repository access was verified. Native browser tooling inspected the signed-out page, original collage and authenticated report. Playwright Chromium executed the approved synthetic-login workflows. The technical-debugging and Sites skills guided setup. No Gmail/OpenAI app credentials were established.

## GITHUB

Target repository: https://github.com/oroofarm-lang/Gmail-cleaner. The complete implementation is published on `codex/sticker-bomb` at commit `120eb514639ef2f21eac639c7f39976834b74144`. Its tree SHA `da9fece47b57846e914c12eeda975baa57f660d3` was fetched from GitHub and exactly matches the tested local source tree. `main` contains the initial README only. Shell Git write credentials were unavailable; publication used the authenticated GitHub connector. Quality-gate and CodeQL workflows are included. No hosted CI success is asserted.

## DEPLOYMENT

Local preview: http://127.0.0.1:5173/. Site reserved: https://inbox-agent-mail-clean.berry-bay-1066.chatgpt.site (project `appgprj_6ac3cbc44a9c81919a5c2b4b92e83a23`). No deployed version has been certified. Native Sites deployments are production deployments even when access is private; unresolved live-integration, operational and release-review gates prevent production certification.

## TESTS

Executed locally: 40/40 core, provider, backend, dependency and extension tests; 10/10 security/extension checks; ESLint; TypeScript; Prettier; production web build; extension build. Clean `npm ci` and the final format, lint, typecheck and production build also passed. Five browser scenarios passed after explicit user authorization for local synthetic sign-in: cleanup/Undo, approved rule persistence, desktop light/dark accessibility, responsive reports, and all-screen mobile accessibility/keyboard/reflow. The first runs exposed test synchronization/selectors plus missing mobile button name and dialog Tab-boundary handling; both product defects were fixed and the complete suite re-run successfully. Test counts overlap where the security command repeats extension checks.

## SECURITY

The starter's vulnerable framework/runtime versions were upgraded as a compatible set. The remaining upstream braces recursion advisory was fixed with a bounded local MIT fork, with malicious nesting/expansion and compatibility regression tests. This is a code mitigation, not an audit severity waiver. Last resolved-tree audit: zero high/critical advisories; eight moderate advisories in transitive dependencies remain for follow-up. Full independent production security certification is incomplete.

## GMAIL SAFETY

Executed backend tests cover tenant isolation, forged input, approval expiry/staleness, newly protected senders, starred/attachment/replied-thread protection, metadata changes, account switching, concurrent plans, duplicate execution, Undo, OAuth state replay and deletion boundaries. Live operations are bounded and reversible. Uncertain provider mutations are retained for reconciliation rather than blindly retried. No real mailbox was modified during verification.

## AI RED TEAM

Executed tests ensure mail instructions cannot call tools or replace deterministic policy, strict schema/refusal/incomplete output fail safely and protected classifications cannot be downgraded. Live model behavior and a full adversarial model evaluation remain unverified.

## ACCESSIBILITY

Source includes skip navigation, labels, focus handling, reduced-motion behavior and native dialogs. Sticker Bomb text uses opaque black/white labels; essential compact labels were enlarged. Executed axe checks found zero violations on nine desktop screens in light and dark modes and nine mobile screens at 390/320px. A 12-step dialog Tab cycle, Escape dismissal, hidden mobile sidebar focus exclusion, keyboard navigation and reduced-motion transition suppression passed. No full WCAG certification is claimed: manual screen-reader, assistive technology and complete zoom checks remain required.

## VISUAL QA

The signed-out state and original SVG collage were inspected in the native browser. Authenticated report screenshots and overflow checks passed at 1600/1280/768/390/320px. All nine screens were captured and checked for overflow at 390/320px, together with dark settings. Desktop/mobile report layouts were visually inspected. Reference image guided style only. A screenshot of the collage alone cannot certify the application layout.

## PERFORMANCE

Actual synthetic run: 10k messages — generation 4ms, aggregation 19ms, heap 14MiB; 50k — 18ms, 53ms, 45MiB; 100k — 17ms, 119ms, 76MiB. These measure local core aggregation, not live Gmail scanning throughput, production memory or browser responsiveness.

## CHROME EXTENSION

MV3 dashboard companion builds successfully with sidePanel/storage and no mailbox host permissions, content scripts or remote code. Secure pairing and live mailbox workflows are incomplete. Chrome Web Store approval is not obtained.

## PRIVACY

Data map, retention/deletion controls and provider configuration notes exist. Raw bodies are excluded from safety inventory and product analytics. Optional AI sends metadata only after explicit smart-mode approval. Export/deletion and credential disconnection have backend tests. Production retention scheduling and operational verification remain required.

## GOOGLE

OAuth/PKCE, refresh, encrypted storage and account-binding behavior are implemented and mocked tests pass. Owner must configure Google Cloud OAuth credentials, consent screen and exact redirect URL; restricted-scope verification/security assessment may be required. Live connection and recovery have not been tested.

## LEGAL/POLICY

Privacy, terms, accessibility, security and AI disclosures are drafts. Legal/controller/support details require the owner and qualified external review. No compliance or legal certification is claimed.

## REMAINING MANUAL ACTIONS

Provide provider credentials through secret management, authorize a disposable test mailbox, finalize legal/business details and submit external Google/Chrome approvals. Coding tasks also remain: worker scheduling/PubSub, safely constrained automatic unsubscribe, extension pairing, production authentication/operational recovery verification and the full release-review council. These are engineering blockers, not merely external manual actions.

## RELEASE STATUS

NOT READY

Build and bounded safety tests pass. Automated UI checks now pass. Live integration, manual accessibility, operational and independent review gates remain incomplete, together with technical features listed above. This does not meet TECHNICALLY READY — EXTERNAL APPROVAL REQUIRED.
