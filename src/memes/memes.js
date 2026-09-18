// Meme preset: pick a GIF, add text layers (move / scale / wrap on canvas),
// then export one row or every row of the dataset as animated GIFs.
import JSZip from "jszip";
import { loadMedia } from "./gif.js";
import { dataset, onDataChange, fillTemplate, currentRow, bulkRows, safeFileName, uniqueNamer, downloadBlob } from "../data.js";
import { progress } from "../progress.js";

const MEMES = [
  ["hi-hello-there.gif", "Hi hello there"],
  ["hello-you-there.gif", "Hello, you there?"],
  ["happy-cat.gif", "Happy cat"],
  ["happy-cat-2.gif", "Happy cat 2"],
  ["cat.gif", "Cat"],
  ["doge.gif", "Doge"],
  ["dog-hiding.gif", "Dog hiding"],
  ["dog-discord.gif", "Dog"],
  ["angry.gif", "Angry"],
  ["sadhamstergirl.gif", "Sad hamster"],
  ["happy-dance.gif", "Happy dance"],
  ["quby-high-five.gif", "High five"],
].map(([file, label]) => ({ src: `${import.meta.env.BASE_URL}memes/${file}`, label, file }));

const FONTS = [
  { family: "Anton", label: "Impact-style (Anton)" },
  { family: "Bricolage Grotesque Variable", label: "Bricolage (Millwright)" },
  { family: "Caveat", label: "Caveat (handwritten)" },
  { family: "Kalam", label: "Kalam (handwritten)" },
  { family: "handwriting-1", label: "handwriting-1" },
  { family: "Arial", label: "Sans" },
  { family: "Georgia", label: "Serif" },
];

const HANDLE = 9; // display px
const SNAP = 0.015;
let nextId = 1;

function newLayer(overrides = {}) {
  return {
    id: nextId++,
    text: "Hey {name|there}!",
    x: 0.5,
    y: 0.14,
    size: 0.11,
    width: 0.92,
    font: "Anton",
    color: "#ffffff",
    stroke: "#000000",
    strokeW: 0.14,
    align: "center",
    caps: true,
    bold: false,
    from: 0, // first frame index the text is shown on
    to: null, // last frame index (null = until the end)
    ...overrides,
  };
}

// --- text layout / drawing shared by preview + export --------------------

function fontString(layer, px) {
  return `${layer.bold ? "700 " : ""}${px}px "${layer.font}", Impact, sans-serif`;
}

function wrapLines(ctx, text, maxW) {
  const lines = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const test = line + " " + words[i];
      if (ctx.measureText(test).width <= maxW) line = test;
      else {
        lines.push(line);
        line = words[i];
      }
    }
    lines.push(line);
  }
  return lines;
}

function layoutLayer(ctx, layer, row, W, H) {
  let text = fillTemplate(layer.text, row);
  if (layer.caps) text = text.toUpperCase();
  const maxW = layer.width * W;
  let px = Math.max(4, layer.size * H);
  ctx.font = fontString(layer, px);
  // Long names in bulk runs: shrink so the longest word still fits the box.
  const longest = Math.max(0, ...text.split(/\s+/).map((w) => ctx.measureText(w).width));
  if (longest > maxW) {
    px = Math.max(4, (px * maxW) / longest);
    ctx.font = fontString(layer, px);
  }
  const lines = wrapLines(ctx, text, maxW);
  const lh = px * 1.12;
  const h = Math.max(lh, lines.length * lh);
  return { lines, px, lh, box: { x: layer.x * W - maxW / 2, y: layer.y * H - h / 2, w: maxW, h } };
}

function drawLayer(ctx, layer, lay) {
  const { lines, px, lh, box } = lay;
  ctx.save();
  ctx.font = fontString(layer, px);
  ctx.textAlign = layer.align;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  const x = layer.align === "left" ? box.x : layer.align === "right" ? box.x + box.w : box.x + box.w / 2;
  lines.forEach((line, i) => {
    const y = box.y + lh * (i + 0.5);
    if (layer.strokeW > 0) {
      ctx.lineWidth = layer.strokeW * px;
      ctx.strokeStyle = layer.stroke;
      ctx.strokeText(line, x, y);
    }
    ctx.fillStyle = layer.color;
    ctx.fillText(line, x, y);
  });
  ctx.restore();
}

function drawScene(ctx, media, frameIdx, layers, row, W, H, opts) {
  ctx.clearRect(0, 0, W, H);
  if (opts.background === "white") {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
  }
  ctx.imageSmoothingEnabled = !opts.pixelated;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(media.frames[frameIdx].bitmap, 0, 0, W, H);
  return layers.map((layer) => {
    const lay = layoutLayer(ctx, layer, row, W, H);
    const visible = !media.animated || (frameIdx >= layer.from && (layer.to == null || frameIdx <= layer.to));
    // In the editor the selected layer stays visible (ghosted) outside its frame range.
    if (!visible && opts.ghostId !== layer.id) return lay;
    ctx.globalAlpha = visible ? 1 : 0.35;
    drawLayer(ctx, layer, lay);
    ctx.globalAlpha = 1;
    return lay;
  });
}

async function ensureFonts(layers) {
  await Promise.all([...new Set(layers.map((l) => l.font))].map((f) => document.fonts.load(`40px "${f}"`).catch(() => {})));
}

// --- encoder worker pool --------------------------------------------------

let pool = null;
function getPool() {
  if (pool) return pool;
  const size = Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, 6));
  const workers = Array.from({ length: size }, () => new Worker(new URL("./encode-worker.js", import.meta.url), { type: "module" }));
  const idle = [...workers];
  const waiting = [];
  const pending = new Map();
  let seq = 0;
  workers.forEach((w) => {
    w.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      pending.delete(data.id);
      idle.push(w);
      if (waiting.length) waiting.shift()();
      data.error ? p.reject(new Error(data.error)) : p.resolve(data.bytes);
    };
  });
  pool = {
    size,
    async encode(payload, transfer) {
      while (!idle.length) await new Promise((r) => waiting.push(r));
      const w = idle.pop();
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage({ ...payload, id }, transfer);
      });
    },
  };
  return pool;
}

// --- UI -------------------------------------------------------------------

export function mountMemes(root) {
  root.innerHTML = `
    <div class="tool-grid">
      <section class="stage-col">
        <div class="gallery" id="mGallery" role="listbox" aria-label="Meme templates"></div>
        <div class="stage-head">
          <span class="hint">Drag text to move · corners scale · side handles set wrap width · double-click to edit</span>
          <button type="button" class="btn small" id="mPlay">Pause</button>
        </div>
        <div class="meme-stage" id="mStage">
          <canvas id="mCanvas" tabindex="0" aria-label="Meme canvas. Arrow keys nudge the selected text, Delete removes it."></canvas>
          <p class="muted" id="mLoading">Loading…</p>
        </div>
        <div class="meta" id="mMeta"></div>
      </section>

      <aside class="controls">
        <fieldset>
          <legend>Text layers</legend>
          <div class="layer-list" id="mLayers"></div>
          <div class="btn-row">
            <button type="button" class="btn" id="mAdd">+ Add text</button>
            <button type="button" class="btn" id="mDup">Duplicate</button>
            <button type="button" class="btn danger" id="mDel">Delete</button>
          </div>
        </fieldset>
        <fieldset id="mProps">
          <legend>Selected text</legend>
          <label class="field"><span>Text</span><textarea id="mText" rows="3" data-token-target></textarea></label>
          <div class="field-row">
            <label class="field"><span>Font</span><select id="mFont">${FONTS.map((f) => `<option value="${f.family}">${f.label}</option>`).join("")}</select></label>
            <div class="field"><span>Align</span>
              <div class="seg" id="mAlign">
                <button type="button" class="seg-btn" data-align="left" aria-label="Align left">L</button>
                <button type="button" class="seg-btn" data-align="center" aria-label="Align center">C</button>
                <button type="button" class="seg-btn" data-align="right" aria-label="Align right">R</button>
              </div>
            </div>
          </div>
          <label class="field"><span>Size <output id="mSizeOut"></output></span><input id="mSize" type="range" min="2" max="45" step="0.5"></label>
          <label class="field"><span>Box width <output id="mWidthOut"></output></span><input id="mWidth" type="range" min="10" max="150" step="1"></label>
          <div class="field-row">
            <label class="field"><span>Fill</span><input id="mColor" type="color"></label>
            <label class="field"><span>Outline</span><input id="mStroke" type="color"></label>
          </div>
          <label class="field"><span>Outline width <output id="mStrokeOut"></output></span><input id="mStrokeW" type="range" min="0" max="35" step="1"></label>
          <label class="check"><input type="checkbox" id="mCaps"> ALL CAPS</label>
          <label class="check"><input type="checkbox" id="mBold"> Bold</label>
          <div class="field-row" id="mFrames">
            <label class="field"><span>Show from frame</span><input id="mFrom" type="number" min="1" step="1"></label>
            <label class="field"><span>to frame</span><input id="mTo" type="number" min="1" step="1"></label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Export</legend>
          <div class="field-row">
            <label class="field"><span>Output size</span><select id="mScale"></select></label>
            <label class="field" id="mBgField"><span>Background</span>
              <select id="mBg"><option value="keep">Transparent</option><option value="white">White</option></select>
            </label>
          </div>
          <label class="check"><input type="checkbox" id="mPixel"> Pixel-art scaling</label>
          <label class="field"><span>File name</span><input id="mFileName" type="text" data-token-target></label>
          <div class="btn-row">
            <button type="button" class="btn" id="mOne">Download this row</button>
            <button type="button" class="btn primary" id="mBulk">Download all</button>
          </div>
        </fieldset>
      </aside>
    </div>`;

  const $ = (id) => root.querySelector("#" + id);
  const canvas = $("mCanvas");
  const ctx = canvas.getContext("2d");
  const stage = $("mStage");

  const state = {
    media: null,
    mediaLabel: "",
    layers: [newLayer(), newLayer({ text: "Got a sec?", y: 0.88 })],
    selectedId: null,
    scale: "auto",
    background: "keep",
    pixelated: false,
    playing: true,
    frame: 0,
    guides: { v: false, h: false },
  };
  state.selectedId = state.layers[0].id;

  const selected = () => state.layers.find((l) => l.id === state.selectedId) || null;

  // Small GIFs get upscaled so text stays crisp (long side >= 320px).
  function autoScale() {
    const long = Math.max(state.media.width, state.media.height);
    return Math.max(1, Math.min(4, Math.ceil(320 / long)));
  }

  function exportScale() {
    if (!state.media) return 1;
    return state.scale === "auto" ? autoScale() : Number(state.scale);
  }

  function sceneOpts() {
    return { background: state.media?.transparent ? state.background : "keep", pixelated: state.pixelated };
  }

  // --- gallery ---
  const gallery = $("mGallery");
  function renderGallery(activeSrc) {
    gallery.innerHTML = "";
    for (const m of MEMES) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tile" + (m.src === activeSrc ? " active" : "");
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", String(m.src === activeSrc));
      b.title = m.label;
      b.innerHTML = `<img loading="lazy" alt="">`;
      b.querySelector("img").src = m.src;
      b.querySelector("img").alt = m.label;
      b.addEventListener("click", () => selectMedia(m.src, m.label));
      gallery.appendChild(b);
    }
    const up = document.createElement("label");
    up.className = "tile upload";
    up.innerHTML = `<input type="file" accept="image/gif,image/png,image/jpeg,image/webp" hidden><span>+ Upload</span>`;
    up.querySelector("input").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (f) selectMedia(f, f.name.replace(/\.[^.]+$/, ""));
      e.target.value = "";
    });
    gallery.appendChild(up);
  }

  let loadToken = 0;
  async function selectMedia(src, label) {
    const token = ++loadToken;
    $("mLoading").hidden = false;
    renderGallery(typeof src === "string" ? src : null);
    try {
      const media = await loadMedia(src);
      if (token !== loadToken) return;
      state.media = media;
      state.mediaLabel = label;
      state.frame = 0;
      $("mBgField").hidden = !media.transparent;
      refreshScaleOptions();
      sizeCanvas();
      draw();
    } catch (err) {
      $("mMeta").textContent = "Could not load image: " + err.message;
    } finally {
      if (token === loadToken) $("mLoading").hidden = true;
    }
  }

  // --- canvas sizing / drawing ---
  let lastLays = [];

  function sizeCanvas() {
    const m = state.media;
    if (!m) return;
    const s = exportScale();
    canvas.width = m.width * s;
    canvas.height = m.height * s;
    const maxW = stage.clientWidth - 24;
    const maxH = Math.min(window.innerHeight * 0.62, 620);
    const fit = Math.min(maxW / canvas.width, maxH / canvas.height);
    canvas.style.width = Math.round(canvas.width * fit) + "px";
    canvas.style.height = Math.round(canvas.height * fit) + "px";
    canvas.style.imageRendering = state.pixelated ? "pixelated" : "auto";
    $("mMeta").textContent = `${state.mediaLabel} · ${m.width}×${m.height}` + (m.animated ? ` · ${m.frames.length} frames` : " · still image") + ` · exports at ${canvas.width}×${canvas.height} ${m.animated ? "GIF" : "PNG"}`;
  }

  function draw() {
    const m = state.media;
    if (!m) return;
    const W = canvas.width;
    const H = canvas.height;
    lastLays = drawScene(ctx, m, state.frame, state.layers, currentRow(), W, H, { ...sceneOpts(), ghostId: state.selectedId });
    const k = W / canvas.clientWidth || 1; // canvas px per display px
    const g = state.guides;
    ctx.save();
    ctx.strokeStyle = "#d83a00";
    ctx.lineWidth = 1 * k;
    if (g.v) line(ctx, W / 2, 0, W / 2, H);
    if (g.h) line(ctx, 0, H / 2, W, H / 2);
    const i = state.layers.findIndex((l) => l.id === state.selectedId);
    if (i >= 0) {
      const b = lastLays[i].box;
      ctx.setLineDash([5 * k, 4 * k]);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2.5 * k;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = "#d83a00";
      ctx.lineWidth = 1.25 * k;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.setLineDash([]);
      for (const [, hx, hy, kind] of handles(b)) {
        const r = (HANDLE / 2) * k;
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "#d83a00";
        ctx.lineWidth = 1.5 * k;
        ctx.beginPath();
        if (kind === "width") ctx.roundRect(hx - r * 0.6, hy - r * 1.3, r * 1.2, r * 2.6, r * 0.6);
        else ctx.rect(hx - r, hy - r, r * 2, r * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function line(c, x1, y1, x2, y2) {
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();
  }

  function handles(b) {
    return [
      ["nw", b.x, b.y, "scale"],
      ["ne", b.x + b.w, b.y, "scale"],
      ["sw", b.x, b.y + b.h, "scale"],
      ["se", b.x + b.w, b.y + b.h, "scale"],
      ["w", b.x, b.y + b.h / 2, "width"],
      ["e", b.x + b.w, b.y + b.h / 2, "width"],
    ];
  }

  // Animation loop: redraw only on frame change or when marked dirty.
  let last = performance.now();
  let acc = 0;
  let dirty = true;
  function tick(now) {
    const m = state.media;
    if (m && m.animated && state.playing) {
      acc += now - last;
      let d = m.frames[state.frame].delay;
      while (acc >= d) {
        acc -= d;
        state.frame = (state.frame + 1) % m.frames.length;
        d = m.frames[state.frame].delay;
        dirty = true;
      }
    }
    last = now;
    if (dirty) {
      draw();
      dirty = false;
    }
    requestAnimationFrame(tick);
  }
  const redraw = () => (dirty = true);
  requestAnimationFrame(tick);

  $("mPlay").addEventListener("click", () => {
    state.playing = !state.playing;
    $("mPlay").textContent = state.playing ? "Pause" : "Play";
  });

  new ResizeObserver(() => {
    sizeCanvas();
    redraw();
  }).observe(stage);

  // --- pointer interaction ---
  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * canvas.width) / r.width, y: ((e.clientY - r.top) * canvas.height) / r.height };
  }

  function hitTest(p) {
    const k = canvas.width / canvas.clientWidth;
    const i = state.layers.findIndex((l) => l.id === state.selectedId);
    if (i >= 0) {
      for (const [name, hx, hy, kind] of handles(lastLays[i].box)) {
        if (Math.abs(p.x - hx) <= HANDLE * k && Math.abs(p.y - hy) <= HANDLE * k * (kind === "width" ? 1.6 : 1)) return { layer: state.layers[i], lay: lastLays[i], mode: kind, handle: name };
      }
    }
    for (let j = state.layers.length - 1; j >= 0; j--) {
      const b = lastLays[j]?.box;
      if (b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return { layer: state.layers[j], lay: lastLays[j], mode: "move" };
    }
    return null;
  }

  const CURSORS = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", e: "ew-resize", w: "ew-resize" };
  let drag = null;

  canvas.addEventListener("pointerdown", (e) => {
    if (!state.media) return;
    const p = toCanvas(e);
    const hit = hitTest(p);
    if (!hit) {
      state.selectedId = null;
      syncPanel();
      redraw();
      return;
    }
    state.selectedId = hit.layer.id;
    const b = hit.lay.box;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    drag = { ...hit, start: p, orig: { ...hit.layer }, cx, cy, dist0: Math.hypot(p.x - cx, p.y - cy) || 1 };
    canvas.setPointerCapture(e.pointerId);
    syncPanel();
    redraw();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!state.media) return;
    const p = toCanvas(e);
    if (!drag) {
      const hit = hitTest(p);
      canvas.style.cursor = hit ? (hit.mode === "move" ? "move" : CURSORS[hit.handle]) : "default";
      return;
    }
    const W = canvas.width;
    const H = canvas.height;
    const L = drag.layer;
    const o = drag.orig;
    if (drag.mode === "move") {
      let x = o.x + (p.x - drag.start.x) / W;
      let y = o.y + (p.y - drag.start.y) / H;
      state.guides.v = Math.abs(x - 0.5) < SNAP && !e.altKey;
      state.guides.h = Math.abs(y - 0.5) < SNAP && !e.altKey;
      if (state.guides.v) x = 0.5;
      if (state.guides.h) y = 0.5;
      L.x = clamp(x, -0.2, 1.2);
      L.y = clamp(y, -0.2, 1.2);
    } else if (drag.mode === "scale") {
      const f = Math.hypot(p.x - drag.cx, p.y - drag.cy) / drag.dist0;
      L.size = clamp(o.size * f, 0.02, 0.6);
      L.width = clamp(o.width * f, 0.08, 1.6);
    } else {
      L.width = clamp((2 * Math.abs(p.x - drag.cx)) / W, 0.08, 1.6);
    }
    syncPanel(false);
    redraw();
  });

  const endDrag = () => {
    drag = null;
    state.guides.v = state.guides.h = false;
    redraw();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("dblclick", () => {
    if (selected()) {
      $("mText").focus();
      $("mText").select();
    }
  });
  canvas.addEventListener("keydown", (e) => {
    const L = selected();
    if (!L) return;
    const step = e.shiftKey ? 0.05 : 0.005;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      L.x += moves[e.key][0];
      L.y += moves[e.key][1];
      redraw();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeSelected();
    }
  });

  // --- layers panel ---
  function renderLayerList() {
    const list = $("mLayers");
    list.innerHTML = "";
    if (!state.layers.length) list.innerHTML = `<p class="muted">No text yet.</p>`;
    state.layers.forEach((l) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "layer" + (l.id === state.selectedId ? " active" : "");
      b.textContent = l.text.trim() || "(empty)";
      b.addEventListener("click", () => {
        state.selectedId = l.id;
        syncPanel();
        redraw();
      });
      list.appendChild(b);
    });
  }

  function syncPanel(full = true) {
    const L = selected();
    $("mProps").disabled = !L;
    $("mDup").disabled = $("mDel").disabled = !L;
    if (full) renderLayerList();
    if (!L) return;
    if (full) {
      if (document.activeElement !== $("mText")) $("mText").value = L.text;
      $("mFont").value = L.font;
      $("mColor").value = L.color;
      $("mStroke").value = L.stroke;
      $("mCaps").checked = L.caps;
      $("mBold").checked = L.bold;
      root.querySelectorAll("#mAlign .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.align === L.align));
    }
    $("mSize").value = (L.size * 100).toFixed(1);
    $("mSizeOut").textContent = Math.round(L.size * 100) + "%";
    $("mWidth").value = Math.round(L.width * 100);
    $("mWidthOut").textContent = Math.round(L.width * 100) + "%";
    $("mStrokeW").value = Math.round(L.strokeW * 100);
    $("mStrokeOut").textContent = Math.round(L.strokeW * 100) + "%";
    if (full && state.media) {
      const n = state.media.frames.length;
      $("mFrom").value = L.from + 1;
      $("mTo").value = L.to == null ? n : L.to + 1;
    }
  }

  const bind = (id, evt, fn) =>
    $(id).addEventListener(evt, (e) => {
      const L = selected();
      if (!L) return;
      fn(L, e.target);
      syncPanel(id === "mText" ? false : true);
      if (id === "mText") renderLayerList();
      redraw();
    });
  bind("mText", "input", (L, t) => (L.text = t.value));
  bind("mFont", "change", async (L, t) => {
    L.font = t.value;
    await ensureFonts([L]);
    redraw();
  });
  bind("mSize", "input", (L, t) => (L.size = t.value / 100));
  bind("mWidth", "input", (L, t) => (L.width = t.value / 100));
  bind("mColor", "input", (L, t) => (L.color = t.value));
  bind("mStroke", "input", (L, t) => (L.stroke = t.value));
  bind("mStrokeW", "input", (L, t) => (L.strokeW = t.value / 100));
  bind("mFrom", "change", (L, t) => (L.from = clamp(Math.round(t.value) - 1 || 0, 0, state.media.frames.length - 1)));
  bind("mTo", "change", (L, t) => {
    const n = state.media.frames.length;
    const v = clamp(Math.round(t.value) || n, 1, n);
    L.to = v >= n ? null : Math.max(v - 1, L.from);
  });
  bind("mCaps", "change", (L, t) => (L.caps = t.checked));
  bind("mBold", "change", (L, t) => (L.bold = t.checked));
  root.querySelectorAll("#mAlign .seg-btn").forEach((b) =>
    b.addEventListener("click", () => {
      const L = selected();
      if (!L) return;
      L.align = b.dataset.align;
      syncPanel();
      redraw();
    })
  );

  $("mAdd").addEventListener("click", () => {
    const L = newLayer({ text: "New text", y: 0.5, caps: false, size: 0.09 });
    state.layers.push(L);
    state.selectedId = L.id;
    syncPanel();
    redraw();
    $("mText").focus();
    $("mText").select();
  });
  $("mDup").addEventListener("click", () => {
    const L = selected();
    if (!L) return;
    const copy = { ...L, id: nextId++, y: Math.min(1, L.y + 0.08) };
    state.layers.push(copy);
    state.selectedId = copy.id;
    syncPanel();
    redraw();
  });
  function removeSelected() {
    state.layers = state.layers.filter((l) => l.id !== state.selectedId);
    state.selectedId = state.layers.at(-1)?.id ?? null;
    syncPanel();
    redraw();
  }
  $("mDel").addEventListener("click", removeSelected);

  // --- export settings ---
  function refreshScaleOptions() {
    const m = state.media;
    const sel = $("mScale");
    const opts = [`<option value="auto">Auto (${m.width * autoScale()}px wide)</option>`];
    for (const s of [1, 2, 3, 4]) opts.push(`<option value="${s}">${s}× (${m.width * s}px wide)</option>`);
    sel.innerHTML = opts.join("");
    sel.value = state.scale;
    $("mFrames").hidden = !m.animated;
    $("mFrom").max = $("mTo").max = m.frames.length;
    syncPanel();
  }
  $("mScale").addEventListener("change", (e) => {
    state.scale = e.target.value;
    sizeCanvas();
    redraw();
  });
  $("mBg").addEventListener("change", (e) => {
    state.background = e.target.value;
    redraw();
  });
  $("mPixel").addEventListener("change", (e) => {
    state.pixelated = e.target.checked;
    sizeCanvas();
    redraw();
  });

  function updateBulkLabel() {
    const n = dataset.rows.length;
    $("mBulk").textContent = n ? `Download all (${n} rows)` : "Download all";
    $("mBulk").disabled = !n;
    $("mFileName").placeholder = dataset.columns.length ? `meme-{${dataset.columns[0]}}` : "meme";
  }
  onDataChange(() => {
    updateBulkLabel();
    redraw();
  });
  updateBulkLabel();

  // --- export ---
  const work = document.createElement("canvas");
  const wctx = work.getContext("2d", { willReadFrequently: true });

  async function renderRow(row) {
    const m = state.media;
    const s = exportScale();
    const W = (work.width = m.width * s);
    const H = (work.height = m.height * s);
    const opts = sceneOpts();
    if (!m.animated) {
      drawScene(wctx, m, 0, state.layers, row, W, H, opts);
      return { blob: await new Promise((r) => work.toBlob(r, "image/png")), ext: "png" };
    }
    const frames = [];
    for (let i = 0; i < m.frames.length; i++) {
      drawScene(wctx, m, i, state.layers, row, W, H, opts);
      frames.push({ buffer: wctx.getImageData(0, 0, W, H).data.buffer, delay: m.frames[i].delay });
    }
    const transparent = m.transparent && opts.background === "keep";
    const bytes = await getPool().encode({ width: W, height: H, frames, transparent }, frames.map((f) => f.buffer));
    return { blob: new Blob([bytes], { type: "image/gif" }), ext: "gif" };
  }

  function fileBase(row, i) {
    const tpl = $("mFileName").value.trim() || $("mFileName").placeholder;
    return safeFileName(fillTemplate(tpl.replace(/\{row\}/gi, String(i + 1)), row), `meme-${i + 1}`);
  }

  $("mOne").addEventListener("click", async () => {
    if (!state.media || progress.busy) return;
    const task = progress.start("Rendering meme", 1);
    try {
      await ensureFonts(state.layers);
      const row = currentRow();
      const { blob, ext } = await renderRow(row);
      task.step(1);
      downloadBlob(blob, `${fileBase(row, Math.max(0, dataset.previewIndex))}.${ext}`);
    } catch (err) {
      task.fail(err);
    } finally {
      task.done();
    }
  });

  $("mBulk").addEventListener("click", async () => {
    if (!state.media || progress.busy) return;
    const rows = bulkRows();
    const task = progress.start(`Rendering ${rows.length} memes`, rows.length);
    const zip = new JSZip();
    const nameFor = uniqueNamer();
    try {
      await ensureFonts(state.layers);
      const inflight = new Set();
      let done = 0;
      const limit = state.media.animated ? getPool().size : 4;
      for (let i = 0; i < rows.length; i++) {
        if (task.cancelled) break;
        const row = rows[i];
        const p = renderRow(row).then(({ blob, ext }) => {
          zip.file(nameFor(fileBase(row, i), ext), blob);
          task.step(++done);
        });
        inflight.add(p);
        p.finally(() => inflight.delete(p));
        if (inflight.size >= limit) await Promise.race(inflight);
        await new Promise((r) => setTimeout(r)); // keep the UI responsive
      }
      await Promise.all(inflight);
      if (!task.cancelled) downloadBlob(await zip.generateAsync({ type: "blob" }), "memes.zip");
    } catch (err) {
      task.fail(err);
    } finally {
      task.done();
    }
  });

  // --- init ---
  renderGallery(MEMES[0].src);
  syncPanel();
  ensureFonts(state.layers).then(redraw);
  document.fonts.addEventListener?.("loadingdone", redraw);
  selectMedia(MEMES[0].src, MEMES[0].label);
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
