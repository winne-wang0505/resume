import test from "node:test";
import assert from "node:assert/strict";
import { importManual } from "../src/manual.mjs";
import { evaluate } from "../src/match.mjs";
import { extractDetail, createDetailFetcher } from "../src/details.mjs";
import { updateHealth, cooling } from "../src/health.mjs";
import { querySources } from "../src/sources.mjs";
import { enrichIndex } from "../src/pipeline.mjs";
const now = new Date("2026-10-28T03:00:00Z");
const text =
  "岗位职责：负责经营数据分析、维护数据报表并与产品团队共同梳理关键业务指标，输出可复用的分析报告，解释数据变化并提出行动建议。\n任职要求：本科学历，2年以上相关工作经验，熟练使用 SQL、Excel 和 Python，具备良好的沟通表达能力。\n截止日期：2026年11月30日";
const input = {
  title: "数据分析师",
  company: "测试雇主",
  city: "香港",
  region: "香港",
  text,
};
test("manual text preserves evidence, missing salary and local provenance; shared scorer unchanged", () => {
  const job = importManual(input, { now, id: "local-test" });
  assert.equal(job.verification, "user-provided-detail");
  assert.equal(job.company, input.company);
  assert.equal(job.degree, "本科");
  assert.equal(job.experience, 2);
  assert.equal(job.salaryMin, undefined);
  assert.equal(job.url, "");
  assert.equal(job.fieldEvidence.degree.method, "user-provided-text");
  const r = evaluate(
    { degree: "本科", years: 2, skills: "SQL、Excel、Python" },
    { role: "数据分析", city: "香港" },
    job,
    { now },
  );
  assert.ok(r.match !== null);
  assert.equal(evaluate({}, {}, job, { now }).match, null);
  assert.equal(
    importManual(
      { ...input, text: text.replace("2026年11月30日", "2026年1月1日") },
      { now },
    ).status,
    "closed",
  );
});
test("manual input refuses incomplete, multiple or executable content and invalid links", () => {
  assert.throws(() => importManual({ ...input, text: "只有一段摘要" }), /80/);
  assert.throws(
    () => importManual({ ...input, url: "javascript:alert(1)" }),
    /HTTPS/,
  );
  assert.throws(
    () => importManual({ ...input, url: "https://user:secret@example.com" }),
    /HTTPS/,
  );
  assert.throws(() => importManual({ ...input, company: "" }), /填写/);
  assert.throws(
    () => importManual({ ...input, text: text + "\n岗位职责：另一个岗位" }),
    /一个岗位/,
  );
  const j = importManual({
    ...input,
    text: text + '\n<script>alert("bad")</script>',
  });
  assert.equal(j.fieldEvidence.company.quote, "公司名称：测试雇主");
});
test("official embedded data adapter matches exact job ID, never another vacancy", () => {
  const lead = {
    id: "official",
    url: "https://careers.tencent.com/jobdesc.html?postId=123456",
    region: "内地",
  };
  const data = {
    props: {
      job: {
        PostId: 123456,
        PostName: "数据分析师",
        LocationName: "深圳",
        Responsibility: text.split("任职要求")[0],
        Requirement: text.split("任职要求：")[1],
      },
    },
  };
  const html = `<script type="application/json">${JSON.stringify(data)}</script>`;
  const r = extractDetail(html, lead, { now });
  assert.equal(r.ok, true);
  assert.equal(r.job.city, "深圳");
  assert.match(r.job.company, /主体待核实/);
  assert.equal(
    extractDetail(
      html,
      { ...lead, url: lead.url.replace("123456", "999999") },
      { now },
    ).ok,
    false,
  );
});
test("health pauses repeated access failures, not incomplete jobs; success restores source", () => {
  const lead = { url: "https://www.liepin.com/job/123.shtml" };
  const failures = Array.from({ length: 3 }, () => ({
    lead,
    result: { ok: false, reason: "来源返回 HTTP 405" },
  }));
  const h = updateHealth({}, failures, now);
  assert.equal(cooling(h, "liepin", now), true);
  assert.equal(
    cooling(h, "liepin", new Date(now.getTime() + 3 * 86400000)),
    false,
  );
  assert.equal(
    cooling(
      updateHealth(h, [{ lead, result: { ok: true } }], now),
      "liepin",
      now,
    ),
    false,
  );
  assert.equal(
    cooling(
      updateHealth(
        {},
        failures.map((x) => ({
          ...x,
          result: { ok: false, reason: "字段不完整" },
        })),
        now,
      ),
      "liepin",
      now,
    ),
    false,
  );
});
test("source selection prioritizes official and campus, skips cooled sources", () => {
  const day = Math.floor(now.getTime() / 86400000);
  const selected = querySources("内地", 0, day, "数据分析");
  assert.equal(selected[0].type, "企业官网");
  assert.equal(selected[1].type, "校招／实习");
  const h = { [selected[0].id]: { cooldownUntil: "2026-11-01T00:00:00Z" } };
  assert.ok(
    !querySources("内地", 0, day, "数据分析", h).some(
      (x) => x.id === selected[0].id,
    ),
  );
});
test("pipeline persists health and respects cooldown without spending detail limit", async () => {
  const lead = {
    id: "x",
    url: "https://www.liepin.com/job/123.shtml",
    region: "内地",
    title: "数据分析",
  };
  let calls = 0;
  const h = { liepin: { cooldownUntil: "2026-11-01T00:00:00Z" } };
  const result = await enrichIndex(
    { leads: [lead], sourceHealth: h },
    {
      now,
      detailFetcher: async () => {
        calls++;
        return { ok: false };
      },
    },
  );
  assert.equal(calls, 0);
  assert.equal(result.stats.detailAttempts, 0);
  assert.match(result.leads[0].detailFailure, /暂缓/);
  assert.deepEqual(result.sourceHealth, h);
});
test("render fallback is limited and never invoked on HTTP405, robots or challenges", async () => {
  let renders = 0;
  const renderer = async () => {
    renders++;
    return "<h1>加载</h1>";
  };
  const lead = {
    id: "render",
    url: "https://careers.tencent.com/jobdesc.html?postId=123456",
    region: "内地",
  };
  for (const kind of ["405", "robots", "captcha"]) {
    const fetcher = async (url) =>
      String(url).endsWith("robots.txt")
        ? new Response(kind === "robots" ? "User-agent: *\nDisallow: /" : "", {
            headers: { "content-type": "text/plain" },
          })
        : new Response(kind === "captcha" ? "captcha 请完成验证" : "dynamic", {
            status: kind === "405" ? 405 : 200,
            headers: { "content-type": "text/html" },
          });
    const read = createDetailFetcher({
      renderer,
      fetcher,
      resolver: async () => [{ address: "8.8.8.8" }],
    });
    assert.equal((await read(lead)).ok, false);
  }
  assert.equal(renders, 0);
});
test("rendered detail uses the same evidence parser and stops at configured budget", async () => {
  const { readFile } = await import("node:fs/promises");
  const fixture = await readFile(
    new URL("./fixtures/job-posting.html", import.meta.url),
    "utf8",
  );
  let renders = 0;
  const read = createDetailFetcher({
    renderer: async () => {
      renders++;
      return fixture;
    },
    renderLimit: 1,
    resolver: async () => [{ address: "8.8.8.8" }],
    fetcher: async (url) =>
      new Response(
        String(url).endsWith("robots.txt") ? "" : "<h1>Loading jobs</h1>",
        { headers: { "content-type": "text/html" } },
      ),
  });
  const lead = {
    id: "render",
    url: "https://careers.tencent.com/jobdesc.html?postId=123456",
    region: "香港",
  };
  const first = await read(lead);
  assert.equal(first.ok, true);
  assert.match(first.job.detailMethod, /browser/);
  assert.equal((await read(lead)).ok, false);
  assert.equal(renders, 1);
});
test("historical rechecks respect source cooldown without losing valid history", async () => {
  const { retainHistory } = await import("../src/history.mjs");
  const { readFile } = await import("node:fs/promises");
  const fixture = await readFile(
    new URL("./fixtures/job-posting.html", import.meta.url),
    "utf8",
  );
  const old = extractDetail(
    fixture,
    {
      id: "history",
      url: "https://hk.jobsdb.com/job/123456",
      region: "香港",
    },
    { now: new Date("2026-10-26T03:00:00Z") },
  ).job;
  let calls = 0;
  const result = await retainHistory(
    {
      jobs: [],
      leads: [],
      excluded: [],
      sourceHealth: { jobsdb: { cooldownUntil: "2026-11-01T00:00:00Z" } },
    },
    { jobs: [old] },
    {
      now,
      detailFetcher: async () => {
        calls++;
        return { ok: false };
      },
    },
  );
  assert.equal(calls, 0);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].retained, true);
});
