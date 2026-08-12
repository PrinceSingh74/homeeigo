import { chromium } from "@playwright/test";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto("http://localhost:3003/login", { waitUntil: "domcontentloaded" });
  await page.locator("#admin-email").fill("admin@homigo.demo");
  await page.locator("#admin-password").fill("Homigo@123");
  await page.getByRole("button", { name: /enter business hq/i }).click();
  await page.waitForSelector("text=Business overview", { timeout: 60_000 });
  await page.goto("http://localhost:3003/settings", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const info = await page.evaluate(() => ({
    path: location.pathname,
    aside: document.querySelectorAll("aside").length,
    bizSidebar: document.querySelectorAll("aside.biz-sidebar").length,
    navLinks: [...document.querySelectorAll("aside.biz-sidebar nav a")].map((a) => a.getAttribute("href")),
    allLinks: [...document.querySelectorAll("a[href]")].slice(0, 20).map((a) => a.getAttribute("href")),
    bodyText: document.body.innerText.slice(0, 200),
  }));
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
}

main();
