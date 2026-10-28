import { updateHealth, cooling } from "./health.mjs";
import { classifyLink, identifySource } from "./sources.mjs";
import { createDetailFetcher } from "./details.mjs";
import { eligibilityIssue, normalizedMarket } from "./eligibility.mjs";

export async function enrichIndex(
  input,
  {
    detailFetcher = createDetailFetcher(),
    maxDetails = 36,
    now = new Date(),
    cacheResolver = () => null,
    sourceHealth = input.sourceHealth || {},
  } = {},
) {
  const candidates = [...(input.jobs || []), ...(input.leads || [])].filter(
    (j) => !j.demo,
  );
  const seen = new Set(),
    queue = [],
    excluded = [...(input.excluded || [])],
    leads = [],
    jobs = [];
  for (const candidate of candidates) {
    if (!candidate.url || seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    const j = { ...candidate };
    const source = identifySource(j.url, j.region);
    if (source) {
      j.sourceType = source.type;
      j.sourceLabel = source.name;
    }
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
    const earlyIssue = eligibilityIssue(j, input.searchPreferences || {}, {
      now,
      titleOnly: true,
    });
    if (earlyIssue) {
      excluded.push({
        id: j.id,
        title: j.title,
        url: j.url,
        reason: earlyIssue,
      });
      continue;
    }
    queue.push(j);
  }
  const buckets = new Map();
  for (const job of queue) {
    const key = job.region + ":" + (job.searchGroup || "default");
    if (!buckets.has(key)) buckets.set(key, new Map());
    const channels = buckets.get(key),
      channel = job.sourceType || "公共来源";
    if (!channels.has(channel)) channels.set(channel, []);
    channels.get(channel).push(job);
  }
  const groups = [...buckets.values()].map((channels, i) => ({
    channels: [...channels.values()],
    cursor: (Math.floor(now.getTime() / 86400000) + i) % channels.size,
  }));
  const balanced = [];
  while (groups.some((g) => g.channels.some((q) => q.length)))
    for (const group of groups) {
      for (let count = 0; count < group.channels.length; count++) {
        const q = group.channels[group.cursor++ % group.channels.length];
        if (q.length) {
          balanced.push(q.shift());
          break;
        }
      }
    }
  queue.splice(0, queue.length, ...balanced);
  const healthResults = [];
  let index = 0,
    attempted = 0;
  async function worker() {
    while (index < queue.length) {
      const n = index++,
        lead = queue[n];
      const cached = cacheResolver(lead);
      const source = identifySource(lead.url);
      if (!cached && cooling(sourceHealth, source?.id, now)) {
        leads.push({
          ...lead,
          verification: "search-result",
          detailFailure:
            "此来源连续访问受限，暂缓自动读取两天；可打开原页后粘贴正文分析",
        });
        continue;
      }
      if (!cached && attempted >= maxDetails) {
        leads.push({
          ...lead,
          verification: "search-result",
          detailFailure: "本轮详情读取限额已达，留待后续核实",
        });
        continue;
      }
      let result;
      if (!cached) attempted++;
      try {
        result = cached
          ? { ok: true, job: { ...cached } }
          : await detailFetcher(lead);
      } catch {
        result = { ok: false, reason: "来源读取失败" };
      }
      if (!cached) healthResults.push({ lead, result });
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
        job.region = normalizedMarket(job);
        const issue = eligibilityIssue(job, input.searchPreferences || {}, {
          now,
        });
        if (issue) {
          excluded.push({
            id: job.id,
            title: job.title,
            url: job.url,
            reason: issue,
          });
          continue;
        }
        jobs.push(job);
      } else
        leads.push({
          ...lead,
          verification: "search-result",
          detailFailure: result.reason,
          extractionNotes: result.extractionNotes,
          detailAttemptedAt: now.toISOString(),
        });
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  jobs.sort((a, b) => a.id.localeCompare(b.id));
  leads.sort((a, b) => a.id.localeCompare(b.id));
  return {
    schemaVersion: 3,
    sourceHealth: updateHealth(sourceHealth, healthResults, now),
    searchUsage: input.searchUsage || null,
    coverage: input.coverage || null,
    updatedAt: now.toISOString(),
    mode: "enriched",
    jobs,
    leads,
    excluded,
    searchPreferences: input.searchPreferences || null,
    searchUpdatedAt: input.searchUpdatedAt || input.updatedAt || null,
    warnings: input.warnings || [],
    stats: {
      discovered: new Set([
        ...seen,
        ...(input.excluded || []).map((j) => j.url),
      ]).size,
      detailAttempts: attempted,
      detailSuccess: jobs.length,
      pending: leads.length,
      excluded: excluded.length,
    },
    notice:
      "详情字段取自公开招聘页或 JobPosting 元数据，每个已提取要求附有来源证据；仍需在投递前核实在招状态、工作许可和所有门槛。未提取到的信息不会推测。",
  };
}
