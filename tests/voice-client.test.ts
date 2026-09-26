import { describe, expect, it } from "vitest";
import { base64ToInt16, downsample, floatToPcm16, int16ToBase64, loudness, pcm16ToFloat } from "../src/lib/live/audio.js";
import { classify, effectiveTier, jitterBufferMs, shouldStepDown } from "../src/lib/netQuality.js";

const net = (o: Partial<Parameters<typeof classify>[0]>) => ({ rttMs: 120, downlinkMbps: 10, effectiveType: "4g", saveData: false, online: true, ...o });

describe("voice quality follows the connection", () => {
  it("offers live voice on a good connection", () => {
    expect(classify(net({})).tier).toBe("live");
    expect(classify(net({ downlinkMbps: null })).tier).toBe("live"); // Safari/Firefox: no estimate, pings decide
  });
  it("falls back to tap-to-talk on a slower one", () => {
    expect(classify(net({ downlinkMbps: 0.8 })).tier).toBe("lite");
    expect(classify(net({ rttMs: 700 })).tier).toBe("lite");
    expect(classify(net({ effectiveType: "3g" })).tier).toBe("lite");
  });
  it("uses text only when the line is poor, data is being saved, or offline", () => {
    expect(classify(net({ effectiveType: "2g" })).tier).toBe("text");
    expect(classify(net({ saveData: true })).tier).toBe("text");
    expect(classify(net({ rttMs: 2500 })).tier).toBe("text");
    expect(classify(net({ online: false })).tier).toBe("text");
    expect(classify(net({ saveData: true })).reason).toMatch(/Data Saver/);
  });
  it("respects the person's choice, but never tries live on a dead line", () => {
    expect(effectiveTier("live", "text", false)).toBe("text");
    expect(effectiveTier("live", "auto", true)).toBe("text"); // low-data mode
    expect(effectiveTier("lite", "live", false)).toBe("live");
    expect(effectiveTier("text", "live", false)).toBe("lite");
    expect(effectiveTier("lite", "auto", false)).toBe("lite");
  });
});

describe("during a live call", () => {
  it("steps down only when the audio keeps breaking up", () => {
    expect(shouldStepDown({ underruns: 1, lateChunks: 1, sendBacklogMs: 0, windowMs: 10_000 })).toBe(false);
    expect(shouldStepDown({ underruns: 3, lateChunks: 0, sendBacklogMs: 0, windowMs: 10_000 })).toBe(true);
    expect(shouldStepDown({ underruns: 0, lateChunks: 7, sendBacklogMs: 0, windowMs: 10_000 })).toBe(true);
    expect(shouldStepDown({ underruns: 0, lateChunks: 0, sendBacklogMs: 3000, windowMs: 10_000 })).toBe(true);
  });
  it("holds more audio on a shaky line, within limits", () => {
    expect(jitterBufferMs(100, 0)).toBe(120);
    expect(jitterBufferMs(400, 1)).toBeGreaterThan(jitterBufferMs(400, 0));
    expect(jitterBufferMs(3000, 5)).toBe(600);
  });
});

describe("audio conversion", () => {
  it("downsamples 48 kHz to 16 kHz", () => {
    const x = new Float32Array(480).fill(0.5);
    const y = downsample(x, 48000, 16000);
    expect(y.length).toBe(160);
    expect(y[10]).toBeCloseTo(0.5);
  });
  it("round-trips PCM16 through base64 without loss beyond quantisation", () => {
    const f = new Float32Array([0, 0.25, -0.5, 0.999, -1]);
    const back = pcm16ToFloat(base64ToInt16(int16ToBase64(floatToPcm16(f))));
    for (let i = 0; i < f.length; i++) expect(back[i]).toBeCloseTo(f[i], 3);
  });
  it("clips out-of-range samples instead of wrapping", () => {
    const pcm = floatToPcm16(new Float32Array([2, -2]));
    expect([pcm[0], pcm[1]]).toEqual([32767, -32768]);
  });
  it("measures loudness for lip sync", () => {
    expect(loudness(new Float32Array(100))).toBe(0);
    expect(loudness(new Float32Array(100).fill(0.2))).toBeCloseTo(0.8);
    expect(loudness(new Float32Array(100).fill(1))).toBe(1);
  });
});
