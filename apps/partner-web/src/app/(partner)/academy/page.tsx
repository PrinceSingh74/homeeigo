"use client";

import { GraduationCap } from "lucide-react";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { usePartnerAcademyQuery, usePartnerCompleteAcademyMutation } from "@/hooks/use-partner-os";
import Link from "next/link";

export default function AcademyPage() {
  const academy = usePartnerAcademyQuery();
  const completeModule = usePartnerCompleteAcademyMutation();
  const data = academy.data;

  return (
    <HqPageShell
      title="Partner Academy"
      description="Admin-published training library, video learning, SOPs, and assessments."
      icon={GraduationCap}
      stats={[
        { label: "Modules", value: data?.modules.length ?? 0 },
        { label: "Completed", value: data?.completedCount ?? 0 },
        { label: "Certifications", value: data?.certifications.length ?? 0 },
      ]}
    >
      <Link href="/academy/certifications" className="partner-card partner-card-hover inline-block p-4 font-semibold">
        Certifications
      </Link>
      <section className="mt-4 space-y-2">
        {(data?.modules ?? []).map((m) => (
          <article key={m.id} className="partner-card p-4">
            <p className="font-semibold">{m.title}</p>
            <p className="text-xs text-partner-muted">{m.contentType} · {m.completedAt ? "Completed" : "Pending"}</p>
            {m.contentUrl ? (
              <a href={m.contentUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm text-partner-primary underline">
                Open content
              </a>
            ) : null}
            {!m.completedAt ? (
              <button
                type="button"
                disabled={completeModule.isPending}
                onClick={() => completeModule.mutate({ moduleId: m.id })}
                className="mt-3 rounded-lg bg-partner-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              >
                Mark complete
              </button>
            ) : null}
          </article>
        ))}
      </section>
    </HqPageShell>
  );
}
