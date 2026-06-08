/**
 * Default, user-friendly recovery hints keyed by error code. Used only when
 * the caller does not supply its own `suggestion` in `extra`.
 */
const DEFAULT_SUGGESTIONS: Record<string, string> = {
  VALIDATION_ERROR: "Please check your input and try again.",
  UNAUTHORIZED: "Please sign in again to continue.",
  FORBIDDEN: "You do not have permission to perform this action.",
  NOT_FOUND: "Please check the resource and try again.",
  CONFLICT: "Please resolve the conflicting or duplicate data and retry.",
  RATE_LIMIT_EXCEEDED: "Too many requests. Please wait a moment and try again.",
  SERVICE_UNAVAILABLE: "The service is temporarily unavailable. Please try again shortly.",
  INTERNAL_ERROR: "Something went wrong on our end. Please try again later.",
};

export function errorResponse(
  error: string,
  code:
    | "VALIDATION_ERROR"
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "CONFLICT"
    | "RATE_LIMIT_EXCEEDED"
    | "INTERNAL_ERROR"
    | "SERVICE_UNAVAILABLE"
    | string,
  extra?: Record<string, unknown>,
) {
  const provided = extra ?? {};
  // Only fill a default suggestion when the caller did not provide one.
  const suggestion =
    "suggestion" in provided ? provided.suggestion : DEFAULT_SUGGESTIONS[code];

  return {
    success: false as const,
    error,
    code,
    timestamp: new Date().toISOString(),
    ...(suggestion !== undefined ? { suggestion } : {}),
    ...provided,
  };
}
