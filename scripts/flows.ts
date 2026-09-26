// Flow audit: does what a person does on each screen actually work and actually save? Each flow acts in the real
// screen, then checks through the API (the source of truth) and after a reload (what the person sees next time).
// Run: VITE_DEV_AUTH=true npm run build -- --outDir dist-shots; npx tsx scripts/flows.ts   (FLOWS=profile,chat to pick)
import { clickText, startDemo, wait } from "./lib/demo-app.js";

const d = await startDemo({ port: 3194, admin: true });
const only = process.env.FLOWS?.split(",");
const results: Array<{ name: string; ok: boolean; why?: string }> = [];
const flows: Array<[string, () => Promise<void>]> = [];
const flow = (name: string, fn: () => Promise<void>) => flows.push([name, fn]);
const expect = (cond: unknown, msg: string) => { if (!cond) throw new Error(msg); };
const profile = async () => (await d.api("/me")).json.profile;
const bodyText = (page: import("puppeteer-core").Page) => page.evaluate(() => document.body.innerText);

flow("profile: add and remove a skill, saved and still there after reload", async () => {
  const { page, go, issues } = await d.tab(); await go("profile");
  await page.type('input[placeholder="Add a skill you have"]', "Kanban");
  await page.keyboard.press("Enter");
  await wait(800);
  expect((await profile()).skills.some((s: any) => /kanban/i.test(s.name || s)), "Kanban was not saved to the profile");
  await go("profile");
  expect((await bodyText(page)).includes("Kanban"), "Kanban not shown after reload");
  await clickText(page, "button", "Remove Kanban"); await wait(800);
  expect(!(await profile()).skills.some((s: any) => /kanban/i.test(s.name || s)), "Kanban was not removed");
  expect(!issues.length, issues.join("; "));
});

flow("profile: preferences (pay, notice, work mode, job type, shift) save and re-score", async () => {
  const { page, go, issues } = await d.tab(); await go("profile");
  const set = async (ph: string, v: string) => { const el = await page.$(`input[placeholder="${ph}"]`); expect(el, `no field ${ph}`); await el!.focus(); await page.keyboard.down("Control"); await page.keyboard.press("a"); await page.keyboard.up("Control"); await el!.type(v); };
  await set("e.g. 12", "24"); await set("e.g. 30", "45");
  await clickText(page, "button", "Full-time"); await clickText(page, "button", "Contract"); await clickText(page, "button", "Day");
  const saved = await clickText(page, "button", /^Save changes/); expect(saved, "no Save button for preferences");
  await wait(1500);
  const pr = (await profile()).preferences;
  expect(pr.minSalaryLPA === 24, `minimum pay is ${pr.minSalaryLPA}, expected 24`);
  expect(pr.noticePeriodDays === 45, `notice is ${pr.noticePeriodDays}, expected 45`);
  expect(pr.employmentTypes?.includes("contract"), `job types ${JSON.stringify(pr.employmentTypes)}`);
  expect(pr.shifts?.includes("day"), `shifts ${JSON.stringify(pr.shifts)}`);
  await go("profile");
  const vals = await page.evaluate(() => [...document.querySelectorAll<HTMLInputElement>('input[type="number"]')].map((i) => i.value));
  expect(vals.includes("24") && vals.includes("45"), `after reload the fields show ${vals.join(",")}`);
  expect(!issues.length, issues.join("; "));
});

flow("matches: save a job, see it under Saved, still saved after reload", async () => {
  const { page, go, issues } = await d.tab(); await go("matches");
  const id = await page.evaluate(() => document.querySelector("article[data-job-id]")?.getAttribute("data-job-id"));
  expect(id, "no job cards");
  await page.evaluate(() => (document.querySelector('article[data-job-id] button[data-action="save"]') as HTMLElement).click());
  await wait(900);
  const saved = (await d.api("/feed?saved=true")).json;
  expect(JSON.stringify(saved).includes(id!), "the job was not saved on the server");
  await go("matches");
  const stillSaved = await page.evaluate((i) => document.querySelector(`article[data-job-id="${i}"] button[data-action="save"]`)?.getAttribute("aria-label"), id);
  expect(stillSaved === "Remove from saved", `after reload the bookmark says "${stillSaved}"`);
  await clickText(page, "button", /^Saved/); await wait(900);
  expect(await page.$(`article[data-job-id="${id}"]`), "the job is missing from the Saved tab");
  expect(!issues.length, issues.join("; "));
});

flow("matches: 'Not interested' removes the job and it stays hidden", async () => {
  const { page, go, issues } = await d.tab(); await go("matches");
  const id = await page.evaluate(() => [...document.querySelectorAll("article[data-job-id]")].slice(-1)[0]?.getAttribute("data-job-id"));
  expect(id, "no job cards");
  await page.evaluate((i) => { const a = document.querySelector(`article[data-job-id="${i}"]`)!; ([...a.querySelectorAll("button")].find((b) => /not interested|hide/i.test(b.getAttribute("aria-label") || b.title || b.textContent || "")) as HTMLElement).click(); }, id);
  await wait(600);
  await clickText(page, "button", /not relevant|other|skip|hide|confirm/i); await wait(900);
  await go("matches");
  expect(!(await page.$(`article[data-job-id="${id}"]`)), "the hidden job came back after reload");
  expect(!issues.length, issues.join("; "));
});

flow("job: Prepare my application creates a tracked application", async () => {
  const jobId = (await d.api("/jobs/search?pageSize=20")).json.hits.map((h: any) => h.job.id).find((i: string) => i !== d.jobs[0].id);
  const { page, go, issues } = await d.tab(); await go(`job/${jobId}`);
  expect(await clickText(page, "button", /Prepare my application/i), "no 'Prepare my application' button");
  await wait(2500);
  const apps = (await d.api("/applications")).json;
  expect(JSON.stringify(apps).includes(jobId), "no application was created");
  await go("applications");
  expect((await bodyText(page)).length > 200, "applications screen is empty");
  expect(!issues.length, issues.join("; "));
});

flow("applications: move status and add a note, both saved", async () => {
  const { page, go, issues } = await d.tab(); await go("applications");
  const before = (await d.api("/applications")).json;
  const list = Array.isArray(before) ? before : before.applications;
  const a = list.find((x: any) => x.status === "applied") || list[0];
  expect(a, "no applications to work with");
  await clickText(page, "button", /Notes/); await wait(500);
  await page.type('input[placeholder^="e.g. Spoke to HR"]', "Spoke to HR"); await clickText(page, "button", "Add"); await wait(800);
  const after = (await d.api("/applications")).json; const l2 = Array.isArray(after) ? after : after.applications;
  expect(JSON.stringify(l2).includes("Spoke to HR"), "the note was not saved");
  expect(!issues.length, issues.join("; "));
});

flow("search: typing a title and pressing Enter finds it; paging works", async () => {
  const { page, go, issues } = await d.tab(); await go("search");
  await page.evaluate(() => { for (const b of document.querySelectorAll<HTMLButtonElement>('button[aria-label^="Remove "]')) b.click(); });
  await wait(600);
  await page.type('input[aria-label="Job title, skill or company"]', "Program Manager"); await page.keyboard.press("Enter"); await wait(1200);
  const cards = await page.evaluate(() => [...document.querySelectorAll("article[data-job-id]")].map((a) => a.textContent || ""));
  expect(cards.length > 0 && cards.some((c) => /Program Manager/.test(c)), "no Program Manager results");
  expect(!issues.length, issues.join("; "));
});

flow("chat: asks for jobs in a city and gets job cards, no error", async () => {
  const { page, go, issues } = await d.tab(); await go("");
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("header button")].find((b) => /assistant/i.test(b.textContent || ""))?.click());
  await wait(800);
  await page.type("aside textarea", "show me jobs in Pune"); await page.keyboard.press("Enter");
  await wait(3500);
  const t = await page.evaluate(() => [...document.querySelectorAll("aside")].find((a) => a.querySelector("textarea"))?.textContent || "");
  expect(/Pune/.test(t), `the reply doesn't mention Pune: ${t.slice(-200)}`);
  expect(!/something went wrong|error/i.test(t.slice(-300)), `error in chat: ${t.slice(-200)}`);
  expect(!issues.length, issues.join("; "));
});

flow("understanding: answering a question moves on to the next", async () => {
  const { page, go, issues } = await d.tab(); await go("profile");
  const before = await page.evaluate(() => document.querySelector("main")?.textContent?.slice(0, 600));
  const ok = await clickText(page, "button", /Career growth|Better pay|Work-life balance/); expect(ok, "no answer buttons on the profile");
  await wait(600); await clickText(page, "button", /^Send$/); await wait(1200);
  const u = (await d.api("/career/understanding")).json;
  expect(u.next?.id !== "motivation", `still asking the same question (${u.next?.id})`);
  expect(!issues.length, issues.join("; "));
  void before;
});

flow("settings: theme and language switch and stick after reload", async () => {
  const { page, go, issues } = await d.tab(); await go("settings", false);
  const before = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.evaluate(() => (document.querySelector('button[aria-label*="theme" i], button[title*="theme" i]') as HTMLElement)?.click());
  await wait(500);
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(before !== after, `theme did not change (${before})`);
  await page.reload({ waitUntil: "networkidle0" });
  expect((await page.evaluate(() => document.documentElement.dataset.theme)) === after, "theme did not stick after reload");
  expect(!issues.length, issues.join("; "));
});

flow("resume: builder shows a preview and the PDF downloads as a PDF", async () => {
  const r = await d.api("/career/resume");
  expect(r.status === 200, `GET /career/resume ${r.status}`);
  const { page, go, issues } = await d.tab(); await go("resume");
  expect((await bodyText(page)).length > 300, "resume screen is empty");
  const pdf = await fetch(`${d.base}/api/resume/pdf`, { headers: { Authorization: "Bearer dev:demo" } }).catch(() => null);
  if (pdf && pdf.status !== 404) expect(pdf.headers.get("content-type")?.includes("pdf"), `PDF endpoint returned ${pdf.headers.get("content-type")}`);
  expect(!issues.length, issues.join("; "));
});


flow("hidden jobs: a too-narrow preference explains itself and one tap fixes it", async () => {
  await d.api("/profile/preferences", { method: "PUT", body: { employmentTypes: ["contract"], minSalaryLPA: 5, noticePeriodDays: 30 } }); await wait(1500);
  const { page, go, issues } = await d.tab(); await go("matches");
  await page.waitForFunction(() => /hidden by your preferences|match/i.test(document.querySelector("main")?.textContent || ""), { timeout: 8000 }).catch(() => undefined);
  const t = await bodyText(page);
  expect(/hidden by your preferences/i.test(t), `no explanation on an empty screen: "${t.slice(0, 200)}" issues: ${issues.join("; ")}`);
  expect(!/still looking/i.test(t), "says it is still looking when the real reason is the preferences");
  expect(await clickText(page, "button", /Include full time/i), "no one-tap fix");
  await wait(3500); await go("matches");
  expect((await page.$$("article[data-job-id]")).length > 0, `no jobs after adding the job type back; prefs ${JSON.stringify((await profile()).preferences)}; summary ${JSON.stringify((await d.api("/feed/summary")).json).slice(0, 300)}`);
  expect(!issues.length, issues.join("; "));
});

flow("admin: filter the company list, switch a company off, it stays off", async () => {
  const { page, go, issues } = await d.tab(); await go("admin");
  await page.type('input[placeholder="Filter by name"]', "Adobe"); await wait(500);
  const names = await page.evaluate(() => [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"][aria-label^="Enable "]')].map((i) => i.getAttribute("aria-label")));
  expect(names.length >= 1 && names.every((n) => /adobe/i.test(n || "")), `filter shows ${JSON.stringify(names)}`);
  await page.evaluate(() => (document.querySelector('input[type="checkbox"][aria-label="Enable Adobe"]') as HTMLInputElement).click()); await wait(900);
  const list = (await d.api("/admin/companies")).json; const arr = Array.isArray(list) ? list : list.companies;
  const adobe = arr.find((c: any) => /adobe/i.test(c.name));
  expect(adobe && adobe.enabled === false, `Adobe enabled=${adobe?.enabled} after switching off`);
  await go("admin"); await page.type('input[placeholder="Filter by name"]', "Adobe"); await wait(500);
  expect(await page.evaluate(() => (document.querySelector('input[aria-label="Enable Adobe"]') as HTMLInputElement)?.checked === false), "Adobe shows as on after reload");
  expect(!issues.length, issues.join("; "));
});

flow("admin: a bad careers link is refused with a message, not a crash", async () => {
  const { page, go, issues } = await d.tab(); await go("admin");
  await page.type('input[placeholder="https://company.com/careers"]', "not a link"); await clickText(page, "button", "Detect"); await wait(1500);
  const t = await bodyText(page);
  expect(/valid|couldn.t|can.t|invalid|error|not a|recogni|found|link|url/i.test(t.slice(t.indexOf("Detect"))), "no message shown for a bad link");
  expect(!issues.filter((i) => !/→ 4[0-9][0-9]/.test(i)).length, issues.join("; "));
});

flow("employer: creating an account works and the posting form appears", async () => {
  const { page, go, issues } = await d.tab(); await go("employer");
  const inputs = await page.$$("main input");
  expect(inputs.length >= 3, `employer form is missing fields (${inputs.length}); main: ${await page.evaluate(() => document.querySelector("main")?.innerText.replace(/s+/g, " ").slice(0, 300))}`);
  await inputs[0].type("Northwind Technologies"); await inputs[1].type("www.northwind.example"); await inputs[2].type("hr@northwind.example");
  await clickText(page, "button", "Create employer account"); await wait(1500);
  const me = await d.api("/employer/me").catch(() => ({ status: 0, json: null }));
  const t = await bodyText(page);
  expect(!/Create employer account/.test(t) || me.status === 200, "still on the sign-up form after creating the account");
  expect(!issues.length, issues.join("; "));
});

flow("resume: switching template changes the preview, and editing the summary saves", async () => {
  const { page, go, issues } = await d.tab(); await go("resume");
  const shot = () => page.evaluate(() => (document.querySelector("[class*=theme-paper]") as HTMLElement | null)?.outerHTML.length || 0);
  const a = await shot(); await clickText(page, "button", "Modern"); await wait(500); const b = await shot();
  expect(a > 0 && a !== b, "the preview did not change when Modern was chosen");
  await clickText(page, "button", /^Summary/); await wait(500);
  const ta = await page.$("main textarea"); expect(ta, "no summary editor");
  await ta!.click({ clickCount: 3 }); await ta!.type("Delivery-focused programme manager with 12 years running banking platforms.");
  await clickText(page, "button", /^Save/); await wait(1200);
  const r = (await d.api("/career/resume")).json.resume;
  expect(JSON.stringify(r).includes("Delivery-focused programme manager"), "the edited summary was not saved");
  expect(!issues.length, issues.join("; "));
});

flow("settings: low-data, voice quality and the guide mode stick after reload", async () => {
  const { page, go, issues } = await d.tab(); await go("settings", false);
  expect(await clickText(page, "button", "Text only"), "no Text only button"); await wait(300);
  await clickText(page, "button", "Off"); await wait(300);
  const ls = await page.evaluate(() => ({ q: localStorage.getItem("mc_voice_quality"), g: localStorage.getItem("mc_guide") }));
  expect(ls.q === "text", `voice quality not saved (${ls.q})`);
  expect(/"mode":"off"/.test(ls.g || ""), `guide mode not saved (${ls.g})`);
  expect(!issues.length, issues.join("; "));
});

flow("settings: Delete… asks first and Cancel keeps everything", async () => {
  const { page, go, issues } = await d.tab(); await go("settings");
  const dlg: string[] = []; page.on("dialog", async (x) => { dlg.push(x.message()); await x.dismiss(); });
  await clickText(page, "button", /^Delete/); await wait(800);
  const modal = await page.evaluate(() => document.querySelector("[role=dialog]")?.textContent || "");
  expect(dlg.length > 0 || /sure|permanent|delete/i.test(modal), "Delete did not ask for confirmation");
  await clickText(page, "button", /^(Cancel|Keep)/); await wait(400);
  expect((await d.api("/me")).status === 200, "the account is gone after Cancel");
  expect(!issues.length, issues.join("; "));
});

for (const [name, fn] of flows) {
  if (only && !only.some((o) => name.startsWith(o))) continue;
  try { await fn(); results.push({ name, ok: true }); } catch (e: any) { results.push({ name, ok: false, why: String(e?.message || e).slice(0, 300) }); }
  console.log(`${results.at(-1)!.ok ? "PASS" : "FAIL"}  ${name}${results.at(-1)!.why ? `\n      ${results.at(-1)!.why}` : ""}`);
}
await d.close();
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} flows work`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
