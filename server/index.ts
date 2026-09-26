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
  // Open the port first: hosts (Render) wait for it, and restoring the data backup can take a while. Until the app is
  // ready, health checks get "starting" and everything else a friendly 503.
  const root = express();
  let ready = false;
  root.get("/api/health", (req, res, next) => (ready ? next() : res.json({ status: "starting" })));
  root.use((req, res, next) => {
    if (ready) return next();
    if (req.path.startsWith("/api/")) return res.status(503).json({ error: "MyCareer.AI is starting up — please try again in a few seconds." });
    res.status(503).set("Retry-After", "10").type("html").send('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="8"><title>Starting…</title><body style="font-family:system-ui;display:grid;place-items:center;height:90vh;color:#0a2230"><div style="text-align:center"><p style="font-size:20px;font-weight:700">MyCareer.AI is starting up…</p><p>This page will refresh by itself.</p></div>');
  });
  const server = root.listen(config.port, () => console.log(`[server] listening on port ${config.port}, getting ready…`));

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
    // Bookmark target for "add this job" (never indexed); the app reads ?url= and moves to a normal address.
    app.get("/add-job", (_req, res) => res.set("X-Robots-Tag", "noindex").sendFile(path.join(dist, "index.html")));
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

  root.use(app);
  ready = true;
  console.log(`MyCareer.AI running on http://localhost:${config.port}  (store: ${store.kind}, public site: ${config.siteUrl})`);
  if (config.devAuthBypass) console.warn("WARNING: DEV_AUTH_BYPASS is on — never enable it in production.");
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
