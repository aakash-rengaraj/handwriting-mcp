// Packs the server into an MCP Bundle (.mcpb) for one-click install in Claude
// Desktop. Run `npm run build` first; this stages dist/ and fonts/ with the
// manifest and a node_modules holding @napi-rs/canvas plus its native binary for
// every platform Claude Desktop runs on. A plain npm install only fetches the
// binary for the machine you build on, so an unstaged bundle would only work on
// that platform.
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const PLATFORMS = ["darwin-arm64", "darwin-x64", "win32-x64-msvc"];
const STAGE = "mcpb-build";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const canvasVersion = JSON.parse(await readFile("node_modules/@napi-rs/canvas/package.json", "utf8")).version;

await rm(STAGE, { recursive: true, force: true });
await mkdir(`${STAGE}/node_modules/@napi-rs`, { recursive: true });
await cp("dist", `${STAGE}/dist`, { recursive: true });
await cp("fonts", `${STAGE}/fonts`, { recursive: true });
await cp("README.md", `${STAGE}/README.md`);

// The manifest's version is a placeholder; package.json is the one source of truth.
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
manifest.version = pkg.version;
await writeFile(`${STAGE}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
await writeFile(
  `${STAGE}/package.json`,
  JSON.stringify({ name: pkg.name, version: pkg.version, type: "module", dependencies: pkg.dependencies }, null, 2) + "\n",
);

// Fetch each platform's prebuilt binary straight from the registry, pinned to the
// installed canvas version so the JS wrapper and native module always match.
const fetchPackage = (name, dest) => {
  const tgz = execFileSync("npm", ["pack", `${name}@${canvasVersion}`, "--silent", "--pack-destination", STAGE], {
    encoding: "utf8",
  }).trim();
  execFileSync("mkdir", ["-p", dest]);
  execFileSync("tar", ["xzf", `${STAGE}/${tgz}`, "-C", dest, "--strip-components=1"]);
  execFileSync("rm", [`${STAGE}/${tgz}`]);
};
fetchPackage("@napi-rs/canvas", `${STAGE}/node_modules/@napi-rs/canvas`);
for (const p of PLATFORMS) fetchPackage(`@napi-rs/canvas-${p}`, `${STAGE}/node_modules/@napi-rs/canvas-${p}`);

const out = `handwriting-mcp-${pkg.version}.mcpb`;
execFileSync("npx", ["-y", "@anthropic-ai/mcpb", "pack", STAGE, out], { stdio: "inherit" });
console.log(`built ${out}`);
