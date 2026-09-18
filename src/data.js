// Shared bulk-data layer: import CSV / spreadsheets, expose columns + rows,
// and fill `{column}` tokens in templates. Everything runs in the browser.
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { fillTemplate, safeFileName, uniqueNamer } from "./template.js";

export { fillTemplate, safeFileName, uniqueNamer };

const listeners = new Set();

export const dataset = {
  fileName: "",
  columns: [],
  rows: [],
  // Index of the row used for live previews. -1 = no data, show raw template.
  previewIndex: -1,
};

export function onDataChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  listeners.forEach((fn) => fn(dataset));
}

export function setPreviewIndex(i) {
  dataset.previewIndex = dataset.rows.length ? Math.max(0, Math.min(i, dataset.rows.length - 1)) : -1;
  emit();
}

export function clearData() {
  Object.assign(dataset, { fileName: "", columns: [], rows: [], previewIndex: -1 });
  emit();
}

function normalise(rawRows) {
  const columns = [];
  const seen = new Set();
  for (const row of rawRows) {
    for (const key of Object.keys(row)) {
      const k = String(key).trim();
      if (k && !seen.has(k)) {
        seen.add(k);
        columns.push(k);
      }
    }
  }
  const rows = rawRows
    .map((row) => {
      const out = {};
      for (const [k, v] of Object.entries(row)) {
        const key = String(k).trim();
        if (key) out[key] = v == null ? "" : String(v).trim();
      }
      return out;
    })
    .filter((row) => Object.values(row).some((v) => v !== ""));
  return { columns, rows };
}

export async function importFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  let raw;
  if (ext === "csv" || ext === "tsv" || ext === "txt") {
    raw = await new Promise((resolve, reject) =>
      Papa.parse(file, {
        header: true,
        skipEmptyLines: "greedy",
        complete: (res) => resolve(res.data),
        error: reject,
      })
    );
  } else {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    raw = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  }
  const { columns, rows } = normalise(raw);
  if (!columns.length || !rows.length) throw new Error("No rows found. Make sure the first row contains column headers.");
  Object.assign(dataset, { fileName: file.name, columns, rows, previewIndex: 0 });
  emit();
}

// Paste support: tab- or comma-separated text with a header row.
export function importText(text) {
  const res = Papa.parse(text.trim(), { header: true, skipEmptyLines: "greedy" });
  const { columns, rows } = normalise(res.data);
  if (!columns.length || !rows.length) throw new Error("Paste needs a header row plus at least one data row.");
  Object.assign(dataset, { fileName: "Pasted data", columns, rows, previewIndex: 0 });
  emit();
}

export function currentRow() {
  return dataset.previewIndex >= 0 ? dataset.rows[dataset.previewIndex] : null;
}

// Rows to render in a bulk run; with no data we render the template once.
export function bulkRows() {
  return dataset.rows.length ? dataset.rows : [null];
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
