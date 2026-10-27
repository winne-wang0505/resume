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
  const buckets = new Map();
  for (const job of queue) {
    const key = job.region + ":" + (job.searchGroup || "default");
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(job);
  }
  const balanced = [];
  while ([...buckets.values()].some((v) => v.length))
    for (const values of buckets.values())
      if (values.length) balanced.push(values.shift());
  queue.splice(0, queue.length, ...balanced);
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
        const prefs = input.searchPreferences || {};
        const exclude = String(prefs.exclude || "")
          .split(/[,，、/;；\n]/)
          .map((x) => x.trim().toLowerCase())
          .filter(Boolean);
        const body = [job.title, job.company, job.description]
          .join(" ")
          .toLowerCase();
        const hit = exclude.find((word) => body.includes(word));
        const entry = /应届|應屆|fresh|graduate|entry/i.test(
          prefs.experienceLevel || "",
        );
        if (
          hit ||
          (entry && Number.isFinite(job.experience) && job.experience > 0)
        ) {
          excluded.push({
            id: job.id,
            title: job.title,
            url: job.url,
            reason: hit
              ? "包含排除关键词：" + hit
              : "明确要求 " + job.experience + " 年经验，不符合应届条件",
          });
          continue;
        }
        if (
          prefs.employment &&
          prefs.employment !== "不限" &&
          job.employment &&
          job.employment !== prefs.employment
        ) {
          excluded.push({
            id: job.id,
            title: job.title,
            url: job.url,
            reason:
              "用工类型 " +
              job.employment +
              " 不符合 " +
              prefs.employment +
              " 偏好",
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
