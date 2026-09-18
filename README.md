# GTM Studio

Bulk-personalised outbound creative: **handwritten notes** and **GIF memes**. Import a CSV or spreadsheet, drop `{column}` tokens into the text, preview any row, and export every row as a ZIP. Everything runs in the browser: no backend, and your data never leaves the tab.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/, host it anywhere (Netlify, S3, GitHub Pages…)
```

## MCP server

`mcp/` packages the notes renderer as a local MCP server (`handwriting-mcp`) for Claude, Cursor and other clients. See [mcp/README.md](mcp/README.md). It imports `src/notes/render.js` and `src/template.js` directly, so rebuild it after changing either.

## Deploy (gtm.millwrighttech.com)

`npm run build` outputs a plain static site, and `base: "./"` makes every asset path relative. Point any static host (Cloudflare Pages, Netlify, Vercel, GitHub Pages) at `dist/` and add a CNAME record for `gtm` → the host. On GitHub Pages, also put a `CNAME` file containing `gtm.millwrighttech.com` in `public/`.

## Branding

The theme mirrors millwrighttech.com (`Millwright/static/site.css`):
- **Colour:** everything is drawn in signal orange `#D83A00` on white. The tool stages (paper and meme canvas) swap to white on ink `#0c0c0c`, like the site's demo theatre.
- **Type:** Bricolage Grotesque (self-hosted via `@fontsource-variable`, including the `opsz` axis).
- **Components:** pill buttons, 1.5px rules instead of cards, numbered steps for the settings panels, and the lowercase `millwright` wordmark in the footer.
- **Icons:** the logo mark and favicons in `public/` were generated from `Millwright/static/img/logo.png`.

The tokens are at the top of `src/styles.css`.

## Data and tokens

- Import `.csv`, `.tsv`, `.xlsx`, `.xls`, `.ods`, or paste cells straight from Google Sheets / Excel. The first row must hold the headers, and only the first sheet is read.
- `{name}` inserts the row's `name` column. Column matching ignores case and surrounding spaces.
- `{name|there}` uses `there` when the cell is empty.
- Unknown tokens are left as-is, so typos stay visible in the preview.
- File names accept tokens too, plus `{row}` for the row number.

## Presets

**Handwritten notes** (`src/notes/`): the editable page and fonts come from texttohandwriting.com. Images are drawn by our own canvas renderer (`render.js`):
- **Letters:** every glyph gets a seeded random tilt, baseline shift, size change and spacing change. Lines slope, wave and drift from the rules.
- **Ink:** pressure varies by word, the ink bleeds slightly, and ballpoint skips show as grain.
- **Paper:** generated, not drawn: warm tone, blotches, fibres, wobbly blue rules, an occasional crease.
- **Finish:** *Photo on a desk* (perspective, contact shadow, lighting, vignette, lens softness, sensor noise on wood/slate/linen), *Scanned*, *Soft shadow* or *Clean*.

**Crop** (above the preview): drag to draw a region, drag inside it to move, and drag the handles to resize. Presets: Free, 1:1, 4:5, 3:2, 16:9, 9:16. The crop is stored as a fraction of the image, so it applies to every row, page and export scale.

The Realism slider scales all of it; 0 gives a perfectly clean page. The seed comes from the row's values, so the preview is exactly what downloads and every recipient gets a slightly different note. *Shuffle variation* re-rolls the whole batch. Long text flows onto extra pages (`name - p2.jpg`). Output is plain text only; bold and italic in the editor are ignored.

**Memes** (`src/memes/`): GIFs are decoded with `gifuct-js` into composited frames. Text layers are drawn on a canvas, where you can drag to move, drag a corner to scale, and drag a side handle to change the wrap width. Snapping to the centre is on by default (hold Alt to disable). Each layer can be limited to a frame range. Export re-encodes the GIF with `gifenc` in a pool of Web Workers; still images export as PNG. Small GIFs are upscaled by default so the text stays sharp. Long names shrink to fit their box instead of overflowing.

Add built-in memes by dropping files in `public/memes/` and listing them in `MEMES` in `src/memes/memes.js`. Users can also upload their own.

## Licensing

| Asset | Source | Licence |
| --- | --- | --- |
| Notes rendering code / paper CSS | texttohandwriting.com, based on [saurabhdaware/text-to-handwriting](https://github.com/saurabhdaware/text-to-handwriting) | MIT (upstream). The site's own modifications carry no stated licence |
| `handwriting-1…14` fonts | Created by Raj Chourasiya, TextToHandwriting.com | credit required (see Credits). `handwriting-13` is Indie Flower (SIL OFL) |
| Caveat, Kalam, Anton | Google Fonts via @fontsource | SIL OFL — commercial use OK |
| Homemade Apple | Google Fonts via @fontsource | Apache 2.0 — commercial use OK |
| Meme GIFs in `public/memes/` | Supplied locally | Check rights per image |
| papaparse, jszip, gifuct-js, gifenc | npm | MIT |
| SheetJS (`xlsx` 0.20.3, from cdn.sheetjs.com) | SheetJS | Apache 2.0 |

## Credits

**Handwriting fonts** (`handwriting-1` … `handwriting-14`) are made by **Raj Chourasiya** of [TextToHandwriting.com](https://texttohandwriting.com). Please keep this credit if you redistribute them.

| Font key | Typeface | Designer / copyright |
| --- | --- | --- |
| `handwriting-1` | Deepali Font | Made with Calligraphr |
| `handwriting-2` | Muskan | Made with Calligraphr |
| `handwriting-3` | QE Julian Dean | Julian Dean, Quantum Enterprises |
| `handwriting-4` | QE Sam Roberts 2 | Quantum Enterprises |
| `handwriting-5` | QE Print Version | Quantum Enterprises |
| `handwriting-6` | QE Antony Lark | Quantum Enterprises |
| `handwriting-7` | QE Sam Roberts 2 | Quantum Enterprises |
| `handwriting-8` | QE Tony Flores | Antonio Flores, Quantum Enterprises |
| `handwriting-9` | QE Braden Hill | Braden Hill, Quantum Enterprises |
| `handwriting-10` | QE Caroline Mutiboko | Caroline Mutiboko, Quantum Enterprises |
| `handwriting-11` | QE Donald Ross | Quantum Enterprises |
| `handwriting-12` | QE G H Hughes | G H Hughes, Quantum Enterprises |
| `handwriting-13` | Indie Flower | © 2010 Kimberly Geswein ([kimberlygeswein.com](http://kimberlygeswein.com)), [SIL Open Font License 1.1](https://openfontlicense.org) |
| `handwriting-14` | Children Handwritten | © 2017 Darwinoo |

**Open-licence fonts:**
- **Caveat:** © 2014 The Caveat Project Authors, [SIL Open Font License 1.1](https://openfontlicense.org).
- **Kalam:** © 2014 Indian Type Foundry, [SIL Open Font License 1.1](https://openfontlicense.org).
- **Homemade Apple:** © 2010 Font Diner, Inc., [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).

**Paper and page styling** is adapted from [text-to-handwriting](https://github.com/saurabhdaware/text-to-handwriting) by Saurabh Daware (MIT), via TextToHandwriting.com.
