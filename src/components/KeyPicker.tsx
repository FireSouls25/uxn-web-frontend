import { useEffect, useState } from "react";
import { useStore } from "@nanostores/react";
import { Keyboard } from "lucide-react";
import { eventCode, keyLabel } from "../lib/keys";
import { addInput, projectStore } from "../lib/store";
import { t, useLang } from "../lib/i18n";

/* Named-input picker: dropdown of project inputs (name + key) plus a
   press-a-key capture button that finds-or-creates the input. Raw
   codes survive underneath (bindings keep their key), so old
   projects and the manual number field never break. */
export default function KeyPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (inputId: string) => void;
}) {
  const lang = useLang();
  const project = useStore(projectStore);
  const [listening, setListening] = useState(false);
  const inputs = project.inputs ?? [];
  const label = (code: number): string => keyLabel(code, (k) => t(lang, k));

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const code = eventCode(e);
      setListening(false);
      if (code === null) return;
      onChange(addInput(code));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening, onChange]);

  return (
    <div className="flex items-center gap-1.5">
      <select
        aria-label={t(lang, "inputs.key")}
        value={inputs.some((i) => i.id === value) ? value : ""}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="select min-w-0 flex-1"
      >
        {inputs.length === 0 && <option value="">{t(lang, "inputs.none")}</option>}
        {inputs.map((i) => (
          <option key={i.id} value={i.id}>
            {i.id} ({label(i.key)})
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => setListening((v) => !v)}
        title={t(lang, "inputs.press")}
        aria-label={t(lang, "inputs.press")}
        className={`grid size-7 shrink-0 place-items-center rounded-md transition-colors ${
          listening ? "animate-pulse bg-mauve/30 text-mauve" : "bg-surface0 text-subtext0 hover:bg-surface1 hover:text-text"
        }`}
      >
        <Keyboard size={14} />
      </button>
    </div>
  );
}
