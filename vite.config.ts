import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Production builds: use "npm run build" (scripts/build.mjs), which sets NODE_ENV=production before Vite starts.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@shared": path.resolve(__dirname, "shared") } },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000" },
    // Runtime data, build output and screenshots change constantly and must never trigger reloads (or crash the watcher on locked files).
    watch: { ignored: ["**/data/**", "**/dist/**", "**/dist-shots/**", "**/screenshots/**"] },
  },
  build: { outDir: "dist" },
});
