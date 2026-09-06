import type { PartnerLeadStatus } from "@/services/admin-api";

export function relTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60_000) return "Just now";
  if (d < 3_600_000) return `${Math.max(1, Math.floor(d / 60_000))}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  if (d < 604_800_000) return `${Math.floor(d / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function formatFollowUp(iso?: string | null): string {
  if (!iso) return "Not scheduled";
  const date = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  const time = date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

  if (diffDays < 0) return `Overdue · ${date.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} ${time}`;
  if (diffDays === 0) return `Today · ${time}`;
  if (diffDays === 1) return `Tomorrow · ${time}`;
  return `${date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })} · ${time}`;
}

export function followUpTone(iso?: string | null): "overdue" | "today" | "upcoming" | "none" {
  if (!iso) return "none";
  const date = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diffDays < 0) return "overdue";
  if (diffDays === 0) return "today";
  return "upcoming";
}

export function leadInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function statusLabel(status: PartnerLeadStatus): string {
  return status.replace(/_/g, " ");
}

export function phoneHref(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("91") ? `tel:+${digits}` : `tel:+91${digits}`;
}

export function smsHref(phone: string, body?: string): string {
  const digits = phone.replace(/\D/g, "");
  const tel = digits.startsWith("91") ? `+${digits}` : `+91${digits}`;
  if (!body) return `sms:${tel}`;
  return `sms:${tel}?body=${encodeURIComponent(body)}`;
}
