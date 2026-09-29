import { beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_PROJECT } from "./project";

/* The reported bug: as a guest, opening chess (or creating anything)
   vanished on navigation, because full page loads wipe JS memory and
   guests persisted nowhere. Guests now persist per-tab. */
function memoryBox() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("guest persistence", () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as Record<string, unknown>).localStorage = memoryBox();
    (globalThis as Record<string, unknown>).sessionStorage = memoryBox();
  });

  it("guest work survives a full reload in the same tab", async () => {
    const first = await import("./store");
    first.projectsStore.set({ demo: structuredClone(SAMPLE_PROJECT) });
    first.currentIdStore.set("demo");
    first.createProject("Guest Game");

    vi.resetModules();
    const second = await import("./store");
    const ids = Object.keys(second.projectsStore.get()).sort();
    expect(ids).toEqual(["demo", "guest-game"]);
    expect(second.currentIdStore.get()).toBe("guest-game");
  });

  it("guest data never touches localStorage", async () => {
    const first = await import("./store");
    first.createProject("Private Sketch");
    const ls = (globalThis as Record<string, { getItem: (k: string) => string | null }>).localStorage;
    expect(ls.getItem("uxn.projects.v1")).toBeNull();
    const ss = (globalThis as Record<string, { getItem: (k: string) => string | null }>).sessionStorage;
    expect(ss.getItem("uxn.projects.v1")).not.toBeNull();
  });

  it("logins read localStorage and adopt tab work once", async () => {
    const first = await import("./store");
    first.createProject("Before Login");
    // Log in: session appears, then a fresh tab load adopts the work.
    (globalThis as Record<string, { setItem: (k: string, v: string) => void }>).localStorage.setItem(
      "uxn.session",
      JSON.stringify({ name: "u", email: "u@x.yy", access: "a", refresh: "r" }),
    );
    vi.resetModules();
    const second = await import("./store");
    expect(Object.keys(second.projectsStore.get())).toContain("before-login");
    expect(
      (globalThis as Record<string, { getItem: (k: string) => string | null }>).localStorage.getItem(
        "uxn.projects.v1",
      ),
    ).not.toBeNull();
  });
});
