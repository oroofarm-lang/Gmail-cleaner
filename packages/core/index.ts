/** Metadata-only safety domain. No mailbox text can invoke a tool. */
export const TAXONOMY = [
  "personal",
  "work",
  "client",
  "financial",
  "accounting",
  "tax",
  "government",
  "legal",
  "insurance",
  "security",
  "authentication",
  "invoice",
  "receipt",
  "order",
  "shipping",
  "newsletter",
  "subscription",
  "marketing",
  "promotion",
  "social notification",
  "travel",
  "booking",
  "event",
  "education",
  "healthcare",
  "account/service",
  "product update",
  "automated notification",
  "unknown",
] as const;
export type Category = (typeof TAXONOMY)[number];
export type Action =
  | "KEEP"
  | "PROTECT"
  | "ARCHIVE"
  | "TRASH"
  | "UNSUBSCRIBE"
  | "UNSUBSCRIBE_AND_TRASH"
  | "REVIEW";
export interface MessageMetadata {
  id: string;
  threadId: string;
  sender: string;
  subject: string;
  labels: string[];
  date: number;
  size: number;
  listId?: string;
  unsubscribe?: string;
  replied?: boolean;
  attachment?: boolean;
}
export interface Decision {
  category: Category;
  action: Action;
  risk: "low" | "medium" | "high";
  confidence: null;
  explanation: string;
  protectiveSignals: string[];
  source: "deterministic";
}
const DAY = 86400000;
const emailPattern =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i;
export function senderAddress(sender: string): string {
  const match = sender.match(/<([^<>]+)>\s*$/);
  return (match?.[1] ?? sender).trim().toLowerCase();
}
function validMetadata(m: MessageMetadata, now: number): boolean {
  return (
    !!m &&
    typeof m.id === "string" &&
    /^[\w-]{1,200}$/.test(m.id) &&
    typeof m.threadId === "string" &&
    typeof m.sender === "string" &&
    emailPattern.test(senderAddress(m.sender)) &&
    typeof m.subject === "string" &&
    Array.isArray(m.labels) &&
    m.labels.every((x) => typeof x === "string") &&
    Number.isFinite(m.date) &&
    m.date > 0 &&
    m.date <= now + DAY &&
    Number.isFinite(m.size) &&
    m.size >= 0
  );
}
const patterns: [Category, RegExp][] = [
  [
    "security",
    /\b(security alert|suspicious|password reset|login|sign.in|verification code|2fa|identity verification)\b/i,
  ],
  ["tax", /\b(tax|irs|vat|taxation)\b/i],
  ["legal", /\b(contract|legal|court|lawsuit|agreement)\b/i],
  [
    "healthcare",
    /\b(medical|healthcare|doctor|patient|prescription|appointment)\b/i,
  ],
  ["invoice", /\b(invoice|accountant|accounting)\b/i],
  ["receipt", /\b(receipt|warranty|purchase confirmation)\b/i],
  ["order", /\b(order confirmation|order #[a-z0-9]|payment confirmation)\b/i],
  ["shipping", /\b(shipping|delivery|tracking|dispatched)\b/i],
  [
    "financial",
    /\b(bank statement|credit card|loan|investment|transaction|balance|payment due)\b/i,
  ],
  ["government", /\b(government|immigration|passport|municipal)\b/i],
  ["insurance", /\b(insurance|policy renewal|claim)\b/i],
  ["booking", /\b(booking|reservation|flight|itinerary|boarding|ticket)\b/i],
  ["work", /\b(project|client|meeting|proposal|salary|payroll)\b/i],
  ["event", /\b(event confirmation|event ticket)\b/i],
  ["education", /\b(tuition|school|university|course enrollment)\b/i],
];
export function classify(
  message: MessageMetadata,
  protectedSenders: string[] = [],
  now = Date.now(),
): Decision {
  const protectiveSignals: string[] = [];
  let category: Category = "unknown";
  const decide = (
    action: Action,
    explanation: string,
    risk: Decision["risk"] = "high",
  ): Decision => ({
    category,
    action,
    risk,
    confidence: null,
    explanation,
    protectiveSignals,
    source: "deterministic",
  });
  if (!validMetadata(message, now))
    return decide("REVIEW", "Invalid or incomplete metadata requires review.");
  const address = senderAddress(message.sender);
  if (protectedSenders.some((x) => senderAddress(x) === address))
    protectiveSignals.push("protected sender");
  if (message.replied) protectiveSignals.push("replied conversation");
  for (const label of message.labels)
    if (["STARRED", "IMPORTANT", "SENT", "DRAFT"].includes(label))
      protectiveSignals.push(label.toLowerCase());
  // Gmail user label ids and display names are conservative protection, regardless of category.
  const system = new Set([
    "INBOX",
    "UNREAD",
    "TRASH",
    "SPAM",
    "CATEGORY_PERSONAL",
    "CATEGORY_PROMOTIONS",
    "CATEGORY_SOCIAL",
    "CATEGORY_UPDATES",
    "CATEGORY_FORUMS",
    "CHAT",
  ]);
  if (
    message.labels.some(
      (x) =>
        !system.has(x) &&
        !["STARRED", "IMPORTANT", "SENT", "DRAFT"].includes(x),
    )
  )
    protectiveSignals.push("custom label");
  for (const [candidate, pattern] of patterns)
    if (pattern.test(message.subject)) {
      category = candidate;
      protectiveSignals.push(`${candidate} content signal`);
      break;
    }
  if (message.attachment) protectiveSignals.push("attachment requires review");
  if (protectiveSignals.length)
    return decide(
      message.attachment && protectiveSignals.length === 1 ? "REVIEW" : "KEEP",
      "Protected signals override cleanup recommendations.",
    );
  if (message.labels.includes("TRASH"))
    return decide(
      "KEEP",
      "Already in Trash; never automatically trash a restored message.",
      "medium",
    );
  const bulk = !!message.listId || !!message.unsubscribe;
  if (message.labels.includes("CATEGORY_PROMOTIONS")) category = "promotion";
  else if (message.labels.includes("CATEGORY_SOCIAL"))
    category = "social notification";
  else if (bulk) category = "newsletter";
  else if (message.labels.includes("CATEGORY_UPDATES"))
    category = "automated notification";
  else if (message.labels.includes("CATEGORY_PERSONAL")) {
    category = "personal";
    return decide("KEEP", "Personal correspondence is protected.");
  }
  if (category === "unknown" || category === "automated notification")
    return decide(
      "REVIEW",
      "Metadata alone does not establish whether this mail is disposable.",
    );
  if (now - message.date < 180 * DAY)
    return decide(
      "REVIEW",
      "Recent mail needs review before cleanup.",
      "medium",
    );
  return decide(
    "TRASH",
    "Old bulk or category mail is a cleanup candidate; explicit approval is still required.",
    "low",
  );
}
export interface Rule {
  version: 1;
  command: string;
  action: "KEEP" | "PROTECT" | "ARCHIVE" | "TRASH";
  sender?: string;
  category?: "promotion" | "newsletter";
  olderThanDays?: number;
  enabled: boolean;
  approved: boolean;
}
export type RuleCompilation =
  | {
      ok: true;
      rule: Rule;
    }
  | {
      ok: false;
      reason: string;
    };
export function compileRule(command: string): RuleCompilation {
  const text = command.trim();
  if (text.length > 500) return { ok: false, reason: "Command is too long." };
  const protect = text.match(
    /^(?:never delete (?:anything|emails?|mail) from|protect(?: sender)?|keep (?:all )?(?:emails?|mail) from)\s+([^\s<>]+@[^\s<>]+)$/i,
  );
  if (protect && emailPattern.test(protect[1]))
    return {
      ok: true,
      rule: {
        version: 1,
        command: text,
        action: "PROTECT",
        sender: senderAddress(protect[1]),
        enabled: true,
        approved: false,
      },
    };
  const clean = text.match(
    /^(trash|delete|archive) (?:old )?(promotions|newsletters) older than (\d+) (days?|months?|years?)\.?$/i,
  );
  if (clean) {
    const days =
      Number(clean[3]) *
      (clean[4].toLowerCase().startsWith("month")
        ? 30
        : clean[4].toLowerCase().startsWith("year")
          ? 365
          : 1);
    if (days < 180 || days > 36500)
      return {
        ok: false,
        reason: "Cleanup rules require an age between 180 days and 100 years.",
      };
    return {
      ok: true,
      rule: {
        version: 1,
        command: text,
        action: clean[1].toLowerCase() === "archive" ? "ARCHIVE" : "TRASH",
        category:
          clean[2].toLowerCase() === "promotions" ? "promotion" : "newsletter",
        olderThanDays: days,
        enabled: true,
        approved: false,
      },
    };
  }
  return {
    ok: false,
    reason:
      "Specify an exact sender to protect, or promotions/newsletters older than a number of days, months, or years. This parser does not infer vague intent.",
  };
}
export function evaluateRule(
  rule: Rule,
  message: MessageMetadata,
  protectedSenders: string[] = [],
  now = Date.now(),
): Decision {
  const decision = classify(message, protectedSenders, now);
  if (
    rule.version !== 1 ||
    rule.enabled !== true ||
    rule.approved !== true ||
    !["KEEP", "PROTECT", "ARCHIVE", "TRASH"].includes(rule.action)
  )
    return {
      ...decision,
      action: decision.action === "KEEP" ? "KEEP" : "REVIEW",
      explanation: "Rule is disabled, invalid, or awaits approval.",
    };
  if (rule.sender && senderAddress(message.sender) !== rule.sender)
    return {
      ...decision,
      action: decision.action === "KEEP" ? "KEEP" : "REVIEW",
      explanation: "Sender does not match the rule.",
    };
  if (rule.action === "KEEP" || rule.action === "PROTECT")
    return {
      ...decision,
      action: "KEEP",
      protectiveSignals: [...decision.protectiveSignals, "approved keep rule"],
      explanation: "An approved protection rule matched.",
    };
  if (decision.action === "KEEP" || decision.action === "REVIEW")
    return decision;
  const minimumDays = rule.olderThanDays ?? 0;
  if (
    !rule.category ||
    !Number.isFinite(minimumDays) ||
    minimumDays < 180 ||
    decision.category !== rule.category ||
    now - message.date < minimumDays * DAY
  )
    return {
      ...decision,
      action: "REVIEW",
      explanation: "Message does not meet the approved rule.",
    };
  return {
    ...decision,
    action: rule.action,
    explanation: "Approved rule matched after safety checks.",
  };
}
export interface Aggregate {
  total: number;
  bytes: number;
  candidates: number;
  protected: number;
  review: number;
  categories: Record<string, number>;
  senders: {
    sender: string;
    count: number;
    bytes: number;
    candidates: number;
    protected: number;
  }[];
}
export function aggregate(
  messages: MessageMetadata[],
  protectedSenders: string[] = [],
  now = Date.now(),
): Aggregate {
  const result: Aggregate = {
    total: messages.length,
    bytes: 0,
    candidates: 0,
    protected: 0,
    review: 0,
    categories: {},
    senders: [],
  };
  const groups = new Map<string, Aggregate["senders"][number]>();
  for (const message of messages) {
    const d = classify(message, protectedSenders, now);
    result.bytes += Number.isFinite(message.size) ? message.size : 0;
    result.categories[d.category] = (result.categories[d.category] ?? 0) + 1;
    const key = senderAddress(message.sender);
    const group = groups.get(key) ?? {
      sender: key,
      count: 0,
      bytes: 0,
      candidates: 0,
      protected: 0,
    };
    group.count++;
    group.bytes += Number.isFinite(message.size) ? message.size : 0;
    if (d.action === "TRASH") {
      result.candidates++;
      group.candidates++;
    } else if (d.action === "KEEP") {
      result.protected++;
      group.protected++;
    } else result.review++;
    groups.set(key, group);
  }
  result.senders = [...groups.values()].sort((a, b) => b.count - a.count);
  return result;
}
export function createDemoMessages(
  count = 24000,
  now = Date.now(),
): MessageMetadata[] {
  if (!Number.isInteger(count) || count < 0 || count > 200000)
    throw new Error("Demo count must be between 0 and 200000.");
  const examples = [
    [
      "Weekly digest",
      "newsletter@slowcoffee.example",
      "CATEGORY_FORUMS",
      "slowcoffee",
    ],
    [
      "Seasonal clothing sale",
      "offers@linen.example",
      "CATEGORY_PROMOTIONS",
      "linen",
    ],
    ["Your bank statement", "alerts@bank.example", "CATEGORY_UPDATES", ""],
    ["Your receipt", "receipts@shop.example", "CATEGORY_UPDATES", ""],
    [
      "Flight booking confirmation",
      "travel@airline.example",
      "CATEGORY_UPDATES",
      "",
    ],
    [
      "Security alert: new login",
      "security@account.example",
      "CATEGORY_UPDATES",
      "",
    ],
    ["Project meeting", "maya@studio.example", "CATEGORY_PERSONAL", ""],
    ["Family dinner", "sister@family.example", "CATEGORY_PERSONAL", ""],
    [
      "People you may know",
      "social@network.example",
      "CATEGORY_SOCIAL",
      "network",
    ],
    ["Monthly issue", "editor@zine.example", "CATEGORY_FORUMS", "zine"],
    [
      "A question about this",
      "service@unknown.example",
      "CATEGORY_UPDATES",
      "",
    ],
    ["Client proposal", "client@studio.example", "CATEGORY_PERSONAL", ""],
  ];
  return Array.from({ length: count }, (_, i) => {
    const e = examples[i % examples.length];
    return {
      id: `demo-${i}`,
      threadId: `thread-${Math.floor(i / 2)}`,
      sender: e[1],
      subject: `${e[0]} ${Math.floor(i / examples.length) + 1}`,
      labels: [
        "INBOX",
        e[2],
        ...(i % 7 === 0 ? ["UNREAD"] : []),
        ...(i % 251 === 0 ? ["STARRED"] : []),
      ],
      date: now - (30 + ((i * 37) % 1825)) * DAY,
      size: 1500 + ((i * 7919) % 160000),
      listId: e[3] || undefined,
      unsubscribe: e[3]
        ? `https://${e[1].split("@")[1]}/unsubscribe`
        : undefined,
      replied: i % 12 === 6,
      attachment: i % 12 === 3,
    };
  });
}
export interface GmailAdapter {
  readonly mode: "fake" | "live";
  get(tenant: string, id: string): Promise<MessageMetadata | undefined>;
  trash(tenant: string, id: string, idempotencyKey: string): Promise<void>;
  restore(
    tenant: string,
    id: string,
    idempotencyKey: string,
    originalLabels?: string[],
  ): Promise<void>;
}
/** Test adapter: tenant scope on every read/write; injected transient failures precede mutation. */
export class FakeGmailAdapter implements GmailAdapter {
  readonly mode = "fake" as const;
  private mail = new Map<string, Map<string, MessageMetadata>>();
  private keys = new Set<string>();
  private failures = new Map<string, number>();
  private ambiguousFailures = new Set<string>();
  latencyMs = 0;
  constructor(accounts: Record<string, MessageMetadata[]> = {}) {
    for (const [tenant, messages] of Object.entries(accounts))
      this.mail.set(
        tenant,
        new Map(messages.map((m) => [m.id, structuredClone(m)])),
      );
  }
  failNext(tenant: string, id: string, times = 1) {
    this.failures.set(`${tenant}:${id}`, times);
  }
  failAfterNextMutation(tenant: string, id: string) {
    this.ambiguousFailures.add(`${tenant}:${id}`);
  }
  async get(tenant: string, id: string) {
    const message = this.mail.get(tenant)?.get(id);
    return message ? structuredClone(message) : undefined;
  }
  async replace(tenant: string, message: MessageMetadata) {
    if (!this.mail.has(tenant)) throw new Error("Unknown tenant");
    this.mail.get(tenant)!.set(message.id, structuredClone(message));
  }
  private async mutate(
    tenant: string,
    id: string,
    key: string,
    restore: boolean,
  ) {
    const message = this.mail.get(tenant)?.get(id);
    if (!message) throw new Error("Message unavailable");
    const operation = `${tenant}:${restore ? "restore" : "trash"}:${key}`;
    if (this.keys.has(operation)) return;
    if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
    const failure = `${tenant}:${id}`;
    const remaining = this.failures.get(failure) ?? 0;
    if (remaining) {
      this.failures.set(failure, remaining - 1);
      throw new Error("Simulated Gmail transient failure");
    }
    message.labels = restore
      ? message.labels.filter((x) => x !== "TRASH")
      : [
          ...message.labels.filter((x) => x !== "INBOX" && x !== "TRASH"),
          "TRASH",
        ];
    this.keys.add(operation);
    if (this.ambiguousFailures.delete(failure))
      throw new Error("Simulated timeout after mutation");
  }
  async trash(tenant: string, id: string, key: string) {
    await this.mutate(tenant, id, key, false);
  }
  async restore(
    tenant: string,
    id: string,
    key: string,
    originalLabels: string[] = [],
  ) {
    await this.mutate(tenant, id, key, true);
    const message = this.mail.get(tenant)?.get(id);
    if (
      message &&
      originalLabels.includes("INBOX") &&
      !message.labels.includes("INBOX")
    )
      message.labels.push("INBOX");
  }
}
export interface CleanupPlan {
  id: string;
  tenant: string;
  createdAt: number;
  expiresAt: number;
  messageIds: string[];
  approved: boolean;
  status: "preview" | "running" | "partial" | "complete" | "undone";
  results: Record<string, "trashed" | "skipped" | "failed" | "restored">;
}
interface StoredPlan {
  plan: CleanupPlan;
  fingerprints: Map<string, string>;
  trashedFingerprints: Map<string, string>;
  originalLabels: Map<string, string[]>;
}
function fingerprint(message: MessageMetadata) {
  return JSON.stringify([
    message.id,
    message.threadId,
    message.sender,
    message.subject,
    [...message.labels].sort(),
    message.date,
    message.size,
    message.listId,
    message.unsubscribe,
    message.replied,
    message.attachment,
  ]);
}
/** In-memory reference service. Production must persist plans/results and use a durable tenant lock. */
export class CleanupService {
  private plans = new Map<string, StoredPlan>();
  private locks = new Set<string>();
  private sequence = 0;
  private adapter: GmailAdapter;
  private protectedSenders: (tenant: string) => string[];
  private clock: () => number;
  constructor(
    adapter: GmailAdapter,
    protectedSenders: (tenant: string) => string[] = () => [],
    clock: () => number = Date.now,
  ) {
    if (adapter.mode !== "fake")
      throw new Error(
        "Live cleanup requires a durable plan store and distributed lock.",
      );
    this.adapter = adapter;
    this.protectedSenders = protectedSenders;
    this.clock = clock;
  }
  async createPlan(tenant: string, messageIds: string[]): Promise<CleanupPlan> {
    if (!tenant || messageIds.length > 10000) throw new Error("Invalid plan");
    const ids = [...new Set(messageIds)];
    const stored: StoredPlan = {
      plan: {
        id: `plan-${this.clock()}-${++this.sequence}`,
        tenant,
        createdAt: this.clock(),
        expiresAt: this.clock() + 15 * 60 * 1000,
        messageIds: ids,
        approved: false,
        status: "preview",
        results: Object.create(null) as CleanupPlan["results"],
      },
      fingerprints: new Map(),
      trashedFingerprints: new Map(),
      originalLabels: new Map(),
    };
    for (const id of ids) {
      const message = await this.adapter.get(tenant, id);
      if (
        message &&
        classify(message, this.protectedSenders(tenant), this.clock())
          .action === "TRASH"
      ) {
        stored.fingerprints.set(id, fingerprint(message));
        stored.trashedFingerprints.set(
          id,
          fingerprint({
            ...message,
            labels: [
              ...message.labels.filter((x) => x !== "INBOX" && x !== "TRASH"),
              "TRASH",
            ],
          }),
        );
        stored.originalLabels.set(id, [...message.labels]);
      } else stored.plan.results[id] = "skipped";
    }
    this.plans.set(stored.plan.id, stored);
    return structuredClone(stored.plan);
  }
  private owned(tenant: string, id: string) {
    const record = this.plans.get(id);
    if (!record || record.plan.tenant !== tenant)
      throw new Error("Plan unavailable");
    return record;
  }
  approve(tenant: string, id: string) {
    const p = this.owned(tenant, id).plan;
    if (p.status !== "preview" || this.clock() > p.expiresAt)
      throw new Error("Plan approval expired");
    p.approved = true;
    return structuredClone(p);
  }
  inspect(tenant: string, id: string) {
    return structuredClone(this.owned(tenant, id).plan);
  }
  async execute(
    tenant: string,
    id: string,
    isEnabled: () => boolean = () => true,
  ): Promise<CleanupPlan> {
    const record = this.owned(tenant, id);
    const plan = record.plan;
    if (!plan.approved || this.clock() > plan.expiresAt)
      throw new Error("Approval required or expired");
    if (this.locks.has(tenant)) throw new Error("Cleanup already running");
    if (plan.status === "undone" || plan.status === "complete")
      return structuredClone(plan);
    this.locks.add(tenant);
    plan.status = "running";
    try {
      for (const messageId of plan.messageIds) {
        if (plan.results[messageId] && plan.results[messageId] !== "failed")
          continue;
        if (!isEnabled() || this.clock() > plan.expiresAt) {
          plan.status = "partial";
          break;
        }
        try {
          const current = await this.adapter.get(tenant, messageId);
          if (
            current &&
            plan.results[messageId] === "failed" &&
            record.trashedFingerprints.get(messageId) === fingerprint(current)
          ) {
            plan.results[messageId] = "trashed";
            continue;
          }
          if (
            !current ||
            record.fingerprints.get(messageId) !== fingerprint(current) ||
            classify(current, this.protectedSenders(tenant), this.clock())
              .action !== "TRASH"
          ) {
            plan.results[messageId] = "skipped";
            continue;
          }
          if (!isEnabled() || this.clock() > plan.expiresAt) {
            plan.status = "partial";
            break;
          }
          await this.adapter.trash(tenant, messageId, `${id}:${messageId}`);
          plan.results[messageId] = "trashed";
        } catch {
          plan.results[messageId] = "failed";
        }
      }
      if (plan.status === "running")
        plan.status = Object.values(plan.results).includes("failed")
          ? "partial"
          : "complete";
      return structuredClone(plan);
    } finally {
      this.locks.delete(tenant);
    }
  }
  async undo(tenant: string, id: string): Promise<CleanupPlan> {
    const record = this.owned(tenant, id);
    const plan = record.plan;
    if (this.locks.has(tenant)) throw new Error("Cleanup already running");
    this.locks.add(tenant);
    try {
      for (const messageId of plan.messageIds) {
        if (plan.results[messageId] !== "trashed") continue;
        const current = await this.adapter.get(tenant, messageId);
        if (!current) {
          continue;
        }
        if (current.labels.includes("TRASH"))
          await this.adapter.restore(
            tenant,
            messageId,
            `undo:${id}:${messageId}`,
            record.originalLabels.get(messageId),
          );
        plan.results[messageId] = "restored";
      }
      plan.status = Object.values(plan.results).includes("trashed")
        ? "partial"
        : "undone";
      return structuredClone(plan);
    } finally {
      this.locks.delete(tenant);
    }
  }
}
