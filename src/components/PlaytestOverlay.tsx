import { useEffect } from "react";
import { useStore } from "@nanostores/react";
import { X } from "lucide-react";
import { t, useLang } from "../lib/i18n";
import { closePlaytest, playtestStore } from "../lib/store";
import ShareLink from "./ShareLink";

/* Fullscreen playtest: the compiled web bundle running in an iframe
   (same bytes as the download). X or Esc closes and revokes the blob
   URL so repeated runs never leak object URLs. */
export default function PlaytestOverlay() {
  const lang = useLang();
  const url = useStore(playtestStore);

  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePlaytest();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [url]);

  if (!url) return null;

  /** Force the inner game canvas to take as much width as possible.
      Tries the bundle's own view controller first (it owns Fit/1x/2x/3x
      buttons and refits on resize); the bundle script uses top-level
      `const`, so it is usually unreachable from outside — the CSS
      fallback below then guarantees max width on any bundle version.
      Mouse mapping stays correct either way: uxn5 scales pointer
      coordinates through getBoundingClientRect. */
  function fillGame(e: React.SyntheticEvent<HTMLIFrameElement>): void {
    const frame = e.currentTarget;
    try {
      const inner = frame.contentWindow as unknown as {
        emulator?: { view?: { set: (mode: string) => void } };
      } | null;
      inner?.emulator?.view?.set("full");
    } catch {
      // Not reachable: fall through to the CSS sizing.
    }
    try {
      const doc = frame.contentDocument;
      const canvas = doc?.getElementById("display") as HTMLCanvasElement | null;
      if (canvas) {
        const refit = () => {
          if (canvas.width > 0 && canvas.height > 0) fitCanvas(frame, canvas);
        };
        refit();
        window.addEventListener("resize", refit);
        // The wasm core boots after load, so the ROM sets its screen
        // size later: refit whenever the canvas changes size.
        const sized = new MutationObserver(refit);
        sized.observe(canvas, { attributes: true, attributeFilter: ["width", "height"] });
        // Drop the listeners when this bundle goes away.
        const obs = new MutationObserver(() => {
          if (!frame.isConnected) {
            window.removeEventListener("resize", refit);
            sized.disconnect();
            obs.disconnect();
          }
        });
        obs.observe(document.body, { childList: true, subtree: true });
      }
    } catch {
      // Cross-origin or not ready: the iframe itself is already full
      // width, and the bundle's own buttons remain usable.
    }
  }

  return (
    <div className="bg-scrim-strong fixed inset-0 z-50 flex flex-col p-3 sm:p-6">
      <div className="mx-auto flex w-full items-center gap-3 pb-3">
        <p className="font-mono text-[11px] uppercase tracking-widest text-subtext0">
          {t(lang, "play.title")}
        </p>
        <div className="ml-auto flex min-w-0 max-w-md flex-1">
          <ShareLink compact />
        </div>
        <button
          onClick={closePlaytest}
          title={t(lang, "hdr.close")}
          aria-label={t(lang, "hdr.close")}
          className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface0 text-text transition-colors hover:bg-surface1"
        >
          <X size={16} />
        </button>
      </div>
      <div className="mx-auto flex min-h-0 w-full flex-1 flex-col">
        <iframe
          src={url}
          title={t(lang, "play.title")}
          onLoad={fillGame}
          className="min-h-0 w-full flex-1 rounded-lg border border-surface0 bg-code"
        />
        <p className="mt-2 text-center font-mono text-[10px] text-overlay0">{t(lang, "exp.play_hint")}</p>
      </div>
    </div>
  );
}

/** Size the inner canvas to the largest integer scale that fits the
    iframe viewport (whole pixels stay square; height constrains). */
function fitCanvas(frame: HTMLIFrameElement, canvas: HTMLCanvasElement): void {
  const availW = Math.max(1, frame.clientWidth);
  const availH = Math.max(1, frame.clientHeight);
  const scale = Math.max(1, Math.floor(Math.min(availW / canvas.width, availH / canvas.height)));
  canvas.style.width = `${canvas.width * scale}px`;
  canvas.style.height = `${canvas.height * scale}px`;
  canvas.style.margin = "auto";
  const emu = canvas.parentElement;
  if (emu) {
    emu.style.display = "flex";
    emu.style.alignItems = "center";
    emu.style.justifyContent = "center";
    emu.style.height = "100%";
  }
}
