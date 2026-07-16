import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs so the built app works under any mount path (/dist/, etc.).
  base: "./",
  server: {
    port: 5173,
    fs: {
      // Vite 6 treats `/?url=...` as a filesystem path unless strict mode is off.
      strict: false,
    },
  },
  assetsInclude: ["**/*.wasm"],
  optimizeDeps: {
    exclude: ["zarrita", "@oie-minesparis-psl/jpegxl-zarr"],
  },
});
