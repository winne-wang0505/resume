import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createDetailFetcher } from "../src/details.mjs";
import { createBrowserRenderer } from "../src/browser.mjs";
import { searchJobs } from "../src/search.mjs";
const role = process.env.JOB_ROLE || "数据分析";
const preferences = {
  role,
  sourceMode: process.env.JOB_SOURCE_MODE || "standard",
  region: process.env.JOB_REGION || "全部",
  city: process.env.JOB_CITY || "",
  category: "全部",
  employment: process.env.JOB_EMPLOYMENT || "全职",
  experienceLevel: process.env.JOB_EXPERIENCE || "",
  mode: "不限",
  exclude: process.env.JOB_EXCLUDE || "",
};
if (!process.env.BRAVE_SEARCH_API_KEY) {
  console.error(
    "Missing BRAVE_SEARCH_API_KEY. Existing index preserved; live discovery unavailable.",
  );
  process.exit(1);
}
const previousIndex = JSON.parse(
  await readFile("public/data/jobs.json", "utf8"),
);
let browser;
let result;
try {
  if (process.env.JOB_BROWSER_RENDER === "true")
    browser = await createBrowserRenderer();
  result = await searchJobs(preferences, {
    previousIndex,
    detailFetcher: createDetailFetcher({
      renderer: browser?.render,
      renderLimit: 4,
    }),
  });
} finally {
  await browser?.close();
}
if (result.warnings.length)
  console.warn("Search notes: " + result.warnings.join("；"));
await mkdir("public/data", { recursive: true });
await writeFile(
  "public/data/jobs.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  `Processed ${result.stats.discovered} sources: ${result.jobs.length} jobs in pool (${result.stats.historyRetained || 0} retained), ${result.leads.length} pending, ${result.excluded.length} excluded. Search requests today: ${result.searchUsage.requests}/${result.searchUsage.limit}.`,
);

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFile } = await import("node:fs/promises");
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    `## 岗位处理结果\n- 当日搜索请求：${result.searchUsage.requests}/${result.searchUsage.limit}\n- 本轮搜索请求：${result.coverage.requestsThisRun}（翻页 ${result.coverage.paginationRequests}）\n- 历史保留：${result.stats.historyRetained || 0}\n- 覆盖企业：${result.stats.companies || 0}\n- 来源链接：${result.stats.discovered}\n- 已获得具体详情：${result.jobs.length}\n- 待核实：${result.leads.length}\n- 已过滤：${result.excluded.length}\n\n${result.leads
      .slice(0, 10)
      .map((j) => `- ${j.source}: ${j.detailFailure}`)
      .join("\n")}\n`,
  );
}
