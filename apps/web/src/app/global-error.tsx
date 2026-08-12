"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[HOMEEIGO]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          fontFamily: "system-ui, sans-serif",
          background: "#f8fafc",
          color: "#0f172a",
          textAlign: "center",
        }}
      >
        <p style={{ fontSize: "1.5rem", fontWeight: 700 }}>HOMEEIGO</p>
        <p style={{ marginTop: "0.75rem", maxWidth: "24rem", color: "#64748b" }}>
          Something went wrong loading the app. This is usually fixed by
          restarting the dev server with a clean cache.
        </p>
        <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem" }}>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "0.625rem 1.25rem",
              borderRadius: "0.75rem",
              border: "none",
              background: "#2563eb",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: "0.625rem 1.25rem",
              borderRadius: "0.75rem",
              border: "1px solid #e5e7eb",
              background: "#fff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload page
          </button>
        </div>
        <p style={{ marginTop: "1.25rem", fontSize: "0.8rem", color: "#94a3b8" }}>
          Dev fix: stop all terminals, then run{" "}
          <code style={{ background: "#e2e8f0", padding: "0.1rem 0.35rem" }}>
            npm run dev:fresh
          </code>{" "}
          in apps/web
        </p>
      </body>
    </html>
  );
}
