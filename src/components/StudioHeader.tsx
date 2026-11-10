import { useEffect, useRef, useState } from "react";
import { useStore } from "@nanostores/react";
import {
  Apple,
  Box,
  Braces,
  Cpu,
  FileCode2,
  Globe,
  Monitor,
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
import { artifactFilename, compileProject, exportProject, type ExportMode, type ExportTarget } from "../lib/export";
import Popover from "./blocks/Popover";
import ShareLink from "./ShareLink";
import { fetchTargets } from "../lib/api";
import {
  addScene,
  canvasModeStore,
  codeFileStore,
  deleteScene,
  diagnosticsStore,
  openPlaytest,
  PLAY_ON_OPEN_KEY,
  playRequestStore,
  patchViewport,
  projectStore,
  reorderScenes,
  resetViewport,
  sceneIdStore,
  selectionStore,
  viewportStore,
  viewStore,
} from "../lib/store";

type ExportChoice = "web" | "linux" | "rom" | "tal" | "macos" | "windows";

/* What the export panel offers, in order. OS apps (`os`) are listed
   only when the backend serves them (GET /targets: its compiler
   vendors that system's VM); web, ROM and source always are. */
const EXPORT_CHOICES: Array<{ id: ExportChoice; icon: typeof Globe; ext: string; os?: boolean }> = [
  { id: "web", icon: Globe, ext: ".html" },
  { id: "linux", icon: TerminalSquare, ext: "x86_64" },
  { id: "windows", icon: Monitor, ext: ".exe", os: true },
  { id: "macos", icon: Apple, ext: "Apple silicon", os: true },
  { id: "rom", icon: Cpu, ext: ".rom" },
  { id: "tal", icon: FileCode2, ext: ".tal" },
];

const choiceTarget = (c: ExportChoice): ExportTarget =>
  c === "linux" || c === "windows" || c === "macos" ? c : "web";
const choiceMode = (c: ExportChoice): ExportMode => (c === "rom" ? "rom" : c === "tal" ? "tal" : "bundle");

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
  const [choice, setChoice] = useState<ExportChoice>("web");
  // Target ids the backend can build right now (GET /targets).
  const [served, setServed] = useState<Set<string>>(new Set(["web", "linux"]));
  useEffect(() => {
    if (!expOpen) return;
    const ctl = new AbortController();
    fetchTargets(ctl.signal)
      .then((r) => setServed(new Set(r.supported.map((x) => x.id))))
      .catch(() => undefined);
    return () => ctl.abort();
  }, [expOpen]);
  const [playBusy, setPlayBusy] = useState(false);
  const [expBusy, setExpBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const diagCount = useStore(diagnosticsStore).length;

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
      diagnosticsStore.set(result.diagnostics ?? []);
      if (!result.ok || !result.bytes) {
        setMessage(result.message);
        return;
      }
      openPlaytest(URL.createObjectURL(new Blob([result.bytes as BlobPart], { type: "text/html" })));
      setMessage(t(lang, "exp.play_ready"));
    } catch {
      setMessage(t(lang, "exp.offline"));
    } finally {
      setPlayBusy(false);
    }
  }

  // Playtest requests from elsewhere (script-loop banner) and the
  // Projects page Play button (one-shot flag for this project).
  const playRef = useRef(playtest);
  playRef.current = playtest;
  useEffect(() => {
    const off = playRequestStore.listen(() => void playRef.current());
    try {
      if (sessionStorage.getItem(PLAY_ON_OPEN_KEY) === projectStore.get().id) {
        sessionStorage.removeItem(PLAY_ON_OPEN_KEY);
        void playRef.current();
      }
    } catch {
      /* no sessionStorage: Play just opens the studio */
    }
    return off;
  }, []);

  async function download() {
    setExpBusy(true);
    try {
      const result = await exportProject(projectStore.get(), choiceTarget(choice), choiceMode(choice), lang);
      diagnosticsStore.set(result.diagnostics ?? []);
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
        {!isCode && project.loop === "script" && (
          <span title={t(lang, "loop.script_hint")} className="rounded-full bg-teal/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-teal">
            {t(lang, "loop.script")}
          </span>
        )}
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

        <Popover
          width={320}
          open={expOpen}
          onOpenChange={setExpOpen}
          title={t(lang, "exp.title")}
          trigger={(open) => (
            <span role="button" tabIndex={0} aria-expanded={open} className={`${seg(open)} inline-flex cursor-pointer items-center gap-1.5`}>
              <Download size={13} />
              {t(lang, "hdr.export")}
            </span>
          )}
        >
          {() => (
            <div className="space-y-1">
              {/* The panel itself scrolls (Popover caps its height to the
                  window); the download/share footer stays pinned. */}
              {EXPORT_CHOICES.filter((c) => !c.os || served.has(c.id)).map((c) => {
                const active = c.id === choice;
                const Icon = c.icon;
                return (
                  <button
                    key={c.id}
                    onClick={() => setChoice(c.id)}
                    aria-pressed={active}
                    className={`flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                      active ? "border-mauve bg-mauve/10" : "border-transparent hover:bg-surface0"
                    }`}
                  >
                    <Icon size={16} className={`mt-0.5 shrink-0 ${active ? "text-mauve" : "text-subtext0"}`} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-[13px] font-semibold text-text">
                        {t(lang, `exp.c_${c.id}`)}
                        <span className="font-mono text-[10px] font-normal text-overlay0">{c.ext}</span>
                      </span>
                      <span className="block text-[11px] leading-snug text-subtext0">{t(lang, `exp.c_${c.id}_d`)}</span>
                    </span>
                  </button>
                );
              })}
              <div className="sticky -bottom-2 -mx-2 space-y-1 border-t border-surface0 bg-[var(--node-bg)] px-2 pb-2 pt-1.5">
                <p className="truncate px-1 font-mono text-[10px] text-overlay0">
                  {artifactFilename(project.name, choiceTarget(choice), choiceMode(choice))}
                </p>
                <button
                  onClick={download}
                  disabled={expBusy}
                  className="seg-active inline-flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-70"
                >
                  {expBusy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  {expBusy ? t(lang, "exp.working") : t(lang, "exp.go")}
                </button>
                {message && <p className="px-1 text-[11px] leading-snug text-subtext0">{message}</p>}
              </div>
              <div className="border-t border-surface0 pt-2">
                <ShareLink />
              </div>
            </div>
          )}
        </Popover>
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
          <button
            onClick={() => addScene()}
            disabled={locked}
            title={locked ? t(lang, "locked.note") : t(lang, "hdr.new_scene")}
            aria-label={t(lang, "hdr.new_scene")}
            className="grid size-6 shrink-0 place-items-center rounded-md text-subtext0 transition-colors hover:bg-surface0 hover:text-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-subtext0"
          >
            <FilePlus2 size={13} />
          </button>
        </div>
      )}
      {message && (
        <p className="flex items-center gap-2 border-t border-surface0/60 px-3 py-1 text-[13px] text-subtext0">
          <span className="min-w-0 flex-1 truncate">{message}</span>
          {diagCount > 0 && view !== "code" && (
            <button
              onClick={() => {
                if (!isCode && !codeFileStore.get()) codeFileStore.set("custom.ux");
                viewStore.set("code");
              }}
              className="shrink-0 rounded-md bg-red/15 px-2 py-0.5 font-mono text-[11px] text-red hover:bg-red/25"
            >
              {t(lang, "code.show_problems")} ({diagCount})
            </button>
          )}
        </p>
      )}
    </div>
  );
}
