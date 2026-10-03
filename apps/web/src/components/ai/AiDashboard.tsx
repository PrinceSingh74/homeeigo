"use client";

import { useEnsureDemoTracking } from "@/components/ai/use-ensure-demo-tracking";
import dynamic from "next/dynamic";
import { DeferredSection } from "@/components/ui/DeferredSection";
import { AiHeader } from "@/components/ai/AiHeader";
import { AiDesktopToolbar } from "@/components/ai/AiDesktopToolbar";
import { AiHeroSection } from "@/components/ai/AiHeroSection";
import { AiQuickActions } from "@/components/ai/AiQuickActions";
import { AiFloatingInputBar } from "@/components/ai/AiFloatingInputBar";

/**
 * 2026-09-27 — tab switches into /ai blocked the main thread ~1s (5 long tasks) because all
 * eleven sections hydrated in one commit. The header, hero, quick actions and input bar ARE the
 * page; the animated backdrop and the data panels below the fold hydrate as their own idle-time
 * chunks. `ssr: false` on the backdrop only: it is pure decoration behind auth, and skipping its
 * SSR removes four motion elements from every server payload of this route.
 */
const AiPage3DBackdrop = dynamic(
  () => import("@/components/ai/AiPage3DBackdrop").then((m) => m.AiPage3DBackdrop),
  { ssr: false, loading: () => null },
);
const AiMainMiddleRow = dynamic(
  () => import("@/components/ai/AiMainMiddleRow").then((m) => m.AiMainMiddleRow),
  { loading: () => null },
);
const AiHomeStatusSection = dynamic(
  () => import("@/components/ai/AiHomeStatusSection").then((m) => m.AiHomeStatusSection),
  { loading: () => null },
);
const AiMobileLiveSection = dynamic(
  () => import("@/components/ai/AiMobileLiveSection").then((m) => m.AiMobileLiveSection),
  { loading: () => null },
);
const AiRightPanel = dynamic(
  () => import("@/components/ai/AiRightPanel").then((m) => m.AiRightPanel),
  { loading: () => null },
);
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
                <DeferredSection minHeight="20rem">
                  <AiMobileLiveSection />
                </DeferredSection>
                <DeferredSection minHeight="17rem">
                  <AiMainMiddleRow />
                </DeferredSection>
                <DeferredSection minHeight="26rem">
                  <AiHomeStatusSection />
                </DeferredSection>
              </div>
              <DeferredSection minHeight="30rem">
                <AiRightPanel />
              </DeferredSection>
            </div>
          </div>
        </div>

        <AiFloatingInputBar />
      </div>
    </div>
  );
}
