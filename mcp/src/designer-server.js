// Local "note designer" page: a tiny HTTP server on 127.0.0.1 that serves the
// designer UI (same renderer as the web app) and saves styles. The URL carries
// a random token; Host/Origin are checked so other sites can't talk to it.
// It shuts down after 20 idle minutes and restarts on demand.
import http from "node:http";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { FONTS, FONT_DIR } from "./fonts.js";
import { DEFAULTS, INKS, settingsSchema } from "./settings.js";
import { loadStyles, saveStyle, STYLE_NAME, STORE_DIR } from "./styles-store.js";

const DESIGNER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "designer");
const IDLE_MS = 20 * 60 * 1000;
const MAX_BODY = 256 * 1024;

const saveSchema = z
  .object({
    name: z.string().regex(STYLE_NAME, "Use letters, numbers, spaces, - or _ (max 40)."),
    settings: settingsSchema,
    template: z.string().max(20000).optional(),
    sample: z.record(z.string(), z.string().max(500)).optional(),
  })
  .strict();

const STATIC = {
  "": ["index.html", "text/html; charset=utf-8"],
  "index.html": ["index.html", "text/html; charset=utf-8"],
  "app.js": ["app.js", "text/javascript; charset=utf-8"],
  "app.css": ["app.css", "text/css; charset=utf-8"],
};
const FONT_TYPES = { ".otf": "font/otf", ".ttf": "font/ttf", ".woff2": "font/woff2" };

let state = null; // { server, port, token, timer }

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), "application/json; charset=utf-8");

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("Request too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handle(req, res) {
  resetIdle();
  const { port, token } = state;
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!allowedHosts.includes(req.headers.host)) return send(res, 403, "Forbidden");
  if (req.headers.origin && !allowedHosts.some((h) => req.headers.origin === `http://${h}`)) return send(res, 403, "Forbidden");

  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const prefix = `/${token}/`;
  if (url.pathname === `/${token}`) {
    res.writeHead(302, { Location: prefix + url.search });
    return res.end();
  }
  if (!url.pathname.startsWith(prefix)) return send(res, 404, "Not found. Ask Claude to open the note designer again for a fresh link.");
  const route = decodeURIComponent(url.pathname.slice(prefix.length));

  if (req.method === "GET" && STATIC[route]) {
    const [file, type] = STATIC[route];
    return send(res, 200, await readFile(path.join(DESIGNER_DIR, file)), type);
  }

  if (req.method === "GET" && route.startsWith("fonts/")) {
    const font = FONTS.find((f) => f.file === route.slice(6));
    if (!font) return send(res, 404, "Not found");
    res.writeHead(200, { "Content-Type": FONT_TYPES[path.extname(font.file)] ?? "application/octet-stream", "Cache-Control": "max-age=3600" });
    return createReadStream(path.join(FONT_DIR, font.file)).on("error", () => res.end()).pipe(res);
  }

  if (req.method === "GET" && route === "api/config") {
    const { styles } = await loadStyles();
    const name = url.searchParams.get("style") || "default";
    return json(res, 200, {
      fonts: FONTS.map(({ family, file, size }) => ({ family, file, size })),
      inks: INKS,
      defaults: DEFAULTS,
      styleName: name,
      style: styles[name] ?? null,
      styles: Object.keys(styles),
      storePath: STORE_DIR,
    });
  }

  if (req.method === "POST" && route === "api/style") {
    if (!String(req.headers["content-type"]).startsWith("application/json")) return json(res, 415, { error: "Expected JSON" });
    let body;
    try {
      body = saveSchema.parse(JSON.parse(await readBody(req)));
    } catch (err) {
      const msg = err?.issues?.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") || err.message;
      return json(res, 400, { error: msg });
    }
    const { name, ...style } = body;
    await saveStyle(name, style);
    return json(res, 200, { ok: true, name });
  }

  send(res, 404, "Not found");
}

function resetIdle() {
  if (!state) return;
  clearTimeout(state.timer);
  state.timer = setTimeout(stopDesigner, IDLE_MS);
  state.timer.unref();
}

export function stopDesigner() {
  if (!state) return;
  clearTimeout(state.timer);
  state.server.close();
  state.server.closeAllConnections?.();
  state = null;
}

export async function startDesigner() {
  if (state) {
    resetIdle();
    return `http://127.0.0.1:${state.port}/${state.token}/`;
  }
  const token = randomBytes(18).toString("base64url");
  const server = http.createServer((req, res) =>
    handle(req, res).catch((err) => {
      if (!res.headersSent) json(res, 500, { error: err.message });
      else res.end();
    })
  );
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  server.unref();
  state = { server, port: server.address().port, token, timer: null };
  resetIdle();
  return `http://127.0.0.1:${state.port}/${token}/`;
}

export function designerUrl(style) {
  if (!state) return null;
  const base = `http://127.0.0.1:${state.port}/${state.token}/`;
  return style && style !== "default" ? `${base}?style=${encodeURIComponent(style)}` : base;
}

// Best effort: a desktop session is needed to open a browser.
export function canOpenBrowser() {
  if (process.platform === "darwin" || process.platform === "win32") return true;
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

export function openBrowser(url) {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", '""', url.replace(/&/g, "^&")]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
