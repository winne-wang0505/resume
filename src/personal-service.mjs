import { removeUnavailable } from "./availability.mjs";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { searchJobs, normalizePreferences } from "./search.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const dayOf = (now) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
const fail = (status, message) => Object.assign(new Error(message), { status });
const fields = [
  "sourceMode",
  "role",
  "region",
  "city",
  "category",
  "employment",
  "experienceLevel",
  "mode",
  "exclude",
  "skills",
  "major",
  "hours",
  "content",
  "majorReq",
  "salary",
  "currency",
];
export function publicPreferences(input = {}) {
  if (input?.searchConsent !== true) throw fail(400, "请先同意发送检索关键词");
  const out = {};
  for (const key of fields)
    if (input[key] !== undefined) out[key] = String(input[key]).slice(0, 500);
  const p = normalizePreferences(out);
  if (!p.role) throw fail(400, "请填写目标岗位");
  if (p.roles.length > 3)
    throw fail(400, "个人日报每次最多选择 3 个岗位方向，请缩小范围");
  if (!["全部", "内地", "香港"].includes(p.region))
    throw fail(400, "请选择内地、香港或全部");
  return {
    ...out,
    role: p.role,
    region: p.region,
    city: p.city,
    sourceMode: ["standard", "preferred"].includes(input.sourceMode)
      ? input.sourceMode
      : "standard",
    searchConsent: true,
  };
}
export function createPersonalService({
  file = process.env.PERSONAL_STATE_FILE || ".runtime/personal.json",
  search = searchJobs,
  globalLimit = Number(process.env.PERSONAL_DAILY_BUDGET || 6),
  userLimit = Number(process.env.PERSONAL_USER_BUDGET || 4),
  clock = () => new Date(),
} = {}) {
  let chain = Promise.resolve(),
    state,
    dirty = false;
  globalLimit = Math.min(100, Math.max(1, globalLimit || 6));
  userLimit = Math.min(globalLimit, Math.max(1, userLimit || 4));
  async function load() {
    if (state) return;
    try {
      state = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      state = {
        salt: randomBytes(32).toString("hex"),
        users: {},
        addresses: {},
        usage: {},
      };
    }
  }
  async function save() {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file + ".tmp", JSON.stringify(state), { mode: 0o600 });
    await rename(file + ".tmp", file);
    dirty = false;
  }
  function lock(fn) {
    const next = chain.then(async () => {
      await load();
      try {
        return await fn();
      } finally {
        if (dirty) await save();
      }
    });
    chain = next.catch(() => {});
    return next;
  }
  function quota(now) {
    const day = dayOf(now);
    if (state.usage.day !== day) {
      state.usage = { day, requests: 0 };
      dirty = true;
    }
    for (const [id, user] of Object.entries(state.users))
      if (Date.parse(user.expiresAt) <= now.getTime()) {
        delete state.users[id];
        dirty = true;
      }
    for (const [id, addr] of Object.entries(state.addresses))
      if (addr.day !== day) {
        delete state.addresses[id];
        dirty = true;
      }
    return day;
  }
  function find(token, now) {
    const user = token && state.users[hash(token)];
    if (!user || Date.parse(user.expiresAt) <= now.getTime())
      throw fail(401, "设备会话已失效，请重新连接个人日报服务");
    return user;
  }
  function view(user, now) {
    const day = quota(now);
    const cleaned = removeUnavailable(user.index, { now });
    if (cleaned !== user.index) {
      user.index = cleaned;
      dirty = true;
    }
    return {
      preferences: user.preferences || null,
      enabled: !!user.enabled,
      lastRunAt: user.lastRunAt || null,
      nextUpdate: "每天北京时间 08:00 后由在线服务检查；额度不足时顺延",
      error: user.error || null,
      index: user.index || null,
      expiresAt: user.expiresAt,
      quota: {
        day,
        userUsed: user.usage?.day === day ? user.usage.requests : 0,
        userLimit,
        globalRemaining: Math.max(0, globalLimit - state.usage.requests),
      },
    };
  }
  async function refresh(user, now) {
    if (!user.preferences) throw fail(400, "请先保存个人日报需求");
    const day = quota(now);
    if (user.usage?.day !== day) user.usage = { day, requests: 0 };
    const allowance = Math.min(
      userLimit - user.usage.requests,
      globalLimit - state.usage.requests,
    );
    if (allowance <= 0)
      throw fail(
        429,
        "今日个人或服务搜索额度已用完；现有日报仍可查看，次日恢复",
      );
    // Reserve BEFORE network I/O. A failed/interrupted search keeps the reservation
    // so restarting the service cannot silently reset paid-provider protection.
    state.usage.requests += allowance;
    user.usage.requests += allowance;
    await save();
    try {
      const previousIndex = {
        ...(user.index || {}),
        searchUsage: { day, requests: 0, limit: allowance },
      };
      const index = await search(
        {
          ...user.preferences,
          sourceMode: user.preferences.sourceMode || "standard",
        },
        {
          previousIndex,
          dailyBudget: allowance,
          maxPages: 1,
          maxDetails: 12,
          liveVerification: true,
          now,
        },
      );
      const actual = Math.min(
        allowance,
        Math.max(0, index.coverage?.requestsThisRun ?? allowance),
      );
      state.usage.requests -= allowance - actual;
      user.usage.requests -= allowance - actual;
      index.searchUsage = {
        day,
        requests: user.usage.requests,
        limit: userLimit,
      };
      if (index.coverage)
        index.coverage.dailyRemaining = Math.min(
          userLimit - user.usage.requests,
          globalLimit - state.usage.requests,
        );
      user.index = index;
      user.lastRunAt = now.toISOString();
      user.error = null;
      await save();
      return view(user, now);
    } catch (error) {
      user.error = "本次检索未完成，已保留上一份日报；请稍后重试或检查服务配置";
      await save();
      throw fail(error.status || 502, user.error);
    }
  }
  return {
    handle({ method, pathname, token, body = {}, ip = "unknown" }) {
      return lock(async () => {
        const now = clock(),
          day = quota(now);
        if (pathname === "/api/session" && method === "POST") {
          if (Object.keys(state.users).length >= 1000)
            throw fail(
              503,
              "服务当前设备数已达上限，请管理员升级存储与账户服务",
            );
          const address = hash(state.salt + ip);
          const addr = (state.addresses[address] ||= { day, sessions: 0 });
          if (addr.sessions >= 3)
            throw fail(
              429,
              "此网络今日创建会话次数已达上限，请使用已有设备会话",
            );
          const token = randomBytes(32).toString("hex");
          const expiresAt = new Date(
            now.getTime() + 30 * 86400000,
          ).toISOString();
          state.users[hash(token)] = { expiresAt, address, enabled: false };
          addr.sessions++;
          await save();
          return { token, expiresAt };
        }
        const user = find(token, now);
        if (pathname === "/api/personal" && method === "GET")
          return view(user, now);
        if (pathname === "/api/personal" && method === "PUT") {
          if (!body.preferences && body.enabled === false) user.enabled = false;
          else {
            user.preferences = publicPreferences(body.preferences);
            user.enabled = body.enabled === true;
          }
          // Extends only an authenticated, actively used device session.
          user.expiresAt = new Date(
            now.getTime() + 30 * 86400000,
          ).toISOString();
          await save();
          return view(user, now);
        }
        if (pathname === "/api/personal" && method === "DELETE") {
          delete state.users[hash(token)];
          await save();
          return { deleted: true };
        }
        if (pathname === "/api/search" && method === "POST") {
          if (body.preferences)
            user.preferences = publicPreferences(body.preferences);
          return refresh(user, now);
        }
        throw fail(404, "接口不存在");
      });
    },
    tick() {
      return lock(async () => {
        const now = clock(),
          day = quota(now);
        const hour = Number(
          new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Shanghai",
            hour: "2-digit",
            hourCycle: "h23",
          }).format(now),
        );
        if (hour < 8) return;
        const users = Object.values(state.users)
          .filter(
            (u) =>
              u.enabled &&
              u.preferences &&
              (!u.lastRunAt || dayOf(new Date(u.lastRunAt)) !== day),
          )
          .sort((a, b) => (a.lastRunAt || "").localeCompare(b.lastRunAt || ""));
        for (const user of users) {
          if (state.usage.requests >= globalLimit) break;
          try {
            await refresh(user, now);
          } catch {
            /* Keep previous report and try next scheduled cycle within quota. */
          }
        }
      });
    },
  };
}
