// Note settings: defaults, validation schema (shared by the MCP tools and the
// designer page's save endpoint) and conversion into renderer options.
import { z } from "zod";
import { FONTS, FONT_FAMILIES } from "./fonts.js";

export const INKS = { blue: "#0d2270", navy: "#000f55", black: "#1a1a1a", red: "#ba3807" };

// Defaults = the settings people liked most on the web app.
export const DEFAULTS = {
  font: "handwriting-1",
  ink: "blue",
  realism: 100,
  finish: "photo",
  surface: "wood",
  lines: false,
  margin: false,
  quality: 2,
  format: "auto",
};

export const cropSchema = z
  .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().gt(0).max(1), h: z.number().gt(0).max(1) })
  .refine((c) => c.x + c.w <= 1.0001 && c.y + c.h <= 1.0001, "crop must stay inside the image");

export const settingsSchema = z
  .object({
    font: z.enum(FONT_FAMILIES).optional().describe(`Handwriting style. Default "${DEFAULTS.font}". See list_note_options.`),
    size: z.number().min(8).max(80).optional().describe("Font size in px. Defaults to the chosen font's natural size."),
    ink: z
      .string()
      .regex(/^(blue|navy|black|red|#[0-9a-fA-F]{6})$/)
      .optional()
      .describe('Ink: "blue" (ballpoint), "navy", "black", "red", or a hex colour like "#224488".'),
    realism: z.number().min(0).max(100).optional().describe("0 = perfectly clean page, 100 = maximum variation."),
    finish: z
      .enum(["photo", "scan", "shadow", "clean"])
      .optional()
      .describe('"photo" = phone photo of the page on a desk, "scan", "shadow" = soft page shadow, "clean" = flat paper.'),
    surface: z.enum(["wood", "slate", "linen"]).optional().describe('Desk surface for the "photo" finish.'),
    lines: z.boolean().optional().describe("Ruled lines."),
    margin: z.boolean().optional().describe("Red margin lines."),
    quality: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().describe("Resolution: 1 = 450px page, 2 = 900px, 3 = 1350px."),
    format: z.enum(["auto", "jpg", "png"]).optional().describe('"auto" = JPG for photo/scan, PNG otherwise.'),
    crop: cropSchema
      .nullable()
      .optional()
      .describe("Crop as fractions of the image (0..1), e.g. {x:0.1,y:0.1,w:0.8,h:0.6}. null removes a saved style's crop."),
    variation: z.number().int().optional().describe("Change to re-roll the random handwriting variation. Default 1."),
  })
  .strict();

export function resolveSettings(s = {}) {
  const o = { ...DEFAULTS, ...s };
  const font = FONTS.find((f) => f.family === o.font) ?? FONTS[0];
  return {
    render: {
      font: font.family,
      size: o.size ?? font.size,
      ink: INKS[o.ink] ?? o.ink,
      realism: o.realism / 100,
      finish: o.finish,
      surface: o.surface,
      lines: o.lines,
      margin: o.margin,
      scale: o.quality,
    },
    format: o.format === "auto" ? (o.finish === "photo" || o.finish === "scan" ? "jpg" : "png") : o.format,
    crop: o.crop ?? null,
    variation: o.variation ?? 1,
  };
}
