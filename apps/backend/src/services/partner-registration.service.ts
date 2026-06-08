import type { PartnerRegistrationStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { OTPService } from "./otp.service";
import { PasswordService } from "./password.service";
import { kycVerificationService } from "./kyc-verification.service";
import {
  assertProviderKycUnique,
  encryptProviderKycFields,
} from "./sensitive-data.service";
import { sanitizeUserInput } from "../utils/sanitizer";
import { partnerRegistrationSessionService } from "./partner-registration-session.service";

const otpService = new OTPService(prisma);

const indiaPhoneRegex = /^\+91\d{10}$/;

function formatPhoneE164(local: string): string {
  const digits = local.replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length >= 12) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  return local.startsWith("+") ? local : `+${digits}`;
}

function statusMessage(status: PartnerRegistrationStatus): string {
  const messages: Record<PartnerRegistrationStatus, string> = {
    PENDING: "Your application is under review. We'll notify you soon.",
    APPROVED: "Your application is approved! You can now log in.",
    REJECTED: "Your application was not approved. See the reason above.",
  };
  return messages[status] ?? "Unknown status";
}

export class PartnerRegistrationService {
  async step1(input: {
    email: string;
    phoneNumber: string;
    firstName: string;
    lastName: string;
    password: string;
    confirmPassword: string;
  }) {
    if (input.password !== input.confirmPassword) {
      throw new Error("VALIDATION:Passwords do not match");
    }

    const phone = formatPhoneE164(input.phoneNumber);
    if (!indiaPhoneRegex.test(phone)) {
      throw new Error("VALIDATION:Enter a valid 10-digit Indian mobile number");
    }

    const passwordCheck = PasswordService.validatePasswordStrength(input.password);
    if (!passwordCheck.isValid) {
      throw new Error(`VALIDATION:${passwordCheck.errors.join(", ")}`);
    }

    const email = input.email.toLowerCase();
    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail) throw new Error("CONFLICT:Email already registered");

    const existingPhone = await prisma.user.findUnique({ where: { phoneNumber: phone } });
    if (existingPhone) throw new Error("CONFLICT:Phone number already registered");

    const hashedPassword = await PasswordService.hashPassword(input.password);
    const user = await prisma.user.create({
      data: {
        email,
        phoneNumber: phone,
        firstName: sanitizeUserInput(input.firstName, 50),
        lastName: sanitizeUserInput(input.lastName, 50),
        password: hashedPassword,
        role: "VENDOR",
      },
    });
    await prisma.passwordHistory.create({
      data: { userId: user.id, passwordHash: hashedPassword },
    });

    const otpResult = await otpService.sendOTP(phone, user.id);
    if (!otpResult.success) {
      throw new Error(`OTP:${otpResult.message}`);
    }

    await this.logEmail({
      to: email,
      emailType: "registration_otp",
      subject: "Your OTP for HOMIGO Partner Registration",
      content: JSON.stringify({ phone, userId: user.id }),
    });

    return {
      userId: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      step: 1,
      nextStep: "verify-otp",
      devOtp: "devOtp" in otpResult ? otpResult.devOtp : undefined,
    };
  }

  async verifyOtp(input: { email: string; otp: string; userId: string }) {
    const user = await prisma.user.findUnique({ where: { id: input.userId } });
    if (!user || user.email !== input.email.toLowerCase()) {
      throw new Error("NOT_FOUND:User not found");
    }

    const otpOk = await otpService.verifyOTP(user.phoneNumber, input.otp);
    if (!otpOk.isValid) {
      throw new Error(`OTP:${otpOk.error ?? "Invalid or expired OTP"}`);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        isPhoneVerified: true,
        phoneVerifiedAt: new Date(),
      },
    });

    const { session, registrationToken } =
      await partnerRegistrationSessionService.createOrRefreshAfterOtp(user.id);

    return {
      userId: user.id,
      nextStep: "services",
      registrationToken,
      sessionId: session.sessionId,
    };
  }

  async saveServices(
    sessionUserId: string,
    input: {
      serviceCategories: string[];
      city: string;
      experienceYears: number;
    },
  ) {
    const user = await prisma.user.findUnique({ where: { id: sessionUserId } });
    if (!user) throw new Error("NOT_FOUND:User not found");
    if (user.role !== "VENDOR") throw new Error("FORBIDDEN:Invalid registration user");

    if (!input.serviceCategories.length) {
      throw new Error("VALIDATION:Select at least one service");
    }
    if (!input.city?.trim()) {
      throw new Error("VALIDATION:City is required");
    }

    const provider = await prisma.provider.upsert({
      where: { userId: sessionUserId },
      update: {
        serviceCategories: input.serviceCategories,
        serviceRegions: [input.city],
        city: input.city,
        experienceYears: input.experienceYears,
      },
      create: {
        userId: sessionUserId,
        serviceCategories: input.serviceCategories,
        serviceRegions: [input.city],
        city: input.city,
        experienceYears: input.experienceYears,
        registrationStatus: "PENDING",
        isApproved: false,
      },
    });

    const session = await prisma.partnerRegistrationSession.findUnique({
      where: { userId: sessionUserId },
    });
    if (session) {
      await partnerRegistrationSessionService.bindProvider(session.id, sessionUserId, provider.id);
    }

    return { providerId: provider.id, nextStep: "kyc-details" };
  }

  async saveKycDetails(
    sessionUserId: string,
    providerId: string,
    input: {
      panNumber?: string;
      aadharNumber?: string;
      bankAccountNumber?: string;
      bankAccountHolder?: string;
      ifscCode?: string;
      bankName?: string;
    },
  ) {
    const provider = await prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) throw new Error("NOT_FOUND:Provider not found");
    if (provider.userId !== sessionUserId) throw new Error("FORBIDDEN:You do not own this provider registration");

    const kyc = await kycVerificationService.verifyKYC(
      input.panNumber?.trim() || undefined,
      input.aadharNumber?.trim() || undefined,
    );
    if (!kyc.verified) {
      throw new Error(`VALIDATION:${kyc.errors.join("; ")}`);
    }

    await assertProviderKycUnique(providerId, {
      panNumber: input.panNumber,
      aadharNumber: input.aadharNumber,
      bankAccountNumber: input.bankAccountNumber,
    });

    const encrypted = encryptProviderKycFields({
      panNumber: input.panNumber,
      aadharNumber: input.aadharNumber,
      bankAccountNumber: input.bankAccountNumber,
      bankAccountHolder: input.bankAccountHolder,
      bankIfscCode: input.ifscCode,
      bankName: input.bankName,
    });

    const updated = await prisma.provider.update({
      where: { id: providerId },
      data: encrypted,
    });

    return { providerId: updated.id, nextStep: "documents" };
  }

  async submit(sessionUserId: string, providerId: string) {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      include: { user: true },
    });
    if (!provider) throw new Error("NOT_FOUND:Provider not found");
    if (provider.userId !== sessionUserId) throw new Error("FORBIDDEN:You do not own this provider registration");

    const updated = await prisma.provider.update({
      where: { id: providerId },
      data: {
        registrationStatus: "PENDING",
        registeredAt: new Date(),
        backgroundCheckStatus: "PENDING",
      },
    });

    await prisma.partnerBackgroundCheck.upsert({
      where: { providerId },
      create: { providerId, status: "PENDING" },
      update: { status: "PENDING" },
    });

    await this.logEmail({
      to: process.env.ADMIN_EMAIL || "admin@homigo.com",
      emailType: "new_partner_registration",
      subject: `New Partner Registration: ${provider.user.firstName} ${provider.user.lastName}`,
      content: JSON.stringify({
        providerId,
        name: `${provider.user.firstName} ${provider.user.lastName}`,
        email: provider.user.email,
        services: provider.serviceCategories,
        city: provider.city,
      }),
    });

    const session = await prisma.partnerRegistrationSession.findUnique({
      where: { userId: sessionUserId },
    });
    if (session) await partnerRegistrationSessionService.completeSession(session.id);

    return {
      providerId: updated.id,
      status: updated.registrationStatus,
      estimatedApprovalTime: "1-2 business days",
    };
  }

  async getRegistrationStatus(sessionUserId: string, providerId: string) {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      include: {
        documents: {
          orderBy: { uploadedAt: "desc" },
          select: {
            id: true,
            documentType: true,
            documentName: true,
            uploadStatus: true,
            uploadedAt: true,
          },
        },
        partnerBackgroundCheck: true,
        user: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    if (!provider) throw new Error("NOT_FOUND:Provider not found");
    if (provider.userId !== sessionUserId) throw new Error("FORBIDDEN:You do not own this provider registration");

    return {
      status: provider.registrationStatus,
      isApproved: provider.isApproved,
      registeredAt: provider.registeredAt,
      partnerApprovedAt: provider.partnerApprovedAt,
      rejectionReason: provider.rejectionReason,
      documents: provider.documents,
      backgroundCheck: provider.partnerBackgroundCheck,
      message: statusMessage(provider.registrationStatus),
    };
  }

  async assertPartnerCanLogin(userId: string): Promise<string | null> {
    const provider = await prisma.provider.findUnique({ where: { userId } });
    if (!provider) return null;
    // Legacy partners approved before self-registration used isApproved only.
    if (provider.isApproved) return null;
    if (provider.registrationStatus === "APPROVED") return null;
    if (provider.registrationStatus === "REJECTED") {
      return provider.rejectionReason ?? "Your partner application was rejected.";
    }
    return "Your partner application is pending admin approval. You'll be notified when approved.";
  }

  private async logEmail(args: {
    to: string;
    emailType: string;
    subject: string;
    content: string;
  }) {
    await prisma.emailLog.create({
      data: {
        to: args.to,
        emailType: args.emailType,
        subject: args.subject,
        content: args.content,
        status: "logged",
      },
    });
  }
}

export const partnerRegistrationService = new PartnerRegistrationService();
