import { describe, it, expect } from "vitest";
import { detectCrisis, CRISIS_MESSAGE } from "../src/safety";

describe("detectCrisis", () => {
  const positives = [
    "I want to kill myself",
    "sometimes I feel suicidal",
    "thinking about suicide",
    "I keep self-harming",
    "I have been self harm again",
    "I've been harming myself",
    "I want to hurt myself",
    "I just want to die",
    "I want to end my life",
    "I might take my own life",
    "KILL MYSELF", // case-insensitive
  ];
  for (const phrase of positives) {
    it(`flags: "${phrase}"`, () => {
      expect(detectCrisis(phrase)).toBe(true);
    });
  }

  const negatives = [
    "I had a great day",
    "I went for a walk and felt calmer",
    "work was busy but fine",
    "",
  ];
  for (const phrase of negatives) {
    it(`does not flag: "${phrase}"`, () => {
      expect(detectCrisis(phrase)).toBe(false);
    });
  }
});

describe("CRISIS_MESSAGE", () => {
  it("signposts Samaritans on 116 123", () => {
    expect(CRISIS_MESSAGE).toContain("116 123");
  });
});
