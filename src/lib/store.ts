/* Project store: the single source of truth the canvas, inspector,
   sprite editor, graph, sound mixer and exporter all read.
   Persistence is gated on login — guests work purely in memory (see
   SessionBanner), so nothing implies saving that isn't happening. */
import { atom, computed } from "nanostores";
import { MAX_OBJECTS, SAMPLE_PROJECT, migrateProject, type ObjectKind, type Project, type SceneObject } from "./project";
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
  const loggedIn = !!getSession();
  // Guests read per-tab storage (survives full page loads in this tab);
  // logins read local storage, adopting tab work once when it is absent.
  let raw = loggedIn ? localStorage.getItem(STORE_KEY) : sessionStorage.getItem(STORE_KEY);
  let adopted = false;
  if (loggedIn && !raw) {
    raw = sessionStorage.getItem(STORE_KEY);
    adopted = !!raw;
  }
  try {
    if (raw) {
      const anyRaw = JSON.parse(raw) as Record<string, unknown>;
      if (anyRaw["projects"] && typeof anyRaw["projects"] === "object") {
        const projects: Record<string, Project> = {};
        for (const [id, p] of Object.entries(anyRaw["projects"] as Record<string, unknown>)) {
          projects[id] = migrateProject(p as Record<string, unknown>);
        }
        const ids = Object.keys(projects);
        if (ids.length > 0) {
          const current =
            typeof anyRaw["current"] === "string" && projects[anyRaw["current"]]
              ? (anyRaw["current"] as string)
              : ids[0];
          const out = { projects, current };
          // Adopted guest work after a login: write it through so the
          // next fresh tab finds it under the account.
          if (adopted) {
            try {
              localStorage.setItem(STORE_KEY, JSON.stringify(out));
            } catch {
              /* quota */
            }
          }
          return out;
        }
      } else {
        // Single-project shape (current or legacy): migrate in place.
        const parsed = migrateProject(anyRaw);
        if (parsed.scenes.some((s) => s.id === parsed.start)) {
          return { projects: { [parsed.id]: parsed }, current: parsed.id };
        }
      }
    }
    // One-time migration from the single-project era (localStorage only).
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
export const spriteSelStore = atom<string>("hero");
export const paintColorStore = atom<number>(1);
export const paintToolStore = atom<"brush" | "erase">("brush");
export const voiceSelStore = atom<number>(0);
export const codeFileStore = atom<string>("main.ux");
export const viewStore = atom<"scene" | "sprites" | "events" | "sound" | "code">("scene");

if (typeof localStorage !== "undefined") {
  const persist = (all: Record<string, Project>, id: string) => {
    // Guests write per-tab storage only; logins write local storage.
    const box = getSession() ? localStorage : sessionStorage;
    try {
      box.setItem(STORE_KEY, JSON.stringify({ projects: all, current: id }));
    } catch {
      /* quota/private mode — memory copy keeps working */
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
  sceneIdStore.set(all[id].start || all[id].scenes[0]?.id || "");
  selectionStore.set(null);
  viewStore.set(all[id].kind === "code" ? "code" : "scene");
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
  // Legacy 1bpp paint API: upgrades into the shared sprite.
  const p = projectStore.get();
  const scene = currentScene(p, sceneIdStore.get());
  const obj = scene.objects.find((o) => o.id === objectId);
  if (!obj) return;
  setSpritePixels(obj.sprite, tile.flatMap((b) => Array.from({ length: 8 }, (_, c) => (b & (1 << (7 - c)) ? 1 : 0))));
}

export function setSpritePixels(spriteId: string, pixels: number[]): void {
  const clean = pixels.slice(0, 64).map((v) => v & 3);
  while (clean.length < 64) clean.push(0);
  updateCurrent((prev) => ({
    ...prev,
    sprites: prev.sprites.map((s) => (s.id === spriteId ? { ...s, pixels: clean } : s)),
  }));
}

export function addSprite(name: string): string {
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "sprite";
  if (!/^[A-Za-z]/.test(base)) base = `s_${base}`;
  let id = base;
  let n = 2;
  const p = projectStore.get();
  while (p.sprites.some((s) => s.id === id)) id = `${base}_${n++}`;
  updateCurrent((prev) => ({ ...prev, sprites: [...prev.sprites, { id, pixels: Array(64).fill(0) }] }));
  spriteSelStore.set(id);
  return id;
}

export function addAnimation(spriteIds: string[]): string {
  const p = projectStore.get();
  let id = "anim";
  let n = 2;
  while (p.anims.some((a) => a.id === id)) id = `anim_${n++}`;
  updateCurrent((prev) => ({
    ...prev,
    anims: [...prev.anims, { id, frames: spriteIds.length > 0 ? spriteIds : [prev.sprites[0]?.id ?? "hero"], rate: 30, loop: true }],
  }));
  return id;
}

export function addScene(): string {
  const p = projectStore.get();
  let id = "scene";
  let n = 2;
  while (p.scenes.some((s) => s.id === id)) id = `scene_${n++}`;
  updateCurrent((prev) => ({
    ...prev,
    scenes: [...prev.scenes, { id, objects: [], clicks: [], keys: [] }],
  }));
  sceneIdStore.set(id);
  selectionStore.set(null);
  return id;
}

export function deleteScene(id: string): void {
  const p = projectStore.get();
  if (p.scenes.length <= 1) return;
  updateCurrent((prev) => {
    const scenes = prev.scenes.filter((s) => s.id !== id);
    const start = prev.start === id ? scenes[0].id : prev.start;
    return {
      ...prev,
      start,
      scenes: scenes.map((s) => ({
        ...s,
        clicks: s.clicks.filter((c) => c.goto !== id),
        keys: s.keys.filter((k) => k.goto !== id),
      })),
    };
  });
  if (sceneIdStore.get() === id) {
    const rest = projectStore.get().scenes;
    sceneIdStore.set(rest[0].id);
    selectionStore.set(null);
  }
}

export function addObject(kind: ObjectKind = "static", name = "", sprite?: string): string {
  const p = projectStore.get();
  const scene = currentScene(p, sceneIdStore.get());
  const clean = name.trim().slice(0, 24);
  let id = clean && /^[A-Za-z][A-Za-z0-9_]*$/.test(clean) ? clean : "obj";
  let n = 2;
  const base = id;
  while (scene.objects.some((o) => o.id === id)) id = `${base}_${n++}`;
  const [cx, cy] = clampToCanvas(8 + scene.objects.length * 12, 8, p.width, p.height);
  const obj: SceneObject = {
    id,
    x: cx,
    y: cy,
    sprite: sprite ?? p.sprites[0]?.id ?? "hero",
    kind,
    ...(kind === "player" ? { controls: true } : {}),
    ...(kind === "movable" ? { solid: true } : {}),
  };
  updateCurrent((prev) => ({
    ...prev,
    scenes: prev.scenes.map((s) =>
      s.id !== scene.id ? s : { ...s, objects: [...s.objects, obj] },
    ),
  }));
  selectionStore.set(id);
  return id;
}

export function deleteObject(objectId: string): void {
  const p = projectStore.get();
  const scene = currentScene(p, sceneIdStore.get());
  updateCurrent((prev) => ({
    ...prev,
    scenes: prev.scenes.map((s) =>
      s.id !== scene.id
        ? s
        : {
            ...s,
            objects: s.objects.filter((o) => o.id !== objectId),
            clicks: s.clicks.filter((c) => c.object !== objectId),
          },
    ),
  }));
  if (selectionStore.get() === objectId) selectionStore.set(null);
}

/** Rename an object id everywhere it is referenced (click bindings). */
export function renameObject(oldId: string, newId: string): string | null {
  const clean = newId.trim().slice(0, 24);
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(clean)) return "bad id";
  const p = projectStore.get();
  const scene = currentScene(p, sceneIdStore.get());
  if (oldId !== clean && scene.objects.some((o) => o.id === clean)) return "duplicate id";
  updateCurrent((prev) => ({
    ...prev,
    scenes: prev.scenes.map((s) =>
      s.id !== scene.id
        ? s
        : {
            ...s,
            objects: s.objects.map((o) => (o.id === oldId ? { ...o, id: clean } : o)),
            clicks: s.clicks.map((c) => (c.object === oldId ? { ...c, object: clean } : c)),
          },
    ),
  }));
  if (selectionStore.get() === oldId) selectionStore.set(clean);
  return null;
}

/** Reorder within a scene (hierarchy drag). Slots — and draw order — follow. */
export function reorderObject(from: number, to: number): void {
  const p = projectStore.get();
  const scene = currentScene(p, sceneIdStore.get());
  if (from === to || from < 0 || to < 0 || from >= scene.objects.length || to >= scene.objects.length) return;
  updateCurrent((prev) => ({
    ...prev,
    scenes: prev.scenes.map((s) => {
      if (s.id !== scene.id) return s;
      const objects = [...s.objects];
      const [moved] = objects.splice(from, 1);
      objects.splice(to, 0, moved);
      return { ...s, objects };
    }),
  }));
}

/** Move an object to another scene (cross-scene hierarchy drop). */
export function moveObjectToScene(objectId: string, targetSceneId: string): void {
  const p = projectStore.get();
  const scene = currentScene(p, sceneIdStore.get());
  if (scene.id === targetSceneId) return;
  const obj = scene.objects.find((o) => o.id === objectId);
  const target = p.scenes.find((s) => s.id === targetSceneId);
  if (!obj || !target || target.objects.length >= MAX_OBJECTS) return;
  const [cx, cy] = clampToCanvas(obj.x, obj.y, p.width, p.height);
  updateCurrent((prev) => ({
    ...prev,
    scenes: prev.scenes.map((s) => {
      if (s.id === scene.id)
        return {
          ...s,
          objects: s.objects.filter((o) => o.id !== objectId),
          clicks: s.clicks.filter((c) => c.object !== objectId),
        };
      if (s.id === targetSceneId) return { ...s, objects: [...s.objects, { ...obj, x: cx, y: cy }] };
      return s;
    }),
  }));
  sceneIdStore.set(targetSceneId);
  selectionStore.set(objectId);
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
