const opsCounters = new Map<string, number>();
const opsGauges = new Map<string, number>();

export function recordOpsMetric(
  name: string,
  value: number,
  labels?: Record<string, string>,
): void {
  const key = labels
    ? `${name}{${Object.entries(labels)
        .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
        .join(",")}}`
    : name;
  if (name.endsWith("_gauge") || name.includes("connections") || name.includes("backlog")) {
    opsGauges.set(key, value);
  } else {
    opsCounters.set(key, (opsCounters.get(key) ?? 0) + value);
  }
}

export function setOpsGauge(name: string, value: number, labels?: Record<string, string>): void {
  const key = labels
    ? `${name}{${Object.entries(labels)
        .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
        .join(",")}}`
    : name;
  opsGauges.set(key, value);
}

export function renderOpsMetrics(): string {
  const lines: string[] = [];
  // Emit exactly ONE `# TYPE` line per metric NAME (multiple label-combos share it),
  // otherwise strict Prometheus parsers reject duplicate TYPE declarations.
  const emit = (entries: Iterable<[string, number]>, kind: "counter" | "gauge") => {
    const byName = new Map<string, string[]>();
    for (const [key, value] of entries) {
      const name = key.split("{")[0]!;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name)!.push(`${key} ${value}`);
    }
    for (const [name, rows] of byName) {
      lines.push(`# TYPE ${name} ${kind}`);
      lines.push(...rows);
    }
  };
  emit(opsCounters, "counter");
  emit(opsGauges, "gauge");
  return lines.join("\n");
}
