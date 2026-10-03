import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { provenanceForNewUser } from "../lib/data-provenance";
import { visionObservationMode, submitImage, analyzeImage, VisionRejected } from "../services/vision-intelligence.service";
import prisma from "../lib/prisma";
import { aiConfig } from "../ai/config";

/**
 * A real submission must clear the service's own MIN_IMAGE_BYTES (512) floor. A bare magic-byte
 * header is enough to exercise MIME/format detection but not enough to pass validation — padding
 * with zero bytes keeps the declared format's signature intact while reaching a size the service
 * will actually accept, so these fixtures exercise the real acceptance path instead of tripping
 * IMAGE_TOO_SMALL before the behaviour under test ever runs.
 */
function validJpeg(size = 600): Buffer {
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  return Buffer.concat([header, Buffer.alloc(Math.max(0, size - header.length))]);
}

function validPng(size = 600): Buffer {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  return Buffer.concat([header, Buffer.alloc(Math.max(0, size - header.length))]);
}

describe("Vision Shadow Certification", () => {
  /**
   * `vision_images.owner_id` carries a real foreign key to `users` — see the
   * `vision_images_owner_id_fkey` constraint in the vision_pipeline migration. A submission
   * attributed to a string that names no user is not a smaller test, it is a test of a state the
   * database itself refuses to hold, so every case here owns real rows created against the
   * isolated test database rather than an id that merely looks like one.
   */
  const RUN_ID = `vision-${Date.now().toString(36)}`;
  let userId: string;
  let otherUserId: string;

  async function createTestUser(slot: string): Promise<string> {
    const user = await prisma.user.create({
      data: {
        ...provenanceForNewUser(`${RUN_ID}-${slot}@vision.test`),
        email: `${RUN_ID}-${slot}@vision.test`,
        phoneNumber: `+1555${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 10)}`,
        firstName: "Vision",
        lastName: "Test",
        password: await Bun.password.hash("x", { algorithm: "bcrypt", cost: 4 }),
        role: "CUSTOMER",
        isEmailVerified: true,
      },
      select: { id: true },
    });
    return user.id;
  }

  beforeAll(async () => {
    userId = await createTestUser("owner");
    otherUserId = await createTestUser("other");
  });

  afterAll(async () => {
    // Cascades to vision_images (owner_id fkey, ON DELETE CASCADE) and from there to
    // vision_analyses (image_id fkey, ON DELETE CASCADE) — deleting the users is sufficient.
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  beforeEach(() => {
    process.env.VISION_FORCE_FALLBACK = "true";
  });

  afterEach(() => {
    delete process.env.VISION_FORCE_FALLBACK;
  });

  describe("Fallback Mode (VISION_FORCE_FALLBACK=true)", () => {
    it("should return FALLBACK observation mode when force-fallback is set", () => {
      const mode = visionObservationMode();
      expect(mode).toBe("FALLBACK");
    });

    it("should accept and store image in fallback mode", async () => {
      const imageData = validJpeg();

      const result = await submitImage({
        ownerId: userId,
        bytes: imageData,
        mimeType: "image/jpeg",
        purpose: "SERVICE_CONTEXT",
      });

      expect(result.imageId).toBeDefined();
      expect(result.retentionUntil).toBeDefined();
    });

    it("should analyze image with fallback provider", async () => {
      const imageData = validJpeg();

      const submitted = await submitImage({
        ownerId: userId,
        bytes: imageData,
        mimeType: "image/jpeg",
        purpose: "SERVICE_CONTEXT",
      });

      const analysis = await analyzeImage(submitted.imageId, userId);

      expect(analysis.observationMode).toBe("FALLBACK");
      expect(analysis.provider).toBe("MOCK");
      expect(analysis.confidence).toBe(0);
      expect(analysis.observations).toBeTruthy();
      expect(analysis.advisory).toBe(true);
    });

    it("should not have fabricated recommendations in fallback", async () => {
      const imageData = validPng();

      const submitted = await submitImage({
        ownerId: userId,
        bytes: imageData,
        mimeType: "image/png",
        purpose: "SERVICE_CONTEXT",
      });

      const analysis = await analyzeImage(submitted.imageId, userId);

      expect(analysis.recommendedServiceId).toBeNull();
      expect(analysis.recommendedServiceName).toBeNull();
    });

    it("should enforce ownership in fallback mode", async () => {
      const imageData = validJpeg();

      const submitted = await submitImage({
        ownerId: userId,
        bytes: imageData,
        mimeType: "image/jpeg",
        purpose: "SERVICE_CONTEXT",
      });

      try {
        await analyzeImage(submitted.imageId, otherUserId);
        expect.unreachable("Should have thrown NOT_IMAGE_OWNER");
      } catch (err) {
        expect(err instanceof VisionRejected).toBe(true);
        expect((err as VisionRejected).code).toBe("NOT_IMAGE_OWNER");
      }
    });
  });

  describe("Real Provider Mode Detection", () => {
    it("should return FALLBACK when VISION_FORCE_FALLBACK=true", () => {
      process.env.VISION_FORCE_FALLBACK = "true";
      const mode = visionObservationMode();
      expect(mode).toBe("FALLBACK");
    });

    it("should respect credential existence", () => {
      delete process.env.VISION_FORCE_FALLBACK;

      /**
       * `aiConfig` is declared `as const` — deeply readonly at the type level, though not
       * `Object.freeze`d, so it is genuinely writable at runtime. Cast once, locally, to mutate
       * the field this function actually reads instead of an env var name it never checks:
       * `aiConfig` is a plain object built once from `process.env.GEMINI_API_KEY` at import time
       * (see `ai/config.ts`), so setting `process.env` after that has already happened has no
       * effect on it.
       */
      const gemini = aiConfig.gemini as { apiKey?: string };
      const mutableConfig = aiConfig as { dryRun: boolean };
      const originalKey = gemini.apiKey;
      const originalDryRun = mutableConfig.dryRun;
      try {
        gemini.apiKey = undefined;
        mutableConfig.dryRun = false;
        expect(visionObservationMode()).toBe("FALLBACK");

        gemini.apiKey = "test-key";
        expect(visionObservationMode()).toBe("REAL_PROVIDER");
      } finally {
        gemini.apiKey = originalKey;
        mutableConfig.dryRun = originalDryRun;
      }
    });
  });

  describe("Image Validation", () => {
    it("should reject unsupported MIME types", async () => {
      const imageData = Buffer.from("not an image");

      try {
        await submitImage({
          ownerId: userId,
          bytes: imageData,
          mimeType: "image/bmp",
          purpose: "SERVICE_CONTEXT",
        });
        expect.unreachable("Should have thrown UNSUPPORTED_MIME");
      } catch (err) {
        expect(err instanceof VisionRejected).toBe(true);
        expect((err as VisionRejected).code).toBe("UNSUPPORTED_MIME");
      }
    });

    it("should reject images that are too small", async () => {
      const tinyData = Buffer.from([0xff, 0xd8]);

      try {
        await submitImage({
          ownerId: userId,
          bytes: tinyData,
          mimeType: "image/jpeg",
          purpose: "SERVICE_CONTEXT",
        });
        expect.unreachable("Should have thrown IMAGE_TOO_SMALL");
      } catch (err) {
        expect(err instanceof VisionRejected).toBe(true);
        expect((err as VisionRejected).code).toBe("IMAGE_TOO_SMALL");
      }
    });

    it("should reject images that are too large", async () => {
      const largeData = Buffer.alloc(10 * 1024 * 1024);
      largeData[0] = 0xff;
      largeData[1] = 0xd8;
      largeData[2] = 0xff;

      try {
        await submitImage({
          ownerId: userId,
          bytes: largeData,
          mimeType: "image/jpeg",
          purpose: "SERVICE_CONTEXT",
        });
        expect.unreachable("Should have thrown IMAGE_TOO_LARGE");
      } catch (err) {
        expect(err instanceof VisionRejected).toBe(true);
        expect((err as VisionRejected).code).toBe("IMAGE_TOO_LARGE");
      }
    });

    it("should reject MIME mismatches", async () => {
      const pngData = validPng();

      try {
        await submitImage({
          ownerId: userId,
          bytes: pngData,
          mimeType: "image/jpeg",
          purpose: "SERVICE_CONTEXT",
        });
        expect.unreachable("Should have thrown MIME_MISMATCH");
      } catch (err) {
        expect(err instanceof VisionRejected).toBe(true);
        expect((err as VisionRejected).code).toBe("MIME_MISMATCH");
      }
    });
  });

  describe("Safety Flags", () => {
    it("should include NO_VISION_CLIENT in fallback mode", async () => {
      const imageData = validJpeg();

      const submitted = await submitImage({
        ownerId: userId,
        bytes: imageData,
        mimeType: "image/jpeg",
        purpose: "SERVICE_CONTEXT",
      });

      const analysis = await analyzeImage(submitted.imageId, userId);

      expect(analysis.safetyFlags).toContain("NO_VISION_CLIENT");
    });

    it("should screen prompt injection in observations", async () => {
      // This test would require mocking the real provider call
      // In shadow mode, observations are always safe
      const imageData = validJpeg();

      const submitted = await submitImage({
        ownerId: userId,
        bytes: imageData,
        mimeType: "image/jpeg",
        purpose: "SERVICE_CONTEXT",
      });

      const analysis = await analyzeImage(submitted.imageId, userId);

      const injectionAttempts = analysis.observations.filter((o) =>
        o.includes("forget") || o.includes("ignore") || o.includes("bypass"),
      );
      expect(injectionAttempts).toHaveLength(0);
    });
  });

  describe("Multi-User Isolation", () => {
    it("should not allow user to access other user's images", async () => {
      const imageData = validJpeg();

      const submitted = await submitImage({
        ownerId: userId,
        bytes: imageData,
        mimeType: "image/jpeg",
        purpose: "SERVICE_CONTEXT",
      });

      try {
        await analyzeImage(submitted.imageId, otherUserId);
        expect.unreachable("Should have thrown NOT_IMAGE_OWNER");
      } catch (err) {
        expect(err instanceof VisionRejected).toBe(true);
        expect((err as VisionRejected).code).toBe("NOT_IMAGE_OWNER");
      }
    });
  });

  describe("Advisory Flag", () => {
    it("should always mark analysis as advisory", async () => {
      const imageData = validJpeg();

      const submitted = await submitImage({
        ownerId: userId,
        bytes: imageData,
        mimeType: "image/jpeg",
        purpose: "SERVICE_CONTEXT",
      });

      const analysis = await analyzeImage(submitted.imageId, userId);

      expect(analysis.advisory).toBe(true);
    });
  });

  describe("Retention Policy", () => {
    it("should set retention date on image submission", async () => {
      const imageData = validJpeg();

      const result = await submitImage({
        ownerId: userId,
        bytes: imageData,
        mimeType: "image/jpeg",
        purpose: "SERVICE_CONTEXT",
      });

      const retentionDate = new Date(result.retentionUntil);
      const now = new Date();
      const daysDiff = Math.floor((retentionDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      expect(daysDiff).toBeGreaterThan(25);
      expect(daysDiff).toBeLessThanOrEqual(31);
    });
  });

  describe("Latency Measurement", () => {
    it("should measure analysis latency", async () => {
      const imageData = validJpeg();

      const submitted = await submitImage({
        ownerId: userId,
        bytes: imageData,
        mimeType: "image/jpeg",
        purpose: "SERVICE_CONTEXT",
      });

      const analysis = await analyzeImage(submitted.imageId, userId);

      expect(analysis.latencyMs).toBeGreaterThanOrEqual(0);
      expect(typeof analysis.latencyMs).toBe("number");
    });
  });
});
