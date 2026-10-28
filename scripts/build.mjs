import { mkdir, copyFile, cp, rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist/src", { recursive: true });
await cp("public", "dist", { recursive: true });
await copyFile("src/match.mjs", "dist/src/match.mjs");
await copyFile("src/brief.mjs", "dist/src/brief.mjs");

await copyFile("src/sources.mjs", "dist/src/sources.mjs");
console.log("Built dist/ (static website and PWA)");

for (const name of ["manual", "details", "adapters"])
  await copyFile(`src/${name}.mjs`, `dist/src/${name}.mjs`);
