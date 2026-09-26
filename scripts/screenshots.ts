// Hosts the app in-process with demo data, then captures UI screenshots with headless Edge (foreground only).
process.env.DEV_AUTH_BYPASS = "true";
process.env.DISCOVERY_INTERVAL_MINUTES = "0";
process.env.ADMIN_EMAILS = "demo@dev.local";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const { createApp } = await import("../server/app.js");
const { setStore, FileStore, getStore } = await import("../server/db/store.js");
const { runDiscovery, setConnectors } = await import("../server/jobs/discovery.js");
const { matchCandidate } = await import("../server/matching/service.js");
const { storeResume, processResume } = await import("../server/resume/process.js");
const { updatePreferences, getOrCreateProfile } = await import("../server/profile/service.js");
const { RESUME_TEXT, rawJob, fakeConnector } = await import("../tests/fixtures.js");
const express = (await import("express")).default;
const path = await import("node:path");

setStore(new FileStore());
const user = { uid: "demo", email: "priya.sharma@example.com", name: "Priya Sharma" };
await getOrCreateProfile(user);
const { resume } = await storeResume(user, { buffer: Buffer.from(RESUME_TEXT), originalname: "priya.txt", mimetype: "text/plain" });
await processResume(user, resume);
await updatePreferences("demo", { locations: ["Chennai"], workModes: ["hybrid", "remote"], minSalaryLPA: 20, noticePeriodDays: 30 });
const jobs = [
  rawJob(),
  rawJob({ sourceJobId: "2", title: "Technical Program Manager", company: "Zeta", location: "Bengaluru, India", url: "https://x.example/2", applyUrl: "https://x.example/2", description: "Own delivery of payments programs across engineering teams. Agile, Scrum, JIRA, stakeholder management, risk management. 8+ years experience. Hybrid in Bengaluru. 30-40 LPA. " + "Lead cross-functional teams and vendor management. ".repeat(4) }),
  rawJob({ sourceJobId: "3", title: "Delivery Manager", company: "Freshworks", location: "Chennai, India", url: "https://x.example/3", applyUrl: "https://x.example/3", description: "Lead software delivery for enterprise customers in Chennai. Project management, budget management, MS Project, resource planning, Agile. 10+ years. " + "Manage stakeholders and vendors. ".repeat(6) }),
  rawJob({ connector: "workable", sourceJobId: "4", title: "Delivery Partner - Two Wheeler", company: "QuickShip Logistics", location: "Pune; Chennai; Hyderabad", url: "https://x.example/4", applyUrl: "https://x.example/4", description: "Deliver orders across the city on your two-wheeler. Earn ₹18,000 - ₹25,000 per month plus incentives. 10th pass is enough. Freshers welcome. Driving licence required. " + "Flexible shifts and weekly payouts. ".repeat(4) }),
  rawJob({ connector: "lever", sourceJobId: "5", title: "Customer Support Executive (Hindi)", company: "CallPro", location: "Pan India", url: "https://x.example/5", applyUrl: "https://x.example/5", description: "Inbound voice process in Hindi and English. 12th pass. Freshers welcome. Salary ₹15,000 - ₹19,000 per month. Rotational shifts. " + "Help customers resolve orders and payments. ".repeat(4) }),
  rawJob({ connector: "ashby", sourceJobId: "6", title: "Program Manager - Payments", company: "Zeta", location: "Chennai, India", url: "https://x.example/6", applyUrl: "https://x.example/6", description: "Lead payments programs. Agile, Scrum, JIRA, stakeholder and risk management, budget management. 8+ years. Hybrid in Chennai. 28-36 LPA. B.Tech or MBA. " + "Coordinate vendors and engineering teams. ".repeat(4) }),
];
setConnectors([fakeConnector("demo", jobs)]);
await runDiscovery();
await matchCandidate("demo", { notifyNew: true });

const app = createApp();
app.use(express.static(path.resolve("dist-shots")));
app.get("*", (_req, res) => res.sendFile(path.resolve("dist-shots/index.html")));
const server = await new Promise<import("node:http").Server>((r) => { const s = app.listen(3197, () => r(s)); });

const edge = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"].find((p) => fs.existsSync(p))!;
fs.mkdirSync("screenshots", { recursive: true });
const execFileAsync = (await import("node:util")).promisify((await import("node:child_process")).execFile);
void execFileSync;
const THEME = process.env.SHOT_THEME || "";
const ONLY = (process.env.SHOT_ONLY || "").split(",").filter(Boolean);
const shot = async (name: string, w: number, h: number, hash = "", query = "?dev=demo&notour") => {
  if (ONLY.length && !ONLY.some((o) => name.startsWith(o))) return;
  if (THEME) { query = (query ? query + "&" : "?") + "theme=" + THEME; name = name.replace(".png", "-" + THEME + ".png"); }
  try {
    await execFileAsync(edge, ["--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${path.join((await import("node:os")).tmpdir(), "mycareer-shots-edge")}`, `--window-size=${w},${h}`, "--virtual-time-budget=8000", `--screenshot=${path.resolve("screenshots", name)}`, `http://localhost:3197/${query}${hash}`], { timeout: 90000 });
  } catch (e: any) { /* Edge often logs non-fatal errors on exit; the file check below is the real test */ }
  console.log(fs.existsSync(path.resolve("screenshots", name)) ? `saved screenshots/${name}` : `FAILED ${name}`);
};
const firstJob = (await (await getStore()).query<any>("jobs")).find((j: any) => j.title === "Delivery Manager")!;
await shot("hero-desktop.png", 1440, 900, "", "");
await shot("hero-mobile.png", 430, 1100, "", "");
await shot("landing-desktop.png", 1440, 4200, "", "");
await shot("landing-mobile.png", 500, 2600, "", "");
await shot("home-desktop.png", 1440, 1100);
await shot("home-mobile.png", 500, 1300);
await shot("matches-desktop.png", 1440, 1500, "#matches");
await shot("matches-mobile.png", 500, 1400, "#matches");
await shot("search-desktop.png", 1440, 1300, "#search");
await shot("job-desktop.png", 1440, 1500, `#job/${firstJob.id}`);
await shot("profile-desktop.png", 1440, 1600, "#profile");
await shot("settings-desktop.png", 1440, 1100, "#settings");
await shot("applications-desktop.png", 1440, 900, "#applications");
await shot("admin-desktop.png", 1440, 1500, "#admin");
if (process.env.SHOT_ALL) {
  const pages = ['', '#matches', '#search', '#applications', '#interview', '#insights', '#resume', '#profile', '#settings', '#employer', '#job/' + firstJob.id];
  for (const [label, w, h] of [['m', 390, 1600], ['t', 820, 1400]] as const) for (const p of pages) await shot(`all-${label}-${(p.replace(/[#/]/g, "") || "home").slice(0, 12)}.png`, w, h, p);
}
server.close();
process.exit(0);
