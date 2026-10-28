import { createHash } from "node:crypto";
import {
  sourceURL,
  identifySource,
  querySources,
  sourceCatalog,
  classifyLink,
} from "./sources.mjs";
import { createDetailFetcher } from "./details.mjs";
import { retainHistory } from "./history.mjs";
import { deadlineTime } from "./eligibility.mjs";
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
  roles = (p.roles || [p.role]).slice(0, 1),
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
  const names = {
    香港: ["Hong Kong"],
    上海: ["上海", "Shanghai"],
    杭州: ["杭州", "Hangzhou"],
    深圳: ["深圳", "Shenzhen"],
    北京: ["北京", "Beijing"],
  };
  const cityTerms = cities.flatMap((city) => names[city] || [city]);
  const location =
    cityTerms.length > 1
      ? `(${cityTerms.map((x) => '"' + safe(x) + '"').join(" OR ")})`
      : cityTerms[0]
        ? '"' + safe(cityTerms[0]) + '"'
        : "";
  const selected = querySources(
    region,
    batch,
    p.sourceDay || 0,
    roles[0] || p.role,
    p.sourceHealth || {},
  );
  const source = `(${selected.map((x) => "site:" + (x.search || x.host)).join(" OR ")})`;
  const entry = /应届|應屆|fresh|graduate|entry/i.test(p.experienceLevel || "")
    ? region === "香港"
      ? "(graduate OR internship OR junior)"
      : "(应届 OR 校招 OR 实习)"
    : "";
  const exclude = splitTerms(p.exclude)
    .slice(0, 4)
    .map((x) => '-"' + safe(x) + '"')
    .join(" ");
  let primary = `${role} ${source}`;
  for (const part of [location, entry, exclude])
    if (part && primary.length + part.length + 1 <= 340) primary += " " + part;
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
const chinaDay = (now) =>
  new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
const bounded = (value, fallback, min, max) =>
  Number.isFinite(Number(value)) && String(value) !== ""
    ? Math.max(min, Math.min(max, Math.floor(Number(value))))
    : fallback;
export async function searchJobs(
  preferences,
  {
    key = process.env.BRAVE_SEARCH_API_KEY,
    fetcher = fetch,
    enrich = true,
    detailFetcher = createDetailFetcher(),
    previousIndex = {},
    dailyBudget = process.env.JOB_SEARCH_BUDGET || 24,
    maxPages = process.env.JOB_SEARCH_PAGES || 2,
    maxDetails = process.env.JOB_DETAIL_LIMIT || 36,
    now = new Date(),
    requestInterval = 1100,
    maxSearchMs = 120000,
  } = {},
) {
  const p = normalizePreferences(preferences);
  const started = Date.now();
  let authBlocked = false;
  if (!p.role) throw Error("请填写目标岗位");
  if (!key) {
    const e = new Error(
      "实时岗位检索尚未配置：请在后台安全设置 BRAVE_SEARCH_API_KEY",
    );
    e.status = 503;
    throw e;
  }
  const day = chinaDay(now),
    ordinal = Math.floor(Date.parse(day + "T00:00:00Z") / 86400000);
  p.sourceDay = ordinal;
  p.sourceHealth = previousIndex.sourceHealth || {};
  const limit = bounded(dailyBudget, 24, 1, 100),
    pages = bounded(maxPages, 2, 1, 3),
    detailLimit = bounded(maxDetails, 36, 1, 100);
  let used =
    previousIndex.searchUsage?.day === day
      ? bounded(previousIndex.searchUsage.requests, 0, 0, 10000)
      : 0;
  const plans = [];
  const regions = p.region === "全部" ? ["内地", "香港"] : [p.region];
  for (let i = 0; i < p.roles.length; i++)
    for (const region of regions)
      plans.push({ region, role: p.roles[i], roleIndex: i, offset: 0 });
  // If a smaller configured budget cannot cover all directions, rotate the start daily.
  const rotation = ordinal % plans.length;
  plans.push(...plans.splice(0, rotation));
  const seenResults = new Map();
  const jobs = [],
    errors = [],
    queryLog = [],
    deferred = [];
  let calls = 0,
    successes = 0;
  async function run(plan) {
    if (used >= limit) return null;
    if (calls && requestInterval) await delay(requestInterval);
    const { region, role, roleIndex, offset } = plan;
    const selected = querySources(
      region,
      roleIndex,
      ordinal,
      role,
      previousIndex.sourceHealth || {},
    );
    if (!selected.length) return null;
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.search = new URLSearchParams({
      q: buildQuery(p, region, [role], roleIndex),
      count: "20",
      offset: String(offset),
      freshness: "py",
      country: region === "香港" ? "HK" : "CN",
      search_lang: region === "香港" ? "zh-hant" : "zh-hans",
    });
    used++;
    calls++;
    const event = {
      role,
      region,
      page: offset + 1,
      sources: selected.map((s) => s.name),
      results: 0,
      unseenResults: 0,
      newLinks: 0,
    };
    queryLog.push(event);
    try {
      const res = await fetcher(url, {
        headers: { Accept: "application/json", "X-Subscription-Token": key },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        if ([401, 403].includes(res.status)) authBlocked = true;
        throw Error("搜索服务响应 " + res.status);
      }
      const data = await res.json(),
        results = data.web?.results || [];
      successes++;
      event.results = results.length;
      for (const item of results) {
        const seenKey = region + "|" + role;
        if (!seenResults.has(seenKey)) seenResults.set(seenKey, new Set());
        const rawIdentity =
          sourceURL(item.url, region)?.href || String(item.url || "");
        if (rawIdentity && !seenResults.get(seenKey).has(rawIdentity)) {
          event.unseenResults++;
          seenResults.get(seenKey).add(rawIdentity);
        }

        const u = sourceURL(item.url, region);
        if (!u) continue;
        const plain = (value) =>
          String(value || "")
            .replace(/<[^>]*>/g, "")
            .slice(0, 2000);
        const title = plain(item.title),
          description = plain(item.description);
        if (
          splitTerms(p.exclude).some((w) =>
            (title + " " + description).toLowerCase().includes(w.toLowerCase()),
          )
        )
          continue;
        if (jobs.some((j) => j.url === u.href)) continue;
        const source = identifySource(u.href, region);
        jobs.push({
          id: createHash("sha256").update(u.href).digest("hex").slice(0, 18),
          title,
          company: null,
          region,
          searchGroup: role,
          category: "待核实",
          city: null,
          skills: [],
          description,
          source: u.hostname,
          sourceLabel: source?.name || u.hostname,
          sourceType: source?.type || "公共来源",
          url: u.href,
          discoveredAt: now.toISOString(),
          verification: "search-result",
          demo: false,
        });
        event.newLinks++;
      }
      const more = data.query?.more_results_available;
      return offset + 1 < pages &&
        (more === true || (more === undefined && results.length >= 20)) &&
        event.unseenResults > 0
        ? { ...plan, offset: offset + 1 }
        : null;
    } catch (e) {
      event.error = e.message;
      errors.push(`${region}／${role}／第 ${offset + 1} 页：${e.message}`);
      return null;
    }
  }
  for (const plan of plans) {
    if (used >= limit || authBlocked || Date.now() - started >= maxSearchMs)
      break;
    const next = await run(plan);
    if (next) deferred.push(next);
  }
  if (deferred.length) {
    const rotate = ordinal % deferred.length;
    deferred.push(...deferred.splice(0, rotate));
  }
  while (
    deferred.length &&
    used < limit &&
    !authBlocked &&
    Date.now() - started < maxSearchMs
  ) {
    const next = await run(deferred.shift());
    if (next) deferred.push(next);
  }
  const timeLimited = Date.now() - started >= maxSearchMs;
  if (timeLimited)
    errors.push(
      "本轮搜索达到时间上限，保留已取得结果及历史岗位，未完成方向留待下一轮。",
    );
  if (calls && !successes) {
    const e = new Error(errors.join("；"));
    e.status = 502;
    throw e;
  }
  if (used >= limit)
    errors.push(
      "当日搜索预算已用完，保留已获得结果及仍可参考的历史岗位；次日自动恢复。",
    );
  const result = {
    schemaVersion: 3,
    sourceHealth: previousIndex.sourceHealth || {},
    updatedAt: now.toISOString(),
    mode: "search",
    jobs,
    warnings: errors,
    searchUpdatedAt: calls
      ? now.toISOString()
      : previousIndex.searchUpdatedAt || previousIndex.updatedAt || null,
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
    searchUsage: { day, requests: used, limit },
    coverage: {
      configuredSources: sourceCatalog.length,
      roleDirections: p.roles.length,
      regions: regions.length,
      pagesLimit: pages,
      plannedFirstPages: plans.length,
      requestsThisRun: calls,
      dailyRemaining: Math.max(0, limit - used),
      partial:
        successes < calls ||
        timeLimited ||
        queryLog.filter((q) => q.page === 1).length < plans.length,
      paginationRequests: queryLog.filter((q) => q.page > 1).length,
      queryLog,
    },
    notice:
      "不同方向独立检索；索引时间不等于公告发布时间。新岗位与历史保留分别标注，实际有效性以雇主原公告为准。",
  };
  if (!enrich) return result;
  let discoveryPages = 0,
    discoveredChildren = 0;
  for (const parent of jobs
    .filter(
      (j) =>
        ["企业官网", "校招／实习"].includes(j.sourceType) &&
        /首页|汇总/.test(classifyLink(j).reason || ""),
    )
    .slice(0, 4)) {
    discoveryPages++;
    const discovered = await detailFetcher({ ...parent, discoveryOnly: true });
    for (const child of discovered.discoveredLinks || []) {
      const target = sourceURL(child.url, child.region);
      if (!target || jobs.some((j) => j.url === target.href)) continue;
      const source = identifySource(target.href, child.region);
      jobs.push({
        ...child,
        id: createHash("sha256").update(target.href).digest("hex").slice(0, 18),
        url: target.href,
        source: target.hostname,
        sourceLabel: source?.name || target.hostname,
        sourceType: source?.type || "公共来源",
        searchGroup: parent.searchGroup,
        skills: [],
        company: null,
        category: "待核实",
        description: "由公开招聘入口发现，等待详情读取",
        discoveredAt: now.toISOString(),
        verification: "search-result",
        demo: false,
      });
      discoveredChildren++;
    }
  }
  result.coverage.discoveryPages = discoveryPages;
  result.coverage.discoveredChildren = discoveredChildren;
  const cached = new Map(
    (previousIndex.jobs || []).map((j) => [
      sourceURL(j.url, j.region)?.href,
      j,
    ]),
  );
  const enriched = await enrichIndex(result, {
    detailFetcher,
    sourceHealth: previousIndex.sourceHealth || {},
    maxDetails: detailLimit,
    now,
    cacheResolver: (lead) => {
      const old = cached.get(lead.url);
      const age = now.getTime() - Date.parse(old?.detailFetchedAt || "");
      if (
        !old ||
        old.status === "closed" ||
        !Number.isFinite(age) ||
        age < 0 ||
        age >= 86400000 ||
        (Number.isFinite(deadlineTime(old)) &&
          deadlineTime(old) < now.getTime())
      )
        return null;
      return {
        ...old,
        sourceLabel: lead.sourceLabel,
        sourceType: lead.sourceType,
        searchGroup: lead.searchGroup,
        cacheUsed: true,
      };
    },
  });
  return retainHistory(enriched, previousIndex, { detailFetcher, now });
}
