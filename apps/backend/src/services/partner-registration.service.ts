import type { PartnerRegistrationStatus } from "@prisma/client";
import { provenanceForNewUser } from "../lib/data-provenance";
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
import { userPiiService } from "./user-pii.service";
import { emailDeliveryService } from "./email-delivery.service";
import { partnerAcquisitionEvents } from "./partner-acquisition-events.service";
import { partnerLeadService } from "./partner-lead.service";
import { partnerOnboardingService } from "./partner-onboarding.service";
import { PartnerRegistrationSessionStatus } from "@prisma/client";
import { assertLeadInviteUsable, verifyPartnerLeadInvite } from "./partner-application-invite";
import { isApplicationAlreadySubmitted } from "./partner-application-guards";
import type { FraudContext } from "../lib/fraud-context";

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
    CHANGES_REQUESTED:
      "Our team requested updates to your application. Sign in to continue from the step noted in your email.",
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
    if (await userPiiService.emailExists(email)) throw new Error("CONFLICT:Email already registered");
    if (await userPiiService.phoneExists(phone)) throw new Error("CONFLICT:Phone number already registered");

    const hashedPassword = await PasswordService.hashPassword(input.password);
    const user = await prisma.user.create({
      data: {
        ...provenanceForNewUser(email),
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
      subject: "Your OTP for HOMEEIGO Partner Registration",
      content: JSON.stringify({ phone, userId: user.id }),
    });

    const contact = await userPiiService.resolveEmailAndPhone(user, { actorId: user.id });
    return {
      userId: user.id,
      email: contact.email,
      phoneNumber: contact.phoneNumber,
      step: 1,
      nextStep: "verify-otp",
      devOtp: "devOtp" in otpResult ? otpResult.devOtp : undefined,
    };
  }

  async verifyOtp(input: {
    email: string;
    otp: string;
    userId: string;
    inviteToken?: string;
    referralCode?: string;
    ctx?: FraudContext;
  }) {
    const user = await prisma.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new Error("NOT_FOUND:User not found");
    const userEmail = await userPiiService.resolveEmail(user, { actorId: user.id, authorized: true });
    if (!userEmail || userEmail !== input.email.toLowerCase()) {
      throw new Error("NOT_FOUND:User not found");
    }

    const userPhone = await userPiiService.resolvePhone(user, { actorId: user.id, authorized: true });
    if (!userPhone) throw new Error("NOT_FOUND:User not found");
    const otpOk = await otpService.verifyOTP(userPhone, input.otp);
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

    let inviteLeadId: string | null = null;
    if (input.inviteToken) {
      const invite = verifyPartnerLeadInvite(input.inviteToken);
      const lead = await prisma.partnerLead.findUnique({ where: { id: invite.leadId } });
      if (!lead) throw new Error("NOT_FOUND:Application invite is no longer valid");
      assertLeadInviteUsable(lead, user.id);
      const leadDigits = lead.phone.replace(/\D/g, "").slice(-10);
      const userDigits = (userPhone ?? "").replace(/\D/g, "").slice(-10);
      if (leadDigits && userDigits && leadDigits !== userDigits) {
        throw new Error("VALIDATION:This invite is for a different mobile number");
      }
      inviteLeadId = lead.id;
    }

    const { session, registrationToken } =
      await partnerRegistrationSessionService.createOrRefreshAfterOtp(user.id, inviteLeadId);

    await partnerRegistrationSessionService.markStepComplete(user.id, "otp");

    const { partnerReferralService } = await import("./partner-referral.service");
    void partnerReferralService
      .claimOnRegistration({
        refereeUserId: user.id,
        referralCode: input.referralCode,
        inviteLeadId,
        ctx: input.ctx,
      })
      .catch(() => undefined);

    return {
      userId: user.id,
      nextStep: "services",
      registrationToken,
      sessionId: session.sessionId,
      leadId: inviteLeadId,
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
    const alreadyHadProvider = Boolean(session?.providerId);
    if (session) {
      await partnerRegistrationSessionService.bindProvider(session.id, sessionUserId, provider.id);
      await partnerRegistrationSessionService.markStepComplete(sessionUserId, "services");
    }

    const lead = session?.leadId
      ? await prisma.partnerLead.findUnique({ where: { id: session.leadId } })
      : user.phoneHash
        ? await prisma.partnerLead.findFirst({ where: { phoneHash: user.phoneHash, providerId: null } })
        : null;
    if (lead) {
      await partnerLeadService.linkApplication(lead.id, sessionUserId, provider.id);
    }

    if (!alreadyHadProvider) {
      await partnerAcquisitionEvents.emitApplicationStarted(provider.id, sessionUserId, lead?.id);
      const { partnerReferralService } = await import("./partner-referral.service");
      void partnerReferralService.bindProvider(provider.id, sessionUserId).catch(() => undefined);
    }

    return { providerId: provider.id, nextStep: "profile" };
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

    await partnerRegistrationSessionService.markStepComplete(sessionUserId, "kyc");
    await partnerAcquisitionEvents.emitKycSubmitted(providerId);
    const { partnerReferralService } = await import("./partner-referral.service");
    void partnerReferralService.bindProvider(providerId, sessionUserId).then(() =>
      partnerReferralService.syncFromCanonical(providerId),
    ).catch(() => undefined);

    return { providerId: updated.id, nextStep: "documents" };
  }

  async submit(sessionUserId: string, providerId: string) {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      include: { user: true },
    });
    if (!provider) throw new Error("NOT_FOUND:Provider not found");
    if (provider.userId !== sessionUserId) throw new Error("FORBIDDEN:You do not own this provider registration");

    if (isApplicationAlreadySubmitted(provider)) {
      await this.ensureSessionCompleted(sessionUserId);
      return {
        providerId: provider.id,
        status: provider.registrationStatus,
        estimatedApprovalTime: "1-2 business days",
        alreadySubmitted: true,
      };
    }

    const passedAssessment = await prisma.partnerAssessment.findFirst({
      where: { providerId, status: "PASSED" },
    });
    if (!passedAssessment) {
      throw new Error("VALIDATION:Pass the skill assessment before submitting your application");
    }

    const claimed = await prisma.provider.updateMany({
      where: {
        id: providerId,
        userId: sessionUserId,
        OR: [{ registeredAt: null }, { registrationStatus: "CHANGES_REQUESTED" }],
      },
      data: {
        registrationStatus: "PENDING",
        registeredAt: new Date(),
        backgroundCheckStatus: "PENDING",
        changesRequestedAt: null,
        changesRequestedStep: null,
        changesRequestedNotes: null,
      },
    });

    if (claimed.count === 0) {
      const current = await prisma.provider.findUnique({ where: { id: providerId } });
      if (current && isApplicationAlreadySubmitted(current)) {
        await this.ensureSessionCompleted(sessionUserId);
        return {
          providerId: current.id,
          status: current.registrationStatus,
          estimatedApprovalTime: "1-2 business days",
          alreadySubmitted: true,
        };
      }
      throw new Error("CONFLICT:Application could not be submitted. Please retry.");
    }

    const updated = await prisma.provider.findUnique({ where: { id: providerId } });
    if (!updated) throw new Error("NOT_FOUND:Provider not found");

    await prisma.partnerBackgroundCheck.upsert({
      where: { providerId },
      create: { providerId, status: "PENDING" },
      update: { status: "PENDING" },
    });

    const adminEmail = process.env.ADMIN_EMAIL || "admin@homigo.com";
    emailDeliveryService.sendAdminAlert(
      adminEmail,
      `New Partner Registration: ${provider.user.firstName} ${provider.user.lastName}`,
      `Provider ${providerId} submitted registration from ${provider.city ?? "unknown city"}.`,
    );

    const session = await prisma.partnerRegistrationSession.findUnique({
      where: { userId: sessionUserId },
    });
    if (session) {
      await partnerRegistrationSessionService.completeSession(session.id);
      await partnerRegistrationSessionService.markStepComplete(sessionUserId, "submit");
    }

    const lead = await prisma.partnerLead.findFirst({ where: { providerId } });
    if (lead) {
      await partnerLeadService.transitionStatus(lead.id, "APPLICATION_SUBMITTED", sessionUserId, {
        reason: "Application submitted",
      }).catch(() => undefined);
    }

    await partnerAcquisitionEvents.emitApplicationSubmitted(providerId, sessionUserId, lead?.id);

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

  async resumeApplication(input: { email: string; password: string }) {
    const email = input.email.toLowerCase().trim();
    const user = await userPiiService.findByEmail(email);
    if (!user) throw new Error("NOT_FOUND:No application found for this email");

    const valid = await PasswordService.comparePassword(input.password, user.password);
    if (!valid) throw new Error("FORBIDDEN:Invalid email or password");
    if (user.role !== "VENDOR") throw new Error("FORBIDDEN:Not a partner application account");

    const session = await prisma.partnerRegistrationSession.findUnique({ where: { userId: user.id } });
    if (!session || !session.otpVerified) {
      throw new Error("NOT_FOUND:Complete phone verification to start your application");
    }

    if (session.providerId) {
      const provider = await prisma.provider.findUnique({ where: { id: session.providerId } });
      if (provider?.registrationStatus === "CHANGES_REQUESTED") {
        // Applicant sent back by HQ — reopen and resume at the requested step.
      } else if (
        isApplicationAlreadySubmitted({
          registeredAt: provider?.registeredAt ?? null,
          registrationStatus: provider?.registrationStatus ?? "PENDING",
        }) ||
        session.status === PartnerRegistrationSessionStatus.COMPLETED
      ) {
        const progress = await partnerOnboardingService.getProgress(user.id);
        return {
          userId: user.id,
          email,
          ...progress,
        };
      }
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.partnerRegistrationSession.update({
      where: { id: session.id },
      data: {
        status: PartnerRegistrationSessionStatus.ACTIVE,
        expiresAt,
      },
    });

    const ctx = {
      sessionId: session.id,
      userId: session.userId,
      providerId: session.providerId,
      otpVerified: session.otpVerified,
    };
    const registrationToken = partnerRegistrationSessionService.reissueToken(ctx, expiresAt);
    const progress = await partnerOnboardingService.getProgress(user.id);

    return {
      userId: user.id,
      email,
      registrationToken,
      ...progress,
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
    if (provider.registrationStatus === "CHANGES_REQUESTED") {
      const step = provider.changesRequestedStep
        ? ` Please update ${provider.changesRequestedStep.replace(/_/g, " ")}.`
        : "";
      return (provider.changesRequestedNotes ?? "Our team requested updates to your application.") + step;
    }
    return "Your partner application is pending admin approval. You'll be notified when approved.";
  }

  private async ensureSessionCompleted(sessionUserId: string) {
    const session = await prisma.partnerRegistrationSession.findUnique({
      where: { userId: sessionUserId },
    });
    if (!session) return;
    if (session.status !== PartnerRegistrationSessionStatus.COMPLETED) {
      await partnerRegistrationSessionService.completeSession(session.id);
    }
    await partnerRegistrationSessionService.markStepComplete(sessionUserId, "submit");
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
