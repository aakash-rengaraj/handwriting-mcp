// Bundles the server (plus the shared renderer from ../src) into dist/server.js,
// the designer page into dist/designer/, and copies the fonts next to them.
// Only @napi-rs/canvas stays external.
import { build } from "esbuild";
import { cp, mkdir, rm, chmod } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await build({
  entryPoints: ["src/server.js"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  external: ["@napi-rs/canvas"],
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);',
  },
  logLevel: "warning",
});
await chmod("dist/server.js", 0o755);

await build({
  entryPoints: ["designer/app.js"],
  outfile: "dist/designer/app.js",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  minify: true,
  logLevel: "warning",
});
await cp("designer/index.html", "dist/designer/index.html");

await rm("fonts", { recursive: true, force: true });
await mkdir("fonts", { recursive: true });
await cp("../src/assets/fonts", "fonts", { recursive: true });
const fontsource = "../node_modules/@fontsource";
await cp(`${fontsource}/caveat/files/caveat-latin-400-normal.woff2`, "fonts/caveat.woff2");
await cp(`${fontsource}/kalam/files/kalam-latin-400-normal.woff2`, "fonts/kalam.woff2");
await cp(`${fontsource}/homemade-apple/files/homemade-apple-latin-400-normal.woff2`, "fonts/homemade-apple.woff2");
console.log("built dist/server.js, dist/designer/ + fonts/");
