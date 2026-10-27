import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  extractDetail,
  structuredPostings,
  robotsAllowed,
  createDetailFetcher,
  plainText,
} from "../src/details.mjs";
import { classifyLink, sourceURL } from "../src/sources.mjs";
const fixture = readFileSync(
  new URL("./fixtures/job-posting.html", import.meta.url),
  "utf8",
);
const lead = {
  id: "fixture",
  title: "搜索标题",
  url: "https://hk.jobsdb.com/job/123456",
  region: "香港",
  source: "hk.jobsdb.com",
  verification: "search-result",
};
const now = new Date("2026-10-27T05:00:00Z");
test("extract schema graph fields with provenance rather than search summary", () => {
  const r = extractDetail(fixture, lead, { now });
  assert.equal(r.ok, true);
  const j = r.job;
  assert.equal(j.company, "测试雇主有限公司");
  assert.equal(j.degree, "本科");
  assert.equal(j.experience, 2);
  assert.equal(j.city, "香港");
  assert.equal(j.salaryMin, 24000);
  assert.equal(j.currency, "HKD");
  assert.equal(j.category, "外企");
  assert.equal(j.status, "open-unconfirmed");
  assert.equal(j.verification, "structured-detail");
  assert.ok(j.skills.includes("SQL"));
  assert.ok(j.fieldEvidence.experience.field);
  assert.ok(j.detailFetchedAt);
});
test("annual salary is not silently converted into a monthly claim", () => {
  const j = extractDetail(fixture.replace("MONTH", "YEAR"), lead, { now }).job;
  assert.equal(j.salaryMin, undefined);
  assert.equal(j.currency, undefined);
});
test("aggregate metadata never becomes one fictional job", () => {
  const two = fixture.replace(
    "</head>",
    '<script type="application/ld+json">{"@type":"JobPosting","title":"Other"}</script></head>',
  );
  assert.match(extractDetail(two, lead, { now }).reason, /多个职位/);
});
test("missing company, malformed JSON and login pages do not get scored", () => {
  assert.equal(
    extractDetail(fixture.replace("测试雇主有限公司", ""), lead, { now }).ok,
    false,
  );
  assert.equal(
    structuredPostings('<script type="application/ld+json">{bad}</script>')
      .length,
    0,
  );
  assert.match(
    extractDetail("<h1>请完成验证</h1>", lead, { now }).reason,
    /验证/,
  );
});
test("expiry and future dates are checked against actual dates", () => {
  assert.equal(
    extractDetail(fixture.replace("2026-11-30", "2026-01-01"), lead, { now })
      .job.status,
    "closed",
  );
  assert.match(
    extractDetail(fixture.replace("2026-10-20", "2030-10-20"), lead, { now })
      .reason,
    /未来/,
  );
});
test("text fallback requires named employer, duties and requirements with exact evidence", () => {
  const html =
    "<html><h1>数据分析师</h1><p>公司名称：测试公司</p><p>工作地点：上海</p><p>工作职责：负责数据分析、经营日报、用户行为数据监控，并定期与业务团队复盘业务发展情况及项目结果。</p><p>任职要求：学历：本科；经验：2年；熟悉 SQL 和 Excel，能够独立完成业务需求与报表分析。</p><p>薪资：人民币 12000–18000元/月</p></html>";
  const j = extractDetail(
    html,
    { ...lead, region: "内地", url: "https://www.liepin.com/job/123.shtml" },
    { now },
  ).job;
  assert.equal(j.company, "测试公司");
  assert.equal(j.city, "上海");
  assert.equal(j.degree, "本科");
  assert.equal(j.experience, 2);
  assert.equal(j.salaryMax, 18000);
  assert.equal(j.fieldEvidence.skills.method, "requirements-text");
});
test("mentions in benefits are not treated as required skills", () => {
  const html = fixture
    .replace(
      "熟练使用 SQL、Excel 和 Python，具备数据分析能力。",
      "了解业务。福利待遇：提供 Java 培训。",
    )
    .replace('"skills":["SQL","Excel","Python"],', "");
  const j = extractDetail(html, lead, { now }).job;
  assert.ok(!j.skills.includes("Java"));
});
test("homepage, lists, job fairs and PDF are filtered, direct jobs remain", () => {
  for (const url of [
    "https://hk.jobsdb.com/",
    "https://www.zhaopin.com/zhaopin/123/",
    "https://hk.jobsdb.com/data-analyst-jobs",
    "https://www.liepin.com/company-jobs/123/",
    "https://www.gov.cn/file.pdf",
  ])
    assert.equal(
      classifyLink({
        ...lead,
        url,
        region: url.includes(".hk") || url.includes("jobsdb") ? "香港" : "内地",
      }).kind,
      "excluded",
    );
  assert.equal(classifyLink(lead).kind, "detail");
});
test("unsafe links and credential-bearing URLs are rejected before fetch", () => {
  assert.equal(sourceURL("http://hk.jobsdb.com/job/1", "香港"), null);
  assert.equal(sourceURL("https://token@hk.jobsdb.com/job/1", "香港"), null);
  assert.equal(
    sourceURL("https://hk.jobsdb.com.evil.invalid/job/1", "香港"),
    null,
  );
});
test("robots longest matching rule and crawler-specific groups respected", () => {
  const rules = "User-agent: *\nDisallow: /job/\nAllow: /job/public/";
  assert.equal(
    robotsAllowed(rules, "https://hk.jobsdb.com/job/private/1"),
    false,
  );
  assert.equal(
    robotsAllowed(rules, "https://hk.jobsdb.com/job/public/1"),
    true,
  );
  assert.equal(
    robotsAllowed(
      "User-agent: CareerCompassBot\nDisallow: /\nUser-agent: *\nAllow: /",
      "https://hk.jobsdb.com/job/1",
    ),
    false,
  );
});
const resolver = async () => [{ address: "203.0.113.8" }];
test("detail reader does not bypass a robots denial", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return new Response("User-agent: *\nDisallow: /job/", {
      headers: { "content-type": "text/plain" },
    });
  };
  const r = await createDetailFetcher({ fetcher, resolver })(lead);
  assert.equal(calls, 1);
  assert.match(r.reason, /robots/);
});
test("private DNS and cross-domain redirects are blocked", async () => {
  const r = await createDetailFetcher({
    resolver: async () => [{ address: "127.0.0.1" }],
    fetcher: async () => {
      throw Error("must not run");
    },
  })(lead);
  assert.match(r.reason, /非公网/);
  const f = async (u) =>
    String(u).endsWith("robots.txt")
      ? new Response("", { headers: { "content-type": "text/plain" } })
      : new Response("", {
          status: 302,
          headers: { location: "https://evil.invalid/" },
        });
  assert.match(
    (await createDetailFetcher({ fetcher: f, resolver })(lead)).reason,
    /跳转/,
  );
});
test("HTTP denial and oversized responses are reported without manufactured fields", async () => {
  const f = async (u) =>
    String(u).endsWith("robots.txt")
      ? new Response("", { headers: { "content-type": "text/plain" } })
      : new Response("Denied", { status: 403 });
  assert.match(
    (await createDetailFetcher({ fetcher: f, resolver })(lead)).reason,
    /403/,
  );
  const large = async () =>
    new Response("x", {
      headers: { "content-type": "text/html", "content-length": "3000000" },
    });
  assert.match(
    (await createDetailFetcher({ fetcher: large, resolver })(lead)).reason,
    /大小/,
  );
});
test("public JobPosting response succeeds without forwarding search credentials", async () => {
  const calls = [];
  const f = async (u, opts) => {
    calls.push(opts.headers);
    return String(u).endsWith("robots.txt")
      ? new Response("", { headers: { "content-type": "text/plain" } })
      : new Response(fixture, {
          headers: { "content-type": "text/html;charset=utf-8" },
        });
  };
  assert.equal(
    (await createDetailFetcher({ fetcher: f, resolver })(lead)).ok,
    true,
  );
  assert.ok(calls.every((h) => !("X-Subscription-Token" in h)));
});
test("plain text strips scripts and decodes entities without executing them", () => {
  assert.equal(
    plainText("<script>alert(1)</script><p>A &amp; B &#x4e2d;</p>"),
    "A & B 中",
  );
});

test("rechecking a page does not carry forward salary removed by the employer", () => {
  const old = {
    ...lead,
    salaryMin: 10000,
    salaryMax: 20000,
    currency: "HKD",
    city: "旧地点",
  };
  const j = extractDetail(fixture.replace("MONTH", "YEAR"), old, { now }).job;
  assert.equal(j.salaryMin, undefined);
  assert.equal(j.currency, undefined);
  assert.equal(j.city, "香港");
});
test("dates without timezone use the supported markets timezone consistently", () => {
  const j = extractDetail(
    fixture.replace("2026-11-30T23:59:59+08:00", "2026-11-30T23:59:59"),
    lead,
    { now },
  ).job;
  assert.equal(j.deadline, "2026-11-30T23:59:59+08:00");
});

test("official HK vacancy table uses named title and department, including dd/mm/yyyy closing date", () => {
  const html =
    "<html><h1>Government Vacancies Advertising & Enquiry System</h1><table><tr><td>Department:</td><td>Test Department</td></tr><tr><td>Job Title:</td><td>Statistical Officer</td></tr><tr><td>Entry Requirements:</td><td>A Bachelor degree and 2 years of relevant experience are required. Applicants must demonstrate professional data analysis and communication capabilities.</td></tr><tr><td>Duties:</td><td>Prepare economic reports, maintain departmental statistics, review data quality and coordinate research projects with the team.</td></tr><tr><td>Closing Date(dd/mm/yyyy):</td><td>30/11/2026 23:59:00</td></tr></table></html>";
  const j = extractDetail(
    html,
    {
      ...lead,
      url: "https://csboa1.csb.gov.hk/csboa/jve/JVE_003_text.action?jobid=123&languageType=1",
    },
    { now },
  ).job;
  assert.equal(j.title, "Statistical Officer");
  assert.equal(j.company, "Test Department");
  assert.equal(j.degree, "本科");
  assert.equal(j.experience, 2);
  assert.equal(j.deadline, "2026-11-30T23:59:00+08:00");
  assert.equal(j.category, "公务员／公共机构");
});
test("schema experience string is read as published requirements", () => {
  const html = fixture
    .replace(
      '"experienceRequirements":{"@type":"OccupationalExperienceRequirements","monthsOfExperience":24}',
      '"experienceRequirements":"5-7 years"',
    )
    .replace("2年以上相关工作经验", "相关业务能力");
  assert.equal(extractDetail(html, lead, { now }).job.experience, 5);
});
