// Crop overlay for a rendered canvas. Drag empty space to draw a region, drag
// inside it to move, drag handles to resize; arrow keys nudge. The rect is
// normalised (0..1) so one crop applies to every row at any export scale.
// `aspect` is width/height in output pixels, or null for free.

const MIN = 0.05;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export { cropCanvas } from "./render.js";

export function attachCropper(fig, canvas, { rect, aspect, onChange }) {
  const layer = document.createElement("div");
  layer.className = "crop-layer";
  // Only the dimming is clipped to the image; the outline and handles sit in
  // an unclipped layer so they stay grabbable when the crop touches an edge.
  const clip = document.createElement("div");
  clip.className = "crop-clip";
  const dim = document.createElement("div");
  dim.className = "crop-dim";
  clip.appendChild(dim);
  layer.appendChild(clip);
  const box = document.createElement("div");
  box.className = "crop-box";
  box.tabIndex = 0;
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", "Crop area. Drag to move, arrow keys nudge, Shift for bigger steps.");
  box.innerHTML = `<div class="crop-grid"></div>` + ["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((h) => `<span class="crop-h ${h}" data-h="${h}"></span>`).join("");
  layer.appendChild(box);
  fig.appendChild(layer);

  const ar = canvas.width / canvas.height; // image aspect in pixels
  let ratio = aspect || null;
  let r = rect ? { ...rect } : { x: 0, y: 0, w: 1, h: 1 };
  let drag = null;

  // Normalised height for a given normalised width at the locked ratio.
  const hFor = (w) => (w * ar) / ratio;
  const wFor = (h) => (h * ratio) / ar;

  function render() {
    for (const el of [box, dim]) {
      el.style.left = r.x * 100 + "%";
      el.style.top = r.y * 100 + "%";
      el.style.width = r.w * 100 + "%";
      el.style.height = r.h * 100 + "%";
    }
    box.classList.toggle("locked", !!ratio);
  }

  function commit() {
    render();
    onChange({ ...r });
  }

  // Rect grown from a fixed anchor towards point p, honouring bounds + ratio.
  function fromAnchor(ax, ay, px, py) {
    const sx = Math.sign(px - ax) || 1;
    const sy = Math.sign(py - ay) || 1;
    const maxW = sx > 0 ? 1 - ax : ax;
    const maxH = sy > 0 ? 1 - ay : ay;
    let w = Math.min(Math.abs(px - ax), maxW);
    let h = Math.min(Math.abs(py - ay), maxH);
    if (ratio) {
      h = hFor(w);
      if (h > maxH) {
        h = maxH;
        w = wFor(h);
      }
      if (w < MIN) {
        w = Math.min(MIN, maxW);
        h = Math.min(hFor(w), maxH);
      }
    } else {
      w = Math.max(w, Math.min(MIN, maxW));
      h = Math.max(h, Math.min(MIN, maxH));
    }
    return { x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - h, w, h };
  }

  function point(e) {
    const b = canvas.getBoundingClientRect();
    return { x: clamp((e.clientX - b.left) / b.width, 0, 1), y: clamp((e.clientY - b.top) / b.height, 0, 1) };
  }

  layer.addEventListener("pointerdown", (e) => {
    const p = point(e);
    const handle = e.target.dataset?.h;
    if (handle) drag = { mode: "resize", handle, start: { ...r } };
    else if (box.contains(e.target)) drag = { mode: "move", start: { ...r }, p0: p };
    else {
      drag = { mode: "draw", p0: p };
      r = { x: p.x, y: p.y, w: 0, h: 0 };
    }
    layer.setPointerCapture(e.pointerId);
    box.focus({ preventScroll: true });
    e.preventDefault();
  });

  layer.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = point(e);
    const s = drag.start;
    if (drag.mode === "move") {
      r.x = clamp(s.x + p.x - drag.p0.x, 0, 1 - s.w);
      r.y = clamp(s.y + p.y - drag.p0.y, 0, 1 - s.h);
    } else if (drag.mode === "draw") {
      r = fromAnchor(drag.p0.x, drag.p0.y, p.x, p.y);
    } else {
      const h = drag.handle;
      if (h.length === 2) {
        // Corner: the opposite corner stays put.
        const ax = h.includes("w") ? s.x + s.w : s.x;
        const ay = h.includes("n") ? s.y + s.h : s.y;
        r = fromAnchor(ax, ay, p.x, p.y);
      } else {
        // Edge (free ratio only).
        let left = s.x;
        let right = s.x + s.w;
        let top = s.y;
        let bottom = s.y + s.h;
        if (h === "w") left = Math.min(p.x, right - MIN);
        if (h === "e") right = Math.max(p.x, left + MIN);
        if (h === "n") top = Math.min(p.y, bottom - MIN);
        if (h === "s") bottom = Math.max(p.y, top + MIN);
        r = { x: left, y: top, w: right - left, h: bottom - top };
      }
    }
    render();
  });

  const end = () => {
    if (!drag) return;
    drag = null;
    commit();
  };
  layer.addEventListener("pointerup", end);
  layer.addEventListener("pointercancel", end);

  box.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    r.x = clamp(r.x + d[0], 0, 1 - r.w);
    r.y = clamp(r.y + d[1], 0, 1 - r.h);
    commit();
  });

  render();

  return {
    setAspect(next) {
      ratio = next || null;
      if (ratio) {
        // Largest region of the new ratio inside the current one, same centre.
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        let w = r.w;
        let h = hFor(w);
        if (h > r.h) {
          h = r.h;
          w = wFor(h);
        }
        r = { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h };
      }
      commit();
    },
    reset() {
      r = { x: 0, y: 0, w: 1, h: 1 };
      if (ratio) this.setAspect(ratio);
      else commit();
    },
  };
}
