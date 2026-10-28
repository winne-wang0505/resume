import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createPersonalService,
  publicPreferences,
} from "../src/personal-service.mjs";
const pref = (role) => ({
  role,
  region: "香港",
  city: "香港",
  searchConsent: true,
});
async function setup(t, options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "career-personal-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let now = new Date("2026-10-28T01:00:00Z");
  const calls = [];
  const file = path.join(dir, "state.json");
  const search = async (preferences, config) => {
    calls.push({ preferences, config });
    return {
      jobs: [{ id: preferences.role, title: preferences.role }],
      leads: [],
      excluded: [],
      coverage: { requestsThisRun: 1 },
      searchPreferences: preferences,
      updatedAt: now.toISOString(),
    };
  };
  const settings = {
    file,
    clock: () => now,
    search,
    globalLimit: 6,
    userLimit: 4,
    ...options,
  };
  const service = createPersonalService(settings);
  const request = (method, pathname, token, body, ip = "1.2.3.4") =>
    service.handle({ method, pathname, token, body, ip });
  const session = async (ip) =>
    (await request("POST", "/api/session", null, {}, ip)).token;
  return {
    service,
    request,
    session,
    calls,
    file,
    settings,
    setNow: (value) => {
      now = new Date(value);
    },
  };
}
test("individual preferences and reports remain isolated; only allowlisted search keywords leave client", async (t) => {
  const { request, session, calls, file } = await setup(t);
  const a = await session(),
    b = await session();
  await request("PUT", "/api/personal", a, {
    preferences: {
      ...pref("数据分析"),
      name: "PRIVATE",
      age: 20,
      gender: "女",
      experience: "完整经历",
    },
    enabled: true,
  });
  await request("PUT", "/api/personal", b, {
    preferences: pref("产品运营"),
    enabled: false,
  });
  await request("POST", "/api/search", a, {});
  assert.equal(
    (await request("GET", "/api/personal", a)).index.jobs[0].title,
    "数据分析",
  );
  assert.equal((await request("GET", "/api/personal", b)).index, null);
  assert.equal(
    (await request("GET", "/api/personal", b)).preferences.role,
    "产品运营",
  );
  assert.ok(!JSON.stringify(calls).includes("PRIVATE"));
  const stored = await readFile(file, "utf8");
  assert.ok(!stored.includes(a));
  assert.ok(!stored.includes("完整经历"));
  await assert.rejects(
    request("GET", "/api/personal", "wrong-token"),
    (e) => e.status === 401,
  );
});
test("saving requirements changes the next real search, daily opt-in and disabled states work", async (t) => {
  const { request, session, service, calls, setNow } = await setup(t);
  const a = await session(),
    b = await session();
  await request("PUT", "/api/personal", a, {
    preferences: pref("算法"),
    enabled: true,
  });
  await request("PUT", "/api/personal", b, {
    preferences: pref("金融"),
    enabled: false,
  });
  await service.tick();
  await service.tick();
  assert.equal(calls.length, 1);
  await request("PUT", "/api/personal", a, {
    preferences: pref("开发"),
    enabled: true,
  });
  await request("POST", "/api/search", a, {});
  assert.equal(calls.at(-1).preferences.role, "开发");
  setNow("2026-10-29T01:00:00Z");
  await service.tick();
  assert.equal(calls.length, 3);
  assert.equal(calls.at(-1).preferences.role, "开发");
});
test("global quota survives restart, cannot be bypassed by sessions, and resets next Shanghai day", async (t) => {
  const { request, session, settings, setNow } = await setup(t, {
    globalLimit: 1,
    userLimit: 1,
  });
  const a = await session();
  await request("POST", "/api/search", a, { preferences: pref("数据分析") });
  const restart = createPersonalService(settings);
  const b = (
    await restart.handle({
      method: "POST",
      pathname: "/api/session",
      ip: "different",
    })
  ).token;
  await assert.rejects(
    restart.handle({
      method: "POST",
      pathname: "/api/search",
      token: b,
      body: { preferences: pref("金融") },
    }),
    (e) => e.status === 429,
  );
  setNow("2026-10-29T01:00:00Z");
  assert.ok(
    (
      await restart.handle({
        method: "POST",
        pathname: "/api/search",
        token: b,
        body: { preferences: pref("金融") },
      })
    ).index,
  );
});
test("provider failure preserves report and conservative quota reservation", async (t) => {
  let broken = false;
  const { request, session } = await setup(t, {
    globalLimit: 3,
    userLimit: 3,
    search: async () => {
      if (broken) throw Error("provider failed");
      return { jobs: [{ id: "old" }], coverage: { requestsThisRun: 1 } };
    },
  });
  const a = await session();
  await request("POST", "/api/search", a, { preferences: pref("数据分析") });
  broken = true;
  await assert.rejects(request("POST", "/api/search", a, {}));
  const state = await request("GET", "/api/personal", a);
  assert.equal(state.index.jobs[0].id, "old");
  assert.equal(state.quota.globalRemaining, 0);
});
test("deleting a device stops schedule and removes private report; scheduler waits until 08:00", async (t) => {
  const { request, session, service, calls, setNow } = await setup(t);
  const a = await session();
  await request("PUT", "/api/personal", a, {
    preferences: pref("数据分析"),
    enabled: true,
  });
  setNow("2026-10-28T23:00:00Z");
  await service.tick();
  assert.equal(calls.length, 0);
  setNow("2026-10-29T01:00:00Z");
  await service.tick();
  assert.equal(calls.length, 1);
  await request("DELETE", "/api/personal", a);
  await assert.rejects(
    request("GET", "/api/personal", a),
    (e) => e.status === 401,
  );
  setNow("2026-10-30T01:00:00Z");
  await service.tick();
  assert.equal(calls.length, 1);
});
test("consent, narrow search scope and session issuance limits are enforced on server", async (t) => {
  const { session } = await setup(t);
  assert.throws(
    () => publicPreferences({ role: "开发" }),
    (e) => e.status === 400,
  );
  assert.throws(() => publicPreferences(pref("开发、算法、运营、金融")), /3/);
  await session();
  await session();
  await session();
  await assert.rejects(session(), (e) => e.status === 429);
});
test("HTTP API requires a bearer session and restricts app origins; no provider call needed", async (t) => {
  const { file } = await setup(t);
  process.env.PORT = "0";
  process.env.PERSONAL_STATE_FILE = file;
  process.env.BRAVE_SEARCH_API_KEY = "unit-test-not-a-provider-key";
  process.env.APP_ORIGINS = "https://winne-wang0505.github.io";
  const { server } = await import("../server.mjs");
  if (!server.listening)
    await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const options = {
    method: "OPTIONS",
    headers: {
      origin: "https://winne-wang0505.github.io",
      "access-control-request-method": "PUT",
    },
  };
  const cors = await fetch(base + "/api/personal", options);
  assert.equal(cors.status, 204);
  assert.equal(
    cors.headers.get("access-control-allow-origin"),
    "https://winne-wang0505.github.io",
  );
  assert.equal(
    (
      await fetch(base + "/api/status", {
        headers: { origin: "https://untrusted.example" },
      })
    ).status,
    403,
  );
  assert.equal((await fetch(base + "/api/personal")).status, 401);
  const session = await fetch(base + "/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }).then((r) => r.json());
  const headers = {
    "content-type": "application/json",
    authorization: "Bearer " + session.token,
  };
  const response = await fetch(base + "/api/personal", { headers });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).index, null);
  assert.equal(
    (
      await fetch(base + "/api/search", {
        method: "POST",
        headers,
        body: JSON.stringify({ preferences: { role: "开发" } }),
      })
    ).status,
    400,
  );
  delete process.env.BRAVE_SEARCH_API_KEY;
  assert.equal((await fetch(base + "/api/personal", { headers })).status, 200);
  assert.equal(
    (await fetch(base + "/api/personal", { method: "DELETE", headers })).status,
    200,
  );
});
test("concurrent requests cannot overspend the shared budget", async (t) => {
  const { request, session } = await setup(t, { globalLimit: 1, userLimit: 1 });
  const a = await session(),
    b = await session();
  const results = await Promise.allSettled([
    request("POST", "/api/search", a, { preferences: pref("开发") }),
    request("POST", "/api/search", b, { preferences: pref("算法") }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.status, 429);
});
test("expired private reports are removed from persistent storage during scheduler cleanup", async (t) => {
  const { request, session, setNow, service, file } = await setup(t);
  const a = await session();
  await request("PUT", "/api/personal", a, {
    preferences: pref("开发"),
    enabled: true,
  });
  setNow("2026-12-01T01:00:00Z");
  await service.tick();
  const state = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(state.users, {});
  await assert.rejects(
    request("GET", "/api/personal", a),
    (e) => e.status === 401,
  );
});
test("revoking keyword consent can stop scheduled searches without uploading preferences", async (t) => {
  const { request, session, service, calls } = await setup(t);
  const token = await session();
  await request("PUT", "/api/personal", token, {
    preferences: pref("开发"),
    enabled: true,
  });
  const stopped = await request("PUT", "/api/personal", token, {
    enabled: false,
  });
  assert.equal(stopped.enabled, false);
  await service.tick();
  assert.equal(calls.length, 0);
});
