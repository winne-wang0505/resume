import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPersonalService } from "./src/personal-service.mjs";
const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000),
  host = process.env.HOST || "127.0.0.1";
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
};
const json = (res, status, data) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(data));
};
const personal = createPersonalService();
const allowedOrigins = new Set(
  (process.env.APP_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const scheduler = setInterval(() => {
  if (process.env.BRAVE_SEARCH_API_KEY)
    personal
      .tick()
      .catch(() =>
        console.error(
          "Personal scheduler unavailable; previous reports preserved.",
        ),
      );
}, 60000);
scheduler.unref();
export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      const origin = req.headers.origin;
      if (
        origin &&
        !allowedOrigins.has(origin) &&
        new URL(origin).host !== req.headers.host
      )
        return json(res, 403, {
          error: "此 App 地址尚未获准连接，请管理员配置 APP_ORIGINS",
        });
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader(
          "Access-Control-Allow-Methods",
          "GET,POST,PUT,DELETE,OPTIONS",
        );
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type,Authorization",
        );
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
      }
      if (url.pathname === "/api/status" && req.method === "GET")
        return json(res, 200, {
          personal: true,
          search: !!process.env.BRAVE_SEARCH_API_KEY,
        });
      if (
        !process.env.BRAVE_SEARCH_API_KEY &&
        ["/api/session", "/api/search"].includes(url.pathname)
      )
        return json(res, 503, { error: "管理员尚未配置搜索服务密钥" });
      let body = "";
      if (["POST", "PUT"].includes(req.method)) {
        if (!req.headers["content-type"]?.startsWith("application/json"))
          return json(res, 415, { error: "需要 application/json" });
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 12000)
            return json(res, 413, { error: "请求过大" });
        }
      }
      try {
        const data = body ? JSON.parse(body) : {};
        const token = req.headers.authorization?.match(
          /^Bearer ([a-f0-9]{64})$/,
        )?.[1];
        const ip =
          process.env.TRUST_PROXY === "true"
            ? String(req.headers["x-forwarded-for"] || req.socket.remoteAddress)
                .split(",")[0]
                .trim()
            : req.socket.remoteAddress;
        return json(
          res,
          200,
          await personal.handle({
            method: req.method,
            pathname: url.pathname,
            token,
            body: data,
            ip,
          }),
        );
      } catch (e) {
        return json(res, e.status || (e instanceof SyntaxError ? 400 : 500), {
          error:
            e.status || e instanceof SyntaxError
              ? e.message
              : "个人日报服务暂时不可用",
        });
      }
    }
    if (!["GET", "HEAD"].includes(req.method))
      return json(res, 405, { error: "Method not allowed" });
    const decoded = decodeURIComponent(url.pathname);
    const isModule = [
      "/src/match.mjs",
      "/src/brief.mjs",
      "/src/sources.mjs",
      "/src/details.mjs",
      "/src/adapters.mjs",
      "/src/manual.mjs",
    ].includes(decoded);
    const base = path.join(root, isModule ? "src" : "public");
    const file = isModule
      ? path.join(base, path.basename(decoded))
      : path.resolve(base, "." + (decoded === "/" ? "/index.html" : decoded));
    if (!file.startsWith(base + path.sep))
      return json(res, 403, { error: "Forbidden" });
    try {
      if (!(await stat(file)).isFile())
        return json(res, 404, { error: "Not found" });
      const content = await readFile(file);
      res.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https:; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch {
      return json(res, 404, { error: "Not found" });
    }
  } catch {
    return json(res, 400, { error: "Bad request" });
  }
});
server.listen(port, host, () =>
  console.log(`Career Compass running on ${host}:${port}`),
);
