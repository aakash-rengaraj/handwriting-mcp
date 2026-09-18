// handwriting-mcp: realistic handwritten notes over MCP (stdio).
// Uses the exact renderer from the GTM Studio web app, so the same text,
// row and settings produce the same image in both places. Styles are set up
// visually in a local designer page and saved to ~/.millwright-notes.
import { mkdir, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pkg from "../package.json";
import { renderNote, hashString, setRenderEnv, cropCanvas } from "../../src/notes/render.js";
import { fillTemplate, safeFileName, uniqueNamer } from "../../src/template.js";
import { FONTS, registerFonts } from "./fonts.js";
import { loadRowsFromFile, loadRowsFromObjects } from "./data.js";
import { DEFAULTS, INKS, settingsSchema, resolveSettings } from "./settings.js";
import { loadStyles, getStyle, STYLE_NAME, STORE_DIR } from "./styles-store.js";
import { startDesigner, designerUrl, canOpenBrowser, openBrowser } from "./designer-server.js";

const VERSION = pkg.version;
const MAX_ROWS = 5000;

setRenderEnv({ createCanvas: (w, h) => createCanvas(w, h), loadFont: async () => {} });
const missingFonts = registerFonts();

// --- helpers ---------------------------------------------------------------

function resolveDir(dir, fallback) {
  const d = dir?.trim() || fallback;
  const expanded = d.startsWith("~") ? path.join(os.homedir(), d.slice(1)) : d;
  return path.isAbsolute(expanded) ? expanded : path.join(os.homedir(), expanded);
}

const DEFAULT_DIR = path.join(os.homedir(), "Downloads", "handwritten-notes");

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// Never overwrite: "name.jpg" → "name (2).jpg" if taken on disk.
async function freePath(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, -ext.length);
  let candidate = path.join(dir, name);
  for (let n = 2; await exists(candidate); n++) candidate = path.join(dir, `${base} (${n})${ext}`);
  return candidate;
}

async function encode(canvas, format) {
  return format === "png" ? canvas.encode("png") : canvas.encode("jpeg", 90);
}

async function previewImage(canvas) {
  const max = 720;
  const k = Math.min(1, max / Math.max(canvas.width, canvas.height));
  const c = createCanvas(Math.round(canvas.width * k), Math.round(canvas.height * k));
  c.getContext("2d").drawImage(canvas, 0, 0, c.width, c.height);
  return { type: "image", data: (await c.encode("jpeg", 80)).toString("base64"), mimeType: "image/jpeg" };
}

async function renderRow(text, row, cfg) {
  const seed = hashString(JSON.stringify(row || {}) + "|" + cfg.variation);
  const pages = await renderNote(fillTemplate(text.replace(/\r\n?/g, "\n"), row), { ...cfg.render, seed });
  return cfg.crop ? pages.map((p) => cropCanvas(p, cfg.crop)) : pages;
}

const TOKEN = /\{\s*([^{}|]+?)\s*(?:\|([^{}]*))?\}/g;
function templateTokens(template) {
  return [...template.matchAll(TOKEN)].map((m) => ({ key: m[1], hasFallback: m[2] !== undefined }));
}

function progress(extra, done, total) {
  const token = extra?._meta?.progressToken;
  if (token === undefined) return;
  extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: done, total } }).catch(() => {});
}

// Saved style (if any) < per-call settings. An explicitly named style must exist.
async function styleFor(name) {
  const style = await getStyle(name || "default");
  if (name && name !== "default" && !style) {
    const { styles } = await loadStyles();
    const names = Object.keys(styles);
    throw new Error(`No saved style "${name}". ${names.length ? `Saved styles: ${names.join(", ")}.` : "No styles saved yet."} Use open_note_designer to create it.`);
  }
  return style;
}

function styleLine(name, style) {
  return style ? `Style: "${name || "default"}"` : "Style: built-in defaults (no saved style yet; open_note_designer sets one up)";
}

const text = (t) => ({ type: "text", text: t });
const fail = (msg) => ({ isError: true, content: [text(msg)] });

const styleParam = z
  .string()
  .regex(STYLE_NAME)
  .optional()
  .describe('Saved style to use (created in the note designer). Default "default" if it exists, otherwise built-in defaults.');

// --- server ----------------------------------------------------------------

const server = new McpServer(
  { name: "millwright-notes", version: VERSION },
  {
    instructions:
      "Render realistic handwritten notes as images. If the user hasn't set up a style yet, or wants to change how notes look (font, ink, realism, finish, crop), call open_note_designer: it opens a local page with a live preview where they save a style and, optionally, the note template. " +
      "render_note makes one note; render_notes_batch makes one per row of a CSV/spreadsheet. Both use the saved style automatically, and render_notes_batch uses the saved template when none is given. " +
      "Templates use {column} tokens and {column|fallback} for empty cells. Keep notes short: roughly 60-90 words fit on one page at the default font.",
  }
);

server.registerTool(
  "open_note_designer",
  {
    title: "Open the note style designer",
    description:
      "Open a local page in the user's browser to set up how handwritten notes look, with a live preview: template text, handwriting, ink, realism, finish, crop. " +
      "When they click Save, the style (and template) is stored and used automatically by render_note and render_notes_batch. Returns immediately; ask the user to tell you once they've saved.",
    inputSchema: {
      style: styleParam.describe('Style name to create or edit. Default "default".'),
      open_browser: z.boolean().optional().describe("Open the page in the default browser. Default true. The URL is always returned."),
    },
  },
  async ({ style, open_browser = true }) => {
    try {
      await startDesigner();
      const url = designerUrl(style);
      const opened = open_browser && canOpenBrowser() && openBrowser(url);
      return {
        content: [
          text(
            [
              opened ? `Opened the note designer in the browser: ${url}` : `Note designer is running at: ${url}`,
              `Editing style "${style || "default"}". The page is only reachable from this computer and closes after 20 idle minutes.`,
              "Ask the user to adjust the preview and click \"Save style\", then continue. Saved styles live in " + path.join(STORE_DIR, "styles.json") + ".",
            ].join("\n")
          ),
        ],
      };
    } catch (err) {
      return fail(`Could not start the note designer: ${err.message}`);
    }
  }
);

server.registerTool(
  "list_note_options",
  {
    title: "List handwriting options",
    description: "Saved styles, fonts, inks, finishes, surfaces and the built-in defaults for handwritten notes.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    const { styles } = await loadStyles();
    return {
      content: [
        text(
          JSON.stringify(
            {
              saved_styles: Object.fromEntries(
                Object.entries(styles).map(([name, st]) => [name, { settings: st.settings, template: st.template ?? null, updated_at: st.updated_at }])
              ),
              builtin_defaults: DEFAULTS,
              fonts: FONTS.map((f) => ({ font: f.family, default_size: f.size, ...(f.note ? { license: f.note } : {}) })),
              inks: INKS,
              finishes: ["photo", "scan", "shadow", "clean"],
              surfaces: ["wood", "slate", "linen"],
              default_output_dir: DEFAULT_DIR,
              ...(missingFonts.length ? { unavailable_fonts: missingFonts } : {}),
            },
            null,
            2
          )
        ),
      ],
    };
  }
);

server.registerTool(
  "render_note",
  {
    title: "Render a handwritten note",
    description:
      "Render text as a realistic handwritten note and save it as an image (long text continues onto extra pages). " +
      "Uses the saved style. Returns the saved file paths and a preview image. Optionally fill {tokens} in the text from `values`.",
    inputSchema: {
      text: z.string().min(1).max(20000).optional().describe("The note text. Newlines are kept. May contain {tokens} filled from `values`. Defaults to the style's saved template."),
      values: z.record(z.string(), z.string()).optional().describe('Token values, e.g. {"first_name": "Priya"}. Also seeds the variation.'),
      style: styleParam,
      settings: settingsSchema.optional().describe("Overrides on top of the saved style for this call only."),
      output_dir: z.string().optional().describe(`Folder to save into. Default ${DEFAULT_DIR}. Relative paths are relative to your home folder.`),
      file_name: z.string().optional().describe('File name without extension. May use {tokens}. Default "note".'),
      include_preview: z.boolean().optional().describe("Return a preview image of page 1. Default true."),
    },
  },
  async ({ text: body, values, style, settings, output_dir, file_name, include_preview = true }) => {
    try {
      const saved = await styleFor(style);
      const source = body ?? saved?.template;
      if (!source) return fail("No text: pass `text`, or save a template in the note designer (open_note_designer).");
      const cfg = resolveSettings({ ...saved?.settings, ...settings });
      const pages = await renderRow(source, values ?? null, cfg);
      const dir = resolveDir(output_dir, DEFAULT_DIR);
      await mkdir(dir, { recursive: true });
      const base = safeFileName(fillTemplate(file_name || "note", values ?? null), "note");
      const files = [];
      for (let i = 0; i < pages.length; i++) {
        const p = await freePath(dir, `${pages.length > 1 ? `${base} - p${i + 1}` : base}.${cfg.format}`);
        await writeFile(p, await encode(pages[i], cfg.format));
        files.push(p);
      }
      const unfilled = templateTokens(fillTemplate(source, values ?? null)).map((t) => `{${t.key}}`);
      const lines = [
        styleLine(style, saved),
        `Saved ${files.length} image${files.length > 1 ? "s" : ""} (${pages[0].width}×${pages[0].height}px):`,
        ...files.map((f) => `- ${f}`),
      ];
      if (unfilled.length) lines.push(`Warning: unfilled tokens left in the text: ${[...new Set(unfilled)].join(", ")}`);
      if (pages.length > 1) lines.push("Note: the text ran onto multiple pages. Shorten it or lower `size` for a single image.");
      const content = [text(lines.join("\n"))];
      if (include_preview) content.push(await previewImage(pages[0]));
      return { content };
    } catch (err) {
      return fail(`Could not render the note: ${err.message}`);
    }
  }
);

server.registerTool(
  "render_notes_batch",
  {
    title: "Render one handwritten note per row",
    description:
      "Bulk-personalise a note template for every row of a CSV/TSV/XLSX file (or an inline `rows` array) and save one image per row, using the saved style. " +
      "If `template` is omitted, the style's saved template is used. Use {column} tokens in the template and file name, {column|fallback} for empty cells, and {row} for the row number in file names. " +
      "Each row gets its own natural variation. Run with dry_run first on large lists to check the columns and preview row 1.",
    inputSchema: {
      template: z.string().min(1).max(20000).optional().describe("Note text with {column} tokens. Defaults to the style's saved template."),
      csv_path: z.string().optional().describe("Absolute path to a .csv, .tsv, .xlsx, .xls or .ods file. First row = headers."),
      sheet: z.string().optional().describe("Spreadsheet sheet name. Default: the first sheet."),
      rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))).max(MAX_ROWS).optional().describe("Inline rows instead of a file."),
      style: styleParam,
      settings: settingsSchema.optional().describe("Overrides on top of the saved style for this batch only."),
      output_dir: z.string().optional().describe(`Folder to save into. Default: a new timestamped folder inside ${DEFAULT_DIR}.`),
      file_name: z.string().optional().describe('File name template without extension, e.g. "{first_name}-{company}". Default "note-{row}".'),
      limit: z.number().int().min(1).max(MAX_ROWS).optional().describe("Only render the first N rows."),
      dry_run: z.boolean().optional().describe("Validate columns and return a preview of row 1 without saving anything."),
    },
  },
  async ({ template, csv_path, sheet, rows, style, settings, output_dir, file_name, limit, dry_run }, extra) => {
    try {
      if (!csv_path === !rows) return fail("Pass exactly one of `csv_path` or `rows`.");
      const saved = await styleFor(style);
      const source = template ?? saved?.template;
      if (!source) return fail("No template: pass `template`, or save one in the note designer (open_note_designer).");
      const data = csv_path ? await loadRowsFromFile(resolveDir(csv_path, ""), sheet) : loadRowsFromObjects(rows);
      if (data.rows.length > MAX_ROWS && !limit) return fail(`That list has ${data.rows.length} rows; the maximum is ${MAX_ROWS}. Pass \`limit\` or split the file.`);
      const list = data.rows.slice(0, limit ?? MAX_ROWS);
      const cfg = resolveSettings({ ...saved?.settings, ...settings });
      const nameTpl = file_name || "note-{row}";

      // Column checks.
      const lower = new Set(data.columns.map((c) => c.toLowerCase()));
      const tokens = [...templateTokens(source), ...templateTokens(nameTpl).filter((t) => t.key.toLowerCase() !== "row")];
      const unknown = [...new Set(tokens.filter((t) => !lower.has(t.key.toLowerCase())).map((t) => t.key))];
      const emptyNoFallback = [];
      for (const t of tokens) {
        if (t.hasFallback || !lower.has(t.key.toLowerCase())) continue;
        const col = data.columns.find((c) => c.toLowerCase() === t.key.toLowerCase());
        const n = list.filter((r) => !r[col]).length;
        if (n) emptyNoFallback.push(`{${t.key}} is empty in ${n} row${n > 1 ? "s" : ""}; add a fallback like {${t.key}|there}`);
      }
      const warnings = [
        ...(unknown.length ? [`Unknown columns (left as literal text): ${unknown.map((k) => `{${k}}`).join(", ")}`] : []),
        ...[...new Set(emptyNoFallback)],
      ];
      const header = [
        styleLine(style, saved) + (template ? "" : " (using its saved template)"),
        `${list.length} row${list.length > 1 ? "s" : ""}${limit && data.rows.length > list.length ? ` (of ${data.rows.length})` : ""}. Columns: ${data.columns.join(", ")}`,
        ...warnings.map((w) => `Warning: ${w}`),
      ];

      if (dry_run) {
        const first = await renderRow(source, list[0], cfg);
        return {
          content: [
            text([...header, `Dry run: nothing saved. Row 1 renders as ${first.length} page${first.length > 1 ? "s" : ""}.`].join("\n")),
            await previewImage(first[0]),
          ],
        };
      }

      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
      const src = csv_path ? path.basename(csv_path, path.extname(csv_path)) : "rows";
      const dir = resolveDir(output_dir, path.join(DEFAULT_DIR, `${safeFileName(src, "notes")}-${stamp}`));
      await mkdir(dir, { recursive: true });

      const nameFor = uniqueNamer();
      let savedCount = 0;
      let multiPage = 0;
      let preview = null;
      const errors = [];
      for (let i = 0; i < list.length; i++) {
        if (extra?.signal?.aborted) break;
        try {
          const pages = await renderRow(source, list[i], cfg);
          if (!preview) preview = await previewImage(pages[0]);
          if (pages.length > 1) multiPage++;
          const base = safeFileName(fillTemplate(nameTpl.replace(/\{row\}/gi, String(i + 1)), list[i]), `note-${i + 1}`);
          for (let p = 0; p < pages.length; p++) {
            const out = await freePath(dir, nameFor(pages.length > 1 ? `${base} - p${p + 1}` : base, cfg.format));
            await writeFile(out, await encode(pages[p], cfg.format));
            savedCount++;
          }
        } catch (err) {
          errors.push(`row ${i + 1}: ${err.message}`);
        }
        progress(extra, i + 1, list.length);
        if (i % 10 === 9) await new Promise((r) => setImmediate(r));
      }

      const summary = [
        ...header,
        `Saved ${savedCount} image${savedCount === 1 ? "" : "s"} to ${dir}`,
        ...(multiPage ? [`${multiPage} row${multiPage > 1 ? "s" : ""} ran onto more than one page; shorten the template or lower \`size\`.`] : []),
        ...(errors.length ? [`${errors.length} row${errors.length > 1 ? "s" : ""} failed:`, ...errors.slice(0, 10).map((e) => `- ${e}`)] : []),
        ...(extra?.signal?.aborted ? ["Cancelled before finishing."] : []),
      ];
      return { content: [text(summary.join("\n")), ...(preview ? [preview] : [])] };
    } catch (err) {
      return fail(`Batch failed: ${err.message}`);
    }
  }
);

await server.connect(new StdioServerTransport());

// First run: no saved style yet, so open the designer once so the user can set one up.
// Set MILLWRIGHT_NOTES_NO_AUTO_OPEN=1 to disable.
if (!process.env.MILLWRIGHT_NOTES_NO_AUTO_OPEN && canOpenBrowser()) {
  const { styles } = await loadStyles();
  if (!Object.keys(styles).length) {
    try {
      await startDesigner();
      openBrowser(designerUrl());
    } catch {
      // Non-fatal: the tool can still open it later.
    }
  }
}
