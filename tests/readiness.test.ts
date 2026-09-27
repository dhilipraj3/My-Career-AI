import { describe, expect, it } from "vitest";
import { readiness } from "../src/lib/readiness";

describe("the dashboard's readiness score", () => {
  it("is low for a fresh profile with no matches yet, and says so", () => {
    const r = readiness({ profileCompleteness: 20, understanding: 10, matches: { total: 0, excellent: 0, good: 0 } });
    expect(r.score).toBeLessThan(30);
    expect(r.label).toBe("Let's get you ready");
  });

  it("is high once the profile is strong and matches are excellent", () => {
    const r = readiness({ profileCompleteness: 95, understanding: 90, matches: { total: 20, excellent: 5, good: 8 } });
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.label).toBe("You're ready to apply");
  });

  it("is bounded 0..100 even with extreme inputs", () => {
    expect(readiness({ profileCompleteness: 100, understanding: 100, matches: { total: 50, excellent: 50, good: 50 } }).score).toBeLessThanOrEqual(100);
    expect(readiness({ profileCompleteness: 0, understanding: 0, matches: { total: 0, excellent: 0, good: 0 } }).score).toBeGreaterThanOrEqual(0);
  });

  it("points at the weakest of the three inputs, not a generic message", () => {
    const weakProfile = readiness({ profileCompleteness: 10, understanding: 90, matches: { total: 10, excellent: 3, good: 2 } });
    expect(weakProfile.detail).toMatch(/profile/i);
    const weakMatches = readiness({ profileCompleteness: 90, understanding: 90, matches: { total: 0, excellent: 0, good: 0 } });
    expect(weakMatches.detail).toMatch(/searching/i);
  });
});
