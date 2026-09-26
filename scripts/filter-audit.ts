// Filter audit: drives the real "For you" and "Search" screens in a browser the way a person does (typing, pressing
// Search, changing a filter without pressing Enter) and checks that what the screen says is applied really is.
// Run: VITE_DEV_AUTH=true npm run build -- --outDir dist-shots; npx tsx scripts/filter-audit.ts
process.env.DEV_AUTH_BYPASS = "true";
process.env.DISCOVERY_INTERVAL_MINUTES = "0";
import fs from "node:fs";
import path from "node:path";

const { createApp } = await import("../server/app.js");
const { setStore, FileStore, getStore } = await import("../server/db/store.js");
const { runDiscovery, setConnectors } = await import("../server/jobs/discovery.js");
const { matchCandidate } = await import("../server/matching/service.js");
const { storeResume, processResume } = await import("../server/resume/process.js");
const { updatePreferences, getOrCreateProfile } = await import("../server/profile/service.js");
const { RESUME_TEXT, rawJob, fakeConnector } = await import("../tests/fixtures.js");
const express = (await import("express")).default;
const puppeteer = (await import("puppeteer-core")).default;

setStore(new FileStore(path.resolve("data", "mc-filter-audit.json")));
const user = { uid: "demo", email: "priya.sharma@example.com", name: "Priya Sharma" };
await getOrCreateProfile(user);
const { resume } = await storeResume(user, { buffer: Buffer.from(RESUME_TEXT), originalname: "priya.txt", mimetype: "text/plain" });
await processResume(user, resume);
await updatePreferences("demo", { locations: ["Chennai"], workModes: ["hybrid", "remote"], minSalaryLPA: 10, noticePeriodDays: 30, targetRoles: ["Senior Project Manager"] });
const body = (t: string) => `${t} Agile, Scrum, JIRA, stakeholder management, risk management, budget management. 8+ years. ` + "Lead cross-functional teams and vendor management. ".repeat(5);
const CITIES = ["Chennai", "Bengaluru", "Mumbai", "Hyderabad", "Pune"];
const TITLES = ["Senior Project Manager", "Delivery Manager", "Program Manager", "Technical Program Manager"];
const raws = [] as any[];
let n = 0;
for (const city of CITIES) for (const title of TITLES) {
  n++;
  raws.push(rawJob({ sourceJobId: String(n), title, company: `Co${n}`, location: `${city}, India`, url: `https://x.example/${n}`, applyUrl: `https://x.example/${n}`, description: body(`${title} in ${city}.`) }));
}
raws.push(rawJob({ sourceJobId: "r1", title: "Remote Delivery Lead", company: "RemoteCo", location: "Remote, India", url: "https://x.example/r1", applyUrl: "https://x.example/r1", description: body("Fully remote. Work from anywhere in India.") }));
setConnectors([fakeConnector("demo", raws)]);
await runDiscovery();
await matchCandidate("demo", { notifyNew: false });

const dist = path.resolve(process.env.AUDIT_DIST || "dist-shots");
const app = createApp();
app.use(express.static(dist));
app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
const server = await new Promise<import("node:http").Server>((r) => { const s = app.listen(3197, () => r(s)); });
const edge = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"].find((p) => fs.existsSync(p))!;
const browser = await puppeteer.launch({ executablePath: edge, headless: true, args: ["--no-first-run", "--disable-gpu"] });
const problems: string[] = [];
let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; if (!cond) problems.push(msg); };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

for (const screen of ["matches", "search"] as const) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem("mc_analytics_consent", "denied"); localStorage.setItem("mc_tour_done", "1"); localStorage.setItem("mc_guide", JSON.stringify({ mode: "quiet", voice: false })); } catch { /* */ } });
  const reqs: string[] = [];
  page.on("request", (r) => { const u = r.url(); if (u.includes("/api/jobs") || u.includes("/api/matches")) { if (!/suggest|summary/.test(u)) reqs.push(decodeURIComponent(u.split("/api")[1])); } });
  const fresh = async () => { await page.goto("about:blank"); await page.goto(`http://localhost:3197/?dev=demo&notour&theme=dark#${screen}`, { waitUntil: "networkidle0", timeout: 60000 }); await wait(700); await page.evaluate(() => { for (const b of document.querySelectorAll<HTMLButtonElement>("button[aria-label^=\"Remove \"]")) b.click(); }); await wait(700); };
  const cards = () => page.evaluate(() => [...document.querySelectorAll("article[data-job-id]")].map((a) => ({ text: (a.textContent || "").replace(/\s+/g, " ") })));
  const settle = async () => { await wait(900); await page.waitForNetworkIdle({ idleTime: 400, timeout: 15000 }).catch(() => undefined); await wait(300); };
  const tag = `[${screen}]`;

  // 1. City typed, then Search pressed (no Enter): only that city, plus remote / Pan-India by default.
  await fresh();
  const total = (await cards()).length;
  ok(total > 0, `${tag} no jobs at all to test with`);
  await page.type('input[aria-label="City"]', "Bengaluru");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Search")?.click());
  await settle();
  let list = await cards();
  ok(list.length > 0, `${tag} city Bengaluru typed then Search: nothing came back`);
  ok(list.every((c) => /Bengaluru|Remote|Pan-India|Anywhere/i.test(c.text)), `${tag} city Bengaluru typed then Search: other cities shown: ${list.filter((c) => !/Bengaluru|Remote|Pan-India|Anywhere/i.test(c.text)).slice(0, 2).map((c) => c.text.slice(0, 60)).join(" | ")}`);
  ok(await page.evaluate(() => [...document.querySelectorAll("span")].some((s) => s.textContent?.trim().startsWith("Bengaluru"))), `${tag} no Bengaluru chip after Search`);

  // 2. Strict: untick "Include remote & Pan-India": only Bengaluru.
  await page.evaluate(() => (document.querySelector('label input[type="checkbox"]') as HTMLInputElement)?.click());
  await settle();
  list = await cards();
  ok(list.length > 0 && list.every((c) => /Bengaluru/i.test(c.text)), `${tag} strict city: results not all Bengaluru (${list.length})`);

  // 3. City typed and then leaving the box (blur) applies it too.
  await fresh();
  await page.type('input[aria-label="City"]', "Mumbai");
  await page.click("h1");
  await settle();
  list = await cards();
  ok(list.length > 0 && list.every((c) => /Mumbai|Remote|Pan-India|Anywhere/i.test(c.text)), `${tag} city Mumbai then click away: not applied`);

  // 4. Title typed but not submitted, then the sort changed: the typed title still applies.
  await fresh();
  await page.type('input[aria-label="Job title, skill or company"]', "Delivery Manager");
  await page.select('select[aria-label="Sort by"]', "newest");
  await settle();
  list = await cards();
  ok(list.length > 0 && reqs.some((r) => r.includes("sort=newest") && r.includes("q=Delivery")) && list.some((c) => /Delivery Manager/i.test(c.text)), `${tag} title typed then Sort changed: not applied (${list.length}, e.g. ${list[0]?.text.slice(0, 50)})`);

  // 5. Title + city together, then remove the city chip: the city goes away, the title stays.
  await page.type('input[aria-label="City"]', "Pune");
  await page.keyboard.press("Enter");
  await settle();
  list = await cards();
  ok(list.length > 0 && list.every((c) => /Pune|Remote|Pan-India|Anywhere/i.test(c.text)) && list.some((c) => /Delivery Manager/i.test(c.text)), `${tag} title + city: wrong results`);
  await page.click('button[aria-label="Remove Pune"]');
  await settle();
  list = await cards();
  ok(list.length > 1 && list.length < total + 1 && new Set(list.map((c) => /Chennai|Bengaluru|Mumbai|Hyderabad|Pune/.exec(c.text)?.[0])).size > 1, `${tag} after removing the city chip the other cities did not come back`);

  // 6. Filters panel: work mode + clear all.
  await fresh();
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith("Filters"))?.click());
  await wait(300);
  const chipLabels = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent?.trim() || ""));
  ok(chipLabels.some((t) => /^Remote$/.test(t)), `${tag} Filters panel has no Remote chip`);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Remote")?.click());
  await settle();
  list = await cards();
  ok(list.length > 0 && list.every((c) => /Remote|Anywhere/i.test(c.text)), `${tag} Remote chip: non-remote jobs shown (${list.length})`);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Clear all filters")?.click());
  await settle();
  list = await cards();
  ok(list.length > 1, `${tag} Clear all filters did not bring jobs back`);

  if (process.env.AUDIT_DEBUG) console.log(tag, reqs.join(" || "));
  await page.close();
}

await browser.close();
server.close();
try { fs.rmSync(path.resolve("data", "mc-filter-audit.json")); } catch { /* */ }
console.log(`${checks} checks, ${problems.length} problem(s)`);
for (const p of problems) console.log(" -", p);
process.exit(problems.length ? 1 : 0);
