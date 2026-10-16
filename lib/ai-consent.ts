import { ApiError, binding, config } from "./server";
export const AI_CONSENT_VERSION = 1;
export function aiReady() {
  return (
    config("AI_PROCESSING") === "enabled" &&
    !!config("OPENAI_API_KEY") &&
    !!config("OPENAI_MODEL")
  );
}
type Consent = { epoch: string; scope: string; model: string };
export async function aiConsent(
  tenantId: string,
  purpose: "commands" | "metadata",
  requireSmart = true,
): Promise<Consent> {
  if (!aiReady())
    throw new ApiError(
      503,
      "AI processing is unavailable. Privacy Mode remains available.",
    );
  const row = await binding()
    .prepare(
      "SELECT c.epoch,c.scope,c.model FROM ai_consents c JOIN tenants t ON t.id=c.tenant WHERE c.tenant=? AND c.enabled=1 AND c.version=? AND t.deleted=0 AND (?=0 OR json_extract(t.settings,'$.privacy')='smart')",
    )
    .bind(tenantId, AI_CONSENT_VERSION, Number(requireSmart))
    .first<Consent>();
  if (
    !row ||
    !["commands", "metadata"].includes(row.scope) ||
    row.model !== config("OPENAI_MODEL") ||
    (purpose === "metadata" && row.scope !== "metadata")
  )
    throw new ApiError(
      403,
      "Review and approve AI sharing in Settings before this request.",
    );
  return row;
}
export async function consentGuard(
  tenantId: string,
  purpose: "commands" | "metadata",
) {
  const initial = await aiConsent(tenantId, purpose);
  return async () => {
    const current = await aiConsent(tenantId, purpose);
    if (current.epoch !== initial.epoch)
      throw new ApiError(
        403,
        "AI sharing consent changed. Review a new request.",
      );
  };
}
export async function saveAiConsent(
  tenantId: string,
  enabled: boolean,
  scope: "commands" | "metadata",
) {
  const db = binding(),
    epoch = crypto.randomUUID();
  if (enabled && !aiReady())
    throw new ApiError(
      503,
      "The operator must approve and configure AI processing first.",
    );
  if (enabled) {
    const saved = await db.batch([
      db
        .prepare(
          "INSERT INTO ai_consents(tenant,enabled,version,scope,model,epoch,updated) SELECT ?,1,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM tenants WHERE id=? AND deleted=0) ON CONFLICT(tenant) DO UPDATE SET enabled=1,version=excluded.version,scope=excluded.scope,model=excluded.model,epoch=excluded.epoch,updated=excluded.updated",
        )
        .bind(
          tenantId,
          AI_CONSENT_VERSION,
          scope,
          config("OPENAI_MODEL")!,
          epoch,
          Date.now(),
          tenantId,
        ),
      db
        .prepare(
          "UPDATE tenants SET settings=json_set(settings,'$.privacy','smart') WHERE id=? AND deleted=0 AND EXISTS(SELECT 1 FROM ai_consents WHERE tenant=? AND epoch=? AND enabled=1)",
        )
        .bind(tenantId, tenantId, epoch),
    ]);
    if (!saved.at(-1)?.meta.changes)
      throw new ApiError(
        409,
        "Account or consent changed. Review Settings again.",
      );
  } else {
    await db.batch([
      db
        .prepare(
          "UPDATE ai_consents SET enabled=0,epoch=?,updated=? WHERE tenant=?",
        )
        .bind(epoch, Date.now(), tenantId),
      db
        .prepare(
          "UPDATE tenants SET settings=json_set(settings,'$.privacy','privacy') WHERE id=?",
        )
        .bind(tenantId),
    ]);
  }
  return { saved: true, enabled, scope };
}
