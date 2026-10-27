import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchJobs } from "./src/search.mjs";
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
let lastSearch = 0;
export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/status" && req.method === "GET")
      return json(res, 200, { search: !!process.env.BRAVE_SEARCH_API_KEY });
    if (url.pathname === "/api/search" && req.method === "POST") {
      // Browser cross-origin requests cannot invoke paid search; public deployments also need a reverse-proxy rate limit.
      if (
        req.headers.origin &&
        new URL(req.headers.origin).host !== req.headers.host
      )
        return json(res, 403, { error: "仅接受同源请求" });
      if (!req.headers["content-type"]?.startsWith("application/json"))
        return json(res, 415, { error: "需要 application/json" });
      if (Date.now() - lastSearch < 10000)
        return json(res, 429, { error: "请稍后重试（检索间隔 10 秒）" });
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 12000)
          return json(res, 413, { error: "请求过大" });
      }
      let data;
      try {
        data = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "无效 JSON" });
      }
      if (!data.preferences?.searchConsent)
        return json(res, 400, { error: "请先同意发送检索关键词" });
      lastSearch = Date.now();
      try {
        return json(res, 200, await searchJobs(data.preferences));
      } catch (e) {
        return json(res, e.status || 400, { error: e.message });
      }
    }
    if (!["GET", "HEAD"].includes(req.method))
      return json(res, 405, { error: "Method not allowed" });
    const decoded = decodeURIComponent(url.pathname);
    const isModule = ["/src/match.mjs", "/src/brief.mjs"].includes(decoded);
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
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
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
