/* Project store: the single source of truth the canvas, inspector,
   sprite editor, graph, sound mixer and exporter all read.
   Persistence is gated on login — guests work purely in memory (see
   SessionBanner), so nothing implies saving that isn't happening. */
import { atom, computed } from "nanostores";
import { SAMPLE_PROJECT, type Project, type SceneObject } from "./project";
import { getSession } from "./session";

const STORE_KEY = "uxn.projects.v1";
const LEGACY_KEY = "uxn.project";

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "game"
  );
}

function freshSample(): Project {
  return structuredClone(SAMPLE_PROJECT);
}

function loadAll(): { projects: Record<string, Project>; current: string } {
  const fallback = () => ({ projects: { demo: freshSample() }, current: "demo" });
  if (typeof localStorage === "undefined") return fallback();
  // Logged-out work is memory-only: never read disk for guests.
  if (!getSession()) return fallback();
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { projects: Record<string, Project>; current: string };
      if (parsed.projects[parsed.current]) return parsed;
    }
    // One-time migration from the single-project era.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const p = JSON.parse(legacy) as Project;
      const id = p.id && /^[A-Za-z][A-Za-z0-9_]*$/.test(p.id) ? p.id : "demo";
      return { projects: { [id]: { ...p, id } }, current: id };
    }
  } catch {
    /* corrupt — start fresh */
  }
  return fallback();
}

const _initial = typeof localStorage === "undefined" ? null : loadAll();

export const projectsStore = atom<Record<string, Project>>(
  _initial?.projects ?? { demo: freshSample() },
);
export const currentIdStore = atom<string>(_initial?.current ?? "demo");
export const projectStore = computed(
  [projectsStore, currentIdStore],
  (all, id) => all[id] ?? all[Object.keys(all)[0]],
);
export const sceneIdStore = atom<string>(SAMPLE_PROJECT.start);
export const selectionStore = atom<string | null>(null);
export const viewStore = atom<"scene" | "sprites" | "events" | "sound" | "code">("scene");

if (typeof localStorage !== "undefined") {
  const persist = (all: Record<string, Project>, id: string) => {
    // Logged-out work stays in this tab only.
    if (!getSession()) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ projects: all, current: id }));
    } catch {
      /* quota — memory copy keeps working */
    }
  };
  projectsStore.subscribe((all) => persist(all, currentIdStore.get()));
  currentIdStore.subscribe((id) => persist(projectsStore.get(), id));
}

function touch(p: Project): Project {
  return { ...p, updatedAt: Date.now() };
}

export function openProject(id: string): void {
  const all = projectsStore.get();
  if (!all[id]) return;
  currentIdStore.set(id);
  sceneIdStore.set(all[id].start);
  selectionStore.set(null);
  viewStore.set("scene");
}

export function createProject(name: string): string {
  const clean = name.trim().slice(0, 48) || "Untitled";
  let id = slug(clean);
  const all = projectsStore.get();
  let n = 2;
  while (all[`${id}`]) id = `${slug(clean)}-${n++}`;
  const base = freshSample();
  const p: Project = {
    ...base,
    id,
    name: clean,
    author: base.author,
    scenes: [{ id: "main", objects: [], clicks: [], keys: [] }],
    start: "main",
    updatedAt: Date.now(),
  };
  projectsStore.set({ ...all, [id]: p });
  openProject(id);
  return id;
}

export function deleteProject(id: string): void {
  const all = { ...projectsStore.get() };
  delete all[id];
  const rest = Object.keys(all);
  if (rest.length === 0) {
    const fresh = freshSample();
    projectsStore.set({ [fresh.id]: touch(fresh) });
    openProject(fresh.id);
    return;
  }
  projectsStore.set(all);
  if (currentIdStore.get() === id) openProject(rest[0]);
}

function updateCurrent(fn: (p: Project) => Project): void {
  const id = currentIdStore.get();
  const all = projectsStore.get();
  if (all[id]) projectsStore.set({ ...all, [id]: touch(fn(all[id])) });
}

/** Clamp a dragged position so the 8px sprite stays on-canvas. */
export function clampToCanvas(x: number, y: number, w: number, h: number): [number, number] {
  return [Math.min(Math.max(0, Math.round(x)), Math.max(0, w - 8)), Math.min(Math.max(0, Math.round(y)), Math.max(0, h - 8))];
}

export function currentScene(p: Project, sceneId: string) {
  return p.scenes.find((s) => s.id === sceneId) ?? p.scenes[0];
}

export function moveObject(project: Project, sceneId: string, objectId: string, x: number, y: number): Project {
  const [cx, cy] = clampToCanvas(x, y, project.width, project.height);
  return {
    ...project,
    scenes: project.scenes.map((s) =>
      s.id !== sceneId
        ? s
        : {
            ...s,
            objects: s.objects.map((o): SceneObject => (o.id === objectId ? { ...o, x: cx, y: cy } : o)),
          },
    ),
  };
}

export function setObjectPos(objectId: string, x: number, y: number): void {
  const p = projectStore.get();
  const scene = currentScene(p, sceneIdStore.get());
  updateCurrent((prev) => moveObject(prev, scene.id, objectId, x, y));
}

export function patchObject(objectId: string, patch: Partial<SceneObject>): void {
  const p = projectStore.get();
  const scene = currentScene(p, sceneIdStore.get());
  updateCurrent((prev) => ({
    ...prev,
    scenes: prev.scenes.map((s) =>
      s.id !== scene.id
        ? s
        : { ...s, objects: s.objects.map((o) => (o.id === objectId ? { ...o, ...patch } : o)) },
    ),
  }));
}

export function setTile(objectId: string, tile: number[]): void {
  patchObject(objectId, { tile: [...tile] });
}

export function resizeProject(w: number, h: number): void {
  updateCurrent((prev) => ({
    ...prev,
    width: w,
    height: h,
    scenes: prev.scenes.map((s) => ({
      ...s,
      objects: s.objects.map((o) => {
        const [cx, cy] = clampToCanvas(o.x, o.y, w, h);
        return { ...o, x: cx, y: cy };
      }),
    })),
  }));
}

export function addBinding(
  kind: "click" | "key",
  objectId: string | null,
  goto: string,
  key?: number,
): void {
  const p = projectStore.get();
  const scene = currentScene(p, sceneIdStore.get());
  updateCurrent((prev) => ({
    ...prev,
    scenes: prev.scenes.map((s) => {
      if (s.id !== scene.id) return s;
      if (kind === "click" && objectId) return { ...s, clicks: [...s.clicks, { object: objectId, goto }] };
      return { ...s, keys: [...s.keys, { key: key ?? 32, goto }] };
    }),
  }));
}

export function removeBinding(kind: "click" | "key", index: number): void {
  const p = projectStore.get();
  const scene = currentScene(p, sceneIdStore.get());
  updateCurrent((prev) => ({
    ...prev,
    scenes: prev.scenes.map((s) => {
      if (s.id !== scene.id) return s;
      if (kind === "click") return { ...s, clicks: s.clicks.filter((_, i) => i !== index) };
      return { ...s, keys: s.keys.filter((_, i) => i !== index) };
    }),
  }));
}

export function setVoice(index: number, note: number, vol: number): void {
  updateCurrent((prev) => {
    const voices = [0, 1, 2, 3].map((i) => prev.sound?.voices[i] ?? { note: 0, vol: 0 });
    voices[index] = { note, vol };
    return { ...prev, sound: { voices } };
  });
}
