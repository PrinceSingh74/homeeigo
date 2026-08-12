const DEVICE_ID_KEY = "homigo_device_id";

export function getDeviceId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return undefined;
  }
}

export function getDeviceName(): string | undefined {
  if (typeof navigator === "undefined") return undefined;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS Web";
  if (/Android/i.test(ua)) return "Android Web";
  if (/Macintosh/i.test(ua)) return "macOS Web";
  if (/Windows/i.test(ua)) return "Windows Web";
  return "Web Browser";
}
