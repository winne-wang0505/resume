// Only parse public, embedded JSON. Do not invent private endpoints or execute scripts.
export function adaptOfficialPage(html, lead) {
  let url;
  try {
    url = new URL(lead.url);
  } catch {
    return null;
  }
  const tencent = url.hostname === "careers.tencent.com";
  const byte = url.hostname === "jobs.bytedance.com";
  if (!tencent && !byte) return null;
  if (/application\/ld\+json/i.test(html)) return null;
  const wanted =
    url.searchParams.get("postId") || url.pathname.match(/\/(\d{6,})\/?$/)?.[1];
  if (!wanted) return null;
  const matches = [];
  let visited = 0;
  function visit(node) {
    if (!node || typeof node !== "object" || ++visited > 15000) return;
    const id = String(
      tencent
        ? (node.PostId ?? node.PostID ?? node.PositionId ?? "")
        : (node.id ?? ""),
    );
    const title = tencent ? node.PostName : node.title;
    const duties = tencent ? node.Responsibility : node.description;
    const requirements = tencent ? node.Requirement : node.requirement;
    const city = tencent ? node.LocationName : node.city_info?.name;
    if (
      id === wanted &&
      [title, duties, requirements, city].every(
        (x) => typeof x === "string" && x.trim(),
      )
    ) {
      matches.push({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title,
        description: `岗位职责：\n${duties}\n任职要求：\n${requirements}`,
        jobLocation: { address: { addressLocality: city } },
      });
      return;
    }
    for (const value of Object.values(node)) visit(value);
  }
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/\btype\s*=\s*["']application\/json["']/i.test(m[1])) continue;
    try {
      visit(JSON.parse(m[2]));
    } catch {
      /* Not a supported public JSON shape. */
    }
  }
  const unique = [
    ...new Map(matches.map((x) => [JSON.stringify(x), x])).values(),
  ];
  if (unique.length !== 1) return null;
  return `<script type="application/ld+json">${JSON.stringify(unique[0]).replace(/</g, "\\u003c")}</script>`;
}
