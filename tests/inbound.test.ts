import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { config } from "../server/config.js";
import { LIMITS, addressOf, getInbox } from "../server/inbound/service.js";
import { parseAlertEmail, parseVerification } from "../server/inbound/parse.js";
import { RESUME_TEXT, freshEnv } from "./fixtures.js";

const app = createApp();
const A = { Authorization: "Bearer dev:alice" };
const SECRET = "test-secret-123456";

const NAUKRI_HTML = `<html><body>
<p>Hi Raj, 3 new jobs match your alert</p>
<table><tr><td><a href="https://www.naukri.com/job-listings-senior-project-manager-acme-chennai-8-to-12-years-101">Senior Project Manager</a><br>Acme Software Pvt Ltd<br>Chennai<br>8-12 Yrs · 18-25 LPA</td></tr></table>
<table><tr><td><a href="https://www.naukri.com/job-listings-delivery-manager-beta-remote-102?src=alert">Delivery Manager</a><br>Beta Payments<br>Remote<br>Posted 2 days ago</td></tr></table>
<a href="https://www.naukri.com/unsubscribe?x=1">Unsubscribe</a>
<a href="https://www.naukri.com/mnjuser/profile">Update your profile</a>
</body></html>`;

const GMAIL_VERIFY = { from: "Gmail Team <forwarding-noreply@google.com>", subject: "Gmail Forwarding Confirmation - Receive Mail from raj@gmail.com", text: "raj@gmail.com has requested to automatically forward mail to your email address. Confirmation code: 482913\nTo allow, click: https://mail-settings.google.com/mail/vf-%5BANGjdJ%5D-abc123", html: "" };

beforeAll(() => { config.inboundEmail.domain = "in.test.dev"; config.inboundEmail.secret = SECRET; });
beforeEach(() => { freshEnv(); });

async function readyUser() {
  await request(app).post("/api/resume").set(A).attach("resume", Buffer.from(RESUME_TEXT), "cv.txt");
  for (let i = 0; i < 50; i++) {
    const me = await request(app).get("/api/me").set(A);
    if (["needs_info", "ready"].includes(me.body.profile?.status)) break;
    await new Promise((r) => setTimeout(r, 40));
  }
  await request(app).post("/api/profile/answer").set(A).send({ text: "Chennai or remote, hybrid works too, minimum 20 LPA, 30 days notice" });
}
const mime = (o: { from: string; subject: string; html?: string; text?: string }) =>
  Buffer.from([`From: ${o.from}`, "To: x", `Subject: ${o.subject}`, "MIME-Version: 1.0", `Content-Type: ${o.html ? "text/html" : "text/plain"}; charset=utf-8`, "", o.html || o.text || ""].join("\r\n"));
const post = (to: string, body: Buffer, secret = SECRET) => request(app).post("/api/inbound/email").set("X-Inbound-Secret", secret).set("X-Inbound-To", to).set("Content-Type", "message/rfc822").send(body);

describe("alert email parsing", () => {
  it("reads Naukri alerts: title, company, location, link; skips footer links", async () => {
    const r = await parseAlertEmail("u", { from: "Naukri Jobs <jobalert@naukri.com>", subject: "3 new jobs for you", text: "", html: NAUKRI_HTML });
    expect(r.kind).toBe("alerts");
    expect(r.portal).toBe("Naukri");
    expect(r.jobs).toHaveLength(2);
    expect(r.jobs[0]).toMatchObject({ title: "Senior Project Manager", company: "Acme Software Pvt Ltd", location: "Chennai" });
    expect(r.jobs[0].url).toContain("job-listings-senior-project-manager");
    expect(r.jobs[1]).toMatchObject({ title: "Delivery Manager", company: "Beta Payments", location: "Remote" });
  });

  it("reads a plain-text alert", async () => {
    const text = "Your job alert\n\nProject Manager\nGamma Cloud\nPune\nhttps://www.linkedin.com/comm/jobs/view/3999?trk=x\n\nUnsubscribe: https://www.linkedin.com/e/unsub";
    const r = await parseAlertEmail("u", { from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>", subject: "New job", text, html: "" });
    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0]).toMatchObject({ title: "Project Manager", company: "Gamma Cloud", location: "Pune", portal: "LinkedIn" });
  });

  it("recognises the Gmail forwarding confirmation and extracts the code", () => {
    expect(parseVerification(GMAIL_VERIFY)).toMatchObject({ code: "482913" });
    expect(parseVerification(GMAIL_VERIFY)!.link).toContain("mail-settings.google.com");
    expect(parseVerification({ from: "friend@x.com", subject: "hello", text: "code 123456", html: "" })).toBeNull();
  });

  it("finds nothing in an email that is not a job alert", async () => {
    const r = await parseAlertEmail("u", { from: "Bank <alerts@bank.com>", subject: "Your statement", text: "Balance ₹5,000. https://bank.com/statement", html: "" });
    expect(r).toMatchObject({ kind: "empty", jobs: [] });
  });
});

describe("forwarding address", () => {
  it("gives each user a private address and ignores wrong secrets and unknown addresses", async () => {
    const me = (await request(app).get("/api/inbox").set(A)).body;
    expect(me.enabled).toBe(true);
    expect(me.address).toMatch(/^u-[a-z0-9]{8}@in\.test\.dev$/);
    expect((await request(app).get("/api/inbox")).status).toBe(401);
    expect((await post(me.address, mime({ from: "a@b.com", subject: "x", text: "hi" }), "wrong")).status).toBe(401);
    const unknown = await post("u-zzzzzzzz@in.test.dev", mime({ from: "a@b.com", subject: "x", text: "hi" }));
    expect(unknown.body).toMatchObject({ ok: true, accepted: false }); // reveals nothing about which addresses exist
  });

  it("adds jobs from a forwarded alert to the user's private feed, scored", async () => {
    await readyUser();
    const { address } = (await request(app).get("/api/inbox").set(A)).body;
    const r = await post(address, mime({ from: "Naukri Jobs <jobalert@naukri.com>", subject: "3 new jobs for you", html: NAUKRI_HTML }));
    expect(r.body.accepted).toBe(true);
    const inbox = (await request(app).get("/api/inbox").set(A)).body;
    expect(inbox.events[0]).toMatchObject({ kind: "alerts", jobs: 2, portal: "Naukri" });
    const search = await request(app).get("/api/jobs/search?q=project manager&pageSize=10").set(A);
    const titles = search.body.hits.map((h: any) => h.job.title);
    expect(titles).toContain("Senior Project Manager");
    const hit = search.body.hits.find((h: any) => h.job.title === "Senior Project Manager");
    expect(hit.job.sources[0].sourceName).toBe("Naukri alert");
    expect(hit.matchScore).toBeGreaterThan(0);
    const notes = (await request(app).get("/api/notifications").set(A)).body.notifications;
    expect(notes.some((n: any) => /from your Naukri email/.test(n.title))).toBe(true);
    // another user never sees them
    const bob = await request(app).get("/api/jobs/search?q=project manager&pageSize=10").set({ Authorization: "Bearer dev:bob" });
    expect(bob.body.hits.map((h: any) => h.job.title)).not.toContain("Senior Project Manager");
  });

  it("keeps the Gmail verification code for the user to read in the app", async () => {
    const { address } = (await request(app).get("/api/inbox").set(A)).body;
    await post(address, mime({ from: GMAIL_VERIFY.from, subject: GMAIL_VERIFY.subject, text: GMAIL_VERIFY.text }));
    const v = (await request(app).get("/api/inbox").set(A)).body.verification;
    expect(v.code).toBe("482913");
    expect(v.link).toContain("mail-settings.google.com");
  });

  it("does not add jobs before the profile is ready, and enforces the daily email limit", async () => {
    const { address } = (await request(app).get("/api/inbox").set(A)).body;
    await post(address, mime({ from: "Naukri Jobs <jobalert@naukri.com>", subject: "jobs", html: NAUKRI_HTML }));
    expect((await request(app).get("/api/inbox").set(A)).body.events[0].kind).toBe("ignored");
    const rec = await getInbox("alice");
    rec.emailsToday = LIMITS.emailsPerDay;
    const { getStore } = await import("../server/db/store.js");
    await (await getStore()).put("inbound", rec.id, rec);
    await post(address, mime({ from: "x@y.com", subject: "again", text: "hi" }));
    expect((await request(app).get("/api/inbox").set(A)).body.events[0].kind).toBe("limit");
  });

  it("rotating gives a new address and the old one stops working", async () => {
    const before = (await request(app).get("/api/inbox").set(A)).body.address;
    const after = (await request(app).post("/api/inbox/rotate").set(A)).body.address;
    expect(after).not.toBe(before);
    expect((await post(before, mime({ from: "a@b.com", subject: "x", text: "hi" }))).body.accepted).toBe(false);
    expect((await post(after, mime({ from: "a@b.com", subject: "x", text: "hi" }))).body.accepted).toBe(true);
    expect(addressOf((await getInbox("alice")).id)).toBe(after);
  });
});
