import { writeFile, mkdir } from "node:fs/promises";
import { searchJobs } from "../src/search.mjs";
const role = process.env.JOB_ROLE || "数据分析";
const preferences = {
  role,
  region: process.env.JOB_REGION || "全部",
  city: process.env.JOB_CITY || "",
  category: "全部",
  employment: "全职",
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
  `Indexed ${result.jobs.length} search leads; not verified active vacancies.`,
);
