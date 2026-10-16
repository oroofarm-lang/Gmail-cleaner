import { ApiError, binding, config } from "./server";

export function relayConfiguration(origin: string) {
  const extensionId = config("INBOX_EXTENSION_ID") ?? "";
  const configuredOrigin = config("INBOX_EXTENSION_ORIGIN") ?? "";
  const enabled =
    config("INBOX_EXTENSION_RELAY") === "enabled" &&
    /^[a-p]{32}$/.test(extensionId) &&
    /^https:\/\/[^/?#@]+$/.test(configuredOrigin) &&
    configuredOrigin === origin;
  return { enabled, extensionId: enabled ? extensionId : null };
}

export async function relayHash(secret: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

export async function extensionRelay(
  tenant: string,
  origin: string,
  operation: "start" | "approve" | "summary" | "revoke",
  input: { id: string; nonce?: string },
) {
  const db = binding();
  if (operation === "revoke") {
    await db
      .prepare("DELETE FROM extension_devices WHERE tenant=? AND id=?")
      .bind(tenant, input.id)
      .run();
    return { revoked: true };
  }
  if (!relayConfiguration(origin).enabled)
    throw new ApiError(
      503,
      "This dashboard has no configured companion relay.",
    );
  const now = Date.now();
  const hash = await relayHash(input.nonce!);
  if (operation === "start") {
    const existing = await db
      .prepare(
        "SELECT d.status,d.expires FROM extension_devices d JOIN tenants t ON t.id=d.tenant WHERE d.id=? AND d.tenant=? AND d.nonce_hash=? AND d.expires>? AND d.connection_epoch=t.connection_epoch AND t.deleted=0",
      )
      .bind(input.id, tenant, hash, now)
      .first<{ status: string; expires: number }>();
    if (existing)
      return {
        id: input.id,
        expires: existing.expires,
        alreadyApproved: existing.status === "active",
      };
    await db
      .prepare("DELETE FROM extension_devices WHERE tenant=? AND expires<=?")
      .bind(tenant, now)
      .run();
    const result = await db
      .prepare(
        "INSERT OR IGNORE INTO extension_devices(id,tenant,nonce_hash,connection_epoch,status,created,expires) SELECT ?,id,?,connection_epoch,'pending',?,? FROM tenants WHERE id=? AND deleted=0 AND (SELECT COUNT(*) FROM extension_devices WHERE tenant=?)<10",
      )
      .bind(input.id, hash, now, now + 120000, tenant, tenant)
      .run();
    if (!result.meta.changes)
      throw new ApiError(
        409,
        "Pairing already exists or the device limit was reached. Forget this device before trying again.",
      );
    return { id: input.id, expires: now + 120000 };
  }
  if (operation === "approve") {
    const result = await db
      .prepare(
        "UPDATE extension_devices SET status='active',expires=? WHERE id=? AND tenant=? AND nonce_hash=? AND status='pending' AND expires>? AND connection_epoch=(SELECT connection_epoch FROM tenants WHERE id=? AND deleted=0)",
      )
      .bind(now + 30 * 86400000, input.id, tenant, hash, now, tenant)
      .run();
    if (!result.meta.changes)
      throw new ApiError(409, "Pairing expired or changed. Start again.");
    return { approved: true };
  }
  // Single statement checks authorization and projects only bounded aggregates.
  // This is a dashboard-authenticated relay, never a bearer-authenticated API.
  const row = await db
    .prepare(
      `SELECT json_extract(t.settings,'$.source') AS source,
      EXISTS(SELECT 1 FROM credentials WHERE tenant=t.id) AS connected,
      (SELECT COALESCE(SUM(count),0) FROM mail_groups WHERE tenant=t.id AND source=json_extract(t.settings,'$.source') AND status='active') AS total,
      (SELECT COALESCE(SUM(count),0) FROM mail_groups WHERE tenant=t.id AND source=json_extract(t.settings,'$.source') AND status='active' AND protected=1) AS protected,
      (SELECT COUNT(*) FROM actions WHERE tenant=t.id AND source=json_extract(t.settings,'$.source')) AS actions
      FROM tenants t JOIN extension_devices d ON d.tenant=t.id
      WHERE t.id=? AND t.deleted=0 AND d.id=? AND d.nonce_hash=? AND d.status='active' AND d.expires>? AND d.connection_epoch=t.connection_epoch`,
    )
    .bind(tenant, input.id, hash, now)
    .first<{
      source: string;
      connected: number;
      total: number;
      protected: number;
      actions: number;
    }>();
  if (!row)
    throw new ApiError(
      403,
      "Companion approval expired, was revoked or belongs to another connection.",
    );
  const count = (n: number) =>
    Math.max(0, Math.min(1_000_000_000, Math.trunc(Number(n) || 0)));
  return {
    version: 1,
    issued: now,
    expires: now + 120000,
    source: row.source === "gmail" ? "gmail" : "demo",
    connected: !!row.connected,
    total: count(row.total),
    protected: count(row.protected),
    actions: count(row.actions),
  };
}
