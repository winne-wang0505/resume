import { evaluate, safeURL } from "./src/match.mjs";
import { buildBrief } from "./src/brief.mjs";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem("career." + key)) || fallback;
  } catch {
    return fallback;
  }
}
const defaults = {
  name: "",
  degree: "本科",
  years: 0,
  skills: "",
  experience: "",
  achievements: "",
  workAuth: "待确认",
};
let profile = { ...defaults, ...read("profile", {}) },
  prefs = {
    region: "全部",
    city: "",
    role: "",
    salary: 10000,
    currency: "CNY",
    mode: "不限",
    category: "全部",
    employment: "全职",
    exclude: "",
    ...read("prefs", {}),
  };
let saved = read("saved", {}),
  jobs = [],
  region = "全部",
  dataInfo = {},
  apiAvailable = false,
  quality = "detailed";
const detailed = (j) =>
  j.demo || ["structured-detail", "page-detail"].includes(j.verification);
function deadlineLabel(value) {
  return value
    ? /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? value
      : updatedLabel(value)
    : "未披露，请核实";
}
function updatedLabel(value) {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
    : "未知";
}
function store(key, value) {
  try {
    localStorage.setItem("career." + key, JSON.stringify(value));
    return true;
  } catch {
    toast("无法保存：浏览器存储已满或已禁用");
    return false;
  }
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.remove("show"), 3500);
}
const titles = {
  discover: "发现下一站，找到适合你的机会。",
  profile: "让职业规划，从认识你开始。",
  preferences: "找到工作，也找到理想的生活。",
  saved: "一步一步，走向你的下一站。",
  daily: "今天的机会，为你整理好了。",
};
function switchView(view) {
  $$(".view").forEach((el) => (el.hidden = el.id !== view));
  $$(".nav").forEach((el) =>
    el.classList.toggle("active", el.dataset.view === view),
  );
  $("#pageTitle").textContent = titles[view];
  if (view === "saved") renderSaved();
  if (view === "daily") renderBrief();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$$(".nav").forEach((b) => (b.onclick = () => switchView(b.dataset.view)));
$("#completeProfile").onclick = () => switchView("profile");
function fill(form, data) {
  for (const [key, value] of Object.entries(data)) {
    const el = form.elements.namedItem(key);
    if (el) {
      if (el.type === "checkbox") el.checked = !!value;
      else el.value = value;
    }
  }
}
fill($("#profileForm"), profile);
fill($("#prefsForm"), prefs);
$("#profileForm").onsubmit = (e) => {
  e.preventDefault();
  const next = { ...profile, ...Object.fromEntries(new FormData(e.target)) };
  if (!store("profile", next)) return;
  profile = next;
  render();
  renderBrief();
  toast("档案已保存在本机，岗位分析已更新");
  switchView("discover");
};
$("#prefsForm").onsubmit = (e) => {
  e.preventDefault();
  const next = {
    ...prefs,
    ...Object.fromEntries(new FormData(e.target)),
    searchConsent: e.target.elements.searchConsent.checked,
  };
  if (!store("prefs", next)) return;
  prefs = next;
  region = prefs.region;
  $$("#regionTabs button").forEach((b) =>
    b.classList.toggle("selected", b.dataset.region === region),
  );
  $("#category").value = prefs.category;
  render();
  toast("偏好已保存，已更新本机筛选与分析；后台检索范围仍由管理员配置");
  switchView("discover");
};
$("#deleteData").onclick = () => {
  if (!confirm("清除本机档案、偏好与投递记录？此操作无法撤销。")) return;
  for (const k of ["profile", "prefs", "saved", "brief"])
    localStorage.removeItem("career." + k);
  location.reload();
};
if ($("#deleteDataMobile"))
  $("#deleteDataMobile").onclick = $("#deleteData").onclick;
$$("#regionTabs button").forEach(
  (b) =>
    (b.onclick = () => {
      region = b.dataset.region;
      $$("#regionTabs button").forEach((x) =>
        x.classList.toggle("selected", x === b),
      );
      render();
    }),
);
for (const id of ["search", "category", "sort"])
  $("#" + id).addEventListener(id === "search" ? "input" : "change", render);
$$("#qualityTabs button").forEach(
  (button) =>
    (button.onclick = () => {
      quality = button.dataset.quality;
      $$("#qualityTabs button").forEach((b) =>
        b.classList.toggle("selected", b === button),
      );
      render();
    }),
);
const score = (x) => (x === null ? "—" : x);
function analyzed(list) {
  return list.map((job) => ({ job, result: evaluate(profile, prefs, job) }));
}
function sortRows(rows) {
  const key = $("#sort").value;
  return rows.sort((a, b) =>
    key === "new"
      ? String(b.job.discoveredAt || "").localeCompare(a.job.discoveredAt || "")
      : (b.result[key] ?? -1) - (a.result[key] ?? -1),
  );
}
function visibleRows() {
  const q = $("#search").value.trim().toLowerCase(),
    cat = $("#category").value;
  return sortRows(
    analyzed(
      jobs.filter(
        (j) =>
          (quality === "detailed" ? detailed(j) : !detailed(j)) &&
          (region === "全部" || j.region === region) &&
          (cat === "全部" || j.category === cat) &&
          (!q ||
            [j.title, j.company, ...(j.skills || [])]
              .join(" ")
              .toLowerCase()
              .includes(q)),
      ),
    ),
  );
}
function card({ job: j, result: r }, isSaved = false) {
  const money = j.salaryMin
    ? `${j.salaryMin.toLocaleString()}–${j.salaryMax.toLocaleString()} <small>${esc(j.currency)}/月</small>`
    : "薪资待核实";
  return `<article class="job-card"><div class="job-top"><div class="company-icon">${esc(j.company?.slice(0, 1) || "职")}</div><div class="job-info"><h3>${esc(j.title)}</h3><p>${esc(j.company || "雇主待核实")} · ${esc(j.category || "待核实")}</p></div><div class="salary">${money}</div></div><div class="job-tags"><span class="tag">${esc(j.city || j.region)}</span><span class="tag">${esc(j.degree || "学历待核实")}</span><span class="tag">${Number.isFinite(j.experience) ? j.experience + " 年经验" : "经验待核实"}</span><span class="tag ${j.demo ? "demo" : ""}">${j.demo ? "演示 · 非真实招聘" : esc(j.source || "来源待核实")}</span>${r.expired ? '<span class="tag demo">已截止</span>' : ""}</div>${j.detailFailure ? `<p class="card-reason">待核实：${esc(j.detailFailure)}</p>` : !j.demo ? `<p class="card-reason">${esc(r.advice)} · 信息覆盖度 ${r.confidence}%</p>` : ""}<div class="job-bottom"><span class="score"><b>${score(r.match)}</b>匹配度</span><span class="score"><b>${score(r.readiness)}</b>准备度</span><span class="score"><b>${score(r.value)}</b>性价比</span><div class="card-actions">${isSaved ? `<select class="status-select" data-status="${esc(j.id)}" aria-label="投递状态">${["待评估", "准备中", "已投递", "面试中", "已结束"].map((s) => `<option ${saved[j.id]?.status === s ? "selected" : ""}>${s}</option>`).join("")}</select>` : ""}<button class="save-btn" data-save="${esc(j.id)}" aria-label="${saved[j.id] ? "取消收藏" : "收藏岗位"}">${saved[j.id] ? "♥" : "♡"}</button><button class="detail-btn" data-detail="${esc(j.id)}">查看分析 ↗</button></div></div></article>`;
}
function bindCards(root) {
  root.querySelectorAll("[data-save]").forEach(
    (b) =>
      (b.onclick = () => {
        const next = { ...saved };
        if (next[b.dataset.save]) delete next[b.dataset.save];
        else
          next[b.dataset.save] = {
            job: jobs.find((j) => j.id === b.dataset.save),
            status: "待评估",
            addedAt: new Date().toISOString(),
          };
        if (!store("saved", next)) return;
        saved = next;
        render();
        renderSaved();
      }),
  );
  root
    .querySelectorAll("[data-detail]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          showDetail(
            jobs.find((j) => j.id === b.dataset.detail) ||
              saved[b.dataset.detail]?.job,
          )),
    );
  root.querySelectorAll("[data-status]").forEach(
    (s) =>
      (s.onchange = () => {
        saved[s.dataset.status].status = s.value;
        store("saved", saved);
        toast("投递状态已更新");
      }),
  );
}
function render() {
  const rows = visibleRows();
  $("#jobList").innerHTML = rows.length
    ? rows.map((r) => card(r)).join("")
    : `<div class="empty">${quality === "detailed" ? "暂无符合筛选且已获得详情的岗位。<br>可切换到待核实线索查看来源限制；本轮不会用汇总页凑推荐数量。" : "暂无符合筛选的待核实线索。"}</div>`;
  bindCards($("#jobList"));
  $("#statTotal").textContent = jobs.filter(detailed).length;
  $("#detailCount").textContent = jobs.filter(detailed).length;
  $("#pendingCount").textContent = jobs.filter((j) => !detailed(j)).length;
  $("#statPriority").textContent = analyzed(jobs).filter(
    (x) =>
      !x.job.demo &&
      !x.result.expired &&
      x.result.match !== null &&
      x.result.confidence >= 50 &&
      x.result.roleAligned !== false &&
      !x.result.blockers.length &&
      x.result.value >= 75,
  ).length;
  $("#statSaved").textContent = $("#savedCount").textContent =
    Object.keys(saved).length;
  const fields = [
    "name",
    "major",
    "skills",
    "experience",
    "achievements",
    "languages",
  ];
  $("#statProfile").textContent =
    Math.round(
      (fields.filter((k) => profile[k]?.trim()).length / fields.length) * 100,
    ) + "%";
  if (profile.skills)
    $("#coachText").textContent =
      `已根据你的技能和 ${profile.years} 年经验分析岗位。${profile.workAuth === "需要雇主签证支持" ? "关注香港岗位时，请先核实雇主是否提供签证支持。" : "优先补齐缺失技能，并用可量化成果证明能力。"}`;
}
function renderSaved() {
  const rows = analyzed(
    Object.values(saved)
      .map((s) => s.job)
      .filter(Boolean),
  );
  $("#savedList").innerHTML = rows.length
    ? rows.map((r) => card(r, true)).join("")
    : '<div class="empty">还没有收藏的岗位。<br>在“发现机会”点击 ♡，建立你的投递计划。</div>';
  bindCards($("#savedList"));
}
function showDetail(j) {
  if (!j) return;
  const r = evaluate(profile, prefs, j),
    url = safeURL(j.url);
  $("#detailBody").innerHTML =
    `<span class="eyebrow">OPPORTUNITY ANALYSIS</span><h2>${esc(j.title)}</h2><p>${esc(j.company || "雇主待核实")} · ${esc(j.city || j.region)} · ${esc(j.category)}</p>${j.demo ? '<p class="notice">演示岗位：用于体验功能，不能投递。请检索真实岗位并核验原公告。</p>' : ""}${r.expired ? '<p class="notice">该岗位已超过标注的截止日期。</p>' : ""}<div class="detail-scores"><div><strong>${score(r.match)}</strong>岗位匹配度</div><div><strong>${score(r.readiness)}</strong>竞争准备度</div><div><strong>${score(r.value)}</strong>投递性价比</div></div><p class="confidence">评分信息覆盖度 ${r.confidence}% · 分数范围 0–100 · ${r.confidence < 50 ? "信息不足，谨慎参考" : "依据已知要求估算"}。竞争准备度不代表录用率或真实竞争者排名。</p><h3>规划建议</h3><p>${esc(r.advice)}</p>${j.region === "香港" ? `<p class="notice">香港工作资格：${esc(profile.workAuth || "待确认")}。签证支持、永久居民要求、语文及资格考试要求请在原公告核实；当前不据此自动判断资格。</p>` : ""}<h3>岗位内容与要求</h3><p>${esc(j.description || "尚未获得完整职位描述，请查看原始招聘页面。")}</p><p>工作方式：${esc(j.mode || "待核实")} · 用工类型：${esc(j.employment || "待核实")}<br>工作时间：${esc(j.hours || "待核实")} · 截止日期：${esc(deadlineLabel(j.deadline))}<br>薪资：${j.salaryMin ? `${j.salaryMin}–${j.salaryMax} ${esc(j.currency)} / 月` : "未披露，不进行薪资评分"}</p><h3>评分依据</h3>${r.dims.length ? r.dims.map((d, i) => `<p>${esc(r.evidence[i])} <b>${d.value} 分</b></p><div class="score-bar"><span style="width:${d.value}%"></span></div>`).join("") : "<p>仅有搜索摘要，无法据此计算可靠的岗位匹配分。请补充已核验的岗位要求。</p>"}<h3>差距与准备清单</h3><ul>${[...r.blockers, ...r.missing.map((s) => "补充技能证据或学习计划：" + s), "准备针对该岗位的成果案例与简历；核对工作时间、专业限制和薪资口径。"].map((s) => `<li>${esc(s)}</li>`).join("")}</ul><p>预计申请准备时间：${j.applyMinutes || 30} 分钟（规划假设）。<br>发现时间：${esc(j.discoveredAt || "演示数据，无真实更新时间")}<br>来源：${esc(j.source)}；搜索发现时间不等同于职位发布时间。</p>${url ? `<a class="primary detail-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${j.demo ? "访问招聘平台（非该岗位）" : "查看原始招聘页面"} ↗</a>` : ""}`;
  const proof = Object.entries(j.fieldEvidence || {});
  const labels = {
    title: "职位",
    company: "雇主",
    city: "地点",
    degree: "学历",
    experience: "经验",
    skills: "技能",
    salaryMin: "最低月薪",
    salaryMax: "最高月薪",
    currency: "币种",
    salaryPeriod: "薪资周期",
    postedAt: "发布日期",
    deadline: "截止日期",
    mode: "办公方式",
    employment: "用工类型",
    category: "机构性质",
    hours: "工作时间",
    majorRequirement: "专业要求",
  };
  $("#detailBody").innerHTML +=
    `${j.detailFailure ? `<p class="notice">详情尚未取得：${esc(j.detailFailure)}。此线索不会进入优先推荐。</p>` : ""}${r.scoreReason ? `<p class="notice">暂不评分：${esc(r.scoreReason)}</p>` : ""}${proof.length ? `<details class="evidence-section"><summary>查看 ${proof.length} 项提取证据</summary>${proof.map(([key, e]) => `<div class="evidence-item"><b>${esc(labels[key] || key)}</b><small>${esc(e.field || e.method)}</small><blockquote>${esc(e.quote)}</blockquote></div>`).join("")}</details>` : ""}<p class="form-note">详情读取时间：${esc(updatedLabel(j.detailFetchedAt))}。读取成功不等于人工核实或雇主确认在招。${j.majorRequirement ? "专业要求：" + esc(j.majorRequirement) : ""}</p>`;
  $("#detail").showModal();
}
$("#closeDetail").onclick = () => $("#detail").close();
$("#detail").onclick = (e) => {
  if (e.target === $("#detail")) $("#detail").close();
};
function renderBrief() {
  const brief = buildBrief(dataInfo, profile, prefs);
  $("#briefDate").textContent = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "full",
  }).format(new Date());
  $("#briefSummary").textContent =
    `本轮 ${brief.ready.length} 个岗位可评估，${brief.pending.length} 条线索待核实，已过滤 ${brief.excludedCount} 个汇总、资讯或已截止页面。${brief.stale ? " 索引超过 48 小时，请先核实有效性。" : ""}`;
  $("#briefMetrics").innerHTML = [
    ["可评估岗位", brief.ready.length],
    ["待核实线索", brief.pending.length],
    ["已过滤页面", brief.excludedCount],
  ]
    .map(
      ([label, n]) => `<div><strong>${n}</strong><span>${label}</span></div>`,
    )
    .join("");
  $("#briefList").innerHTML = brief.ready.length
    ? brief.ready
        .map(({ job: j, result: r }, i) => {
          const url = safeURL(j.url);
          const salary = j.salaryMin
            ? `${j.salaryMin.toLocaleString()}–${j.salaryMax.toLocaleString()} ${esc(j.currency)}/月`
            : "薪资未披露";
          return `<article class="recommendation"><div class="recommendation-top"><span class="rank">${String(i + 1).padStart(2, "0")}</span><div><h3>${esc(j.title)}</h3><p>${esc(j.company)} · ${esc(j.city || j.region)}</p></div><span class="recommendation-salary">${salary}</span></div><div class="brief-score-row"><span><b>${score(r.match)}</b> 匹配度</span><span><b>${score(r.readiness)}</b> 准备度</span><span><b>${score(r.value)}</b> 性价比</span><small>信息覆盖 ${r.confidence}%</small></div><p class="recommendation-reason">${esc(r.advice)}</p><p class="form-note">${esc(r.evidence.slice(0, 3).join("；"))}</p>${r.blockers.length ? `<p class="card-reason warning">需核实：${esc(r.blockers.join("；"))}</p>` : ""}<div class="brief-apply"><span class="form-note">截止：${esc(deadlineLabel(j.deadline))} · 来源：${esc(j.source)}</span><button class="detail-btn" data-detail="${esc(j.id)}">查看分析 ↗</button>${url ? `<a class="primary detail-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">查看原公告 ↗</a>` : ""}<button class="save-btn" data-save="${esc(j.id)}" aria-label="收藏岗位">${saved[j.id] ? "♥" : "♡"}</button></div></article>`;
        })
        .join("")
    : '<div class="empty">本轮暂无足够信息的匹配岗位。<br>已将受访问限制或要求不完整的来源放入下方待核实区，不用低质量页面凑推荐。</div>';
  bindCards($("#briefList"));
  $("#pendingTitle").textContent = `待核实线索（${brief.pending.length}）`;
  $("#pendingList").innerHTML =
    brief.pending
      .map(
        ({ job: j, reason }) =>
          `<article class="pending-item"><h4>${esc(j.title)}</h4><p>${esc(j.company || j.source || "雇主未知")} · ${esc(j.city || j.region)}</p><p class="card-reason">${esc(reason || "任职要求不足")}</p><button class="detail-btn" data-detail="${esc(j.id)}">查看线索与来源 ↗</button></article>`,
      )
      .join("") || '<p class="form-note">暂无待核实线索。</p>';
  bindCards($("#pendingList"));
  $("#excludedTitle").textContent = `已过滤页面（${brief.excludedCount}）`;
  $("#excludedList").innerHTML =
    (dataInfo.excluded || [])
      .map(
        (j) =>
          `<p class="form-note">${esc(j.title)}<br>原因：${esc(j.reason)}</p>`,
      )
      .join("") ||
    '<p class="form-note">本轮没有过滤记录；旧版索引需等待升级任务处理。</p>';
  $("#dailyTasks").innerHTML =
    brief.tasks.map((task) => `<li>${esc(task)}</li>`).join("") ||
    "<li>打开原公告核实在招状态，并记录一次投递进度。</li>";
  $("#dataFreshness").textContent =
    `岗位索引：${updatedLabel(dataInfo.updatedAt)}${brief.stale ? "（需要更新）" : ""}。${dataInfo.searchUpdatedAt ? "上次检索：" + updatedLabel(dataInfo.searchUpdatedAt) + "。" : ""}`;
  if (dataInfo.searchPreferences) {
    const p = dataInfo.searchPreferences;
    $("#dataFreshness").textContent +=
      ` 本轮后台范围：${p.role || "未记录"} · ${p.region || "全部"} · ${p.city || "不限城市"}。`;
  }
}
$("#generateBrief").onclick = () => {
  renderBrief();
  toast("已使用当前岗位索引更新今日简报");
};
$("#export").onclick = () => {
  const data = { version: 1, preferences: prefs };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "career-preferences.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
function setData(data) {
  dataInfo = data;
  jobs = [
    ...(Array.isArray(data.jobs) ? data.jobs : []),
    ...(Array.isArray(data.leads) ? data.leads : []),
  ];
  $("#dataStatus").textContent =
    data.mode === "demo"
      ? "当前为明确标注的演示数据，尚未连接真实岗位源。"
      : `更新于 ${updatedLabel(data.updatedAt)} · ${jobs.filter(detailed).length} 个具体岗位 / ${jobs.filter((j) => !detailed(j)).length} 条待核实线索 · 投递前核实原公告`;

  render();
  renderBrief();
}
$("#refresh").onclick = async () => {
  if (apiAvailable && !prefs.role) {
    toast("请先填写目标岗位");
    switchView("preferences");
    return;
  }
  if (apiAvailable && !prefs.searchConsent) {
    toast("请先在求职偏好中同意发送检索关键词");
    switchView("preferences");
    return;
  }
  if (!apiAvailable) {
    const b = $("#refresh");
    b.disabled = true;
    try {
      const res = await fetch("./data/jobs.json", { cache: "no-store" });
      if (!res.ok) throw Error("无法加载最新索引");
      setData(await res.json());
      toast("已加载最新已发布索引，并按本机档案重新分析；不会触发即时网络搜索");
    } catch (e) {
      toast(e.message);
    } finally {
      b.disabled = false;
    }
    return;
  }
  const b = $("#refresh");
  b.disabled = true;
  b.textContent = "正在检索…";
  try {
    const res = await fetch("./api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preferences: { ...prefs, skills: profile.skills, major: profile.major },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "检索失败");
    setData(data);
    toast(`已处理 ${jobs.length} 条来源，具体岗位与待核实线索已分开`);
  } catch (e) {
    toast(e.message);
  } finally {
    b.disabled = false;
    b.textContent = "↻ 检索最新岗位";
  }
};
$("#today").textContent = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "long",
  day: "numeric",
}).format(new Date());
try {
  const response = await fetch("./data/jobs.json", { cache: "no-store" });
  if (!response.ok) throw new Error("岗位索引读取失败");
  setData(await response.json());
} catch (e) {
  $("#dataStatus").textContent = e.message;
  render();
}
try {
  const res = await fetch("./api/status");
  if (res.ok && res.headers.get("content-type")?.includes("application/json")) {
    const status = await res.json();
    apiAvailable = true;
    $("#connectionStatus").textContent =
      `后台已连接 · 搜索${status.search ? "已配置" : "未配置"} · 每日推送通过 GitHub Actions 配置`;
  } else throw Error();
} catch {
  $("#connectionStatus").textContent =
    "当前使用 GitHub 定时生成的岗位索引；即时搜索服务未部署，不影响已发布日报的查看与本机分析。";
  $("#refresh").textContent = "↻ 加载最新日报";
}
let installPrompt;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  $("#install").hidden = false;
});
$("#install").onclick = async () => {
  if (installPrompt) {
    await installPrompt.prompt();
    installPrompt = null;
    $("#install").hidden = true;
  }
};
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("./sw.js").catch(() => {});
