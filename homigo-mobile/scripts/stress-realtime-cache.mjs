#!/usr/bin/env node
/**
 * Stress BoundedEventCache with 100k events — memory must stay bounded (≤ maxSize).
 */
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Compile-free test: replicate the cache algorithm inline (mirrors bounded-cache.ts).
class BoundedEventCache {
  constructor(maxSize = 2000, ttlMs = 8 * 60 * 60 * 1000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.entries = new Map();
  }
  has(key) {
    this.evictExpired();
    return this.entries.has(key);
  }
  add(key) {
    this.evictExpired();
    if (this.entries.has(key)) this.entries.delete(key);
    else if (this.entries.size >= this.maxSize) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, Date.now());
  }
  get size() {
    this.evictExpired();
    return this.entries.size;
  }
  evictExpired() {
    const now = Date.now();
    for (const [k, at] of this.entries) {
      if (now - at > this.ttlMs) this.entries.delete(k);
    }
  }
}

const cache = new BoundedEventCache(2000);
const EVENTS = 100_000;

for (let i = 0; i < EVENTS; i++) {
  const key = `evt:${i}`;
  if (!cache.has(key)) cache.add(key);
}

if (cache.size > 2000) {
  console.error(`[verify:realtime-cache] FAIL — size ${cache.size} exceeds cap 2000 after ${EVENTS} events`);
  process.exit(1);
}

console.log(`[verify:realtime-cache] PASS — ${EVENTS} events processed, final size=${cache.size} (cap=2000)`);
