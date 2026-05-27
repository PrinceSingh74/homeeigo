import bcryptjs from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";

export const PasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password too long")
  .regex(/[A-Z]/, "Password must contain uppercase letter")
  .regex(/[0-9]/, "Password must contain number")
  .regex(/[!@#$%^&*()_+\-=[\]{};:'",.<>/?]/, "Password must contain special character");

const COMMON_PASSWORDS = new Set([
  "password",
  "password123",
  "123456",
  "qwerty",
  "abc123",
  "admin",
  "letmein",
  "welcome",
  "monkey",
  "dragon",
  "123456789",
  "password1",
  "admin123",
  "letmein123",
]);

export class PasswordService {
  static async hashPassword(password: string): Promise<string> {
    return bcryptjs.hash(password, await bcryptjs.genSalt(12));
  }

  static comparePassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
    return bcryptjs.compare(plainPassword, hashedPassword);
  }

  static validatePasswordStrength(password: string): {
    isValid: boolean;
    errors: string[];
    strength: "weak" | "fair" | "good" | "strong";
  } {
    const errors: string[] = [];
    if (password.length < 8) errors.push("Password must be at least 8 characters");
    if (!/[A-Z]/.test(password)) errors.push("Password must contain uppercase letter (A-Z)");
    if (!/[0-9]/.test(password)) errors.push("Password must contain number (0-9)");
    if (!/[!@#$%^&*()_+\-=[\]{};:'",.<>/?]/.test(password))
      errors.push("Password must contain special character");
    if (COMMON_PASSWORDS.has(password.toLowerCase()))
      errors.push("Password is too common, please choose a stronger one");

    let strength: "weak" | "fair" | "good" | "strong" = "weak";
    if (password.length >= 11) strength = "fair";
    if (password.length >= 16) strength = "good";
    if (password.length >= 20 && errors.length === 0) strength = "strong";

    return { isValid: errors.length === 0, errors, strength };
  }

  static isSimilarToUsername(password: string, username: string): boolean {
    const p = password.toLowerCase();
    const u = username.toLowerCase();
    if (p.includes(u) || u.includes(p)) return true;
    const overlap = p.split("").filter((ch) => u.includes(ch)).length;
    return overlap / Math.max(1, Math.max(p.length, u.length)) > 0.5;
  }

  static async checkPasswordHistory(newPassword: string, passwordHistory: string[]): Promise<boolean> {
    for (const oldHash of passwordHistory.slice(0, 5)) {
      if (await this.comparePassword(newPassword, oldHash)) return true;
    }
    return false;
  }

  static generateTemporaryPassword(): string {
    const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const lowercase = "abcdefghijklmnopqrstuvwxyz";
    const numbers = "0123456789";
    const special = "!@#$%^&*";

    const required = [
      uppercase[crypto.randomInt(uppercase.length)],
      numbers[crypto.randomInt(numbers.length)],
      special[crypto.randomInt(special.length)],
    ];

    const all = uppercase + lowercase + numbers + special;
    for (let i = 0; i < 13; i++) required.push(all[crypto.randomInt(all.length)]);

    return required.sort(() => crypto.randomInt(3) - 1).join("");
  }

  static calculateStrengthScore(password: string): number {
    let score = 0;
    if (password.length >= 8) score += 5;
    if (password.length >= 12) score += 5;
    if (password.length >= 16) score += 5;
    if (password.length >= 20) score += 10;
    if (/[a-z]/.test(password)) score += 10;
    if (/[A-Z]/.test(password)) score += 10;
    if (/[0-9]/.test(password)) score += 10;
    if (/[!@#$%^&*()_+\-=[\]{};:'",.<>/?]/.test(password)) score += 20;
    const uniqueChars = new Set(password.toLowerCase()).size;
    if (uniqueChars >= 8) score += 15;
    if (uniqueChars >= 12) score += 10;
    return Math.min(score, 100);
  }
}
