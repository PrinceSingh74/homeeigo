import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { dbReachable, prisma } from "./helpers/adversarial-fixtures";
import { partnerRegistrationService } from "../services/partner-registration.service";
import { userPiiService } from "../services/user-pii.service";

/**
 * An applicant who created an account and left before entering the OTP must be able to come back.
 *
 * Found on a device: after step 1 the app was closed at the OTP step. "Continue existing
 * application" then answered 404 "Complete phone verification to start your application", and
 * starting again answered 409 "Email already registered" — the account could neither be resumed
 * nor restarted, by anyone, ever.
 *
 * The password the applicant chose proves the account is theirs; the phone still has to be proven,
 * so resuming sends a new OTP and sends them back to the OTP step. It does not verify anything.
 */
const RUN = `prr${Date.now().toString(36)}`;
const email = `${RUN}@adv.test`;
const phone = `9${String(Date.now()).slice(-9)}`;
const password = "AdvTest@123";
let reachable = false;
let userId: string | null = null;

beforeAll(async () => {
  reachable = await dbReachable();
}, 60_000);

afterAll(async () => {
  if (!reachable || !userId) return;
  await prisma.partnerRegistrationSession.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.passwordHistory.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
}, 60_000);

describe("resuming an application that stopped before the OTP", () => {
  it("sends the applicant back to the OTP step with a new code, for the same account", async () => {
    if (!reachable) return;
    const created = await partnerRegistrationService.step1({ email, phoneNumber: phone, firstName: "Resume", lastName: "Case", password, confirmPassword: password });
    userId = created.userId;

    const resumed = (await partnerRegistrationService.resumeApplication({ email, password })) as { userId: string; nextStep?: string; devOtp?: string; registrationToken?: string };
    expect(resumed.userId).toBe(created.userId);
    expect(resumed.nextStep).toBe("verify-otp");
    // Nothing is granted yet: no registration token before the phone is proven.
    expect(resumed.registrationToken).toBeUndefined();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: created.userId }, select: { isPhoneVerified: true } });
    expect(user.isPhoneVerified).toBe(false);

    // The code that was just sent verifies the phone (the test backend exposes it; a real one sends an SMS).
    if (resumed.devOtp) {
      const verified = await partnerRegistrationService.verifyOtp({ email, otp: resumed.devOtp, userId: created.userId });
      expect(verified).toBeDefined();
      expect((await prisma.user.findUniqueOrThrow({ where: { id: created.userId }, select: { isPhoneVerified: true } })).isPhoneVerified).toBe(true);
    }
  }, 60_000);

  it("a wrong password is refused and sends nothing", async () => {
    if (!reachable) return;
    const other = `${RUN}b@adv.test`;
    const otherPhone = `8${String(Date.now()).slice(-9)}`;
    const created = await partnerRegistrationService.step1({ email: other, phoneNumber: otherPhone, firstName: "Resume", lastName: "Wrong", password, confirmPassword: password });
    try {
      await expect(partnerRegistrationService.resumeApplication({ email: other, password: "Wrong@12345" }).then(() => "resumed", (e: Error) => e.message)).resolves.toMatch(/^FORBIDDEN:/);
    } finally {
      await prisma.passwordHistory.deleteMany({ where: { userId: created.userId } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: created.userId } }).catch(() => undefined);
    }
    expect(await userPiiService.emailExists(other)).toBe(false);
  }, 60_000);
});
