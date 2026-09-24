import fs from "node:fs";
import path from "node:path";
import express from "express";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { flushBackups, getStore } from "./db/store.js";
import { startScheduler } from "./scheduler.js";
import { loadDiscoverySettings } from "./jobs/settings.js";
import { notFoundHtml } from "./seo/pages.js";
import { printConfigWarnings } from "./configCheck.js";

async function main() {
  const store = await getStore();
  const app = createApp();

  const dist = path.resolve("dist");
  if (config.isProd || fs.existsSync(path.join(dist, "index.html"))) {
    // Hashed build files never change: let browsers and CDNs keep them for a year.
    app.use("/assets", express.static(path.join(dist, "assets"), { immutable: true, maxAge: "365d", index: false }));
    app.use(express.static(dist, { index: false, maxAge: "1h" }));
    // The app lives at "/" (its screens are #routes). Any other unknown address is a real 404, not the app with a
    // 200 status — search engines treat those "soft 404s" as low-quality pages.
    app.get("/", (_req, res) => res.sendFile(path.join(dist, "index.html")));
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      notFoundHtml().then((html) => res.status(404).type("html").send(html)).catch(next);
    });
  } else {
    // Development: serve the React app through Vite so one command runs everything.
    const { createServer } = await import("vite");
    const vite = await createServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  }

  const server = app.listen(config.port, "0.0.0.0", () => {
    console.log(`MyCareer.AI running on http://localhost:${config.port}  (store: ${store.kind}, public site: ${config.siteUrl})`);
    if (config.devAuthBypass) console.warn("WARNING: DEV_AUTH_BYPASS is on — never enable it in production.");
  });
  printConfigWarnings();
  await loadDiscoverySettings();
  startScheduler();

  // Render (and most hosts) send SIGTERM before stopping or sleeping an instance: save backups first.
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[server] ${signal} received — saving data and shutting down`);
    server.close();
    const timeout = new Promise((r) => setTimeout(r, 25_000));
    await Promise.race([flushBackups().catch((e) => console.error("[server] final backup failed", e)), timeout]);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Fatal startup error", err);
  process.exit(1);
});
