import type { ApiResponse } from "@/types/auth";
import { mutateWithOfflineFallback } from "./sender";

export type OfflineMutationResult<T> =
  | { queued: true; queueId: string }
  | { queued: false; data: T };

/**
 * Typed wrapper around mutateWithOfflineFallback for coreApi-shaped responses.
 * Returns a discriminated union so callers can show "queued for sync" UX vs immediate success.
 */
export async function offlineApiMutate<T>(
  req: { path: string; method: string; body?: unknown; auth?: boolean },
): Promise<OfflineMutationResult<T>> {
  const result = await mutateWithOfflineFallback<ApiResponse<T>>(req);
  if (result.queued) return { queued: true, queueId: result.id };
  if (!result.data.success) {
    throw new Error(result.data.error ?? "Request failed");
  }
  return { queued: false, data: result.data.data as T };
}
