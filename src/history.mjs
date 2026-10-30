import { unavailableReason } from "./availability.mjs";
import { cooling, updateHealth } from "./health.mjs";
import { createHash } from "node:crypto";
import { sourceURL, identifySource } from "./sources.mjs";
import { eligibilityIssue, deadlineTime } from "./eligibility.mjs";
const day = 86400000;
const timestamp = (j) => Date.parse(j.detailFetchedAt || j.discoveredAt || "");
export function fingerprint(job) {
  const canonical = sourceURL(job.url, job.region)?.href;
  if (!canonical) return null;
  if (!job.company || !job.description || job.description.length < 80)
    return canonical;
  const clean = (x) =>
    String(x || "")
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}]/gu, "");
  return createHash("sha256")
    .update(
      [
        job.company,
        job.title,
        job.city,
        job.description,
        job.salaryMin,
        job.salaryMax,
        job.deadline,
      ]
        .map(clean)
        .join("|"),
    )
    .digest("hex");
}
export function deduplicateJobs(jobs) {
  const byKey = new Map();
  let duplicates = 0;
  for (const job of jobs) {
    const key = fingerprint(job);
    if (!key) continue;
    const old = byKey.get(key);
    if (!old) {
      byKey.set(key, job);
      continue;
    }
    duplicates++;
    const rank = (j) =>
      (identifySource(j.url, j.region)?.type === "企业官网" ? 10 : 0) +
      (j.retained ? 0 : 2);
    const newer =
      rank(job) > rank(old) ||
      (rank(job) === rank(old) && timestamp(job) > timestamp(old));
    const selected = newer ? job : old,
      other = newer ? old : job;
    byKey.set(key, {
      ...selected,
      firstSeenAt: [old.firstSeenAt, job.firstSeenAt].filter(Boolean).sort()[0],
      alternateSources: [
        ...(selected.alternateSources || []),
        ...(other.alternateSources || []),
        { url: other.url, source: other.source },
      ]
        .filter(
          (x, i, a) =>
            x.url !== selected.url && a.findIndex((y) => y.url === x.url) === i,
        )
        .slice(0, 8),
    });
  }
  return { jobs: [...byKey.values()], duplicates };
}
export async function retainHistory(
  current,
  previous = {},
  {
    now = new Date(),
    detailFetcher,
    recheckLimit = 6,
    retentionDays = 30,
    confirmationDays = 7,
    recheckAfterMs = day,
  } = {},
) {
  const prefs = current.searchPreferences || {},
    cutoff = now.getTime() - retentionDays * day;
  const key = (j) => sourceURL(j.url, j.region)?.href;
  const oldByURL = new Map(
    [...(previous.jobs || []), ...(previous.leads || [])]
      .filter((j) => !j.demo && key(j))
      .map((j) => [key(j), j]),
  );
  const jobs = (current.jobs || []).map((job) => {
    const old = oldByURL.get(key(job));
    return {
      ...job,
      firstSeenAt:
        old?.firstSeenAt ||
        old?.discoveredAt ||
        job.discoveredAt ||
        now.toISOString(),
      lastSeenAt: now.toISOString(),
      retained: false,
    };
  });
  const leads = [...(current.leads || [])],
    excluded = [...(current.excluded || [])];
  const present = new Set(jobs.map(key));
  const closed = new Set(excluded.map(key));
  let kept = 0,
    checked = 0,
    archived = 0;
  let sourceHealth = current.sourceHealth || previous.sourceHealth || {};
  const historicalCandidates = [
    ...(previous.jobs || []),
    ...(previous.leads || []).filter(
      (j) => j.detailFetchedAt && j.fieldEvidence && j.company,
    ),
  ];
  const oldJobs = historicalCandidates
    .filter(
      (j, i, a) =>
        !j.demo && key(j) && a.findIndex((x) => key(x) === key(j)) === i,
    )
    .sort((a, b) => timestamp(a) - timestamp(b));
  for (const old of oldJobs) {
    const url = key(old);
    if (present.has(url) || closed.has(url)) continue;
    const first = Math.max(
      ...[old.lastSeenAt, old.detailFetchedAt, old.discoveredAt]
        .map(Date.parse)
        .filter(Number.isFinite),
    );
    const issue = eligibilityIssue(old, prefs, { now });
    if (issue || !Number.isFinite(first) || first < cutoff) {
      excluded.push({
        id: old.id,
        title: old.title,
        url: old.url,
        reason: issue || "历史保留期已超过 " + retentionDays + " 天",
        ...(unavailableReason(old, { now })
          ? { unavailable: true, excludedAt: now.toISOString() }
          : {}),
      });
      archived++;
      continue;
    }
    const pendingIndex = leads.findIndex((j) => key(j) === url);
    const pending = pendingIndex >= 0 ? leads[pendingIndex] : null;
    if (pending && unavailableReason(pending, { now })) {
      excluded.push({
        id: old.id,
        title: old.title,
        url: old.url,
        reason: unavailableReason(pending, { now }),
        unavailable: true,
        excludedAt: now.toISOString(),
      });
      leads.splice(pendingIndex, 1);
      archived++;
      continue;
    }
    let job = pending
        ? {
            ...old,
            detailAttemptedAt: pending.detailAttemptedAt || now.toISOString(),
          }
        : old,
      reason = pending?.detailFailure || "本轮未检索到，保留最近已读取的详情";
    if (
      !pending &&
      !cooling(sourceHealth, identifySource(old.url)?.id, now) &&
      detailFetcher &&
      checked < recheckLimit &&
      now.getTime() -
        Date.parse(
          old.detailAttemptedAt ||
            old.detailFetchedAt ||
            old.discoveredAt ||
            "",
        ) >=
        recheckAfterMs
    ) {
      checked++;
      const result = await detailFetcher(old);
      sourceHealth = updateHealth(sourceHealth, [{ lead: old, result }], now);
      if (result.ok) {
        job = result.job;
        const disqualified = eligibilityIssue(job, prefs, { now });
        if (disqualified) {
          excluded.push({
            id: job.id,
            title: job.title,
            url: job.url,
            reason: disqualified,
            ...(unavailableReason(job, { now })
              ? { unavailable: true, excludedAt: now.toISOString() }
              : {}),
          });
          archived++;
          continue;
        }
        reason = "历史岗位已重新读取公告";
      } else {
        job = { ...old, detailAttemptedAt: now.toISOString() };
        reason = result.reason;
        if (unavailableReason(result, { now })) {
          excluded.push({
            id: old.id,
            title: old.title,
            url: old.url,
            reason: unavailableReason(result, { now }),
            unavailable: true,
            excludedAt: now.toISOString(),
          });
          archived++;
          continue;
        }
      }
    }
    if (pendingIndex >= 0) leads.splice(pendingIndex, 1);
    if (
      !Number.isFinite(timestamp(job)) ||
      now.getTime() - timestamp(job) > confirmationDays * day
    ) {
      leads.push({
        ...job,
        verification: "search-result",
        retained: true,
        detailFailure:
          "历史详情超过 " + confirmationDays + " 天未成功复核：" + reason,
      });
      continue;
    }
    jobs.push({
      ...job,
      firstSeenAt: old.firstSeenAt || old.discoveredAt || old.detailFetchedAt,
      lastSeenAt: old.lastSeenAt || old.discoveredAt,
      retained: true,
      retentionReason: reason,
      recheckPending: now.getTime() - timestamp(job) >= day,
    });
    kept++;
    present.add(url);
  }
  const leadKeys = new Set([...jobs, ...leads, ...excluded].map(key));
  for (const old of previous.leads || []) {
    const url = key(old);
    if (!url || leadKeys.has(url) || old.demo) continue;
    const gone = unavailableReason(old, { now });
    if (gone) {
      excluded.push({
        id: old.id,
        title: old.title,
        url: old.url,
        reason: gone,
        unavailable: true,
        excludedAt: now.toISOString(),
      });
      leadKeys.add(url);
      continue;
    }
    const first = Date.parse(old.firstSeenAt || old.discoveredAt || "");
    if (
      !Number.isFinite(first) ||
      now.getTime() - first > 14 * day ||
      eligibilityIssue(old, prefs, { now, titleOnly: true })
    )
      continue;
    leads.push({
      ...old,
      retained: true,
      detailFailure: old.detailFailure || "历史线索，尚未取得完整要求",
    });
    leadKeys.add(url);
  }
  const deduped = deduplicateJobs(jobs);
  const uniqueExcluded = excluded
    .filter((j, i, a) => a.findIndex((x) => x.url === j.url) === i)
    .sort(
      (a, b) =>
        Number(!!b.unavailable) - Number(!!a.unavailable) ||
        String(b.excludedAt || "").localeCompare(String(a.excludedAt || "")),
    )
    .slice(0, 500);
  return {
    ...current,
    sourceHealth,
    schemaVersion: 3,
    jobs: deduped.jobs,
    leads,
    excluded: uniqueExcluded,
    stats: {
      ...current.stats,
      activePool: deduped.jobs.length,
      historyRetained: deduped.jobs.filter((j) => j.retained).length,
      historyRechecked: checked,
      historyArchived: archived,
      duplicatesRemoved: deduped.duplicates,
      companies: new Set(deduped.jobs.map((j) => j.company).filter(Boolean))
        .size,
      pending: leads.length,
      excluded: uniqueExcluded.length,
    },
  };
}
