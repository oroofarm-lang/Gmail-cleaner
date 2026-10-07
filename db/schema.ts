import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  settings: text("settings").notNull(),
  created: integer("created").notNull(),
  deleted: integer("deleted").notNull().default(0),
  connectionEpoch: integer("connection_epoch").notNull().default(0),
});
export const groups = sqliteTable(
  "mail_groups",
  {
    id: text("id").primaryKey(),
    tenant: text("tenant").notNull(),
    source: text("source").notNull(),
    sender: text("sender").notNull(),
    address: text("address").notNull(),
    category: text("category").notNull(),
    count: integer("count").notNull(),
    bytes: integer("bytes").notNull(),
    oldest: integer("oldest").notNull(),
    newest: integer("newest").notNull(),
    protected: integer("protected").notNull(),
    revision: integer("revision").notNull().default(0),
    listId: text("list_id"),
    status: text("status").notNull().default("active"),
  },
  (t) => [index("groups_tenant_source").on(t.tenant, t.source, t.status)],
);
export const plans = sqliteTable(
  "plans",
  {
    id: text("id").primaryKey(),
    tenant: text("tenant").notNull(),
    source: text("source").notNull(),
    data: text("data").notNull(),
    status: text("status").notNull(),
    created: integer("created").notNull(),
    expires: integer("expires").notNull(),
    owner: text("owner"),
    lease: integer("lease").notNull().default(0),
  },
  (t) => [index("plans_tenant").on(t.tenant, t.created)],
);
export const actions = sqliteTable(
  "actions",
  {
    id: text("id").primaryKey(),
    tenant: text("tenant").notNull(),
    source: text("source").notNull(),
    planId: text("plan_id"),
    kind: text("kind").notNull(),
    data: text("data").notNull(),
    created: integer("created").notNull(),
    status: text("status").notNull(),
    owner: text("owner"),
    lease: integer("lease").notNull().default(0),
  },
  (t) => [index("actions_tenant").on(t.tenant, t.created)],
);
export const rules = sqliteTable(
  "rules",
  {
    id: text("id").primaryKey(),
    tenant: text("tenant").notNull(),
    command: text("command").notNull(),
    compiled: text("compiled").notNull(),
    enabled: integer("enabled").notNull(),
    authorized: integer("authorized").notNull(),
    created: integer("created").notNull(),
  },
  (t) => [index("rules_tenant").on(t.tenant)],
);
export const credentials = sqliteTable("credentials", {
  tenant: text("tenant").primaryKey(),
  encrypted: text("encrypted").notNull(),
  email: text("email").notNull(),
  generation: text("generation").notNull().default("legacy"),
  updated: integer("updated").notNull(),
});
export const oauth = sqliteTable("oauth_transactions", {
  state: text("state").primaryKey(),
  tenant: text("tenant").notNull(),
  verifier: text("verifier").notNull(),
  expires: integer("expires").notNull(),
  epoch: integer("epoch").notNull().default(0),
});
export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    tenant: text("tenant").notNull(),
    source: text("source").notNull(),
    cursor: text("cursor"),
    processed: integer("processed").notNull(),
    status: text("status").notNull(),
    historyId: text("history_id"),
    updated: integer("updated").notNull(),
    lease: integer("lease").notNull().default(0),
    owner: text("owner"),
  },
  (t) => [index("jobs_tenant").on(t.tenant, t.source)],
);
export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    tenant: text("tenant").notNull(),
    gmailId: text("gmail_id").notNull(),
    metadata: text("metadata").notNull(),
    classification: text("classification").notNull(),
    updated: integer("updated").notNull(),
  },
  (t) => [index("messages_tenant").on(t.tenant, t.gmailId)],
);

export const syncSeen = sqliteTable(
  "sync_seen",
  {
    id: text("id").primaryKey(),
    tenant: text("tenant").notNull(),
    gmailId: text("gmail_id").notNull(),
    generation: text("generation").notNull(),
  },
  (t) => [
    index("sync_seen_tenant_message").on(t.tenant, t.gmailId, t.generation),
  ],
);
export const syncPages = sqliteTable("sync_pages", {
  id: text("id").primaryKey(),
  tenant: text("tenant").notNull(),
});
