import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { composeBriefing, partOfDay } from "../server/agent/briefing.js";
import type { Journey } from "../shared/career.js";
import { RESUME_TEXT, freshEnv } from "./fixtures.js";

const app = createApp();
const A = { Authorization: "Bearer dev:alice" };
beforeEach(() => { freshEnv(); });

const pulse = { active: 0, applied: 0, responses: 0, interviews: 0, offers: 0, responseRate: null, upcoming: [] };
const base = (o: Partial<Journey>): Journey => ({ stage: "searching", stageIndex: 1, understanding: 80, pulse, actions: [], ...o });
const NOW = new Date("2026-09-30T04:30:00Z").getTime(); // 10:00 in India

describe("guide briefing", () => {
  it("greets by the Indian time of day", () => {
    expect(partOfDay(new Date("2026-09-30T04:30:00Z").getTime())).toBe("morning");
    expect(partOfDay(new Date("2026-09-30T09:30:00Z").getTime())).toBe("afternoon"); // 15:00 IST
    expect(partOfDay(new Date("2026-09-30T14:30:00Z").getTime())).toBe("evening"); // 20:00 IST
  });

  it("points at excellent matches and names the next action", () => {
    const b = composeBriefing(base({ actions: [{ id: "new_matches", kind: "new_matches", priority: 66, title: "3 new matches since your last visit", detail: "", cta: { label: "See matches", page: "matches" } }] }), { name: "Priya", lang: "en", total: 8, excellent: 3, now: NOW });
    expect(b.pose).toBe("pointing");
    expect(b.lines[0]).toBe("Good morning, Priya!");
    expect(b.lines.join(" ")).toMatch(/3 look excellent/);
    expect(b.cta).toMatchObject({ label: "See matches", page: "matches" });
  });

  it("encourages before an interview, celebrates offers and placement", () => {
    const soon = new Date(NOW + 2 * 86_400_000).toISOString();
    const iv = composeBriefing(base({ stage: "interviewing", pulse: { ...pulse, upcoming: [{ applicationId: "a1", jobId: "j", company: "Acme", role: "PM", at: soon }] } }), { name: "", lang: "en", total: 0, excellent: 0, now: NOW });
    expect(iv.pose).toBe("encouraging");
    expect(iv.lines.join(" ")).toMatch(/interview with Acme in 2 days/);
    expect(iv.cta?.page).toBe("interview");
    const offer = composeBriefing(base({ stage: "offer", actions: [{ id: "o", kind: "offer", priority: 95, title: "You have an offer from Beta", detail: "", cta: { label: "Review", page: "applications" } }] }), { name: "Raj", lang: "en", total: 0, excellent: 0, now: NOW });
    expect(offer).toMatchObject({ pose: "celebrating" });
    expect(offer.lines.join(" ")).toContain("Beta has made you an offer");
    const placed = composeBriefing(base({ stage: "placed", placement: { company: "Gamma", role: "PM", at: "2026-09-29" } }), { name: "Raj", lang: "en", total: 0, excellent: 0, now: NOW });
    expect(placed.pose).toBe("celebrating");
  });

  it("changes its id only when the situation changes (so the client does not repeat itself)", () => {
    const j = base({});
    const a = composeBriefing(j, { name: "P", lang: "en", total: 5, excellent: 1, now: NOW });
    const b = composeBriefing(j, { name: "P", lang: "en", total: 5, excellent: 1, now: NOW + 3_600_000 });
    const c = composeBriefing(j, { name: "P", lang: "en", total: 5, excellent: 2, now: NOW });
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
  });

  it("speaks Hindi when asked", () => {
    const b = composeBriefing(base({ stage: "understanding" }), { name: "प्रिया", lang: "hi", total: 0, excellent: 0, now: NOW });
    expect(b.lines[0]).toBe("सुप्रभात प्रिया!");
    expect(b.lines[1]).toMatch(/प्रोफ़ाइल/);
  });

  it("is served for a signed-in user only", async () => {
    expect((await request(app).get("/api/agent/briefing")).status).toBe(401);
    await request(app).post("/api/resume").set(A).attach("resume", Buffer.from(RESUME_TEXT), "cv.txt");
    for (let i = 0; i < 50; i++) { const me = await request(app).get("/api/me").set(A); if (["needs_info", "ready"].includes(me.body.profile?.status)) break; await new Promise((r) => setTimeout(r, 40)); }
    const r = await request(app).get("/api/agent/briefing?lang=en").set(A);
    expect(r.status).toBe(200);
    expect(r.body.briefing.lines[0]).toMatch(/^Good (morning|afternoon|evening)/);
    expect(typeof r.body.briefing.id).toBe("string");
  });
});
