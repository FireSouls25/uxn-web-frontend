import { useStore } from "@nanostores/react";
import { FileCode2 } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { codeFileStore } from "../lib/store";

/* Left column of the code view: generated file picker. */
export default function FileList() {
  const lang = useLang();
  const file = useStore(codeFileStore);

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
        {t(lang, "code.files")}
      </p>
      <ul className="mt-2 space-y-0.5">
        {(["main.ux", "devices.ux"] as const).map((f) => (
          <li key={f}>
            <button
              onClick={() => codeFileStore.set(f)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 font-mono text-xs transition-colors ${
                file === f ? "bg-mauve/15 text-mauve" : "text-subtext0 hover:bg-surface0 hover:text-text"
              }`}
            >
              <FileCode2 size={13} /> {f}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
