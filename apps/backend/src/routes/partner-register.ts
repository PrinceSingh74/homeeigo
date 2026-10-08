import { Elysia, t } from "elysia";
import { consumeRateLimitSmart } from "../middleware/rate-limit.middleware";
import { parseBody } from "../lib/route-security";
import { getClientIp } from "../lib/client-ip";
import {
  partnerKycSchema,
  partnerRegisterStep1Schema,
  partnerServicesSchema,
  partnerVerifyOtpSchema,
  normalizePartnerPhone,
  indiaPhoneSchema,
} from "../schemas/partner.schema";
import { partnerRegistrationService } from "../services/partner-registration.service";
import { partnerOnboardingService } from "../services/partner-onboarding.service";
import { documentUploadService } from "../services/document-upload.service";
import { partnerRegistrationSessionService } from "../services/partner-registration-session.service";
import { partnerLeadService } from "../services/partner-lead.service";
import { catalogService } from "../services/catalog.service";
import { requireRegistrationSession } from "../middleware/partner-registration-auth.middleware";
import { validate, ValidationFailedError } from "../middleware/validation.middleware";
import { sanitizeUserInput } from "../utils/sanitizer";
import { z } from "zod";

const documentIdParamSchema = z.object({ documentId: z.string().trim().min(1) });

const partnerRegIpLimit = process.env.NODE_ENV === "production" ? 15 : 100;
const partnerRegOtpLimit = process.env.NODE_ENV === "production" ? 20 : 100;
const partnerRegResumeLimit = process.env.NODE_ENV === "production" ? 20 : 100;

function mapError(err: unknown, set: { status?: number | string }) {
  if (err instanceof ValidationFailedError) throw err;
  const message = err instanceof Error ? err.message : "Request failed";
  const [code, detail] = message.includes(":") ? message.split(":", 2) : ["INTERNAL", message];

  switch (code) {
    case "VALIDATION":
      set.status = 400;
      return { success: false, error: detail, code: "VALIDATION_ERROR" };
    case "CONFLICT":
      set.status = 409;
      return { success: false, error: detail, code: "CONFLICT" };
    case "NOT_FOUND":
      set.status = 404;
      return { success: false, error: detail, code: "NOT_FOUND" };
    case "OTP":
      set.status = 400;
      return { success: false, error: detail, code: "INVALID_OTP" };
    case "FORBIDDEN":
      set.status = 403;
      return { success: false, error: detail, code: "FORBIDDEN" };
    default:
      console.error(err);
      set.status = 500;
      return { success: false, error: "Request failed", code: "INTERNAL_ERROR" };
  }
}

const getIp = (request: Request) => getClientIp(request);

const documentUploadSchema = z.object({
  file: z.string().min(1),
  documentType: z.string().trim().min(1).max(80),
  fileName: z.string().trim().max(255).optional(),
  expiryDate: z.string().trim().min(8).max(40).optional(),
  issuer: z.string().trim().max(120).optional(),
  issueDate: z.string().trim().min(8).max(40).optional(),
});

async function withRegistrationToken(
  request: Request,
  handler: (session: Awaited<ReturnType<typeof requireRegistrationSession>>) => Promise<unknown>,
  opts?: { allowCompleted?: boolean },
) {
  const session = await requireRegistrationSession(request, opts);
  return handler(session);
}

export const partnerRegisterRoutes = new Elysia({ prefix: "/api/partner" })
  .get("/register/service-options", async ({ set, request }) => {
    const limited = await consumeRateLimitSmart(`partner-onboarding-options:${getIp(request)}`, partnerRegIpLimit, 60_000);
    if (!limited.allowed) {
      set.status = 429;
      return { success: false, error: "Too many requests", code: "RATE_LIMITED" };
    }
    const data = await catalogService.partnerOnboardingOptions();
    return { success: true, data };
  })
  .post(
    "/register/step1",
    async ({ body: raw, request, set }) => {
      const ip = getIp(request);
      const limiter = await consumeRateLimitSmart(`partner-reg:${ip}`, partnerRegIpLimit, 60 * 60 * 1000);
      if (!limiter.allowed) {
        set.status = 429;
        return {
          success: false,
          error: "Too many registration attempts",
          code: "RATE_LIMIT_EXCEEDED",
        };
      }
      try {
        const body = parseBody(partnerRegisterStep1Schema, raw, {
          firstName: { maxLen: 50 },
          lastName: { maxLen: 50 },
        });
        const phone = normalizePartnerPhone(body.phoneNumber);
        validate(indiaPhoneSchema, phone);
        const data = await partnerRegistrationService.step1({
          ...body,
          phoneNumber: phone,
        });
        set.status = 201;
        return { success: true, message: "Account created. OTP sent to phone.", data };
      } catch (err) {
        return mapError(err, set);
      }
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        phoneNumber: t.String(),
        firstName: t.String({ minLength: 2 }),
        lastName: t.String({ minLength: 2 }),
        password: t.String({ minLength: 8 }),
        confirmPassword: t.String(),
      }),
    },
  )
  .post(
    "/register/verify-otp",
    async ({ body: raw, request, set }) => {
      const ip = getIp(request);
      const limiter = await consumeRateLimitSmart(`partner-reg-otp:${ip}`, partnerRegOtpLimit, 60 * 60 * 1000);
      if (!limiter.allowed) {
        set.status = 429;
        return { success: false, error: "Too many OTP attempts", code: "RATE_LIMIT_EXCEEDED" };
      }
      try {
        const body = parseBody(partnerVerifyOtpSchema, raw);
        const { fraudContextFromRequest } = await import("../lib/fraud-context");
        const ctx = fraudContextFromRequest(request, body.userId);
        const data = await partnerRegistrationService.verifyOtp({ ...body, ctx });
        return { success: true, message: "Phone verified", data };
      } catch (err) {
        return mapError(err, set);
      }
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        otp: t.String({ minLength: 6, maxLength: 6 }),
        userId: t.String(),
        inviteToken: t.Optional(t.String()),
        referralCode: t.Optional(t.String()),
      }),
    },
  )
  .get("/register/invite", async ({ query, set }) => {
    try {
      const token = typeof query.token === "string" ? query.token : "";
      if (!token) {
        set.status = 400;
        return { success: false, error: "Invite token is required", code: "VALIDATION_ERROR" };
      }
      const { verifyPartnerLeadInvite } = await import("../services/partner-application-invite");
      const invite = verifyPartnerLeadInvite(token);
      const data = await partnerLeadService.previewInvite(invite.leadId);
      return { success: true, data };
    } catch (err) {
      return mapError(err, set);
    }
  })
  .get("/register/referral-code", async ({ query, set }) => {
    try {
      const code = typeof query.code === "string" ? query.code : "";
      if (!code) {
        set.status = 400;
        return { success: false, error: "Referral code is required", code: "VALIDATION_ERROR" };
      }
      const { partnerReferralService } = await import("../services/partner-referral.service");
      const data = await partnerReferralService.previewCode(code);
      return { success: true, data };
    } catch (err) {
      return mapError(err, set);
    }
  })
  .post(
    "/register/resume",
    async ({ body: raw, request, set }) => {
      const ip = getIp(request);
      const limiter = await consumeRateLimitSmart(`partner-reg-resume:${ip}`, partnerRegResumeLimit, 60 * 60 * 1000);
      if (!limiter.allowed) {
        set.status = 429;
        return { success: false, error: "Too many attempts", code: "RATE_LIMIT_EXCEEDED" };
      }
      try {
        const body = raw as { email: string; password: string };
        const data = await partnerRegistrationService.resumeApplication(body);
        // An account that stopped before the OTP is sent a new one and goes back to that step.
        const awaitingOtp = "nextStep" in data && data.nextStep === "verify-otp";
        return { success: true, message: awaitingOtp ? "OTP sent to your phone. Verify it to continue your application." : "Application resumed", data };
      } catch (err) {
        return mapError(err, set);
      }
    },
    { body: t.Object({ email: t.String({ format: "email" }), password: t.String({ minLength: 8 }) }) },
  )
  .post(
    "/register/services",
    async ({ body: raw, request, set }) => {
      try {
        return await withRegistrationToken(request, async (session) => {
          const body = parseBody(partnerServicesSchema, raw, { city: { maxLen: 100 } });
          const data = await partnerRegistrationService.saveServices(session.userId, body);
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
          return {
            success: true,
            message: "Services saved",
            data: {
              ...data,
              registrationToken: partnerRegistrationSessionService.reissueToken(
                { ...session, providerId: data.providerId },
                expiresAt,
              ),
            },
          };
        });
      } catch (err) {
        return mapError(err, set);
      }
    },
    {
      body: t.Object({
        serviceCategories: t.Array(t.String()),
        city: t.String(),
        experienceYears: t.Number(),
      }),
    },
  )
  .post(
    "/register/kyc-details",
    async ({ body: raw, request, set }) => {
      try {
        return await withRegistrationToken(request, async (session) => {
          const providerId = await partnerRegistrationSessionService.requireProviderId(session);
          const body = parseBody(partnerKycSchema, raw, {
            bankAccountHolder: { maxLen: 100 },
            bankName: { maxLen: 100 },
          });
          const data = await partnerRegistrationService.saveKycDetails(session.userId, providerId, body);
          return { success: true, message: "KYC details saved", data };
        });
      } catch (err) {
        return mapError(err, set);
      }
    },
    {
      body: t.Object({
        panNumber: t.Optional(t.String()),
        aadharNumber: t.Optional(t.String()),
        bankAccountNumber: t.Optional(t.String()),
        bankAccountHolder: t.Optional(t.String()),
        ifscCode: t.Optional(t.String()),
        bankName: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/register/submit",
    async ({ request, set }) => {
      try {
        return await withRegistrationToken(
          request,
          async (session) => {
            const providerId = await partnerRegistrationSessionService.requireProviderId(session);
            const data = await partnerRegistrationService.submit(session.userId, providerId);
            return {
              success: true,
              message: data.alreadySubmitted
                ? "Application already submitted. Waiting for admin approval."
                : "Registration submitted. Waiting for admin approval.",
              data,
            };
          },
          { allowCompleted: true },
        );
      } catch (err) {
        return mapError(err, set);
      }
    },
  )
  .get("/registration-status", async ({ request, set }) => {
    try {
      return await withRegistrationToken(
        request,
        async (session) => {
          const providerId = await partnerRegistrationSessionService.requireProviderId(session);
          const data = await partnerRegistrationService.getRegistrationStatus(session.userId, providerId);
          return { success: true, data };
        },
        { allowCompleted: true },
      );
    } catch (err) {
      return mapError(err, set);
    }
  })
  .post(
    "/documents/upload",
    async ({ body: raw, request, set }) => {
      try {
        return await withRegistrationToken(request, async (session) => {
          const providerId = await partnerRegistrationSessionService.requireProviderId(session);
          const body = parseBody(documentUploadSchema, raw);
          const base64 = body.file.includes(",") ? body.file.split(",")[1]! : body.file;
          const buffer = Buffer.from(base64, "base64");
          const fileName = sanitizeUserInput(body.fileName || `${body.documentType}.pdf`, 255);
          const result = await documentUploadService.uploadDocument(
            providerId,
            session.userId,
            buffer,
            fileName,
            sanitizeUserInput(body.documentType, 80),
            {
              expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
              issuer: body.issuer ? sanitizeUserInput(body.issuer, 120) : null,
              issueDate: body.issueDate ? new Date(body.issueDate) : null,
            },
          );
          return {
            success: true,
            message: "Document uploaded",
            data: { documentId: result.documentId },
          };
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        if (msg.startsWith("FORBIDDEN:")) return mapError(err, set);
        if (msg.startsWith("INVALID_FILE_TYPE:") || msg.includes("maximum size")) {
          set.status = 400;
          return { success: false, error: msg.replace(/^INVALID_FILE_TYPE:/, ""), code: "INVALID_FILE_TYPE" };
        }
        set.status = msg.includes("not found") ? 404 : 500;
        return { success: false, error: msg, code: "UPLOAD_FAILED" };
      }
    },
    {
      body: t.Object({
        file: t.String(),
        documentType: t.String(),
        fileName: t.Optional(t.String()),
        expiryDate: t.Optional(t.String()),
        issuer: t.Optional(t.String()),
        issueDate: t.Optional(t.String()),
      }),
    },
  )
  .get("/documents", async ({ request, set }) => {
    try {
      return await withRegistrationToken(request, async (session) => {
        const providerId = await partnerRegistrationSessionService.requireProviderId(session);
        const documents = await documentUploadService.listDocuments(providerId, session.userId);
        return { success: true, data: { documents } };
      });
    } catch (err) {
      return mapError(err, set);
    }
  })
  .delete("/documents/:documentId", async ({ params: raw, request, set }) => {
    try {
      return await withRegistrationToken(request, async (session) => {
        const params = validate(documentIdParamSchema, raw);
        await documentUploadService.deleteDocument(params.documentId, session.userId);
        return { success: true, message: "Document deleted" };
      });
    } catch (err) {
      return mapError(err, set);
    }
  })
  .get("/onboarding/progress", async ({ request, set }) => {
    try {
      return await withRegistrationToken(
        request,
        async (session) => {
          const data = await partnerOnboardingService.getProgress(session.userId);
          return { success: true, data };
        },
        { allowCompleted: true },
      );
    } catch (err) {
      return mapError(err, set);
    }
  })
  .post(
    "/onboarding/profile",
    async ({ body: raw, request, set }) => {
      try {
        return await withRegistrationToken(request, async (session) => {
          const providerId = await partnerRegistrationSessionService.requireProviderId(session);
          const body = raw as Record<string, string | undefined>;
          const data = await partnerOnboardingService.saveProfile(session.userId, providerId, body);
          return { success: true, data };
        });
      } catch (err) {
        return mapError(err, set);
      }
    },
    {
      body: t.Object({
        dateOfBirth: t.Optional(t.String()),
        gender: t.Optional(t.String()),
        emergencyContactName: t.Optional(t.String()),
        emergencyContactPhone: t.Optional(t.String()),
        bio: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/onboarding/skills",
    async ({ body: raw, request, set }) => {
      try {
        return await withRegistrationToken(request, async (session) => {
          const providerId = await partnerRegistrationSessionService.requireProviderId(session);
          const body = raw as {
            primarySkill: string;
            secondarySkills?: string[];
            experienceYears: number;
            certifications?: string[];
          };
          const data = await partnerOnboardingService.saveSkills(session.userId, providerId, body);
          return { success: true, data };
        });
      } catch (err) {
        return mapError(err, set);
      }
    },
    {
      body: t.Object({
        primarySkill: t.String(),
        secondarySkills: t.Optional(t.Array(t.String())),
        experienceYears: t.Number(),
        certifications: t.Optional(t.Array(t.String())),
      }),
    },
  )
  .post(
    "/onboarding/location",
    async ({ body: raw, request, set }) => {
      try {
        return await withRegistrationToken(request, async (session) => {
          const providerId = await partnerRegistrationSessionService.requireProviderId(session);
          const body = raw as {
            city: string;
            serviceRegions: string[];
            serviceRadiusKm: number;
            baseLatitude?: number;
            baseLongitude?: number;
          };
          const data = await partnerOnboardingService.saveLocation(session.userId, providerId, body);
          return { success: true, data };
        });
      } catch (err) {
        return mapError(err, set);
      }
    },
    {
      body: t.Object({
        city: t.String(),
        serviceRegions: t.Array(t.String()),
        serviceRadiusKm: t.Number(),
        baseLatitude: t.Optional(t.Number()),
        baseLongitude: t.Optional(t.Number()),
      }),
    },
  )
  .post(
    "/onboarding/availability",
    async ({ body: raw, request, set }) => {
      try {
        return await withRegistrationToken(request, async (session) => {
          const providerId = await partnerRegistrationSessionService.requireProviderId(session);
          const body = raw as {
            workingHoursStart?: string;
            workingHoursEnd?: string;
            workingDays?: string[];
          };
          const data = await partnerOnboardingService.saveAvailability(session.userId, providerId, body);
          return { success: true, data };
        });
      } catch (err) {
        return mapError(err, set);
      }
    },
    {
      body: t.Object({
        workingHoursStart: t.Optional(t.String()),
        workingHoursEnd: t.Optional(t.String()),
        workingDays: t.Optional(t.Array(t.String())),
      }),
    },
  )
  .post(
    "/onboarding/documents",
    async ({ body, request, set }) => {
      try {
        return await withRegistrationToken(request, async (session) => {
          const providerId = await partnerRegistrationSessionService.requireProviderId(session);
          const uploadedTypes = Array.isArray(body?.uploadedTypes)
            ? (body.uploadedTypes as string[])
            : [];
          const data = await partnerOnboardingService.completeDocuments(
            session.userId,
            providerId,
            uploadedTypes,
          );
          return { success: true, data };
        });
      } catch (err) {
        return mapError(err, set);
      }
    },
    { body: t.Object({ uploadedTypes: t.Optional(t.Array(t.String())) }) },
  )
  .get("/onboarding/assessment", async ({ query, request, set }) => {
    try {
      return await withRegistrationToken(request, async (session) => {
        const providerId = await partnerRegistrationSessionService.requireProviderId(session);
        const prisma = (await import("../lib/prisma")).default;
        const provider = await prisma.provider.findUnique({
          where: { id: providerId },
          select: { primarySkill: true },
        });
        const skill =
          typeof query.skill === "string" && query.skill.length > 0
            ? query.skill
            : provider?.primarySkill ?? "general";
        const data = partnerOnboardingService.getAssessmentQuestions(skill);
        return { success: true, data };
      });
    } catch (err) {
      return mapError(err, set);
    }
  })
  .post(
    "/onboarding/assessment",
    async ({ body: raw, request, set }) => {
      try {
        return await withRegistrationToken(request, async (session) => {
          const providerId = await partnerRegistrationSessionService.requireProviderId(session);
          const body = raw as { skillSlug: string; answers: Record<string, string> };
          const data = await partnerOnboardingService.runAssessment(providerId, body.skillSlug, body.answers);
          if (data.passed) {
            await partnerOnboardingService.saveStep(
              session.userId,
              "assessment",
              { skillSlug: data.skillSlug, passed: true, score: data.score },
              providerId,
            );
          }
          return { success: true, data };
        });
      } catch (err) {
        return mapError(err, set);
      }
    },
    {
      body: t.Object({
        skillSlug: t.String(),
        answers: t.Record(t.String(), t.String()),
      }),
    },
  )
  .get("/onboarding/training", async ({ request, set }) => {
    try {
      return await withRegistrationToken(request, async (session) => {
        const providerId = await partnerRegistrationSessionService.requireProviderId(session);
        const data = await partnerOnboardingService.getTraining(providerId);
        return { success: true, data };
      });
    } catch (err) {
      return mapError(err, set);
    }
  })
  .post("/onboarding/training/:moduleId/complete", async ({ params, request, set }) => {
    try {
      return await withRegistrationToken(request, async (session) => {
        const providerId = await partnerRegistrationSessionService.requireProviderId(session);
        const data = await partnerOnboardingService.completeTrainingModule(
          session.userId,
          providerId,
          params.moduleId,
        );
        return { success: true, data };
      });
    } catch (err) {
      return mapError(err, set);
    }
  })
  .post("/onboarding/training/acknowledge", async ({ request, set }) => {
    try {
      return await withRegistrationToken(request, async (session) => {
        const providerId = await partnerRegistrationSessionService.requireProviderId(session);
        const data = await partnerOnboardingService.acknowledgeTraining(session.userId, providerId);
        return { success: true, data };
      });
    } catch (err) {
      return mapError(err, set);
    }
  })
  .get("/onboarding/review", async ({ request, set }) => {
    try {
      return await withRegistrationToken(request, async (session) => {
        const providerId = await partnerRegistrationSessionService.requireProviderId(session);
        const data = await partnerOnboardingService.getReview(session.userId, providerId);
        return { success: true, data };
      });
    } catch (err) {
      return mapError(err, set);
    }
  })
  .post("/onboarding/review/acknowledge", async ({ request, set }) => {
    try {
      return await withRegistrationToken(request, async (session) => {
        const providerId = await partnerRegistrationSessionService.requireProviderId(session);
        const data = await partnerOnboardingService.acknowledgeReview(session.userId, providerId);
        return { success: true, data };
      });
    } catch (err) {
      return mapError(err, set);
    }
  })
  .get("/onboarding/geo/config", async ({ request, set }) => {
    try {
      return await withRegistrationToken(request, async () => {
        const { mapsService } = await import("../services/maps.service");
        return { success: true, data: { mapsConfigured: mapsService.isConfigured } };
      });
    } catch (err) {
      return mapError(err, set);
    }
  })
  .get("/onboarding/geo/reverse", async ({ query, request, set }) => {
    try {
      return await withRegistrationToken(request, async (session) => {
        const { mapsService } = await import("../services/maps.service");
        const { geofenceService } = await import("../services/geofence.service");
        const lat = Number(query.lat);
        const lng = Number(query.lng);
        if (!mapsService.isWithinIndia(lat, lng)) {
          set.status = 400;
          return { success: false, error: "Coordinates outside the service area", code: "OUT_OF_AREA" };
        }
        const limiter = await consumeRateLimitSmart(`partner-geo-rev:${session.userId}`, 60, 60_000);
        if (!limiter.allowed) {
          set.status = 429;
          return { success: false, error: "Too many requests", code: "RATE_LIMITED" };
        }
        const address = await mapsService.reverseGeocode(lat, lng);
        const zones = await geofenceService.findContaining(lat, lng).catch(() => []);
        return {
          success: true,
          data: {
            available: mapsService.isConfigured,
            address,
            coverageZones: zones.slice(0, 8).map((z) => ({
              id: z.id,
              name: z.name,
              zoneType: z.zoneType,
              city: z.city,
            })),
          },
        };
      });
    } catch (err) {
      return mapError(err, set);
    }
  })
  .get("/onboarding/geo/autocomplete", async ({ query, request, set }) => {
    try {
      return await withRegistrationToken(request, async (session) => {
        const { mapsService } = await import("../services/maps.service");
        const q = String(query.q ?? "").trim();
        if (q.length < 3) return { success: true, data: { predictions: [] } };
        const limiter = await consumeRateLimitSmart(`partner-geo-ac:${session.userId}`, 120, 60_000);
        if (!limiter.allowed) {
          set.status = 429;
          return { success: false, error: "Too many requests", code: "RATE_LIMITED" };
        }
        const predictions = await mapsService.autocomplete(q, {
          sessionToken: typeof query.session === "string" ? query.session : undefined,
        });
        return { success: true, data: { available: mapsService.isConfigured, predictions } };
      });
    } catch (err) {
      return mapError(err, set);
    }
  })
  .get("/onboarding/geo/place/:placeId", async ({ params, request, set }) => {
    try {
      return await withRegistrationToken(request, async () => {
        const { mapsService } = await import("../services/maps.service");
        const place = await mapsService.placeDetails(params.placeId);
        return { success: Boolean(place), data: place };
      });
    } catch (err) {
      return mapError(err, set);
    }
  })
  .get("/onboarding/geo/search", async ({ query, request, set }) => {
    try {
      return await withRegistrationToken(request, async (session) => {
        const { mapsService } = await import("../services/maps.service");
        const q = String(query.q ?? "").trim();
        if (q.length < 3) return { success: true, data: null };
        const limiter = await consumeRateLimitSmart(`partner-geo-fwd:${session.userId}`, 60, 60_000);
        if (!limiter.allowed) {
          set.status = 429;
          return { success: false, error: "Too many requests", code: "RATE_LIMITED" };
        }
        const address = await mapsService.geocode(q);
        return { success: true, data: { available: mapsService.isConfigured, address } };
      });
    } catch (err) {
      return mapError(err, set);
    }
  });
