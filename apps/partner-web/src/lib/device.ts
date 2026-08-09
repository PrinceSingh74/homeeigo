const DEVICE_ID_KEY = "homigo_partner_device_id";

function generate(): string {
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `partner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getDeviceId(): string {
  if (typeof localStorage === "undefined") return "partner-server";
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = generate();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function getDeviceName(): string {
  if (typeof navigator === "undefined") return "Partner Console";
  return `Partner Console · ${navigator.platform || "Web"}`;
}
