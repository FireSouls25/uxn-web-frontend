import { useState } from "react";
import { useStore } from "@nanostores/react";
import {
  Box,
  Braces,
  Download,
  FilePlus2,
  Image,
  Loader2,
  Magnet,
  Maximize,
  Grid3x3,
  Play,
  TerminalSquare,
  Gamepad2,
  Workflow,
  X,
} from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { compileProject, exportProject, type ExportMode, type ExportTarget } from "../lib/export";
import {
  addScene,
  canvasModeStore,
  deleteScene,
  openPlaytest,
  patchViewport,
  projectStore,
  reorderScenes,
  resetViewport,
  sceneIdStore,
  selectionStore,
  viewportStore,
  viewStore,
} from "../lib/store";

/* Studio header: project identity + scene tabs (click, +/x,
   drag-across to reorder) + the Scene|Logic canvas toggle +
   snap/grid/fit + sprite/sound/code dialogs + playtest + an export
   popover. Replaces ProjectBar and the StudioRail view switching. */
export default function StudioHeader() {
  const lang = useLang();
  const project = useStore(projectStore);
  const sceneId = useStore(sceneIdStore);
  const view = useStore(viewStore);
  const mode = useStore(canvasModeStore);
  const vp = useStore(viewportStore);
  const [dragTab, setDragTab] = useState<number | null>(null);
  const [expOpen, setExpOpen] = useState(false);
  const [target, setTarget] = useState<ExportTarget>("web");
  const [expMode, setExpMode] = useState<ExportMode>("bundle");
  const [playBusy, setPlayBusy] = useState(false);
  const [expBusy, setExpBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const locked = !!project.locked;
  const isCode = project.kind === "code";

  function pickScene(id: string) {
    sceneIdStore.set(id);
    selectionStore.set(null);
  }

  function setMode(m: "scene" | "logic") {
    canvasModeStore.set(m);
    viewStore.set(m === "scene" ? "scene" : "events");
  }

  function selectCategory(id: "scene" | "logic" | "sprites" | "sound" | "code") {
    if (id === "scene" || id === "logic") setMode(id);
    else viewStore.set(view === id ? "scene" : id);
  }

  const activeCategory: "scene" | "logic" | "sprites" | "sound" | "code" =
    view === "sprites" || view === "sound" || view === "code"
      ? view
      : mode === "logic"
        ? "logic"
        : "scene";

  async function playtest() {
    setPlayBusy(true);
    setMessage(null);
    try {
      const result = await compileProject(projectStore.get(), "web", "bundle", lang);
      if (!result.ok || !result.bytes) {
        setMessage(result.message);
        return;
      }
      openPlaytest(URL.createObjectURL(new Blob([result.bytes as BlobPart], { type: "text/html" })));
      setMessage(t(lang, "exp.play_ready"));
    } finally {
      setPlayBusy(false);
    }
  }

  async function download() {
    setExpBusy(true);
    try {
      const result = await exportProject(projectStore.get(), target, expMode, lang);
      setMessage(result.message);
    } finally {
      setExpBusy(false);
    }
  }

  const seg = (active: boolean) =>
    `rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors ${
      active ? "seg-active" : "text-subtext0 hover:bg-surface0 hover:text-text"
    }`;
  const iconBtn = (active: boolean) =>
    `grid size-7 place-items-center rounded-md transition-colors ${
      active ? "seg-active" : "text-subtext0 hover:bg-surface0 hover:text-text"
    }`;
  const catBtn = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${
      active ? "seg-active" : "text-subtext0 hover:bg-surface0 hover:text-text"
    }`;

  const categories = (
    [
      ["scene", Image, "hdr.mode_scene"],
      ["logic", Workflow, "hdr.mode_logic"],
      ["sprites", Gamepad2, "hdr.sprites"],
      ["sound", Braces, "hdr.sound"],
      ["code", TerminalSquare, "hdr.code"],
    ] as const
  );

  return (
    <div className="border-b border-surface0 bg-mantle/95 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <a href="/" className="flex items-center gap-2" title="uxn·forge">
          <span className="grid size-7 place-items-center rounded-md seg-active">
            <Box size={17} strokeWidth={2.4} />
          </span>
          <span className="font-mono text-sm font-semibold tracking-tight">
            uxn<span className="text-subtext0">·</span>forge
          </span>
        </a>
        <span className="hidden h-5 w-px bg-surface0 sm:block" />
        <span className="max-w-44 truncate text-[14px] font-bold tracking-tight">{project.name}</span>
        <span
          className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${
            isCode ? "bg-teal/15 text-teal" : "tint-text-10 text-subtext1"
          }`}
        >
          {isCode ? t(lang, "proj.code_kind") : t(lang, "proj.visual_kind")}
        </span>
        {project.locked && (
          <span className="rounded-full bg-yellow/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-yellow">
            {t(lang, "proj.locked")}
          </span>
        )}

        {!isCode && (
          <nav aria-label="workspace" className="mx-auto flex items-center gap-1 rounded-xl border border-surface0 bg-mantle p-1">
            {categories.map(([id, Icon, label]) => (
              <button
                key={id}
                onClick={() => selectCategory(id)}
                title={t(lang, label)}
                aria-label={t(lang, label)}
                aria-pressed={activeCategory === id}
                className={catBtn(activeCategory === id)}
              >
                <Icon size={14} />
                {t(lang, label)}
              </button>
            ))}
          </nav>
        )}

        {!isCode && (
          <span className="inline-flex items-center gap-0.5">
            <button
              onClick={() => patchViewport({ snap: !vp.snap })}
              title={t(lang, "canvas.snap")}
              aria-label={t(lang, "canvas.snap")}
              aria-pressed={vp.snap}
              className={iconBtn(vp.snap)}
            >
              <Magnet size={14} />
            </button>
            <button
              onClick={() => patchViewport({ grid: !vp.grid })}
              title={t(lang, "canvas.grid")}
              aria-label={t(lang, "canvas.grid")}
              aria-pressed={vp.grid}
              className={iconBtn(vp.grid)}
            >
              <Grid3x3 size={14} />
            </button>
            <button
              onClick={resetViewport}
              title={t(lang, "map.fit")}
              aria-label={t(lang, "map.fit")}
              className={iconBtn(false)}
            >
              <Maximize size={14} />
            </button>
          </span>
        )}

        <button
          onClick={playtest}
          disabled={playBusy}
          className="seg-active inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold disabled:opacity-70"
        >
          {playBusy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {playBusy ? t(lang, "exp.working") : t(lang, "exp.playtest")}
        </button>

        <span className="relative">
          <button onClick={() => setExpOpen((v) => !v)} aria-expanded={expOpen} className={seg(expOpen)}>
            {t(lang, "hdr.export")}
          </button>
          {expOpen && (
            <div className="dock absolute right-0 top-full z-30 mt-2 w-56 rounded-2xl p-3">
              <p className="mb-1 font-mono text-[11px] text-subtext0">{t(lang, "exp.target")}</p>
              <div className="flex gap-1">
                {(["web", "linux"] as const).map((id) => (
                  <button key={id} onClick={() => setTarget(id)} className={seg(target === id)}>
                    {id}
                  </button>
                ))}
              </div>
              <p className="mb-1 mt-2 font-mono text-[11px] text-subtext0">{t(lang, "exp.mode")}</p>
              <div className="flex gap-1">
                {(
                  [
                    ["bundle", t(lang, "exp.bundle")],
                    ["rom", t(lang, "exp.rom")],
                    ["tal", t(lang, "exp.tal")],
                  ] as Array<[ExportMode, string]>
                ).map(([id, label]) => (
                  <button key={id} onClick={() => setExpMode(id)} className={seg(expMode === id)}>
                    {label}
                  </button>
                ))}
              </div>
              <button
                onClick={download}
                disabled={expBusy}
                className="seg-active mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-70"
              >
                {expBusy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                {expBusy ? t(lang, "exp.working") : t(lang, "exp.go")}
              </button>
            </div>
          )}
        </span>
      </div>
      {!isCode && (
        <div className="flex items-center gap-1 overflow-x-auto border-t border-surface0/60 px-3 py-1.5" role="tablist">
          {project.scenes.map((s, si) => (
            <span
              key={s.id}
              role="tab"
              aria-selected={s.id === sceneId}
              draggable={!locked}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("application/x-scene-tab", String(si));
                setDragTab(si);
              }}
              onDragEnd={() => setDragTab(null)}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("application/x-scene-tab")) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const raw = e.dataTransfer.getData("application/x-scene-tab");
                const from = Number(raw);
                if (Number.isInteger(from)) reorderScenes(from, si);
                setDragTab(null);
              }}
              className={`group inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-mono text-[11px] transition-all hover:bg-surface0 ${
                dragTab === si ? "opacity-40" : ""
              } ${s.id === sceneId ? "seg-active" : "text-subtext0"}`}
            >
              <button onClick={() => pickScene(s.id)} className="max-w-28 truncate">
                {s.id}
              </button>
              {!locked && project.scenes.length > 1 && (
                <button
                  onClick={() => deleteScene(s.id)}
                  title={`${t(lang, "hdr.delete_scene")} ${s.id}`}
                  aria-label={`${t(lang, "hdr.delete_scene")} ${s.id}`}
                  className="grid size-4 place-items-center rounded opacity-0 transition-opacity hover:text-red group-hover:opacity-100"
                >
                  <X size={11} />
                </button>
              )}
            </span>
          ))}
          {!locked && (
            <button
              onClick={() => addScene()}
              title={t(lang, "hdr.new_scene")}
              aria-label={t(lang, "hdr.new_scene")}
              className="grid size-6 shrink-0 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-text"
            >
              <FilePlus2 size={13} />
            </button>
          )}
        </div>
      )}
      {message && <p className="border-t border-surface0/60 px-3 py-1 text-[13px] text-subtext0">{message}</p>}
    </div>
  );
}
