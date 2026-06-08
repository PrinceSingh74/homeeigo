import crypto from "crypto";
import { redisClient } from "./redis";
import { logger } from "./logger";

const INSTANCE_ID = `inst_${crypto.randomBytes(6).toString("hex")}`;

/**
 * Run a maintenance task on exactly one instance when Redis is available.
 * Falls back to always-run when Redis is disabled (single-node dev).
 */
export async function runWithLeaderLock(
  lockKey: string,
  ttlSec: number,
  fn: () => Promise<void>,
): Promise<boolean> {
  const token = `${INSTANCE_ID}_${crypto.randomBytes(4).toString("hex")}`;
  const acquired = await redisClient.acquireLock(lockKey, token, ttlSec);
  if (!acquired) return false;
  try {
    await fn();
    return true;
  } catch (err) {
    logger.error("scheduled_job_failed", {
      lockKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return true;
  } finally {
    await redisClient.releaseLock(lockKey, token);
  }
}

export function getSchedulerInstanceId(): string {
  return INSTANCE_ID;
}
