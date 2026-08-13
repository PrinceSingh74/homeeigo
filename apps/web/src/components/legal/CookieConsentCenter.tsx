"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, Clock, Cookie, History, Lock, Save, ShieldCheck } from "lucide-react";
import { LegalDocument, type LegalTocItem } from "@/components/legal/LegalDocument";
import { LegalFooterNav } from "@/components/legal/LegalFooterNav";
import { COOKIE_CATEGORIES, type CookieCategory } from "@/lib/legal/legal-data";
import { getLegalDoc } from "@/lib/legal/legal-docs";
import { apiRequest } from "@/services/auth/api-client";
import { cn } from "@/lib/utils";

// Reuse the banner's key so both stay in sync; add granular + history keys.
const CONSENT_KEY = "homigo_cookie_consent";
const PREFS_KEY = "homigo_cookie_prefs";
const HISTORY_KEY = "homigo_consent_history";

type Prefs = Record<CookieCategory["id"], boolean>;
type HistoryEntry = { at: string; action: string; enabled: string[] };

const DOC = getLegalDoc("cookies");
const OPTIONAL = COOKIE_CATEGORIES.filter((c) => !c.always);

const TOC: readonly LegalTocItem[] = COOKIE_CATEGORIES.map((category) => ({
  id: `cookie-${category.id}`,
  title: category.name,
}));

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
    <main>
      <LegalDocument
        doc={DOC}
        toc={TOC}
        surface={false}
        header={
          <div className="flex flex-wrap items-center gap-2.5 print:hidden">
            <button
              type="button"
              onClick={acceptAll}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-white shadow-e2 outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              <Check size={16} aria-hidden /> Accept All
            </button>
            <button
              type="button"
              onClick={rejectAll}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-5 text-sm font-semibold text-content shadow-e1 outline-none transition-colors hover:border-primary/40 hover:text-legal-accent focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              Reject All
            </button>
            <a
              href="#customize"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-muted outline-none transition-colors hover:text-content focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              Customize
            </a>
          </div>
        }
        footer={<LegalFooterNav current={DOC.href} />}
      >
        {/* ---------- Privacy dashboard ---------- */}
        <section
          aria-labelledby="cookie-dashboard-heading"
          className="rounded-xl border border-line bg-surface p-5 shadow-e1 sm:p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-legal-accent"
              >
                <ShieldCheck size={20} />
              </span>
              <div>
                <h2
                  id="cookie-dashboard-heading"
                  className="font-display text-lg font-bold tracking-tight text-content"
                >
                  Your Privacy Dashboard
                </h2>
                <p className="text-sm text-muted" aria-live="polite">
                  {mounted
                    ? `${enabledCount} of ${COOKIE_CATEGORIES.length} categories active`
                    : "Loading preferences…"}
                </p>
              </div>
            </div>
            {savedAt ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas px-3 py-1.5 text-xs font-semibold text-content">
                <Check size={13} className="text-success" aria-hidden /> Preferences saved
              </span>
            ) : null}
          </div>
          <ul className="mt-4 flex flex-wrap gap-2">
            {COOKIE_CATEGORIES.map((c) => {
              const on = mounted && prefs[c.id];
              return (
                <li
                  key={c.id}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium",
                    on
                      ? "border-primary/30 bg-primary/10 text-legal-accent"
                      : "border-line bg-canvas text-muted",
                  )}
                >
                  {on ? <Check size={12} aria-hidden /> : null}
                  {c.name}
                </li>
              );
            })}
          </ul>
        </section>

        {/* ---------- Categories + save bar ----------
            The save bar is sticky inside this wrapper so it releases at the end
            of the category list instead of hovering over the history below. */}
        <div id="customize" className="legal-anchor mt-8">
          <h2 className="font-display text-xl font-bold tracking-tight text-content sm:text-[1.5rem]">
            Cookie categories
          </h2>

          <div className="mt-5 space-y-3">
            {COOKIE_CATEGORIES.map((c) => {
              const on = mounted ? prefs[c.id] : (c.always ?? false);
              const isOpen = expanded === c.id;
              return (
                <section
                  key={c.id}
                  id={`cookie-${c.id}`}
                  className="legal-anchor rounded-xl border border-line bg-surface p-5 shadow-e1"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-display text-base font-bold tracking-tight text-content">
                          {c.name}
                        </h3>
                        {c.always ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-line bg-canvas px-2 py-0.5 text-[11px] font-semibold text-content">
                            <Lock size={10} className="text-success" aria-hidden /> Always Active
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-muted">
                        {c.description}
                      </p>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={`${c.name}${c.always ? " (always active)" : ""}`}
                      disabled={c.always}
                      onClick={() => toggle(c)}
                      className={cn(
                        "relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full outline-none transition-colors",
                        "focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                        on ? "bg-primary" : "bg-canvas ring-1 ring-inset ring-muted",
                        c.always ? "cursor-not-allowed opacity-70" : "cursor-pointer",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "inline-block size-5 rounded-full shadow transition-transform",
                          on ? "translate-x-6 bg-white" : "translate-x-1 bg-muted",
                        )}
                      />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : c.id)}
                    aria-expanded={isOpen}
                    aria-controls={`cookie-details-${c.id}`}
                    className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-semibold text-legal-accent outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:min-h-0"
                  >
                    {isOpen ? "Hide details" : "View cookie details"}
                    <ChevronDown
                      size={15}
                      className={cn("transition-transform", isOpen && "rotate-180")}
                      aria-hidden
                    />
                  </button>

                  {isOpen ? (
                    <div
                      id={`cookie-details-${c.id}`}
                      className="mt-4 grid gap-4 rounded-lg border border-line bg-canvas/60 p-4 sm:grid-cols-2"
                    >
                      <div className="sm:col-span-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                          Purpose
                        </p>
                        <p className="mt-1 text-[0.9375rem] leading-relaxed text-content">
                          {c.purpose}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                          Examples
                        </p>
                        <ul className="mt-1.5 flex flex-wrap gap-1.5">
                          {c.examples.map((example) => (
                            <li
                              key={example}
                              className="rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-xs text-content"
                            >
                              {example}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                          Expiry
                        </p>
                        <p className="mt-1 inline-flex items-center gap-1.5 text-[0.9375rem] text-content">
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

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-e1 print:hidden">
            <p className="flex items-center gap-2 text-sm text-muted">
              <Cookie size={16} className="text-legal-accent" aria-hidden />
              You can change these choices any time.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={rejectAll}
                className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-content outline-none transition-colors hover:border-primary/40 hover:text-legal-accent focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                Reject All
              </button>
              <button
                type="button"
                onClick={saveCurrent}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-white shadow-e2 outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                <Save size={16} aria-hidden /> Save Preferences
              </button>
            </div>
          </div>
        </div>

        {/* ---------- Consent history ---------- */}
        <section
          aria-labelledby="cookie-history-heading"
          className="mt-10 border-t border-line pt-8"
        >
          <h2
            id="cookie-history-heading"
            className="flex items-center gap-2 font-display text-xl font-bold tracking-tight text-content sm:text-[1.5rem]"
          >
            <History size={18} className="text-legal-accent" aria-hidden /> Consent History
          </h2>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">
            An auditable record of your consent choices, stored on this device.
          </p>
          {mounted && history.length ? (
            <ol className="mt-5 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {history.map((entry, i) => (
                <li
                  key={`${entry.at}-${i}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-content">{entry.action}</p>
                    <p className="text-xs text-muted">
                      {entry.enabled.join(", ") || "Only strictly necessary"}
                    </p>
                  </div>
                  <time className="text-xs tabular-nums text-muted" dateTime={entry.at}>
                    {new Date(entry.at).toLocaleString()}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-5 rounded-xl border border-line bg-surface px-4 py-6 text-center text-sm text-muted">
              {mounted ? "No consent choices recorded yet on this device." : "Loading…"}
            </p>
          )}
        </section>
      </LegalDocument>
    </main>
  );
}
