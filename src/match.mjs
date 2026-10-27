export const degreeRank = {
  不限: 0,
  高中: 1,
  专科: 2,
  本科: 3,
  硕士: 4,
  博士: 5,
};
export function roleAlignment(role, title, description = "") {
  if (!String(role || "").trim()) return null;
  const aliases = [
    ["数据分析", "數據分析", "data analyst", "data analysis"],
    ["商业分析", "商業分析", "业务分析", "業務分析", "business analyst"],
    ["产品运营", "產品運營", "产品营运", "product operations"],
    [
      "软件开发",
      "軟件開發",
      "软件工程师",
      "軟件工程師",
      "software engineer",
      "software developer",
    ],
    ["产品", "產品", "product"],
    ["算法", "algorithm"],
    ["大模型", "llm", "large language model"],
    ["开发", "開發", "developer", "development"],
    ["运营", "運營", "operations"],
    ["快消", "fmcg"],
    ["金融", "finance", "financial"],
    ["会计", "會計", "accountant", "accounting"],
    ["市场营销", "市場營銷", "marketing"],
    ["人力资源", "人力資源", "human resources", "hr"],
  ];
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  const contains = (text, term) => {
    if (/^[a-z0-9 .+#-]+$/.test(term)) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(
        "(?:^|[^a-z0-9])" + escaped + "(?:$|[^a-z0-9])",
        "i",
      ).test(text);
    }
    return text.includes(term);
  };
  const t = norm(title),
    terms = String(role)
      .split(/[,，、;；/\n]/)
      .map(norm)
      .filter(Boolean);
  return terms.some(
    (term) =>
      contains(t, term) ||
      (/金融|finance|financial/i.test(term) &&
        /证券研究|證券研究|投研|投资研究|投資研究|金融|财务|財務|equity research|investment|financial|banking/i.test(
          String(description).split(
            /任职|任職|requirements|qualifications/i,
          )[0],
        )) ||
      aliases.some(
        (group) =>
          group.some(
            (a) =>
              norm(a) === term ||
              (term.endsWith("师") && term.slice(0, -1) === norm(a)),
          ) && group.some((a) => contains(t, norm(a))),
      ),
  );
}
export function evaluate(profile, prefs, job, { now = new Date() } = {}) {
  const skills = String(profile.skills || "")
    .split(/[,，、\n]/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  const required = (job.skills || []).filter(
    (x) => typeof x === "string" && x.trim(),
  );
  const skillAliases = {
    english: "英语",
    英語: "英语",
    cantonese: "粤语",
    粵語: "粤语",
    mandarin: "普通话",
    普通話: "普通话",
    數據分析: "数据分析",
  };
  const normalSkill = (s) => skillAliases[s.toLowerCase()] || s.toLowerCase();
  const normalized = skills.map(normalSkill);
  const matched = required.filter((x) => {
    const target = normalSkill(x);
    return normalized.some((s) => {
      if (s === target) return true;
      if (/^[a-z0-9 .+#-]+$/.test(target)) {
        const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(
          "(?:^|[^a-z0-9])" + escaped + "(?:$|[^a-z0-9])",
          "i",
        ).test(s);
      }
      return target.length >= 2 && s.includes(target);
    });
  });
  const missing = required.filter((x) => !matched.includes(x));
  const evidence = [];
  const blockers = [];
  const dims = [];
  const add = (name, value, weight, reason) => {
    dims.push({ name, value, weight });
    evidence.push(reason);
  };
  if (required.length)
    add(
      "技能",
      Math.round((matched.length / required.length) * 100),
      35,
      `技能覆盖 ${matched.length}/${required.length}：${matched.join("、") || "暂无明确匹配"}`,
    );
  if (job.degree && job.degree !== "不限") {
    const ok =
      (degreeRank[profile.degree] || 0) >= (degreeRank[job.degree] || 0);
    add(
      "学历",
      ok ? 100 : 20,
      15,
      `岗位学历：${job.degree}；你的学历：${profile.degree}`,
    );
    if (!ok) blockers.push("学历门槛未满足，请核实是否接受同等经验");
  }
  if (Number.isFinite(job.experience)) {
    const years = Number(profile.years) || 0;
    add(
      "经验",
      job.experience === 0
        ? 100
        : Math.min(100, Math.round((years / job.experience) * 100)),
      20,
      `要求 ${job.experience} 年经验，你填写 ${years} 年`,
    );
    if (years < job.experience) blockers.push("经验年限低于岗位要求");
  }
  if (prefs.city && job.city)
    add(
      "地点",
      String(prefs.city)
        .split(/[,，、/;；\n]/)
        .map((x) => x.trim())
        .filter(Boolean)
        .some((x) => job.city.includes(x) || x.includes(job.city))
        ? 100
        : 20,
      10,
      `工作地点：${job.city}`,
    );
  if (job.salaryMin && job.currency === prefs.currency) {
    add(
      "薪资",
      job.salaryMax >= Number(prefs.salary) ? 100 : 30,
      15,
      `月薪范围 ${job.salaryMin}–${job.salaryMax} ${job.currency}`,
    );
  }
  if (prefs.mode !== "不限" && job.mode)
    add(
      "工作方式",
      job.mode === prefs.mode ? 100 : 30,
      5,
      `工作方式：${job.mode}`,
    );
  const roleAligned = roleAlignment(prefs.role, job.title, job.description);
  if (roleAligned !== null)
    add(
      "岗位方向",
      roleAligned ? 100 : 20,
      15,
      roleAligned
        ? "职位名称或主要职责与目标方向关键词相符"
        : "职位名称及主要职责尚未与目标方向关键词对应，请核实",
    );
  const total = dims.reduce((s, d) => s + d.weight, 0);
  const coreWeight = dims
    .filter((d) => ["技能", "学历", "经验"].includes(d.name))
    .reduce((s, d) => s + d.weight, 0);
  const personalKnown = Boolean(
    String(profile.skills || "").trim() ||
    String(profile.experience || "").trim() ||
    String(profile.major || "").trim(),
  );
  const scoreReason =
    job.verification === "search-result"
      ? "尚未取得岗位详情，搜索摘要不用于评分"
      : !personalKnown
        ? "请先补充技能、专业或经历"
        : coreWeight < 35 || total < 50
          ? "已披露的任职要求不足，暂不生成分数"
          : null;
  const match =
    !scoreReason && total
      ? Math.round(dims.reduce((s, d) => s + d.value * d.weight, 0) / total)
      : null;
  const confidence = Math.min(
    100,
    Math.round((total / (roleAligned === null ? 100 : 115)) * 100),
  );
  // Readiness estimates preparedness against published requirements, never applicant ranking.
  const readiness =
    match === null
      ? null
      : Math.max(
          0,
          Math.min(
            100,
            Math.round(
              match * 0.85 +
                (String(profile.achievements || "").trim() ? 10 : 0) +
                (String(profile.experience || "").trim() ? 5 : 0),
            ),
          ),
        );
  const unverifiedRequirements = [];
  if (job.graduationYears?.length) {
    const year = Number(profile.graduation);
    if (!year)
      unverifiedRequirements.push(
        `岗位面向 ${job.graduationYears.join("、")} 届，请补充毕业年份并核实资格`,
      );
    else if (!job.graduationYears.includes(year))
      blockers.push(
        `毕业届别不符：岗位面向 ${job.graduationYears.join("、")} 届，你填写 ${year} 年`,
      );
  }
  const cost = job.applyMinutes || 30;
  const value =
    match === null
      ? null
      : Math.max(
          0,
          Math.min(
            100,
            Math.round(
              match * 0.65 +
                readiness * 0.25 +
                Math.max(0, 100 - cost) * 0.1 -
                (blockers.length ? 15 : 0),
            ),
          ),
        );
  const rawDeadline = job.deadline;
  const deadlineAt = rawDeadline
    ? rawDeadline.includes("T")
      ? Date.parse(rawDeadline)
      : Date.parse(rawDeadline + "T23:59:59+08:00")
    : NaN;
  const expired =
    job.status === "closed" ||
    (Number.isFinite(deadlineAt) && deadlineAt < now.getTime());
  return {
    match,
    scoreReason,
    unverifiedRequirements,
    roleAligned,
    readiness,
    value,
    confidence,
    dims,
    evidence,
    missing,
    blockers,
    expired,
    advice: expired
      ? "已截止，寻找同类岗位"
      : match === null
        ? scoreReason || "信息不足：先查看原始招聘公告"
        : roleAligned === false
          ? "岗位方向尚未对应：先核实职责，暂不列为优先推荐"
          : blockers.length
            ? "先核实硬性门槛，再决定是否投入时间"
            : unverifiedRequirements.length
              ? "先核实毕业届别等资格要求，再决定是否投递"
              : confidence < 50
                ? "已知要求较少：先补齐原公告信息，再决定是否投递"
                : value >= 75
                  ? "优先投递：定制简历并准备岗位案例"
                  : value >= 50
                    ? "选择性投递：补足缺失技能后再申请"
                    : "低优先级：建议调整方向或先补齐能力",
  };
}
export function safeURL(value) {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
