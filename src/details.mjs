import { lookup } from "node:dns/promises";
import { setTimeout as delay } from "node:timers/promises";
import { sourceURL } from "./sources.mjs";

export function plainText(html = "") {
  return String(html)
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/td)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, v) => {
      const n =
        v[0].toLowerCase() === "x" ? parseInt(v.slice(1), 16) : Number(v);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ";
    })
    .replace(
      /&(nbsp|amp|quot|apos|lt|gt);/gi,
      (_, x) =>
        ({ nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" })[
          x.toLowerCase()
        ],
    )
    .replace(/[ \t\r]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
const clean = (x) => plainText(typeof x === "string" ? x : "").slice(0, 12000);
function jobObjects(value, out = []) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const v of value) jobObjects(v, out);
    return out;
  }
  if (
    [value["@type"]]
      .flat()
      .some((t) => t === "JobPosting" || t === "https://schema.org/JobPosting")
  )
    out.push(value);
  // Only traverse schema containers. Unrelated embedded app state is not trusted as a posting.
  for (const k of ["@graph", "mainEntity", "itemListElement", "item"])
    if (value[k]) jobObjects(value[k], out);
  return out;
}
export function structuredPostings(html) {
  const result = [];
  for (const script of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
  )) {
    if (!/\btype\s*=\s*["']application\/ld\+json["']/i.test(script[1]))
      continue;
    try {
      jobObjects(
        JSON.parse(script[2].replace(/^\s*<!--|-->\s*$/g, "")),
        result,
      );
    } catch {
      /* malformed metadata is not guessed */
    }
  }
  return result;
}
function dateOnly(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return null;
  if (
    new Date(value.slice(0, 10) + "T00:00:00Z").toISOString().slice(0, 10) !==
    value.slice(0, 10)
  )
    return null;
  // Both supported markets use UTC+08:00. Preserve explicit offsets; normalize missing ones.
  return value.includes("T") && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
    ? value + "+08:00"
    : value;
}
function explicitRequirements(text) {
  const out = {},
    evidence = {};
  const set = (k, v, quote) => {
    out[k] = v;
    evidence[k] = { method: "page-text", quote: quote.slice(0, 240) };
  };
  const degree =
    text.match(
      /(?:学历|學歷|教育程度|教育背景)[：:\s]*(博士|硕士|碩士|本科|学士|學士|大专|大專|专科|高中)(?:及以上|或以上|以上)?/,
    ) ||
    text.match(
      /(?:要求|具备|具備|须|須|具有)\s*(博士|硕士|碩士|本科|学士|學士|大专|大專|专科|高中)(?:及以上|或以上|以上)?(?:学历|學歷|学位|學位)/,
    ) ||
    text.match(
      /(博士|硕士|碩士|本科|学士|學士|大专|大專|专科)(?:及以上|或以上|以上)(?:学历|學歷|学位|學位)?/,
    ) ||
    text.match(
      /(博士|硕士|碩士|本科|学士|學士|大专|大專|专科)(?:学历|學歷|学位|學位)/,
    ) ||
    text.match(
      /\b(Bachelor(?:'s)?|Master(?:'s)?|Doctoral|PhD)\s+(?:degree|qualification)/i,
    );
  if (degree) {
    const v = degree[1];
    set(
      "degree",
      /博士|doctoral|phd/i.test(v)
        ? "博士"
        : /硕士|碩士|master/i.test(v)
          ? "硕士"
          : /大专|大專|专科/.test(v)
            ? "专科"
            : v === "高中"
              ? "高中"
              : "本科",
      degree[0],
    );
  }
  const experience =
    text.match(
      /(?:经验|經驗|工作年限)[：:\s]*(\d{1,2})(?:\s*[-–~至到]\s*\d{1,2})?\s*年/,
    ) ||
    text.match(
      /(\d{1,2})(?:\s*[-–~至到]\s*\d{1,2})?\s*年(?:以上|或以上|及以上)?(?:的)?(?:相关|相關|工作|行业|行業)?(?:工作)?(?:经验|經驗)/,
    ) ||
    text.match(
      /(\d{1,2})(?:\s*[-–]\s*\d{1,2})?\+?\s*years?['’]?\s+(?:of\s+)?(?:relevant\s+|working\s+|work\s+)?experience/i,
    );
  if (experience) set("experience", Number(experience[1]), experience[0]);
  else {
    const no = text.match(
      /(?:经验|經驗)[：:\s]*(?:不限|不要求)|无(?:需)?工作经验|無(?:需)?工作經驗|no (?:prior )?experience (?:is )?required/i,
    );
    if (no) set("experience", 0, no[0]);
  }
  const skills = [];
  const skillQuotes = [];
  const dictionary = [
    "逻辑思维",
    "邏輯思維",
    "沟通表达",
    "溝通表達",
    "文字功底",
    "抗压能力",
    "抗壓能力",
    "报告撰写",
    "報告撰寫",
    "SQL",
    "Excel",
    "Python",
    "Java",
    "JavaScript",
    "TypeScript",
    "Power BI",
    "Tableau",
    "R",
    "SPSS",
    "SAS",
    "数据分析",
    "數據分析",
    "用户运营",
    "用戶運營",
    "报告写作",
    "報告寫作",
    "英语",
    "英語",
    "粤语",
    "粵語",
    "普通话",
    "普通話",
  ];
  const requirements = text.match(
    /(?:任职要求|任職要求|职位要求|職位要求|岗位要求|崗位要求|任职资格|任職資格|入职条件|入職條件|requirements|qualifications|what you bring|you should have)[：:\s]*([\s\S]{10,7000})/i,
  );
  if (requirements) {
    const section = requirements[1].split(
      /(?:福利待遇|薪酬福利|我们提供|我們提供|how to apply|apply now|benefits|about us)/i,
    )[0];
    const mandatorySection = section
      .split("\n")
      .filter(
        (line) =>
          !/优先|優先|preferred|nice to have|加分|advantage/i.test(line),
      )
      .join("\n");
    for (const skill of dictionary) {
      const re = /^[\w .]+$/.test(skill)
        ? new RegExp(
            "\\b" + skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b",
            "i",
          )
        : new RegExp(skill);
      const m = re.exec(mandatorySection);
      if (m) {
        skills.push(skill);
        skillQuotes.push(
          mandatorySection.slice(
            Math.max(0, m.index - 40),
            m.index + skill.length + 65,
          ),
        );
      }
    }
  }
  if (skills.length) {
    out.skills = [
      ...new Set(
        skills.map(
          (s) =>
            ({
              數據分析: "数据分析",
              用戶運營: "用户运营",
              報告寫作: "报告写作",
              英語: "英语",
              粵語: "粤语",
              普通話: "普通话",
            })[s] || s,
        ),
      ),
    ];
    evidence.skills = {
      method: "requirements-text",
      quote: skillQuotes.join("；").slice(0, 700),
    };
  }
  const mode = text.match(
    /(?:工作方式|办公方式|辦公方式)[：:\s]*(远程办公|遠程辦公|混合办公|混合辦公|现场办公|現場辦公)|(?:fully remote|hybrid working|on-site working)/i,
  );
  if (mode)
    set(
      "mode",
      /远程|遠程|remote/i.test(mode[0])
        ? "远程办公"
        : /混合|hybrid/i.test(mode[0])
          ? "混合办公"
          : "现场办公",
      mode[0],
    );
  const hours = text.match(
    /(?:工作时间|工作時間|working hours)[：:\s]*([^\n]{3,120})/i,
  );
  if (hours) set("hours", clean(hours[1]), hours[0]);
  const major = text.match(/(?:专业要求|專業要求)[：:\s]*([^\n]{2,120})/);
  if (major) set("majorRequirement", clean(major[1]), major[0]);
  return { values: out, evidence };
}
function schemaSalary(s) {
  if (!s || typeof s !== "object") return null;
  const v = s.value,
    unit = String(v?.unitText || s.unitText || "").toUpperCase();
  const min = Number(
    v?.minValue ?? v?.value ?? (typeof v === "number" ? v : NaN),
  );
  const max = Number(
    v?.maxValue ?? v?.value ?? (typeof v === "number" ? v : NaN),
  );
  if (
    !["MONTH", "MON", "MONTHLY"].includes(unit) ||
    !["CNY", "HKD"].includes(s.currency) ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    min <= 0 ||
    max < min
  )
    return null;
  return {
    salaryMin: min,
    salaryMax: max,
    currency: s.currency,
    salaryPeriod: "月",
  };
}
function textSalary(text, region) {
  // Require an explicit monthly unit. No inferred currency or annual-to-month conversion.
  const re =
    /(?:月薪|月薪范围|月薪範圍|月薪待遇|薪资|薪資|salary)?[：:\s]*((?:HK\$|HKD|港币|港幣|人民币|人民幣|CNY|RMB)\s*)?(\d[\d,]*(?:\.\d+)?)\s*([kK千万元萬]?)\s*(?:[-–~至到]\s*(\d[\d,]*(?:\.\d+)?)\s*([kK千万萬]?))?\s*((?:HKD|CNY|RMB|港币|港幣|人民币|人民幣|元))?\s*(?:\/\s*(?:月|month)|per month|monthly)/i;
  const m = re.exec(text);
  if (!m) return null;
  const denomination = (m[1] || "") + (m[6] || "");
  const currency = /HK|港/i.test(denomination)
    ? "HKD"
    : /CNY|RMB|人民币|人民幣|元/.test(denomination)
      ? "CNY"
      : null;
  if (
    !currency ||
    (region === "香港" && currency === "CNY" && denomination === "元")
  )
    return null;
  const multiplier = (u) =>
    /k|千/i.test(u) ? 1000 : /万|萬/.test(u) ? 10000 : 1;
  const a = Number(m[2].replace(/,/g, "")) * multiplier(m[3] || m[5]);
  const b = m[4]
    ? Number(m[4].replace(/,/g, "")) * multiplier(m[5] || m[3])
    : a;
  return a > 0 && b >= a
    ? { salaryMin: a, salaryMax: b, currency, salaryPeriod: "月", quote: m[0] }
    : null;
}
function metadata(html, name) {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = Object.fromEntries(
      [...tag[0].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map((x) => [
        x[1].toLowerCase(),
        x[2],
      ]),
    );
    if (attrs.property === name || attrs.name === name)
      return clean(attrs.content);
  }
  return null;
}
function employmentName(v) {
  return (
    {
      FULL_TIME: "全职",
      PART_TIME: "兼职",
      CONTRACTOR: "合同制",
      INTERN: "实习",
      TEMPORARY: "临时工",
    }[v] || null
  );
}
export function extractDetail(html, lead, { now = new Date() } = {}) {
  const postings = structuredPostings(html);
  if (postings.length > 1)
    return { ok: false, reason: "页面包含多个职位，属于汇总页" };
  const text = plainText(html).slice(0, 180000);
  if (
    !postings.length &&
    /captcha|verify you are human|access denied|请完成验证|請完成驗證|登录后查看|登錄後查看|安全验证|安全驗證/i.test(
      text,
    )
  )
    return { ok: false, reason: "页面需要登录或人机验证" };
  const p = postings[0];
  const evidence = {};
  const values = {};
  const set = (key, value, field) => {
    if (value !== null && value !== undefined && value !== "") {
      values[key] = value;
      evidence[key] = {
        method: "schema.org/JobPosting",
        field,
        quote: (typeof value === "string"
          ? value
          : JSON.stringify(value)
        ).slice(0, 500),
      };
    }
  };
  let description, method;
  if (p) {
    method = "structured";
    set("title", clean(p.title), "title");
    set(
      "company",
      clean(p.hiringOrganization?.name),
      "hiringOrganization.name",
    );
    description = clean(p.description);
    const location = [p.jobLocation]
      .flat()
      .filter(Boolean)
      .map((l) => l.address)
      .filter(Boolean);
    const cities = location.map((a) =>
      typeof a === "string"
        ? clean(a)
        : clean(a.addressLocality || a.addressRegion),
    );
    if (cities.some(Boolean))
      set(
        "city",
        [...new Set(cities.filter(Boolean))].join("、"),
        "jobLocation.address",
      );
    const education = [p.educationRequirements]
      .flat()
      .map((x) => (typeof x === "string" ? x : x?.credentialCategory || ""))
      .join(" ");
    const combined = explicitRequirements(
      "学历：" + education + "\n" + description,
    );
    Object.assign(values, combined.values);
    Object.assign(evidence, combined.evidence);
    if (education && values.degree)
      evidence.degree = {
        method: "schema.org/JobPosting",
        field: "educationRequirements",
        quote: education.slice(0, 500),
      };
    if (p.experienceRequirements?.monthsOfExperience !== undefined) {
      const n = Number(p.experienceRequirements.monthsOfExperience);
      if (Number.isFinite(n) && n >= 0)
        set("experience", n / 12, "experienceRequirements.monthsOfExperience");
    }
    if (
      typeof p.experienceRequirements === "string" &&
      !Number.isFinite(values.experience)
    ) {
      const years = p.experienceRequirements.match(
        /(\d{1,2})(?:\s*[-–~至到]\s*\d{1,2})?\s*(?:年|years?)/i,
      );
      if (years) set("experience", Number(years[1]), "experienceRequirements");
      else if (
        /不限|不要求|无经验|無經驗|应届|應屆|在校生|no experience required|fresh graduate/i.test(
          p.experienceRequirements,
        )
      )
        set("experience", 0, "experienceRequirements");
    }
    const salary = schemaSalary(p.baseSalary);
    if (salary)
      for (const [k, v] of Object.entries(salary)) set(k, v, "baseSalary");
    const skills = [p.skills]
      .flat()
      .filter((x) => typeof x === "string")
      .flatMap((x) => x.split(/[,，;；\n]/))
      .map(clean)
      .filter((x) => x && x.length < 80);
    if (skills.length)
      set(
        "skills",
        [...new Set([...(values.skills || []), ...skills])].slice(0, 40),
        "skills",
      );
    set("postedAt", dateOnly(p.datePosted), "datePosted");
    set("deadline", dateOnly(p.validThrough), "validThrough");
    if (p.jobLocationType === "TELECOMMUTE")
      set("mode", "远程办公", "jobLocationType");
    set(
      "employment",
      employmentName([p.employmentType].flat()[0]),
      "employmentType",
    );
  } else {
    // Text fallback requires a concrete title, named employer and separate duties/requirements.
    method = "page-text";
    const officialHK =
      new URL(lead.url).hostname.endsWith("csb.gov.hk") &&
      new URL(lead.url).searchParams.has("jobid");
    const officialTitle = officialHK
      ? text.match(
          /(?:^|\n)\s*(?:Job Title|職位名稱|职位名称)[：:\s]*([^\n]{2,120})/i,
        )
      : null;
    const title = clean(
      officialTitle?.[1] ||
        html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i)?.[1] ||
        metadata(html, "og:title"),
    );
    const employer =
      text.match(
        /(?:公司名称|公司名稱|招聘单位|招聘單位|雇主|僱主|hiring organization|employer)[：:\s]*([^\n]{2,100})/i,
      ) ||
      (officialHK
        ? text.match(
            /(?:^|\n)\s*(?:Department|Bureau|部門|部门)[：:\s]*([^\n]{2,120})/i,
          )
        : null);
    if (
      !title ||
      !employer ||
      !/(?:岗位职责|崗位職責|工作职责|工作職責|工作内容|工作內容|responsibilities|duties)/i.test(
        text,
      ) ||
      !/(?:任职要求|任職要求|职位要求|職位要求|入职条件|入職條件|requirements|qualifications)/i.test(
        text,
      )
    )
      return {
        ok: false,
        reason: "未取得单一职位的公司、职责及要求；可能是动态页面或汇总页",
      };
    values.title = title;
    values.company = clean(employer[1]);
    evidence.title = { method, quote: title };
    evidence.company = { method, quote: employer[0] };
    const start = text.search(
      /(?:岗位职责|崗位職責|工作职责|工作職責|工作内容|工作內容|任职要求|任職要求|入职条件|入職條件|entry requirements|responsibilities|duties|qualifications)/i,
    );
    description = text.slice(Math.max(0, start), Math.max(0, start) + 12000);
    const parsed = explicitRequirements(description);
    Object.assign(values, parsed.values);
    Object.assign(evidence, parsed.evidence);
    const city = text.match(
      /(?:工作地点|工作地點|工作地区|工作地區|job location)[：:\s]*([^\n]{2,100})/i,
    );
    if (city) {
      values.city = clean(city[1]);
      evidence.city = { method, quote: city[0] };
    }
    const end = text.match(
      /(?:截止日期|截止时间|截止時間|closing date)[：:\s]*(\d{4}[-/]\d{1,2}[-/]\d{1,2})/i,
    );
    if (end) {
      const date = end[1]
        .split(/[-/]/)
        .map((s, i) => (i ? s.padStart(2, "0") : s))
        .join("-");
      values.deadline = dateOnly(date);
      evidence.deadline = { method, quote: end[0] };
    }
    if (officialHK && !values.deadline) {
      const hkEnd = text.match(
        /(?:Closing Date\s*(?:\(dd\/mm\/yyyy\))?|截止申請日期|截止申请日期|截止日期)[：:\s]*(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{2}:\d{2}(?::\d{2})?))?/i,
      );
      if (hkEnd) {
        const raw =
          `${hkEnd[3]}-${hkEnd[2].padStart(2, "0")}-${hkEnd[1].padStart(2, "0")}` +
          (hkEnd[4] ? "T" + hkEnd[4] + "+08:00" : "");
        values.deadline = dateOnly(raw);
        evidence.deadline = { method: "official-page-text", quote: hkEnd[0] };
      }
    }
  }
  if (
    !values.title ||
    !values.company ||
    !description ||
    description.length < 80
  )
    return { ok: false, reason: "职位详情缺少明确名称、公司或完整描述" };
  if (!values.deadline) {
    const chinese = description.match(
      /(?:截止日期|截止时间|截止時間|截止申请日期|截止申請日期)[：:\s]*(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/,
    );
    const iso = description.match(
      /(?:截止日期|截止时间|截止時間|closing date)[：:\s]*(\d{4})[-/](\d{1,2})[-/](\d{1,2})/i,
    );
    const m = chinese || iso;
    if (m) {
      const value = dateOnly(
        `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
      );
      if (value) {
        values.deadline = value;
        evidence.deadline = { method: "description-text", quote: m[0] };
      }
    }
  }
  const cohortText = [values.title, description].join("\n");
  const cohorts = [...cohortText.matchAll(/(20\d{2})\s*[届屆]/g)];
  if (cohorts.length) {
    values.graduationYears = [...new Set(cohorts.map((m) => Number(m[1])))];
    evidence.graduationYears = {
      method: "title-and-description",
      quote: cohorts.map((m) => m[0]).join("、"),
    };
  }
  if (!values.salaryMin) {
    const s = textSalary(description, lead.region);
    if (s) {
      const { quote, ...data } = s;
      Object.assign(values, data);
      for (const k of Object.keys(data))
        evidence[k] = { method: "page-text", quote };
    }
  }
  const categoryText = description.match(
    /(?:企业性质|企業性質|单位性质|單位性質)[：:\s]*(中央企业|中央企業|国有企业|國有企業|国企|國企|外资|外資|民营|民營|私营|私營|事业单位|事業單位|非营利|非牟利)/,
  );
  let category = "待核实";
  if (categoryText) {
    category = /国|國|中央/.test(categoryText[1])
      ? "央国企"
      : /外/.test(categoryText[1])
        ? "外企"
        : /事业|事業/.test(categoryText[1])
          ? "事业单位／高校"
          : /非/.test(categoryText[1])
            ? "非营利组织"
            : "私企";
    evidence.category = { method: "page-text", quote: categoryText[0] };
  }
  if (new URL(lead.url).hostname.endsWith("csb.gov.hk")) {
    category = "公务员／公共机构";
    evidence.category = {
      method: "official-source",
      quote: "香港公务员事务局",
    };
  }
  const deadline = values.deadline;
  const deadlineTime = deadline
    ? deadline.includes("T")
      ? Date.parse(deadline)
      : Date.parse(deadline + "T23:59:59+08:00")
    : NaN;
  const closed =
    (Number.isFinite(deadlineTime) && deadlineTime < now.getTime()) ||
    /(?:该职位已|該職位已|此职位已|此職位已)(?:关闭|關閉|结束|結束|下线|下線)|this (?:job|position|vacancy) (?:has expired|is no longer available|is closed)/i.test(
      text,
    );
  const future =
    values.postedAt && Date.parse(values.postedAt) > now.getTime() + 86400000;
  if (future)
    return { ok: false, reason: "发布时间异常（未来日期），需要人工核实" };
  const requirements = Object.keys(evidence).filter((k) =>
    ["skills", "experience", "degree"].includes(k),
  );
  return {
    ok: true,
    job: {
      id: lead.id,
      url: lead.url,
      source: lead.source,
      region: lead.region,
      discoveredAt: lead.discoveredAt,
      searchGroup: lead.searchGroup,
      demo: false,
      ...values,
      description,
      skills: values.skills || [],
      category,
      fieldEvidence: evidence,
      detailFetchedAt: now.toISOString(),
      verification:
        method === "structured" ? "structured-detail" : "page-detail",
      status: closed ? "closed" : "open-unconfirmed",
      assessable: requirements.length >= 1,
      missingFields: [
        "city",
        "degree",
        "experience",
        "salaryMin",
        "deadline",
      ].filter((k) => values[k] === undefined || values[k] === null),
      detailMethod: method,
    },
  };
}

export function robotsAllowed(body, target) {
  const path = new URL(target).pathname + new URL(target).search;
  const groups = [];
  let group = null;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const name = m[1].toLowerCase(),
      value = m[2].trim();
    if (name === "user-agent") {
      if (!group || group.rules.length) {
        group = { agents: [], rules: [] };
        groups.push(group);
      }
      group.agents.push(value.toLowerCase());
    } else if (group && ["allow", "disallow"].includes(name) && value)
      group.rules.push({ allow: name === "allow", path: value });
  }
  const specific = groups.filter((g) =>
    g.agents.some((a) => a !== "*" && "careercompassbot".includes(a)),
  );
  const relevant = specific.length
    ? specific
    : groups.filter((g) => g.agents.includes("*"));
  let best = null;
  for (const g of relevant)
    for (const rule of g.rules) {
      const pattern = rule.path
        .split("*")
        .map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*")
        .replace(/\\\$$/, "$");
      if (
        new RegExp("^" + pattern).test(path) &&
        (!best ||
          rule.path.length > best.path.length ||
          (rule.path.length === best.path.length && rule.allow))
      )
        best = rule;
    }
  return !best || best.allow;
}
function publicAddress(ip) {
  if (ip.includes(":")) return /^(?:2|3)[0-9a-f]{0,3}:/i.test(ip); // IPv6 global unicast only.
  const a = ip.split(".").map(Number);
  if (a.length !== 4 || a.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    return false;
  return !(
    a[0] === 0 ||
    a[0] === 10 ||
    a[0] === 127 ||
    a[0] >= 224 ||
    (a[0] === 169 && a[1] === 254) ||
    (a[0] === 172 && a[1] >= 16 && a[1] <= 31) ||
    (a[0] === 192 && (a[1] === 168 || a[1] === 0)) ||
    (a[0] === 100 && a[1] >= 64 && a[1] <= 127) ||
    (a[0] === 198 && (a[1] === 18 || a[1] === 19))
  );
}
export function createDetailFetcher({
  fetcher = fetch,
  resolver = lookup,
  timeout = 12000,
} = {}) {
  const robots = new Map();
  async function request(raw, region, maxBytes = 2000000) {
    let url = sourceURL(raw, region);
    if (!url) throw Error("目标或跳转地址不在允许的招聘来源范围");
    for (let n = 0; n < 4; n++) {
      const addresses = await resolver(url.hostname, { all: true });
      if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
        throw Error("拒绝访问非公网地址");
      let res;
      for (let retry = 0; retry < 2; retry++) {
        try {
          res = await fetcher(url, {
            redirect: "manual",
            headers: {
              "User-Agent":
                "CareerCompassBot/1.0 (+https://github.com/winne-wang0505/resume)",
              Accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
            },
            signal: AbortSignal.timeout(timeout),
          });
          break;
        } catch (error) {
          if (
            retry === 0 &&
            /^(?:ECONNRESET|ETIMEDOUT|UND_ERR_SOCKET|EAI_AGAIN)$/.test(
              error.cause?.code || error.code || "",
            )
          ) {
            await delay(750);
            continue;
          }
          throw error;
        }
      }

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        await res.body?.cancel?.();
        url = sourceURL(new URL(res.headers.get("location"), url).href, region);
        if (!url) throw Error("跳转至不支持或需要登录的站点");
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel?.();
        throw Error(`来源返回 HTTP ${res.status}`);
      }
      const type = res.headers.get("content-type") || "";
      if (!/text\/html|application\/xhtml|text\/plain/i.test(type)) {
        await res.body?.cancel?.();
        throw Error("页面不是可解析文本");
      }
      if (Number(res.headers.get("content-length")) > maxBytes) {
        await res.body?.cancel?.();
        throw Error("页面超过大小限制");
      }
      if (!res.body?.getReader) {
        const body = await res.text();
        if (Buffer.byteLength(body) > maxBytes) throw Error("页面超过大小限制");
        return { body, url: url.href };
      }
      const reader = res.body.getReader(),
        chunks = [];
      let size = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw Error("页面超过大小限制");
        }
        chunks.push(Buffer.from(value));
      }
      const charset = type.match(/charset\s*=\s*([^; ]+)/i)?.[1] || "utf-8";
      let body;
      try {
        body = new TextDecoder(charset).decode(Buffer.concat(chunks));
      } catch {
        body = Buffer.concat(chunks).toString("utf8");
      }
      return { body, url: url.href };
    }
    throw Error("跳转次数过多");
  }
  return async (lead) => {
    const u = sourceURL(lead.url, lead.region);
    if (!u) return { ok: false, reason: "来源不在支持范围" };
    try {
      if (!robots.has(u.origin))
        robots.set(
          u.origin,
          request(u.origin + "/robots.txt", lead.region, 512000)
            .then((r) => r.body)
            .catch((e) => {
              if (/HTTP 404/.test(e.message)) return "";
              throw e;
            }),
        );
      const rules = await robots.get(u.origin);
      if (!robotsAllowed(rules, u.href))
        return { ok: false, reason: "来源 robots.txt 不允许自动读取此路径" };
      const result = await request(u.href, lead.region);
      return extractDetail(result.body, { ...lead, url: result.url });
    } catch (e) {
      const code = e.cause?.code || e.code || "";
      const reason =
        e.name === "TimeoutError" || /TIMEOUT|ETIMEDOUT/.test(code)
          ? "来源访问超时"
          : /CERT|TLS/.test(code)
            ? "来源 TLS 证书无法验证，保持安全校验，暂不读取"
            : /ENOTFOUND|EAI_AGAIN/.test(code)
              ? "来源域名暂时无法解析"
              : /ECONNRESET|UND_ERR_SOCKET/.test(code)
                ? "来源连接中断，稍后可重新核实"
                : e.message === "fetch failed"
                  ? "来源网络连接失败（不是搜索密钥错误）"
                  : e.message;
      return { ok: false, reason };
    }
  };
}
