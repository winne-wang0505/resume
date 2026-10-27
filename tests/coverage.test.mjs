import test from "node:test";
import assert from "node:assert/strict";
import { searchJobs } from "../src/search.mjs";
import { sourceCatalog, sourceURL, identifySource } from "../src/sources.mjs";
const now = new Date("2026-10-27T05:00:00Z");
test("each role has an independent query and persisted daily request budget", async () => {
  const queries = [];
  const fetcher = async (u) => {
    queries.push(new URL(u).searchParams.get("q"));
    return {
      ok: true,
      json: async () => ({
        query: { more_results_available: false },
        web: { results: [] },
      }),
    };
  };
  const r = await searchJobs(
    { role: "数据分析/产品/算法/金融", region: "内地" },
    {
      key: "test",
      fetcher,
      enrich: false,
      dailyBudget: 3,
      requestInterval: 0,
      now,
    },
  );
  assert.equal(queries.length, 3);
  assert.equal(r.searchUsage.requests, 3);
  assert.equal(r.coverage.plannedFirstPages, 4);
  assert.ok(queries.every((q) => q.length <= 350));
  let second = 0;
  await searchJobs(
    { role: "数据分析", region: "内地" },
    {
      key: "test",
      fetcher: async () => {
        second++;
        throw Error("must not call");
      },
      enrich: false,
      previousIndex: r,
      dailyBudget: 3,
      requestInterval: 0,
      now,
    },
  );
  assert.equal(second, 0);
});
test("provider offsets paginate without duplicate postings or looping repeated pages", async () => {
  const offsets = [];
  const fetcher = async (u) => {
    offsets.push(new URL(u).searchParams.get("offset"));
    return {
      ok: true,
      json: async () => ({
        query: { more_results_available: true },
        web: {
          results: [
            {
              title: "数据分析师",
              description: "公开岗位",
              url: "https://www.liepin.com/job/123.shtml",
            },
          ],
        },
      }),
    };
  };
  const r = await searchJobs(
    { role: "数据分析", region: "内地" },
    {
      key: "test",
      fetcher,
      enrich: false,
      maxPages: 3,
      dailyBudget: 10,
      requestInterval: 0,
      now,
    },
  );
  assert.deepEqual(offsets, ["0", "1"]);
  assert.equal(r.jobs.length, 1);
  assert.equal(r.coverage.paginationRequests, 1);
});
test("explicit no-more-results stops pagination even with a full page", async () => {
  let calls = 0;
  const results = Array.from({ length: 20 }, (_, i) => ({
    title: "职位" + i,
    url: "https://www.liepin.com/job/" + i + ".shtml",
  }));
  await searchJobs(
    { role: "数据分析", region: "内地" },
    {
      key: "test",
      fetcher: async () => {
        calls++;
        return {
          ok: true,
          json: async () => ({
            query: { more_results_available: false },
            web: { results },
          }),
        };
      },
      enrich: false,
      requestInterval: 0,
      now,
    },
  );
  assert.equal(calls, 1);
});
test("quota resets on the next Shanghai day and requests consume the new days counter", async () => {
  const r = await searchJobs(
    { role: "数据分析", region: "内地" },
    {
      key: "test",
      fetcher: async () => ({
        ok: true,
        json: async () => ({ web: { results: [] } }),
      }),
      enrich: false,
      requestInterval: 0,
      dailyBudget: 2,
      previousIndex: { searchUsage: { day: "2026-10-26", requests: 24 } },
      now,
    },
  );
  assert.equal(r.searchUsage.requests, 1);
  assert.equal(r.searchUsage.day, "2026-10-27");
});
test("source catalog includes campus and employer channels without allowing unrelated hosts or ATS tenants", () => {
  assert.ok(sourceCatalog.length >= 30);
  for (const host of [
    "careers.tencent.com",
    "jobs.bytedance.com",
    "career.huawei.com",
    "apply.careers.hsbc.com",
    "shixiseng.com",
    "nowcoder.com",
  ])
    assert.ok(sourceURL("https://" + host + "/job/123"));
  assert.equal(
    identifySource("https://careers.tencent.com/jobdesc.html?postId=1").type,
    "企业官网",
  );
  assert.equal(
    sourceURL("https://unrelated.wd3.myworkdayjobs.com/job/1"),
    null,
  );
  assert.equal(
    sourceURL("https://careers.tencent.com.evil.invalid/job/1"),
    null,
  );
});

test("a previously successful recent job remains when daily budget is exhausted", async () => {
  const previous = {
    searchUsage: { day: "2026-10-27", requests: 24, limit: 24 },
    searchUpdatedAt: "2026-10-26T20:00:00Z",
    jobs: [
      {
        id: "retained",
        url: "https://www.liepin.com/job/123.shtml",
        region: "内地",
        company: "测试公司",
        title: "数据分析师",
        skills: ["SQL"],
        description: "公开岗位职责与任职要求",
        discoveredAt: "2026-10-25T00:00:00Z",
        detailFetchedAt: "2026-10-26T20:00:00Z",
        verification: "structured-detail",
        deadline: "2026-11-30",
      },
    ],
  };
  const r = await searchJobs(
    { role: "数据分析", region: "内地" },
    {
      key: "test",
      previousIndex: previous,
      now,
      fetcher: async () => {
        throw Error("must not call");
      },
      detailFetcher: async () => {
        throw Error("must not recheck a recent snapshot");
      },
    },
  );
  assert.equal(r.coverage.requestsThisRun, 0);
  assert.equal(r.jobs.length, 1);
  assert.equal(r.jobs[0].retained, true);
  assert.equal(r.searchUpdatedAt, previous.searchUpdatedAt);
});
test("fresh prior snapshots are reused without consuming detail request capacity", async () => {
  const previous = {
    jobs: [
      {
        id: "known",
        url: "https://www.liepin.com/job/123.shtml",
        region: "内地",
        company: "测试公司",
        title: "数据分析师",
        skills: ["SQL"],
        description: "职责：数据分析和报告。",
        discoveredAt: "2026-10-25T00:00:00Z",
        detailFetchedAt: "2026-10-26T20:00:00Z",
        verification: "structured-detail",
        deadline: "2026-11-30",
      },
    ],
  };
  let details = 0;
  const r = await searchJobs(
    { role: "数据分析", region: "内地" },
    {
      key: "test",
      previousIndex: previous,
      now,
      requestInterval: 0,
      fetcher: async () => ({
        ok: true,
        json: async () => ({
          query: { more_results_available: false },
          web: {
            results: [
              {
                title: "数据分析师",
                url: "https://www.liepin.com/job/123.shtml",
              },
            ],
          },
        }),
      }),
      detailFetcher: async () => {
        details++;
        throw Error("must use cache");
      },
    },
  );
  assert.equal(details, 0);
  assert.equal(r.jobs.length, 1);
  assert.equal(r.jobs[0].cacheUsed, true);
  assert.equal(r.stats.detailAttempts, 0);
});

test("a bounded search window stops further API requests and discloses incomplete coverage", async () => {
  let calls = 0;
  const r = await searchJobs(
    { role: "数据分析", region: "内地" },
    {
      key: "test",
      enrich: false,
      maxSearchMs: 0,
      fetcher: async () => {
        calls++;
        throw Error("must not call");
      },
      now,
    },
  );
  assert.equal(calls, 0);
  assert.equal(r.coverage.partial, true);
  assert.ok(r.warnings.some((x) => x.includes("时间上限")));
});

test("a page filtered by source or keywords can still lead to a valid next page", async () => {
  let n = 0;
  const r = await searchJobs(
    { role: "数据分析", region: "内地" },
    {
      key: "test",
      enrich: false,
      requestInterval: 0,
      now,
      fetcher: async () => ({
        ok: true,
        json: async () =>
          ++n === 1
            ? {
                query: { more_results_available: true },
                web: {
                  results: [
                    {
                      title: "非支持来源",
                      url: "https://unsupported.invalid/job/1",
                    },
                  ],
                },
              }
            : {
                query: { more_results_available: false },
                web: {
                  results: [
                    {
                      title: "数据分析师",
                      url: "https://www.liepin.com/job/42.shtml",
                    },
                  ],
                },
              },
      }),
    },
  );
  assert.equal(n, 2);
  assert.equal(r.jobs.length, 1);
});

test("consumer and finance directions prioritize relevant employer recruiting portals", async () => {
  const { querySources } = await import("../src/sources.mjs");
  assert.ok(
    querySources("内地", 0, 3, "快消").some((s) =>
      ["pg", "unilever"].includes(s.id),
    ),
  );
  assert.ok(
    querySources("香港", 0, 3, "金融").some((s) =>
      ["hsbc", "sc", "hkex", "ey", "pwc", "deloitte"].includes(s.id),
    ),
  );
});
