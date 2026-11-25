import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
const unavailable = (code, message) =>
  Object.assign(new Error(message), { status: 503, code });
export function validateState(state) {
  const object = (x) => x && typeof x === "object" && !Array.isArray(x);
  const usage = (x) =>
    object(x) &&
    Number.isSafeInteger(x.requests) &&
    x.requests >= 0 &&
    typeof x.day === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(x.day) &&
    Number.isFinite(Date.parse(x.day + "T00:00:00Z"));
  if (
    !object(state) ||
    typeof state.salt !== "string" ||
    state.salt.length < 32 ||
    !object(state.users) ||
    !object(state.addresses) ||
    !usage(state.usage)
  )
    throw unavailable(
      "STATE_INVALID",
      "日报状态损坏，已停止检索以保护额度，请管理员恢复有效状态文件",
    );
  for (const user of Object.values(state.users))
    if (
      !object(user) ||
      !Number.isFinite(Date.parse(user.expiresAt)) ||
      (user.usage && !usage(user.usage)) ||
      (user.requests && !object(user.requests))
    )
      throw unavailable(
        "STATE_INVALID",
        "个人日报状态无效，已停止检索，请管理员检查持久存储",
      );
  return state;
}
export function createStateStore({
  file,
  io = { mkdir, open, readFile, rename, unlink },
  lockTimeoutSeconds = 5,
} = {}) {
  const directory = path.dirname(file);
  return {
    async read() {
      try {
        return validateState(JSON.parse(await io.readFile(file, "utf8")));
      } catch (error) {
        if (error.code === "ENOENT") {
          try {
            await io.readFile(file + ".initialized");
          } catch (markerError) {
            if (markerError.code === "ENOENT") return null;
            throw unavailable(
              "STATE_INVALID",
              "无法验证账本初始化状态，已停止检索",
            );
          }
          throw unavailable(
            "STATE_MISSING",
            "原有预算账本缺失，已停止检索；请恢复可信账本，不会自动清零额度",
          );
        }
        if (error.code === "STATE_INVALID") throw error;
        throw unavailable(
          "STATE_INVALID",
          "无法读取有效日报状态，已停止检索；不会重置额度或覆盖原文件",
        );
      }
    },
    async write(state) {
      const temporary = file + "." + randomUUID() + ".tmp";
      let handle, dir;
      try {
        validateState(state);
        await io.mkdir(directory, { recursive: true, mode: 0o700 });
        handle = await io.open(temporary, "wx", 0o600);
        await handle.writeFile(JSON.stringify(state));
        await handle.sync();
        await handle.close();
        handle = null;
        await io.rename(temporary, file);
        dir = await io.open(directory, "r");
        await dir.sync();
        // Distinguish first installation from accidental deletion of an already
        // initialized ledger. Deleting the entire volume still needs external backup.
        try {
          handle = await io.open(file + ".initialized", "wx", 0o600);
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
        }
        if (handle) {
          await handle.writeFile("1");
          await handle.sync();
          await handle.close();
          handle = null;
          await dir.sync();
        }
      } catch {
        throw unavailable(
          "STATE_WRITE_FAILED",
          "持久存储写入失败，本次操作未确认成功；已停止继续调用搜索服务",
        );
      } finally {
        await handle?.close().catch(() => {});
        await dir?.close().catch(() => {});
        await io.unlink(temporary).catch(() => {});
      }
    },
    async withLock(task) {
      await io.mkdir(directory, { recursive: true, mode: 0o700 });
      const lockFile = await io.open(file + ".lock", "a", 0o600);
      await lockFile.close();
      // Kernel advisory lock: a dead process/closed pipe releases it. Never unlink
      // the lock file, which would let another writer lock a different inode.
      const child = spawn(
        process.env.PERSONAL_FLOCK_BIN || "flock",
        [
          "-x",
          "-w",
          String(lockTimeoutSeconds),
          file + ".lock",
          process.execPath,
          "-e",
          "process.stdout.write('locked\\n');process.stdin.resume();",
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      const ended = new Promise((resolve) => {
        child.once("exit", resolve);
        child.once("error", resolve);
      });
      child.stdin.on("error", () => {});
      try {
        await new Promise((resolve, reject) => {
          let output = "";
          child.stdout.on("data", (data) => {
            output += data;
            if (output.includes("locked\n")) resolve();
          });
          child.once("error", () =>
            reject(
              unavailable(
                "STATE_LOCK_FAILED",
                "无法获取状态锁，请管理员确认 Linux flock 已安装",
              ),
            ),
          );
          child.once("exit", () =>
            reject(
              unavailable("STATE_BUSY", "日报服务正在处理其他任务，请稍后重试"),
            ),
          );
        });
        return await task();
      } finally {
        child.stdin.end();
        await ended;
      }
    },
  };
}
