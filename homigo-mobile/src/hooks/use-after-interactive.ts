import { useEffect, useState } from "react";
import { getStartupTimeline, onInteractive } from "@/lib/startup-trace";

/** True after splash hides / INTERACTIVE marker — gate non-critical startup I/O. */
export function useAfterInteractive(): boolean {
  const [ready, setReady] = useState(() =>
    getStartupTimeline().some((e) => e.marker === "INTERACTIVE"),
  );

  useEffect(() => onInteractive(() => setReady(true)), []);

  return ready;
}
