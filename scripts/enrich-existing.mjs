import { readFile, writeFile, appendFile } from "node:fs/promises";
import { enrichIndex } from "../src/pipeline.mjs";
const old = JSON.parse(await readFile("public/data/jobs.json", "utf8"));
if (old.mode === "demo")
  throw Error("No real source index is available to enrich");
const { createDetailFetcher } = await import("../src/details.mjs");
const { createBrowserRenderer } = await import("../src/browser.mjs");
let browser, enriched;
try {
  if (process.env.JOB_BROWSER_RENDER === "true")
    browser = await createBrowserRenderer();
  enriched = await enrichIndex(old, {
    detailFetcher: createDetailFetcher({
      renderer: browser?.render,
      renderLimit: 4,
    }),
  });
} finally {
  await browser?.close();
}
const { retainHistory } = await import("../src/history.mjs");
const result = await retainHistory(enriched, old, { recheckLimit: 0 });
await writeFile(
  "public/data/jobs.json",
  JSON.stringify(result, null, 2) + "\n",
);
const summary = `## 岗位详情升级结果\n- 检查来源：${result.stats.discovered}\n- 已取得详情：${result.jobs.length}\n- 待核实：${result.leads.length}\n- 过滤汇总、资讯或已截止：${result.excluded.length}\n\n${result.leads.map((j) => `- ${j.source}: ${j.detailFailure}`).join("\n")}\n`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY)
  await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
