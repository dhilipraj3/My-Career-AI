// UI audit: hosts the app with demo data, opens every screen in real phone / tablet / desktop emulation (Edge via
// puppeteer-core), saves screenshots, and reports layout problems: anything wider than the screen (horizontal
// scroll), text clipped by its box, buttons too small to tap, and overlapping fixed elements.
// Run: npx tsx scripts/ui-audit.ts   (SHOT_THEME=light for the light theme; AUDIT_ONLY=m,t,d to pick devices)
process.env.DEV_AUTH_BYPASS = "true";
process.env.DISCOVERY_INTERVAL_MINUTES = "0";
process.env.ADMIN_EMAILS = "demo@dev.local";
import fs from "node:fs";
import path from "node:path";

const { createApp } = await import("../server/app.js");
const { setStore, FileStore, getStore } = await import("../server/db/store.js");
const { runDiscovery, setConnectors } = await import("../server/jobs/discovery.js");
const { matchCandidate } = await import("../server/matching/service.js");
const { storeResume, processResume } = await import("../server/resume/process.js");
const { updatePreferences, getOrCreateProfile } = await import("../server/profile/service.js");
const { prepareApplication, updateStatus } = await import("../server/applications/service.js");
const { approveResumeVersion } = await import("../server/resume/tailor.js");
const { RESUME_TEXT, rawJob, fakeConnector } = await import("../tests/fixtures.js");
const express = (await import("express")).default;
const puppeteer = (await import("puppeteer-core")).default;

setStore(new FileStore());
const user = { uid: "demo", email: "priya.sharma@example.com", name: "Priya Sharma" };
await getOrCreateProfile(user);
const { resume } = await storeResume(user, { buffer: Buffer.from(RESUME_TEXT), originalname: "priya.txt", mimetype: "text/plain" });
await processResume(user, resume);
await updatePreferences("demo", { locations: ["Chennai"], workModes: ["hybrid", "remote"], minSalaryLPA: 20, noticePeriodDays: 30, targetRoles: ["Senior Project Manager"] });
const desc = (t: string) => `${t} Agile, Scrum, JIRA, stakeholder management, risk management, budget management. 8+ years. ` + "Lead cross-functional teams and vendor management. ".repeat(5);
setConnectors([fakeConnector("demo", [
  rawJob(),
  rawJob({ sourceJobId: "2", title: "Technical Program Manager", company: "Zeta", location: "Bengaluru, India", url: "https://x.example/2", applyUrl: "https://x.example/2", description: desc("Own delivery of payments programs. Hybrid in Bengaluru. 30-40 LPA.") }),
  rawJob({ sourceJobId: "3", title: "Delivery Manager", company: "Freshworks", location: "Chennai, India", url: "https://x.example/3", applyUrl: "https://x.example/3", description: desc("Lead software delivery for enterprise customers in Chennai. MS Project, resource planning. 10+ years.") }),
  rawJob({ sourceJobId: "6", title: "Program Manager - Payments", company: "Zeta", location: "Chennai, India", url: "https://x.example/6", applyUrl: "https://x.example/6", description: desc("Lead payments programs. Hybrid in Chennai. 28-36 LPA.") }),
])]);
await runDiscovery();
await matchCandidate("demo", { notifyNew: true });
const jobs = await (await getStore()).query<any>("jobs");
const pkg = await prepareApplication("demo", jobs[0].id);
await approveResumeVersion("demo", pkg.resume!.id);
// Voice: the demo user has their own (fake) key, and tokens come from a fake mint, so the call reaches Google and is refused.
const { encryptSecret } = await import("../server/ai/secrets.js");
const { setTokenFactory } = await import("../server/voice/session.js");
const { setProviders } = await import("../server/ai/gateway.js");
setProviders([], async () => null); // other AI features must not spend (and so invalidate) the fake key
await (await getStore()).put("userKeys", "demo", { uid: "demo", kind: "gemini", keyEnc: encryptSecret("AIzaFAKE-KEY-FOR-UI-AUDIT-000"), last4: "0000", models: ["gemini-2.5-flash"], addedAt: new Date().toISOString(), status: "ok" });
setTokenFactory(async () => "auth_tokens/ui-audit-fake");
await updateStatus("demo", pkg.application.id, "applied");

const dist = path.resolve(process.env.AUDIT_DIST || "dist-shots");
const app = createApp();
app.use(express.static(dist));
app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
const server = await new Promise<import("node:http").Server>((r) => { const s = app.listen(3198, () => r(s)); });

const edge = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"].find((p) => fs.existsSync(p))!;
const browser = await puppeteer.launch({ executablePath: edge, headless: true, args: ["--no-first-run", "--disable-gpu", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const THEME = process.env.SHOT_THEME || "dark";
const OUT = path.resolve("screenshots/audit");
fs.mkdirSync(OUT, { recursive: true });

const DEVICES = { m: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, t: { width: 820, height: 1180, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, d: { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 } } as const;
const only = (process.env.AUDIT_ONLY || "m,t,d").split(",") as Array<keyof typeof DEVICES>;
const PAGES = ["", "#matches", "#search", `#job/${jobs[0].id}`, "#applications", "#interview", "#insights", "#resume", "#profile", "#settings", "#employer", "#admin"];
const problems: string[] = [];

for (const dev of only) {
  const page = await browser.newPage();
  await page.setViewport(DEVICES[dev]);
  // Settle the first-run things so they don't cover the screen: consent answered, tour and tips seen.
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem("mc_analytics_consent", "denied"); localStorage.setItem("mc_tour_done", "1"); localStorage.setItem("mc_guide", JSON.stringify({ mode: "quiet", voice: false })); } catch { /* */ } });
  for (const hash of PAGES) {
    const name = `${dev}-${(hash.replace(/^#/, "").split("/")[0] || "home")}`;
    await page.goto(`http://localhost:3198/?dev=demo&notour&theme=${THEME}${hash}`, { waitUntil: "networkidle0", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 900));
    const found = await page.evaluate(() => {
      const out: string[] = [];
      const vw = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth > vw + 1) {
        const wide = [...document.querySelectorAll<HTMLElement>("body *")].filter((e) => { const r = e.getBoundingClientRect(); return r.right > vw + 1 && r.width > 0 && getComputedStyle(e).position !== "fixed"; })
          .filter((e) => !e.closest(".overflow-x-auto,.overflow-auto,.no-scrollbar,[role=tablist]")).slice(0, 4)
          .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(" ").slice(0, 3).join(".")} "${(e.textContent || "").trim().slice(0, 30)}" right=${Math.round(e.getBoundingClientRect().right)}`);
        out.push(`page wider than screen (${document.documentElement.scrollWidth} > ${vw}): ${wide.join(" | ")}`);
      }
      for (const e of document.querySelectorAll<HTMLElement>("button, a, input, select")) {
        const r = e.getBoundingClientRect();
        if (r.width && r.height && r.height < 28 && r.width < 28 && getComputedStyle(e).visibility !== "hidden" && !e.closest(".sr-only")) out.push(`small tap target (${Math.round(r.width)}x${Math.round(r.height)}): ${e.getAttribute("aria-label") || (e.textContent || "").trim().slice(0, 20) || e.tagName}`);
      }
      for (const e of document.querySelectorAll<HTMLElement>("h1,h2,h3,p,span,button,a,label")) {
        const cs = getComputedStyle(e);
        if (cs.overflow === "hidden" && cs.textOverflow !== "ellipsis" && !cs.webkitLineClamp && e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0) out.push(`text cut off: "${(e.textContent || "").trim().slice(0, 40)}"`);
      }
      return [...new Set(out)].slice(0, 12);
    });
    for (const f of found) problems.push(`[${name}] ${f}`);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) as `${string}.png`, fullPage: true });
  }
  if (dev === "m") {
    // The "More" menu must open, stay visible, scroll, and close.
    await page.goto(`http://localhost:3198/?dev=demo&notour&theme=${THEME}#matches`, { waitUntil: "networkidle0" });
    await page.click('button[aria-label="More"]').catch(() => problems.push("[m-more] no More button"));
    await new Promise((r) => setTimeout(r, 700));
    const vis = await page.evaluate(() => { const d = document.querySelector<HTMLElement>("[data-drawer]"); if (!d) return "missing"; const cs = getComputedStyle(d); const r = d.getBoundingClientRect(); return cs.opacity !== "1" || r.right < 50 ? `hidden (opacity ${cs.opacity}, right ${r.right})` : "ok"; });
    if (vis !== "ok") problems.push(`[m-more] drawer ${vis}`);
    await page.screenshot({ path: path.join(OUT, "m-more.png") });
  }
  if (dev === "d") {
    // The assistant panel, opened fresh (no history yet)
    await page.goto(`http://localhost:3198/?dev=demo&notour&theme=${THEME}`, { waitUntil: "networkidle0" });
    await page.evaluate(() => { try { localStorage.setItem("mc_lang", "en"); } catch { /* */ } });
    await page.reload({ waitUntil: "networkidle0" });
    await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("header button")].find((b) => /assistant/i.test(b.textContent || ""))?.click());
    await new Promise((r) => setTimeout(r, 1200));
    await page.focus("textarea").catch(() => undefined);
    await page.screenshot({ path: path.join(OUT, "d-chat.png") });
  }
  await page.close();
}
// ---------------- voice flow (desktop) ----------------
if (only.includes("d")) {
  const page = await browser.newPage();
  await page.setViewport(DEVICES.d);
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem("mc_analytics_consent", "denied"); localStorage.setItem("mc_guide", JSON.stringify({ mode: "quiet", voice: false })); localStorage.setItem("mc_lang", "en"); } catch { /* */ } });
  const openChat = async () => {
    await page.goto(`http://localhost:3198/?dev=demo&notour&theme=${THEME}`, { waitUntil: "networkidle0" });
    await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("header button")].find((b) => /assistant/i.test(b.textContent || ""))?.click());
    await new Promise((r) => setTimeout(r, 600)); // press Talk quickly: it must still pick live on a good line
  };
  page.on("pageerror", (e) => console.log("[voice] PAGE ERROR:", String(e).slice(0, 300)));
  page.on("console", (m) => { if (m.type() === "error") console.log("[voice] console error:", m.text().slice(0, 200)); if (m.text().startsWith("[call]")) console.log("   ", m.text().slice(0, 300)); });
  await page.evaluateOnNewDocument(() => { (window as unknown as { __callDebug: boolean }).__callDebug = true; });
  const statusText = () => page.evaluate(() => document.querySelector("aside [aria-live=polite]")?.textContent || "");
  await openChat();
  const why = await page.evaluate(async () => { const r = await fetch("/api/me", { headers: { Authorization: "Bearer dev:demo" } }); const j = await r.json(); return JSON.stringify({ key: j.ai?.ownKey?.status, pref: localStorage.getItem("mc_voice_quality"), low: localStorage.getItem("mc_lowdata"), hdr: [...document.querySelectorAll("header button")].map((b) => (b.textContent || b.getAttribute("aria-label") || "").trim()).slice(0, 12), url: location.href, header: [...document.querySelectorAll("aside button")].map((b) => b.getAttribute("aria-label")).filter(Boolean).slice(0, 6) }); });
  const talk = await page.$('button[aria-label="Talk with Asha"]');
  if (!talk) console.log("[voice] no Talk button:", why);
  if (!talk) problems.push("[voice] no Talk button with a key on a good connection");
  else {
    await talk.click();
    await new Promise((r) => setTimeout(r, 400));
    const first = await statusText();
    if (!/Connecting|Listening|Couldn/.test(first)) problems.push(`[voice] call screen didn't open (status: "${first}")`);
    let final = first;
    // Google takes a moment to refuse a fake token: wait for the final state (up to 8 s).
    for (let i = 0; i < 16 && !/Couldn/.test(final); i++) { await new Promise((r) => setTimeout(r, 500)); final = await statusText(); }
    const detail = await page.evaluate(() => [...document.querySelectorAll("aside p")].map((p) => p.textContent).filter((t) => /Google|Couldn|model|key/i.test(t || "")).join(" | "));
    console.log(`[voice] with a fake token, the call ended as: "${final}" ${detail ? `(${detail})` : ""}`);
    if (!/Couldn/.test(final)) problems.push(`[voice] call stuck at "${final}"`);
    await page.screenshot({ path: path.join(OUT, "d-voice.png") });
    const back = await page.evaluateHandle(() => [...document.querySelectorAll<HTMLButtonElement>("aside button")].find((b) => /Back to chat|End call/i.test(b.textContent || b.getAttribute("aria-label") || "")));
    await (back as any).click?.();
    await new Promise((r) => setTimeout(r, 800));
    if (!(await page.$("aside textarea")) || !(await page.evaluate(() => { const t = document.querySelector("aside textarea"); return Boolean(t && (t as HTMLElement).offsetParent); }))) problems.push("[voice] didn't return to the chat after the call");
  }
  // Text-only preference hides the Talk button
  await page.evaluate(() => localStorage.setItem("mc_voice_quality", "text"));
  await openChat();
  if (await page.$('button[aria-label="Talk with Asha"]')) problems.push("[voice] Talk shown although Text only is chosen");
  await page.close();
}

await browser.close();
server.close();
fs.writeFileSync(path.join(OUT, "problems.txt"), problems.join("\n") + "\n");
console.log(problems.length ? problems.join("\n") : "No layout problems found.");
console.log(`\n${problems.length} problem(s). Screenshots in screenshots/audit/`);
process.exit(0);
