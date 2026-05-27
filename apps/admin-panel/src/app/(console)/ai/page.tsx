import { Bot } from "lucide-react";
import { ADMIN_KPIS } from "@/lib/admin-data";

export default function AiSystemsPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">AI systems</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">
          Matching, fraud, KYC, customer & vendor assistants
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="biz-card p-6">
          <Bot className="h-8 w-8 text-[var(--color-biz-accent)]" />
          <p className="mt-3 font-semibold">Jobs processed today</p>
          <p className="mt-1 text-3xl font-bold">{ADMIN_KPIS.aiJobsProcessed.toLocaleString("en-IN")}</p>
        </div>
        <div className="biz-card p-6 text-sm text-[var(--color-biz-muted)]">
          <ul className="space-y-2">
            <li>• Customer AI (homigo.com /ai)</li>
            <li>• Partner AI (partner app /ai)</li>
            <li>• Admin fraud & KYC models</li>
            <li>• Smart vendor matching engine</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
