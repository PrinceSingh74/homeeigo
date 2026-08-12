import { test as base, expect, type Page } from "@playwright/test";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Valid PDF with visible text — base64 for evidence upload tests. */
export const MINIMAL_PDF_BASE64 =
  "JVBERi0xLjMKJf////8KNyAwIG9iago8PAovVHlwZSAvUGFnZQovUGFyZW50IDEgMCBSCi9NZWRpYUJveCBbMCAwIDU5NS4yOCA4NDEuODldCi9Db250ZW50cyA1IDAgUgovUmVzb3VyY2VzIDYgMCBSCi9Vc2VyVW5pdCAxCj4+CmVuZG9iago2IDAgb2JqCjw8Ci9Qcm9jU2V0IFsvUERGIC9UZXh0IC9JbWFnZUIgL0ltYWdlQyAvSW1hZ2VJXQovRm9udCA8PAovRjEgOCAwIFIKPj4KL0NvbG9yU3BhY2UgPDwKPj4KPj4KZW5kb2JqCjUgMCBvYmoKPDwKL0xlbmd0aCA0MjYKL0ZpbHRlciAvRmxhdGVEZWNvZGUKPj4Kc3RyZWFtCnicpZPLihsxEEX3+or6gempl261oPFiHglkEZjYu5CFpx8wEAeGgeT3g7rtEDuDaYhAQpREqc69KiEmphshptalaQv1h3T7MP586ccvH++of0vcMM5H0NrYW/8jvf6d7377X/m295+T0q+UnYKbTIdk1jZipbTHyPe0TU/pNcl7YHe7Y1yoZghrstHukG4/CCnTbkpfO2998sGLh0/KbmghoQhkKAS2qTc7PCt7DqDAkTHCkDfE32j3KT3u0tM/GuoFC2htbNFwDY/nxkRPQCJHIEcJC44cjqwcFjk4GFPohm6cqQtXhmOCRcZQecKv0ohdDFobW0+j3OTS/qE52lOy8oYyU5cdbSXT+k0K+pktNiSZOsgcr6aNyJVTqmlSFUCF1cXGKMpR82Tlc+MhcAwoGJVx5RPML9b9oub8+DOAHtNSSr0Apk7HM0XXacClYbuuQamGhYVDMATbfjlRNrU6oYPxvIpZdmMrtjeZV7aio4W55by/arjTaa42EC0aGE7Fl3fbqzo3QpYGUvYp+MKvggljdbPE7MSEcfZ7brv5XNCf1f4bOzoI9wplbmRzdHJlYW0KZW5kb2JqCjEwIDAgb2JqCihQREZLaXQpCmVuZG9iagoxMSAwIG9iagooUERGS2l0KQplbmRvYmoKMTIgMCBvYmoKKEQ6MjAyNjA2MTMwOTE5MDlaKQplbmRvYmoKOSAwIG9iago8PAovUHJvZHVjZXIgMTAgMCBSCi9DcmVhdG9yIDExIDAgUgovQ3JlYXRpb25EYXRlIDEyIDAgUgo+PgplbmRvYmoKOCAwIG9iago8PAovVHlwZSAvRm9udAovQmFzZUZvbnQgL0hlbHZldGljYQovU3VidHlwZSAvVHlwZTEKL0VuY29kaW5nIC9XaW5BbnNpRW5jb2RpbmcKPj4KZW5kb2JqCjQgMCBvYmoKPDwKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDEgMCBSCi9OYW1lcyAyIDAgUgo+PgplbmRvYmoKMSAwIG9iago8PAovVHlwZSAvUGFnZXMKL0NvdW50IDEKL0tpZHMgWzcgMCBSXQo+PgplbmRvYmoKMiAwIG9iago8PAovRGVzdHMgPDwKICAvTmFtZXMgWwpdCj4+Cj4+CmVuZG9iagp4cmVmCjAgMTMKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAxMDgzIDAwMDAwIG4gCjAwMDAwMDExNDAgMDAwMDAgbiAKMDAwMDAwMTAyMSAwMDAwMCBuIAowMDAwMDAxMDAwIDAwMDAwIG4gCjAwMDAwMDAyNDQgMDAwMDAgbiAKMDAwMDAwMDEzNyAwMDAwMCBuIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDA5MDMgMDAwMDAgbiAKMDAwMDAwMDgyOCAwMDAwMCBuIAowMDAwMDAwNzQyIDAwMDAwIG4gCjAwMDAwMDA3NjcgMDAwMDAgbiAKMDAwMDAwMDc5MiAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDEzCi9Sb290IDMgMCBSCi9JbmZvIDkgMCBSCi9JRCBbPGMwYmNiNTkwY2Q2ZDM4NDMyZjI5Njg3ZTRhZWYyYzI5PiA8YzBiY2I1OTBjZDZkMzg0MzJmMjk2ODdlNGFlZjJjMjk+XQo+PgpzdGFydHhyZWYKMTE4NwolJUVPRgo=";

export type EnterpriseMonitor = {
  consoleErrors: string[];
  failedApi: Array<{ url: string; status: number }>;
  assertClean: () => void;
};

export function attachEnterpriseMonitor(page: Page): EnterpriseMonitor {
  const consoleErrors: string[] = [];
  const failedApi: Array<{ url: string; status: number }> = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const t = msg.text();
      if (/favicon|hydration|401 \(Unauthorized\)|404 \(Not Found\)|_next\/static|\/api\/vitals/i.test(t)) return;
      consoleErrors.push(t);
    }
  });
  page.on("response", (res) => {
    if (res.url().includes("/api/") && res.status() >= 400 && res.status() !== 401 && res.status() !== 404) {
      failedApi.push({ url: res.url(), status: res.status() });
    }
  });
  return {
    consoleErrors,
    failedApi,
    assertClean() {
      expect(consoleErrors).toEqual([]);
      expect(failedApi).toEqual([]);
    },
  };
}

export const SEED_ADMIN = { email: "admin@homigo.demo", password: "Homigo@123" };

export async function adminLogin(page: Page) {
  await page.goto("/login");
  await page.locator("#admin-email").fill(SEED_ADMIN.email);
  await page.locator("#admin-password").fill(SEED_ADMIN.password);
  const res = page.waitForResponse(
    (r) => r.url().includes("/api/auth/login") && r.status() === 200,
    { timeout: 60_000 },
  );
  await page.getByRole("button", { name: /enter business hq/i }).click();
  await res;
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
}

export async function adminApiToken() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: SEED_ADMIN.email, password: SEED_ADMIN.password, setAuthCookies: false }),
  });
  const json = (await res.json()) as { data?: { accessToken?: string } };
  return json.data?.accessToken ?? "";
}

export const test = base.extend<{ monitor: EnterpriseMonitor }>({
  monitor: async ({ page }, use) => {
    const monitor = attachEnterpriseMonitor(page);
    await use(monitor);
    monitor.assertClean();
  },
});
