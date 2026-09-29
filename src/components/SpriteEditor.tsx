import { useState } from "react";
import { useStore } from "@nanostores/react";
import { t, useLang } from "../lib/i18n";
import { currentScene, projectStore, sceneIdStore, selectionStore, setTile } from "../lib/store";

/* Pixel painting for the selected object's 8×8 1bpp tile, separate
   from scene layout: pick a tile, paint bits, every user sees it. */
export default function SpriteEditor() {
  const lang = useLang();
  const project = useStore(projectStore);
  const sceneId = useStore(sceneIdStore);
  const selection = useStore(selectionStore);
  const [tool, setTool] = useState<"paint" | "erase">("paint");

  const scene = currentScene(project, sceneId);
  const obj = scene.objects.find((o) => o.id === selection) ?? scene.objects[0] ?? null;
  const tile = obj?.tile ?? [0, 0, 0, 0, 0, 0, 0, 0];

  function flip(row: number, col: number) {
    if (!obj) return;
    const next = [...tile];
    const mask = 1 << (7 - col);
    next[row] = tool === "paint" ? next[row] | mask : next[row] & ~mask & 255;
    setTile(obj.id, next);
  }

  function fill(value: number) {
    if (!obj) return;
    setTile(obj.id, Array(8).fill(value));
  }

  const btn = (active: boolean) =>
    `rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors ${
      active ? "bg-mauve/20 text-mauve" : "text-subtext0 hover:bg-surface0 hover:text-text"
    }`;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
          {t(lang, "sprite.tile")}
        </span>
        {scene.objects.map((o) => (
          <button
            key={o.id}
            onClick={() => selectionStore.set(o.id)}
            className={btn(o.id === obj?.id)}
          >
            {o.id}
          </button>
        ))}
        <span className="ml-auto flex gap-1">
          <button onClick={() => setTool("paint")} className={btn(tool === "paint")}>
            {t(lang, "sprite.paint")}
          </button>
          <button onClick={() => setTool("erase")} className={btn(tool === "erase")}>
            {t(lang, "sprite.erase")}
          </button>
          <button onClick={() => fill(0)} className={btn(false)}>
            {t(lang, "sprite.clear")}
          </button>
          <button onClick={() => fill(255)} className={btn(false)}>
            {t(lang, "sprite.fill")}
          </button>
        </span>
      </div>
      {obj ? (
        <div
          className="grid w-fit gap-px rounded-lg border border-surface0 bg-surface0 p-2"
          style={{ gridTemplateColumns: "repeat(8, 22px)" }}
        >
          {tile.map((byte, r) =>
            Array.from({ length: 8 }, (_, c) => (
              <button
                key={`${r}-${c}`}
                aria-label={`pixel ${r},${c}`}
                onPointerDown={() => flip(r, c)}
                onPointerEnter={(e) => {
                  if (e.buttons === 1) flip(r, c);
                }}
                className="size-[22px] rounded-[3px] transition-colors"
                style={{ background: byte & (1 << (7 - c)) ? "var(--ctp-text)" : "var(--ctp-base)" }}
              />
            )),
          )}
        </div>
      ) : null}
      <p className="mt-2 font-mono text-[11px] text-subtext0">{t(lang, "sprite.hint")}</p>
    </div>
  );
}
