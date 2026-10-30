import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { extractDetail } from "../src/details.mjs";
const port = 3219;
const url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server.mjs"], {
  env: { ...process.env, PORT: String(port) },
  stdio: "pipe",
});
let browser;
try {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
  });
  const body = await readFile(
    new URL("../tests/fixtures/job-posting.html", import.meta.url),
    "utf8",
  );
  const job = extractDetail(body, {
    id: "ui-fixture",
    url: "https://hk.jobsdb.com/job/123456",
    region: "香港",
  }).job;
  const data = {
    mode: "enriched",
    updatedAt: new Date().toISOString(),
    jobs: [job],
    leads: [],
    excluded: [],
    sourceHealth: {
      liepin: {
        name: "猎聘",
        attempts: 3,
        successes: 0,
        cooldownUntil: "2030-01-01T00:00:00Z",
      },
    },
  };
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      serviceWorkers: "block",
    });
    await context.route("**/service.json", route => route.fulfill({ json: { apiBase: "" } }));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/data/jobs.json", (route) =>
      route.fulfill({ json: data }),
    );
    await page.route("**/api/status", (route) =>
      route.fulfill({ status: 404, body: "" }),
    );
    await page.goto(url);
    await page.locator('[data-view="profile"]').click();
    await page.locator('#profileForm [name="name"]').fill("测试用户");
    await page
      .locator('#profileForm [name="skills"]')
      .fill("SQL、Python、Excel");
    await page.locator('#profileForm [name="years"]').fill("2");
    await page.locator('#profileForm button[type="submit"]').click();
    await page.locator('[data-view="preferences"]').click();
    await page.locator('#prefsForm [name="role"]').fill("数据分析");
    await page.locator('#prefsForm [name="region"]').selectOption("香港");
    await page.locator('#prefsForm button[type="submit"]').click();
    await page.locator('[data-view="daily"]').click();
    await page.locator("#manualImportSection summary").click();
    const form = page.locator("#manualImport");
    await form.locator('[name="title"]').fill("数据分析师（本机测试）");
    await form.locator('[name="company"]').fill("测试雇主");
    await form.locator('[name="region"]').selectOption("香港");
    await form.locator('[name="city"]').fill("香港");
    await form.locator('[name="url"]').fill("https://example.com/job/test");
    await form
      .locator('[name="text"]')
      .fill(
        "岗位职责：负责业务数据分析、维护经营报表、梳理产品需求、与业务团队解释指标变化，建立数据质量监控体系，输出可复用的分析报告。\n任职要求：本科学历，2年以上相关工作经验，熟练使用 SQL、Python 和 Excel，具有沟通表达能力。\n截止日期：2030年11月30日",
      );
    await form.locator('button[type="submit"]').click();
    await page.locator("#detail[open]").waitFor();
    assert.match(await page.locator("#detailBody").innerText(), /本机粘贴/);
    assert.match(await page.locator("#detailBody").innerText(), /SQL/);
    await page.locator("#closeDetail").click();
    assert.match(
      await page.locator("#briefList").innerText(),
      /用户粘贴 · 未验证/,
    );
    await page
      .locator("#briefList .recommendation")
      .filter({ hasText: "数据分析师（本机测试）" })
      .locator("[data-save]")
      .click();
    await page.locator('[data-view="saved"]').click();
    await page.locator(".status-select").selectOption("准备中");
    await page.reload();
    await page.locator('[data-view="saved"]').click();
    assert.equal(await page.locator(".status-select").inputValue(), "准备中");
    await page.locator('[data-view="daily"]').click();
    assert.match(await page.locator("#briefList").innerText(), /本机测试/);
    await page.locator('[data-view="discover"]').click();
    await page.locator("#refresh").click();
    await page.locator('[data-view="daily"]').click();
    assert.match(await page.locator("#briefList").innerText(), /本机测试/);
    await page.locator("#manualImportSection summary").click();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      "responsive layout must not overflow",
    );
    await page.locator("[data-remove-local]").click();
    assert.ok(
      !(await page.locator("#briefList").innerText()).includes("本机测试"),
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `UI regression passed: ${viewport.width}px (profile/preferences/import/score/save/status/reload/delete)`,
    );
  }
  const { checkPersonalUI } = await import("./check-personal-ui.mjs");
  await checkPersonalUI(browser, url, job);
} finally {
  await browser?.close();
  server.kill();
}
const { checkRenderer } = await import("./check-renderer.mjs");
await checkRenderer();
