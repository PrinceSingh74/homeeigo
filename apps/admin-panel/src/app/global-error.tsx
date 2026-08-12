"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for crashes in the ROOT layout itself. Replaces the whole
 * document, so it must render its own <html>/<body>. Uses inline styles only
 * (global CSS may not have loaded if the root layout failed).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[HOMEEIGO HQ] global", error);
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
          gap: 16,
          background: "#0b1220",
          color: "#e5edff",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
          textAlign: "center",
          padding: 24,
        }}
      >
        <p style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>HOMEEIGO HQ hit an error</p>
        <p style={{ fontSize: 14, color: "#8ea3c9", margin: 0, maxWidth: 420 }}>
          The console failed to start. Reloading usually fixes this.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <button
            type="button"
            onClick={() => reset()}
            style={{ borderRadius: 12, border: "none", background: "#2563eb", color: "#fff", padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ borderRadius: 12, border: "1px solid #2a3752", background: "transparent", color: "#e5edff", padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
