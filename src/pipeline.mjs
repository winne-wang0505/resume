import { classifyLink } from "./sources.mjs";
import { createDetailFetcher } from "./details.mjs";

export async function enrichIndex(
  input,
  {
    detailFetcher = createDetailFetcher(),
    maxDetails = 20,
    now = new Date(),
  } = {},
) {
  const candidates = [...(input.jobs || []), ...(input.leads || [])].filter(
    (j) => !j.demo,
  );
  const seen = new Set(),
    queue = [],
    excluded = [],
    leads = [],
    jobs = [];
  for (const candidate of candidates) {
    if (!candidate.url || seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    const j = { ...candidate };
    delete j.detailFailure;
    const classification = classifyLink(j);
    if (classification.kind === "excluded") {
      excluded.push({
        id: j.id,
        title: j.title,
        url: j.url,
        reason: classification.reason,
      });
      continue;
    }
    queue.push(j);
  }
  let index = 0,
    attempted = 0;
  async function worker() {
    while (index < queue.length) {
      const n = index++,
        lead = queue[n];
      if (n >= maxDetails) {
        leads.push({
          ...lead,
          verification: "search-result",
          detailFailure: "本轮详情读取限额已达，留待后续核实",
        });
        continue;
      }
      attempted++;
      let result;
      try {
        result = await detailFetcher(lead);
      } catch {
        result = { ok: false, reason: "来源读取失败" };
      }
      if (result.ok) {
        const job = result.job;
        if (job.status === "closed") {
          excluded.push({
            id: job.id,
            title: job.title,
            url: job.url,
            reason: "公告已截止或页面明确关闭",
          });
          continue;
        }
        jobs.push(job);
      } else
        leads.push({
          ...lead,
          verification: "search-result",
          detailFailure: result.reason,
          detailAttemptedAt: now.toISOString(),
        });
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  jobs.sort((a, b) => a.id.localeCompare(b.id));
  leads.sort((a, b) => a.id.localeCompare(b.id));
  return {
    schemaVersion: 2,
    updatedAt: now.toISOString(),
    mode: "enriched",
    jobs,
    leads,
    excluded,
    searchPreferences: input.searchPreferences || null,
    searchUpdatedAt: input.searchUpdatedAt || input.updatedAt || null,
    warnings: input.warnings || [],
    stats: {
      discovered: seen.size,
      detailAttempts: attempted,
      detailSuccess: jobs.length,
      pending: leads.length,
      excluded: excluded.length,
    },
    notice:
      "详情字段取自公开招聘页或 JobPosting 元数据，每个已提取要求附有来源证据；仍需在投递前核实在招状态、工作许可和所有门槛。未提取到的信息不会推测。",
  };
}
