import crypto from "crypto";
import prisma from "../lib/prisma";
import { CUSTOMER_CATALOG_WHERE } from "../lib/service-domain";
import { objectStorageService } from "./object-storage.service";
import { aiConfig } from "../ai/config";
import { sanitizeInput, detectPromptInjection } from "../ai/security/prompt-security";
import { callGeminiVision } from "../ai/providers/model-providers";
import { checkAndReserveBudget, settleBudget, abandonBudget } from "./ai-budget.service";
import { computeTokenCostDetailed } from "../ai/cost/ai-cost.service";
import { checkAiRateLimit } from "../ai/rate-limit/ai-rate-limit";
import { recordAiRequest } from "../ai/audit/ai-audit.service";
import { hashContent } from "../ai/security/prompt-security";
import { logger } from "../lib/logger";
import { incCounter } from "../lib/metrics";
import type { VisionImagePurpose, VisionObservationMode } from "@prisma/client";

/**
 * Looking at a customer's photo and saying something useful about it.
 *
 * ── Advisory, and only advisory ─────────────────────────────────────────────
 *
 * Everything this produces is a suggestion. Vision cannot refund, pay out, credit a wallet, move the
 * ledger, approve KYC, assign a provider or change a booking's state, and the guard against that is
 * not a convention — nothing here calls those services, the analysis row carries `advisory` with a
 * CHECK constraint that refuses any other value, and the recommendation it emits is a service id a
 * customer may choose to act on.
 *
 * ── Real, or not real, never blurred ────────────────────────────────────────
 *
 * A Gemini credential IS configured on this platform, so `visionObservationMode()` can answer
 * REAL_PROVIDER. What does not exist yet is a vision client behind it: no code here sends an image to
 * a model. Until one is written, every analysis is produced by the deterministic fallback and is
 * recorded as FALLBACK on the row itself, rather than inferred later from whatever the config happens
 * to say — config changes, and a stored result must keep meaning what it meant when it was made.
 *
 * The distinction matters more than the absence. A fallback result is a test of the pipeline; it is
 * not evidence about a model's quality, and it must never be reported, shown or certified as one.
 */

/** What the platform will accept. Anything else is refused before a byte is stored. */
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/** 8 MB. Large enough for a phone photo, small enough that a hostile upload cannot exhaust disk. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Smaller than any real photograph — a few bytes with a JPEG header is a probe, not an image. */
const MIN_IMAGE_BYTES = 512;

/**
 * How long the bytes are kept.
 *
 * Deliberately short and configurable. The analysis outlives the image on purpose: keeping a
 * customer's photograph indefinitely to explain a decision is a privacy cost the structured result
 * already covers.
 */
const RETENTION_DAYS = Number(process.env.VISION_IMAGE_RETENTION_DAYS ?? 30);

/** Set false to keep only metadata and never persist bytes at all. */
const PERSIST_BYTES = process.env.VISION_PERSIST_IMAGE_BYTES !== "false";

export type VisionResult = {
  analysisId: string;
  imageId: string;
  observationMode: VisionObservationMode;
  provider: string;
  model: string;
  observedCategory: string | null;
  observations: string[];
  confidence: number;
  recommendedServiceId: string | null;
  recommendedServiceName: string | null;
  safetyFlags: string[];
  advisory: true;
  latencyMs: number;
  createdAt: string;
};

export class VisionRejected extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
  }
}

/**
 * Whether a real vision provider is reachable at all.
 *
 * Read from the same config the text providers use, so there is one answer to "do we have
 * credentials" rather than a second opinion that can drift from the first.
 */
export function visionObservationMode(): VisionObservationMode {
  /**
   * An operational off switch for provider spend, checked before the credential.
   *
   * Vision is the one path here that costs money per request and sends a customer's image to a third
   * party. Being able to stop that without pulling the credential out of the environment — which
   * would also break the text providers sharing it — is worth a flag of its own. It is also what lets
   * the pipeline's safety tests run without buying an API call each time they do.
   */
  if (process.env.VISION_FORCE_FALLBACK === "true") return "FALLBACK";
  const hasKey = Boolean(aiConfig.gemini?.apiKey) && !aiConfig.dryRun;
  return hasKey ? "REAL_PROVIDER" : "FALLBACK";
}

/**
 * Validate before anything is stored.
 *
 * The magic bytes are checked rather than the declared MIME type: a caller controls the header it
 * sends, so trusting it would let a script arrive labelled as a PNG.
 */
function assertAcceptableImage(bytes: Buffer, declaredMime: string): void {
  if (!ALLOWED_MIME.has(declaredMime)) throw new VisionRejected("UNSUPPORTED_MIME", declaredMime);
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new VisionRejected("IMAGE_TOO_LARGE", `${bytes.byteLength} bytes`);
  if (bytes.byteLength < MIN_IMAGE_BYTES) throw new VisionRejected("IMAGE_TOO_SMALL", `${bytes.byteLength} bytes`);

  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isWebp = bytes.slice(0, 4).toString("ascii") === "RIFF" && bytes.slice(8, 12).toString("ascii") === "WEBP";
  if (!isJpeg && !isPng && !isWebp) throw new VisionRejected("NOT_AN_IMAGE", "magic bytes do not match any accepted format");

  const declaredMatches =
    (declaredMime === "image/jpeg" && isJpeg) ||
    (declaredMime === "image/png" && isPng) ||
    (declaredMime === "image/webp" && isWebp);
  if (!declaredMatches) throw new VisionRejected("MIME_MISMATCH", `declared ${declaredMime}`);
}

/**
 * Accept an image from a customer and record it.
 *
 * `ownerId` is the authenticated actor, resolved by the caller. It is what every later read is
 * checked against — an image is one customer's, and analysing someone else's photo is the failure
 * this whole path is arranged to prevent.
 */
export async function submitImage(input: {
  ownerId: string;
  bytes: Buffer;
  mimeType: string;
  purpose: VisionImagePurpose;
  bookingId?: string | null;
}): Promise<{ imageId: string; retentionUntil: string }> {
  assertAcceptableImage(input.bytes, input.mimeType);

  const contentHash = crypto.createHash("sha256").update(input.bytes).digest("hex");
  const retentionUntil = new Date(Date.now() + RETENTION_DAYS * 86_400_000);
  const storageKey = `vision/${input.ownerId}/${contentHash}`;

  /**
   * Metadata first, bytes second. If storage fails the row is removed rather than left pointing at
   * an object that does not exist — a dangling reference would fail at analysis time instead of here.
   */
  const image = await prisma.visionImage.create({
    data: {
      ownerId: input.ownerId,
      purpose: input.purpose,
      storageKey: PERSIST_BYTES ? storageKey : "",
      mimeType: input.mimeType,
      byteSize: input.bytes.byteLength,
      contentHash,
      retentionUntil,
      bookingId: input.bookingId ?? null,
    },
    select: { id: true },
  });

  if (PERSIST_BYTES) {
    try {
      await objectStorageService.putObject("support-attachments", input.bytes, {
        fileName: `${contentHash}.${input.mimeType.split("/")[1]}`,
        mimeType: input.mimeType,
        storageKey,
      });
    } catch (err) {
      await prisma.visionImage.delete({ where: { id: image.id } }).catch(() => undefined);
      logger.error("vision_image_store_failed", {
        imageId: image.id,
        error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      });
      throw new VisionRejected("STORAGE_FAILED");
    }
  }

  incCounter("vision_images_submitted_total", { purpose: input.purpose });
  return { imageId: image.id, retentionUntil: retentionUntil.toISOString() };
}

/**
 * The deterministic stand-in used when no credentials exist.
 *
 * It deliberately does not guess what is in the picture. Inventing "this looks like a leaking tap"
 * from a mock would be indistinguishable from a real observation in every downstream surface, which
 * is exactly the confusion `observationMode` exists to prevent. It reports that it could not look,
 * carries a confidence of zero, and recommends nothing.
 */
function fallbackAnalysis(latencyMs: number) {
  return {
    observationMode: "FALLBACK" as const,
    provider: "MOCK",
    model: "none",
    observedCategory: null as string | null,
    observations: ["This image was not analysed: no vision client is implemented yet."],
    confidence: 0,
    recommendedServiceId: null as string | null,
    safetyFlags: ["NO_VISION_CLIENT"],
    latencyMs,
  };
}

/**
 * Analyse a stored image.
 *
 * Refuses on anyone but the owner, refuses on an image whose bytes have been purged, and records
 * what came back — including a failure — so a provider outage leaves a trace rather than a silence.
 */
export async function analyzeImage(imageId: string, requesterId: string): Promise<VisionResult> {
  const image = await prisma.visionImage.findUnique({
    where: { id: imageId },
    select: { id: true, ownerId: true, status: true, storageKey: true, mimeType: true, retentionUntil: true },
  });
  if (!image) throw new VisionRejected("IMAGE_NOT_FOUND");
  /** Ownership, before anything else is read or spent. */
  if (image.ownerId !== requesterId) throw new VisionRejected("NOT_IMAGE_OWNER");
  if (image.status === "PURGED") throw new VisionRejected("IMAGE_PURGED");
  if (image.retentionUntil.getTime() <= Date.now()) throw new VisionRejected("IMAGE_EXPIRED");

  const t0 = Date.now();
  const mode = visionObservationMode();

  /**
   * A real call is attempted only when a credential exists, and its failure is never silent.
   *
   * A provider outage must not look like a model that saw nothing: both produce a zero-confidence
   * result, so the mode and the safety flag are what separate them. A FALLBACK row means no model
   * looked; a REAL_PROVIDER row with PROVIDER_ERROR means one was asked and could not answer.
   */
  /**
   * `observationMode` widened to the column's own enum.
   *
   * The type was derived wholesale from `fallbackAnalysis`, whose `observationMode` is the literal
   * "FALLBACK" — so every real-provider assignment below needed `"REAL_PROVIDER" as never` to get
   * past it. The variable legitimately holds either mode; the type just said otherwise. Nothing
   * about which mode is recorded changes here.
   */
  let raw: Omit<ReturnType<typeof fallbackAnalysis>, "observationMode"> & {
    observationMode: VisionObservationMode;
    observedCategory: string | null;
  };
  if (mode === "REAL_PROVIDER") {
    /**
     * ── Governance for a path that had none ─────────────────────────────────────
     *
     * This called `callGeminiVision` directly, so it reached a paid provider without passing the
     * AI gateway — and therefore without the rate limit, the spend cap, the cost record or the AI
     * audit trail. The route behind it is `requireAuth`, not admin, so any authenticated customer
     * could drive unbounded Gemini spend that no budget could see, let alone stop. A cap that only
     * covers one of two doors is not a cap.
     *
     * It is not routed through `invokeAiGateway` because that entry expects a text conversation —
     * messages, prompt templates, output schema validation. Forcing an image through it would mean
     * bending the gateway around a shape it does not have. The controls are applied directly
     * instead, reusing the same services the gateway uses rather than reimplementing them.
     */
    const budgetActor = { actorId: requesterId, actorRole: "CUSTOMER" as const };

    const rate = await checkAiRateLimit(budgetActor.actorId, budgetActor.actorRole);
    if (!rate.allowed) {
      incCounter("vision_analysis_blocked_total", { reason: "RATE_LIMITED" });
      throw new VisionRejected("RATE_LIMITED");
    }

    /**
     * `maxOutputTokens: 512` is the adapter's own hard ceiling. The prompt side is the image, whose
     * token cost Gemini decides — so the estimate is the system prompt plus a bound derived from
     * the encoded image size rather than a number chosen to look plausible. Reserved high, settled
     * to the provider's real `usageMetadata` figure immediately afterwards.
     */
    const bytes = await objectStorageService.getObjectBuffer("support-attachments", image.storageKey);
    const imageB64 = bytes.toString("base64");
    const budget = await checkAndReserveBudget({
      eligibleProviders: ["GEMINI"],
      actorRole: budgetActor.actorRole,
      actorId: budgetActor.actorId,
      endpoint: "vision.analyze",
      estimatedPromptTokens: Math.ceil(imageB64.length / 4),
      maxOutputTokens: 512,
    });

    if (!budget.allowed) {
      incCounter("vision_analysis_blocked_total", { reason: budget.decision });
      logger.warn("vision_budget_blocked", { imageId: image.id, decision: budget.decision });
      throw new VisionRejected("BUDGET_EXCEEDED");
    }

    let budgetSettled = false;
    const releaseVisionBudget = async (actual?: { costUsd: number; costStatus: "COMPUTED" | "UNKNOWN" }) => {
      if (budgetSettled || budget.reservations.length === 0) return;
      budgetSettled = true;
      await (actual ? settleBudget(budget.reservations, actual) : abandonBudget(budget.reservations));
    };

    try {
      const seen = await callGeminiVision({
        imageBase64: imageB64,
        mimeType: image.mimeType,
      });

      /**
       * Settled from the provider's own usage figures. When Gemini omits `usageMetadata` the cost
       * is genuinely UNKNOWN and is settled as such — counted separately, never folded in as zero.
       */
      const cost = seen.promptTokens !== null && seen.completionTokens !== null
        ? computeTokenCostDetailed("GEMINI", seen.promptTokens, seen.completionTokens, 0)
        : { costUsd: 0, costStatus: "UNKNOWN" as const };
      await releaseVisionBudget(cost);

      await recordAiRequest({
        requestId: crypto.randomUUID(),
        actorId: budgetActor.actorId,
        actorRole: budgetActor.actorRole,
        templateId: "vision.analyze",
        // The image is never stored or logged; its hash is what makes the record traceable.
        promptHash: hashContent(image.storageKey),
        provider: "GEMINI",
        status: "SUCCESS",
        latencyMs: seen.latencyMs,
        promptTokens: seen.promptTokens ?? 0,
        completionTokens: seen.completionTokens ?? 0,
        cachedTokens: 0,
        costUsd: cost.costUsd,
        fallbackUsed: false,
      }).catch(() => undefined);

      raw = {
        observationMode: "REAL_PROVIDER",
        provider: "GEMINI",
        model: seen.model,
        observedCategory: seen.observedCategory,
        observations: seen.observations,
        confidence: seen.confidence,
        recommendedServiceId: null,
        safetyFlags: seen.safetyFlags,
        latencyMs: seen.latencyMs,
      };
    } catch (err) {
      /**
       * Abandon, not settle. A failed call may have been billed or may never have reached Gemini,
       * and this platform has no figure for either — settling an invented cost would put a made-up
       * number in the accumulator, while holding the reservation would leak headroom until the
       * window rolls.
       */
      await releaseVisionBudget();
      logger.warn("vision_provider_call_failed", {
        imageId: image.id,
        error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      });
      /**
       * Recorded as REAL_PROVIDER on purpose. A real attempt was made and failed; calling it
       * FALLBACK would file it alongside runs where no model was ever contacted and quietly lose
       * the difference between "no provider" and "provider broken".
       */
      raw = {
        observationMode: "REAL_PROVIDER",
        provider: "GEMINI",
        model: "unavailable",
        observedCategory: null,
        observations: [],
        confidence: 0,
        recommendedServiceId: null,
        safetyFlags: ["PROVIDER_ERROR"],
        latencyMs: Date.now() - t0,
      };
    }
  } else {
    raw = fallbackAnalysis(Date.now() - t0);
  }

  /**
   * Whatever a provider returns is untrusted text. It is sanitized and screened before it is stored,
   * because a model that read instructions off a photograph would otherwise get them persisted and
   * replayed to the next reader.
   */
  const observations = raw.observations
    .map((o) => sanitizeInput(o).slice(0, 500))
    .map((o) => (detectPromptInjection(o) ? "[observation withheld]" : o));
  const safetyFlags = [...raw.safetyFlags];
  if (observations.some((o) => o === "[observation withheld]")) safetyFlags.push("INJECTION_SCREENED");

  /** A recommendation is only kept if it names a service that actually exists and is sellable. */
  let recommendedServiceId: string | null = null;
  let recommendedServiceName: string | null = null;
  if (raw.recommendedServiceId) {
    const svc = await prisma.service.findFirst({
      where: { id: raw.recommendedServiceId, ...CUSTOMER_CATALOG_WHERE },
      select: { id: true, name: true },
    });
    recommendedServiceId = svc?.id ?? null;
    recommendedServiceName = svc?.name ?? null;
  }

  const analysis = await prisma.visionAnalysis.create({
    data: {
      imageId: image.id,
      observationMode: raw.observationMode,
      provider: raw.provider,
      model: raw.model,
      observedCategory: raw.observedCategory,
      observations,
      confidence: raw.confidence,
      recommendedServiceId,
      safetyFlags,
      advisory: true,
      latencyMs: Date.now() - t0,
    },
  });

  await prisma.visionImage.update({ where: { id: image.id }, data: { status: "ANALYZED" } });

  incCounter("vision_analyses_total", { mode: raw.observationMode });

  return {
    analysisId: analysis.id,
    imageId: image.id,
    observationMode: analysis.observationMode,
    provider: analysis.provider,
    model: analysis.model,
    observedCategory: analysis.observedCategory,
    observations: analysis.observations,
    confidence: analysis.confidence,
    recommendedServiceId,
    recommendedServiceName,
    safetyFlags: analysis.safetyFlags,
    advisory: true,
    latencyMs: analysis.latencyMs,
    createdAt: analysis.createdAt.toISOString(),
  };
}

/**
 * Delete the bytes of every image past its retention date.
 *
 * The row stays and is marked PURGED: the account of what was asked and answered is what makes a
 * past analysis explainable, and it holds no photograph. Storage failures are logged and left for
 * the next sweep rather than swallowed, so an object that refuses to delete stays visible.
 */
export async function purgeExpiredImages(now = new Date()): Promise<{ purged: number; failed: number }> {
  const due = await prisma.visionImage.findMany({
    where: { status: { not: "PURGED" }, retentionUntil: { lte: now } },
    select: { id: true, storageKey: true },
    take: 500,
  });

  let purged = 0, failed = 0;
  for (const img of due) {
    try {
      if (img.storageKey) await objectStorageService.deleteObject("support-attachments", img.storageKey);
      await prisma.visionImage.update({
        where: { id: img.id },
        data: { status: "PURGED", purgedAt: now, storageKey: "" },
      });
      purged++;
    } catch (err) {
      failed++;
      logger.warn("vision_image_purge_failed", {
        imageId: img.id,
        error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      });
    }
  }
  if (purged || failed) incCounter("vision_images_purged_total", { result: failed ? "partial" : "ok" });
  return { purged, failed };
}
