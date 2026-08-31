/** IFSC validation — matches partner-web WithdrawModal. */
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function maskAccountNumber(account: string): string {
  const digits = account.replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `•••• ${digits.slice(-4)}`;
}

export function formatPayoutStatus(status: string): string {
  const s = status.toUpperCase();
  if (s === "COMPLETED" || s === "SUCCESS") return "Success";
  if (s === "PROCESSING") return "Processing";
  if (s === "REQUESTED" || s === "APPROVED") return "Requested";
  if (s === "FAILED") return "Failed";
  if (s === "REVERSED") return "Reversed";
  if (s === "SETTLED") return "Settled";
  if (s === "CANCELLED") return "Cancelled";
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

export function validateWithdrawInput(opts: {
  amount: number;
  availableBalance: number;
  accountHolder: string;
  bankAccountNumber: string;
  ifscCode: string;
}): string | null {
  if (!Number.isFinite(opts.amount) || opts.amount <= 0) return "Enter a valid amount";
  if (!opts.accountHolder.trim()) return "Enter the account holder name";
  if (opts.bankAccountNumber.replace(/\D/g, "").length < 9) return "Enter a valid bank account number";
  if (!IFSC_REGEX.test(opts.ifscCode.trim().toUpperCase())) return "Enter a valid IFSC code";
  if (opts.amount > opts.availableBalance) {
    return `Amount cannot exceed available balance (₹${Math.floor(opts.availableBalance).toLocaleString("en-IN")})`;
  }
  return null;
}
