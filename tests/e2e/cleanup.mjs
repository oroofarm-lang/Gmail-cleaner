import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
export default async function cleanup() {
  const state = process.env.INBOX_E2E_STATE;
  if (
    state &&
    path.resolve(path.dirname(state)) === path.resolve(tmpdir()) &&
    path.basename(state).startsWith("inbox-e2e-")
  )
    await rm(state, { recursive: true, force: true });
}
