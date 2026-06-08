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
  for (const [key, value] of opsCounters) {
    const name = key.split("{")[0]!;
    lines.push(`# TYPE ${name} counter`);
    lines.push(`${key} ${value}`);
  }
  for (const [key, value] of opsGauges) {
    const name = key.split("{")[0]!;
    lines.push(`# TYPE ${name} gauge`);
    lines.push(`${key} ${value}`);
  }
  return lines.join("\n");
}
