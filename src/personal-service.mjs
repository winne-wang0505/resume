import { removeUnavailable } from "./availability.mjs";
import { createStateStore } from "./state-store.mjs";
import { randomBytes, createHash, randomUUID } from "node:crypto";
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
  storage = createStateStore({ file }),
  searchFetcher = fetch,
  maxPending = 64,
} = {}) {
  let chain = Promise.resolve(),
    state,
    dirty = false,
    pending = 0;
  globalLimit = Math.min(100, Math.max(1, Math.floor(globalLimit || 6)));
  userLimit = Math.min(globalLimit, Math.max(1, Math.floor(userLimit || 4)));
  async function load() {
    state = (await storage.read()) || {
      salt: randomBytes(32).toString("hex"),
      users: {},
      addresses: {},
      usage: {},
    };
    dirty = false;
    // A running record found while owning the file lock belongs to a process
    // which did not settle. Keep its reservation; never silently run it again.
    for (const user of Object.values(state.users)) {
      user.requests ||= {};
      for (const record of Object.values(user.requests)) {
        if (record.status === "running") {
          record.status = "interrupted";
          user.error = "上次检索中断，已保留额度预留与旧日报；请确认后重新检索";
          user.nextRetryAt = new Date(
            clock().getTime() + 30 * 60000,
          ).toISOString();
          dirty = true;
        }
      }
      for (const [key, record] of Object.entries(user.requests)) {
        if (clock().getTime() - Date.parse(record.startedAt) >= 24 * 3600000) {
          delete user.requests[key];
          dirty = true;
        }
      }
    }
  }
  async function save() {
    try {
      await storage.write(state);
    } catch (error) {
      dirty = false;
      throw error;
    }
    dirty = false;
  }
  function lock(fn) {
    if (pending >= maxPending)
      return Promise.reject(
        Object.assign(fail(429, "服务待处理任务过多，请稍后重试"), {
          code: "SERVER_BUSY",
        }),
      );
    pending++;
    const next = chain.then(() =>
      storage.withLock(async () => {
        await load();
        try {
          return await fn();
        } finally {
          if (dirty) await save();
        }
      }),
    );
    chain = next.catch(() => {});
    return next.finally(() => {
      pending--;
    });
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
      nextRetryAt: user.nextRetryAt || null,
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
  async function refresh(
    user,
    now,
    requestId = randomUUID(),
    preferences = user.preferences,
  ) {
    if (!preferences) throw fail(400, "请先保存个人日报需求");
    if (
      typeof requestId !== "string" ||
      !/^[a-zA-Z0-9_-]{16,128}$/.test(requestId)
    )
      throw fail(400, "检索请求标识格式不正确");
    const signature = hash(JSON.stringify(preferences));
    user.requests ||= {};
    const existing = Object.hasOwn(user.requests, requestId)
      ? user.requests[requestId]
      : null;
    if (existing) {
      if (existing.signature !== signature)
        throw Object.assign(fail(409, "同一请求标识不能用于不同检索需求"), {
          code: "IDEMPOTENCY_CONFLICT",
        });
      if (existing.status === "completed")
        return {
          ...view(user, clock()),
          index: removeUnavailable(existing.index, { now: clock() }),
          request: { id: requestId, status: "completed", replayed: true },
        };
      throw Object.assign(
        fail(409, "上次检索已失败或中断，本次未重复调用；再次点击可创建新任务"),
        { code: "SEARCH_INTERRUPTED", quota: view(user, clock()).quota },
      );
    }
    if (Object.keys(user.requests).length >= 20)
      throw fail(429, "24 小时内检索任务数已达上限，请稍后再试");
    const day = quota(now);
    if (user.usage?.day !== day) user.usage = { day, requests: 0 };
    const allowance = Math.min(
      userLimit - user.usage.requests,
      globalLimit - state.usage.requests,
    );
    if (allowance <= 0)
      throw Object.assign(
        fail(429, "今日个人或服务搜索额度已用完；现有日报仍可查看，次日恢复"),
        { quota: view(user, now).quota },
      );
    // Reserve BEFORE network I/O. A failed/interrupted search keeps the reservation
    // so restarting the service cannot silently reset paid-provider protection.
    user.preferences = preferences;
    const record = (user.requests[requestId] = {
      signature,
      status: "running",
      startedAt: now.toISOString(),
      reserved: allowance,
      day,
    });
    user.lastAttemptAt = now.toISOString();
    state.usage.requests += allowance;
    user.usage.requests += allowance;
    await save();
    let observedRequests = 0;
    try {
      const previousIndex = {
        ...structuredClone(user.index || {}),
        searchUsage: { day, requests: 0, limit: allowance },
      };
      const index = await search(
        {
          ...user.preferences,
          sourceMode: user.preferences.sourceMode || "standard",
        },
        {
          previousIndex,
          fetcher: async (...args) => {
            if (dayOf(clock()) !== day)
              throw fail(
                409,
                "北京时间日期已切换，停止旧任务的新搜索请求，请重新检索",
              );
            if (observedRequests >= allowance)
              throw fail(429, "本轮预算已用完，停止新的搜索请求");
            observedRequests++;
            return searchFetcher(...args);
          },
          dailyBudget: allowance,
          maxPages: 1,
          maxDetails: 12,
          liveVerification: true,
          now,
        },
      );
      const reported = index?.coverage?.requestsThisRun;
      if (
        !index ||
        !Array.isArray(index.jobs) ||
        !Number.isSafeInteger(reported) ||
        reported < 0 ||
        reported > allowance
      )
        throw Error("Invalid search accounting result");
      const actual = Math.max(reported, observedRequests);
      index.coverage.requestsThisRun = actual;
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
      user.nextRetryAt = null;
      record.status = "completed";
      record.actual = actual;
      record.observed = observedRequests;
      record.reported = reported;
      record.index = structuredClone(index);
      record.finishedAt = clock().toISOString();
      await save();
      return {
        ...view(user, clock()),
        request: { id: requestId, status: "completed", replayed: false },
      };
    } catch (error) {
      if (error.code === "STATE_WRITE_FAILED") throw error;
      // Never release a reservation from an invalid/uncertain provider result.
      record.status = "failed";
      record.observed = observedRequests;
      record.finishedAt = clock().toISOString();
      user.nextRetryAt = new Date(clock().getTime() + 30 * 60000).toISOString();
      user.error = "本次检索未完成，已保留上一份日报；请稍后重试或检查服务配置";
      await save();
      throw Object.assign(fail(error.status || 502, user.error), {
        code: "SEARCH_FAILED",
        quota: view(user, clock()).quota,
      });
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
          const preferences = body.preferences
            ? publicPreferences(body.preferences)
            : user.preferences;
          return refresh(user, now, body.requestId, preferences);
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
              !(Date.parse(u.nextRetryAt || "") > now.getTime()) &&
              (u.usage?.day !== day || u.usage.requests < userLimit) &&
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
