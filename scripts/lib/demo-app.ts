// Shared by the browser audits: a demo user with a resume, matched jobs and one application, the app served from
// dist-shots, and a headless Edge. Call startDemo() once, then close().
import fs from "node:fs";
import path from "node:path";

export async function startDemo(opts: { port: number; admin?: boolean; file?: string }) {
  process.env.DEV_AUTH_BYPASS = "true";
  process.env.DISCOVERY_INTERVAL_MINUTES = "0";
  if (opts.admin) process.env.ADMIN_EMAILS = "demo@dev.local";
  const { createApp } = await import("../../server/app.js");
  const { setStore, FileStore, getStore } = await import("../../server/db/store.js");
  const { runDiscovery, setConnectors } = await import("../../server/jobs/discovery.js");
  const { matchCandidate } = await import("../../server/matching/service.js");
  const { storeResume, processResume } = await import("../../server/resume/process.js");
  const { updatePreferences, getOrCreateProfile } = await import("../../server/profile/service.js");
  const { prepareApplication, updateStatus } = await import("../../server/applications/service.js");
  const { approveResumeVersion } = await import("../../server/resume/tailor.js");
  const { setProviders } = await import("../../server/ai/gateway.js");
  const { RESUME_TEXT, rawJob, fakeConnector } = await import("../../tests/fixtures.js");
  const express = (await import("express")).default;
  const puppeteer = (await import("puppeteer-core")).default;

  const file = path.resolve("data", opts.file || `audit-${opts.port}.json`) // inside the project (data/ is git-ignored), never in the system temp folder;
  try { fs.rmSync(file); } catch { /* first run */ }
  setStore(new FileStore(file));
  setProviders([], async () => null); // no AI: the audits must be deterministic and must not spend anything
  const user = { uid: "demo", email: "priya.sharma@example.com", name: "Priya Sharma" };
  await getOrCreateProfile(user);
  const { resume } = await storeResume(user, { buffer: Buffer.from(RESUME_TEXT), originalname: "priya.txt", mimetype: "text/plain" });
  await processResume(user, resume);
  await updatePreferences("demo", { locations: ["Chennai"], workModes: ["hybrid", "remote"], minSalaryLPA: 10, noticePeriodDays: 30, targetRoles: ["Senior Project Manager"] });
  const body = (t: string) => `${t} Agile, Scrum, JIRA, stakeholder management, risk management, budget management. 8+ years. ` + "Lead cross-functional teams and vendor management. ".repeat(5);
  const raws = ["Chennai", "Bengaluru", "Mumbai", "Pune"].flatMap((city, i) => ["Senior Project Manager", "Delivery Manager", "Program Manager"].map((title, j) =>
    rawJob({ sourceJobId: `${i}${j}`, title, company: `Co${i}${j}`, location: `${city}, India`, url: `https://x.example/${i}${j}`, applyUrl: `https://x.example/${i}${j}`, description: body(`${title} in ${city}.`) })));
  setConnectors([fakeConnector("demo", raws)]);
  await runDiscovery();
  await matchCandidate("demo", { notifyNew: true });
  const jobs = await (await getStore()).query<any>("jobs");
  const pkg = await prepareApplication("demo", jobs[0].id);
  await approveResumeVersion("demo", pkg.resume!.id);
  await updateStatus("demo", pkg.application.id, "applied");

  const dist = path.resolve(process.env.AUDIT_DIST || "dist-shots");
  const app = createApp();
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  const server = await new Promise<import("node:http").Server>((r) => { const s = app.listen(opts.port, () => r(s)); });
  const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p))!;
  const browser = await puppeteer.launch({ executablePath: edge, headless: true, args: ["--no-first-run", "--disable-gpu"] });
  const base = `http://localhost:${opts.port}`;

  /** A new tab with first-run popups settled, script errors and failed API calls collected in `issues`. */
  async function tab(size = { width: 1280, height: 900 }) {
    const page = await browser.newPage();
    await page.setViewport(size);
    await page.evaluateOnNewDocument(() => { try { localStorage.setItem("mc_analytics_consent", "denied"); localStorage.setItem("mc_tour_done", "1"); localStorage.setItem("mc_guide", JSON.stringify({ mode: "quiet", voice: false })); } catch { /* */ } });
    const issues: string[] = [];
    page.on("pageerror", (e) => issues.push(`script error: ${String(e).slice(0, 160)}`));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon|net::ERR/.test(m.text())) issues.push(`console error: ${m.text().slice(0, 160)}`); });
    page.on("response", (r) => { const u = r.url(); if (u.includes("/api/") && r.status() >= 400 && !/\/(analytics|health)/.test(u)) issues.push(`${r.request().method()} ${u.split("/api")[1].slice(0, 70)} → ${r.status()}`); });
    const go = async (hash = "", forceTheme = true) => { await page.goto("about:blank"); await page.goto(`${base}/?dev=demo&notour${forceTheme ? "&theme=dark" : ""}#${hash}`, { waitUntil: "networkidle0", timeout: 60000 }); await new Promise((r) => setTimeout(r, 500)); };
    return { page, issues, go };
  }
  /** The API as the demo user, for checking what really got saved. */
  const api = async (p: string, init?: { method?: string; body?: unknown }) => {
    const r = await fetch(`${base}/api${p}`, { method: init?.method || (init?.body ? "POST" : "GET"), headers: { Authorization: "Bearer dev:demo", "Content-Type": "application/json" }, body: init?.body ? JSON.stringify(init.body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) as any };
  };
  return { browser, server, base, tab, api, jobs, close: async () => { await browser.close(); server.close(); try { fs.rmSync(file); } catch { /* already gone */ } } };
}

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Click the first element matching a CSS selector whose text matches (or that has this aria-label). */
export const clickText = (page: import("puppeteer-core").Page, selector: string, text: RegExp | string) =>
  page.evaluate((sel, src, isRe) => {
    const re = isRe ? new RegExp(src as string, "i") : null;
    const el = [...document.querySelectorAll<HTMLElement>(sel)].find((e) => { const t = (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " "); return re ? re.test(t) : t === src; });
    if (!el) return false; el.scrollIntoView({ block: "center" }); el.click(); return true;
  }, selector, typeof text === "string" ? text : text.source, typeof text !== "string");
