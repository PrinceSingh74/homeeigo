"use client";

import { useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  AI_HERO_STAT_ACTIONS,
  AI_INSIGHT_ACTIONS,
  AI_PREDICTION_ACTIONS,
  AI_STATUS_ACTIONS,
  CHAT_QUICK_ACTION_MAP,
  type ChatQuickActionKey,
  bookServiceUrl,
  scrollToAiSection,
} from "@/lib/ai-page-actions";
import { useAiStore } from "@/stores/ai-store";
import { useAppStore } from "@/stores/app-store";

const VOICE_DEMO_PHRASES = [
  "AC cooling kam kar raha hai",
  "Book cleaning for tomorrow",
  "Check water leakage in bathroom",
  "What is my home health score?",
];

export function useAiPageActions() {
  const router = useRouter();
  const sendMessage = useAiStore((s) => s.sendMessage);
  const setDraft = useAiStore((s) => s.setDraft);
  const toggleVoiceMode = useAiStore((s) => s.toggleVoiceMode);
  const voiceMode = useAiStore((s) => s.voiceMode);
  const isRecording = useAiStore((s) => s.isRecording);
  const setRecording = useAiStore((s) => s.setRecording);
  const showToast = useAppStore((s) => s.showToast);
  const openOverlay = useAppStore((s) => s.openOverlay);
  const voicePhraseIndex = useRef(0);

  const runInsightAction = useCallback(
    (insightId: string) => {
      const action = AI_INSIGHT_ACTIONS[insightId];
      if (!action) return;
      if ("toast" in action && action.toast) showToast(action.toast, "info");

      switch (action.type) {
        case "book":
          router.push(bookServiceUrl(action.serviceId));
          break;
        case "navigate":
          router.push(action.href);
          break;
        case "chat":
          sendMessage(action.message);
          scrollToAiSection("ai-chat");
          break;
        case "scroll":
          scrollToAiSection(action.section);
          break;
        case "overlay":
          openOverlay(action.overlay);
          break;
      }
    },
    [router, sendMessage, showToast, openOverlay],
  );

  const runPredictionAction = useCallback(
    (predictionId: string) => {
      const action = AI_PREDICTION_ACTIONS[predictionId];
      if (!action) return;
      showToast(action.toast, "success");
      router.push(bookServiceUrl(action.serviceId));
    },
    [router, showToast],
  );

  const runStatusAction = useCallback(
    (statusId: string) => {
      const action = AI_STATUS_ACTIONS[statusId];
      if (!action) return;

      switch (action.type) {
        case "book":
          if (action.serviceId) {
            showToast("Opening booking…", "info");
            router.push(bookServiceUrl(action.serviceId));
          }
          break;
        case "navigate":
          router.push(action.href);
          break;
        case "scroll":
          scrollToAiSection(action.section);
          showToast("Scrolled to section", "info");
          break;
        case "chat":
          sendMessage(action.message);
          scrollToAiSection("ai-chat");
          break;
      }
    },
    [router, sendMessage, showToast],
  );

  const runHeroStatAction = useCallback(
    (statId: string) => {
      const action = AI_HERO_STAT_ACTIONS[statId];
      if (!action) return;
      showToast(action.toast, "info");
      if (action.href) router.push(action.href);
      else if (action.section) scrollToAiSection(action.section);
    },
    [router, showToast],
  );

  const runChatQuickAction = useCallback(
    (label: string) => {
      const mapped = CHAT_QUICK_ACTION_MAP[label as ChatQuickActionKey];
      if (!mapped) {
        sendMessage(label);
        return;
      }

      if (mapped.toast) showToast(mapped.toast, "info");

      if (mapped.type === "book") {
        router.push(bookServiceUrl(mapped.serviceId));
        return;
      }

      if (mapped.chat) sendMessage(mapped.chat);
      scrollToAiSection(mapped.section);
      if (label === "Upload Photo") {
        window.setTimeout(() => {
          document.getElementById("ai-diagnosis-file-input")?.click();
        }, 400);
      }
    },
    [router, sendMessage, showToast],
  );

  const startVoiceCapture = useCallback(() => {
    setRecording(true);
    showToast("Listening… speak now", "info");
  }, [setRecording, showToast]);

  const stopVoiceCapture = useCallback(() => {
    setRecording(false);
    const phrase =
      VOICE_DEMO_PHRASES[voicePhraseIndex.current % VOICE_DEMO_PHRASES.length];
    voicePhraseIndex.current += 1;
    sendMessage(phrase);
    showToast("Voice captured", "success");
    scrollToAiSection("ai-chat");
  }, [setRecording, sendMessage, showToast]);

  const toggleVoiceCapture = useCallback(() => {
    if (isRecording) stopVoiceCapture();
    else startVoiceCapture();
  }, [isRecording, startVoiceCapture, stopVoiceCapture]);

  const toggleVoiceModeWithFeedback = useCallback(() => {
    toggleVoiceMode();
    const next = !voiceMode;
    showToast(
      next ? "Voice mode on — tap mic to speak" : "Voice mode off",
      next ? "success" : "info",
    );
  }, [toggleVoiceMode, voiceMode, showToast]);

  const triggerImageDiagnosis = useCallback(() => {
    scrollToAiSection("ai-image-diagnosis");
    window.setTimeout(() => {
      document.getElementById("ai-diagnosis-file-input")?.click();
    }, 300);
  }, []);

  const onAttachFile = useCallback(() => {
    showToast("Attach photos via Image Diagnosis", "info");
    triggerImageDiagnosis();
  }, [showToast, triggerImageDiagnosis]);

  const onFloatingImageUpload = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) {
        showToast("Please choose a JPG or PNG image", "error");
        return;
      }
      scrollToAiSection("ai-image-diagnosis");
      sendMessage(`Uploaded image: ${file.name} for AI diagnosis`);
      showToast("Image sent to AI for analysis", "success");
    },
    [sendMessage, showToast],
  );

  const onSmartAction = useCallback(
    (action: { id: string; prompt?: string; href?: string }) => {
      if (action.href) {
        router.push(action.href);
        return;
      }
      if (action.prompt) {
        sendMessage(action.prompt);
        scrollToAiSection("ai-chat");
      }
    },
    [router, sendMessage],
  );

  const onSummaryStatClick = useCallback(
    (id: string) => {
      if (id === "health") runHeroStatAction("health");
      else if (id === "systems") router.push("/bookings");
      else if (id === "alerts") showToast("No active alerts — all clear!", "success");
    },
    [runHeroStatAction, router, showToast],
  );

  const viewAllInsights = useCallback(() => {
    scrollToAiSection("ai-chat");
    sendMessage("Show all AI home insights");
    showToast("Loading insights in chat", "info");
  }, [sendMessage, showToast]);

  const viewAllPredictions = useCallback(() => {
    showToast("AI predictions refreshed", "success");
  }, [showToast]);

  return {
    runInsightAction,
    runPredictionAction,
    runStatusAction,
    runHeroStatAction,
    runChatQuickAction,
    onSmartAction,
    toggleVoiceCapture,
    toggleVoiceModeWithFeedback,
    triggerImageDiagnosis,
    onAttachFile,
    onFloatingImageUpload,
    onSummaryStatClick,
    viewAllInsights,
    viewAllPredictions,
    scrollToAiSection,
    setDraft,
    sendMessage,
    isRecording,
    voiceMode,
  };
}
