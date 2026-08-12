export function formatPhoneE164(local: string): string {
  const digits = local.replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length >= 12) return `+${digits}`;
  return `+91${digits}`;
}

export function formatPhoneDisplay(e164: string): string {
  return e164.replace(/^\+91/, "+91 ");
}
