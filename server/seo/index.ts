// Search-engine surface: robots.txt and sitemaps. Public, server-rendered job pages are added here too.
import { Router } from "express";
import { config } from "../config.js";
import { seoPages } from "./pages.js";

export const siteUrl = (path = "/") => new URL(path, config.siteUrl).toString();

const xmlEscape = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

export function urlset(entries: Array<{ loc: string; lastmod?: string; changefreq?: string; priority?: number }>): string {
  const rows = entries.map((e) =>
    `<url><loc>${xmlEscape(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod.slice(0, 10)}</lastmod>` : ""}${e.changefreq ? `<changefreq>${e.changefreq}</changefreq>` : ""}${e.priority !== undefined ? `<priority>${e.priority.toFixed(1)}</priority>` : ""}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`;
}

export function seoRouter(): Router {
  const r = Router();

  r.get("/robots.txt", (_req, res) => {
    res.type("text/plain").set("Cache-Control", "public, max-age=3600").send(
      [
        "User-agent: *",
        "Allow: /",
        // Private app data and the signed-in app's API are never for crawlers.
        "Disallow: /api/",
        "",
        `Sitemap: ${siteUrl("/sitemap.xml")}`,
        "",
      ].join("\n"),
    );
  });

  // Public job pages, city/role pages and the sitemaps.
  r.use(seoPages());

  return r;
}
