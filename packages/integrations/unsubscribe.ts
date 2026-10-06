export type UnsubscribeCandidate = {
  kind: "https" | "mailto";
  url: string;
  oneClick: boolean;
};
export type UnsubscribeAssessment = {
  status: "manual-required" | "blocked" | "unavailable";
  reason: string;
  candidates: UnsubscribeCandidate[];
};
function publicHostname(host: string): boolean {
  // IP literals, single-label names and internal/reserved suffixes are blocked.
  // This is only lexical screening, never proof of DNS/network safety.
  return (
    host.length <= 253 &&
    /^[a-z0-9.-]+$/i.test(host) &&
    host.includes(".") &&
    !/^\d+(\.\d+)*$/.test(host) &&
    !/(^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(
      host,
    ) &&
    host
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
  );
}
export function parseUnsubscribeHeaders(
  listUnsubscribe: string,
  listUnsubscribePost = "",
): UnsubscribeCandidate[] {
  if (
    listUnsubscribe.length > 8192 ||
    /[\r\n\u0000]/.test(listUnsubscribe) ||
    /[\r\n\u0000]/.test(listUnsubscribePost)
  )
    return [];
  const oneClick = /^List-Unsubscribe=One-Click$/i.test(
    listUnsubscribePost.trim(),
  );
  const candidates: UnsubscribeCandidate[] = [];
  for (const match of listUnsubscribe.matchAll(/<([^<>]+)>/g)) {
    if (candidates.length >= 5) break;
    try {
      const raw = match[1].trim();
      const url = new URL(raw);
      if (url.href.length > 2048 || url.username || url.password || url.hash)
        continue;
      if (
        url.protocol === "https:" &&
        (!url.port || url.port === "443") &&
        publicHostname(url.hostname)
      )
        candidates.push({ kind: "https", url: url.href, oneClick });
      if (
        url.protocol === "mailto:" &&
        !/[\r\n\u0000]/.test(decodeURIComponent(raw)) &&
        /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(url.pathname) &&
        !url.search
      )
        candidates.push({ kind: "mailto", url: url.href, oneClick: false });
    } catch {
      /* malformed headers are untrusted */
    }
  }
  return candidates;
}
/** Deliberately does not fetch attacker-controlled URLs, resolve DNS, or send mail. */
export function assessUnsubscribe(
  listUnsubscribe: string,
  listUnsubscribePost = "",
): UnsubscribeAssessment {
  const candidates = parseUnsubscribeHeaders(
    listUnsubscribe,
    listUnsubscribePost,
  );
  if (!listUnsubscribe.trim())
    return {
      status: "unavailable",
      reason: "No List-Unsubscribe header is present.",
      candidates,
    };
  if (!candidates.length)
    return {
      status: "blocked",
      reason: "No supported unsubscribe destination passed lexical checks.",
      candidates,
    };
  return {
    status: "manual-required",
    reason:
      "Automatic unsubscribe is disabled: this runtime cannot pin a verified public DNS address throughout TLS and redirects. Review the destination and unsubscribe manually; no request has been sent.",
    candidates,
  };
}
