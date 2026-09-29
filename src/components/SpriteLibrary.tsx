import { useStore } from "@nanostores/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import { PALETTE } from "../lib/palette";
import { t, useLang } from "../lib/i18n";
import { addSprite, projectStore, spriteSelStore } from "../lib/store";

/* Left column of the sprites view: every project sprite for
   selection, plus the new-sprite form. */
export default function SpriteLibrary() {
  const lang = useLang();
  const project = useStore(projectStore);
  const spriteId = useStore(spriteSelStore);
  const [newName, setNewName] = useState("");

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
        {t(lang, "sprite.gallery")} ({project.sprites.length})
      </p>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {project.sprites.map((s) => (
          <button
            key={s.id}
            onClick={() => spriteSelStore.set(s.id)}
            title={s.id}
            className={`rounded-lg border p-1.5 transition-colors ${
              s.id === spriteId ? "border-mauve/60 bg-mauve/10" : "border-surface0 hover:border-surface1"
            }`}
          >
            <span className="grid w-full gap-px" style={{ gridTemplateColumns: "repeat(8, 1fr)" }}>
              {s.pixels.map((v, i) => (
                <span key={i} className="aspect-square" style={{ background: PALETTE[v & 3] }} />
              ))}
            </span>
            <span className="mt-1 block truncate font-mono text-[10px] text-subtext0">{s.id}</span>
          </button>
        ))}
      </div>
      <form
        className="mt-2 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim()) {
            addSprite(newName.trim());
            setNewName("");
          }
        }}
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t(lang, "sprite.new_ph")}
          maxLength={24}
          className="min-w-0 flex-1 rounded-md border border-surface1 bg-base px-2 py-1 text-xs outline-none placeholder:text-overlay0 focus:border-mauve"
        />
        <button
          type="submit"
          aria-label={t(lang, "sprite.new")}
          className="grid size-7 shrink-0 place-items-center rounded-md bg-surface0 transition-colors hover:bg-surface1"
        >
          <Plus size={14} />
        </button>
      </form>
    </div>
  );
}
