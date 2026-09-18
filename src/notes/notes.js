// Handwritten notes preset. The editable page and fonts come from
// texttohandwriting.com; output is drawn by our own renderer (render.js) so
// each glyph, line and sheet can vary like real handwriting.
import JSZip from "jszip";
import "./notes.css";
import { dataset, onDataChange, fillTemplate, currentRow, bulkRows, safeFileName, uniqueNamer, downloadBlob } from "../data.js";
import { progress } from "../progress.js";
import { renderNote, hashString } from "./render.js";
import { attachCropper, cropCanvas } from "./crop.js";

const ASPECTS = { free: null, "1:1": 1, "4:5": 4 / 5, "3:2": 3 / 2, "16:9": 16 / 9, "9:16": 9 / 16 };

export const HANDWRITING_FONTS = [
  { family: "handwriting-1", size: 38 },
  { family: "handwriting-2", size: 29 },
  { family: "handwriting-3", size: 30 },
  { family: "handwriting-4", size: 27 },
  { family: "handwriting-5", size: 27 },
  { family: "handwriting-6", size: 23 },
  { family: "handwriting-7", size: 28 },
  { family: "handwriting-8", size: 24 },
  { family: "handwriting-9", size: 21 },
  { family: "handwriting-10", size: 19 },
  { family: "handwriting-11", size: 21 },
  { family: "handwriting-12", size: 22 },
  { family: "handwriting-13", size: 18 },
  { family: "handwriting-14", size: 23 },
  { family: "Caveat", size: 24, label: "Caveat (OFL)" },
  { family: "Kalam", size: 20, label: "Kalam (OFL)" },
  { family: "Homemade Apple", size: 15, label: "Homemade Apple (Apache)" },
];

const INKS = [
  { value: "#0d2270", label: "Blue ballpoint" },
  { value: "#000f55", label: "Navy" },
  { value: "#1a1a1a", label: "Black" },
  { value: "#ba3807", label: "Red" },
];

const DEFAULT_TEXT = "Hi {name|there},\n\nLoved what {company|your team} is building. I'd love to show you how we help teams like yours move faster.\n\nWorth a quick chat next week?\n\n- Alex";

export function mountNotes(root) {
  root.innerHTML = `
    <div class="tool-grid">
      <section class="stage-col">
        <div class="stage-head">
          <div class="seg" role="tablist" aria-label="Page view">
            <button type="button" class="seg-btn" data-view="edit">Edit</button>
            <button type="button" class="seg-btn active" data-view="preview">Preview</button>
          </div>
          <div class="crop-controls">
            <select id="nAspect" aria-label="Crop aspect ratio" hidden>
              ${Object.keys(ASPECTS).map((k) => `<option value="${k}">${k === "free" ? "Free" : k}</option>`).join("")}
            </select>
            <button type="button" class="btn small" id="nCropReset" hidden>reset crop</button>
            <button type="button" class="btn small" id="nCropBtn">crop</button>
          </div>
          <span class="hint" id="notesHint"></span>
        </div>
        <div class="paper-stage">
          <div class="page-a margined lines" id="notePage" hidden>
            <div class="top-margin"></div>
            <div class="left-margin-and-content">
              <div class="left-margin"></div>
              <div class="paper-content" id="noteEditor" contenteditable="true" spellcheck="false" data-token-target></div>
            </div>
          </div>
          <div class="note-preview" id="notePreview" aria-live="polite"></div>
        </div>
      </section>

      <aside class="controls">
        <fieldset>
          <legend>Handwriting</legend>
          <label class="field"><span>Style</span><select id="nFont"></select></label>
          <div class="field-row">
            <label class="field"><span>Size (px)</span><input id="nSize" type="number" min="8" max="80" step="1"></label>
            <label class="field"><span>Ink</span>
              <div class="ink-row"><select id="nInk"></select><input id="nInkCustom" type="color" aria-label="Custom ink colour"></div>
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Realism</legend>
          <label class="field"><span>Realism <output id="nRealOut"></output></span><input id="nReal" type="range" min="0" max="100" step="5" value="70"></label>
          <label class="field"><span>Finish</span>
            <select id="nFinish">
              <option value="photo">Photo on a desk</option>
              <option value="scan">Scanned</option>
              <option value="shadow">Soft shadow</option>
              <option value="clean">Clean paper</option>
            </select>
          </label>
          <label class="field" id="nSurfaceField"><span>Surface</span>
            <select id="nSurface">
              <option value="wood">Wooden desk</option>
              <option value="slate">Dark slate</option>
              <option value="linen">Linen</option>
            </select>
          </label>
          <label class="check"><input type="checkbox" id="nLines" checked> Ruled lines</label>
          <label class="check"><input type="checkbox" id="nMargin" checked> Margin</label>
          <div class="btn-row">
            <button type="button" class="btn small" id="nShuffle" title="Every row already varies. This re-rolls the whole batch.">Shuffle variation</button>
          </div>
        </fieldset>
        <fieldset>
          <legend>Export</legend>
          <div class="field-row">
            <label class="field"><span>Quality</span>
              <select id="nScale"><option value="1">1× (450px page)</option><option value="2" selected>2× (900px page)</option><option value="3">3× (1350px page)</option></select>
            </label>
            <label class="field"><span>Format</span>
              <select id="nFormat"><option value="auto">Auto</option><option value="jpeg">JPG</option><option value="png">PNG</option></select>
            </label>
          </div>
          <label class="field"><span>File name</span><input id="nFileName" type="text" data-token-target></label>
          <div class="btn-row">
            <button type="button" class="btn" id="nOne">Download this row</button>
            <button type="button" class="btn primary" id="nBulk">Download all</button>
          </div>
        </fieldset>
      </aside>
    </div>`;

  const $ = (id) => root.querySelector("#" + id);
  const page = $("notePage");
  const editor = $("noteEditor");
  const preview = $("notePreview");
  const fontSel = $("nFont");
  const sizeIn = $("nSize");
  const inkSel = $("nInk");
  const inkCustom = $("nInkCustom");

  editor.innerText = DEFAULT_TEXT;
  fontSel.innerHTML = HANDWRITING_FONTS.map((f) => `<option value="${f.family}">${f.label || f.family}</option>`).join("");
  inkSel.innerHTML = INKS.map((i) => `<option value="${i.value}">${i.label}</option>`).join("") + `<option value="custom">Custom…</option>`;
  inkCustom.value = INKS[0].value;
  sizeIn.value = HANDWRITING_FONTS[0].size;

  let view = "preview";
  let variation = 1;
  let crop = null; // normalised {x,y,w,h}, applied to every page of every row
  let cropping = false;
  let aspect = null;
  let cropper = null;
  let outBase = null; // last preview page size in 1× px, for the size readout
  const isFull = (r) => r.x <= 0.001 && r.y <= 0.001 && r.w >= 0.999 && r.h >= 0.999;

  const inkColor = () => (inkSel.value === "custom" ? inkCustom.value : inkSel.value);

  function options(scale) {
    return {
      font: fontSel.value,
      size: Number(sizeIn.value) || 20,
      ink: inkColor(),
      lines: $("nLines").checked,
      margin: $("nMargin").checked,
      realism: Number($("nReal").value) / 100,
      finish: $("nFinish").value,
      surface: $("nSurface").value,
      scale,
    };
  }
  const seedFor = (row) => hashString(JSON.stringify(row || {}) + "|" + variation);
  const textFor = (row) => fillTemplate(editorText(editor), row);

  // Editor page mirrors the chosen font/ink so typing feels like the output.
  function applyStyle() {
    inkCustom.hidden = inkSel.value !== "custom";
    $("nSurfaceField").hidden = $("nFinish").value !== "photo";
    $("nRealOut").textContent = $("nReal").value + "%";
    page.style.setProperty("--hw-font", `"${fontSel.value}"`);
    page.style.setProperty("--ink", inkColor());
    page.style.fontSize = sizeIn.value + "px";
    page.classList.toggle("lines", $("nLines").checked);
    page.classList.toggle("margined", $("nMargin").checked);
    schedulePreview();
  }

  fontSel.addEventListener("change", () => {
    sizeIn.value = HANDWRITING_FONTS.find((x) => x.family === fontSel.value).size;
    applyStyle();
  });
  [sizeIn, inkSel, inkCustom, $("nLines"), $("nMargin"), $("nReal"), $("nFinish"), $("nSurface")].forEach((el) => el.addEventListener("input", applyStyle));
  $("nShuffle").addEventListener("click", () => {
    variation = (Math.random() * 1e9) | 0;
    schedulePreview();
  });

  editor.addEventListener("paste", (e) => {
    e.preventDefault();
    document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
  });
  editor.addEventListener("input", schedulePreview);
  // Column chips target the editor; make sure it's visible first.
  editor.addEventListener("reveal", () => setView("edit"));

  function setView(v) {
    view = v;
    if (v === "edit") cropping = false;
    root.querySelectorAll(".seg-btn[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    page.hidden = v !== "edit";
    preview.hidden = v !== "preview";
    updateCropUi();
    if (v === "preview") refreshPreview();
  }
  root.querySelectorAll(".seg-btn[data-view]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));

  function updateCropUi() {
    $("nCropBtn").textContent = cropping ? "done" : crop ? "edit crop" : "crop";
    $("nCropBtn").classList.toggle("primary", cropping);
    $("nAspect").hidden = !cropping;
    $("nCropReset").hidden = !crop;
    const scale = Number($("nScale").value);
    $("notesHint").textContent =
      view === "edit"
        ? "Type or paste. Click a column on the left to insert a token."
        : cropping
          ? "Drag to draw a crop, drag inside to move, handles to resize. Applies to every row."
          : crop && outBase
            ? `Cropped to ${Math.round(crop.w * outBase.w * scale)} × ${Math.round(crop.h * outBase.h * scale)} px. Exactly what gets downloaded.`
            : "Exactly what gets downloaded for the selected row.";
  }
  // --- live preview ---
  let timer = 0;
  let token = 0;
  function schedulePreview() {
    if (view !== "preview") return;
    clearTimeout(timer);
    timer = setTimeout(refreshPreview, 140);
  }
  async function refreshPreview() {
    const my = ++token;
    const S = (window.devicePixelRatio || 1) > 1 ? 2 : 1.25;
    const row = currentRow();
    try {
      const pages = await renderNote(textFor(row), { ...options(S), seed: seedFor(row) });
      if (my !== token) return;
      outBase = { w: pages[0].width / S, h: pages[0].height / S };
      cropper = null;
      if (cropping) {
        // Crop mode: the full first page with the crop overlay on top.
        const fig = document.createElement("figure");
        fig.className = "crop-fig";
        pages[0].style.width = outBase.w + "px";
        fig.appendChild(pages[0]);
        preview.replaceChildren(fig);
        cropper = attachCropper(fig, pages[0], {
          rect: crop,
          aspect,
          onChange: (r) => {
            crop = isFull(r) ? null : r;
            updateCropUi();
          },
        });
        updateCropUi();
        return;
      }
      preview.replaceChildren(
        ...pages.map((full, i) => {
          const fig = document.createElement("figure");
          const c = crop ? cropCanvas(full, crop) : full;
          c.style.width = c.width / S + "px";
          fig.appendChild(c);
          if (pages.length > 1) {
            const cap = document.createElement("figcaption");
            cap.textContent = `Page ${i + 1} of ${pages.length}`;
            fig.appendChild(cap);
          }
          return fig;
        })
      );
      updateCropUi();
    } catch (err) {
      if (my === token) preview.textContent = "Could not render: " + err.message;
    }
  }

  onDataChange(() => {
    updateLabels();
    schedulePreview();
  });

  function updateLabels() {
    const n = dataset.rows.length;
    $("nBulk").textContent = n ? `Download all (${n} rows)` : "Download all";
    $("nBulk").disabled = !n;
    $("nFileName").placeholder = dataset.columns.length ? `note-{${dataset.columns[0]}}` : "note";
  }

  // --- export ---
  function resolveFormat() {
    const f = $("nFormat").value;
    if (f !== "auto") return f;
    return $("nFinish").value === "photo" || $("nFinish").value === "scan" ? "jpeg" : "png";
  }

  async function exportRows(entries, label) {
    if (progress.busy) return;
    const scale = Number($("nScale").value);
    const fmt = resolveFormat();
    const ext = fmt === "jpeg" ? "jpg" : "png";
    const nameTpl = $("nFileName").value.trim() || $("nFileName").placeholder;
    const nameFor = uniqueNamer();
    const zip = new JSZip();
    const files = [];
    const task = progress.start(label, entries.length);
    try {
      for (let k = 0; k < entries.length; k++) {
        if (task.cancelled) return;
        const { row, index } = entries[k];
        const rendered = await renderNote(textFor(row), { ...options(scale), seed: seedFor(row) });
        const pages = crop ? rendered.map((c) => cropCanvas(c, crop)) : rendered;
        const base = safeFileName(fillTemplate(nameTpl.replace(/\{row\}/gi, String(index + 1)), row), `note-${index + 1}`);
        for (let p = 0; p < pages.length; p++) {
          const blob = await new Promise((r) => pages[p].toBlob(r, `image/${fmt}`, 0.9));
          const fname = nameFor(pages.length > 1 ? `${base} - p${p + 1}` : base, ext);
          files.push({ blob, fname });
          zip.file(fname, blob);
        }
        task.step(k + 1);
        await new Promise((r) => setTimeout(r)); // let the progress bar paint
      }
      if (files.length === 1) downloadBlob(files[0].blob, files[0].fname);
      else downloadBlob(await zip.generateAsync({ type: "blob" }), "handwritten-notes.zip");
    } catch (err) {
      task.fail(err);
    } finally {
      task.done();
    }
  }

  $("nOne").addEventListener("click", () =>
    exportRows([{ row: currentRow(), index: Math.max(0, dataset.previewIndex) }], "Rendering note")
  );
  $("nBulk").addEventListener("click", () =>
    exportRows(bulkRows().map((row, index) => ({ row, index })), `Rendering ${dataset.rows.length} notes`)
  );

  // --- crop controls ---
  $("nCropBtn").addEventListener("click", () => {
    cropping = !cropping;
    if (view !== "preview") setView("preview");
    else {
      updateCropUi();
      refreshPreview();
    }
  });
  $("nAspect").addEventListener("change", (e) => {
    aspect = ASPECTS[e.target.value];
    cropper?.setAspect(aspect);
  });
  $("nCropReset").addEventListener("click", () => {
    if (cropper) cropper.reset();
    else {
      crop = null;
      refreshPreview();
    }
    updateCropUi();
  });
  $("nScale").addEventListener("input", updateCropUi);
  preview.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && cropping) $("nCropBtn").click();
  });

  updateLabels();
  applyStyle();
  setView("preview");
}

// Plain text from the contenteditable page: <br> and block elements become newlines.
function editorText(el) {
  let out = "";
  const walk = (node) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) out += c.nodeValue;
      else if (c.nodeName === "BR") out += "\n";
      else if (c.nodeType === 1) {
        const block = /^(DIV|P|LI)$/.test(c.nodeName);
        if (block && out && !out.endsWith("\n")) out += "\n";
        walk(c);
        if (block && !out.endsWith("\n")) out += "\n";
      }
    }
  };
  walk(el);
  return out.replace(/ /g, " ");
}
