// Saved note styles: ~/.millwright-notes/styles.json (override the folder with
// MILLWRIGHT_NOTES_HOME). A style = { settings, template?, sample?, updated_at }.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const STORE_DIR = process.env.MILLWRIGHT_NOTES_HOME || path.join(os.homedir(), ".millwright-notes");
const FILE = path.join(STORE_DIR, "styles.json");

export const STYLE_NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/;

export async function loadStyles() {
  try {
    const data = JSON.parse(await readFile(FILE, "utf8"));
    return data && typeof data.styles === "object" ? data : { styles: {} };
  } catch {
    return { styles: {} };
  }
}

export async function getStyle(name) {
  return (await loadStyles()).styles[name] ?? null;
}

export async function saveStyle(name, style) {
  const data = await loadStyles();
  data.styles[name] = { ...style, updated_at: new Date().toISOString() };
  await mkdir(STORE_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, FILE);
  return data.styles[name];
}
