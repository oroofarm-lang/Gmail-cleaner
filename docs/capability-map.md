# Capability discovery — 2026-10-05

|Capability|Connected tool|Used?|Fallback / limit|
|GitHub|GitHub connector; authenticated oroofarm-lang|Read verified|Owner subsequently created oroofarm-lang/Gmail-cleaner and authorized its use. Implementation published via the GitHub connector to codex/sticker-bomb; remote source-tree hash verified against local. Shell Git write credentials are unavailable. Sites has a separate managed source repository.|
|Hosting|Sites / Cloudflare Workers|Selected|Private owner-only deployment; D1 database.|
|Security|Codex Security plugin and skills|Available|Independent local review and adversarial tests; launch scan after source is complete.|
|Browser|Native in-app browser and Node REPL|Available|Playwright local QA and screenshots.|
|Database|Sites D1, Drizzle|Selected|SQLite relational store with explicit tenant keys.|
|AI|Built-in tools; no app OpenAI credential established|Integration|Responses API adapter; deterministic assistant in demo, clearly disclosed.|
|Gmail|No Gmail connector installed; OAuth credentials not established|Integration|Direct Gmail REST API and fake adapter for safety testing.|
|Design|Local CSS/SVG, original assets|Selected|Sticker Bomb: monochrome image collage, black labels and rare blood-red accents.|
|Observability|No dedicated monitoring provider verified|Local|Privacy-safe structured events and health endpoint.|
|Accessibility|Local automated tools|Planned|axe, keyboard/browser tests, manual checklist.|
|Compliance|Official documentation research|Planned|Drafts and readiness review; no legal certification.|
|CI|GitHub Actions definitions|Planned|Local mandatory commands; hosted CI cannot be claimed without repository execution.|
|Documentation|Local Markdown|Selected|No external workspace writes needed.|

Tool availability does not establish third-party credentials or successful live integration.

Native Codex Security Standard scan could not start: "The selected scan target changed while the scan was starting. Try again." Per skill, no replacement workflow was started. Manual independent source/SQLite adversarial tests are a separate fallback, not native scan certification.
