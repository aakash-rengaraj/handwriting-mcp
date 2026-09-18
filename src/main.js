import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "@fontsource/anton";
import "@fontsource/caveat";
import "@fontsource/kalam";
import "@fontsource/homemade-apple";
import "./fonts.css";
import "./styles.css";
import { dataset, onDataChange, importFile, importText, clearData, setPreviewIndex } from "./data.js";
import { mountNotes } from "./notes/notes.js";
import { mountMemes } from "./memes/memes.js";

const $ = (id) => document.getElementById(id);

// Last focused template field + caret, so column chips insert at the cursor.
let lastTarget = null;
let savedRange = null;

mountNotes($("tab-notes"));
let memesMounted = false;

// --- tabs (memes mount lazily: GIF decoding is only needed there) ---
function showTab(name) {
  if (name === "memes" && !memesMounted) {
    mountMemes($("tab-memes"));
    memesMounted = true;
  }
  document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
  $("tab-notes").hidden = name !== "notes";
  $("tab-memes").hidden = name !== "memes";
  lastTarget = null;
  if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
showTab(location.hash === "#memes" ? "memes" : "notes");

// --- token insertion ---
document.addEventListener("focusin", (e) => {
  if (e.target.closest?.("[data-token-target]")) lastTarget = e.target.closest("[data-token-target]");
});
document.addEventListener("selectionchange", () => {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const node = sel.anchorNode;
  const host = node && (node.nodeType === 1 ? node : node.parentElement)?.closest?.("[contenteditable][data-token-target]");
  if (host) savedRange = sel.getRangeAt(0).cloneRange();
});

function activeTool() {
  return document.querySelector(".tool:not([hidden])");
}

function insertToken(token) {
  let target = lastTarget && activeTool()?.contains(lastTarget) ? lastTarget : activeTool()?.querySelector("[data-token-target]");
  if (!target) return;
  // Let the tool un-hide the field (e.g. notes switching from Preview to Edit).
  if (!target.offsetParent) target.dispatchEvent(new CustomEvent("reveal", { bubbles: true }));
  if (target.isContentEditable) {
    target.focus();
    const sel = window.getSelection();
    if (savedRange && target.contains(savedRange.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(savedRange);
    } else {
      const r = document.createRange();
      r.selectNodeContents(target);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    document.execCommand("insertText", false, token);
  } else {
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    target.focus();
    target.setRangeText(token, start, end, "end");
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

// --- data panel ---
async function handleFile(file) {
  $("dataError").textContent = "";
  try {
    await importFile(file);
  } catch (err) {
    $("dataError").textContent = err.message || "Could not read that file.";
  }
}

$("fileInput").addEventListener("change", (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
  e.target.value = "";
});
const dz = $("dropzone");
dz.addEventListener("dragover", (e) => {
  e.preventDefault();
  dz.classList.add("over");
});
dz.addEventListener("dragleave", () => dz.classList.remove("over"));
dz.addEventListener("drop", (e) => {
  e.preventDefault();
  dz.classList.remove("over");
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

$("pasteToggle").addEventListener("click", () => {
  $("pasteBox").hidden = !$("pasteBox").hidden;
  if (!$("pasteBox").hidden) $("pasteArea").focus();
});
$("pasteApply").addEventListener("click", () => {
  $("dataError").textContent = "";
  try {
    importText($("pasteArea").value);
    $("pasteArea").value = "";
    $("pasteBox").hidden = true;
  } catch (err) {
    $("dataError").textContent = err.message;
  }
});
$("sampleBtn").addEventListener("click", () =>
  importText(
    "name,company,title,city\nPriya,Acme Robotics,Head of Growth,Austin\nMarcus,Northwind,VP Sales,Chicago\nSofia,Globex,Founder,Lisbon\nKenji,Initech,RevOps Lead,Tokyo\nAmara,,Marketing Director,Lagos"
  )
);
$("clearData").addEventListener("click", clearData);
$("prevRow").addEventListener("click", () => setPreviewIndex(dataset.previewIndex - 1));
$("nextRow").addEventListener("click", () => setPreviewIndex(dataset.previewIndex + 1));

function renderData() {
  const has = dataset.rows.length > 0;
  $("dataEmpty").hidden = has;
  $("dataLoaded").hidden = !has;
  $("rowNav").hidden = !has;
  $("fileName").textContent = dataset.fileName;
  $("rowCount").textContent = `${dataset.rows.length} rows · ${dataset.columns.length} columns`;

  const chips = $("chips");
  chips.innerHTML = "";
  const cols = has ? dataset.columns : ["name", "company"];
  for (const c of cols) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = `{${c}}`;
    b.title = `Insert {${c}}`;
    b.addEventListener("mousedown", (e) => e.preventDefault()); // keep caret in the editor
    b.addEventListener("click", () => insertToken(`{${c}}`));
    chips.appendChild(b);
  }
  if (!has) {
    const p = document.createElement("p");
    p.className = "muted small";
    p.textContent = "Example columns. Import data to see yours.";
    chips.appendChild(p);
  }

  if (has) {
    const i = dataset.previewIndex;
    $("rowLabel").textContent = `Row ${i + 1} of ${dataset.rows.length}`;
    $("prevRow").disabled = i <= 0;
    $("nextRow").disabled = i >= dataset.rows.length - 1;
    const dl = $("rowValues");
    dl.innerHTML = "";
    for (const c of dataset.columns) {
      const dt = document.createElement("dt");
      dt.textContent = c;
      const dd = document.createElement("dd");
      dd.textContent = dataset.rows[i][c] || "—";
      dl.append(dt, dd);
    }
  }
}
onDataChange(renderData);
renderData();
