export const sources = {
  内地: [
    "zhaopin.com",
    "liepin.com",
    "51job.com",
    "iguopin.com",
    "sasac.gov.cn",
    "mohrss.gov.cn",
    "scs.gov.cn",
    "gov.cn",
  ],
  香港: [
    "hk.jobsdb.com",
    "ctgoodjobs.hk",
    "jobs.gov.hk",
    "csb.gov.hk",
    "careers.gov.hk",
    "hk.indeed.com",
  ],
};
export function sourceURL(raw, region) {
  try {
    const u = new URL(raw);
    const allowed = region
      ? sources[region] || []
      : Object.values(sources).flat();
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      (u.port && u.port !== "443")
    )
      return null;
    if (!allowed.some((d) => u.hostname === d || u.hostname.endsWith("." + d)))
      return null;
    u.hash = "";
    for (const key of [...u.searchParams.keys()])
      if (/^(utm_|tracking|ref$|source$)/i.test(key))
        u.searchParams.delete(key);
    return u;
  } catch {
    return null;
  }
}
export function classifyLink(job) {
  const u = sourceURL(job.url, job.region);
  if (!u) return { kind: "excluded", reason: "来源不在支持范围" };
  const p = decodeURIComponent(u.pathname);
  if (/\.(pdf|xlsx?|docx?|zip)$/i.test(p))
    return { kind: "excluded", reason: "附件或非网页内容，暂不解析" };
  const detail =
    /\/job\/(?:\d+|[a-z0-9-]+\/\d+)|\/a\/\d+\.shtml|\/viewjob|\/jobdetail\/|\/job\/detail|\/jobs\/[^/]+\.html/i.test(
      p,
    ) ||
    (/jobs\.zhaopin\.com$/.test(u.hostname) &&
      /\/[a-z0-9_-]+\.html?$/i.test(p)) ||
    (/jobs\.51job\.com$/.test(u.hostname) && /\/\d+\.html$/i.test(p)) ||
    (/csb\.gov\.hk$/.test(u.hostname) && !!u.searchParams.get("jobid"));
  if (detail) return { kind: "detail", reason: null };
  if (p === "/" || /^\/(?:zh|en|zh-cn|zh-hk)\/?$/i.test(p))
    return { kind: "excluded", reason: "招聘平台首页" };
  if (
    /\/zhaopin\/|\/company-jobs\/|(?:^|\/)q-[^/]+jobs|[^/]-jobs(?:\/|$)|\/city-[^/]+\/|\/search(?:\/|$)|\/jobs-search/i.test(
      p,
    )
  )
    return { kind: "excluded", reason: "搜索结果或岗位汇总页" };
  if (
    /招聘会|招聘會|招聘\d+人|\d+家企业|\d+个岗位|\d+\+|招聘平台|找工作.*求职|職位空缺一覽|入行.*人工/i.test(
      job.title || "",
    )
  )
    return { kind: "excluded", reason: "招聘活动、资讯或汇总页" };
  return { kind: "candidate", reason: "需检查页面是否包含单一职位" };
}
