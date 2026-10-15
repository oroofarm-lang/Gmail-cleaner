import { env } from "cloudflare:workers";
import { ApiError, config, binding } from "./server";
import { appendDeletion, type JournalStore } from "@/packages/recovery/journal";
export async function recordDeletion(tenant: string, kind: "account" | "data") {
  const store = (env as unknown as { RECOVERY_JOURNAL?: JournalStore })
    .RECOVERY_JOURNAL;
  const key = config("INBOX_RECOVERY_KEY"),
    namespace = config("INBOX_RECOVERY_NAMESPACE");
  if (!store || !key || !namespace)
    throw new ApiError(
      503,
      "Deletion is unavailable until the operator configures the independent recovery journal. Your data has not been deleted.",
    );
  const current = await binding()
    .prepare("SELECT data_epoch FROM tenants WHERE id=? AND deleted=0")
    .bind(tenant)
    .first<{ data_epoch: number }>();
  if (!current) throw new ApiError(403, "Account is unavailable.");
  if (
    !Number.isSafeInteger(current.data_epoch) ||
    current.data_epoch < 0 ||
    current.data_epoch >= Number.MAX_SAFE_INTEGER
  )
    throw new ApiError(
      503,
      "Data generation is unavailable; operator recovery is required.",
    );
  try {
    await appendDeletion(
      store,
      key,
      namespace,
      tenant,
      kind,
      current.data_epoch,
    );
    return current.data_epoch;
  } catch {
    throw new ApiError(
      503,
      "The recovery journal could not confirm deletion protection. No local data was deleted; try again or contact the operator.",
    );
  }
}
