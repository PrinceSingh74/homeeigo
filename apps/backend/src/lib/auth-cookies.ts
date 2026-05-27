const ACCESS_MAX_AGE = 60 * 60;
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;

type HeaderSet = {
  headers?: Record<string, string | number | string[] | undefined>;
  status?: number | string;
};

export const appendAuthCookies = (set: HeaderSet, accessToken: string, refreshToken: string): void => {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const base = `Path=/; HttpOnly; SameSite=Lax${secure}`;
  const access = `homigo_access=${encodeURIComponent(accessToken)}; Max-Age=${ACCESS_MAX_AGE}; ${base}`;
  const refresh = `homigo_refresh=${encodeURIComponent(refreshToken)}; Max-Age=${REFRESH_MAX_AGE}; ${base}`;
  const prev = set.headers?.["Set-Cookie"] ?? set.headers?.["set-cookie"];
  const list = Array.isArray(prev) ? [...prev, access, refresh] : prev ? [String(prev), access, refresh] : [access, refresh];
  set.headers = { ...set.headers, "Set-Cookie": list };
};

export const clearAuthCookies = (set: HeaderSet): void => {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const base = `Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`;
  set.headers = { ...set.headers, "Set-Cookie": [`homigo_access=; ${base}`, `homigo_refresh=; ${base}`] };
};
