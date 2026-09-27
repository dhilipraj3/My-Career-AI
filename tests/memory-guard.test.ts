import { describe, expect, it } from "vitest";
import { readJsonLimited } from "../server/jobs/http.js";
import { heapFraction, maxParallelDownloads, waitForMemory } from "../server/memory.js";

const response = (body: string, headers: Record<string, string> = {}) => new Response(body, { headers });

describe("memory guards for background downloads", () => {
  it("reads a normal JSON answer and refuses one that is too big", async () => {
    expect(await readJsonLimited<{ a: number }>(response('{"a":1}'), "example.com", 1000)).toEqual({ a: 1 });
    await expect(readJsonLimited(response("[" + "1,".repeat(2000) + "1]"), "example.com", 1000)).rejects.toThrow(/too large/);
    await expect(readJsonLimited(response("{}", { "content-length": "99999999" }), "example.com", 1000)).rejects.toThrow(/too large/);
  });

  it("says yes when there is room, and gives up (instead of crashing) when there is none", async () => {
    expect(heapFraction()).toBeGreaterThan(0);
    expect(heapFraction()).toBeLessThan(1);
    expect(await waitForMemory(0.999, 200)).toBe(true);
    expect(await waitForMemory(0, 600)).toBe(false); // nothing is ever below 0: it waits, then gives up
  });

  it("never asks for more parallel downloads than requested", () => {
    expect(maxParallelDownloads(6)).toBeLessThanOrEqual(6);
    expect(maxParallelDownloads(1)).toBe(1);
  });
});
