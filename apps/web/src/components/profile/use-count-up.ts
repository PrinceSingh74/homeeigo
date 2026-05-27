"use client";

import { useEffect, useState } from "react";

export function useCountUp(
  end: number,
  duration = 1000,
  enabled = true,
  decimals = 0,
) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setValue(end);
      return;
    }
    let start: number | null = null;
    let frame: number;
    const step = (ts: number) => {
      if (start === null) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(end * eased);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [end, duration, enabled]);

  return decimals > 0 ? value.toFixed(decimals) : Math.round(value);
}
