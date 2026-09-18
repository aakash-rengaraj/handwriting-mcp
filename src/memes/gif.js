// Decode GIF / static images into fully composited frames (ImageBitmaps).
import { parseGIF, decompressFrames } from "gifuct-js";

const MIN_DELAY = 20; // browsers clamp faster delays to ~100ms

export async function loadMedia(src) {
  const blob = src instanceof Blob ? src : await (await fetch(src)).blob();
  const buf = await blob.arrayBuffer();
  const head = new Uint8Array(buf, 0, 4);
  const isGif = head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46;
  if (isGif) {
    try {
      return await decodeGif(buf);
    } catch (e) {
      console.warn("GIF decode failed, falling back to first frame", e);
    }
  }
  const bmp = await createImageBitmap(blob);
  return { width: bmp.width, height: bmp.height, frames: [{ bitmap: bmp, delay: 0 }], animated: false, transparent: false };
}

async function decodeGif(buf) {
  const gif = parseGIF(buf);
  const raw = decompressFrames(gif, true);
  const width = gif.lsd.width;
  const height = gif.lsd.height;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const patchCanvas = document.createElement("canvas");
  const patchCtx = patchCanvas.getContext("2d");

  const frames = [];
  let transparent = false;
  let prev = null;
  let restore = null;

  for (const f of raw) {
    if (prev) {
      if (prev.disposalType === 2) ctx.clearRect(prev.dims.left, prev.dims.top, prev.dims.width, prev.dims.height);
      else if (prev.disposalType === 3 && restore) ctx.putImageData(restore, 0, 0);
    }
    restore = f.disposalType === 3 ? ctx.getImageData(0, 0, width, height) : null;

    const { width: pw, height: ph, left, top } = f.dims;
    if (pw > 0 && ph > 0) {
      patchCanvas.width = pw;
      patchCanvas.height = ph;
      patchCtx.putImageData(new ImageData(f.patch, pw, ph), 0, 0);
      ctx.drawImage(patchCanvas, left, top);
    }

    const full = ctx.getImageData(0, 0, width, height);
    if (!transparent) {
      const d = full.data;
      for (let i = 3; i < d.length; i += 16) if (d[i] < 128) { transparent = true; break; }
    }
    frames.push({ bitmap: await createImageBitmap(full), delay: f.delay >= MIN_DELAY ? f.delay : 100 });
    prev = f;
  }
  if (!frames.length) throw new Error("GIF has no frames");
  return { width, height, frames, animated: frames.length > 1, transparent };
}
