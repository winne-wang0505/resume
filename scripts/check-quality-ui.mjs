import assert from "node:assert/strict";
export async function checkQualityUI(browser, url, sample) {
  const fresh = {
    ...sample,
    id: "quality-fresh",
    title: "数据分析有效岗位",
    url: "https://www.liepin.com/job/123456.shtml",
    detailFetchedAt: new Date().toISOString(),
  };
  const offer = {
    ...fresh,
    id: "quality-offer",
    title: "数据分析 OfferToday 岗位",
    url: "https://hk.offertoday.com/job/abcdef123",
  };
  const stale = {
    ...fresh,
    id: "quality-stale",
    title: "数据分析旧详情",
    url: "https://www.liepin.com/job/333333.shtml",
    detailFetchedAt: new Date(Date.now() - 48 * 3600000).toISOString(),
  };
  const dead = {
    ...fresh,
    id: "quality-dead",
    title: "不应出现的下架岗位",
    status: "closed",
    url: "https://www.liepin.com/job/444444.shtml",
  };
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      serviceWorkers: "block",
    });
    try {
      await context.addInitScript(() => {
        localStorage.setItem(
          "career.profile",
          JSON.stringify({
            degree: "本科",
            years: 2,
            skills: "SQL、Python、Excel",
          }),
        );
        localStorage.setItem(
          "career.prefs",
          JSON.stringify({
            role: "数据分析",
            region: "全部",
            sourceMode: "standard",
          }),
        );
      });
      await context.route("**/service.json", (route) =>
        route.fulfill({ json: { apiBase: "" } }),
      );
      await context.route("**/api/status", (route) =>
        route.fulfill({ status: 404, body: "" }),
      );
      await context.route("**/data/jobs.json", (route) =>
        route.fulfill({
          json: {
            jobs: [fresh, offer, stale, dead],
            leads: [
              {
                ...dead,
                id: "old-404",
                status: undefined,
                title: "不应出现的404岗位",
                detailFailure: "来源返回 HTTP 404",
              },
            ],
            excluded: [],
            updatedAt: new Date().toISOString(),
          },
        }),
      );
      const page = await context.newPage();
      await page.goto(url);
      await page.locator("#jobList .job-card").first().waitFor();
      assert.equal(await page.locator("#jobList .job-card").count(), 2);
      assert.ok(
        !(await page.locator("#jobList").innerText()).includes("旧详情"),
      );
      assert.ok(
        !(await page.locator("#jobList").innerText()).includes("不应出现"),
      );
      await page.locator('[data-view="daily"]').click();
      assert.equal(await page.locator("#briefList .recommendation").count(), 2);
      assert.equal(
        await page.locator("#pendingSection").getAttribute("open"),
        null,
      );
      await page.locator("#pendingSection summary").click();
      assert.match(await page.locator("#pendingList").innerText(), /24 小时/);
      assert.ok(
        !(await page.locator("#pendingList").innerText()).includes("不应出现"),
      );
      await page.locator('[data-view="preferences"]').click();
      await page
        .locator('#prefsForm [name="sourceMode"]')
        .selectOption("preferred");
      await page.locator('#prefsForm button[type="submit"]').click();
      assert.equal(await page.locator("#jobList .job-card").count(), 1);
      assert.match(await page.locator("#jobList").innerText(), /OfferToday/);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      console.log(
        `Quality UI passed: ${viewport.width}px, no removed/stale recommendations, source selection and folded diagnostics`,
      );
    } finally {
      await context.close();
    }
  }
}
