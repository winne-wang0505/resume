export const sources = {
  内地: [
    "zhaopin.com",
    "liepin.com",
    "51job.com",
    "iguopin.com",
    "sasac.gov.cn",
    "mohrss.gov.cn",
    "scs.gov.cn",
    "gov.cn",
  ],
  香港: [
    "hk.jobsdb.com",
    "ctgoodjobs.hk",
    "jobs.gov.hk",
    "csb.gov.hk",
    "careers.gov.hk",
    "hk.indeed.com",
  ],
};
// Public recruitment entry points, not authenticated feeds. Each result must still
// pass robots, single-posting extraction and eligibility checks.
export const sourceCatalog = [
  {
    id: "zhaopin",
    name: "智联招聘",
    host: "zhaopin.com",
    search: "jobs.zhaopin.com",
    type: "招聘平台",
    regions: ["内地"],
  },
  {
    id: "liepin",
    name: "猎聘",
    host: "liepin.com",
    search: "liepin.com/job/",
    type: "招聘平台",
    regions: ["内地"],
  },
  {
    id: "51job",
    name: "前程无忧",
    host: "51job.com",
    search: "jobs.51job.com",
    type: "招聘平台",
    regions: ["内地"],
  },
  {
    id: "iguopin",
    name: "国聘",
    host: "iguopin.com",
    search: "iguopin.com/job/",
    type: "招聘平台",
    regions: ["内地"],
  },
  {
    id: "boss",
    name: "BOSS直聘",
    host: "zhipin.com",
    search: "zhipin.com/job_detail/",
    type: "招聘平台",
    regions: ["内地"],
  },
  {
    id: "nowcoder",
    name: "牛客校招",
    host: "nowcoder.com",
    search: "nowcoder.com/jobs/",
    type: "校招／实习",
    regions: ["内地"],
  },
  {
    id: "shixiseng",
    name: "实习僧",
    host: "shixiseng.com",
    search: "shixiseng.com/intern/",
    type: "校招／实习",
    regions: ["内地"],
  },
  {
    id: "yingjiesheng",
    name: "应届生求职网",
    host: "yingjiesheng.com",
    search: "yingjiesheng.com",
    type: "校招／实习",
    regions: ["内地"],
  },
  {
    id: "jobsdb",
    name: "JobsDB 香港",
    host: "hk.jobsdb.com",
    search: "hk.jobsdb.com/job/",
    type: "招聘平台",
    regions: ["香港"],
  },
  {
    id: "ctgoodjobs",
    name: "CTgoodjobs",
    host: "ctgoodjobs.hk",
    search: "jobs.ctgoodjobs.hk/job/",
    type: "招聘平台",
    regions: ["香港"],
  },
  {
    id: "indeed",
    name: "Indeed 香港",
    host: "hk.indeed.com",
    search: "hk.indeed.com/viewjob",
    type: "招聘平台",
    regions: ["香港"],
  },
  {
    id: "gradconnection",
    name: "GradConnection 香港",
    host: "hk.gradconnection.com",
    search: "hk.gradconnection.com",
    type: "校招／实习",
    regions: ["香港"],
  },
  {
    id: "tencent",
    name: "腾讯招聘",
    host: "careers.tencent.com",
    type: "企业官网",
    regions: ["内地", "香港"],
  },
  {
    id: "tencent-campus",
    name: "腾讯校招",
    host: "join.qq.com",
    type: "校招／实习",
    regions: ["内地"],
  },
  {
    id: "alibaba",
    name: "阿里巴巴招聘",
    host: "talent.alibaba.com",
    type: "企业官网",
    regions: ["内地"],
  },
  {
    id: "bytedance",
    name: "字节跳动招聘",
    host: "jobs.bytedance.com",
    type: "企业官网",
    regions: ["内地", "香港"],
  },
  {
    id: "huawei",
    name: "华为招聘",
    host: "career.huawei.com",
    type: "企业官网",
    regions: ["内地", "香港"],
  },
  {
    id: "meituan",
    name: "美团招聘",
    host: "zhaopin.meituan.com",
    type: "企业官网",
    regions: ["内地"],
  },
  {
    id: "baidu",
    name: "百度人才",
    host: "talent.baidu.com",
    type: "企业官网",
    regions: ["内地"],
  },
  {
    id: "jd",
    name: "京东招聘",
    host: "zhaopin.jd.com",
    type: "企业官网",
    regions: ["内地"],
  },
  {
    id: "netease",
    name: "网易招聘",
    host: "hr.163.com",
    type: "企业官网",
    regions: ["内地"],
  },
  {
    id: "pg",
    name: "宝洁招聘",
    host: "pgcareers.com",
    type: "企业官网",
    regions: ["内地", "香港"],
  },
  {
    id: "unilever",
    name: "联合利华招聘",
    host: "careers.unilever.com",
    type: "企业官网",
    regions: ["内地", "香港"],
  },
  {
    id: "hsbc",
    name: "汇丰招聘",
    host: "apply.careers.hsbc.com",
    type: "企业官网",
    regions: ["内地", "香港"],
  },
  {
    id: "sc",
    name: "渣打招聘",
    host: "jobs.standardchartered.com",
    type: "企业官网",
    regions: ["内地", "香港"],
  },
  {
    id: "ey",
    name: "安永招聘",
    host: "careers.ey.com",
    type: "企业官网",
    regions: ["内地", "香港"],
  },
  {
    id: "pwc",
    name: "普华永道招聘",
    host: "jobs.pwc.com",
    type: "企业官网",
    regions: ["内地", "香港"],
  },
  {
    id: "deloitte",
    name: "德勤招聘",
    host: "apply.deloitte.com",
    type: "企业官网",
    regions: ["内地", "香港"],
  },
  {
    id: "hkex",
    name: "香港交易所招聘",
    host: "hkex.wd3.myworkdayjobs.com",
    type: "企业官网",
    regions: ["香港"],
  },
  {
    id: "mtr",
    name: "港铁招聘",
    host: "careers.mtr.com.hk",
    type: "企业官网",
    regions: ["香港"],
  },
  {
    id: "hk-civil",
    name: "香港公务员招聘",
    host: "csb.gov.hk",
    search: "csboa1.csb.gov.hk/csboa/jve/",
    type: "公共部门",
    regions: ["香港"],
  },
  {
    id: "hk-labour",
    name: "香港劳工处招聘",
    host: "jobs.gov.hk",
    type: "公共部门",
    regions: ["香港"],
  },
  {
    id: "civil-cn",
    name: "国家公务员局",
    host: "scs.gov.cn",
    type: "公共部门",
    regions: ["内地"],
  },
];
export function identifySource(raw, region) {
  try {
    const u = new URL(raw);
    return (
      sourceCatalog.find(
        (s) =>
          (!region || s.regions.includes(region)) &&
          (u.hostname === s.host || u.hostname.endsWith("." + s.host)),
      ) || null
    );
  } catch {
    return null;
  }
}
export function querySources(region, roleIndex = 0, day = 0, role = "") {
  const group = (type) =>
    sourceCatalog.filter((s) => s.regions.includes(region) && s.type === type);
  const types = [
    (day + roleIndex) % 4 === 0 ? "公共部门" : "招聘平台",
    "校招／实习",
    "企业官网",
  ];
  return types
    .map((type, i) => {
      let list = group(type);
      if (type === "企业官网") {
        const preferred = /快消|fmcg|consumer/i.test(role)
          ? ["pg", "unilever"]
          : /金融|会计|會計|finance|account/i.test(role)
            ? ["hsbc", "sc", "hkex", "ey", "pwc", "deloitte"]
            : null;
        if (preferred) {
          const selected = list.filter((s) => preferred.includes(s.id));
          if (selected.length) list = selected;
        }
      }
      return list[(day + roleIndex * (i + 1)) % list.length];
    })
    .filter(Boolean);
}
export function sourceURL(raw, region) {
  try {
    const u = new URL(raw);
    const allowed = region
      ? [
          ...(sources[region] || []),
          ...sourceCatalog
            .filter((s) => s.regions.includes(region))
            .map((s) => s.host),
        ]
      : [...Object.values(sources).flat(), ...sourceCatalog.map((s) => s.host)];
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      (u.port && u.port !== "443")
    )
      return null;
    if (!allowed.some((d) => u.hostname === d || u.hostname.endsWith("." + d)))
      return null;
    u.hash = "";
    for (const key of [...u.searchParams.keys()])
      if (/^(utm_|tracking|ref$|source$|trk$|spm$|from$)/i.test(key))
        u.searchParams.delete(key);
    return u;
  } catch {
    return null;
  }
}
export function classifyLink(job) {
  const u = sourceURL(job.url, job.region);
  if (!u) return { kind: "excluded", reason: "来源不在支持范围" };
  let p;
  try {
    p = decodeURIComponent(u.pathname);
  } catch {
    return { kind: "excluded", reason: "URL 编码异常" };
  }
  if (/\.(pdf|xlsx?|docx?|zip)$/i.test(p))
    return { kind: "excluded", reason: "附件或非网页内容，暂不解析" };
  if (/51job\.com$/.test(u.hostname) && /\/co[a-z0-9_-]+\.html$/i.test(p))
    return { kind: "excluded", reason: "企业招聘汇总页，不是单一岗位" };
  const detail =
    /\/(?:jobdesc|job-detail|jobdetails?|positions?\/detail|requisitions?\/[^/]+)|\/job\/[^/]+\/[^/]+/i.test(
      p,
    ) ||
    (["postId", "jobId", "jobid", "positionId", "requisitionId"].some((key) =>
      u.searchParams.has(key),
    ) &&
      !/search|list/i.test(p)) ||
    /\/job_detail\/|\/intern\/[a-z0-9_-]+|\/jobs\/view\/|\/jobs\/detail\/|\/job-\d+|\/job\/(?:\d+|[a-z0-9-]+\/\d+)|\/a\/\d+\.shtml|\/viewjob|\/jobdetail\/|\/job\/detail|\/jobs\/[^/]+\.html/i.test(
      p,
    ) ||
    (/jobs\.zhaopin\.com$/.test(u.hostname) &&
      /\/[a-z0-9_-]+\.html?$/i.test(p)) ||
    (/jobs\.51job\.com$/.test(u.hostname) && /\/\d+\.html$/i.test(p)) ||
    (/csb\.gov\.hk$/.test(u.hostname) && !!u.searchParams.get("jobid"));
  if (
    /\/(?:discuss|discussion|article|articles|courses|exam|news)\//i.test(p) &&
    !/\/jobs?\//i.test(p)
  )
    return { kind: "excluded", reason: "资讯、讨论或课程页面" };
  if (detail) return { kind: "detail", reason: null };
  if (p === "/" || /^\/(?:zh|en|zh-cn|zh-hk)\/?$/i.test(p))
    return { kind: "excluded", reason: "招聘平台首页" };
  if (
    /\/zhaopin\/|\/company-jobs\/|(?:^|\/)q-[^/]+jobs|[^/]-jobs(?:\/|$)|\/city-[^/]+\/|\/search(?:\/|$)|\/jobs-search/i.test(
      p,
    )
  )
    return { kind: "excluded", reason: "搜索结果或岗位汇总页" };
  if (
    /招聘会|招聘會|招聘\d+人|\d+家企业|\d+个岗位|\d+\+|招聘平台|找工作.*求职|職位空缺一覽|入行.*人工/i.test(
      job.title || "",
    )
  )
    return { kind: "excluded", reason: "招聘活动、资讯或汇总页" };
  return { kind: "candidate", reason: "需检查页面是否包含单一职位" };
}
