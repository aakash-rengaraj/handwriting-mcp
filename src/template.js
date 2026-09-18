// Pure template helpers shared by the web app and the MCP server.

const TOKEN = /\{\s*([^{}|]+?)\s*(?:\|\s*([^{}]*?)\s*)?\}/g;

function lookup(row, key) {
  if (key in row) return row[key];
  const lower = key.toLowerCase();
  for (const k of Object.keys(row)) if (k.toLowerCase() === lower) return row[k];
  return undefined;
}

// `{name}` → row value; `{name|there}` → fallback when the cell is empty.
// Tokens that don't match a column are left untouched so typos stay visible.
export function fillTemplate(template, row) {
  if (!row) return template;
  return template.replace(TOKEN, (match, key, fallback) => {
    const value = lookup(row, key);
    if (value === undefined) return fallback !== undefined ? fallback : match;
    return value !== "" ? value : fallback ?? "";
  });
}

export function safeFileName(name, fallback) {
  const cleaned = String(name || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

// Unique names inside a ZIP.
export function uniqueNamer() {
  const used = new Map();
  return (base, ext) => {
    const n = used.get(base) || 0;
    used.set(base, n + 1);
    return n ? `${base} (${n + 1}).${ext}` : `${base}.${ext}`;
  };
}
