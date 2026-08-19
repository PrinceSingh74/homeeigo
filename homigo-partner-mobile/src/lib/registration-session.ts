import { deleteSecureItem, getSecureItem, setSecureItem } from "@/lib/secure-storage";

const STORAGE_KEY = "homigo_partner_registration_token";
const INVITE_KEY = "homigo_partner_application_invite";

export async function setRegistrationToken(token: string | null): Promise<void> {
  if (token) await setSecureItem(STORAGE_KEY, token);
  else await deleteSecureItem(STORAGE_KEY);
}

export async function getRegistrationToken(): Promise<string | null> {
  return getSecureItem(STORAGE_KEY);
}

export async function clearRegistrationToken(): Promise<void> {
  await deleteSecureItem(STORAGE_KEY);
}

export async function setApplicationInvite(token: string | null): Promise<void> {
  if (token) await setSecureItem(INVITE_KEY, token);
  else await deleteSecureItem(INVITE_KEY);
}

export async function getApplicationInvite(): Promise<string | null> {
  return getSecureItem(INVITE_KEY);
}

export async function clearApplicationInvite(): Promise<void> {
  await deleteSecureItem(INVITE_KEY);
}
