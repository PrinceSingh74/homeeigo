import { Elysia } from "elysia";
import crypto from "crypto";

export const errorMiddleware = new Elysia().onError(({ code, error, set }) => {
  const requestId = crypto.randomUUID();
  if (code === "VALIDATION") {
    set.status = 400;
    return { success: false, error: "Invalid request payload", code: "INVALID_INPUT", requestId };
  }
  set.status = 500;
  return {
    success: false,
    error: error instanceof Error ? error.message : "An error occurred. Please try again later.",
    code: "INTERNAL_ERROR",
    requestId,
  };
});
