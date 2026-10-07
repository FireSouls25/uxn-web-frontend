import { beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_PROJECT } from "./project";

/* Projects and the studio sit behind RequireAuth, so there is no
   guest path: work always persists to localStorage and survives
   full page loads. */
function memoryBox() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("account persistence", () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as unknown as Record<string, unknown>).localStorage = memoryBox();
    (globalThis as unknown as Record<string, unknown>).sessionStorage = memoryBox();
  });

  it("work survives a full reload", async () => {
    const first = await import("./store");
    first.projectsStore.set({ demo: structuredClone(SAMPLE_PROJECT) });
    first.currentIdStore.set("demo");
    first.createProject("My Game");

    vi.resetModules();
    const second = await import("./store");
    const ids = Object.keys(second.projectsStore.get()).sort();
    expect(ids).toEqual(["demo", "my-game"]);
    expect(second.currentIdStore.get()).toBe("my-game");
  });

  it("work is written to localStorage", async () => {
    const first = await import("./store");
    first.createProject("Saved Sketch");
    const ls = (globalThis as unknown as Record<string, { getItem: (k: string) => string | null }>).localStorage;
    expect(ls.getItem("uxn.projects.v1")).not.toBeNull();
  });
});
