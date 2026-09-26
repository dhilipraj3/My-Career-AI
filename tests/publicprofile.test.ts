import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { shortName } from "../server/publicProfile.js";
import { RESUME_TEXT, freshEnv } from "./fixtures.js";

const app = createApp();
const A = { Authorization: "Bearer dev:alice" };

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

describe("shareable profile", () => {
  it("shows first name plus last initial only", () => {
    expect(shortName("Rajkumar Balasubramanian")).toBe("Rajkumar B.");
    expect(shortName("Meena")).toBe("Meena");
    expect(shortName("")).toBe("Job seeker");
  });

  it("is off until the user turns it on, hides contact details, and is not indexed by default", async () => {
    await readyUser();
    expect((await request(app).get("/api/me/public-profile").set(A)).body).toMatchObject({ settings: null, url: null });
    const on = await request(app).put("/api/me/public-profile").set(A).send({ enabled: true });
    expect(on.body.url).toMatch(/\/p\/[a-z0-9]+-[0-9a-f]{6}$/);
    const slug = on.body.settings.id;
    const html = await request(app).get(`/p/${slug}`);
    expect(html.status).toBe(200);
    expect(html.headers["cache-control"]).toBe("no-store");
    expect(html.text).toContain('content="noindex, follow"');
    const me = (await request(app).get("/api/me").set(A)).body.profile;
    expect(html.text).not.toContain(me.email);
    expect(html.text).not.toContain(me.phone || "@@none@@");
    expect(html.text).toMatch(/Skills/);
    if (me.fullName.includes(" ")) expect(html.text).not.toContain(me.fullName); // never the full surname
  });

  it("the user controls sections and search-engine visibility, and can switch it off", async () => {
    await readyUser();
    const slug = (await request(app).put("/api/me/public-profile").set(A).send({ enabled: true, indexable: true, show: { skills: false, summary: false } })).body.settings.id;
    const html = (await request(app).get(`/p/${slug}`)).text;
    expect(html).toContain('content="index, follow');
    expect(html).not.toMatch(/<h2>Skills<\/h2>/);
    expect(html).not.toMatch(/<h2>About<\/h2>/);
    const off = await request(app).put("/api/me/public-profile").set(A).send({ enabled: false });
    expect(off.body.settings.indexable).toBe(false); // off means fully off
    expect((await request(app).get(`/p/${slug}`)).status).toBe(404);
    expect((await request(app).get("/p/nobody-000000")).status).toBe(404);
    const again = await request(app).put("/api/me/public-profile").set(A).send({ enabled: true });
    expect(again.body.settings.id).toBe(slug); // same link when turned back on
  });

  it("disappears with the account", async () => {
    await readyUser();
    const slug = (await request(app).put("/api/me/public-profile").set(A).send({ enabled: true })).body.settings.id;
    await request(app).delete("/api/account").set(A);
    expect((await request(app).get(`/p/${slug}`)).status).toBe(404);
  });

  it("needs sign-in and a finished profile", async () => {
    expect((await request(app).put("/api/me/public-profile").send({ enabled: true })).status).toBe(401);
    expect((await request(app).put("/api/me/public-profile").set({ Authorization: "Bearer dev:newbie" }).send({ enabled: true })).status).toBe(409);
  });
});
