import { CheckCircle2, ClipboardList, Package, UserRound, Wrench } from "lucide-react";
import type { PartnerRequirement, PartnerRequirementsBrief } from "@/types/partner";

const CHECK_LABEL = {
  CONFIRMED_BY_CUSTOMER: "Confirmed by the customer",
  VERIFY_ON_ARRIVAL: "Verify on arrival",
  VERIFY_AT_START: "Verify before you start",
  INFORMATIONAL: "For your information",
} as const;

function Item({ r, extra }: { r: PartnerRequirement; extra?: string }) {
  return (
    <li className="py-2 first:pt-0 last:pb-0">
      <p className="text-sm font-medium text-partner-text">
        {r.label}
        {r.quantity ? <span className="text-partner-text-secondary"> · {r.quantity}</span> : null}
        {r.optional ? <span className="ml-2 text-[11px] font-normal text-partner-muted">optional</span> : null}
        {r.chargeable ? <span className="ml-2 text-[11px] font-normal text-partner-muted">chargeable add-on</span> : null}
      </p>
      {extra ? <p className="text-xs text-partner-muted">{extra}</p> : null}
      {r.instructions ? <p className="mt-0.5 text-xs text-partner-text-secondary">{r.instructions}</p> : null}
      {r.handling ? <p className="mt-0.5 text-xs text-partner-text-secondary">Handling: {r.handling}</p> : null}
      {r.customerWasTold ? <p className="mt-0.5 text-xs text-partner-muted">Customer was told: {r.customerWasTold}</p> : null}
    </li>
  );
}

function Group({ icon: Icon, title, children }: { icon: typeof Package; title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-partner-muted">
        <Icon className="h-3.5 w-3.5 text-partner-primary" />
        {title}
      </p>
      <ul className="mt-1 divide-y divide-partner-border/60">{children}</ul>
    </div>
  );
}

/**
 * Job preparation — Phase 06. Everything here comes from the booking's own snapshot (what was
 * recorded when the customer booked), never from the service's current configuration. A booking
 * made before Phase 06 has no snapshot and renders nothing.
 */
export function JobPreparation({ requirements }: { requirements: PartnerRequirementsBrief | null | undefined }) {
  if (!requirements || requirements.empty) return null;
  return (
    <div className="space-y-4" data-testid="job-preparation">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-partner-text">
        <ClipboardList className="h-4 w-4 text-partner-primary" />
        Job preparation
      </p>
      {requirements.bringMaterials.length > 0 && (
        <Group icon={Package} title="Materials to bring">
          {requirements.bringMaterials.map((r) => <Item key={r.label} r={r} />)}
        </Group>
      )}
      {requirements.bringEquipment.length > 0 && (
        <Group icon={Wrench} title="Equipment to bring">
          {requirements.bringEquipment.map((r) => <Item key={r.label} r={r} />)}
        </Group>
      )}
      {requirements.customerProvides.length > 0 && (
        <Group icon={UserRound} title="Customer provides">
          {requirements.customerProvides.map((r) => <Item key={r.label} r={r} extra="Confirm it is on site before you start." />)}
        </Group>
      )}
      {requirements.preconditions.length > 0 && (
        <Group icon={CheckCircle2} title="Customer preconditions">
          {requirements.preconditions.map((r) => <Item key={r.label} r={r} extra={CHECK_LABEL[r.check]} />)}
        </Group>
      )}
    </div>
  );
}
