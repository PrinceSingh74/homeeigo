"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

type Particle = {
  id: number;
  left: string;
  top: string;
  size: string;
  delay: number;
  duration: number;
};

/** Deterministic 0–1 — same on server and client. */
function hash01(index: number, channel: number) {
  const n = Math.sin(index * 12.9898 + channel * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

/** Fixed precision strings so SSR/client HTML matches exactly. */
function buildParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    left: `${(hash01(i, 1) * 100).toFixed(2)}%`,
    top: `${(hash01(i, 2) * 100).toFixed(2)}%`,
    size: `${(2 + hash01(i, 3) * 6).toFixed(2)}px`,
    delay: Number((hash01(i, 4) * 8).toFixed(2)),
    duration: Number((18 + hash01(i, 5) * 22).toFixed(2)),
  }));
}

export function AiParticles({ count = 48 }: { count?: number }) {
  const [mounted, setMounted] = useState(false);
  const particles = useMemo(() => buildParticles(count), [count]);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {mounted &&
        particles.map((p) => (
          <motion.span
            key={p.id}
            className="absolute rounded-full bg-white/60"
            style={{
              left: p.left,
              top: p.top,
              width: p.size,
              height: p.size,
            }}
            animate={{ y: [0, -120], opacity: [0.2, 0.8, 0.2] }}
            transition={{
              duration: p.duration,
              delay: p.delay,
              repeat: Infinity,
              ease: "linear",
            }}
          />
        ))}
    </div>
  );
}
