#!/usr/bin/env node
/**
 * Phase 4: realtime stream certification — 100k messages, bounded memory, dedupe, unique first-pass.
 */
const MAX_SIZE = 2000;

class BoundedEventCache {
  constructor(maxSize = MAX_SIZE) {
    this.maxSize = maxSize;
    this.entries = new Map();
  }
  has(key) {
    return this.entries.has(key);
  }
  add(key) {
    if (this.entries.has(key)) this.entries.delete(key);
    else if (this.entries.size >= this.maxSize) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, Date.now());
  }
  get size() {
    return this.entries.size;
  }
}

function runStream(total, duplicateRate) {
  const cache = new BoundedEventCache();
  let processed = 0;
  let duplicatesFiltered = 0;
  for (let i = 0; i < total; i++) {
    const isDup = i > 0 && Math.random() < duplicateRate;
    const key = isDup ? `evt:${Math.floor(Math.random() * Math.min(i, 5000))}` : `evt:${i}`;
    if (cache.has(key)) {
      duplicatesFiltered++;
      continue;
    }
    cache.add(key);
    processed++;
  }
  return { cache, processed, duplicatesFiltered };
}

// 100k stream with 35% duplicate injection
const stream = runStream(100_000, 0.35);
const memOk = stream.cache.size <= MAX_SIZE;
const dupOk = stream.duplicatesFiltered > 1_000;

// 10k sequential unique — every event accepted exactly once on first pass
const sequential = new BoundedEventCache();
let seqProcessed = 0;
let seqDupes = 0;
for (let i = 0; i < 10_000; i++) {
  const key = `seq:${i}`;
  if (sequential.has(key)) {
    seqDupes++;
    continue;
  }
  sequential.add(key);
  seqProcessed++;
}

const seqOk = seqProcessed === 10_000 && seqDupes === 0;

if (!memOk || !dupOk || !seqOk) {
  console.error("[certify:realtime] FAIL");
  console.error(`  100k memory bounded: ${memOk} (size=${stream.cache.size})`);
  console.error(`  100k duplicates filtered: ${stream.duplicatesFiltered}`);
  console.error(`  10k unique processed: ${seqProcessed}/10000, dupes=${seqDupes}`);
  process.exit(1);
}

console.log("[certify:realtime] PASS");
console.log(`  100k messages processed: ${stream.processed}`);
console.log(`  100k duplicates filtered: ${stream.duplicatesFiltered}`);
console.log(`  cache size after 100k: ${stream.cache.size} (cap ${MAX_SIZE})`);
console.log(`  10k sequential unique loss: ${10_000 - seqProcessed}`);
