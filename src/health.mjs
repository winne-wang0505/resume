import { identifySource } from "./sources.mjs";
export function failureKind(reason = "") {
  if (/robots/.test(reason)) return "robots";
  if (/验证|驗證|captcha|HTTP (?:403|405|429)/i.test(reason))
    return "restricted";
  if (/HTTP (?:404|410)/.test(reason)) return "gone";
  if (/超时|网络|连接|解析|TLS/.test(reason)) return "network";
  return "fields";
}
export function updateHealth(previous = {}, results = [], now = new Date()) {
  const next = structuredClone(previous || {});
  for (const { lead, result } of results) {
    const source = identifySource(lead.url);
    if (!source) continue;
    const row = (next[source.id] ||= {
      name: source.name,
      attempts: 0,
      successes: 0,
      consecutiveFailures: 0,
      failures: {},
    });
    row.attempts++;
    row.lastAttemptAt = now.toISOString();
    if (result.ok) {
      row.successes++;
      row.consecutiveFailures = 0;
      row.cooldownUntil = null;
      row.lastSuccessAt = now.toISOString();
    } else {
      row.consecutiveFailures++;
      row.lastFailureKind = failureKind(result.reason);
      row.failures[row.lastFailureKind] =
        (row.failures[row.lastFailureKind] || 0) + 1;
      // Don't suppress a whole platform for one missing/removed job.
      if (
        ["restricted", "robots", "network"].includes(row.lastFailureKind) &&
        row.consecutiveFailures >= 3
      )
        row.cooldownUntil = new Date(
          now.getTime() + 2 * 86400000,
        ).toISOString();
    }
  }
  return next;
}
export function cooling(health, id, now = new Date()) {
  return Date.parse(health?.[id]?.cooldownUntil || "") > now.getTime();
}
