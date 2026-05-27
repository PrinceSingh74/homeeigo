"use client";

import { useEnsureDemoTracking } from "@/components/ai/use-ensure-demo-tracking";
import { AiPage3DBackdrop } from "@/components/ai/AiPage3DBackdrop";
import { AiHeader } from "@/components/ai/AiHeader";
import { AiDesktopToolbar } from "@/components/ai/AiDesktopToolbar";
import { AiHeroSection } from "@/components/ai/AiHeroSection";
import { AiQuickActions } from "@/components/ai/AiQuickActions";
import { AiMainMiddleRow } from "@/components/ai/AiMainMiddleRow";
import { AiHomeStatusSection } from "@/components/ai/AiHomeStatusSection";
import { AiMobileLiveSection } from "@/components/ai/AiMobileLiveSection";
import { AiRightPanel } from "@/components/ai/AiRightPanel";
import { AiFloatingInputBar } from "@/components/ai/AiFloatingInputBar";
import {
  aiBodyGrid,
  aiContentWrap,
  aiMain,
  aiMainColumn,
  aiPageRoot,
  aiShell,
} from "@/components/ai/ai-page-layout";

export function AiDashboard() {
  useEnsureDemoTracking();

  return (
    <div className={aiPageRoot}>
      <AiPage3DBackdrop />
      <div className={aiShell}>
        <AiHeader />

        <div className={aiMain}>
          <div className={aiContentWrap}>
            <div className={aiBodyGrid}>
              <div className={aiMainColumn}>
                <AiDesktopToolbar />
                <AiHeroSection />
                <AiQuickActions />
                <AiMobileLiveSection />
                <AiMainMiddleRow />
                <AiHomeStatusSection />
              </div>
              <AiRightPanel />
            </div>
          </div>
        </div>

        <AiFloatingInputBar />
      </div>
    </div>
  );
}
