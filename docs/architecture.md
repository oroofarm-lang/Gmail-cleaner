# Inbox Agent architecture

React 19 App Router UI on the connected Sites Vinext/Cloudflare Workers runtime. This hosting-compatible Next.js implementation uses Vinext 1.0.1; production API compatibility requires validation. D1/SQLite with Drizzle migrations is chosen over PostgreSQL to use the connected host's actual relational capability.

Authenticated identity comes from the Sites gateway, never a browser-provided tenant parameter. Every database query scopes to that identity. Private deployment starts owner-only; future customers require a verified audience/auth rollout. Demo and Gmail records are partitioned by source. Demo stores synthetic aggregate groups and actual per-action records; a 20,000+ fixture is generated for scale tests without rendering every message.

Boundaries: UI -> authenticated same-origin route -> strict request schema -> tenant repository -> policy -> Gmail adapter -> activity. Email data is untrusted. Models propose typed rules; deterministic policy has final authority. Trash only, no permanent delete. Cleanup plans expire; execution rechecks fresh metadata and protection. Durable idempotency keys and per-message action records prevent replay. Undo only restores actions actually moved by this app.

OAuth uses state bound to authenticated session, PKCE, encrypted server-side refresh tokens, no client keys. Gmail inventory is paginated; persistent cursor and message upserts allow replay after interruption. Incremental history retains last committed history id. Jobs are bounded per invocation; hosting scheduling support must be verified before declaring unattended processing functional.

Separate reusable TypeScript core and integration packages support a minimal Manifest V3 side panel. The extension has no email scraping, API keys or private credentials; it links to the authenticated dashboard and uses explicit pairing if API access is implemented.

Release is evidence-based. Live Google OAuth, AI calls, push events and store certification remain unverified until configured and exercised. Demo passing cannot waive missing production validation.
