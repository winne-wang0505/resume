const terms = (value) =>
  String(value || "")
    .split(/[,，、/;；\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
const hk = /香港|hong kong|kowloon|new territories|九龍|九龙|新界|港島|港岛/i;
const cityTitle =
  /^[【\[]\s*(北京|上海|天津|重庆|深圳|广州|杭州|南京|苏州|成都|武汉|西安|长沙|合肥|郑州|济南|青岛|宁波|厦门|福州|珠海|东莞|佛山|香港|澳门|无锡|常州|南昌|昆明|南宁|贵阳|大连|沈阳|哈尔滨|长春|温州|嘉兴)(?:市|\s|[-·])/;
export function deadlineTime(job) {
  const value = job.deadline;
  return value
    ? Date.parse(value.includes("T") ? value : value + "T23:59:59+08:00")
    : NaN;
}
export function normalizedMarket(job) {
  if (job.countries?.length === 1 && job.countries[0] === "HK") return "香港";
  if (job.countries?.length === 1 && job.countries[0] === "CN") return "内地";
  return hk.test(job.city || "") ? "香港" : job.region;
}
export function eligibilityIssue(
  job,
  prefs = {},
  { now = new Date(), titleOnly = false } = {},
) {
  if (
    job.status === "closed" ||
    (Number.isFinite(deadlineTime(job)) && deadlineTime(job) < now.getTime())
  )
    return "公告已截止或明确关闭";
  if (
    !titleOnly &&
    job.countries?.length &&
    !job.countries.some((c) => ["CN", "HK"].includes(c))
  )
    return "公告工作国家不在内地／香港范围";
  const region = normalizedMarket(job);
  if (prefs.region && prefs.region !== "全部" && region !== prefs.region)
    return "工作地区不符合当前目标范围";
  const targets = terms(prefs.city),
    city = job.city || String(job.title || "").match(cityTitle)?.[1];
  if (
    targets.length &&
    city &&
    !targets.some(
      (t) =>
        city.toLowerCase().includes(t.toLowerCase()) ||
        t.toLowerCase().includes(city.toLowerCase()) ||
        (hk.test(t) && hk.test(city)),
    )
  )
    return "公告地点 " + city + " 不在目标城市范围";
  const text = [job.title, job.company, titleOnly ? "" : job.description]
    .join(" ")
    .toLowerCase();
  const hit = terms(prefs.exclude).find((word) =>
    text.includes(word.toLowerCase()),
  );
  if (hit) return "包含排除关键词：" + hit;
  if (
    !titleOnly &&
    /应届|應屆|fresh|graduate|entry/i.test(prefs.experienceLevel || "") &&
    Number.isFinite(job.experience) &&
    job.experience > 0
  )
    return "明确要求 " + job.experience + " 年经验，不符合应届条件";
  if (
    !titleOnly &&
    prefs.employment &&
    prefs.employment !== "不限" &&
    job.employment &&
    job.employment !== prefs.employment
  )
    return (
      "用工类型 " + job.employment + " 不符合 " + prefs.employment + " 偏好"
    );
  return null;
}
