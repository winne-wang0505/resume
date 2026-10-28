import { extractDetail } from "./details.mjs";
const escape = (s) =>
  String(s || "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function importManual(
  input,
  { now = new Date(), id = "local-" + crypto.randomUUID() } = {},
) {
  for (const key of ["title", "company", "city", "text"])
    if (!String(input[key] || "").trim())
      throw Error("请填写岗位名称、雇主、工作地点并粘贴完整正文");
  if (input.text.length < 80 || input.text.length > 30000)
    throw Error("正文需要 80–30000 字符，包含岗位职责和任职要求");
  if (
    (
      input.text.match(
        /(?:岗位职责|工作职责|工作内容|responsibilities)[：:]/gi,
      ) || []
    ).length > 1
  )
    throw Error("请每次只粘贴一个岗位，避免合并不同职位的要求");
  if (!["内地", "香港"].includes(input.region)) throw Error("请选择内地或香港");
  let original = "";
  if (input.url) {
    const u = new URL(input.url);
    if (u.protocol !== "https:" || u.username || u.password)
      throw Error("来源链接需为不含账户信息的 HTTPS 地址");
    original = u.href;
  }
  // The placeholder never triggers a network request. Imported text is escaped,
  // not interpreted as markup or metadata supplied by a third party.
  const html = `<h1>${escape(input.title)}</h1><p>公司名称：${escape(input.company)}</p><p>工作地点：${escape(input.city)}</p><p>${escape(input.text).replace(/\n/g, "<br>")}</p>`;
  const result = extractDetail(
    html,
    { id, url: "https://www.liepin.com/job/local.shtml", region: input.region },
    { now },
  );
  if (!result.ok)
    throw Error(result.reason + "；请粘贴包含职责与要求小标题的单个岗位正文");
  const job = {
    ...result.job,
    url: original,
    userProvided: true,
    recheckPending: true,
    source: "本机导入",
    sourceLabel: "用户粘贴，未经网站验证",
    sourceType: "用户提供",
    importedAt: now.toISOString(),
    verification: "user-provided-detail",
    detailMethod: "user-provided-text",
  };
  for (const evidence of Object.values(job.fieldEvidence))
    evidence.method = "user-provided-text";
  return job;
}
