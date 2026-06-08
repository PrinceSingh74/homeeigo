import { Elysia, t } from "elysia";
import { consumeRateLimitSmart } from "../middleware/rate-limit.middleware";
import { parseBody } from "../lib/route-security";
import {
  partnerKycSchema,
  partnerRegisterStep1Schema,
  partnerServicesSchema,
  partnerVerifyOtpSchema,
  normalizePartnerPhone,
  indiaPhoneSchema,
} from "../schemas/partner.schema";
import { partnerRegistrationService } from "../services/partner-registration.service";
import { documentUploadService } from "../services/document-upload.service";
import { partnerRegistrationSessionService } from "../services/partner-registration-session.service";
import { requireRegistrationSession } from "../middleware/partner-registration-auth.middleware";
import { validate, ValidationFailedError } from "../middleware/validation.middleware";
import { sanitizeUserInput } from "../utils/sanitizer";
import { z } from "zod";

const documentIdParamSchema = z.object({ documentId: z.string().trim().min(1) });

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

const getIp = (request: Request) =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  request.headers.get("x-real-ip") ||
  "unknown";

const documentUploadSchema = z.object({
  file: z.string().min(1),
  documentType: z.string().trim().min(1).max(80),
  fileName: z.string().trim().max(255).optional(),
});

async function withRegistrationToken(
  request: Request,
  handler: (session: Awaited<ReturnType<typeof requireRegistrationSession>>) => Promise<unknown>,
) {
  const session = await requireRegistrationSession(request);
  return handler(session);
}

export const partnerRegisterRoutes = new Elysia({ prefix: "/api/partner" })
  .post(
    "/register/step1",
    async ({ body: raw, request, set }) => {
      const ip = getIp(request);
      const limiter = await consumeRateLimitSmart(`partner-reg:${ip}`, 15, 60 * 60 * 1000);
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
    async ({ body: raw, set }) => {
      try {
        const body = parseBody(partnerVerifyOtpSchema, raw);
        const data = await partnerRegistrationService.verifyOtp(body);
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
      }),
    },
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
        return await withRegistrationToken(request, async (session) => {
          const providerId = await partnerRegistrationSessionService.requireProviderId(session);
          const data = await partnerRegistrationService.submit(session.userId, providerId);
          return {
            success: true,
            message: "Registration submitted. Waiting for admin approval.",
            data,
          };
        });
      } catch (err) {
        return mapError(err, set);
      }
    },
  )
  .get("/registration-status", async ({ request, set }) => {
    try {
      return await withRegistrationToken(request, async (session) => {
        const providerId = await partnerRegistrationSessionService.requireProviderId(session);
        const data = await partnerRegistrationService.getRegistrationStatus(session.userId, providerId);
        return { success: true, data };
      });
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
          );
          return {
            success: true,
            message: "Document uploaded",
            data: result,
          };
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        if (msg.startsWith("FORBIDDEN:")) return mapError(err, set);
        set.status = msg.includes("not found") ? 404 : 500;
        return { success: false, error: msg, code: "UPLOAD_FAILED" };
      }
    },
    {
      body: t.Object({
        file: t.String(),
        documentType: t.String(),
        fileName: t.Optional(t.String()),
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
  });
