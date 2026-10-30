import { sourceMatches } from "./sources.mjs";
import { unavailableReason, qualityIssue } from "./availability.mjs";
import { evaluate } from "./match.mjs";
export function preferenceFilter(job, prefs) {
  if (!sourceMatches(job, prefs.sourceMode)) return false;
  if (prefs.region && prefs.region !== "全部" && job.region !== prefs.region)
    return false;
  if (
    prefs.category &&
    prefs.category !== "全部" &&
    job.category !== prefs.category
  )
    return false;
  const text = [job.title, job.company, job.description]
    .join(" ")
    .toLowerCase();
  const excluded = String(prefs.exclude || "")
    .split(/[,，、\n]/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return !excluded.some((x) => text.includes(x));
}
export function buildBrief(data, profile, prefs, { now = new Date() } = {}) {
  const detailed = (data.jobs || []).filter(
    (j) => !j.demo && preferenceFilter(j, prefs),
  );
  const rows = detailed.map((job) => ({
    job,
    result: evaluate(profile, prefs, job, { now }),
  }));
  const closed = rows.filter((x) => x.result.expired);
  const relevant = rows.filter((x) => !x.result.expired);
  const ready = relevant.filter(
    (x) =>
      !qualityIssue(x.job, { now }) &&
      x.result.match !== null &&
      x.result.roleAligned !== false,
  );
  ready.sort(
    (a, b) =>
      Number(a.result.blockers.length > 0) -
        Number(b.result.blockers.length > 0) ||
      b.result.value - a.result.value ||
      b.result.confidence - a.result.confidence,
  );
  const pending = relevant
    .filter(
      (x) =>
        qualityIssue(x.job, { now }) ||
        x.result.match === null ||
        x.result.roleAligned === false,
    )
    .map((x) => ({
      ...x,
      reason:
        qualityIssue(x.job, { now }) ||
        (x.result.roleAligned === false
          ? "与目标岗位名称尚未明确对应，建议先核实职责"
          : x.result.scoreReason),
    }));
  for (const job of data.leads || [])
    if (!unavailableReason(job, { now }) && preferenceFilter(job, prefs))
      pending.push({
        job,
        result: evaluate(profile, prefs, job, { now }),
        reason: job.detailFailure || "未获取完整职位要求",
      });
  const tasks = [];
  if (
    !String(profile.skills || "").trim() &&
    !String(profile.experience || "").trim()
  )
    tasks.push("先补充技能及工作／项目经历，让评分有个人依据。");
  if (!ready.length)
    tasks.push(
      "本轮没有足够信息的匹配岗位，不必为凑投递数量而申请；先核查待核实线索。",
    );
  if (ready.some((x) => x.job.retained))
    tasks.push(
      "历史保留岗位请先打开雇主原公告核实在招状态，再投入简历准备时间。",
    );
  const missing = [
    ...new Set(ready.slice(0, 3).flatMap((x) => x.result.missing)),
  ].slice(0, 4);
  if (missing.length)
    tasks.push(
      "为重点岗位补充技能证据或学习计划：" + missing.join("、") + "。",
    );
  const top = ready.find(
    (x) =>
      !x.result.blockers.length &&
      !x.result.unverifiedRequirements.length &&
      !x.job.recheckPending &&
      x.result.value >= 50,
  );
  if (top)
    tasks.push(`为「${top.job.title}」准备一份定制简历和可量化成果案例。`);
  if (ready.some((x) => x.job.region === "香港"))
    tasks.push("核实香港工作许可、雇主签证支持及公告列出的语文／考试门槛。");
  const timestamps = Date.parse(data.searchUpdatedAt || data.updatedAt || "");
  const stale =
    !Number.isFinite(timestamps) || now.getTime() - timestamps > 48 * 3600000;
  if (stale)
    tasks.unshift(
      "岗位索引已超过 48 小时或缺少更新时间，先核对原公告是否仍在招聘。",
    );
  return {
    ready,
    pending,
    closed,
    excludedCount:
      (data.stats?.excluded ?? data.excluded?.length ?? 0) +
      (data.leads || []).filter((j) => unavailableReason(j, { now })).length,
    tasks,
    stale,
    total: ready.length + pending.length,
    searchPreferences: data.searchPreferences || null,
  };
}
