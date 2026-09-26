import { beforeEach, describe, expect, it } from "vitest";
import { extractResumeText, ResumeError } from "../server/resume/extract.js";
import { FakeProvider, RESUME_TEXT, freshEnv } from "./fixtures.js";

// Smallest valid-looking headers: the code only checks magic bytes, the "model" is faked.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

describe("photo resumes (vision)", () => {
  let gemini: FakeProvider;
  beforeEach(() => {
    gemini = new FakeProvider("gemini", () => RESUME_TEXT);
    (gemini as any).kind = "gemini";
    freshEnv({ gemini });
  });

  it("reads a JPEG and a PNG through the vision model, sending the image", async () => {
    for (const img of [JPEG, PNG]) {
      const out = await extractResumeText(img, "cv.jpg", "u1");
      expect(out.format).toBe("image");
      expect(out.text.length).toBeGreaterThan(120);
    }
    const sent = gemini.calls[0].files!;
    expect(sent[0].mime).toBe("image/jpeg");
    expect(gemini.calls[1].files![0].mime).toBe("image/png");
  });

  it("never sends images to a non-vision provider", async () => {
    const compat = new FakeProvider("groq", () => RESUME_TEXT);
    (compat as any).kind = "compat";
    freshEnv({ fallback: compat });
    await expect(extractResumeText(JPEG, "cv.jpg", "u1")).rejects.toBeInstanceOf(ResumeError);
    expect(compat.calls).toHaveLength(0);
  });

  it("says so plainly when AI is unavailable", async () => {
    freshEnv();
    await expect(extractResumeText(JPEG, "cv.jpg", "u1")).rejects.toThrow(/needs AI/);
  });

  it("still rejects unknown files", async () => {
    await expect(extractResumeText(Buffer.from("GIF89a....."), "cv.gif", "u1")).rejects.toMatchObject({ code: "unsupported_type" });
  });
});
