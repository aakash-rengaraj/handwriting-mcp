// Quantize + encode GIF frames off the main thread.
import { GIFEncoder, quantize, applyPalette } from "gifenc";

self.onmessage = ({ data }) => {
  const { id, width, height, frames, transparent } = data;
  try {
    const enc = GIFEncoder();
    const format = transparent ? "rgba4444" : "rgb565";
    frames.forEach((f, i) => {
      const rgba = new Uint8ClampedArray(f.buffer);
      const palette = quantize(rgba, 256, { format, oneBitAlpha: transparent });
      const index = applyPalette(rgba, palette, format);
      const opts = { palette, delay: f.delay, repeat: 0, first: i === 0 };
      if (transparent) {
        const ti = palette.findIndex((c) => c[3] === 0);
        if (ti >= 0) Object.assign(opts, { transparent: true, transparentIndex: ti });
        opts.dispose = 2;
      }
      enc.writeFrame(index, width, height, opts);
    });
    enc.finish();
    const bytes = enc.bytes();
    self.postMessage({ id, bytes }, [bytes.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};
