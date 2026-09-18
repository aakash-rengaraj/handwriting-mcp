// Font catalogue for the MCP server. Files live in ../fonts next to dist/.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GlobalFonts } from "@napi-rs/canvas";

export const FONT_DIR =path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fonts");

// size = default px, matching the web app's per-font defaults.
export const FONTS = [
  { family: "handwriting-1", file: "handwriting-1.otf", size: 38 },
  { family: "handwriting-2", file: "handwriting-2.otf", size: 29 },
  { family: "handwriting-3", file: "handwriting-3.ttf", size: 30 },
  { family: "handwriting-4", file: "handwriting-4.otf", size: 27 },
  { family: "handwriting-5", file: "handwriting-5.otf", size: 27 },
  { family: "handwriting-6", file: "handwriting-6.otf", size: 23 },
  { family: "handwriting-7", file: "handwriting-7.ttf", size: 28 },
  { family: "handwriting-8", file: "handwriting-8.ttf", size: 24 },
  { family: "handwriting-9", file: "handwriting-9.ttf", size: 21 },
  { family: "handwriting-10", file: "handwriting-10.ttf", size: 19 },
  { family: "handwriting-11", file: "handwriting-11.ttf", size: 21 },
  { family: "handwriting-12", file: "handwriting-12.ttf", size: 22 },
  { family: "handwriting-13", file: "handwriting-13.ttf", size: 18 },
  { family: "handwriting-14", file: "handwriting-14.ttf", size: 23 },
  { family: "Caveat", file: "caveat.woff2", size: 24, note: "SIL OFL" },
  { family: "Kalam", file: "kalam.woff2", size: 20, note: "SIL OFL" },
  { family: "Homemade Apple", file: "homemade-apple.woff2", size: 15, note: "Apache 2.0" },
];

export const FONT_FAMILIES = FONTS.map((f) => f.family);

export function registerFonts() {
  const missing = [];
  for (const f of FONTS) {
    try {
      GlobalFonts.registerFromPath(path.join(FONT_DIR, f.file), f.family);
    } catch {
      missing.push(f.family);
    }
  }
  return missing;
}
