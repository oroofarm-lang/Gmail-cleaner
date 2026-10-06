import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { DEFAULT_SETTINGS, demoGroups } from "./demo";
export function binding() {
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db)
    throw new ApiError(
      503,
      "The database is unavailable. Please try again shortly.",
    );
  return db;
}
export function config(name: string) {
  return (env as unknown as Record<string, string>)[name] ?? process.env[name];
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function tenant() {
  const user = await getChatGPTUser();
  if (!user) throw new ApiError(401, "Sign in to continue.");
  const db = binding();
  await db
    .prepare(
      "INSERT OR IGNORE INTO tenants(id,settings,created,deleted) VALUES(?,?,?,0)",
    )
    .bind(user.userId, JSON.stringify(DEFAULT_SETTINGS), Date.now())
    .run();
  const t = await db
    .prepare("SELECT * FROM tenants WHERE id=?")
    .bind(user.userId)
    .first<{ settings: string; deleted: number }>();
  if (t?.deleted)
    throw new ApiError(
      403,
      "This account was deleted. Account recreation requires an explicit new signup.",
    );
  return {
    id: user.userId,
    email: user.email,
    settings: JSON.parse(t?.settings ?? "{}") as typeof DEFAULT_SETTINGS,
  };
}
export function mutationGuard(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin || origin !== new URL(req.url).origin)
    throw new ApiError(403, "Refresh the app and try again.");
  if (!req.headers.get("content-type")?.startsWith("application/json"))
    throw new ApiError(415, "A JSON request is required.");
}
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
export async function seedDemo(id: string) {
  const db = binding();
  const existing = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM mail_groups WHERE tenant=? AND source=?",
    )
    .bind(id, "demo")
    .first<{ n: number }>();
  if (existing?.n) return;
  const now = Date.now();
  await db.batch(
    demoGroups.map((g, i) =>
      db
        .prepare(
          "INSERT OR IGNORE INTO mail_groups(id,tenant,source,sender,address,category,count,bytes,oldest,newest,protected,revision,list_id,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          `${id}:demo:${i}`,
          id,
          "demo",
          g[0],
          g[1],
          g[2],
          g[3],
          g[4],
          now - 1500 * 86400000,
          now - 220 * 86400000,
          g[5],
          0,
          ["newsletter", "promotion"].includes(g[2]) ? g[1] : null,
          "active",
        ),
    ),
  );
}
export async function record(
  id: string,
  source: string,
  kind: string,
  data: unknown,
  status = "success",
  planId: string | null = null,
) {
  await binding()
    .prepare(
      "INSERT INTO actions(id,tenant,source,plan_id,kind,data,created,status) VALUES(?,?,?,?,?,?,?,?)",
    )
    .bind(
      crypto.randomUUID(),
      id,
      source,
      planId,
      kind,
      JSON.stringify(data),
      Date.now(),
      status,
    )
    .run();
}
export async function state(t: Awaited<ReturnType<typeof tenant>>) {
  const db = binding(),
    source = t.settings.source;
  const [g, a, r, j, c] = await Promise.all([
    db
      .prepare(
        "SELECT * FROM mail_groups WHERE tenant=? AND source=? ORDER BY count DESC LIMIT 100",
      )
      .bind(t.id, source)
      .all(),
    db
      .prepare(
        "SELECT id,kind,data,created,status,plan_id FROM actions WHERE tenant=? AND source=? ORDER BY created DESC LIMIT 50",
      )
      .bind(t.id, source)
      .all(),
    db
      .prepare(
        "SELECT id,command,compiled,enabled,authorized,created FROM rules WHERE tenant=? ORDER BY created DESC LIMIT 100",
      )
      .bind(t.id)
      .all(),
    db
      .prepare(
        "SELECT id,processed,status,updated FROM jobs WHERE tenant=? AND source=? ORDER BY updated DESC LIMIT 1",
      )
      .bind(t.id, source)
      .first(),
    db
      .prepare("SELECT email,updated FROM credentials WHERE tenant=?")
      .bind(t.id)
      .first(),
  ]);
  const stats = await db
    .prepare(
      `SELECT COALESCE(SUM(count),0) total,COALESCE(SUM(CASE WHEN protected=0 AND category IN ('newsletter','promotion','notification') THEN count ELSE 0 END),0) safe,COALESCE(SUM(CASE WHEN protected=0 AND category IN ('newsletter','promotion','notification') THEN bytes ELSE 0 END),0) bytes,COALESCE(SUM(CASE WHEN protected=1 THEN count ELSE 0 END),0) protected,COALESCE(SUM(CASE WHEN protected=0 AND category='unknown' THEN count ELSE 0 END),0) review,COUNT(*) groupCount FROM mail_groups WHERE tenant=? AND source=? AND status IN ('active','unsubscribed')`,
    )
    .bind(t.id, source)
    .first();
  return {
    stats,
    groups: g.results,
    activity: a.results.map((x) => ({
      ...x,
      data: JSON.parse(String(x.data)),
    })),
    rules: r.results.map((x) => ({
      ...x,
      compiled: JSON.parse(String(x.compiled)),
    })),
    job: j,
    connection: c,
    settings: t.settings,
    user: { email: t.email },
    capabilities: {
      gmailOAuth: !!(
        config("GOOGLE_CLIENT_ID") &&
        config("GOOGLE_CLIENT_SECRET") &&
        config("TOKEN_ENCRYPTION_KEY")
      ),
      ai: !!(config("OPENAI_API_KEY") && config("OPENAI_MODEL")),
      guardian: false,
      extensionPairing: false,
    },
  };
}
