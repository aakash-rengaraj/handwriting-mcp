// Realistic handwriting renderer. Text is laid out glyph by glyph with seeded
// jitter (tilt, baseline, size, spacing, line drift), inked onto generated
// paper, then finished as a clean page, a scan, or a phone photo on a desk.
// Pure canvas; the same seed always produces the same image.

export const PAGE_W = 450;
export const PAGE_H = 564;
const RULE = 20;

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRand(seed) {
  let a = seed >>> 0 || 1;
  const r = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Gaussian, clamped so a single outlier glyph never looks broken.
  r.g = () => {
    let u = 0;
    while (!u) u = r();
    const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
    return Math.max(-2.5, Math.min(2.5, n));
  };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  return r;
}

// Canvas + font access is injectable so the same renderer runs in the
// browser and in Node (the MCP server passes @napi-rs/canvas).
let env =
  typeof document !== "undefined"
    ? {
        createCanvas: (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h }),
        loadFont: (css) => document.fonts.load(css),
      }
    : null;

export function setRenderEnv(next) {
  env = next;
  tiles = null;
  measure = null;
}

function makeCanvas(w, h) {
  if (!env) throw new Error("No canvas environment: call setRenderEnv() first");
  return env.createCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

export function cropCanvas(src, r) {
  const sx = Math.round(r.x * src.width);
  const sy = Math.round(r.y * src.height);
  const sw = Math.max(1, Math.round(r.w * src.width));
  const sh = Math.max(1, Math.round(r.h * src.height));
  const out = makeCanvas(sw, sh);
  out.getContext("2d").drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

const fontStr = (size, family) => `${size}px "${family}", cursive`;

function rgba(hex, a) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return hex;
  let h = m[1];
  if (h.length === 3) h = h.replace(/./g, "$&$&");
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function geometry(margin) {
  return margin
    ? { left: 57, right: PAGE_W - 10, ruleStart: 52, firstBaseline: 72, bottom: PAGE_H - 10 }
    : { left: 16, right: PAGE_W - 14, ruleStart: 0, firstBaseline: 40, bottom: PAGE_H - 12 };
}

// --- shared noise tiles (fixed seeds, built once) --------------------------

let tiles = null;
function getTiles() {
  if (tiles) return tiles;
  const r = makeRand(1234567);
  const make = (size, fill) => {
    const c = makeCanvas(size, size);
    const x = c.getContext("2d");
    const img = x.createImageData(size, size);
    fill(img.data, r);
    x.putImageData(img, 0, 0);
    return c;
  };
  tiles = {
    // Specks knocked out of the ink: ballpoint skips.
    inkGrain: make(128, (d, r) => {
      for (let i = 0; i < d.length; i += 4) d[i + 3] = r() < 0.3 ? r() * 150 : 0;
    }),
    // Paper fibre tone, used with multiply.
    fibre: make(192, (d, r) => {
      for (let i = 0; i < d.length; i += 4) {
        const v = 255 - r() * 16 - (r() < 0.02 ? 22 : 0);
        d[i] = v;
        d[i + 1] = v - 1;
        d[i + 2] = v - 4;
        d[i + 3] = 255;
      }
    }),
    // Camera sensor noise, mid-grey, used with overlay.
    sensor: make(160, (d, r) => {
      for (let i = 0; i < d.length; i += 4) {
        const v = 128 + r.g() * 26;
        d[i] = v + r.g() * 4;
        d[i + 1] = v;
        d[i + 2] = v + r.g() * 4;
        d[i + 3] = 255;
      }
    }),
  };
  return tiles;
}

function fillPattern(ctx, tile, op, alpha) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = op;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = ctx.createPattern(tile, "repeat");
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

// --- layout -----------------------------------------------------------------

let measure = null;

function layout(text, o, g, r) {
  const R = o.realism;
  measure ||= makeCanvas(1, 1).getContext("2d");
  measure.font = fontStr(o.size, o.font);
  const widths = new Map();
  const w = (ch) => {
    if (!widths.has(ch)) widths.set(ch, measure.measureText(ch).width);
    return widths.get(ch);
  };
  const spaceW = w(" ") || o.size * 0.25;
  const maxW = g.right - g.left;

  const splitLong = (s) => {
    const out = [];
    let chunk = "";
    for (const ch of s) {
      if (chunk && measure.measureText(chunk + ch).width > maxW * 0.97) {
        out.push(chunk);
        chunk = ch;
      } else chunk += ch;
    }
    if (chunk) out.push(chunk);
    return out;
  };

  const makeWord = (str) => {
    const glyphs = [];
    let x = 0;
    for (const ch of str) {
      glyphs.push({
        ch,
        x,
        rot: r.g() * 0.035 * R, // ~2° at full realism
        dy: r.g() * 0.8 * R,
        sx: 1 + r.g() * 0.035 * R,
        sy: 1 + r.g() * 0.05 * R,
      });
      const adv = w(ch) * (1 + r.g() * 0.03 * R) + r.g() * 0.45 * R;
      x += Math.max(adv, w(ch) * 0.7);
    }
    return { glyphs, width: x, alpha: 1 - r() * 0.2 * R, heavy: r() < 0.22 * R };
  };

  const lines = [];
  let cur = { words: [], width: 0 };
  const pushLine = () => {
    lines.push(cur);
    cur = { words: [], width: 0 };
  };

  for (const para of text.split("\n")) {
    const raw = para.split(/[ \t]+/).filter(Boolean);
    if (!raw.length) {
      pushLine();
      continue;
    }
    for (const token of raw) {
      for (const piece of measure.measureText(token).width > maxW * 0.95 ? splitLong(token) : [token]) {
        const word = makeWord(piece);
        let gap = cur.words.length ? spaceW * Math.max(0.45, 1 + r.g() * 0.25 * R) : 0;
        if (cur.words.length && cur.width + gap + word.width > maxW) {
          pushLine();
          gap = 0;
        }
        word.x = cur.width + gap;
        cur.words.push(word);
        cur.width = word.x + word.width;
      }
    }
    pushLine();
  }
  return lines;
}

// --- paper --------------------------------------------------------------------

function drawPaper(o, g, r, S) {
  const W = PAGE_W * S;
  const H = PAGE_H * S;
  const c = makeCanvas(W, H);
  const p = c.getContext("2d");
  const R = o.realism;

  // Base tone: white at realism 0, warm off-white as it rises.
  const warm = R * r.range(0.45, 1);
  p.fillStyle = `rgb(${255 - 8 * warm},${255 - 11 * warm},${255 - 24 * warm})`;
  p.fillRect(0, 0, W, H);

  if (R > 0) {
    // Uneven tone: large soft blotches, a few darker, a few lighter.
    for (let i = 0; i < 7; i++) {
      const cx = r() * W;
      const cy = r() * H;
      const rad = r.range(0.25, 0.6) * W;
      const dark = r() < 0.6;
      const gr = p.createRadialGradient(cx, cy, 0, cx, cy, rad);
      gr.addColorStop(0, dark ? `rgba(150,120,70,${0.06 * R})` : `rgba(255,255,255,${0.4 * R})`);
      gr.addColorStop(1, dark ? "rgba(150,120,70,0)" : "rgba(255,255,255,0)");
      p.fillStyle = gr;
      p.fillRect(0, 0, W, H);
    }
    fillPattern(p, getTiles().fibre, "multiply", 0.7 * R);
  }

  p.setTransform(S, 0, 0, S, 0, 0);
  const wobbleLine = (x1, y1, x2, y2, step) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.max(1, Math.round(len / step));
    let off = r.g() * 0.3 * R;
    p.beginPath();
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const nx = -(y2 - y1) / len;
      const ny = (x2 - x1) / len;
      const x = x1 + (x2 - x1) * t + nx * off;
      const y = y1 + (y2 - y1) * t + ny * off;
      i ? p.lineTo(x, y) : p.moveTo(x, y);
      off += r.g() * 0.12 * R;
    }
    p.stroke();
  };

  if (o.lines) {
    for (let y = g.ruleStart + RULE; y <= PAGE_H - 2; y += RULE) {
      p.strokeStyle = `rgba(105,138,185,${0.55 + r.g() * 0.07 * R})`;
      p.lineWidth = 0.8 + r() * 0.25 * R;
      wobbleLine(0, y, PAGE_W, y, 30);
    }
  }
  if (o.margin) {
    p.strokeStyle = "rgba(226,96,116,0.75)";
    p.lineWidth = 1.5;
    wobbleLine(0, 51, PAGE_W, 51, 40);
    wobbleLine(49, 0, 49, PAGE_H, 40);
  }

  // Occasional fold crease.
  if (R > 0.25 && r() < 0.45) {
    const y = r.range(0.3, 0.7) * PAGE_H;
    const tilt = r.g() * 18;
    p.lineWidth = 0.7;
    p.strokeStyle = `rgba(0,0,0,${0.07 * R})`;
    wobbleLine(0, y, PAGE_W, y + tilt, 50);
    p.lineWidth = 1;
    p.strokeStyle = `rgba(255,255,255,${0.6 * R})`;
    wobbleLine(0, y + 0.9, PAGE_W, y + tilt + 0.9, 50);
  }
  return c;
}

// --- ink ----------------------------------------------------------------------

function drawInk(lines, o, g, r, S) {
  const c = makeCanvas(PAGE_W * S, PAGE_H * S);
  const x = c.getContext("2d");
  const R = o.realism;
  x.setTransform(S, 0, 0, S, 0, 0);
  x.font = fontStr(o.size, o.font);
  x.fillStyle = o.ink;
  x.textBaseline = "alphabetic";
  if (R > 0) {
    // Slight bleed into the paper.
    x.shadowColor = rgba(o.ink, 0.5);
    x.shadowBlur = 0.8 * S * R;
  }

  let drift = r.g() * 1.2 * R;
  lines.forEach((line, i) => {
    const rule = g.firstBaseline + i * RULE;
    drift = drift * 0.7 + r.g() * 1.4 * R; // left edge wanders, but stays near the margin
    const slope = r.g() * 0.006 * R; // ~0.35° line tilt
    const lift = -2.5 + r.g() * 0.9 * R; // sits just above the rule
    const amp = 0.8 * R;
    const freq = r.range(0.015, 0.035);
    const phase = r() * Math.PI * 2;
    const linePressure = 1 - r() * 0.08 * R;
    const x0 = g.left + drift;

    for (const word of line.words) {
      for (const gl of word.glyphs) {
        const gx = x0 + word.x + gl.x;
        const t = (gx - g.left) / (g.right - g.left);
        const gy = rule + lift + gl.dy + (gx - g.left) * slope + amp * Math.sin(gx * freq + phase);
        const alpha = word.alpha * linePressure * (1 - 0.07 * R * t);
        x.save();
        x.translate(gx, gy);
        x.rotate(gl.rot);
        x.scale(gl.sx, gl.sy);
        x.globalAlpha = alpha;
        x.fillText(gl.ch, 0, 0);
        if (word.heavy) {
          // More pen pressure: a faint second pass thickens the stroke.
          x.globalAlpha = alpha * 0.45;
          x.fillText(gl.ch, 0.35, 0.15);
        }
        x.restore();
      }
    }
  });

  if (R > 0) {
    x.shadowBlur = 0;
    fillPattern(x, getTiles().inkGrain, "destination-out", 0.5 * R);
  }
  return c;
}

// --- finishes -----------------------------------------------------------------

function contrast(canvas, amount) {
  const ctx = canvas.getContext("2d");
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const c = amount * 255;
  const f = (c + 255) / (255.01 - c);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = f * (d[i] - 128) + 128;
    d[i + 1] = f * (d[i + 1] - 128) + 128;
    d[i + 2] = f * (d[i + 2] - 128) + 128;
  }
  ctx.putImageData(img, 0, 0);
}

// Soft camera blur that works in every browser: down-sample, then back up.
function soften(canvas, factor) {
  if (factor >= 0.99) return;
  const t = makeCanvas(canvas.width * factor, canvas.height * factor);
  const tc = t.getContext("2d");
  tc.imageSmoothingQuality = "high";
  tc.drawImage(canvas, 0, 0, t.width, t.height);
  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(t, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function linearShade(ctx, W, H, angle, from, to, op) {
  const cx = W / 2;
  const cy = H / 2;
  const dx = (Math.cos(angle) * Math.hypot(W, H)) / 2;
  const dy = (Math.sin(angle) * Math.hypot(W, H)) / 2;
  const gr = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  gr.addColorStop(0, from);
  gr.addColorStop(1, to);
  ctx.save();
  ctx.globalCompositeOperation = op;
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function finishShadow(page, o, r) {
  const x = page.getContext("2d");
  linearShade(x, page.width, page.height, r() * Math.PI * 2, "rgba(0,0,0,0.3)", "rgba(0,0,0,0)", "multiply");
  return page;
}

function finishScan(page, o, r) {
  const R = o.realism;
  const W = page.width;
  const H = page.height;
  const out = makeCanvas(W, H);
  const x = out.getContext("2d");
  x.fillStyle = "#fbfbf9";
  x.fillRect(0, 0, W, H);
  x.translate(W / 2, H / 2);
  x.rotate(r.g() * 0.008 * R);
  x.scale(0.985, 0.985);
  x.drawImage(page, -W / 2, -H / 2);
  x.setTransform(1, 0, 0, 1, 0, 0);
  // Scanner lid shadow along one edge.
  const edge = Math.floor(r() * 4);
  const depth = 0.05;
  const gr =
    edge === 0 ? x.createLinearGradient(0, 0, W * depth, 0)
    : edge === 1 ? x.createLinearGradient(W, 0, W * (1 - depth), 0)
    : edge === 2 ? x.createLinearGradient(0, 0, 0, H * depth)
    : x.createLinearGradient(0, H, 0, H * (1 - depth));
  gr.addColorStop(0, `rgba(0,0,0,${0.22 * R})`);
  gr.addColorStop(1, "rgba(0,0,0,0)");
  x.globalCompositeOperation = "multiply";
  x.fillStyle = gr;
  x.fillRect(0, 0, W, H);
  x.globalCompositeOperation = "source-over";
  contrast(out, 0.1 + 0.15 * R);
  fillPattern(x, getTiles().sensor, "overlay", 0.18 * R);
  return out;
}

function drawSurface(x, W, H, kind, r, S) {
  if (kind === "slate") {
    x.fillStyle = "#2a2c2f";
    x.fillRect(0, 0, W, H);
    for (let i = 0; i < 6; i++) {
      const cx = r() * W;
      const cy = r() * H;
      const rad = r.range(0.2, 0.5) * W;
      const gr = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
      gr.addColorStop(0, "rgba(255,255,255,0.05)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = gr;
      x.fillRect(0, 0, W, H);
    }
    fillPattern(x, getTiles().sensor, "overlay", 0.5);
    return;
  }
  if (kind === "linen") {
    x.fillStyle = "#e8e2d6";
    x.fillRect(0, 0, W, H);
    x.lineWidth = 1;
    for (let y = 0; y < H; y += 2.5 * S) {
      x.strokeStyle = `rgba(120,100,70,${0.04 + r() * 0.05})`;
      x.beginPath();
      x.moveTo(0, y + r.g());
      x.lineTo(W, y + r.g());
      x.stroke();
    }
    for (let xx = 0; xx < W; xx += 2.5 * S) {
      x.strokeStyle = `rgba(255,255,255,${0.05 + r() * 0.06})`;
      x.beginPath();
      x.moveTo(xx + r.g(), 0);
      x.lineTo(xx + r.g(), H);
      x.stroke();
    }
    fillPattern(x, getTiles().sensor, "overlay", 0.25);
    return;
  }
  // Wood: warm base, wavy grain lines, a couple of plank seams.
  const hue = r.range(22, 32);
  const light = r.range(34, 44);
  x.fillStyle = `hsl(${hue},45%,${light}%)`;
  x.fillRect(0, 0, W, H);
  x.lineWidth = 1.3 * S;
  const band = r.range(0.012, 0.025) / S;
  for (let y = -20 * S; y < H + 20 * S; y += 2 * S) {
    const l = light + Math.sin(y * band + Math.sin(y * band * 0.37) * 2) * 6 + r.g() * 2.5;
    x.strokeStyle = `hsla(${hue},50%,${l}%,0.4)`;
    x.beginPath();
    let yy = y;
    x.moveTo(0, yy);
    for (let xx = 0; xx <= W + 40 * S; xx += 40 * S) {
      yy += r.g() * 0.7 * S;
      x.lineTo(xx, yy);
    }
    x.stroke();
  }
  const planks = 2 + Math.floor(r() * 2);
  x.lineWidth = 2 * S;
  x.strokeStyle = `hsla(${hue},40%,14%,0.55)`;
  for (let i = 1; i <= planks; i++) {
    const y = (i - r.range(0.2, 0.8)) * (H / planks);
    x.beginPath();
    x.moveTo(0, y);
    x.lineTo(W, y + r.g() * 3 * S);
    x.stroke();
  }
  fillPattern(x, getTiles().sensor, "overlay", 0.35);
}

// Square→quad homography (Heckbert), used to lay the page in perspective.
function squareToQuad([x0, y0], [x1, y1], [x2, y2], [x3, y3]) {
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  let g = 0;
  let h = 0;
  if (sx || sy) {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / den;
    h = (dx1 * sy - sx * dy1) / den;
  }
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + h * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + h * y3;
  return (u, v) => {
    const w = g * u + h * v + 1;
    return [(a * u + b * v + x0) / w, (d * u + e * v + y0) / w];
  };
}

function drawTriangle(ctx, img, s, d) {
  const [[x0, y0], [x1, y1], [x2, y2]] = s;
  const [[u0, v0], [u1, v1], [u2, v2]] = d;
  const den = (x0 - x2) * (y1 - y2) - (x1 - x2) * (y0 - y2);
  if (!den) return;
  const a = ((u0 - u2) * (y1 - y2) - (u1 - u2) * (y0 - y2)) / den;
  const c = ((u1 - u2) * (x0 - x2) - (u0 - u2) * (x1 - x2)) / den;
  const b = ((v0 - v2) * (y1 - y2) - (v1 - v2) * (y0 - y2)) / den;
  const dd = ((v1 - v2) * (x0 - x2) - (v0 - v2) * (x1 - x2)) / den;
  const e = u2 - a * x2 - c * y2;
  const f = v2 - b * x2 - dd * y2;
  // Grow the clip slightly so neighbouring triangles overlap (no seams).
  const cx = (u0 + u1 + u2) / 3;
  const cy = (v0 + v1 + v2) / 3;
  const grow = ([u, v]) => {
    const len = Math.hypot(u - cx, v - cy) || 1;
    return [u + ((u - cx) / len) * 0.8, v + ((v - cy) / len) * 0.8];
  };
  const [p0, p1, p2] = d.map(grow);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]);
  ctx.lineTo(p1[0], p1[1]);
  ctx.lineTo(p2[0], p2[1]);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(a, b, c, dd, e, f);
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)) - 2);
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)) - 2);
  const maxX = Math.min(img.width, Math.ceil(Math.max(x0, x1, x2)) + 2);
  const maxY = Math.min(img.height, Math.ceil(Math.max(y0, y1, y2)) + 2);
  ctx.drawImage(img, minX, minY, maxX - minX, maxY - minY, minX, minY, maxX - minX, maxY - minY);
  ctx.restore();
}

function warpImage(ctx, img, quad, n = 12) {
  const map = squareToQuad(...quad);
  const W = img.width;
  const H = img.height;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u0 = i / n;
      const u1 = (i + 1) / n;
      const v0 = j / n;
      const v1 = (j + 1) / n;
      const s00 = [u0 * W, v0 * H];
      const s10 = [u1 * W, v0 * H];
      const s11 = [u1 * W, v1 * H];
      const s01 = [u0 * W, v1 * H];
      const d00 = map(u0, v0);
      const d10 = map(u1, v0);
      const d11 = map(u1, v1);
      const d01 = map(u0, v1);
      drawTriangle(ctx, img, [s00, s10, s11], [d00, d10, d11]);
      drawTriangle(ctx, img, [s00, s11, s01], [d00, d11, d01]);
    }
  }
}

function finishPhoto(page, o, r, S) {
  const R = o.realism;
  const W = page.width;
  const H = page.height;
  const FW = Math.round(W * 1.26);
  const FH = Math.round(H * 1.2);
  const out = makeCanvas(FW, FH);
  const x = out.getContext("2d");
  drawSurface(x, FW, FH, o.surface, r, S);

  // Page corners: centred, then tilted, keystoned and nudged per corner.
  const rot = r.g() * 0.035 * R;
  const key = r.range(0, 0.05) * R * W; // top edge slightly narrower
  const jit = () => r.g() * 0.015 * W * R;
  const base = [
    [-W / 2 + key / 2, -H / 2],
    [W / 2 - key / 2, -H / 2],
    [W / 2, H / 2],
    [-W / 2, H / 2],
  ];
  const cx = FW / 2;
  const cy = FH / 2 + FH * 0.01;
  const quad = base.map(([px, py]) => {
    const jx = px + jit();
    const jy = py + jit();
    return [cx + jx * Math.cos(rot) - jy * Math.sin(rot), cy + jx * Math.sin(rot) + jy * Math.cos(rot)];
  });

  // Contact shadow under the sheet.
  x.save();
  x.shadowColor = "rgba(0,0,0,0.45)";
  x.shadowBlur = 22 * S;
  x.shadowOffsetX = 4 * S;
  x.shadowOffsetY = 9 * S;
  x.fillStyle = "#cfcac0";
  x.beginPath();
  quad.forEach(([qx, qy], i) => (i ? x.lineTo(qx, qy) : x.moveTo(qx, qy)));
  x.closePath();
  x.fill();
  x.restore();

  warpImage(x, page, quad);

  if (R > 0) {
    // Warm indoor white balance.
    x.save();
    x.globalCompositeOperation = "multiply";
    x.globalAlpha = R;
    x.fillStyle = "rgb(255,246,232)";
    x.fillRect(0, 0, FW, FH);
    x.restore();
    // Light falling across the scene, brighter on one side.
    const ang = r() * Math.PI * 2;
    linearShade(x, FW, FH, ang, "rgba(0,0,0,0)", `rgba(0,0,0,${0.3 * R})`, "multiply");
    const hx = Math.cos(ang + Math.PI) * FW * 0.45 + FW / 2;
    const hy = Math.sin(ang + Math.PI) * FH * 0.45 + FH / 2;
    const hi = x.createRadialGradient(hx, hy, 0, hx, hy, FW * 0.75);
    hi.addColorStop(0, `rgba(255,248,235,${0.3 * R})`);
    hi.addColorStop(1, "rgba(255,248,235,0)");
    x.save();
    x.globalCompositeOperation = "screen";
    x.fillStyle = hi;
    x.fillRect(0, 0, FW, FH);
    x.restore();
    // Sometimes a soft shadow from the phone / hand taking the picture.
    if (r() < 0.5) {
      const sx = r() < 0.5 ? r.range(-0.1, 0.15) * FW : r.range(0.85, 1.1) * FW;
      const sy = r.range(0.6, 1.1) * FH;
      const sh = x.createRadialGradient(sx, sy, 0, sx, sy, FW * r.range(0.35, 0.55));
      sh.addColorStop(0, `rgba(0,0,0,${0.28 * R})`);
      sh.addColorStop(1, "rgba(0,0,0,0)");
      x.save();
      x.globalCompositeOperation = "multiply";
      x.fillStyle = sh;
      x.fillRect(0, 0, FW, FH);
      x.restore();
    }
    // Lens vignette.
    const vg = x.createRadialGradient(FW / 2, FH / 2, Math.min(FW, FH) * 0.35, FW / 2, FH / 2, Math.hypot(FW, FH) * 0.6);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, `rgba(0,0,0,${0.35 * R})`);
    x.save();
    x.globalCompositeOperation = "multiply";
    x.fillStyle = vg;
    x.fillRect(0, 0, FW, FH);
    x.restore();

    soften(out, 1 - 0.18 * R);
    fillPattern(x, getTiles().sensor, "overlay", 0.3 * R);
  }
  return out;
}

// --- entry point --------------------------------------------------------------

/**
 * Render text as one or more handwritten pages.
 * @returns {Promise<HTMLCanvasElement[]>}
 */
export async function renderNote(text, opts) {
  const o = { realism: 0.7, finish: "photo", surface: "wood", scale: 2, seed: 1, lines: true, margin: true, ...opts };
  await env?.loadFont(fontStr(o.size, o.font), o.font);
  const S = o.scale;
  const g = geometry(o.margin);
  const lines = layout(text.replace(/\s+$/, ""), o, g, makeRand(o.seed));
  const perPage = Math.floor((g.bottom - g.firstBaseline) / RULE) + 1;

  const pages = [];
  let i = 0;
  while (i < lines.length) {
    if (pages.length) while (i < lines.length && !lines[i].words.length) i++; // no blank tops
    if (i >= lines.length) break;
    pages.push(lines.slice(i, i + perPage));
    i += perPage;
  }
  if (!pages.length) pages.push([]);

  return pages.map((pageLines, n) => {
    const r = makeRand((o.seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0);
    const page = drawPaper(o, g, r, S);
    const ink = drawInk(pageLines, o, g, r, S);
    const pc = page.getContext("2d");
    pc.setTransform(1, 0, 0, 1, 0, 0);
    pc.globalCompositeOperation = "multiply";
    pc.drawImage(ink, 0, 0);
    pc.globalCompositeOperation = "source-over";
    if (o.finish === "photo") return finishPhoto(page, o, r, S);
    if (o.finish === "scan") return finishScan(page, o, r);
    if (o.finish === "shadow") return finishShadow(page, o, r);
    return page;
  });
}
