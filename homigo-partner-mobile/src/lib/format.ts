export function formatCurrency(amount: number) {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

export function formatPct(value: number, digits = 0) {
  return `${value.toFixed(digits)}%`;
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function customerName(c: { firstName: string | null; lastName: string | null }) {
  return [c.firstName, c.lastName].filter(Boolean).join(" ") || "Customer";
}

export function onlineHours(onlineSince: string | null) {
  if (!onlineSince) return 0;
  return Math.max(0, (Date.now() - new Date(onlineSince).getTime()) / (1000 * 60 * 60));
}
