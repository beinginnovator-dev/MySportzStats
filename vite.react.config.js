import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(__dirname, "react-app"),
  base: "/react/",
  build: {
    outDir: resolve(__dirname, "public/react"),
    emptyOutDir: true,
    sourcemap: true
  },
  server: { host: "0.0.0.0", port: 5173 }
});