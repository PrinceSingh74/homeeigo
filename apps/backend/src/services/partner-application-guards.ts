export function isApplicationAlreadySubmitted(provider: {
  registeredAt: Date | null;
  registrationStatus: string;
}): boolean {
  return Boolean(provider.registeredAt) && provider.registrationStatus !== "CHANGES_REQUESTED";
}
