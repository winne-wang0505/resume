import { evaluate, safeURL } from "./src/match.mjs";
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
  apiAvailable = false;
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
  toast("偏好已保存；点击“检索最新岗位”获取新机会");
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
  return `<article class="job-card"><div class="job-top"><div class="company-icon">${esc(j.company?.slice(0, 1) || "职")}</div><div class="job-info"><h3>${esc(j.title)}</h3><p>${esc(j.company || "雇主待核实")} · ${esc(j.category || "待核实")}</p></div><div class="salary">${money}</div></div><div class="job-tags"><span class="tag">${esc(j.city || j.region)}</span><span class="tag">${esc(j.degree || "学历待核实")}</span><span class="tag">${Number.isFinite(j.experience) ? j.experience + " 年经验" : "经验待核实"}</span><span class="tag ${j.demo ? "demo" : ""}">${j.demo ? "演示 · 非真实招聘" : esc(j.source || "来源待核实")}</span>${r.expired ? '<span class="tag demo">已截止</span>' : ""}</div><div class="job-bottom"><span class="score"><b>${score(r.match)}</b>匹配度</span><span class="score"><b>${score(r.readiness)}</b>准备度</span><span class="score"><b>${score(r.value)}</b>性价比</span><div class="card-actions">${isSaved ? `<select class="status-select" data-status="${esc(j.id)}" aria-label="投递状态">${["待评估", "准备中", "已投递", "面试中", "已结束"].map((s) => `<option ${saved[j.id]?.status === s ? "selected" : ""}>${s}</option>`).join("")}</select>` : ""}<button class="save-btn" data-save="${esc(j.id)}" aria-label="${saved[j.id] ? "取消收藏" : "收藏岗位"}">${saved[j.id] ? "♥" : "♡"}</button><button class="detail-btn" data-detail="${esc(j.id)}">查看分析 ↗</button></div></div></article>`;
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
    : '<div class="empty">暂时没有符合条件的岗位。<br>试试放宽筛选，或填写偏好后检索最新岗位。</div>';
  bindCards($("#jobList"));
  $("#statTotal").textContent = jobs.length;
  $("#statPriority").textContent = analyzed(jobs).filter(
    (x) => !x.job.demo && !x.result.expired && x.result.value >= 75,
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
    `<span class="eyebrow">OPPORTUNITY ANALYSIS</span><h2>${esc(j.title)}</h2><p>${esc(j.company || "雇主待核实")} · ${esc(j.city || j.region)} · ${esc(j.category)}</p>${j.demo ? '<p class="notice">演示岗位：用于体验功能，不能投递。请检索真实岗位并核验原公告。</p>' : ""}${r.expired ? '<p class="notice">该岗位已超过标注的截止日期。</p>' : ""}<div class="detail-scores"><div><strong>${score(r.match)}</strong>岗位匹配度</div><div><strong>${score(r.readiness)}</strong>竞争准备度</div><div><strong>${score(r.value)}</strong>投递性价比</div></div><p class="confidence">评分信息覆盖度 ${r.confidence}% · 分数范围 0–100 · ${r.confidence < 50 ? "信息不足，谨慎参考" : "依据已知要求估算"}。竞争准备度不代表录用率或真实竞争者排名。</p><h3>规划建议</h3><p>${esc(r.advice)}</p>${j.region === "香港" ? `<p class="notice">香港工作资格：${esc(profile.workAuth || "待确认")}。签证支持、永久居民要求、语文及资格考试要求请在原公告核实；当前不据此自动判断资格。</p>` : ""}<h3>岗位内容与要求</h3><p>${esc(j.description || "尚未获得完整职位描述，请查看原始招聘页面。")}</p><p>工作方式：${esc(j.mode || "待核实")} · 用工类型：${esc(j.employment || "待核实")}<br>工作时间：${esc(j.hours || "待核实")} · 截止日期：${esc(j.deadline || "未披露")}<br>薪资：${j.salaryMin ? `${j.salaryMin}–${j.salaryMax} ${esc(j.currency)} / 月` : "未披露，不进行薪资评分"}</p><h3>评分依据</h3>${r.dims.length ? r.dims.map((d, i) => `<p>${esc(r.evidence[i])} <b>${d.value} 分</b></p><div class="score-bar"><span style="width:${d.value}%"></span></div>`).join("") : "<p>仅有搜索摘要，无法据此计算可靠的岗位匹配分。请补充已核验的岗位要求。</p>"}<h3>差距与准备清单</h3><ul>${[...r.blockers, ...r.missing.map((s) => "补充技能证据或学习计划：" + s), "准备针对该岗位的成果案例与简历；核对工作时间、专业限制和薪资口径。"].map((s) => `<li>${esc(s)}</li>`).join("")}</ul><p>预计申请准备时间：${j.applyMinutes || 30} 分钟（规划假设）。<br>发现时间：${esc(j.discoveredAt || "演示数据，无真实更新时间")}<br>来源：${esc(j.source)}；搜索发现时间不等同于职位发布时间。</p>${url ? `<a class="primary detail-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${j.demo ? "访问招聘平台（非该岗位）" : "查看原始招聘页面"} ↗</a>` : ""}`;
  $("#detail").showModal();
}
$("#closeDetail").onclick = () => $("#detail").close();
$("#detail").onclick = (e) => {
  if (e.target === $("#detail")) $("#detail").close();
};
function renderBrief() {
  const rows = sortRows(analyzed(jobs.filter((j) => !j.demo)))
    .filter((x) => !x.result.expired)
    .slice(0, 5);
  $("#briefDate").textContent = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "full",
  }).format(new Date());
  $("#briefSummary").textContent = rows.length
    ? `今日整理 ${rows.length} 个来源招聘线索。信息不足的岗位请先核实原公告，避免盲目投递。`
    : "暂无真实岗位索引。请配置实时搜索，或等待后台更新。演示岗位不计入每日推荐。";
  $("#briefList").innerHTML = rows
    .map(
      ({ job: j, result: r }) =>
        `<div class="brief-item"><div>${esc(j.title)}<small>${esc(j.company || "雇主待核实")} · ${esc(j.region)}</small></div><button class="detail-btn" data-detail="${esc(j.id)}">${r.value === null ? "待核实" : r.value + " 分"} ↗</button></div>`,
    )
    .join("");
  bindCards($("#briefList"));
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
  jobs = Array.isArray(data.jobs) ? data.jobs : [];
  $("#dataStatus").textContent =
    data.mode === "demo"
      ? "当前为明确标注的演示数据，尚未连接实时岗位源。"
      : `招聘来源链接（未核验在招） · 更新于 ${data.updatedAt ? new Date(data.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "未知"} · 请核验原公告与截止日期`;
  render();
}
$("#refresh").onclick = async () => {
  if (!prefs.role) {
    toast("请先填写目标岗位");
    switchView("preferences");
    return;
  }
  if (!prefs.searchConsent) {
    toast("请先在求职偏好中同意发送检索关键词");
    switchView("preferences");
    return;
  }
  if (!apiAvailable) {
    toast("当前是静态站点；实时检索需部署后台并配置 BRAVE_SEARCH_API_KEY");
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
    toast(`已获取 ${jobs.length} 个来源链接；请核实完整职位要求`);
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
  $("#connectionStatus").textContent = "静态网站模式 · 实时搜索后台未连接";
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
