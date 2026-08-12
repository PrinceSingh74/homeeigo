"use client";

import { useEffect, useRef, useState } from "react";

/** Lazy-hydrate heavy below-fold sections when they enter the viewport. */
export function useSectionVisibility(rootMargin = "200px 0px") {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin, threshold: 0.01 },
    );

    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);

  return { ref, visible };
}
