/**
 * Services catalogue — end-to-end matrix (Phase 2).
 *
 * Deterministic: every wait is on a URL, a network response, a visible element or
 * specific text — no arbitrary sleeps. Sentry is blocked (production monitoring
 * must never receive test traffic) and cookie consent is pre-seeded.
 *
 * Run against a running stack:
 *   E2E_SKIP_SERVERS=1 E2E_WEB_URL=http://127.0.0.1:3005 E2E_API_URL=http://127.0.0.1:3000 \
 *     npx playwright test e2e/services-catalog.spec.ts
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { chooseFirstBookableSlot } from "./helpers";

const BACKEND = path.join(__dirname, "..", "..", "backend");

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const CUSTOMER = { email: "customer@homigo.demo", password: "Homigo@123" };
const ADMIN = { email: "admin@homigo.demo", password: "Homigo@123" };

type Svc = { id: string; slug: string; basePrice: number };
let HOURLY: Svc;
let BATHROOM: Svc;

/**
 * The catalogue this matrix exercises, declared instead of assumed. The suite used to depend on
 * whichever long-lived database it ran against: a freshly seeded one has a flat bathroom price (no
 * tier selector) and no HOUR quantity rule (only 1 hour bookable), so tests 3, 9–11, 13–14 and 33 failed
 * for data reasons. The values are the ones the assertions below state (base ₹399, Premium ₹598, ₹199
 * an hour, up to 8 hours). Applied through the admin API — the same validated, versioned write an admin
 * makes — and only on the isolated backend (the config's globalSetup refuses anything else).
 */
/**
 * The suite used to require `scripts/seed.ts`, which wipes bookings, payments and services
 * before it creates admin@homigo.demo. These two scripts only upsert: demo accounts
 * (`--only` skips the partner, so it does not rewrite partner ratings) and the catalogue
 * rows. They refuse any database whose name does not contain "test".
 */
function ensureIsolatedAccounts() {
  const envFile = process.env.E2E_BACKEND_ENV_FILE ?? ".env.test";
  execFileSync("bun", ["--env-file=" + envFile, "run", "scripts/ensure-demo-users.ts", "--only=admin,customer"], {
    cwd: BACKEND,
    stdio: "inherit",
    timeout: 120_000,
  });
  execFileSync("bun", ["--env-file=" + envFile, "run", "scripts/seed-services.ts"], {
    cwd: BACKEND,
    stdio: "inherit",
    timeout: 120_000,
  });
}

async function ensureCatalogFixture() {
  const login = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...ADMIN, setAuthCookies: false }),
  });
  const token = ((await login.json()) as { data?: { accessToken?: string } }).data?.accessToken;
  expect(token, "admin login for the catalogue fixture").toBeTruthy();
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const admin = async (id: string) =>
    ((await (await fetch(`${API}/api/admin/services/${id}`, { headers: auth })).json()) as {
      data: { service: { basePrice: number; minPrice: number | null; maxPrice: number | null; catalogConfig: Record<string, unknown> | null } };
    }).data.service;
  const put = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`${API}/api/admin/services/${id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ ...body, changeReason: "E2E catalogue fixture (services-catalog.spec.ts)" }),
    });
    expect(res.status, JSON.stringify(await res.clone().json().catch(() => null))).toBe(200);
  };

  const hourly = await admin(HOURLY.id);
  const rule = { type: "HOUR", unitLabel: "hour", unitLabelPlural: "hours", min: 1, max: 8 };
  const fridge = { id: "fridge", name: "Fridge Cleaning", price: 99, active: true };
  const hourlyCfg = hourly.catalogConfig ?? {};
  type FixtureAddon = { id?: string; name?: string; price?: number; active?: boolean };
  const hourlyAddons = (Array.isArray(hourlyCfg.addons) ? hourlyCfg.addons : []) as FixtureAddon[];
  const fridgeOk = hourlyAddons.some((a) => a.id === "fridge" && a.name === "Fridge Cleaning" && a.price === 99 && a.active !== false);
  if (JSON.stringify(hourlyCfg.quantity) !== JSON.stringify({ ...rule, step: 1 }) || !fridgeOk) {
    const addons = hourlyAddons.filter((a) => a.id !== "fridge");
    addons.push(fridge);
    await put(HOURLY.id, { catalogConfig: { ...hourlyCfg, quantity: rule, addons } });
  }
  const bath = await admin(BATHROOM.id);
  const sofa = { id: "sofa", name: "Sofa Cleaning", price: 149, active: true };
  const bathCfg = bath.catalogConfig ?? {};
  const bathAddons = (Array.isArray(bathCfg.addons) ? bathCfg.addons : []) as FixtureAddon[];
  const sofaOk = bathAddons.some((a) => a.id === "sofa" && a.name === "Sofa Cleaning" && a.price === 149 && a.active !== false);
  const bathBody: Record<string, unknown> = {};
  if (bath.basePrice !== 399 || bath.minPrice !== 399 || bath.maxPrice !== 598) {
    bathBody.basePrice = 399;
    bathBody.minPrice = 399;
    bathBody.maxPrice = 598;
  }
  if (!sofaOk) {
    const addons = bathAddons.filter((a) => a.id !== "sofa");
    addons.push(sofa);
    bathBody.catalogConfig = { ...bathCfg, addons };
  }
  if (Object.keys(bathBody).length) await put(BATHROOM.id, bathBody);

  // A service past page 1 is still the fixture. Walk every page; do not require it to be popular.
  await expect
    .poll(
      async () => {
        const matches: Array<{
          slug: string;
          basePrice: number;
          maxPrice?: number;
          catalogConfig?: { quantity?: { type?: string }; addons?: { id: string }[] } | null;
        }> = [];
        for (let page = 1; page <= 20; page++) {
          const body = (await (await fetch(`${API}/api/services?limit=100&page=${page}`)).json()) as {
            data?: {
              services?: Array<{
                slug: string;
                basePrice: number;
                maxPrice?: number;
                catalogConfig?: { quantity?: { type?: string }; addons?: { id: string }[] } | null;
              }>;
            };
          };
          const services = body.data?.services ?? [];
          matches.push(...services.filter((s) => s.slug === "bathroom-cleaning" || s.slug === "hourly-bookings"));
          if (services.length < 100) break;
        }
        const b = matches.find((s) => s.slug === "bathroom-cleaning");
        const h = matches.find((s) => s.slug === "hourly-bookings");
        const addons = (cfg: { addons?: { id: string }[] } | null | undefined) =>
          (cfg?.addons ?? []).map((a) => a.id).sort().join(",");
        return `${b?.basePrice}/${b?.maxPrice}/${h?.catalogConfig?.quantity?.type ?? "none"}/${addons(h?.catalogConfig)}/${addons(b?.catalogConfig)}`;
      },
      { timeout: 90_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe("399/598/HOUR/fridge/sofa");
}

async function findPublicService(slug: string): Promise<Svc | undefined> {
  // The public list is capped at 100 and ties on popularity are unstable, so a known slug can
  // sit past page 1 once the isolated database holds more than a page of commercial services.
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`${API}/api/services?limit=100&page=${page}`);
    const services = ((await res.json()) as { data?: { services?: Svc[] } }).data?.services ?? [];
    const hit = services.find((s) => s.slug === slug);
    if (hit) return hit;
    if (services.length < 100) return undefined;
  }
  return undefined;
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  ensureIsolatedAccounts();
  HOURLY = (await findPublicService("hourly-bookings"))!;
  BATHROOM = (await findPublicService("bathroom-cleaning"))!;
  expect(HOURLY && BATHROOM).toBeTruthy();
  await ensureCatalogFixture();
});

async function prepare(context: BrowserContext) {
  await context.route(/sentry\.io/, (r) => r.abort());
  await context.addInitScript(() => {
    try {
      localStorage.setItem("homigo_cookie_consent", "declined");
    } catch {
      /* storage unavailable */
    }
  });
}

test.beforeEach(async ({ context }) => prepare(context));

/** Dialogs fade in; audit only once the open animation has settled. */
const dialogSettled = (page: Page) =>
  page.waitForFunction(() => {
    const d = document.querySelector('[role="dialog"]');
    return Boolean(d) && getComputedStyle(d!).opacity === "1" && getComputedStyle(d!).transform === "none";
  });

const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

const bodyIsClean = async (page: Page) => {
  // The visible landmark: while the RSC stream finishes (~2 s), React keeps the hidden loading
  // fallbacks' <main> elements in the DOM, and a bare "main" CSS locator trips strict mode.
  const text = await page.getByRole("main").innerText();
  expect(text).not.toMatch(/\bundefined\b|\bNaN\b|\bnull\b|Adv Service|Phase2|rc\d{8,}/);
};

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email" }).fill(CUSTOMER.email);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(CUSTOMER.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
}

/* ------------------------------------------------------------------ */
/* 1–8 Hub, category, detail, search, filters, sort, empty state        */
/* ------------------------------------------------------------------ */

test.describe("browse & discover", () => {
  test("1 hub renders hero, categories, hourly module and trust — no internal data", async ({ page }) => {
    await page.goto("/services");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Everything your home needs. One trusted place.");
    await expect(page.getByRole("heading", { name: "All services, by category" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Need flexible help?" })).toBeVisible();
    await expect(page.getByText("₹199", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Built on transparency" })).toBeVisible();
    await bodyIsClean(page);
    await noOverflow(page);
  });

  test("2 category page groups services and marks coming soon", async ({ page }) => {
    await page.goto("/services/home-cleaning");
    await expect(page.getByRole("heading", { level: 1, name: "Home Cleaning" })).toBeVisible();
    // Appears in "Popular" and in its subgroup by design — assert the subgroup copy.
    await expect(page.getByLabel("Rooms & whole home").getByRole("link", { name: "Bathroom Cleaning" })).toBeVisible();
    await expect(page.getByText("Coming soon").first()).toBeVisible();
    await bodyIsClean(page);
  });

  test("3 service detail: facts, scope fallback, policies fallback, FAQ, booking CTA", async ({ page }) => {
    await page.goto("/services/home-cleaning/bathroom-cleaning");
    await expect(page.getByRole("heading", { level: 1, name: "Bathroom Cleaning" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose your option" })).toBeVisible();
    await expect(page.getByText("Details will be confirmed during booking.").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Frequently asked questions" })).toBeVisible();
    const cta = page.getByRole("complementary", { name: "Book this service" }).getByRole("link");
    await expect(cta).toHaveText(/Book Now — ₹399/);
    await bodyIsClean(page);
  });

  test("4 search: exact, partial, category, typo — keyboard selection opens canonical page", async ({ page }) => {
    await page.goto("/services");
    const box = page.getByRole("combobox", { name: "Search for a service" });
    const firstOption = page.getByRole("listbox", { name: "Search suggestions" }).getByRole("option").first();
    for (const [q, expected] of [
      ["Electrician", "Electrician"],
      ["bathr", "Bathroom Cleaning"],
      ["pest", "Pest Control"],
      ["electrcian", "Electrician"],
    ] as const) {
      await box.fill(q);
      await expect(firstOption).toContainText(expected);
    }
    await box.fill("bathrom");
    await expect(firstOption).toContainText("Bathroom Cleaning");
    await box.press("ArrowDown");
    await expect(box).toHaveAttribute("aria-activedescendant", /bathroom-cleaning/);
    await box.press("Enter");
    await page.waitForURL("**/services/home-cleaning/bathroom-cleaning");
  });

  test("5 search never exposes internal records; zero results shows empty state", async ({ page }) => {
    await page.goto("/services?q=adv%20service");
    await expect(page.locator("#search-results")).toBeVisible();
    await expect(page.locator("#search-results")).not.toContainText("Adv Service");
    await page.goto("/services?q=zzqxy");
    await expect(page.getByText("No services found")).toBeVisible();
    await expect(page.getByText("Try another category or search term.")).toBeVisible();
  });

  test("6–7 filters (keyboard, focus return) and price sort", async ({ page }) => {
    await page.goto("/services?q=cleaning");
    const results = page.locator("#search-results article");
    await expect(results.first()).toBeVisible();
    const filters = page.getByRole("button", { name: /^Filters/ });
    await filters.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Filters" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /Bookable now/ }).click();
    await expect(dialog.getByRole("button", { name: /Bookable now/ })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(filters).toBeFocused();
    await expect(page.locator("#search-results article", { hasText: "Coming soon" })).toHaveCount(0);
    await page.getByLabel("Sort services").selectOption("price-asc");
    const prices = (await page.locator("#search-results article p.tabular-nums > span[aria-hidden]").allTextContents()).map((t) =>
      Number(t.replace(/[^\d]/g, "")),
    );
    expect(prices.length).toBeGreaterThan(3);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });
});

/* ------------------------------------------------------------------ */
/* 9–14 Hourly, quantity, add-ons, notes → hand-off URL                 */
/* ------------------------------------------------------------------ */

test.describe("service → detail → hand-off URL", () => {
  test("9–11 hourly 1 / 2 / 4 hours: estimate + quantity in the /book URL (never a price)", async ({ page }) => {
    await page.goto("/services/home-help/hourly-home-help");
    const cta = page.getByRole("complementary", { name: "Book this service" }).getByRole("link");
    for (const [h, amount] of [
      [1, "199"],
      [2, "398"],
      [4, "796"],
    ] as const) {
      // The hour chips' accessible name is "<n> hour(s), ₹<amount> before taxes" (was "…, estimated …").
      await page.getByRole("button", { name: new RegExp(`^${h} hours?, ₹${amount} before taxes$`) }).click();
      await expect(cta).toHaveText(new RegExp(`Book Now — ₹${amount}`));
      const url = new URL((await cta.getAttribute("href"))!, "http://x");
      expect(url.pathname).toBe("/book");
      expect(url.searchParams.get("quantity")).toBe(String(h));
      expect(url.searchParams.get("service")).toBe(HOURLY.id);
      expect([...url.searchParams.keys()].some((k) => /price|amount|total/i.test(k))).toBe(false);
    }
  });

  test("13–14 add-ons + task notes are carried; tiers carry a package index", async ({ page }) => {
    await page.goto("/services/home-help/hourly-home-help");
    await page.getByRole("button", { name: "Laundry", exact: true }).click();
    await page.getByRole("button", { name: /Fridge Cleaning/ }).click();
    const cta = page.getByRole("complementary", { name: "Book this service" }).getByRole("link");
    await expect(cta).toHaveText(/₹298/);
    const url = new URL((await cta.getAttribute("href"))!, "http://x");
    expect(url.searchParams.get("addons")).toBe("fridge");
    expect(url.searchParams.get("notes")).toContain("Laundry");

    await page.goto("/services/home-cleaning/bathroom-cleaning");
    await page.getByRole("radio", { name: /Highest price/ }).click();
    await page.getByRole("button", { name: /Sofa Cleaning/ }).click();
    const cta2 = page.getByRole("complementary", { name: "Book this service" }).getByRole("link");
    await expect(cta2).toHaveText(/₹747/);
    const u2 = new URL((await cta2.getAttribute("href"))!, "http://x");
    expect(u2.searchParams.get("package")).toBe("2");
    expect(u2.searchParams.get("addons")).toBe("sofa");
  });
});

/* ------------------------------------------------------------------ */
/* 15–25 Beauty audiences, care verticals, coming soon, notify me       */
/* ------------------------------------------------------------------ */

test.describe("beauty & care verticals", () => {
  for (const [aud, name] of [
    ["women", "Women"],
    ["men", "Men"],
    ["girls", "Girls"],
    ["boys", "Boys"],
    ["senior-women", "Senior Women"],
    ["senior-men", "Senior Men"],
  ] as const) {
    test(`15–20 beauty for ${name}: eligible services, cards preselect the audience`, async ({ page }) => {
      await page.goto(`/services/beauty/${aud}`);
      await expect(page.getByRole("heading", { level: 1, name: `Beauty for ${name}` })).toBeVisible();
      const haircut = page.getByRole("link", { name: "Haircut & Styling" });
      await expect(haircut).toHaveAttribute("href", `/services/beauty/haircut-styling?for=${aud}`);
      await bodyIsClean(page);
    });
  }

  test("beauty detail: audience required before booking; ?for= preselects; unsupported preference hidden", async ({ page }) => {
    await page.goto("/services/beauty/salon-at-home");
    const cta = page.getByRole("complementary", { name: "Book this service" });
    await expect(cta.getByText("Choose who this is for")).toBeVisible();
    await expect(page.getByText("No professional preference available for this service.")).toBeVisible();
    await page.getByRole("radio", { name: /Senior Men/ }).click();
    const href = await cta.getByRole("link").getAttribute("href");
    expect(new URL(href!, "http://x").searchParams.get("notes")).toBe("For: Senior Men.");

    await page.goto("/services/beauty/salon-at-home?for=girls");
    await expect(page.getByRole("radio", { name: /Girls/ })).toHaveAttribute("aria-checked", "true");
  });

  test("21–23 senior, pet, executive: coming soon with non-medical notices, no price", async ({ page }) => {
    await page.goto("/services/senior-care");
    await expect(page.getByText(/non-medical assistance/)).toBeVisible();
    await page.goto("/services/pet-care");
    await expect(page.getByText(/non-veterinary/)).toBeVisible();
    await page.goto("/services/executive-concierge");
    await expect(page.getByRole("heading", { level: 1, name: "Executive & Concierge" })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("₹");
  });

  test("24–25 coming soon: no Book, no price; Notify Me persists via coverage request + handles failure", async ({ page }) => {
    let posted: Record<string, unknown> | null = null;
    let fail = true;
    await page.route("**/api/coverage/requests", async (route) => {
      posted = route.request().postDataJSON();
      if (fail) return route.fulfill({ status: 500, contentType: "application/json", body: '{"success":false,"error":"Temporary problem"}' });
      return route.fulfill({ status: 201, contentType: "application/json", body: '{"success":true,"data":{"id":"x","duplicate":false}}' });
    });
    await page.goto("/services/pet-care/pet-walking");
    await expect(page.getByRole("link", { name: /^Book Now/ })).toHaveCount(0);
    const form = page.getByRole("complementary", { name: "Get notified" });
    await expect(page.getByText("Pricing at launch").first()).toBeVisible();
    await form.getByLabel("Name").fill("Test Person");
    await form.getByLabel("Mobile number").fill("9876543210");
    await form.getByLabel("Area / locality").fill("Sector 49");
    await form.getByRole("button", { name: "Notify me" }).click();
    await expect(form.getByRole("alert")).toBeVisible();
    fail = false;
    await form.getByRole("button", { name: "Notify me" }).click();
    await expect(form.getByRole("status")).toContainText("You're on the list");
    expect(posted).toMatchObject({ source: "service_launch:pet-walking", area: "Sector 49", mobile: "9876543210" });
  });
});

/* ------------------------------------------------------------------ */
/* 26–29 Status codes, canonical, sitemap                               */
/* ------------------------------------------------------------------ */

test.describe("routing & SEO", () => {
  test("26–27 invalid → 404, legacy → 308 to canonical", async ({ request }) => {
    for (const p of ["/services/nope", "/services/home-cleaning/nope", "/services/a/b/c/d"]) {
      expect((await request.get(p, { maxRedirects: 0 })).status(), p).toBe(404);
    }
    for (const [from, to] of [
      ["/services/deep-cleaning", "/services/home-cleaning/deep-home-cleaning"],
      ["/services/home-help/laundry", "/services/laundry-fabric/laundry"],
      ["/services/beauty/women/hair", "/services/beauty/haircut-styling?for=women"],
    ] as const) {
      const res = await request.get(from, { maxRedirects: 0 });
      expect(res.status(), from).toBe(308);
      expect(new URL(res.headers()["location"]!, "http://x").pathname + new URL(res.headers()["location"]!, "http://x").search).toBe(to);
    }
  });

  test("28 canonical, unique title, noindex on coming soon, structured data", async ({ page }) => {
    await page.goto("/services/home-cleaning/bathroom-cleaning");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/services\/home-cleaning\/bathroom-cleaning$/);
    await expect(page).toHaveTitle(/Bathroom Cleaning — Home Cleaning/);
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(ld.some((j) => j.includes('"@type":"Service"'))).toBe(true);
    expect(await page.locator('meta[name="robots"][content*="noindex"]').count()).toBe(0);
    await page.goto("/services/pet-care/pet-walking");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("29 sitemap: bookable pages in, coming soon + internal out", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    expect(xml).toContain("/services/home-cleaning/bathroom-cleaning");
    expect(xml).toContain("/services/home-help/hourly-home-help");
    expect(xml).not.toContain("/services/pet-care/pet-walking");
    expect(xml).not.toMatch(/adv-service|phase2|rc178/);
  });
});

/* ------------------------------------------------------------------ */
/* 30–32 Accessibility, mobile, desktop                                  */
/* ------------------------------------------------------------------ */

test.describe("accessibility & responsive", () => {
  for (const path of [
    "/services",
    "/services/home-cleaning",
    "/services/home-cleaning/bathroom-cleaning",
    "/services/home-help/hourly-home-help",
    "/services/beauty/women",
    "/services/beauty/salon-at-home",
    "/services/pet-care/pet-walking",
  ]) {
    test(`30 axe WCAG 2.1 AA: ${path}`, async ({ page }) => {
      // AnimatedPrice re-keys when the live price hydrates and fades in from opacity 0.35;
      // an axe pass inside that 0.3 s window measured the fade frame (2.22:1), not the
      // resting colour. Reduced motion drops the fade (motion-safe:), so axe sees the page as rendered.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const r = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect(r.violations.map((v) => `${v.id} x${v.nodes.length}`)).toEqual([]);
    });
  }

  test("30 axe: filters dialog + notify dialog", async ({ page }) => {
    await page.goto("/services/home-cleaning");
    await page.getByRole("button", { name: /^Filters/ }).click();
    await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
    await dialogSettled(page);
    let r = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
    await page.goto("/services/senior-care");
    await page.getByRole("button", { name: "Notify me" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await dialogSettled(page);
    r = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });

  for (const width of [360, 390, 768, 1440]) {
    test(`31–32 no horizontal overflow at ${width}px (hub, category, detail, beauty)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ["/services", "/services/home-cleaning", "/services/home-help/hourly-home-help", "/services/beauty/salon-at-home"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await noOverflow(page);
      }
      if (width < 1024) {
        // Sticky booking bar sits above the bottom nav on small screens.
        await expect(page.locator("div.fixed", { hasText: "Book Now" }).or(page.locator("div.fixed", { hasText: "Choose who this is for" })).first()).toBeVisible();
      }
    });
  }
});

/* ------------------------------------------------------------------ */
/* 33 Booking price integrity — server quote is authoritative            */
/* ------------------------------------------------------------------ */

test.describe("booking hand-off & price integrity (signed in)", () => {
  test.describe.configure({ mode: "serial" });

  test("33 /book re-prices every selection on the server; tampering is rejected", async ({ page }) => {
    await login(page);

    const quoteFor = async (url: string) => {
      const serviceId = new URL(url, "http://x").searchParams.get("service");
      // Wait for THIS service's quote (the picker may quote another service first).
      const resP = page.waitForResponse(
        (r) => r.url().includes("/api/bookings/price-quote") && r.request().postDataJSON()?.serviceId === serviceId,
      );
      await page.goto(url);
      const res = await resP;
      return { status: res.status(), body: (await res.json()) as { data?: { quote: Record<string, any> }; code?: string } };
    };

    // Hourly 2 h + fridge: the server prices 2 × 199 + 99.
    let q = await quoteFor(`/book?service=${HOURLY.id}&quantity=2&addons=fridge&notes=${encodeURIComponent("Tasks: Laundry.")}`);
    expect(q.status).toBe(200);
    expect(q.body.data!.quote).toMatchObject({ packagePrice: 398, addonTotal: 99 });
    expect(q.body.data!.quote.selection).toMatchObject({ quantity: 2, quantityType: "HOUR" });
    await expect(page.getByText(`₹${q.body.data!.quote.finalAmount}`).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your Selection" })).toBeVisible();
    await expect(page.locator("textarea")).toHaveValue(/Tasks: Laundry\./);

    // Hourly 4 h.
    q = await quoteFor(`/book?service=${HOURLY.id}&quantity=4`);
    expect(q.body.data!.quote).toMatchObject({ packagePrice: 796 });

    // Legacy tier + add-on (bathroom Premium + sofa).
    q = await quoteFor(`/book?service=${BATHROOM.id}&package=2&addons=sofa`);
    expect(q.body.data!.quote).toMatchObject({ packagePrice: 598, addonTotal: 149 });

    // Tampered quantity: server rejects, UI shows the error and never falls back to a client total.
    q = await quoteFor(`/book?service=${HOURLY.id}&quantity=99`);
    expect(q.status).toBe(400);
    expect(q.body.code).toBe("INVALID_QUANTITY");
    await expect(page.getByRole("alert").filter({ hasText: /quantity is not available/ }).first()).toBeVisible();
    let bookingPosted = false;
    page.on("request", (r) => {
      if (r.method() === "POST" && new URL(r.url()).pathname === "/api/bookings") bookingPosted = true;
    });
    // Confirm is only enabled once a server-approved slot is chosen; choose one so the click below
    // really attempts the booking — the tampered quantity, not a missing slot, must be what stops it.
    await chooseFirstBookableSlot(page);
    await page.getByRole("button", { name: "Confirm Booking Securely" }).click();
    await expect(page.getByText(/quantity is not available/).first()).toBeVisible();
    expect(bookingPosted).toBe(false);
  });
});
