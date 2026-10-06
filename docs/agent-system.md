# Repository review system

The twelve files in `agents/` are reusable repository-specific reviewer instructions, not automatically installed Codex skills. Invoke each in a fresh independent context with the final source tree and the diff; do not pass another reviewer's conclusion. The release manager aggregates evidence after all eleven specialist reports exist. Only it may declare `READY FOR RELEASE`.

Every report must record PASS/FAIL, findings, severity, affected component, exact reproduction command or steps, proposed fix and retest result. PASS means the bounded checks passed, not certification of the whole product. Untested live systems must be marked UNVERIFIED and fail their launch gate. Preserve reports under `docs/reviews/` with UTC timestamp and commit or source hash. A specialist must not waive another specialist's failure.

Architecture: React 19 UI, Vinext 1.0.1 on Sites/Cloudflare Workers, D1/SQLite tenant data, deterministic core, fixed-origin Gmail/OpenAI adapters, minimal MV3 dashboard companion. Authentication derives from the Sites gateway; no browser-supplied tenant identity. Demo aggregates represent synthetic messages and are not real mailbox mutation evidence. Live OAuth, background scheduling, Gmail action transactions, AI consent and extension pairing require end-to-end evidence.

Native security workflows may supplement these files. Reusable Markdown alone does not prove that all twelve reviewers ran independently. Release checklist requires the actual outputs.
