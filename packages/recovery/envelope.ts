import { z } from "zod";

const header = z
  .object({
    version: z.literal(1),
    purpose: z.enum(["snapshot", "deletions"]),
    namespace: z.string().uuid(),
    keyId: z.string().regex(/^[a-f0-9]{64}$/),
    iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
    ciphertext: z
      .string()
      .min(22)
      .max(400_000_000)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();
export type RecoveryPurpose = "snapshot" | "deletions";
function encode(bytes: Uint8Array) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
function decode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value))
    throw Error("Invalid recovery encoding.");
  const bytes = Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    (c) => c.charCodeAt(0),
  );
  if (encode(bytes) !== value) throw Error("Noncanonical recovery encoding.");
  return bytes;
}
async function keyMaterial(secret: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret))
    throw Error("Recovery key must be 32 bytes encoded as base64url.");
  const bytes = decode(secret);
  if (bytes.length !== 32) throw Error("Invalid recovery key length.");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const keyId = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return {
    keyId,
    key: await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]),
  };
}
const aad = (purpose: RecoveryPurpose, namespace: string, keyId: string) =>
  new TextEncoder().encode(
    JSON.stringify({ version: 1, purpose, namespace, keyId }),
  );
export async function sealRecovery(
  value: unknown,
  secret: string,
  purpose: RecoveryPurpose,
  namespace: string,
) {
  z.string().uuid().parse(namespace);
  const { key, keyId } = await keyMaterial(secret);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  if (plaintext.length > 250_000_000)
    throw Error("Recovery payload exceeds the verified size limit.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad(purpose, namespace, keyId) },
      key,
      plaintext,
    ),
  );
  return {
    version: 1 as const,
    purpose,
    namespace,
    keyId,
    iv: encode(iv),
    ciphertext: encode(ciphertext),
  };
}
export async function openRecovery(
  envelope: unknown,
  secret: string,
  purpose: RecoveryPurpose,
  namespace: string,
) {
  const parsed = header.parse(envelope);
  const { key, keyId } = await keyMaterial(secret);
  if (
    parsed.namespace !== namespace ||
    parsed.purpose !== purpose ||
    parsed.keyId !== keyId
  )
    throw Error("Recovery scope/key mismatch.");
  const bytes = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: decode(parsed.iv),
      additionalData: aad(purpose, namespace, keyId),
    },
    key,
    decode(parsed.ciphertext),
  );
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
