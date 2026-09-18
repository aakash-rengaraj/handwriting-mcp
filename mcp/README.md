# handwriting-mcp

An MCP server that turns text, or every row of a CSV or spreadsheet, into realistic handwritten notes. It's the same renderer as [gtm.millwrighttech.com](https://gtm.millwrighttech.com), running locally: your list and your notes never leave your machine.

## Install

**Claude Code**

```bash
claude mcp add millwright-notes -- npx -y handwriting-mcp
```

**Claude Desktop, Cursor, Windsurf and other clients**: add this to the client's MCP config (for Claude Desktop, `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "millwright-notes": {
      "command": "npx",
      "args": ["-y", "handwriting-mcp"]
    }
  }
}
```

Requires Node 18+. Works on macOS, Windows and Linux (x64 and arm64).

## Set up your note style

On first run, the server opens the **note designer** in your browser: a local page with a live preview. Write your template, type sample values for its `{tokens}`, and pick the handwriting, ink, realism, finish (photo on a desk, scan, …) and an optional crop. Click **Save style**. From then on, every note uses that style, and batches use the saved template if you don't give one.

To change it later, ask Claude to "open the note designer". Save under another name (e.g. `linkedin`) to keep several styles, then say "use the linkedin style".

The designer is only reachable from your own computer: it listens on `127.0.0.1` behind a random URL token and closes after 20 idle minutes. Styles are saved in `~/.millwright-notes/styles.json`.

## Try it

> Write a handwritten note to Priya thanking her for the intro to Acme Robotics.

> Make a handwritten note for every lead in ~/Desktop/leads.csv. Name the files {first_name}-{company}.

(This uses the template saved in the designer. You can also give one inline: "…using: Hi {first_name|there}, loved what {company} is building.")

Images are saved to `~/Downloads/handwritten-notes/`. Each batch gets its own timestamped folder, and existing files are never overwritten.

## Tools

| Tool | What it does |
| --- | --- |
| `open_note_designer` | Opens the local designer page to create or edit a style (`style` = name, default `default`). |
| `render_note` | Renders one note (with optional `{token}` values) and returns the file path plus a preview image. |
| `render_notes_batch` | Renders one note per row of a `.csv` / `.tsv` / `.xlsx` / `.xls` / `.ods` file, or an inline `rows` array. Checks for misspelled or empty columns, supports `dry_run`, and reports progress. Up to 5,000 rows. |
| `list_note_options` | Lists saved styles, fonts, inks, finishes, surfaces and defaults. |

`render_note` and `render_notes_batch` take `style` (a saved style name) and `settings` (overrides for this call only). The order of precedence is built-in defaults, then the saved style, then per-call `settings`. Pass `crop: null` to drop a saved crop for one run.

**Templates:** `{column}` inserts a value (matching ignores case), and `{column|fallback}` is used when the cell is empty. File names accept tokens plus `{row}` for the row number.

**Settings** (all optional; usually set in the designer):

| Setting | Values | Default |
| --- | --- | --- |
| `font` | `handwriting-1` … `handwriting-14`, `Caveat`, `Kalam`, `Homemade Apple` | `handwriting-1` |
| `size` | 8–80 px | the font's natural size |
| `ink` | `blue`, `navy`, `black`, `red` or `#rrggbb` | `blue` |
| `realism` | 0–100 | 100 |
| `finish` | `photo` (on a desk), `scan`, `shadow`, `clean` | `photo` |
| `surface` | `wood`, `slate`, `linen` (photo finish only) | `wood` |
| `lines` / `margin` | true / false | false / false |
| `quality` | 1, 2, 3 (450 / 900 / 1350 px page) | 2 |
| `format` | `auto`, `jpg`, `png` | `auto` (JPG for photo and scan) |
| `crop` | `{x, y, w, h}` as fractions 0–1 | none |
| `variation` | any integer; change it to re-roll the handwriting | 1 |

Each row's variation is seeded from its values, so re-running a batch gives identical images. The same row and settings also match the web app.

## Environment variables

| Variable | Effect |
| --- | --- |
| `MILLWRIGHT_NOTES_HOME` | Where styles are saved (default `~/.millwright-notes`). |
| `MILLWRIGHT_NOTES_NO_AUTO_OPEN=1` | Don't open the designer on first run. |

## Develop

```bash
npm install
npm run build        # bundles the server + designer page (dist/) and copies fonts/
node dist/server.js  # stdio server
```

The renderer and cropper live in the web app (`../src/notes/`) and are shared, not copied: the MCP runs them in Node and the designer page runs them in the browser. Change them there, then rebuild both.

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