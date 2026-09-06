"use client";

import { useEffect, useState } from "react";

/**
 * False on the first paint of a route, then true after the browser has committed
 * the page shell. Use to keep secondary APIs off the navigation critical path.
 */
export function useAfterFirstPaint(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) setReady(true);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, []);

  return ready;
}
