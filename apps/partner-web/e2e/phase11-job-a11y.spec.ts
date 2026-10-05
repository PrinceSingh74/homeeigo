import { expect, test, type Page } from "@playwright/test";
import { assertAxeSerious } from "./helpers/p0-a11y";
import { SEED_PARTNER, waitForPartnerFormHydration } from "./enterprise/fixtures";

const JOB_ID = "cmuu7d3i9093btz3k4v9a6nfc";
const PANELS = [
  "job-detail-page",
  "job-brief",
  "job-preparation",
  "safety-panel",
  "execution-steps",
  "job-evidence-panel",
  "quality-panel",
  "completion-checklist",
] as const;

async function signIn(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await waitForPartnerFormHydration(page);
  await page.locator("#partner-email").pressSequentially(SEED_PARTNER.email, { delay: 15 });
  await page.locator("#partner-password").pressSequentially(SEED_PARTNER.password, { delay: 15 });
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60_000 });
}

test("partner login, dashboard, job list and completed job are axe-clean", async ({ page }) => {
  test.setTimeout(240_000);
  const viewports = [
    { width: 1280, height: 800, name: "desktop" },
    { width: 768, height: 1024, name: "tablet" },
    { width: 390, height: 844, name: "phone" },
  ];

  await page.setViewportSize(viewports[0]!);
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await waitForPartnerFormHydration(page);
  const email = page.locator("#partner-email");
  await email.focus();
  await expect(email).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#partner-password")).toBeFocused();
  await assertAxeSerious(page, "login desktop");

  await signIn(page);
  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading").and(page.locator(":visible")).first()).toBeVisible({ timeout: 30_000 });
    await assertAxeSerious(page, `dashboard ${vp.name}`);
    await page.goto("/requests", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading").and(page.locator(":visible")).first()).toBeVisible({ timeout: 30_000 });
    await assertAxeSerious(page, `job list ${vp.name}`);
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/requests/${JOB_ID}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("job-detail-page")).toBeVisible({ timeout: 60_000 });
  const rendered: string[] = [];
  const absent: string[] = [];
  for (const id of PANELS) {
    if (await page.getByTestId(id).count()) rendered.push(id);
    else absent.push(id);
  }
  await assertAxeSerious(page, "job detail desktop");
  for (const vp of viewports.slice(1)) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await assertAxeSerious(page, `job detail ${vp.name}`);
  }
  console.log(JSON.stringify({ jobId: JOB_ID, rendered, absent }));
  expect(rendered).toContain("job-detail-page");
});
