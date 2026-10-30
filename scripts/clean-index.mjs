// Metadata-only cleanup: no search requests, no inferred vacancy state.
import { readFile, writeFile } from "node:fs/promises";
import { removeUnavailable } from "../src/availability.mjs";
import { sourceMatches } from "../src/sources.mjs";
const file = "public/data/jobs.json";
const old = JSON.parse(await readFile(file, "utf8"));
const cleaned = removeUnavailable(old);
const mode = process.env.JOB_SOURCE_MODE || "standard";
const excluded = [...(cleaned.excluded || [])];
const filter = (job) => {
  if (sourceMatches(job, mode)) return true;
  excluded.push({
    id: job.id,
    title: job.title,
    url: job.url,
    reason: "来源已退出当前精选范围",
  });
  return false;
};
const jobs = (cleaned.jobs || []).filter(filter),
  leads = (cleaned.leads || []).filter(filter);
const result = {
  ...cleaned,
  jobs,
  leads,
  excluded: excluded
    .filter((j, i, a) => a.findIndex((x) => x.url === j.url) === i)
    .slice(0, 500),
  searchPreferences: { ...(cleaned.searchPreferences || {}), sourceMode: mode },
  stats: {
    ...(cleaned.stats || {}),
    activePool: jobs.length,
    pending: leads.length,
    companies: new Set(jobs.map((j) => j.company).filter(Boolean)).size,
  },
};
result.stats.excluded = result.excluded.length;
await writeFile(file, JSON.stringify(result, null, 2) + "\n");
console.log(
  `Metadata cleanup: ${old.jobs?.length || 0}/${old.leads?.length || 0} jobs/leads -> ${jobs.length}/${leads.length}; no paid search calls.`,
);
