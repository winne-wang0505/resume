import test from "node:test";
import assert from "node:assert/strict";
import { enrichIndex } from "../src/pipeline.mjs";
import { buildBrief } from "../src/brief.mjs";
import { evaluate } from "../src/match.mjs";
const now = new Date("2026-10-27T05:00:00Z");
const lead = {
  id: "job1",
  title: "数据分析师",
  company: "测试公司",
  url: "https://hk.jobsdb.com/job/123",
  region: "香港",
  skills: [],
  verification: "search-result",
};
const profile = {
  degree: "本科",
  years: 3,
  skills: "SQL，Excel",
  experience: "报表分析",
  achievements: "项目成果",
};
const prefs = {
  role: "数据分析",
  region: "全部",
  city: "香港",
  currency: "HKD",
  salary: 20000,
  mode: "不限",
  category: "全部",
};
const detailed = {
  ...lead,
  verification: "structured-detail",
  degree: "本科",
  experience: 2,
  skills: ["SQL", "Excel"],
  city: "香港",
  salaryMin: 22000,
  salaryMax: 30000,
  currency: "HKD",
  description: "具体职责与要求",
  status: "open-unconfirmed",
};
test("pipeline separates detailed jobs, blocked leads, aggregates and expired jobs", async () => {
  const blocked = {
    ...lead,
    id: "blocked",
    url: "https://hk.jobsdb.com/job/456",
  };
  const closed = {
    ...lead,
    id: "closed",
    url: "https://hk.jobsdb.com/job/789",
  };
  const root = { ...lead, id: "root", url: "https://hk.jobsdb.com/" };
  const r = await enrichIndex(
    { jobs: [lead, blocked, closed, root, lead] },
    {
      now,
      detailFetcher: async (j) =>
        j.id === "blocked"
          ? { ok: false, reason: "来源返回 HTTP 403" }
          : {
              ok: true,
              job: {
                ...detailed,
                id: j.id,
                url: j.url,
                status: j.id === "closed" ? "closed" : "open-unconfirmed",
              },
            },
    },
  );
  assert.equal(r.jobs.length, 1);
  assert.equal(r.leads.length, 1);
  assert.equal(r.excluded.length, 2);
  assert.equal(r.stats.discovered, 4);
  assert.match(r.leads[0].detailFailure, /403/);
});
test("detail fetch cap limits outgoing work and preserves remaining leads", async () => {
  let count = 0;
  const r = await enrichIndex(
    {
      jobs: [1, 2, 3, 4].map((i) => ({
        ...lead,
        id: String(i),
        url: "https://hk.jobsdb.com/job/" + i,
      })),
    },
    {
      now,
      maxDetails: 2,
      detailFetcher: async () => {
        count++;
        return { ok: false, reason: "blocked" };
      },
    },
  );
  assert.equal(count, 2);
  assert.equal(r.leads.length, 4);
});
test("daily brief never promotes summaries, unrelated roles, or expired jobs", () => {
  const r = buildBrief(
    {
      updatedAt: now.toISOString(),
      jobs: [
        detailed,
        { ...detailed, id: "unrelated", title: "销售总监" },
        { ...detailed, id: "expired", deadline: "2026-01-01T23:00:00+08:00" },
      ],
      leads: [{ ...lead, id: "pending", detailFailure: "需要登录" }],
    },
    profile,
    prefs,
    { now },
  );
  assert.equal(r.ready.length, 1);
  assert.equal(r.pending.length, 2);
  assert.equal(r.closed.length, 1);
  assert.equal(r.ready[0].result.match, 100);
  assert.ok(r.tasks.length > 0);
});
test("low evidence and missing personal information suppress numerical scores", () => {
  assert.equal(evaluate(profile, prefs, { ...lead, city: "香港" }).match, null);
  assert.equal(
    evaluate(
      profile,
      {},
      {
        ...detailed,
        skills: [],
        experience: undefined,
        city: undefined,
        salaryMin: undefined,
      },
    ).match,
    null,
  );
  assert.equal(
    evaluate({ skills: "", experience: "", degree: "本科" }, prefs, detailed)
      .match,
    null,
  );
});
test("local preference region and excluded words actually filter daily brief", () => {
  const d = { jobs: [detailed], updatedAt: now.toISOString() };
  assert.equal(
    buildBrief(d, profile, { ...prefs, region: "内地" }, { now }).ready.length,
    0,
  );
  assert.equal(
    buildBrief(d, profile, { ...prefs, exclude: "测试公司" }, { now }).ready
      .length,
    0,
  );
});
test("brief is not truncated to five arbitrary search results and warns when stale", () => {
  const jobs = Array.from({ length: 8 }, (_, i) => ({
    ...detailed,
    id: String(i),
  }));
  const r = buildBrief({ jobs, updatedAt: "2026-01-01" }, profile, prefs, {
    now,
  });
  assert.equal(r.ready.length, 8);
  assert.equal(r.stale, true);
  assert.match(r.tasks[0], /48/);
});
