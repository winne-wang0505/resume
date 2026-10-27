import { writeFile, mkdir } from "node:fs/promises";
import { searchJobs } from "../src/search.mjs";
const role = process.env.JOB_ROLE || "数据分析";
const preferences = {
  role,
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
const result = await searchJobs(preferences);
if (result.warnings.length) {
  console.error(
    "Incomplete source refresh; preserving previous index. " +
      result.warnings.join("; "),
  );
  process.exit(1);
}
await mkdir("public/data", { recursive: true });
await writeFile(
  "public/data/jobs.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  `Processed ${result.stats.discovered} sources: ${result.jobs.length} detailed jobs, ${result.leads.length} pending, ${result.excluded.length} excluded.`,
);

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFile } = await import("node:fs/promises");
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    `## 岗位处理结果\n- 来源链接：${result.stats.discovered}\n- 已获得具体详情：${result.jobs.length}\n- 待核实：${result.leads.length}\n- 已过滤：${result.excluded.length}\n\n${result.leads
      .slice(0, 10)
      .map((j) => `- ${j.source}: ${j.detailFailure}`)
      .join("\n")}\n`,
  );
}
