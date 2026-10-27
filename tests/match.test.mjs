import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, safeURL } from "../src/match.mjs";
const p = {
  degree: "本科",
  years: 3,
  skills: "SQL，Excel，英语",
  experience: "3 年报表开发",
  achievements: "数据项目奖",
};
const prefs = {
  city: "香港",
  currency: "HKD",
  salary: 20000,
  mode: "混合办公",
};
const job = {
  degree: "本科",
  experience: 2,
  skills: ["SQL", "Excel"],
  city: "香港",
  currency: "HKD",
  salaryMin: 22000,
  salaryMax: 30000,
  mode: "混合办公",
};
test("fully matched requirements receive high scores with evidence", () => {
  const r = evaluate(p, prefs, job);
  assert.equal(r.match, 100);
  assert.equal(r.readiness, 100);
  assert.equal(r.confidence, 100);
  assert.ok(r.value >= 90);
  assert.equal(r.blockers.length, 0);
  assert.equal(r.dims.length, 6);
});
test("search snippets without requirements cannot manufacture scores", () => {
  const r = evaluate(p, prefs, { title: "Search lead", skills: [] });
  assert.equal(r.match, null);
  assert.equal(r.readiness, null);
  assert.equal(r.value, null);
  assert.equal(r.confidence, 0);
});
test("age and gender cannot change ranking", () => {
  assert.deepEqual(
    evaluate({ ...p, age: 24, gender: "女" }, prefs, job),
    evaluate({ ...p, age: 55, gender: "男" }, prefs, job),
  );
});
test("currency mismatch never compares HKD with CNY", () => {
  const r = evaluate(p, { ...prefs, currency: "CNY" }, job);
  assert.ok(!r.dims.some((d) => d.name === "薪资"));
  assert.equal(r.confidence, 85);
});
test("unmet degree and experience are visible blockers", () => {
  const r = evaluate(
    { ...p, degree: "专科", years: 0, skills: "" },
    prefs,
    job,
  );
  assert.equal(r.blockers.length, 2);
  assert.ok(r.match < 60);
  assert.deepEqual(r.missing, ["SQL", "Excel"]);
});
test("expired jobs cannot be recommended for applying", () => {
  assert.equal(
    evaluate(p, prefs, { ...job, deadline: "2000-01-01" }).expired,
    true,
  );
});
test("external links reject executable and local schemes", () => {
  assert.equal(safeURL("javascript:alert(1)"), null);
  assert.equal(safeURL("file:///etc/passwd"), null);
  assert.equal(safeURL("https://www.gov.hk/"), "https://www.gov.hk/");
});

test("short skill names and language aliases do not create false matches", () => {
  const r = evaluate({ ...p, skills: "JavaScript，Power BI，English" }, prefs, {
    ...job,
    skills: ["Java", "R", "英语"],
  });
  assert.deepEqual(r.missing, ["Java", "R"]);
  assert.match(r.evidence[0], /1\/3/);
});

test("AI keyword uses word boundaries and slash-separated role choices work", () => {
  assert.equal(
    evaluate(p, { ...prefs, role: "AI" }, { ...job, title: "Retail Manager" })
      .roleAligned,
    false,
  );
  assert.equal(
    evaluate(
      p,
      { ...prefs, role: "AI/产品" },
      { ...job, title: "Product Manager" },
    ).roleAligned,
    true,
  );
});
