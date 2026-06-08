/** Apple sign-in email must come from the verified id_token only. */
export function resolveAppleAccountEmail(
  decoded: { email?: string; sub: string } | null,
): string {
  const email = decoded?.email?.trim().toLowerCase();
  if (!email) {
    throw new Error("Email not provided by Apple");
  }
  return email;
}
