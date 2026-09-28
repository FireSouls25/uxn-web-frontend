/* Project store: the single source of truth the canvas, inspector
   and exporter all read. Persistence is gated on login — guests work
   purely in memory (see SessionBanner), so nothing implies saving
   that isn't happening. */
import { atom } from "nanostores";
import { SAMPLE_PROJECT, type Project, type SceneObject } from "./project";
import { getSession } from "./session";

const STORE_KEY = "uxn.project";

function loadInitial(): Project {
  if (typeof localStorage === "undefined") return structuredClone(SAMPLE_PROJECT);
  if (!getSession()) return structuredClone(SAMPLE_PROJECT);
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Project) : structuredClone(SAMPLE_PROJECT);
  } catch {
    return structuredClone(SAMPLE_PROJECT);
  }
}

export const projectStore = atom<Project>(loadInitial());
export const sceneIdStore = atom<string>(SAMPLE_PROJECT.start);
export const selectionStore = atom<string | null>(null);

if (typeof localStorage !== "undefined") {
  projectStore.subscribe((p) => {
    // Logged-out work stays in this tab only.
    if (!getSession()) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(p));
    } catch {
      /* quota — memory copy keeps working */
    }
  });
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
  projectStore.set(moveObject(p, scene.id, objectId, x, y));
}
