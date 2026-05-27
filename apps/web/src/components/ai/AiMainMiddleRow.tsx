"use client";

import { AiChatSection } from "@/components/ai/AiChatSection";
import { AiImageDiagnosis } from "@/components/ai/AiImageDiagnosis";
import { aiMiddleGrid } from "@/components/ai/ai-page-layout";

export function AiMainMiddleRow() {
  return (
    <div className={aiMiddleGrid}>
      <AiChatSection />
      <AiImageDiagnosis />
    </div>
  );
}
