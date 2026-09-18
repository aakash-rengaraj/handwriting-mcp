import { defineConfig } from "vite";

// Static build: `dist/` can be hosted anywhere (no backend).
export default defineConfig({
  base: "./",
  worker: { format: "es" },
});
