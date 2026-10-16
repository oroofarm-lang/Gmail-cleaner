import { z } from "zod";

function encode(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function decode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error("Invalid encrypted data");
  return Uint8Array.from(
    atob(value.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
}
export type OAuthTransaction = {
  state: string;
  verifier: string;
  challenge: string;
  expiresAt: number;
};
export const GoogleTokensSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  token_type: z.literal("Bearer"),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  id_token: z.string().optional(),
});
export type GoogleTokens = z.infer<typeof GoogleTokensSchema>;
export async function createOAuthTransaction(
  now = Date.now(),
): Promise<OAuthTransaction> {
  const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = encode(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  return {
    state: encode(crypto.getRandomValues(new Uint8Array(32))),
    verifier,
    challenge,
    expiresAt: now + 600_000,
  };
}
export function validateOAuthState(
  transaction: OAuthTransaction,
  returnedState: string,
  now = Date.now(),
): void {
  // Caller must atomically consume the session-bound transaction before code exchange.
  let difference = transaction.state.length ^ returnedState.length;
  for (let i = 0; i < transaction.state.length; i++)
    difference |=
      transaction.state.charCodeAt(i) ^ (returnedState.charCodeAt(i) || 0);
  if (difference !== 0 || now >= transaction.expiresAt)
    throw new Error("Invalid or expired OAuth state");
}
function validRedirect(redirectUri: string): string {
  const url = new URL(redirectUri);
  if (
    url.username ||
    url.password ||
    url.hash ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    throw new Error("Invalid OAuth redirect URI");
  return url.href;
}
export function buildGoogleAuthorizationUrl(options: {
  clientId: string;
  redirectUri: string;
  transaction: OAuthTransaction;
  scope?: "readonly" | "modify";
}): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: validRedirect(options.redirectUri),
    response_type: "code",
    scope: `https://www.googleapis.com/auth/gmail.${options.scope ?? "readonly"}`,
    state: options.transaction.state,
    code_challenge: options.transaction.challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  }).toString();
  return url.href;
}
async function tokenRequest(
  params: Record<string, string>,
  fetcher: typeof fetch,
): Promise<GoogleTokens> {
  const response = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error(`Google token exchange failed (${response.status})`);
  return GoogleTokensSchema.parse(await response.json());
}
export async function exchangeGoogleCode(options: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  returnedState: string;
  transaction: OAuthTransaction;
  fetch?: typeof fetch;
}): Promise<GoogleTokens> {
  validateOAuthState(options.transaction, options.returnedState);
  return tokenRequest(
    {
      client_id: options.clientId,
      client_secret: options.clientSecret,
      redirect_uri: validRedirect(options.redirectUri),
      code: options.code,
      code_verifier: options.transaction.verifier,
      grant_type: "authorization_code",
    },
    options.fetch ?? fetch,
  );
}
export function refreshGoogleToken(options: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetch?: typeof fetch;
}): Promise<GoogleTokens> {
  return tokenRequest(
    {
      client_id: options.clientId,
      client_secret: options.clientSecret,
      refresh_token: options.refreshToken,
      grant_type: "refresh_token",
    },
    options.fetch ?? fetch,
  );
}
export async function revokeGoogleToken(
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error(`Google token revocation failed (${response.status})`);
}
async function importKey(key: string) {
  const bytes = decode(key);
  if (bytes.length !== 32)
    throw new Error("Token encryption requires a 256-bit key");
  return crypto.subtle.importKey(
    "raw",
    bytes as BufferSource,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
/** AES-GCM binds ciphertext to an account ID; callers keep the key in a server secret. */
export async function encryptTokens(
  tokens: GoogleTokens,
  key: string,
  accountId: string,
): Promise<string> {
  if (!accountId) throw new Error("Account binding required");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(accountId),
    },
    await importKey(key),
    new TextEncoder().encode(JSON.stringify(GoogleTokensSchema.parse(tokens))),
  );
  return `v1.${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
}
export async function decryptTokens(
  envelope: string,
  key: string,
  accountId: string,
): Promise<GoogleTokens> {
  const [version, iv, ciphertext, extra] = envelope.split(".");
  if (
    !accountId ||
    version !== "v1" ||
    !iv ||
    !ciphertext ||
    extra ||
    decode(iv).length !== 12
  )
    throw new Error("Invalid token envelope");
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: decode(iv) as BufferSource,
      additionalData: new TextEncoder().encode(accountId),
    },
    await importKey(key),
    decode(ciphertext) as BufferSource,
  );
  return GoogleTokensSchema.parse(
    JSON.parse(new TextDecoder().decode(plaintext)),
  );
}
