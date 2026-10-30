import assert from "node:assert/strict";
export async function checkPersonalUI(browser, url, fixtureJob) {
  const users = new Map();
  let sequence = 0;
  async function wire(context) {
    await context.route("**/service.json", (route) =>
      route.fulfill({ json: { apiBase: "" } }),
    );
    await context.route("**/data/jobs.json", (route) =>
      route.fulfill({ json: { mode: "enriched", jobs: [], leads: [] } }),
    );
    await context.route("**/api/**", async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname,
        method = req.method();
      if (path === "/api/status")
        return route.fulfill({
          json: { search: true, personal: true, sourcePolicyVersion: 1 },
        });
      if (path === "/api/session") {
        const token = String(++sequence).repeat(64);
        users.set(token, {
          enabled: false,
          index: null,
          quota: { userUsed: 0, userLimit: 4, globalRemaining: 6 },
        });
        return route.fulfill({ json: { token } });
      }
      const user = users.get(
        req.headers().authorization?.replace("Bearer ", ""),
      );
      if (!user)
        return route.fulfill({
          status: 401,
          json: { error: "invalid session" },
        });
      if (method === "DELETE") {
        users.delete(req.headers().authorization.replace("Bearer ", ""));
        return route.fulfill({ json: { deleted: true } });
      }
      const body = ["POST", "PUT"].includes(method) ? req.postDataJSON() : {};
      if (body.preferences) {
        assert.equal(body.preferences.name, undefined);
        assert.equal(body.preferences.age, undefined);
        user.preferences = body.preferences;
      }
      if (method === "PUT") user.enabled = body.enabled;
      if (path === "/api/search") {
        user.index = {
          jobs: [
            {
              ...fixtureJob,
              url: "https://www.liepin.com/job/123456.shtml",
              id: "personal-" + user.preferences.role,
              title: user.preferences.role + "专属岗位",
            },
          ],
          leads: [],
          excluded: [],
          updatedAt: new Date().toISOString(),
          searchPreferences: user.preferences,
        };
        user.lastRunAt = new Date().toISOString();
        user.quota.userUsed++;
      }
      return route.fulfill({ json: user });
    });
  }
  const contexts = [];
  try {
    for (const [index, role] of ["数据分析", "产品运营"].entries()) {
      const context = await browser.newContext({
        viewport: index
          ? { width: 390, height: 844 }
          : { width: 1440, height: 1000 },
        serviceWorkers: "block",
      });
      contexts.push(context);
      await wire(context);
      const page = await context.newPage();
      await page.goto(url);
      await page.locator('[data-view="preferences"]').click();
      await page.locator('#prefsForm [name="role"]').fill(role);
      await page.locator('#prefsForm [name="searchConsent"]').check();
      await page.locator('#prefsForm [name="personalDaily"]').check();
      await page.locator('#prefsForm button[type="submit"]').click();
      await page.waitForFunction(
        () => !document.querySelector("#discover").hidden,
      );
      await page.locator("#refresh").click();
      await page.waitForFunction(() =>
        document
          .querySelector("#dataStatus")
          .textContent.includes("我的个人日报"),
      );
      assert.match(
        await page.locator("#jobList").innerText(),
        new RegExp(role + "专属岗位"),
      );
      assert.ok(
        !(await page.locator("#jobList").innerText()).includes(
          index ? "数据分析专属岗位" : "产品运营专属岗位",
        ),
      );
      await page.reload();
      await page.waitForFunction(() =>
        document
          .querySelector("#dataStatus")
          .textContent.includes("我的个人日报"),
      );
      assert.match(
        await page.locator("#jobList").innerText(),
        new RegExp(role + "专属岗位"),
      );
      await page.locator('[data-view="preferences"]').click();
      assert.match(
        await page.locator("#personalStatus").innerText(),
        /每日检索已启用/,
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
    }
    assert.equal(users.size, 2);
    assert.deepEqual(
      [...users.values()].map((u) => u.preferences.role),
      ["数据分析", "产品运营"],
    );
    const firstPage = contexts[0].pages()[0];
    await firstPage.locator('#prefsForm [name="searchConsent"]').uncheck();
    await firstPage.locator('#prefsForm button[type="submit"]').click();
    await firstPage.waitForFunction(
      () => !document.querySelector("#discover").hidden,
    );
    assert.equal([...users.values()][0].enabled, false);
    console.log(
      "Personal UI passed: independent devices, preference-driven search, daily opt-in and reload restore",
    );
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
}
