import test from "node:test";
import assert from "node:assert/strict";
import {
  searchJobs,
  normalizePreferences,
  buildQuery,
} from "../src/search.mjs";
test("missing search key is a diagnosed blocker, not fake live data", async () => {
  await assert.rejects(
    searchJobs({ role: "分析" }, { key: "" }),
    /BRAVE_SEARCH_API_KEY/,
  );
});
test("query transmits only allowlisted preference fields", () => {
  const p = normalizePreferences({
    role: "分析",
    name: "private-name",
    experience: "private-experience",
    city: "香港",
    region: "香港",
    hours: "双休",
    employment: "全职",
  });
  const q = buildQuery(p, "香港");
  assert.ok(q.includes("双休"));
  assert.ok(!q.includes("private"));
  assert.ok(!("name" in p));
});
test("provider response filters unknown sources, duplicates, exclusions and HTML", async () => {
  const fetcher = async () => ({
    ok: true,
    json: async () => ({
      web: {
        results: [
          {
            title: "<b>分析师</b>",
            description: "数据业务",
            url: "https://hk.jobsdb.com/job/1",
          },
          { title: "duplicate", url: "https://hk.jobsdb.com/job/1" },
          { title: "销售分析", url: "https://hk.jobsdb.com/job/2" },
          { title: "untrusted", url: "https://evil.invalid/job" },
        ],
      },
    }),
  });
  const r = await searchJobs(
    { role: "分析", region: "香港", exclude: "销售" },
    { key: "test-key", fetcher, enrich: false },
  );
  assert.equal(r.jobs.length, 1);
  assert.equal(r.jobs[0].title, "分析师");
  assert.equal(r.jobs[0].category, "待核实");
  assert.equal(r.jobs[0].salaryMin, undefined);
  assert.equal(r.jobs[0].verification, "search-result");
});
test("provider failures are not reported as successful empty index", async () => {
  await assert.rejects(
    searchJobs(
      { role: "分析", region: "内地" },
      { key: "test", fetcher: async () => ({ ok: false, status: 403 }) },
    ),
    /403/,
  );
});
test("one-region failure is disclosed as partial refresh", async () => {
  let n = 0;
  const r = await searchJobs(
    { role: "分析" },
    {
      key: "test",
      enrich: false,
      fetcher: async (url) =>
        ++n === 1
          ? { ok: false, status: 429 }
          : {
              ok: true,
              json: async () => ({
                web: {
                  results: [
                    {
                      title: "分析",
                      url:
                        new URL(url).searchParams.get("country") === "HK"
                          ? "https://hk.jobsdb.com/job/1"
                          : "https://www.liepin.com/job/1.shtml",
                    },
                  ],
                },
              }),
            },
    },
  );
  assert.equal(r.warnings.length, 1);
  assert.equal(r.jobs.length, 1);
});

test("combined legacy configuration is split into roles, cities, exclusions and entry-level preference", () => {
  const p = normalizePreferences({
    role: "JOB_TYPE：数据分析/大模型/AI/产品/算法/开发/运营/金融/快消 JOB_REGION：上海/杭州/深圳/香港 JOB_EXCLUDE：夜班/销售 JOB NATURE全职/实习/兼职 JOB EXPERIENCE：应届",
    region: "全部",
    employment: "全职",
  });
  assert.equal(p.legacyInput, true);
  assert.equal(p.roles.length, 9);
  assert.deepEqual(p.cities, ["上海", "杭州", "深圳", "香港"]);
  assert.equal(p.exclude, "夜班、销售");
  assert.equal(p.experienceLevel, "应届");
  assert.equal(p.employment, "不限");
  assert.ok(!p.role.includes("JOB_"));
  const q = buildQuery(p, "香港");
  assert.ok(q.includes("graduate"));
  assert.ok(!q.includes("上海"));
  assert.ok(q.includes('-"销售"'));
  assert.ok(q.length <= 350);
});
test("ordinary multiple-city preferences use OR rather than an impossible combined city name", () => {
  const p = normalizePreferences({
    role: "数据分析/商业分析",
    city: "上海/杭州/香港",
    region: "全部",
  });
  assert.equal(p.roles.length, 2);
  const q = buildQuery(p, "内地");
  assert.ok(q.includes("上海") && q.includes("杭州") && q.includes(" OR "));
  assert.ok(!q.includes("香港"));
});
