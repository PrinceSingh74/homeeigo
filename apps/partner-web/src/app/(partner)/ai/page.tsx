import { PartnerAiPanel } from "@/components/ai/PartnerAiPanel";

export default function AiPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">AI Assistant</h1>
        <p className="text-sm text-partner-muted">
          Routes, earnings, scheduling, and job recommendations
        </p>
      </div>
      <PartnerAiPanel />
    </div>
  );
}
