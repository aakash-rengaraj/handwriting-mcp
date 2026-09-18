// Load rows from CSV / TSV / spreadsheet files, normalised like the web app.
import { readFile } from "node:fs/promises";
import path from "node:path";
import Papa from "papaparse";
import * as XLSX from "xlsx";

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

export async function loadRowsFromFile(file, sheet) {
  const ext = path.extname(file).slice(1).toLowerCase();
  let raw;
  if (["csv", "tsv", "txt"].includes(ext)) {
    const text = (await readFile(file, "utf8")).replace(/^﻿/, "");
    raw = Papa.parse(text, { header: true, skipEmptyLines: "greedy" }).data;
  } else if (["xlsx", "xls", "xlsm", "ods", "numbers"].includes(ext)) {
    const wb = XLSX.read(await readFile(file), { type: "buffer" });
    const name = sheet ?? wb.SheetNames[0];
    if (!wb.Sheets[name]) throw new Error(`Sheet "${name}" not found. Sheets: ${wb.SheetNames.join(", ")}`);
    raw = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "", raw: false });
  } else {
    throw new Error(`Unsupported file type ".${ext}". Use .csv, .tsv, .xlsx, .xls or .ods.`);
  }
  const data = normalise(raw);
  if (!data.columns.length || !data.rows.length) throw new Error("No rows found. The first row must contain column headers.");
  return data;
}

export function loadRowsFromObjects(rows) {
  const data = normalise(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? "" : String(v)]))));
  if (!data.rows.length) throw new Error("`rows` is empty.");
  return data;
}
