import { createHash } from "node:crypto";
const sources = {
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
export function normalizePreferences(p = {}) {
  const clean = (x) =>
    typeof x === "string"
      ? x
          .replace(/[\r\n\t]/g, " ")
          .trim()
          .slice(0, 120)
      : "";
  return {
    role: clean(p.role),
    skills: clean(p.skills),
    major: clean(p.major),
    city: clean(p.city),
    region: ["内地", "香港"].includes(p.region) ? p.region : "全部",
    category: clean(p.category),
    employment: clean(p.employment),
    hours: clean(p.hours),
    majorReq: clean(p.majorReq),
    content: clean(p.content),
    exclude: clean(p.exclude),
    mode: clean(p.mode),
  };
}
export function buildQuery(p, region) {
  const extra = [
    p.city,
    p.skills,
    p.major,
    p.category !== "全部" ? p.category : "",
    p.employment !== "不限" ? p.employment : "",
    p.hours,
    p.majorReq,
    p.content,
    p.mode !== "不限" ? p.mode : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `${p.role} ${extra} ${region === "香港" ? "香港 招聘 vacancy" : "招聘 职位"} (${sources[region].map((x) => "site:" + x).join(" OR ")})`;
}
function sourceHost(raw, region) {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    return sources[region].find(
      (d) => u.hostname === d || u.hostname.endsWith("." + d),
    )
      ? u
      : null;
  } catch {
    return null;
  }
}
export async function searchJobs(
  preferences,
  { key = process.env.BRAVE_SEARCH_API_KEY, fetcher = fetch } = {},
) {
  const p = normalizePreferences(preferences);
  if (!p.role) throw new Error("请填写目标岗位");
  if (!key) {
    const e = new Error(
      "实时岗位检索尚未配置：请在后台安全设置 BRAVE_SEARCH_API_KEY",
    );
    e.status = 503;
    throw e;
  }
  const jobs = [];
  const errors = [];
  for (const region of p.region === "全部" ? ["内地", "香港"] : [p.region]) {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.search = new URLSearchParams({
      q: buildQuery(p, region),
      count: "20",
      freshness: "pm",
      country: region === "香港" ? "HK" : "CN",
      search_lang: region === "香港" ? "zh-hant" : "zh-hans",
    });
    try {
      const res = await fetcher(url, {
        headers: { Accept: "application/json", "X-Subscription-Token": key },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`搜索服务响应 ${res.status}`);
      const data = await res.json();
      for (const item of data.web?.results || []) {
        const u = sourceHost(item.url, region);
        if (!u) continue;
        const plain = (s) =>
          String(s || "")
            .replace(/<[^>]*>/g, "")
            .slice(0, 2000);
        const title = plain(item.title);
        const desc = plain(item.description);
        const exclusions = p.exclude
          .split(/[,，、]/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (
          exclusions.some((w) =>
            (title + " " + desc).toLowerCase().includes(w.toLowerCase()),
          )
        )
          continue;
        const id = createHash("sha256")
          .update(u.href)
          .digest("hex")
          .slice(0, 18);
        if (jobs.some((j) => j.id === id)) continue;
        jobs.push({
          id,
          title,
          company: null,
          region,
          category: "待核实",
          city: null,
          skills: [],
          description: desc,
          source: u.hostname,
          url: u.href,
          discoveredAt: new Date().toISOString(),
          verification: "search-result",
          demo: false,
        });
      }
    } catch (e) {
      errors.push(`${region}：${e.message}`);
    }
  }
  if (!jobs.length && errors.length) {
    const e = new Error(errors.join("；"));
    e.status = 502;
    throw e;
  }
  return {
    updatedAt: new Date().toISOString(),
    mode: "search",
    jobs,
    warnings: errors,
    notice:
      "搜索结果为近一个月收录的招聘线索，可能包含汇总页或已结束岗位；非经核验的在招职位，发布时间、要求与薪资需以原公告为准。",
  };
}
