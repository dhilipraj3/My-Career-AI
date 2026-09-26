import { describe, expect, it } from "vitest";
import { quickThinking } from "../server/ai/providers.js";
import { firstName } from "../shared/format.js";

describe("quick replies for chat", () => {
  it("switches thinking off where the model allows it, and leaves other models alone", () => {
    expect(quickThinking("gemini-2.5-flash")).toEqual({ thinkingBudget: 0 });
    expect(quickThinking("gemini-2.5-flash-lite")).toEqual({ thinkingBudget: 0 });
    expect(quickThinking("gemini-3-flash-preview")).toEqual({ thinkingLevel: "LOW" });
    expect(quickThinking("gemini-2.5-pro")).toBeUndefined(); // cannot switch thinking off
  });
});

describe("the name Asha greets you by", () => {
  it("skips initials and uses one rule everywhere", () => {
    expect(firstName("B. Rajkumar")).toBe("Rajkumar");
    expect(firstName("K. Priya")).toBe("Priya");
    expect(firstName("Priya Sharma")).toBe("Priya");
    expect(firstName("Rajkumar")).toBe("Rajkumar");
    expect(firstName("")).toBe("");
  });
});
