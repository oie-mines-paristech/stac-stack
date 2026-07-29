import { defineConfig, type Plugin } from "vite";
import { upstreamUrlFromProxyPath } from "./src/proxy.js";

function zarrDevProxy(): Plugin {
  return {
    name: "zarr-dev-proxy",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const requestUrl = req.url ?? "";
        const target = upstreamUrlFromProxyPath(requestUrl);
        if (!target) return next();

        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Authorization, Range");
          res.end();
          return;
        }

        try {
          const headers = new Headers();
          const authorization = req.headers.authorization;
          if (authorization) headers.set("Authorization", authorization);
          const range = req.headers.range;
          if (range) headers.set("Range", range);

          const response = await fetch(target, {
            method: req.method === "HEAD" ? "HEAD" : "GET",
            headers,
          });

          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            const lower = key.toLowerCase();
            if (lower === "transfer-encoding" || lower === "connection") return;
            res.setHeader(key, value);
          });
          res.setHeader("Access-Control-Allow-Origin", "*");

          if (req.method === "HEAD") {
            res.end();
            return;
          }

          const body = Buffer.from(await response.arrayBuffer());
          res.end(body);
        } catch (error) {
          res.statusCode = 502;
          res.end(error instanceof Error ? error.message : String(error));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  // Relative asset URLs so the built app works under any mount path (/dist/, etc.).
  base: "./",
  plugins: [zarrDevProxy()],
  define:
    mode === "development" && !process.env.VITE_ZARR_PROXY
      ? { "import.meta.env.VITE_ZARR_PROXY": JSON.stringify("./proxy/") }
      : {},
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
}));
