export type GmailHeader = { name: string; value: string };
export type GmailPart = {
  headers?: GmailHeader[];
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
};
export type GmailMessage = {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  sizeEstimate?: number;
  historyId?: string;
  payload?: GmailPart;
};
export type GmailProfile = {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
};
export type GmailThread = {
  id: string;
  historyId?: string;
  messages?: GmailMessage[];
};
const METADATA_HEADERS = [
  "From",
  "To",
  "Subject",
  "Date",
  "List-Unsubscribe",
  "List-Unsubscribe-Post",
  "Authentication-Results",
  "List-ID",
  "Precedence",
  "In-Reply-To",
  "References",
];
export function hasAttachmentOrUncertainty(message: GmailMessage): boolean {
  const inspect = (part: GmailPart | undefined, depth: number): boolean => {
    if (!part || depth > 8 || !part.mimeType) return true;
    if (part.filename?.trim() || part.body?.attachmentId) return true;
    if (
      part.headers?.some(
        (header) =>
          header.name.toLowerCase() === "content-disposition" &&
          /^\s*attachment\b/i.test(header.value),
      )
    )
      return true;
    if (/^multipart\//i.test(part.mimeType) && !part.parts?.length) return true;
    if (
      !/^text\/(plain|html)$/i.test(part.mimeType) &&
      !/^multipart\//i.test(part.mimeType)
    )
      return true;
    return part.parts?.some((child) => inspect(child, depth + 1)) ?? false;
  };
  return inspect(message.payload, 0);
}
export type MessagePage = {
  messages?: { id: string; threadId?: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
};
export type HistoryPage = {
  history?: {
    id: string;
    messagesAdded?: { message: GmailMessage }[];
    messagesDeleted?: { message: GmailMessage }[];
    labelsAdded?: { message: GmailMessage; labelIds: string[] }[];
    labelsRemoved?: { message: GmailMessage; labelIds: string[] }[];
  }[];
  nextPageToken?: string;
  historyId: string;
};
export class GmailApiError extends Error {
  status: number;
  requiresFullSync: boolean;
  retryable: boolean;
  constructor(status: number, retryable = false) {
    super(`Gmail request failed (${status})`);
    this.status = status;
    this.retryable = retryable;
    this.requiresFullSync = status === 404;
  }
}
export function headerValue(message: GmailMessage, name: string): string {
  return (
    message.payload?.headers
      ?.filter((h) => h.name.toLowerCase() === name.toLowerCase())
      .map((h) => h.value)
      .join(", ") ?? ""
  );
}
export class GmailMutationNotDispatched extends Error {
  constructor() {
    super("Gmail mutation authorization expired before dispatch");
    this.name = "GmailMutationNotDispatched";
  }
}
/** Token provider permits caller-managed expiry refresh; no credentials are logged or persisted. */
export class GmailClient {
  private options: {
    accessToken: string | (() => Promise<string>);
    fetch?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    maxRetries?: number;
    authorizeMutation?: () => Promise<number>;
  };
  constructor(options: {
    accessToken: string | (() => Promise<string>);
    fetch?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    maxRetries?: number;
    authorizeMutation?: () => Promise<number>;
  }) {
    this.options = options;
  }
  private async request<T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const retries = Math.min(5, Math.max(0, this.options.maxRetries ?? 3));
    for (let attempt = 0; ; attempt++) {
      const token =
        typeof this.options.accessToken === "function"
          ? await this.options.accessToken()
          : this.options.accessToken;
      if (method !== "GET" && this.options.authorizeMutation) {
        const expires = await this.options.authorizeMutation();
        if (!Number.isFinite(expires) || Date.now() >= expires)
          throw new GmailMutationNotDispatched();
      }
      const response = await (this.options.fetch ?? fetch)(
        `https://gmail.googleapis.com/gmail/v1/users/me/${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (response.ok)
        return response.status === 204
          ? (undefined as T)
          : ((await response.json()) as T);
      let quota = false;
      if (response.status === 403) {
        const error = (await response.json().catch(() => null)) as {
          error?: { errors?: { reason?: string }[] };
        } | null;
        quota = !!error?.error?.errors?.some((e) =>
          [
            "rateLimitExceeded",
            "userRateLimitExceeded",
            "quotaExceeded",
          ].includes(e.reason ?? ""),
        );
      }
      if (
        method !== "GET" ||
        attempt >= retries ||
        !(quota || response.status === 429 || response.status >= 500)
      )
        throw new GmailApiError(
          response.status,
          method === "GET" &&
            (quota || response.status === 429 || response.status >= 500),
        );
      const retryAfter = response.headers.get("retry-after");
      const seconds = retryAfter ? Number(retryAfter) : NaN;
      const dateDelay =
        retryAfter && !Number.isFinite(seconds)
          ? Date.parse(retryAfter) - Date.now()
          : NaN;
      const delay = Math.min(
        60_000,
        Math.max(
          0,
          Number.isFinite(seconds)
            ? seconds * 1000
            : Number.isFinite(dateDelay)
              ? dateDelay
              : 1000 * 2 ** attempt + Math.random() * 500,
        ),
      );
      await (
        this.options.sleep ??
        ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
      )(delay);
    }
  }
  listMessages(
    options: {
      q?: string;
      pageToken?: string;
      maxResults?: number;
      labelIds?: string[];
      includeSpamTrash?: boolean;
    } = {},
  ): Promise<MessagePage> {
    const params = new URLSearchParams({
      maxResults: String(Math.min(500, Math.max(1, options.maxResults ?? 100))),
      includeSpamTrash: String(options.includeSpamTrash ?? false),
    });
    if (options.q) params.set("q", options.q);
    if (options.pageToken) params.set("pageToken", options.pageToken);
    for (const label of options.labelIds ?? [])
      params.append("labelIds", label);
    return this.request(`messages?${params}`);
  }
  async *iterateMessages(
    options: { q?: string; labelIds?: string[]; maxMessages?: number } = {},
  ) {
    let pageToken: string | undefined;
    let count = 0;
    const seen = new Set<string>();
    const limit = options.maxMessages ?? 10_000;
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 100_000)
      throw new Error("Invalid message limit");
    do {
      if (count >= limit) return;
      const page = await this.listMessages({
        q: options.q,
        labelIds: options.labelIds,
        pageToken,
        maxResults: Math.min(500, limit - count),
      });
      for (const message of page.messages ?? []) {
        if (count++ >= limit) return;
        yield message;
      }
      pageToken = page.nextPageToken;
      if (pageToken && seen.has(pageToken))
        throw new Error("Repeated Gmail pagination token");
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
  }
  getMessage(
    id: string,
    format: "metadata" | "full" = "metadata",
  ): Promise<GmailMessage> {
    const params = new URLSearchParams({ format });
    if (format === "metadata")
      for (const name of METADATA_HEADERS)
        params.append("metadataHeaders", name);
    return this.request(`messages/${encodeURIComponent(id)}?${params}`);
  }
  getProfile(): Promise<GmailProfile> {
    return this.request("profile");
  }
  getSafetyMessage(id: string): Promise<GmailMessage> {
    // Partial response projects MIME structure only, excluding every body/data field.
    // The deepest multipart node omits children and is treated as uncertain.
    let partFields = "mimeType,filename,headers";
    for (let depth = 0; depth < 6; depth++)
      partFields = `mimeType,filename,headers,parts(${partFields})`;
    const params = new URLSearchParams({
      format: "full",
      fields: `id,threadId,labelIds,internalDate,sizeEstimate,historyId,payload(${partFields})`,
    });
    return this.request(`messages/${encodeURIComponent(id)}?${params}`);
  }
  getThread(
    id: string,
    format: "metadata" | "full" = "metadata",
  ): Promise<GmailThread> {
    const params = new URLSearchParams({ format });
    if (format === "metadata")
      for (const name of METADATA_HEADERS)
        params.append("metadataHeaders", name);
    return this.request(`threads/${encodeURIComponent(id)}?${params}`);
  }
  trashMessage(id: string): Promise<GmailMessage> {
    return this.request(`messages/${encodeURIComponent(id)}/trash`, "POST", {});
  }
  untrashMessage(id: string): Promise<GmailMessage> {
    return this.request(
      `messages/${encodeURIComponent(id)}/untrash`,
      "POST",
      {},
    );
  }
  archiveMessage(id: string): Promise<GmailMessage> {
    return this.request(`messages/${encodeURIComponent(id)}/modify`, "POST", {
      removeLabelIds: ["INBOX"],
    });
  }
  restoreInbox(id: string): Promise<GmailMessage> {
    return this.request(`messages/${encodeURIComponent(id)}/modify`, "POST", {
      addLabelIds: ["INBOX"],
    });
  }
  listHistory(
    startHistoryId: string,
    pageToken?: string,
    maxResults = 500,
  ): Promise<HistoryPage> {
    if (!/^\d+$/.test(startHistoryId))
      throw new Error("Invalid Gmail history ID");
    const params = new URLSearchParams({
      startHistoryId,
      maxResults: String(Math.min(500, Math.max(1, maxResults))),
    });
    if (pageToken) params.set("pageToken", pageToken);
    return this.request(`history?${params}`);
  }
  async *iterateHistory(
    startHistoryId: string,
    maxPages = 100,
  ): AsyncGenerator<HistoryPage> {
    if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 1000)
      throw new Error("Invalid history page limit");
    let pageToken: string | undefined;
    const seen = new Set<string>();
    for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
      const page = await this.listHistory(startHistoryId, pageToken);
      yield page;
      pageToken = page.nextPageToken;
      if (!pageToken) return;
      if (seen.has(pageToken))
        throw new Error("Repeated Gmail history pagination token");
      seen.add(pageToken);
    }
    throw new Error(
      "Gmail history page limit exceeded; cursor must not advance",
    );
  }
  watch(topicName: string): Promise<{ historyId: string; expiration: string }> {
    if (!/^projects\/[^/]+\/topics\/[^/]+$/.test(topicName))
      throw new Error("Invalid Pub/Sub topic");
    return this.request("watch", "POST", {
      topicName,
      labelIds: ["INBOX"],
      labelFilterBehavior: "include",
    });
  }
  stopWatch(): Promise<void> {
    return this.request("stop", "POST");
  }
}
