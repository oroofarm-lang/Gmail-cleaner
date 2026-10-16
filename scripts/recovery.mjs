import {
  encryptSnapshot,
  restoreSnapshot,
  readRecoveryFile,
  writeRecoveryFile,
} from "./recovery-store.mjs";
const [operation, ...args] = process.argv.slice(2);
const key = process.env.INBOX_RECOVERY_KEY,
  namespace = process.env.INBOX_RECOVERY_NAMESPACE;
try {
  if (!key || !namespace)
    throw Error(
      "Configure INBOX_RECOVERY_KEY and INBOX_RECOVERY_NAMESPACE through secure operator environment.",
    );
  if (operation === "snapshot" && args.length === 2) {
    await writeRecoveryFile(
      args[1],
      await encryptSnapshot(args[0], namespace, key),
    );
    console.log(
      "Encrypted snapshot created. No provider credentials/consents are included.",
    );
  } else if (operation === "restore" && args.length === 3) {
    const result = await restoreSnapshot(
      await readRecoveryFile(args[0]),
      await readRecoveryFile(args[1]),
      args[2],
      namespace,
      key,
    );
    console.log(JSON.stringify(result));
  } else
    throw Error(
      "Usage: recovery.mjs snapshot <SQLite source> <new encrypted file> | restore <encrypted snapshot> <authoritative encrypted journal> <new isolated SQLite target>",
    );
} catch {
  console.error(
    "Recovery failed closed. Verify command, secure configuration, current journal, compatible schema and a new isolated target. No secrets or recovery contents are logged.",
  );
  process.exitCode = 1;
}
