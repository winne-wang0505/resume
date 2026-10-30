// Browser networking is mediated by the same public-address, allowlist and robots
// checks as the static reader. No cookies, credentials, POSTs or challenge solving.
import { sourceURL } from "./sources.mjs";
export async function createBrowserRenderer({
  maxRequests = 45,
  timeout = 15000,
} = {}) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
  });
  return {
    async render(raw, { request, region, robotsAllowed }) {
      const initial = sourceURL(raw, region);
      if (!initial) throw Error("不支持的渲染来源");
      const context = await browser.newContext({
        serviceWorkers: "block",
        acceptDownloads: false,
      });
      let count = 0;
      const rules = new Map();
      const started = Date.now();
      try {
        await context.route("**/*", async (route) => {
          const req = route.request();
          const target = sourceURL(req.url(), region);
          if (
            !target ||
            target.origin !== initial.origin ||
            req.method() !== "GET" ||
            !["document", "script", "stylesheet", "fetch", "xhr"].includes(
              req.resourceType(),
            ) ||
            ++count > maxRequests ||
            Date.now() - started > timeout
          )
            return route.abort();
          try {
            if (!rules.has(target.origin))
              rules.set(
                target.origin,
                request(target.origin + "/robots.txt", region, 512000)
                  .then((r) => r.body)
                  .catch((e) => {
                    if (/HTTP (?:404|410)/.test(e.message)) return "";
                    throw e;
                  }),
              );
            if (!robotsAllowed(await rules.get(target.origin), target.href))
              return route.abort();
            const res = await request(
              target.href,
              region,
              2000000,
              true,
              initial.origin,
              async (target) =>
                robotsAllowed(await rules.get(target.origin), target.href),
            );
            await route.fulfill({
              status: 200,
              contentType: res.type || "text/html",
              body: res.body,
            });
          } catch {
            await route.abort().catch(() => {});
          }
        });
        if (context.routeWebSocket)
          await context.routeWebSocket("**/*", (ws) => ws.close());
        const page = await context.newPage();
        page.setDefaultTimeout(timeout);
        await page.goto(initial.href, {
          waitUntil: "domcontentloaded",
          timeout,
        });
        await page
          .waitForLoadState("networkidle", { timeout: 2500 })
          .catch(() => {});
        // Drop executable content: only DOM text/headings and JobPosting metadata
        // are relevant for extraction. No challenge/session payload persistence.
        return await page.evaluate(() => {
          const copy = document.documentElement.cloneNode(true);
          copy
            .querySelectorAll(
              "script:not([type='application/ld+json']),style,iframe,form,input",
            )
            .forEach((x) => x.remove());
          return copy.outerHTML.slice(0, 1000000);
        });
      } finally {
        await context.close();
      }
    },
    close: () => browser.close(),
  };
}
