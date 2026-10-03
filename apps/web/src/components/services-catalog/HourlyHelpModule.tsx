"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Clock } from "lucide-react";
import {
  HOURLY_OPTIONS,
  HOURLY_TASKS,
  serverQuantityPrice,
  formatInr,
  hourlyQuote,
  quantityOptions,
  type ServiceView,
} from "@/lib/catalog";
import { bookUrl } from "@/lib/booking-url";
import { ButtonLink } from "@/components/buttons/ButtonLink";
import { AnimatedPrice, focusRing } from "@/components/services-catalog/primitives";
import { NotifyMeButton } from "@/components/services-catalog/NotifyMe";
import { cn } from "@/lib/utils";

type Tone = "dark" | "light";

export type HourlySelection = { hours: number; tasks: string[] };

/** `amount` is the server-resolved service line, or null while unknown — never computed here. */
type HourOption = { hours: number; amount: number | null; bookable: boolean; packageIndex?: number };

/**
 * Hour options come from the backend HOUR quantity rule (every option is priced
 * and validated server-side). Without a rule, only hour counts whose total is a
 * price tier the API charges can be booked — the pre-quantity behaviour.
 */
export function hourOptions(service: ServiceView): HourOption[] {
  const rule = service.quantity;
  if (rule?.type === "HOUR") {
    return quantityOptions(rule).map((h) => ({
      hours: h,
      amount: serverQuantityPrice(service, h),
      bookable: true,
    }));
  }
  return HOURLY_OPTIONS.map((h) => {
    const q = hourlyQuote(service.price!, h);
    return { hours: h, amount: q.amount, bookable: q.bookable, packageIndex: q.bookable ? q.packageIndex : undefined };
  });
}

/** Everything /book needs for an hourly selection — shared with the sticky CTA. */
export function hourlyBooking(service: ServiceView, sel: HourlySelection) {
  const opts = hourOptions(service);
  const opt = opts.find((o) => o.hours === sel.hours) ?? opts[0]!;
  const notes = `Hourly help — ${sel.hours} ${sel.hours === 1 ? "hour" : "hours"}.${
    sel.tasks.length ? ` Tasks: ${sel.tasks.join(", ")}.` : ""
  }`;
  const href = !opt.bookable
    ? null
    : service.quantity
      ? bookUrl({ service: service.backendId, quantity: opt.hours, notes })
      : bookUrl({ service: service.backendId, package: opt.packageIndex, notes });
  return { quote: opt, href };
}

const T = {
  dark: {
    root: "bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500 text-white",
    muted: "text-white/80",
    chip: "border-white/20 bg-white/10 text-white hover:border-white/50",
    chipOn: "border-white bg-white text-emerald-800",
    chipOff: "border-white/15 text-white/45",
    panel: "border-white/20 bg-white/10",
  },
  light: {
    root: "bg-surface/80 text-content border border-emerald-500/20 shadow-e2 backdrop-blur-md",
    muted: "text-muted",
    chip: "border-line bg-surface text-content hover:border-emerald-300",
    chipOn: "border-transparent bg-gradient-to-r from-emerald-500 to-teal-500 text-white",
    chipOff: "border-line text-muted/60",
    panel: "border-emerald-500/15 bg-canvas/80",
  },
} as const;

/**
 * Hourly booking mode: hours × the live hourly rate, plus the tasks for the
 * visit. Hours travel to /book as a quantity the server re-prices; tasks travel
 * as instructions. Amounts here are estimates before taxes.
 */
export function HourlyHelpModule({
  service,
  tone = "dark",
  headingLevel = "h2",
  showDetailsLink = true,
  value,
  onChange,
  hideCta = false,
}: {
  service: ServiceView | undefined;
  tone?: Tone;
  headingLevel?: "h2" | "h3";
  showDetailsLink?: boolean;
  /** Controlled mode (detail page) — the page's sticky CTA books the same selection. */
  value?: HourlySelection;
  onChange?: (sel: HourlySelection) => void;
  hideCta?: boolean;
}) {
  const t = T[tone];
  const [inner, setInner] = useState<HourlySelection>({
    hours: service?.quantity?.default ?? service?.quantity?.min ?? 1,
    tasks: [],
  });
  const sel = value ?? inner;
  const setSel = onChange ?? setInner;
  const { hours } = sel;
  const tasks = new Set(sel.tasks);
  const setHours = (h: number) => setSel({ ...sel, hours: h });
  const Heading = headingLevel;
  const live = service?.status === "live" && service.price;

  const quotes = useMemo(() => (live ? hourOptions(service!) : []), [live, service]);
  const quote = quotes.find((q) => q.hours === hours);
  const maxBookable = Math.max(0, ...quotes.filter((q) => q.bookable).map((q) => q.hours));
  const someUnbookable = quotes.some((q) => !q.bookable);

  const toggleTask = (task: string) =>
    setSel({ ...sel, tasks: tasks.has(task) ? sel.tasks.filter((x) => x !== task) : [...sel.tasks, task] });
  const booking = live ? hourlyBooking(service!, sel) : null;

  return (
    <section
      aria-labelledby="hourly-heading"
      className={cn("relative overflow-hidden rounded-[2.25rem] p-6 sm:rounded-[2.5rem] sm:p-8 lg:p-10", t.root)}
    >
      {tone === "dark" && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-emerald-500/20 blur-3xl"
          />
          <span aria-hidden className="pointer-events-none absolute -left-8 bottom-10 size-28 rounded-[1.75rem] bg-white/[0.06]" />
          <span aria-hidden className="pointer-events-none absolute right-24 bottom-6 size-14 rounded-full border border-white/15" />
        </>
      )}
      <div className="relative grid gap-8 lg:grid-cols-[1fr_1.15fr] lg:gap-12">
        <div>
          <p className={cn("text-xs font-semibold uppercase tracking-[0.14em]", tone === "dark" ? "text-white" : "text-brand")}>
            Hourly home help
          </p>
          <Heading id="hourly-heading" className="mt-3 font-display text-2xl font-bold tracking-tight sm:text-3xl">
            Need flexible help?
          </Heading>
          <p className={cn("mt-3 max-w-md text-base leading-relaxed", t.muted)}>
            Book a trained professional by the hour for everyday household tasks — you set the agenda.
          </p>
          {live && (
            <p className="mt-6 flex items-baseline gap-2">
              <span className="font-display text-4xl font-bold tabular-nums">{formatInr(service!.price!.base)}</span>
              <span className={t.muted}>/ hour</span>
            </p>
          )}
          {showDetailsLink && service && (
            <Link
              href={service.href}
              prefetch={false}
              className={cn(
                "mt-4 inline-flex items-center gap-1 rounded-md text-sm font-semibold underline-offset-4 hover:underline",
                tone === "dark" ? "text-emerald-300" : "text-brand",
                focusRing,
              )}
            >
              What&apos;s included <ArrowRight className="size-4" aria-hidden />
            </Link>
          )}
        </div>

        {live ? (
          <div className={cn("rounded-[1.75rem] border p-5 sm:rounded-[2rem] sm:p-6", t.panel)}>
            <fieldset>
              <legend className="text-sm font-semibold">How long?</legend>
              <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2">
                {quotes.map((q) => {
                  const on = q.hours === hours;
                  return (
                    <button
                      key={q.hours}
                      type="button"
                      aria-pressed={on}
                      disabled={!q.bookable}
                      onClick={() => setHours(q.hours)}
                      aria-label={`${q.hours} ${q.hours === 1 ? "hour" : "hours"}, ${
                        q.bookable ? (q.amount != null ? `${formatInr(q.amount)} before taxes` : "priced at checkout") : "not bookable online yet"
                      }`}
                      className={cn(
                        "flex min-h-14 flex-col items-center justify-center rounded-2xl border text-sm font-semibold motion-safe:transition-colors",
                        focusRing,
                        !q.bookable ? cn(t.chipOff, "cursor-not-allowed") : on ? t.chipOn : t.chip,
                      )}
                    >
                      <span>
                        {q.hours} {q.hours === 1 ? "hr" : "hrs"}
                      </span>
                      <span className={cn("text-xs font-medium", !q.bookable ? "" : on ? "opacity-80" : t.muted)}>
                        {q.bookable ? (q.amount != null ? formatInr(q.amount) : "—") : "Soon"}
                      </span>
                    </button>
                  );
                })}
              </div>
              {someUnbookable && (
                <p className={cn("mt-2.5 text-xs", t.muted)}>
                  Online booking is available for up to {maxBookable} {maxBookable === 1 ? "hour" : "hours"} right now.
                  Longer sessions are coming soon.
                </p>
              )}
            </fieldset>

            <fieldset className="mt-6">
              <legend className="text-sm font-semibold">
                What should they help with? <span className={cn("font-normal", t.muted)}>(optional)</span>
              </legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {HOURLY_TASKS.map((task) => {
                  const on = tasks.has(task);
                  return (
                    <button
                      key={task}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleTask(task)}
                      className={cn(
                        "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm motion-safe:transition-colors",
                        focusRing,
                        on ? t.chipOn : t.chip,
                      )}
                    >
                      {on && <Check className="size-3.5" aria-hidden />}
                      {task}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-current/10 pt-5">
              <div>
                <p className={cn("flex items-center gap-1.5 text-xs", t.muted)}>
                  <Clock className="size-3.5" aria-hidden />
                  {hours} {hours === 1 ? "hour" : "hours"} · estimate before taxes · final price at checkout
                </p>
                {quote && quote.amount != null && <AnimatedPrice amount={quote.amount} className="mt-1 font-display text-2xl font-bold" />}
              </div>
              {!hideCta && booking?.href && (
                <ButtonLink
                  href={booking.href}
                  variant={tone === "dark" ? "inverse" : "primary"}
                  size="lg"
                >
                  Book {hours} {hours === 1 ? "hour" : "hours"}
                  <ArrowRight className="size-4" aria-hidden />
                </ButtonLink>
              )}
            </div>
          </div>
        ) : (
          <div className={cn("flex flex-col items-start justify-center gap-4 rounded-2xl border p-6", t.panel)}>
            <p className={t.muted}>Hourly home help is coming soon to your area.</p>
            <NotifyMeButton
              sourceKey="hourly-home-help"
              serviceName="Hourly Home Help"
              variant={tone === "dark" ? "inverse" : "secondary"}
            />
          </div>
        )}
      </div>
    </section>
  );
}
