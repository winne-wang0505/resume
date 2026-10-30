import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extractDetail, createDetailFetcher } from "../src/details.mjs";
import { unavailableReason, qualityIssue } from "../src/availability.mjs";
import { enrichIndex } from "../src/pipeline.mjs";
import { retainHistory } from "../src/history.mjs";
import { buildBrief } from "../src/brief.mjs";
import { searchJobs, buildQuery } from "../src/search.mjs";
import { querySources, sourceURL, sourceMatches } from "../src/sources.mjs";
const now = new Date("2026-10-30T03:00:00Z");
const lead = {
  id: "quality",
  title: "数据分析师",
  url: "https://www.liepin.com/job/123456.shtml",
  region: "内地",
  discoveredAt: now.toISOString(),
};
const fixture = await readFile(
  new URL("./fixtures/job-posting.html", import.meta.url),
  "utf8",
);
const job = {
  ...extractDetail(fixture, lead, { now }).job,
  city: "深圳",
  countries: ["CN"],
};
const prefs = { role: "数据分析", region: "内地", sourceMode: "standard" };
const profile = { degree: "本科", years: 2, skills: "SQL、Excel、Python" };
test("closed banners are detected before missing fields and browser fallback", async () => {
  for (const text of [
    "该职位已下架",
    "該職位已關閉",
    "此職缺已停止招聘",
    "This job is no longer available",
    "No longer accepting applications",
    "Job not found",
  ]) {
    const result = extractDetail(`<h1>${text}</h1>`, lead, { now });
    assert.equal(result.unavailable, true, text);
  }
  let rendered = 0;
  const reader = createDetailFetcher({
    resolver: async () => [{ address: "8.8.8.8" }],
    renderer: async () => {
      rendered++;
      return fixture;
    },
    fetcher: async (url) =>
      new Response(
        String(url).endsWith("robots.txt") ? "" : "<h1>该职位已下架</h1>",
        { headers: { "content-type": "text/html" } },
      ),
  });
  assert.equal(
    (
      await reader({
        ...lead,
        url: "https://careers.tencent.com/jobdesc.html?postId=123456",
      })
    ).unavailable,
    true,
  );
  assert.equal(rendered, 0);
});
test("fresh metadata cannot override closed page; unrelated recommendations do not close current posting", () => {
  assert.equal(
    extractDetail(fixture + "<h2>此职位已关闭</h2>", lead, { now }).unavailable,
    true,
  );
  assert.equal(
    extractDetail(fixture + "<h3>相关职位</h3><p>该职位已下架</p>", lead, {
      now,
    }).ok,
    true,
  );
  assert.equal(unavailableReason({ detailFailure: "来源返回 HTTP 405" }), null);
  assert.equal(unavailableReason({ detailFailure: "需要登录或验证" }), null);
});
test("first discovery 404/410 and closed pages are archived, never pending", async () => {
  const result = await enrichIndex(
    {
      jobs: [
        lead,
        { ...lead, id: "gone", url: lead.url.replace("123456", "222222") },
      ],
    },
    {
      now,
      detailFetcher: async (j) => ({
        ok: false,
        ...(j.id === "gone"
          ? { unavailable: true, reason: "职位已关闭" }
          : { reason: "来源返回 HTTP 404" }),
      }),
    },
  );
  assert.equal(result.jobs.length, 0);
  assert.equal(result.leads.length, 0);
  assert.equal(result.excluded.length, 2);
  assert.ok(result.excluded.every((j) => j.unavailable && j.excludedAt));
});
test("legacy cached dead leads and history rechecks cannot resurrect removed vacancies", async () => {
  const previous = {
    jobs: [job],
    leads: [
      {
        ...lead,
        id: "dead",
        url: lead.url.replace("123456", "333333"),
        detailFailure: "来源返回 HTTP 410",
      },
    ],
  };
  const result = await retainHistory(
    { jobs: [], leads: [], excluded: [], searchPreferences: prefs },
    previous,
    {
      now,
      recheckAfterMs: 0,
      detailFetcher: async () => ({
        ok: false,
        unavailable: true,
        reason: "职位已下架",
      }),
    },
  );
  assert.equal(result.jobs.length, 0);
  assert.equal(result.leads.length, 0);
  assert.equal(result.excluded.length, 2);
});
test("expired and removed cached rows are absent from brief, not disguised as pending", () => {
  const result = buildBrief(
    {
      jobs: [job],
      leads: [
        { ...lead, detailFailure: "来源返回 HTTP 404" },
        { ...lead, id: "old", deadline: "2026-10-01" },
      ],
    },
    profile,
    prefs,
    { now },
  );
  assert.equal(result.ready.length, 1);
  assert.equal(result.pending.length, 0);
});
test("strict quality requires complete core fields and recent detail, not salary guesses", () => {
  assert.equal(
    qualityIssue(
      { ...job, salaryMin: undefined, salaryMax: undefined },
      { now },
    ),
    null,
  );
  assert.match(qualityIssue({ ...job, company: null }, { now }), /缺少/);
  assert.match(
    qualityIssue({ ...job, detailFetchedAt: "2026-10-28T00:00:00Z" }, { now }),
    /24/,
  );
  const result = buildBrief(
    { jobs: [{ ...job, detailFetchedAt: "2026-10-28T00:00:00Z" }] },
    profile,
    prefs,
    { now },
  );
  assert.equal(result.ready.length, 0);
  assert.equal(result.pending.length, 1);
});
test("focused scope uses only two standard sources; restricted BOSS does not trigger broad fallback", () => {
  assert.deepEqual(
    querySources("内地", 0, 1, "数据分析", {}, "standard").map((s) => s.id),
    ["liepin"],
  );
  assert.deepEqual(
    querySources("香港", 0, 1, "数据分析", {}, "standard").map((s) => s.id),
    ["offertoday"],
  );
  assert.deepEqual(querySources("内地", 0, 1, "数据分析", {}, "preferred"), []);
  const query = buildQuery(
    { ...prefs, sourceMode: "standard" },
    "内地",
    ["数据分析"],
    0,
  );
  assert.match(query, /site:liepin/);
  assert.ok(!query.includes("site:jobs.zhaopin"));
  assert.ok(sourceURL("https://hk.offertoday.com/job/abcdef123", "香港"));
  assert.equal(
    sourceMatches({ url: "https://jobs.zhaopin.com/abc.htm" }, "standard"),
    false,
  );
});
test("seven-day removal tombstones prevent rereading rediscovered dead links without spending detail budget", async () => {
  let reads = 0;
  const result = await searchJobs(prefs, {
    key: "fixture",
    now,
    requestInterval: 0,
    dailyBudget: 1,
    previousIndex: {
      excluded: [
        {
          ...lead,
          unavailable: true,
          excludedAt: now.toISOString(),
          reason: "职位已下架",
        },
      ],
    },
    fetcher: async () =>
      new Response(
        JSON.stringify({
          web: { results: [{ url: lead.url, title: "数据分析师" }] },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    detailFetcher: async () => {
      reads++;
      return { ok: true, job };
    },
  });
  assert.equal(reads, 0);
  assert.equal(result.jobs.length, 0);
  assert.equal(result.leads.length, 0);
  assert.equal(result.excluded[0].unavailable, true);
});
test("live verification bypasses a previously successful cached detail", async () => {
  let reads = 0;
  const result = await searchJobs(prefs, {
    key: "fixture",
    now,
    requestInterval: 0,
    dailyBudget: 1,
    liveVerification: true,
    previousIndex: { jobs: [job] },
    fetcher: async () =>
      new Response(
        JSON.stringify({
          web: { results: [{ url: lead.url, title: lead.title }] },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    detailFetcher: async () => {
      reads++;
      return { ok: false, unavailable: true, reason: "职位已下架" };
    },
  });
  assert.equal(reads, 1);
  assert.equal(result.jobs.length, 0);
  assert.equal(result.leads.length, 0);
});
test("cached private/public indexes are cleaned on read without pretending a new fetch occurred", async () => {
  const { removeUnavailable } = await import("../src/availability.mjs");
  const index = {
    updatedAt: "2026-10-20",
    jobs: [{ ...job, status: "closed" }],
    leads: [
      { ...lead, url: lead.url + "?old", detailFailure: "来源返回 HTTP 410" },
    ],
  };
  const cleaned = removeUnavailable(index, { now });
  assert.equal(cleaned.jobs.length, 0);
  assert.equal(cleaned.leads.length, 0);
  assert.equal(cleaned.excluded.length, 2);
  assert.equal(cleaned.updatedAt, index.updatedAt);
});
test("old publication with no expiry is not assumed active; future dated campus deadlines remain eligible", () => {
  assert.match(
    qualityIssue(
      { ...job, postedAt: "2026-08-01", deadline: undefined },
      { now },
    ),
    /30 天/,
  );
  assert.equal(
    qualityIssue(
      { ...job, postedAt: "2026-08-01", deadline: "2027-01-01" },
      { now },
    ),
    null,
  );
});
