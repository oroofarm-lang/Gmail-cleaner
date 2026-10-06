import { z } from "zod";
import {
  ApiError,
  binding,
  tenant,
  mutationGuard,
  json,
  seedDemo,
  state,
  record,
  config,
} from "@/lib/server";
import { DEFAULT_SETTINGS, type MailGroup } from "@/lib/demo";
import { compileRule } from "@/packages/core";
import { interpretCommand, OpenAIClassifier } from "@/packages/integrations";
import { classify } from "@/packages/core";
import { gmailRoute } from "@/lib/gmail-server";
const idSchema = z.string().min(1).max(300);
async function handle(req: Request) {
  try {
    const path = new URL(req.url).pathname.replace(/^\/api\//, "");
    if (path === "health")
      return json({
        status: "ok",
        service: "inbox-agent",
        database: !!(await binding().prepare("SELECT 1 AS alive").first()),
        liveGmail: "requires configured OAuth",
        guardian: "not scheduled",
      });
    if (req.method === "POST") mutationGuard(req);
    const t = await tenant(),
      db = binding();
    if (path.startsWith("gmail/") || path.startsWith("oauth/"))
      return await gmailRoute(req, path, t);
    if (path === "state" && req.method === "GET") return json(await state(t));
    if (req.method !== "POST")
      throw new ApiError(404, "This page could not be found.");
    const body = await req.json();
    if (path === "demo") {
      await db
        .prepare("UPDATE tenants SET settings=? WHERE id=?")
        .bind(JSON.stringify({ ...t.settings, source: "demo" }), t.id)
        .run();
      await seedDemo(t.id);
      return json(
        await state({ ...t, settings: { ...t.settings, source: "demo" } }),
      );
    }
    if (path === "scan") {
      if (t.settings.source !== "demo")
        throw new ApiError(409, "Use Gmail scan for your connected mailbox.");
      await seedDemo(t.id);
      await record(t.id, "demo", "scan", {
        message: "Synthetic inbox inventory completed",
        count: 24000,
      });
      return json({ completed: true, count: 24000 });
    }
    if (path === "preview") {
      const input = z
        .object({
          ids: z.array(idSchema).min(1).max(100),
          action: z.enum(["trash", "archive"]).default("trash"),
        })
        .strict()
        .parse(body);
      if (t.settings.source !== "demo")
        throw new ApiError(
          409,
          "Live Gmail cleanup requires a message-level plan.",
        );
      const rows = await db
        .prepare(
          `SELECT * FROM mail_groups WHERE tenant=? AND source=? AND id IN (${input.ids.map(() => "?").join(",")})`,
        )
        .bind(t.id, "demo", ...input.ids)
        .all<MailGroup>();
      const safe = rows.results.filter(
        (g) =>
          g.status === "active" &&
          !g.protected &&
          ["newsletter", "promotion", "notification"].includes(g.category),
      );
      if (!safe.length)
        throw new ApiError(
          409,
          "No safe candidates matched. Protected and uncertain mail stays.",
        );
      const id = crypto.randomUUID(),
        expires = Date.now() + 900000;
      const data = {
        groups: safe.map((g) => ({
          id: g.id,
          sender: g.sender,
          count: g.count,
          bytes: g.bytes,
          revision: g.revision,
        })),
        action: input.action,
        total: safe.reduce((n, g) => n + g.count, 0),
        bytes: safe.reduce((n, g) => n + g.bytes, 0),
        excluded: rows.results.filter((g) => !safe.includes(g)).length,
      };
      await db
        .prepare(
          "INSERT INTO plans(id,tenant,source,data,status,created,expires) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          t.id,
          "demo",
          JSON.stringify(data),
          "pending",
          Date.now(),
          expires,
        )
        .run();
      return json({ id, ...data, expires });
    }
    if (path === "execute") {
      const input = z
        .object({ planId: idSchema, approved: z.literal(true) })
        .strict()
        .parse(body);
      const plan = await db
        .prepare("SELECT * FROM plans WHERE id=? AND tenant=?")
        .bind(input.planId, t.id)
        .first<{
          data: string;
          status: string;
          expires: number;
          source: string;
        }>();
      if (!plan) throw new ApiError(404, "Cleanup plan unavailable.");
      if (plan.status === "executed") return json({ duplicate: true });
      if (
        plan.status !== "pending" ||
        plan.expires < Date.now() ||
        plan.source !== "demo"
      )
        throw new ApiError(
          409,
          "This plan expired or changed. Create a fresh preview.",
        );
      const data = JSON.parse(plan.data) as {
        groups: {
          id: string;
          sender: string;
          count: number;
          bytes: number;
          revision: number;
        }[];
        total: number;
        action: string;
      };
      const claim = db
        .prepare(
          `UPDATE plans SET status='executing' WHERE id=? AND tenant=? AND status='pending' AND expires>? AND NOT EXISTS(SELECT 1 FROM json_each(plans.data,'$.groups') j LEFT JOIN mail_groups g ON g.id=json_extract(j.value,'$.id') AND g.tenant=plans.tenant WHERE g.id IS NULL OR g.protected=1 OR g.status!='active' OR g.revision!=json_extract(j.value,'$.revision'))`,
        )
        .bind(input.planId, t.id, Date.now());
      const statements = [
        claim,
        ...data.groups.map((g) =>
          db
            .prepare(
              `UPDATE mail_groups SET status=?,revision=revision+1 WHERE id=? AND tenant=? AND EXISTS(SELECT 1 FROM plans WHERE id=? AND tenant=? AND status='executing')`,
            )
            .bind(
              data.action === "archive" ? "archived" : "trashed",
              g.id,
              t.id,
              input.planId,
              t.id,
            ),
        ),
        db
          .prepare(
            `INSERT INTO actions(id,tenant,source,plan_id,kind,data,created,status) SELECT ?,?,'demo',?,?,?,?, 'success' WHERE EXISTS(SELECT 1 FROM plans WHERE id=? AND tenant=? AND status='executing')`,
          )
          .bind(
            input.planId,
            t.id,
            input.planId,
            data.action,
            JSON.stringify(data),
            Date.now(),
            input.planId,
            t.id,
          ),
        db
          .prepare(
            `UPDATE plans SET status='executed' WHERE id=? AND tenant=? AND status='executing'`,
          )
          .bind(input.planId, t.id),
      ];
      const results = await db.batch(statements);
      if (!results[0].meta.changes)
        throw new ApiError(
          409,
          "Mail changed after the preview. Review a new plan.",
        );
      return json({ total: data.total, action: data.action });
    }
    if (path === "undo") {
      const input = z.object({ actionId: idSchema }).strict().parse(body);
      const action = await db
        .prepare("SELECT * FROM actions WHERE id=? AND tenant=? AND source=?")
        .bind(input.actionId, t.id, "demo")
        .first<{ data: string; status: string; kind: string }>();
      if (!action || !["trash", "archive"].includes(action.kind))
        throw new ApiError(404, "This action cannot be undone.");
      if (action.status === "undone") return json({ duplicate: true });
      const data = JSON.parse(action.data) as { groups: { id: string }[] };
      await db.batch([
        db
          .prepare(
            `UPDATE actions SET status='undoing' WHERE id=? AND tenant=? AND status='success'`,
          )
          .bind(input.actionId, t.id),
        ...data.groups.map((g) =>
          db
            .prepare(
              `UPDATE mail_groups SET status='active',revision=revision+1 WHERE id=? AND tenant=? AND status IN ('trashed','archived') AND EXISTS(SELECT 1 FROM actions WHERE id=? AND tenant=? AND status='undoing')`,
            )
            .bind(g.id, t.id, input.actionId, t.id),
        ),
        db
          .prepare(
            `UPDATE actions SET status='undone' WHERE id=? AND tenant=? AND status='undoing'`,
          )
          .bind(input.actionId, t.id),
      ]);
      return json({ restored: true });
    }
    if (path === "protect") {
      const input = z.object({ id: idSchema }).strict().parse(body);
      const g = await db
        .prepare("SELECT address FROM mail_groups WHERE id=? AND tenant=?")
        .bind(input.id, t.id)
        .first<{ address: string }>();
      if (!g) throw new ApiError(404, "Sender unavailable.");
      const settings = {
        ...t.settings,
        protectedSenders: [
          ...new Set([...t.settings.protectedSenders, g.address]),
        ],
      };
      await db.batch([
        db
          .prepare(
            "UPDATE mail_groups SET protected=1,revision=revision+1 WHERE id=? AND tenant=?",
          )
          .bind(input.id, t.id),
        db
          .prepare("UPDATE tenants SET settings=? WHERE id=?")
          .bind(JSON.stringify(settings), t.id),
        db
          .prepare(
            `UPDATE messages SET classification=json_set(classification,'$.action','KEEP') WHERE tenant=? AND json_extract(metadata,'$.sender')=?`,
          )
          .bind(t.id, g.address),
      ]);
      await record(t.id, t.settings.source, "protect", {
        message: `Protected ${g.address}`,
      });
      return json({ protected: true });
    }
    if (path === "unsubscribe") {
      const input = z
        .object({ id: idSchema, approved: z.literal(true) })
        .strict()
        .parse(body);
      if (t.settings.source !== "demo")
        throw new ApiError(
          409,
          "This sender requires manual unsubscribe. No safe one-click transport is configured.",
        );
      const g = await db
        .prepare(
          "SELECT sender,list_id FROM mail_groups WHERE id=? AND tenant=? AND source=?",
        )
        .bind(input.id, t.id, "demo")
        .first<{ sender: string; list_id: string }>();
      if (!g?.list_id)
        throw new ApiError(409, "No unsubscribe option is available.");
      await db
        .prepare(
          "UPDATE mail_groups SET status=?,revision=revision+1 WHERE id=? AND tenant=? AND status=?",
        )
        .bind("unsubscribed", input.id, t.id, "active")
        .run();
      await record(t.id, "demo", "unsubscribe", {
        message: `Simulated unsubscribe from ${g.sender}. No real request was sent.`,
      });
      return json({ status: "SUCCESS", simulated: true });
    }
    if (path === "rules") {
      const input = z
        .object({
          command: z.string().min(1).max(500),
          approved: z.boolean().default(false),
        })
        .strict()
        .parse(body);
      const result = compileRule(input.command);
      if (!result.ok) throw new ApiError(422, result.reason);
      if (!input.approved) return json({ preview: result.rule });
      const rule = { ...result.rule, approved: true };
      await db
        .prepare(
          "INSERT INTO rules(id,tenant,command,compiled,enabled,authorized,created) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          t.id,
          input.command,
          JSON.stringify(rule),
          1,
          1,
          Date.now(),
        )
        .run();
      if (rule.sender && rule.action === "PROTECT") {
        const settings = {
          ...t.settings,
          protectedSenders: [
            ...new Set([...t.settings.protectedSenders, rule.sender]),
          ],
        };
        await db.batch([
          db
            .prepare("UPDATE tenants SET settings=? WHERE id=?")
            .bind(JSON.stringify(settings), t.id),
          db
            .prepare(
              "UPDATE mail_groups SET protected=1,revision=revision+1 WHERE address=? AND tenant=?",
            )
            .bind(rule.sender, t.id),
        ]);
      }
      await record(t.id, t.settings.source, "rule", { message: input.command });
      return json({ created: true });
    }
    if (path === "rule-toggle") {
      const input = z
        .object({ id: idSchema, enabled: z.boolean() })
        .strict()
        .parse(body);
      const result = await db
        .prepare("UPDATE rules SET enabled=? WHERE id=? AND tenant=?")
        .bind(Number(input.enabled), input.id, t.id)
        .run();
      if (!result.meta.changes) throw new ApiError(404, "Rule unavailable.");
      return json({ updated: true });
    }
    if (path === "settings") {
      const input = z
        .object({
          privacy: z.enum(["privacy", "smart"]).optional(),
          theme: z.enum(["light", "dark", "system"]).optional(),
          autopilot: z.enum(["off", "assisted", "autopilot"]).optional(),
          notifications: z.boolean().optional(),
        })
        .strict()
        .parse(body);
      if (input.autopilot === "autopilot")
        throw new ApiError(
          409,
          "Unattended Autopilot is not available until the worker schedule is configured and verified. Assisted mode prepares actions for your review.",
        );
      await db
        .prepare("UPDATE tenants SET settings=? WHERE id=?")
        .bind(JSON.stringify({ ...t.settings, ...input }), t.id)
        .run();
      return json({ saved: true });
    }
    if (path === "assistant") {
      const input = z
        .object({ command: z.string().min(1).max(500) })
        .strict()
        .parse(body);
      let interpreted: { intent: string; ruleCommand: string | null } | null =
        null;
      if (
        t.settings.privacy === "smart" &&
        config("OPENAI_API_KEY") &&
        config("OPENAI_MODEL")
      ) {
        try {
          interpreted = await interpretCommand(input.command, {
            apiKey: config("OPENAI_API_KEY")!,
            model: config("OPENAI_MODEL")!,
          });
        } catch {
          throw new ApiError(
            503,
            "Your AI provider is unavailable. Switch to Privacy Mode for deterministic suggestions.",
          );
        }
      }
      const proposed = interpreted?.ruleCommand ?? input.command;
      const rule = compileRule(proposed);
      if (rule.ok)
        return json({
          type: "rule",
          title: "A rule, ready for your review.",
          rule: rule.rule,
          command: proposed,
        });
      const groups = (
        await db
          .prepare(
            "SELECT * FROM mail_groups WHERE tenant=? AND source=? AND status=? ORDER BY count DESC LIMIT 20",
          )
          .bind(t.id, t.settings.source, "active")
          .all<MailGroup>()
      ).results;
      if (
        interpreted?.intent === "protected" ||
        /why|protect|important/i.test(input.command)
      )
        return json({
          type: "groups",
          title: "The important stuff stays.",
          text: "Receipts, work, financial records, security mail and personal conversations are protected. Uncertain mail needs your review.",
          ids: groups.filter((g) => g.protected).map((g) => g.id),
        });
      if (
        interpreted?.intent === "activity" ||
        /today|activity|cleaned/i.test(input.command)
      )
        return json({
          type: "activity",
          title: "Every action has a paper trail.",
          text: "Open Activity to see completed actions and available Undo.",
        });
      return json({
        type: "groups",
        title: "These are worth a look.",
        text: "This is a deterministic demo assistant. It suggests old bulk mail; it does not know whether you engaged with a newsletter.",
        ids: groups
          .filter(
            (g) =>
              !g.protected && ["promotion", "newsletter"].includes(g.category),
          )
          .map((g) => g.id),
      });
    }
    if (path === "analyze-message") {
      const input = z
        .object({ id: idSchema, approved: z.literal(true) })
        .strict()
        .parse(body);
      if (t.settings.privacy !== "smart")
        throw new ApiError(
          403,
          "Enable Smart Mode before sending metadata to AI.",
        );
      const key = config("OPENAI_API_KEY"),
        model = config("OPENAI_MODEL");
      if (!key || !model) throw new ApiError(503, "OpenAI is not configured.");
      const row = await db
        .prepare("SELECT metadata FROM messages WHERE id=? AND tenant=?")
        .bind(input.id, t.id)
        .first<{ metadata: string }>();
      if (!row) throw new ApiError(404, "Message unavailable.");
      const m = JSON.parse(row.metadata);
      const result = await new OpenAIClassifier({
        apiKey: key,
        model,
      }).classify({ from: m.sender, subject: m.subject, labels: m.labels });
      const deterministic = classify(m, t.settings.protectedSenders);
      return json({
        analysis: result,
        policy: deterministic,
        explanation:
          "AI is advisory. Deterministic protection remains authoritative.",
      });
    }
    if (path === "export") {
      const input = z
        .object({
          collection: z
            .enum([
              "mail_groups",
              "messages",
              "plans",
              "actions",
              "rules",
              "jobs",
            ])
            .optional(),
          cursor: z.string().max(500).optional(),
        })
        .strict()
        .parse(body);
      if (!input.collection)
        return json({
          version: 1,
          exportedAt: new Date().toISOString(),
          settings: t.settings,
          collections: [
            "mail_groups",
            "messages",
            "plans",
            "actions",
            "rules",
            "jobs",
          ],
          consistency: "Paged current data; not an atomic backup.",
        });
      const columns =
        input.collection === "jobs"
          ? "id,source,cursor,processed,status,history_id,updated"
          : "*";
      const result = await db
        .prepare(
          `SELECT ${columns} FROM ${input.collection} WHERE tenant=? AND id>? ORDER BY id LIMIT 201`,
        )
        .bind(t.id, input.cursor ?? "")
        .all();
      const rows = result.results
        .slice(0, 200)
        .map((row) =>
          Object.fromEntries(
            Object.entries(row).filter(([name]) => name !== "tenant"),
          ),
        );
      return json({
        collection: input.collection,
        rows,
        nextCursor: result.results.length > 200 ? rows.at(-1)?.id : null,
      });
    }
    if (path === "delete-data" || path === "delete-account") {
      z.object({ confirmation: z.literal("DELETE") })
        .strict()
        .parse(body);
      const creds = await db
        .prepare("SELECT tenant FROM credentials WHERE tenant=?")
        .bind(t.id)
        .first();
      if (creds)
        throw new ApiError(
          409,
          "Disconnect Gmail first so Google access is revoked before deleting local data.",
        );
      const tables = [
        "mail_groups",
        "plans",
        "actions",
        "rules",
        "jobs",
        "messages",
        "oauth_transactions",
      ];
      await db.batch([
        ...tables.map((table) =>
          db.prepare(`DELETE FROM ${table} WHERE tenant=?`).bind(t.id),
        ),
        db
          .prepare("UPDATE tenants SET settings=?,deleted=? WHERE id=?")
          .bind(
            JSON.stringify(DEFAULT_SETTINGS),
            Number(path === "delete-account"),
            t.id,
          ),
      ]);
      return json({ deleted: true });
    }
    throw new ApiError(404, "This action is unavailable.");
  } catch (e) {
    if (e instanceof z.ZodError)
      return json(
        { error: "Some details were invalid. Check the form and try again." },
        400,
      );
    if (e instanceof ApiError) return json({ error: e.message }, e.status);
    console.error(
      JSON.stringify({
        event: "api_failure",
        type: e instanceof Error ? e.name : "unknown",
      }),
    );
    return json(
      {
        error:
          "The action could not finish. Your mail stays safe. Please try again.",
      },
      503,
    );
  }
}
export const GET = handle;
export const POST = handle;
