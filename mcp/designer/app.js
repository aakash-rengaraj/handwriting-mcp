// Note designer: live preview + crop with the web app's renderer; saves the
// style to the MCP server so render_note / render_notes_batch use it.
import "../../src/notes/notes.css";
import "./designer.css";
import { renderNote, hashString, cropCanvas } from "../../src/notes/render.js";
import { attachCropper } from "../../src/notes/crop.js";
import { fillTemplate } from "../../src/template.js";

const $ = (id) => document.getElementById(id);
const ASPECTS = { free: null, "1:1": 1, "4:5": 4 / 5, "3:2": 3 / 2, "16:9": 16 / 9, "9:16": 9 / 16 };
const DEFAULT_TEMPLATE = "Hi {first_name|there},\n\nLoved what {company|your team} is building. I'd love to show you how we help teams like yours move faster.\n\nWorth a quick chat next week?\n\n- Alex";
const SAMPLE_GUESSES = { name: "Priya", first_name: "Priya", firstname: "Priya", last_name: "Shah", company: "Acme Robotics", title: "Head of Growth", city: "Austin" };
const TOKEN = /\{\s*([^{}|]+?)\s*(?:\|[^{}]*)?\}/g;

async function api(url, opts) {
  const r = await fetch(url, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `${r.status} ${r.statusText}`);
  return body;
}

const params = new URLSearchParams(location.search);
const cfg = await api("api/config" + (params.get("style") ? `?style=${encodeURIComponent(params.get("style"))}` : ""));

// Fonts come from the MCP package; declare them so document.fonts.load works.
const faces = document.createElement("style");
faces.textContent = cfg.fonts.map((f) => `@font-face{font-family:"${f.family}";src:url("fonts/${encodeURIComponent(f.file)}");font-display:block}`).join("\n");
document.head.appendChild(faces);

const saved = cfg.style?.settings ?? {};
const s = { ...cfg.defaults, ...saved };
let template = cfg.style?.template || DEFAULT_TEMPLATE;
const sample = { ...(cfg.style?.sample ?? {}) };
let crop = saved.crop ?? null;
let variation = saved.variation ?? 1;
let cropping = false;
let aspect = null;
let cropper = null;
let lastBase = null;
let dirty = false;

// --- controls ---
const fontOf = (family) => cfg.fonts.find((f) => f.family === family) ?? cfg.fonts[0];
$("font").innerHTML = cfg.fonts.map((f) => `<option value="${f.family}">${f.family}</option>`).join("");
$("ink").innerHTML =
  Object.keys(cfg.inks).map((k) => `<option value="${k}">${k === "blue" ? "blue ballpoint" : k}</option>`).join("") + `<option value="custom">custom…</option>`;
$("aspect").innerHTML = Object.keys(ASPECTS).map((k) => `<option value="${k}">${k === "free" ? "free" : k}</option>`).join("");

$("template").value = template;
$("font").value = s.font;
$("size").value = s.size ?? fontOf(s.font).size;
const inkIsNamed = s.ink in cfg.inks;
$("ink").value = inkIsNamed ? s.ink : "custom";
$("inkCustom").value = inkIsNamed ? cfg.inks[s.ink] : s.ink;
$("realism").value = s.realism;
$("finish").value = s.finish;
$("surface").value = s.surface;
$("lines").checked = s.lines;
$("margin").checked = s.margin;
$("quality").value = String(s.quality);
$("format").value = s.format;
$("styleName").value = cfg.styleName || "default";

function currentSettings() {
  const ink = $("ink").value === "custom" ? $("inkCustom").value : $("ink").value;
  return {
    font: $("font").value,
    size: Number($("size").value) || fontOf($("font").value).size,
    ink,
    realism: Number($("realism").value),
    finish: $("finish").value,
    surface: $("surface").value,
    lines: $("lines").checked,
    margin: $("margin").checked,
    quality: Number($("quality").value),
    format: $("format").value,
    crop,
    variation,
  };
}

function renderOptions(st, scale) {
  return {
    font: st.font,
    size: st.size,
    ink: cfg.inks[st.ink] ?? st.ink,
    realism: st.realism / 100,
    finish: st.finish,
    surface: st.surface,
    lines: st.lines,
    margin: st.margin,
    scale,
  };
}

// --- sample values for the template's tokens ---
function renderSamples() {
  const keys = [...new Set([...template.matchAll(TOKEN)].map((m) => m[1]).filter((k) => k.toLowerCase() !== "row"))];
  const box = $("samples");
  box.replaceChildren(
    ...keys.map((k) => {
      if (!(k in sample)) sample[k] = SAMPLE_GUESSES[k.toLowerCase()] ?? "";
      const label = document.createElement("label");
      label.className = "field";
      label.innerHTML = `<span></span><input type="text" />`;
      label.querySelector("span").textContent = `{${k}}`;
      const input = label.querySelector("input");
      input.value = sample[k];
      input.placeholder = "sample value";
      input.addEventListener("input", () => {
        sample[k] = input.value;
        changed();
      });
      return label;
    })
  );
}

// --- preview ---
let timer = 0;
let token = 0;
function changed() {
  dirty = true;
  $("status").textContent = "";
  clearTimeout(timer);
  timer = setTimeout(refresh, 140);
}

function sampleRow() {
  const keys = new Set([...template.matchAll(TOKEN)].map((m) => m[1]));
  return Object.fromEntries(Object.entries(sample).filter(([k]) => keys.has(k)));
}

async function refresh() {
  const my = ++token;
  const st = currentSettings();
  $("inkCustom").hidden = $("ink").value !== "custom";
  $("surfaceField").hidden = st.finish !== "photo";
  $("realOut").textContent = st.realism + "%";
  const S = (window.devicePixelRatio || 1) > 1 ? 2 : 1.25;
  const row = sampleRow();
  let pages;
  try {
    pages = await renderNote(fillTemplate(template, row), { ...renderOptions(st, S), seed: hashString(JSON.stringify(row) + "|" + variation) });
  } catch (err) {
    $("preview").textContent = "Could not render: " + err.message;
    return;
  }
  if (my !== token) return;
  lastBase = { w: pages[0].width / S, h: pages[0].height / S };
  cropper = null;
  const preview = $("preview");

  if (cropping) {
    const fig = document.createElement("figure");
    fig.className = "crop-fig";
    pages[0].style.width = lastBase.w + "px";
    fig.appendChild(pages[0]);
    preview.replaceChildren(fig);
    cropper = attachCropper(fig, pages[0], {
      rect: crop,
      aspect,
      onChange: (r) => {
        const full = r.x <= 0.001 && r.y <= 0.001 && r.w >= 0.999 && r.h >= 0.999;
        crop = full ? null : r;
        dirty = true;
        updateUi(pages.length);
      },
    });
  } else {
    preview.replaceChildren(
      ...pages.map((full, i) => {
        const fig = document.createElement("figure");
        const c = crop ? cropCanvas(full, crop) : full;
        c.style.width = c.width / S + "px";
        fig.appendChild(c);
        if (pages.length > 1) {
          const cap = document.createElement("figcaption");
          cap.textContent = `page ${i + 1} of ${pages.length}`;
          fig.appendChild(cap);
        }
        return fig;
      })
    );
  }
  updateUi(pages.length);
}

function updateUi(pageCount) {
  const st = currentSettings();
  $("cropBtn").textContent = cropping ? "done" : crop ? "edit crop" : "crop";
  $("cropBtn").classList.toggle("primary", cropping);
  $("aspect").hidden = !cropping;
  $("cropReset").hidden = !crop;
  const px = (v) => Math.round(v * st.quality);
  $("hint").textContent = cropping
    ? "Drag to draw a crop, drag inside to move, handles to resize. Applies to every note."
    : lastBase
      ? crop
        ? `Cropped output: ${px(crop.w * lastBase.w)} × ${px(crop.h * lastBase.h)} px.`
        : `Output: ${px(lastBase.w)} × ${px(lastBase.h)} px.`
      : "";
  const warnings = [];
  if (pageCount > 1) warnings.push(`With these sample values the note runs onto ${pageCount} pages. Shorten it or lower the size.`);
  if (crop && st.finish === "photo")
    warnings.push("The photo finish shifts and tilts the page a little for each person, so leave some space around the text inside the crop.");
  if (crop && crop.y + crop.h < 0.97)
    warnings.push("The crop cuts off the bottom of the page. Rows with longer names or values may wrap further down; check with a long sample value.");
  $("warn").hidden = !warnings.length;
  $("warn").textContent = warnings.join(" ");
}

// --- events ---
$("template").addEventListener("input", () => {
  template = $("template").value;
  renderSamples();
  changed();
});
$("font").addEventListener("change", () => {
  $("size").value = fontOf($("font").value).size;
  changed();
});
for (const id of ["size", "ink", "inkCustom", "realism", "finish", "surface", "lines", "margin", "quality", "format"]) $(id).addEventListener("input", changed);
$("shuffle").addEventListener("click", () => {
  variation = (Math.random() * 1e9) | 0;
  changed();
});
$("cropBtn").addEventListener("click", () => {
  cropping = !cropping;
  refresh();
});
$("aspect").addEventListener("change", (e) => {
  aspect = ASPECTS[e.target.value];
  cropper?.setAspect(aspect);
});
$("cropReset").addEventListener("click", () => {
  if (cropper) cropper.reset();
  else {
    crop = null;
    dirty = true;
    refresh();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && cropping) $("cropBtn").click();
  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
    e.preventDefault();
    $("save").click();
  }
});
$("styleName").addEventListener("input", () => (dirty = true));

$("save").addEventListener("click", async () => {
  const status = $("status");
  const name = $("styleName").value.trim() || "default";
  $("save").disabled = true;
  status.classList.remove("error");
  status.textContent = "saving…";
  try {
    await api("api/style", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, settings: currentSettings(), template, sample: sampleRow() }),
    });
    dirty = false;
    status.textContent =
      name === "default"
        ? "Saved. Go back to Claude and ask it to generate your notes."
        : `Saved as "${name}". Ask Claude to use the "${name}" style.`;
  } catch (err) {
    status.classList.add("error");
    status.textContent = "Could not save: " + err.message;
  } finally {
    $("save").disabled = false;
  }
});
window.addEventListener("beforeunload", (e) => {
  if (dirty) e.preventDefault();
});

renderSamples();
await refresh();
dirty = false;
