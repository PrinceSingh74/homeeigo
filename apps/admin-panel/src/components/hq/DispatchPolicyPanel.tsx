"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { adminApi, type PlatformFeatureFlag, type PlatformIntelligence } from "@/services/admin-api";
import { getErrorMessage } from "@/lib/api-error";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { GlassPanel } from "./GlassPanel";
import { SectionHeading } from "./primitives";

/**
 * The two dispatch policy switches. Each is a platform feature flag read by the matcher
 * (backend services/provider-capability-loader.ts).
 *
 * ── State ───────────────────────────────────────────────────────────────────
 * The ON/OFF shown is the backend's own answer (`dispatchPolicy` in the intelligence response),
 * never inferred here when it is available: a missing row is OFF for strict capability, but the
 * demo-partner fallback is ON by default in demo environments. An explicit row always decides.
 * Only an older backend, which does not report `dispatchPolicy`, falls back to reading the rows.
 *
 * ── Environment ─────────────────────────────────────────────────────────────
 * The backend reads a flag only when the row's `environment` equals its own runtime environment,
 * which GET /api/admin/platform/intelligence reports as `runtimeEnvironment`. Every change is
 * written for that environment, so a switch flipped here always takes effect on this backend.
 * An older backend does not report it: only then is the admin asked to state the environment —
 * nothing is guessed.
 */

type Policy = {
  key: string;
  /** Its name in the backend's `dispatchPolicy` answer. */
  policyKey: keyof NonNullable<PlatformIntelligence["dispatchPolicy"]>;
  title: string;
  on: string;
  off: string;
  /** Shown in the confirm dialog when turning the switch ON. */
  warning: string;
  description: string;
};

const POLICIES: Policy[] = [
  {
    key: "matching.strict_service_capability",
    policyKey: "strictServiceCapability",
    title: "Strict service capability",
    on: "A professional needs an ACTIVE typed capability for the service to be offered it.",
    off: "Legacy category matching is used for professionals who have no typed capability rows.",
    warning: "Turning this on before capabilities have been granted can empty the candidate pool: every professional without an active capability for a service is refused for it.",
    description: "Dispatch: require an ACTIVE typed provider capability for the booked service (off = legacy category matching).",
  },
  {
    key: "matching.seed_partner_fallback",
    policyKey: "seedPartnerFallback",
    title: "Demo-partner fallback",
    on: "When no business professional can take a paid job, it may be offered to an on-duty @homigo.demo seed partner.",
    off: "A business customer is matched to business professionals only.",
    warning: "Turning this on sends real customers’ paid jobs to demo accounts whenever no business professional can take them. Use it only for a launch period you are actively staffing.",
    description: "Dispatch: let a paid business booking fall back to an on-duty @homigo.demo seed partner when no business professional can take it.",
  },
];

const ENVIRONMENT_HINTS = ["production", "staging", "development", "test"];

/**
 * ON for this backend: the row is for its environment, enabled, and fully rolled out (dispatch
 * evaluates these flags without a user, so a partial rollout reads as OFF). With the runtime
 * environment unknown (older backend) the environment cannot be checked and the row is taken as is.
 */
const effectiveOn = (f: PlatformFeatureFlag | undefined, runtimeEnvironment: string | undefined) =>
  Boolean(f && f.enabled && f.rolloutPct === 100 && (runtimeEnvironment === undefined || f.environment === runtimeEnvironment));

const SEED_FALLBACK = "seedPartnerFallback";
/** The same fact as the ON warning, said calmly where the fallback is this environment's default. */
const DEMO_DEFAULT_NOTE =
  "This environment’s marketplace is the demo partners, so the fallback is on by default: paid jobs here may be offered to @homigo.demo accounts. Saving the switch OFF here forces business-only matching.";

export function DispatchPolicyPanel({
  flags,
  dispatchPolicy,
  runtimeEnvironment,
  loading,
  unavailable,
}: {
  flags?: PlatformFeatureFlag[];
  /** The backend's effective answer per switch; undefined on an older backend. */
  dispatchPolicy?: PlatformIntelligence["dispatchPolicy"];
  /** The backend's own environment; undefined when the backend does not report it. */
  runtimeEnvironment?: string;
  loading?: boolean;
  unavailable?: boolean;
}) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<{ policy: Policy; enable: boolean } | null>(null);
  /** Fallback only: the environment typed by the admin when the backend does not report its own. */
  const [typedEnvironment, setTypedEnvironment] = useState("");

  const rowOf = (key: string) => flags?.find((f) => f.key === key);
  const mutation = useMutation({
    mutationFn: (payload: Parameters<typeof adminApi.platformFlagUpdate>[0]) => adminApi.platformFlagUpdate(payload),
    onSuccess: async () => {
      // The listing is the one source of state: wait for it before closing, so the switch never shows a stale answer.
      await queryClient.invalidateQueries({ queryKey: ["hq", "platform", "intelligence"] });
      setPending(null);
    },
  });

  const open = (policy: Policy, enable: boolean) => {
    mutation.reset();
    setTypedEnvironment(rowOf(policy.key)?.environment ?? "");
    setPending({ policy, enable });
  };
  const pendingRow = pending ? rowOf(pending.policy.key) : undefined;
  const targetEnvironment = runtimeEnvironment ?? typedEnvironment.trim();
  const elsewhere = (row?: PlatformFeatureFlag) => Boolean(row && runtimeEnvironment !== undefined && row.environment !== runtimeEnvironment);
  /** The backend's answer when it gives one; the row-derived state only for an older backend. */
  const isOn = (p: Policy) => dispatchPolicy?.[p.policyKey]?.enabled ?? effectiveOn(rowOf(p.key), runtimeEnvironment);
  const byDefault = (p: Policy) => dispatchPolicy?.[p.policyKey]?.source === "ENVIRONMENT_DEFAULT";
  /** ON with no admin setting: the demo-partner fallback in a demo environment. */
  const demoDefaultOn = (p: Policy) => p.policyKey === SEED_FALLBACK && byDefault(p) && isOn(p);
  const environmentName = runtimeEnvironment ?? "this backend";
  const rowDetails = (row: PlatformFeatureFlag) =>
    `environment “${row.environment}”, ${row.enabled ? `enabled at ${row.rolloutPct}%` : "disabled"}${row.isKillSwitch ? ", kill switch" : ""}`;
  /** Why the switch is in its state, in plain words. */
  const why = (p: Policy, row?: PlatformFeatureFlag): string => {
    const moved = elsewhere(row) ? ` A row exists for “${row!.environment}” (${row!.enabled ? `enabled at ${row!.rolloutPct}%` : "disabled"}); it has no effect on this backend. Saving will move it to “${runtimeEnvironment}”.` : "";
    if (byDefault(p)) return `Default for this environment (${environmentName}) — no admin setting saved.` + moved;
    if (!row || elsewhere(row)) {
      // The fallback with no row would be reported as an environment default; "FLAG" without a listed row means the flag store answered otherwise (e.g. it could not be read, which is off).
      if (dispatchPolicy && p.policyKey === SEED_FALLBACK) return "Reported by the backend’s flag store; no admin setting is listed for this environment." + moved;
      return (dispatchPolicy ? "No admin setting saved — off by default." : "No flag row — OFF by default.") + moved;
    }
    return `Set by an admin (${rowDetails(row)}).` + (row.enabled && row.rolloutPct < 100 ? " Dispatch reads a partial rollout as OFF." : "");
  };

  return (
    <GlassPanel className="p-5" glow="amber">
      <SectionHeading title="Dispatch policy" hint="owner decision" />
      <p className="mb-3 text-xs text-[var(--color-biz-muted)]">
        Who a paid job may be offered to. Each change needs a reason and is recorded in the flag history.
      </p>
      {loading ? (
        <div className="biz-skeleton h-32 w-full rounded" />
      ) : (
        <div className="space-y-2">
          {unavailable ? (
            <p className="text-xs font-medium text-[var(--color-biz-danger)]" role="alert">
              Current flag state could not be loaded. The states below are unknown, not OFF.
            </p>
          ) : null}
          {POLICIES.map((p) => {
            const row = rowOf(p.key);
            const on = isOn(p);
            const state = unavailable ? "Unknown" : on ? "ON" : "OFF";
            return (
              <div key={p.key} className="rounded-lg bg-[var(--color-biz-bg)] px-3 py-3" data-testid={`dispatch-policy-${p.key}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{p.title}</p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--color-biz-muted)]">{p.key}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${on && !unavailable ? "border-[var(--color-biz-success)] text-[var(--color-biz-success)]" : "border-[var(--color-biz-line)] text-[var(--color-biz-muted)]"}`}
                      aria-label={`${p.title} is ${state}`}
                    >
                      {state}
                    </span>
                    <button type="button" className="biz-btn text-xs" role="switch" aria-checked={on} disabled={Boolean(unavailable)} onClick={() => open(p, !on)}>
                      {on ? "Turn off" : "Turn on"}
                    </button>
                  </div>
                </div>
                {unavailable ? null : <p className="mt-2 text-xs text-[var(--color-biz-muted)]">{on ? p.on : p.off}</p>}
                {unavailable ? null : <p className="mt-1 text-[11px] text-[var(--color-biz-faint)]">{why(p, row)}</p>}
                {!unavailable && demoDefaultOn(p) ? (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--color-biz-muted)]" role="note">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    {DEMO_DEFAULT_NOTE}
                  </p>
                ) : null}
              </div>
            );
          })}
          <p className="text-[11px] text-[var(--color-biz-faint)]">
            {runtimeEnvironment !== undefined
              ? `Applies to this backend: ${runtimeEnvironment}. Every change here is saved for that environment.`
              : "This backend does not report its runtime environment, so each change asks for it. A switch only takes effect when its environment equals the backend’s APP_ENV (else NODE_ENV)."}
          </p>
        </div>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={pending ? `${pending.enable ? "Turn on" : "Turn off"} ${pending.policy.title.toLowerCase()}?` : ""}
        description={
          pending
            ? pending.enable
              ? pending.policy.warning
              : `After this: ${pending.policy.off}` + (demoDefaultOn(pending.policy) ? " This saves an explicit OFF that overrides this environment’s default." : "")
            : undefined
        }
        confirmLabel={pending?.enable ? "Turn on" : "Turn off"}
        destructive={pending?.enable}
        reasonLabel="Reason (required, recorded in the flag history)"
        reasonPlaceholder="Why is this changing now?"
        reasonRequired
        isLoading={mutation.isPending}
        confirmDisabled={targetEnvironment === ""}
        onClose={() => setPending(null)}
        onConfirm={(reason) => {
          if (!pending || !reason || !targetEnvironment) return;
          mutation.mutate({
            key: pending.policy.key,
            description: pendingRow?.description ?? pending.policy.description,
            enabled: pending.enable,
            // A full rollout: dispatch evaluates without a user, so a partial one would read as OFF.
            rolloutPct: pending.enable ? 100 : (pendingRow?.rolloutPct ?? 100),
            environment: targetEnvironment,
            // The route resets an omitted kill-switch marker to false; carry the stored one.
            isKillSwitch: pendingRow?.isKillSwitch ?? false,
            reason,
          });
        }}
      >
        {runtimeEnvironment !== undefined ? (
          <p className="text-xs text-[var(--color-biz-muted)]">
            Applies to this backend: <span className="font-mono text-[var(--color-biz-text)]">{runtimeEnvironment}</span>
            {elsewhere(pendingRow) ? ` — the existing row for “${pendingRow!.environment}” will be moved here.` : ""}
          </p>
        ) : (
          <>
            <label className="block text-xs text-[var(--color-biz-muted)]" htmlFor="dispatch-policy-environment">
              Environment (required)
            </label>
            <input
              id="dispatch-policy-environment"
              list="dispatch-policy-environments"
              value={typedEnvironment}
              disabled={mutation.isPending}
              onChange={(e) => setTypedEnvironment(e.target.value)}
              placeholder="the backend’s APP_ENV, e.g. production"
              className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-biz-accent)] disabled:opacity-60"
            />
            <datalist id="dispatch-policy-environments">
              {ENVIRONMENT_HINTS.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
            <p className="mt-1 text-[11px] text-[var(--color-biz-muted)]">
              {pendingRow
                ? "Pre-filled from the existing flag row. There is one row per flag: saving a different environment moves it."
                : "Not pre-filled: there is no existing row and this console cannot read this backend’s environment. A wrong value saves a switch that does nothing."}
            </p>
          </>
        )}
        {mutation.isError ? (
          <p className="mt-2 text-xs font-medium text-[var(--color-biz-danger)]" role="alert">
            {getErrorMessage(mutation.error)}
          </p>
        ) : null}
      </ConfirmDialog>
    </GlassPanel>
  );
}
