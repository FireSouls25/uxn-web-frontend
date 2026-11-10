import { describe, expect, it } from "vitest";
import { retrieveContext, formatContext } from "./rag";

describe("in-page rag", () => {
  it("finds sound rules for a music question", () => {
    const hits = retrieveContext("how do I play a sound effect");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].text.toLowerCase()).toMatch(/sound|play|song|audio/);
  });

  it("finds sprite rules for a sprite question", () => {
    const hits = retrieveContext("create a multi-tile sprite");
    expect(hits.length).toBeGreaterThan(0);
    expect(JSON.stringify(hits).toLowerCase()).toMatch(/sprite|tile|2bpp/);
  });

  it("returns empty for empty/stopword queries", () => {
    expect(retrieveContext("")).toEqual([]);
    expect(retrieveContext("the and of")).toEqual([]);
  });

  it("respects k and formats a context block", () => {
    const hits = retrieveContext("alarm timer wait slot", 2);
    expect(hits.length).toBeLessThanOrEqual(2);
    if (hits.length > 0) expect(formatContext(hits)).toMatch(/Relevant rules/);
    else expect(formatContext(hits)).toBe("");
  });
});
