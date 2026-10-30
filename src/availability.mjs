// Shared by ingestion, history, scoring and the browser. Unknown/blocked is not
// the same as removed; only explicit evidence makes a vacancy unavailable.
export function closedTextReason(text = "") {
  const value = String(text).replace(/\s+/g, " ").slice(0, 6000);
  const chinese =
    /(?:该|該|此|本)?(?:职位|職位|岗位|崗位|職缺|招聘)(?:已经|已經|已|现已|現已)(?:被)?(?:下架|下线|下線|关闭|關閉|结束|結束|失效|过期|過期|删除|刪除|停止招聘|暂停招聘|暫停招聘|招满|招滿)|(?:该|該|此|本)(?:职位|職位|岗位|崗位|職缺)(?:不存在|不再接受申[请請])|(?:job|position|vacancy) (?:has been |is |has )?(?:removed|expired|closed|filled|no longer available|no longer accepting applications)|(?:job|vacancy) not found|applications? (?:are |is )?(?:now )?closed/i;
  return chinese.test(value) ||
    /^(?:no longer accepting applications|applications closed|position filled|job expired)[.! ]*$/i.test(
      value.trim(),
    )
    ? "原页面明确显示职位已下架、关闭或停止招聘"
    : null;
}
export function unavailableReason(job = {}, { now = new Date() } = {}) {
  if (
    job.unavailable ||
    ["closed", "expired", "removed", "offline"].includes(job.status)
  )
    return "岗位已关闭或下架";
  if (/HTTP\s+(?:404|410)\b/.test(job.detailFailure || job.reason || ""))
    return "原岗位链接已不可用（404/410）";
  const date = job.deadline;
  const end =
    typeof date === "string"
      ? Date.parse(date.includes("T") ? date : date + "T23:59:59+08:00")
      : NaN;
  if (Number.isFinite(end) && end < now.getTime()) return "公告已超过截止日期";
  return closedTextReason(
    [job.title, job.detailFailure || job.reason].filter(Boolean).join(" "),
  );
}
export function qualityIssue(job, { now = new Date(), maxAgeHours = 24 } = {}) {
  const unavailable = unavailableReason(job, { now });
  if (unavailable) return unavailable;
  if (job.demo) return null;
  if (
    !["structured-detail", "page-detail", "user-provided-detail"].includes(
      job.verification,
    )
  )
    return "尚未取得完整岗位正文";
  if (
    !job.title ||
    !job.company ||
    !job.city ||
    String(job.description || "").length < 80
  )
    return "缺少职位、雇主、地点或完整正文";
  if (!job.skills?.length && !job.degree && !Number.isFinite(job.experience))
    return "没有可用于匹配的任职要求";
  if (!job.userProvided) {
    const posted = Date.parse(job.postedAt || "");
    if (
      !job.deadline &&
      Number.isFinite(posted) &&
      now.getTime() - posted > 30 * 86400000
    )
      return "发布日期超过 30 天且未披露截止日期，暂不推荐";
    const fetched = Date.parse(job.detailFetchedAt || "");
    if (
      !Number.isFinite(fetched) ||
      now.getTime() - fetched > maxAgeHours * 3600000 ||
      fetched > now.getTime() + 300000
    )
      return "岗位详情超过 24 小时未重读，暂不推荐";
  }
  return null;
}
export function removeUnavailable(index, { now = new Date() } = {}) {
  if (!index) return index;
  const removed = [...(index.jobs || []), ...(index.leads || [])].filter((j) =>
    unavailableReason(j, { now }),
  );
  if (!removed.length) return index;
  const keys = new Set(removed.map((j) => j.url || j.id));
  const jobs = (index.jobs || []).filter((j) => !keys.has(j.url || j.id));
  const leads = (index.leads || []).filter((j) => !keys.has(j.url || j.id));
  const excluded = [
    ...removed.map((j) => ({
      id: j.id,
      title: j.title,
      url: j.url,
      reason: unavailableReason(j, { now }),
      unavailable: true,
      excludedAt: now.toISOString(),
    })),
    ...(index.excluded || []),
  ]
    .filter(
      (j, i, a) =>
        a.findIndex((x) => (x.url || x.id) === (j.url || j.id)) === i,
    )
    .slice(0, 500);
  return {
    ...index,
    jobs,
    leads,
    excluded,
    qualityCleanedAt: now.toISOString(),
    stats: {
      ...(index.stats || {}),
      pending: leads.length,
      excluded: excluded.length,
      activePool: jobs.length,
      companies: new Set(jobs.map((j) => j.company).filter(Boolean)).size,
    },
  };
}
