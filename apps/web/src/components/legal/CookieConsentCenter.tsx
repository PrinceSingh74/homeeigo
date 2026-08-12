"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Cookie,
  Check,
  ChevronDown,
  History,
  Save,
  ShieldCheck,
  Clock,
  Lock,
} from "lucide-react";
import { LegalHero } from "@/components/legal/LegalHero";
import { LegalFooterNav } from "@/components/legal/LegalFooterNav";
import { COOKIE_CATEGORIES, type CookieCategory } from "@/lib/legal/legal-data";
import { apiRequest } from "@/services/auth/api-client";
import { cn } from "@/lib/utils";

// Reuse the banner's key so both stay in sync; add granular + history keys.
const CONSENT_KEY = "homigo_cookie_consent";
const PREFS_KEY = "homigo_cookie_prefs";
const HISTORY_KEY = "homigo_consent_history";

type Prefs = Record<CookieCategory["id"], boolean>;
type HistoryEntry = { at: string; action: string; enabled: string[] };

const OPTIONAL = COOKIE_CATEGORIES.filter((c) => !c.always);

function defaultPrefs(all: boolean): Prefs {
  return COOKIE_CATEGORIES.reduce((acc, c) => {
    acc[c.id] = c.always ? true : all;
    return acc;
  }, {} as Prefs);
}

function loadPrefs(): Prefs {
  if (typeof localStorage === "undefined") return defaultPrefs(false);
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...defaultPrefs(false), ...(JSON.parse(raw) as Prefs), necessary: true };
  } catch {
    /* ignore */
  }
  // Fall back to the binary banner choice if present.
  const legacy = localStorage.getItem(CONSENT_KEY);
  return defaultPrefs(legacy === "granted");
}

function loadHistory(): HistoryEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as HistoryEntry[];
  } catch {
    return [];
  }
}

export function CookieConsentCenter() {
  const [mounted, setMounted] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(() => defaultPrefs(false));
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    setPrefs(loadPrefs());
    setHistory(loadHistory());
  }, []);

  function persist(next: Prefs, action: string) {
    const enabled = COOKIE_CATEGORIES.filter((c) => next[c.id]).map((c) => c.name);
    const grantedOptional = OPTIONAL.some((c) => next[c.id]);
    const entry: HistoryEntry = { at: new Date().toISOString(), action, enabled };
    const nextHistory = [entry, ...history].slice(0, 20);

    setPrefs(next);
    setHistory(nextHistory);
    setSavedAt(entry.at);

    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      // Keep the binary banner key in sync so the banner stops showing.
      localStorage.setItem(CONSENT_KEY, grantedOptional ? "granted" : "declined");
      localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
    } catch {
      /* storage unavailable — session-only */
    }
    // Record server-side using the EXISTING endpoint contract (unchanged).
    void apiRequest("/api/legal/consent/cookies", {
      method: "POST",
      body: { granted: grantedOptional },
    }).catch(() => {
      /* non-blocking — stored locally */
    });
  }

  const acceptAll = () => persist(defaultPrefs(true), "Accepted all cookies");
  const rejectAll = () => persist(defaultPrefs(false), "Rejected optional cookies");
  const saveCurrent = () => persist({ ...prefs, necessary: true }, "Saved custom preferences");
  const toggle = (c: CookieCategory) => {
    if (c.always) return;
    setPrefs((p) => ({ ...p, [c.id]: !p[c.id] }));
    setSavedAt(null);
  };

  const enabledCount = COOKIE_CATEGORIES.filter((c) => prefs[c.id]).length;

  return (
    <main className="min-h-screen">
      <LegalHero
        eyebrow="Cookie & Consent"
        title="Cookie Preferences Center"
        subtitle="Manage how HOMEEIGO uses cookies and similar technologies. Compliant with GDPR (EU/UK) and India's DPDP Act — you're in control."
      >
        <div className="mx-auto mt-8 flex max-w-md flex-wrap items-center justify-center gap-3 print:hidden">
          <button
            type="button"
            onClick={acceptAll}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-e2 transition-transform hover:scale-[1.02]"
          >
            <Check size={16} aria-hidden /> Accept All
          </button>
          <button
            type="button"
            onClick={rejectAll}
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-5 py-2.5 text-sm font-semibold text-content shadow-e1 transition-colors hover:border-primary/40"
          >
            Reject All
          </button>
          <a
            href="#customize"
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-5 py-2.5 text-sm font-semibold text-content shadow-e1 transition-colors hover:border-primary/40"
          >
            Customize
          </a>
        </div>
      </LegalHero>

      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        {/* Privacy dashboard */}
        <section className="mb-8 rounded-3xl border border-line bg-surface/80 p-6 shadow-e1 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span aria-hidden className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <ShieldCheck size={20} />
              </span>
              <div>
                <h2 className="font-display text-lg font-bold text-content">Your Privacy Dashboard</h2>
                <p className="text-sm text-muted">
                  {mounted ? `${enabledCount} of ${COOKIE_CATEGORIES.length} categories active` : "Loading preferences…"}
                </p>
              </div>
            </div>
            {savedAt ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-3 py-1.5 text-xs font-semibold text-emerald-600 ring-1 ring-emerald-500/25 dark:text-emerald-300">
                <Check size={13} aria-hidden /> Preferences saved
              </span>
            ) : null}
          </div>
          <ul className="mt-4 flex flex-wrap gap-2">
            {COOKIE_CATEGORIES.map((c) => (
              <li
                key={c.id}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1",
                  mounted && prefs[c.id]
                    ? "bg-primary/10 text-primary ring-primary/25"
                    : "bg-canvas/50 text-muted ring-line",
                )}
              >
                {mounted && prefs[c.id] ? <Check size={12} aria-hidden /> : null}
                {c.name}
              </li>
            ))}
          </ul>
        </section>

        {/* Categories */}
        <div id="customize" className="scroll-mt-24 space-y-4">
          {COOKIE_CATEGORIES.map((c) => {
            const on = mounted ? prefs[c.id] : c.always ?? false;
            const isOpen = expanded === c.id;
            return (
              <section key={c.id} className="rounded-3xl border border-line bg-surface/80 p-6 shadow-e1 backdrop-blur-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-base font-bold text-content sm:text-lg">{c.name}</h3>
                      {c.always ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2.5 py-0.5 text-[11px] font-bold text-emerald-600 ring-1 ring-emerald-500/25 dark:text-emerald-300">
                          <Lock size={10} aria-hidden /> Always Active
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted">{c.description}</p>
                  </div>

                  {/* Toggle */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`${c.name}${c.always ? " (always active)" : ""}`}
                    disabled={c.always}
                    onClick={() => toggle(c)}
                    className={cn(
                      "relative mt-1 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors",
                      on ? "bg-primary" : "bg-line",
                      c.always ? "cursor-not-allowed opacity-70" : "cursor-pointer",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block size-5 rounded-full bg-white shadow transition-transform",
                        on ? "translate-x-6" : "translate-x-1",
                      )}
                    />
                  </button>
                </div>

                {/* View details */}
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : c.id)}
                  aria-expanded={isOpen}
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
                >
                  {isOpen ? "Hide details" : "View cookie details"}
                  <ChevronDown size={15} className={cn("transition-transform", isOpen && "rotate-180")} aria-hidden />
                </button>

                {isOpen ? (
                  <div className="mt-4 grid gap-4 rounded-2xl border border-line/70 bg-canvas/40 p-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Purpose</p>
                      <p className="mt-1 text-sm text-content">{c.purpose}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Examples</p>
                      <ul className="mt-1 flex flex-wrap gap-1.5">
                        {c.examples.map((ex) => (
                          <li key={ex} className="rounded-md bg-surface px-2 py-0.5 font-mono text-xs text-content ring-1 ring-line">
                            {ex}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Expiry</p>
                      <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-content">
                        <Clock size={14} className="text-muted" aria-hidden />
                        {c.expiry}
                      </p>
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>

        {/* Save bar */}
        <div className="sticky bottom-4 z-30 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface/95 p-4 shadow-e4 backdrop-blur-md print:hidden">
          <p className="flex items-center gap-2 text-sm text-muted">
            <Cookie size={16} className="text-primary" aria-hidden />
            You can change these choices any time.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={rejectAll}
              className="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-content transition-colors hover:border-primary/40"
            >
              Reject All
            </button>
            <button
              type="button"
              onClick={saveCurrent}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-e2 transition-transform hover:scale-[1.02]"
            >
              <Save size={16} aria-hidden /> Save Preferences
            </button>
          </div>
        </div>

        {/* Consent history */}
        <section className="mt-10 rounded-3xl border border-line bg-surface/80 p-6 shadow-e1 backdrop-blur-sm">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-content">
            <History size={18} className="text-primary" aria-hidden /> Consent History
          </h2>
          <p className="mt-1 text-sm text-muted">
            An auditable record of your consent choices, stored on this device.
          </p>
          {mounted && history.length ? (
            <ol className="mt-4 space-y-2.5">
              {history.map((h, i) => (
                <li key={`${h.at}-${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line/70 bg-canvas/40 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-content">{h.action}</p>
                    <p className="text-xs text-muted">{h.enabled.join(", ") || "Only strictly necessary"}</p>
                  </div>
                  <time className="text-xs text-muted" dateTime={h.at}>
                    {new Date(h.at).toLocaleString()}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-4 rounded-xl border border-line/70 bg-canvas/40 px-4 py-6 text-center text-sm text-muted">
              {mounted ? "No consent choices recorded yet on this device." : "Loading…"}
            </p>
          )}
        </section>

        {/* Legal links */}
        <div className="mt-8 flex flex-wrap gap-2.5">
          <Link href="/legal/privacy" className="inline-flex items-center rounded-full border border-line bg-surface px-4 py-2 text-sm font-semibold text-content transition-colors hover:border-primary/40 hover:text-primary">
            Privacy Policy
          </Link>
          <Link href="/legal/terms" className="inline-flex items-center rounded-full border border-line bg-surface px-4 py-2 text-sm font-semibold text-content transition-colors hover:border-primary/40 hover:text-primary">
            Terms of Service
          </Link>
          <Link href="/legal/cookies" aria-current="page" className="inline-flex items-center rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white">
            Cookie Policy
          </Link>
        </div>
      </div>

      <LegalFooterNav current="/legal/cookies" />
    </main>
  );
}
