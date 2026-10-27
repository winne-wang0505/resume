import test from "node:test";
import assert from "node:assert/strict";
import { retainHistory, deduplicateJobs } from "../src/history.mjs";
import { eligibilityIssue } from "../src/eligibility.mjs";
const now = new Date("2026-10-27T05:00:00Z");
const job = {
  id: "old",
  url: "https://hk.jobsdb.com/job/123",
  source: "hk.jobsdb.com",
  region: "香港",
  company: "测试雇主",
  title: "数据分析师",
  city: "香港",
  skills: ["SQL"],
  degree: "本科",
  experience: 0,
  description:
    "职责：维护业务数据，进行经营分析与报告撰写。要求：本科及以上学历，熟悉SQL和数据分析，能够与各部门协作，按时完成工作并交付高质量分析结果，同时参与跨部门项目和数据质量治理。",
  deadline: "2026-11-30",
  verification: "structured-detail",
  status: "open-unconfirmed",
  detailFetchedAt: "2026-10-26T15:00:00Z",
  discoveredAt: "2026-10-20T00:00:00Z",
};
const empty = {
  jobs: [],
  leads: [],
  excluded: [],
  searchPreferences: { region: "全部" },
  stats: { discovered: 0 },
};
test("not appearing in todays search does not delete a recently detailed job", async () => {
  const r = await retainHistory(empty, { jobs: [job] }, { now });
  assert.equal(r.jobs.length, 1);
  assert.equal(r.jobs[0].retained, true);
  assert.equal(r.jobs[0].detailFetchedAt, job.detailFetchedAt);
  assert.equal(r.stats.historyRetained, 1);
});
test("known expired, closed and changed-preference jobs do not survive in the active pool", async () => {
  for (const old of [
    { ...job, deadline: "2026-01-01" },
    { ...job, status: "closed" },
  ]) {
    const r = await retainHistory(empty, { jobs: [old] }, { now });
    assert.equal(r.jobs.length, 0);
    assert.equal(r.excluded.length, 1);
  }
  const r = await retainHistory(
    { ...empty, searchPreferences: { city: "上海" } },
    { jobs: [job] },
    { now },
  );
  assert.equal(r.jobs.length, 0);
  assert.match(r.excluded[0].reason, /城市/);
});
test("stale history becomes pending instead of pretending current verification", async () => {
  const r = await retainHistory(
    empty,
    { jobs: [{ ...job, detailFetchedAt: "2026-10-10T00:00:00Z" }] },
    { now },
  );
  assert.equal(r.jobs.length, 0);
  assert.equal(r.leads[0].verification, "search-result");
  assert.match(r.leads[0].detailFailure, /7 天/);
});
test("a transient read failure preserves a recent snapshot and prevents duplicate lead cards", async () => {
  const r = await retainHistory(
    {
      ...empty,
      leads: [
        {
          ...job,
          verification: "search-result",
          detailFailure: "来源返回 HTTP 403",
        },
      ],
    },
    { jobs: [job] },
    { now },
  );
  assert.equal(r.jobs.length, 1);
  assert.equal(r.leads.length, 0);
  assert.match(r.jobs[0].retentionReason, /403/);
});
test("404 or 410 removes a historical posting rather than keeping it as active", async () => {
  const r = await retainHistory(
    { ...empty, leads: [{ ...job, detailFailure: "来源返回 HTTP 404" }] },
    { jobs: [job] },
    { now },
  );
  assert.equal(r.jobs.length, 0);
  assert.equal(r.leads.length, 0);
  assert.match(r.excluded[0].reason, /不可用/);
});
test("rechecks are bounded and never overwrite original first discovery date", async () => {
  let calls = 0;
  const old = { ...job, detailFetchedAt: "2026-10-24T00:00:00Z" };
  const r = await retainHistory(
    empty,
    {
      jobs: [
        old,
        {
          ...old,
          id: "other",
          url: "https://hk.jobsdb.com/job/456",
          description: old.description + " 本岗位另负责机器学习预测项目。",
        },
      ],
    },
    {
      now,
      recheckLimit: 1,
      detailFetcher: async (j) => {
        calls++;
        return { ok: true, job: { ...j, detailFetchedAt: now.toISOString() } };
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(r.jobs.length, 2);
  assert.equal(r.jobs[0].firstSeenAt, job.discoveredAt);
});
test("newly rediscovered job keeps historical firstSeenAt without becoming two jobs", async () => {
  const r = await retainHistory(
    { ...empty, jobs: [{ ...job, detailFetchedAt: now.toISOString() }] },
    { jobs: [job] },
    { now },
  );
  assert.equal(r.jobs.length, 1);
  assert.equal(r.jobs[0].retained, false);
  assert.equal(r.jobs[0].firstSeenAt, job.discoveredAt);
  assert.equal(r.jobs[0].lastSeenAt, now.toISOString());
});
test("identical cross-source postings prefer employer website and retain alternate source link", () => {
  const official = {
    ...job,
    id: "official",
    url: "https://careers.tencent.com/jobdesc.html?postId=123",
    source: "careers.tencent.com",
    region: "内地",
  };
  const r = deduplicateJobs([job, official]);
  assert.equal(r.jobs.length, 1);
  assert.equal(r.jobs[0].id, "official");
  assert.equal(r.jobs[0].alternateSources[0].url, job.url);
  assert.equal(r.duplicates, 1);
});
test("same title and company with different duties do not collapse into one vacancy", () => {
  const r = deduplicateJobs([
    job,
    {
      ...job,
      id: "team2",
      url: "https://hk.jobsdb.com/job/999",
      description:
        job.description + " 负责另一个团队的数据仓库和机器学习项目。",
    },
  ]);
  assert.equal(r.jobs.length, 2);
});
test("old discovery survives when recently reconfirmed and deadline remains valid", async () => {
  const r = await retainHistory(
    empty,
    { jobs: [{ ...job, discoveredAt: "2026-01-01T00:00:00Z" }] },
    { now },
  );
  assert.equal(r.jobs.length, 1);
});
test("actual job country and explicit title city constrain worldwide employer sources", () => {
  assert.match(
    eligibilityIssue({ ...job, countries: ["US"] }, {}, { now }),
    /国家/,
  );
  assert.match(
    eligibilityIssue(
      { title: "【广州 数据分析师招聘】", region: "内地" },
      { city: "上海/杭州/深圳" },
      { now, titleOnly: true },
    ),
    /城市/,
  );
  assert.equal(
    eligibilityIssue({ ...job, city: "Kowloon" }, { city: "香港" }, { now }),
    null,
  );
});

test("previously verified stale leads are reconsidered on a later bounded recheck", async () => {
  const old = {
    ...job,
    detailFetchedAt: "2026-10-10T00:00:00Z",
    fieldEvidence: { degree: { quote: "本科" } },
    verification: "search-result",
    detailFailure: "历史未复核",
  };
  const r = await retainHistory(
    empty,
    { leads: [old] },
    {
      now,
      recheckLimit: 1,
      detailFetcher: async (j) => ({
        ok: true,
        job: {
          ...j,
          verification: "structured-detail",
          detailFetchedAt: now.toISOString(),
        },
      }),
    },
  );
  assert.equal(r.jobs.length, 1);
  assert.equal(r.jobs[0].verification, "structured-detail");
  assert.equal(r.leads.length, 0);
});
