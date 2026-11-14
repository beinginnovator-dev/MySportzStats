import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root: resolve(here, "react-app"),
  base: "/react/",
  build: {
    outDir: resolve(here, "public/react"),
    emptyOutDir: true,
    sourcemap: true
  },
  server: { host: "0.0.0.0", port: 5173 }
});