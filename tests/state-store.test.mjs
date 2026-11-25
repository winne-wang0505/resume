import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStateStore } from "../src/state-store.mjs";
import { createPersonalService } from "../src/personal-service.mjs";
const base = () => ({
  salt: "a".repeat(64),
  users: {},
  addresses: {},
  usage: { day: "2026-10-28", requests: 2 },
});
async function setup(t) {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "career-store-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, "state.json");
}
test("state write syncs file before rename and syncs parent directory", async (t) => {
  const file = await setup(t),
    order = [];
  const io = {
    ...fs,
    open: async (...args) => {
      const h = await fs.open(...args);
      return {
        writeFile: (...x) => h.writeFile(...x),
        close: () => h.close(),
        sync: async () => {
          order.push(
            args[0] === path.dirname(file)
              ? "directory-sync"
              : args[0] === file + ".initialized"
                ? "marker-sync"
                : "file-sync",
          );
          await h.sync();
        },
      };
    },
    rename: async (...args) => {
      order.push("rename");
      await fs.rename(...args);
    },
  };
  await createStateStore({ file, io }).write(base());
  assert.deepEqual(order, [
    "file-sync",
    "rename",
    "directory-sync",
    "marker-sync",
    "directory-sync",
  ]);
});
test("failed atomic write preserves previous valid file and removes temporary file", async (t) => {
  const file = await setup(t);
  await createStateStore({ file }).write(base());
  const broken = createStateStore({
    file,
    io: {
      ...fs,
      rename: async () => {
        throw Error("ENOSPC");
      },
    },
  });
  await assert.rejects(
    broken.write({ ...base(), usage: { day: "2026-10-28", requests: 4 } }),
    (e) => e.code === "STATE_WRITE_FAILED",
  );
  assert.equal((await createStateStore({ file }).read()).usage.requests, 2);
  assert.ok(
    !(await fs.readdir(path.dirname(file))).some((x) => x.endsWith(".tmp")),
  );
});
test("invalid JSON or counter fails closed instead of resetting state", async (t) => {
  const file = await setup(t),
    store = createStateStore({ file });
  await fs.writeFile(file, "{broken");
  await assert.rejects(store.read(), (e) => e.code === "STATE_INVALID");
  assert.equal(await fs.readFile(file, "utf8"), "{broken");
  await fs.writeFile(
    file,
    JSON.stringify({ ...base(), usage: { requests: -1 } }),
  );
  await assert.rejects(store.read(), (e) => e.code === "STATE_INVALID");
});
test("reservation persistence failure prevents all external search calls", async (t) => {
  const file = await setup(t),
    store = createStateStore({ file });
  let broken = false,
    calls = 0;
  const storage = {
    ...store,
    write: async (s) => {
      if (broken)
        throw Object.assign(Error("disk full"), {
          status: 503,
          code: "STATE_WRITE_FAILED",
        });
      await store.write(s);
    },
  };
  const service = createPersonalService({
    file,
    storage,
    search: async () => {
      calls++;
      return { jobs: [], coverage: { requestsThisRun: 1 } };
    },
  });
  const { token } = await service.handle({
    method: "POST",
    pathname: "/api/session",
    ip: "one",
  });
  broken = true;
  await assert.rejects(
    service.handle({
      method: "POST",
      pathname: "/api/search",
      token,
      body: { preferences: { role: "开发", searchConsent: true } },
    }),
    (e) => e.code === "STATE_WRITE_FAILED",
  );
  assert.equal(calls, 0);
});
test("failure during settlement keeps durable reservation and old report", async (t) => {
  const file = await setup(t),
    store = createStateStore({ file });
  let broken = false,
    calls = 0;
  const storage = {
    ...store,
    write: async (s) => {
      if (
        broken &&
        Object.values(s.users).some((u) =>
          Object.values(u.requests || {}).some((r) => r.status === "completed"),
        )
      )
        throw Object.assign(Error("disk full"), {
          status: 503,
          code: "STATE_WRITE_FAILED",
        });
      await store.write(s);
    },
  };
  const service = createPersonalService({
    file,
    storage,
    search: async () => {
      calls++;
      return { jobs: [{ id: "new" }], coverage: { requestsThisRun: 1 } };
    },
  });
  const { token } = await service.handle({
    method: "POST",
    pathname: "/api/session",
    ip: "one",
  });
  broken = true;
  await assert.rejects(
    service.handle({
      method: "POST",
      pathname: "/api/search",
      token,
      body: {
        requestId: "write-failure-00001",
        preferences: { role: "开发", searchConsent: true },
      },
    }),
    (e) => e.code === "STATE_WRITE_FAILED",
  );
  broken = false;
  const view = await service.handle({
    method: "GET",
    pathname: "/api/personal",
    token,
  });
  assert.equal(view.index, null);
  assert.equal(view.quota.userUsed, 4);
  assert.equal(calls, 1);
  await assert.rejects(
    service.handle({
      method: "POST",
      pathname: "/api/search",
      token,
      body: {
        requestId: "write-failure-00001",
        preferences: { role: "开发", searchConsent: true },
      },
    }),
    (e) => e.code === "SEARCH_INTERRUPTED",
  );
});
test(
  "SIGKILL after reservation preserves quota and releases OS lock for restart",
  { timeout: 15000 },
  async (t) => {
    const file = await setup(t);
    const { spawn } = await import("node:child_process");
    const module = new URL("../src/personal-service.mjs", import.meta.url).href;
    const code = `import {createPersonalService} from ${JSON.stringify(module)};
  let token; const service=createPersonalService({file:process.argv[1],globalLimit:1,userLimit:1,clock:()=>new Date('2026-10-28T01:00:00Z'),search:async()=>{process.send({token});setInterval(()=>{},1000);await new Promise(()=>{});}});
  token=(await service.handle({method:'POST',pathname:'/api/session',ip:'one'})).token;
  await service.handle({method:'POST',pathname:'/api/search',token,body:{requestId:'crash-request-00001',preferences:{role:'开发',searchConsent:true}}});`;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", code, file],
      { stdio: ["ignore", "ignore", "pipe", "ipc"] },
    );
    t.after(() => child.kill("SIGKILL"));
    const message = await new Promise((resolve, reject) => {
      child.once("message", resolve);
      child.once("error", reject);
      child.once("exit", () =>
        reject(Error("worker exited before reservation")),
      );
    });
    const exit = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGKILL");
    await exit;
    let calls = 0;
    const restart = createPersonalService({
      file,
      globalLimit: 1,
      userLimit: 1,
      clock: () => new Date("2026-10-28T01:00:00Z"),
      search: async () => {
        calls++;
        return { jobs: [], coverage: { requestsThisRun: 1 } };
      },
    });
    const view = await restart.handle({
      method: "GET",
      pathname: "/api/personal",
      token: message.token,
    });
    assert.equal(view.quota.globalRemaining, 0);
    await assert.rejects(
      restart.handle({
        method: "POST",
        pathname: "/api/search",
        token: message.token,
        body: {
          requestId: "crash-request-00001",
          preferences: { role: "开发", searchConsent: true },
        },
      }),
      (e) => e.code === "SEARCH_INTERRUPTED",
    );
    assert.equal(calls, 0);
  },
);
test("a missing initialized ledger cannot silently reset quota", async (t) => {
  const file = await setup(t),
    store = createStateStore({ file });
  assert.equal(await store.read(), null);
  await store.write(base());
  await fs.unlink(file);
  await assert.rejects(store.read(), (e) => e.code === "STATE_MISSING");
  assert.equal(await fs.readFile(file + ".initialized", "utf8"), "1");
});
test("legacy valid state remains readable and gains a marker without changing usage", async (t) => {
  const file = await setup(t),
    store = createStateStore({ file });
  await fs.writeFile(file, JSON.stringify(base()));
  const state = await store.read();
  assert.equal(state.usage.requests, 2);
  await store.write(state);
  assert.equal((await store.read()).usage.requests, 2);
  assert.equal(await fs.readFile(file + ".initialized", "utf8"), "1");
});
