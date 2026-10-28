import assert from "node:assert/strict";
import { createBrowserRenderer } from "../src/browser.mjs";
import { robotsAllowed, extractDetail } from "../src/details.mjs";
export async function checkRenderer() {
  const browser = await createBrowserRenderer();
  const calls = [];
  const posting = {
    "@type": "JobPosting",
    title: "数据分析师",
    hiringOrganization: { name: "渲染测试雇主" },
    jobLocation: { address: { addressLocality: "深圳", addressCountry: "CN" } },
    description:
      "岗位职责：负责分析经营指标与数据，梳理数据需求、维护数据报表并解释指标变化，形成可复用的分析报告，与业务和产品团队合作提出行动建议。任职要求：本科学历，2年以上相关工作经验，熟练 SQL、Excel 和 Python，具备沟通表达能力。",
  };
  try {
    const html = await browser.render(
      "https://careers.tencent.com/jobdesc.html?postId=123456",
      {
        region: "内地",
        robotsAllowed,
        request: async (raw) => {
          const url = new URL(raw);
          calls.push(url.href);
          assert.equal(url.origin, "https://careers.tencent.com");
          if (url.pathname === "/robots.txt")
            return {
              body: "User-agent: *\nDisallow: /blocked.js",
              type: "text/plain",
            };
          if (url.pathname === "/app.js")
            return {
              body: `const s=document.createElement('script');s.type='application/ld+json';s.textContent=${JSON.stringify(JSON.stringify(posting))};document.head.append(s);`,
              type: "application/javascript",
            };
          return {
            body: `<html><head></head><body><script src="/blocked.js"></script><script src="https://example.com/forbidden.js"></script><script src="/app.js"></script><script>fetch('/secret', {method:'POST'}).catch(()=>{});</script></body></html>`,
            type: "text/html",
          };
        },
      },
    );
    assert.equal(
      extractDetail(html, {
        id: "browser",
        url: "https://careers.tencent.com/jobdesc.html?postId=123456",
        region: "内地",
      }).ok,
      true,
    );
    assert.ok(calls.some((x) => x.endsWith("/app.js")));
    assert.ok(!calls.some((x) => /blocked|secret|forbidden/.test(x)));
    assert.ok(!html.includes("method:'POST'"));
    console.log(
      "Browser reader passed: actual JS rendering, robots, same-origin and GET-only limits",
    );
  } finally {
    await browser.close();
  }
}
