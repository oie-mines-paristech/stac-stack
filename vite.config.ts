import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const codecDir = path.resolve(rootDir, "../jpegxl-zarr-codec");

export default defineConfig({
  // Relative asset URLs so the built app works under any mount path (/dist/, etc.).
  base: "./",
  server: {
    port: 5173,
    fs: {
      // Allow importing the sibling jpegxl-zarr-codec package (file:../jpegxl-zarr-codec).
      allow: [rootDir, codecDir],
      // Vite 6 treats `/?url=...` as a filesystem path unless strict mode is off.
      strict: false,
    },
  },
  assetsInclude: ["**/*.wasm"],
  optimizeDeps: {
    exclude: ["zarrita", "jpegxl-zarr"],
  },
});
