import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import {
  submitImage,
  analyzeImage,
  purgeExpiredImages,
  visionObservationMode,
  VisionRejected,
} from "../services/vision-intelligence.service";
import prisma from "../lib/prisma";
import type { VisionImagePurpose } from "@prisma/client";

export const visionRoutes = new Elysia({ prefix: "/api/vision" })
  .use(authPlugin)

  .post(
    "/images/submit",
    async ({ requireAuth, body, set }) => {
      const { userId } = requireAuth();

      if (!body.bytes || !body.mimeType) {
        set.status = 400;
        return { success: false, error: "Missing bytes or mimeType", code: "INVALID_REQUEST" };
      }

      try {
        /**
         * The wire format is base64 text — a JSON body cannot carry raw binary, and the customer
         * web UI (`VisionUploadZone`/vision page) already sends `FileReader.readAsDataURL()`
         * output with the `data:...;base64,` prefix stripped, i.e. pure base64. `Buffer.from(str)`
         * with no encoding argument defaults to UTF-8, not base64: it read the base64 *text*
         * itself as bytes, so a real JPEG's base64 (starting `/9j/4AAQ...`, all printable ASCII)
         * was stored as those ASCII byte values — nowhere near the real `FF D8 FF` JPEG magic
         * bytes. Every real submission through this route failed `NOT_AN_IMAGE` before this fix;
         * it went undetected because the vision test suite exercises `submitImage()` directly
         * with a real Buffer, never through this HTTP layer's decoding at all.
         */
        const result = await submitImage({
          ownerId: userId,
          bytes: Buffer.from(body.bytes, "base64"),
          mimeType: body.mimeType,
          purpose: (body.purpose ?? "SERVICE_CONTEXT") as VisionImagePurpose,
          bookingId: body.bookingId,
        });

        return { success: true, data: result };
      } catch (err) {
        if (err instanceof VisionRejected) {
          const statusMap: Record<string, number> = {
            UNSUPPORTED_MIME: 400,
            IMAGE_TOO_LARGE: 413,
            IMAGE_TOO_SMALL: 400,
            NOT_AN_IMAGE: 400,
            MIME_MISMATCH: 400,
            STORAGE_FAILED: 502,
          };
          set.status = statusMap[err.code] ?? 400;
          return { success: false, error: err.message, code: err.code };
        }
        throw err;
      }
    },
    {
      body: t.Object({
        bytes: t.String(),
        mimeType: t.String(),
        purpose: t.Optional(t.String()),
        bookingId: t.Optional(t.String()),
      }),
    },
  )

  .post(
    "/images/:imageId/analyze",
    async ({ requireAuth, params, set }) => {
      const { userId } = requireAuth();

      try {
        const result = await analyzeImage(params.imageId, userId);
        return { success: true, data: result };
      } catch (err) {
        if (err instanceof VisionRejected) {
          const statusMap: Record<string, number> = {
            IMAGE_NOT_FOUND: 404,
            NOT_IMAGE_OWNER: 403,
            IMAGE_PURGED: 410,
            IMAGE_EXPIRED: 410,
            // Governance refusals: the request was valid and permitted, but a control said no.
            // 429 and 402 so a client can tell "try later" from "the platform is out of budget",
            // rather than both arriving as an indistinguishable 400.
            RATE_LIMITED: 429,
            BUDGET_EXCEEDED: 402,
            BUDGET_POLICY_REQUIRED: 402,
          };
          set.status = statusMap[err.code] ?? 400;
          return { success: false, error: err.message, code: err.code };
        }
        throw err;
      }
    },
  )

  .get("/images/:imageId", async ({ requireAuth, params, set }) => {
    const { userId } = requireAuth();

    const image = await prisma.visionImage.findUnique({
      where: { id: params.imageId },
      select: {
        id: true,
        ownerId: true,
        purpose: true,
        status: true,
        mimeType: true,
        byteSize: true,
        retentionUntil: true,
        createdAt: true,
      },
    });

    if (!image) {
      set.status = 404;
      return { success: false, error: "Image not found", code: "NOT_FOUND" };
    }

    if (image.ownerId !== userId) {
      set.status = 403;
      return { success: false, error: "Not image owner", code: "FORBIDDEN" };
    }

    return { success: true, data: image };
  })

  .get("/images/:imageId/analysis", async ({ requireAuth, params, set }) => {
    const { userId } = requireAuth();

    const image = await prisma.visionImage.findUnique({
      where: { id: params.imageId },
      select: { ownerId: true },
    });

    if (!image) {
      set.status = 404;
      return { success: false, error: "Image not found", code: "NOT_FOUND" };
    }

    if (image.ownerId !== userId) {
      set.status = 403;
      return { success: false, error: "Not image owner", code: "FORBIDDEN" };
    }

    const analysis = await prisma.visionAnalysis.findFirst({
      where: { imageId: params.imageId },
      orderBy: { createdAt: "desc" },
    });

    if (!analysis) {
      set.status = 404;
      return { success: false, error: "No analysis found", code: "NOT_FOUND" };
    }

    return {
      success: true,
      data: {
        analysisId: analysis.id,
        imageId: analysis.imageId,
        observationMode: analysis.observationMode,
        provider: analysis.provider,
        model: analysis.model,
        observedCategory: analysis.observedCategory,
        observations: analysis.observations,
        confidence: analysis.confidence,
        recommendedServiceId: analysis.recommendedServiceId,
        safetyFlags: analysis.safetyFlags,
        advisory: true,
        latencyMs: analysis.latencyMs,
        createdAt: analysis.createdAt.toISOString(),
      },
    };
  })

  .get("/status", async ({ requireAuth, set }) => {
    const { role } = requireAuth();
    if (role !== "ADMIN") {
      set.status = 403;
      return { success: false, error: "Admin only", code: "FORBIDDEN" };
    }

    const mode = visionObservationMode();
    const since24h = new Date(Date.now() - 24 * 3_600_000);

    /**
     * `analyzeImage` always writes a row — a real provider failure is recorded as
     * `observationMode: REAL_PROVIDER` with `safetyFlags` containing `PROVIDER_ERROR`
     * (see vision-intelligence.service.ts), never as a missing row. Failure is therefore a flag on
     * an existing row, not a separate status column, so it has to be counted via that flag rather
     * than a `status` field the schema does not have.
     */
    const [totalAnalyses, recentAnalyses, byMode, failureCount, latencyAgg, lastAnalysis] = await Promise.all([
      prisma.visionAnalysis.count(),
      prisma.visionAnalysis.count({ where: { createdAt: { gte: since24h } } }),
      prisma.visionAnalysis.groupBy({ by: ["observationMode"], _count: { _all: true } }),
      prisma.visionAnalysis.count({ where: { safetyFlags: { has: "PROVIDER_ERROR" } } }),
      prisma.visionAnalysis.aggregate({ _avg: { latencyMs: true } }),
      prisma.visionAnalysis.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);

    const geminiCount = byMode.find((m) => m.observationMode === "REAL_PROVIDER")?._count._all ?? 0;
    const fallbackCount = byMode.find((m) => m.observationMode === "FALLBACK")?._count._all ?? 0;

    return {
      success: true,
      data: {
        observationMode: mode,
        totalAnalyses,
        recentAnalyses,
        successCount: totalAnalyses - failureCount,
        failureCount,
        geminiCount,
        fallbackCount,
        lastAnalysisAt: lastAnalysis?.createdAt.toISOString() ?? null,
        averageLatency: latencyAgg._avg.latencyMs ?? null,
      },
    };
  })

  .post("/admin/purge", async ({ requireAuth, set }) => {
    const { role } = requireAuth();
    if (role !== "ADMIN") {
      set.status = 403;
      return { success: false, error: "Admin only", code: "FORBIDDEN" };
    }

    const result = await purgeExpiredImages();
    return { success: true, data: result };
  });
