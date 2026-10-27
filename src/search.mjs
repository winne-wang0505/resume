import { createHash } from "node:crypto";
import { sourceURL } from "./sources.mjs";
import { enrichIndex } from "./pipeline.mjs";
import { setTimeout as delay } from "node:timers/promises";
const splitTerms = (value) =>
  String(value || "")
    .split(/[,，、/;；\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
export function normalizePreferences(p = {}) {
  const clean = (x) =>
    typeof x === "string"
      ? x
          .replace(/[\r\n\t]/g, " ")
          .trim()
          .slice(0, 200)
      : "";
  const embedded = {};
  const raw = String(p.role || "").slice(0, 2000);
  for (const m of raw.matchAll(
    /\bJOB[_\s]*(TYPE|ROLE|REGION|CITY|EXCLUDE|NATURE|EMPLOYMENT|EXPERIENCE)\s*[:：]?\s*([\s\S]*?)(?=\bJOB[_\s]*(?:TYPE|ROLE|REGION|CITY|EXCLUDE|NATURE|EMPLOYMENT|EXPERIENCE)\b|$)/gi,
  ))
    embedded[m[1].toUpperCase()] = m[2].trim();
  const role = clean(embedded.ROLE || embedded.TYPE || raw);
  const roles = splitTerms(role).slice(0, 9);
  const regionText = embedded.REGION || "";
  const inferredCities = splitTerms(embedded.CITY || regionText).filter(
    (x) => !["全部", "内地", "中国内地", "香港", "中国香港"].includes(x),
  );
  if (/香港/.test(embedded.CITY || regionText)) inferredCities.push("香港");
  const cities = splitTerms(p.city || inferredCities.join("、")).slice(0, 6);
  let region = ["内地", "香港"].includes(p.region) ? p.region : "全部";
  if (region === "全部" && regionText) {
    const parts = splitTerms(regionText);
    region = parts.every((x) => /^(?:中国)?香港$/.test(x))
      ? "香港"
      : parts.some((x) => /香港|全部/.test(x))
        ? "全部"
        : "内地";
  }
  const legacyEmployment = splitTerms(
    embedded.EMPLOYMENT || embedded.NATURE || "",
  );
  const employment =
    legacyEmployment.length > 1
      ? "不限"
      : clean(legacyEmployment[0] || p.employment);
  return {
    role: roles.join("、"),
    roles,
    skills: clean(p.skills),
    major: clean(p.major),
    city: cities.join("、"),
    cities,
    region,
    category: clean(p.category),
    employment,
    hours: clean(p.hours),
    majorReq: clean(p.majorReq),
    content: clean(p.content),
    exclude: splitTerms(p.exclude || embedded.EXCLUDE || "").join("、"),
    mode: clean(p.mode),
    experienceLevel: clean(p.experienceLevel || embedded.EXPERIENCE || ""),
    legacyInput: Object.keys(embedded).length > 0,
  };
}
export function buildQuery(
  p,
  region,
  roles = (p.roles || [p.role]).slice(0, 3),
  batch = 0,
) {
  const aliases = {
    数据分析: ["数据分析", "Data Analyst"],
    数据分析师: ["数据分析师", "Data Analyst"],
    商业分析: ["商业分析", "Business Analyst"],
    产品运营: ["产品运营", "Product Operations"],
    金融: ["金融", "Finance"],
    会计: ["会计", "Accountant"],
    大模型: ["大模型", "LLM"],
    算法: ["算法", "Algorithm"],
    开发: ["开发", "Developer"],
    运营: ["运营", "Operations"],
    产品: ["产品", "Product"],
    快消: ["快消", "FMCG"],
  };
  const safe = (x) => String(x).replace(/["()]/g, " ").trim();
  const terms = [
    ...new Set(roles.flatMap((role) => aliases[role] || [role])),
  ].map(safe);
  const role =
    terms.length > 1
      ? `(${terms.map((x) => '"' + x + '"').join(" OR ")})`
      : safe(terms[0] || p.role);
  const cities = (p.cities || splitTerms(p.city))
    .filter((x) => (region === "香港" ? /香港/.test(x) : !/香港/.test(x)))
    .slice(0, 3);
  const location =
    cities.length > 1 ? `(${cities.map(safe).join(" OR ")})` : cities[0] || "";
  const pools =
    region === "香港"
      ? [
          [
            "hk.jobsdb.com/job/",
            "jobs.ctgoodjobs.hk/job/",
            "csboa1.csb.gov.hk/csboa/jve/",
          ],
          ["hk.jobsdb.com/job/", "hk.indeed.com/viewjob", "jobs.gov.hk"],
          [
            "jobs.ctgoodjobs.hk/job/",
            "careers.gov.hk",
            "csboa1.csb.gov.hk/csboa/jve/",
          ],
        ]
      : [
          ["jobs.zhaopin.com", "liepin.com/job/", "iguopin.com/job/"],
          ["jobs.51job.com", "liepin.com/a/", "scs.gov.cn"],
          ["liepin.com/job/", "mohrss.gov.cn", "sasac.gov.cn"],
        ];
  const source = `(${pools[batch % pools.length].map((x) => "site:" + x).join(" OR ")})`;
  const entry = /应届|應屆|fresh|graduate|entry/i.test(p.experienceLevel || "")
    ? region === "香港"
      ? '(graduate OR "entry level")'
      : "(应届 OR 校招)"
    : "";
  const exclude = splitTerms(p.exclude)
    .slice(0, 4)
    .map((x) => '-"' + safe(x) + '"')
    .join(" ");
  const primary = `${role} ${location} ${entry} ${source} ${exclude}`;
  // Keep within search-provider query limits; user input is always treated as keywords.
  const extra = [
    p.employment && p.employment !== "不限" ? p.employment : "",
    p.skills,
    p.major,
    p.category && p.category !== "全部" ? p.category : "",
    p.hours,
    p.majorReq,
    p.content,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, Math.max(0, 350 - primary.length));
  return (primary + " " + extra).trim();
}
export async function searchJobs(
  preferences,
  {
    key = process.env.BRAVE_SEARCH_API_KEY,
    fetcher = fetch,
    enrich = true,
    detailFetcher,
  } = {},
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
  const plans = [];
  for (let start = 0; start < p.roles.length; start += 3)
    for (const region of p.region === "全部" ? ["内地", "香港"] : [p.region])
      plans.push({
        region,
        roles: p.roles.slice(start, start + 3),
        batch: start / 3,
      });
  for (const [queryIndex, plan] of plans.entries()) {
    const { region, roles, batch } = plan;
    if (queryIndex) await delay(1100);
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.search = new URLSearchParams({
      q: buildQuery(p, region, roles, batch),
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
        const u = sourceURL(item.url, region);
        if (!u) continue;
        const plain = (s) =>
          String(s || "")
            .replace(/<[^>]*>/g, "")
            .slice(0, 2000);
        const title = plain(item.title);
        const desc = plain(item.description);
        const exclusions = p.exclude
          .split(/[,，、/]/)
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
          searchGroup: roles.join("、"),
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
  const result = {
    searchPreferences: {
      role: p.role,
      region: p.region,
      city: p.city,
      category: p.category,
      exclude: p.exclude,
      employment: p.employment,
      experienceLevel: p.experienceLevel,
      legacyInput: p.legacyInput,
    },
    updatedAt: new Date().toISOString(),
    mode: "search",
    jobs,
    warnings: errors,
    notice:
      "搜索结果为近一个月收录的招聘线索，可能包含汇总页或已结束岗位；非经核验的在招职位，发布时间、要求与薪资需以原公告为准。",
  };
  return enrich ? enrichIndex(result, { detailFetcher }) : result;
}
