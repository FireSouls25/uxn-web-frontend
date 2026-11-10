import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/* Anchored popover for the event editor's pickers: opens under (or
   above) its trigger, portals to <body> so the scrolling sheet never
   clips it, and closes on outside pointer / Escape. Nested popovers
   (a value inside a math value) work: a pointer inside ANY open
   popover doesn't close the ones below it. */
export default function Popover({
  trigger,
  children,
  width = 280,
  className = "",
  title,
  open: controlled,
  onOpenChange,
}: {
  trigger: (open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
  width?: number;
  className?: string;
  title?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const setOpen = (v: boolean): void => {
    setOwn(v);
    onOpenChange?.(v);
  };
  const btn = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, maxH: 400 });
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open) return;
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    if (below >= 260 || below >= above) setPos({ top: r.bottom + 6, left, maxH: Math.max(160, below) });
    else setPos({ top: Math.max(8, r.top - Math.min(above, 460) - 6), left, maxH: Math.min(above, 460) });
  }, [open, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      const el = e.target as HTMLElement | null;
      if (btn.current?.contains(el)) return;
      if (panel.current?.contains(el)) return;
      // A nested popover opened from inside this one.
      if (el?.closest("[data-popover]") && Number(el.closest("[data-popover]")?.getAttribute("data-depth")) > depthOf(panel.current)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      <span
        ref={btn}
        className="inline-flex"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        {trigger(open)}
      </span>
      {mounted &&
        open &&
        createPortal(
          <div
            ref={panel}
            data-popover
            data-depth={String(depthOf(btn.current) + 1)}
            role="dialog"
            aria-label={title}
            className={`dock fixed z-[90] overflow-y-auto rounded-xl p-2 text-[12px] ${className}`}
            style={{ top: pos.top, left: pos.left, width, maxHeight: pos.maxH }}
            onClick={(e) => e.stopPropagation()}
          >
            {title && <p className="mb-1.5 px-1 font-mono text-[10px] uppercase tracking-widest text-subtext0">{title}</p>}
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </>
  );
}

function depthOf(el: Element | null): number {
  const host = el?.closest("[data-popover]");
  return host ? Number(host.getAttribute("data-depth")) || 0 : 0;
}

/** A clickable inline token inside an action sentence. */
export function Chip({
  children,
  tone = "default",
  open,
  title,
  disabled,
}: {
  children: ReactNode;
  tone?: "default" | "value" | "asset" | "warn";
  open?: boolean;
  title?: string;
  disabled?: boolean;
}) {
  const tones = {
    default: "border-surface1 bg-base text-text",
    value: "border-teal/40 bg-teal/10 text-text",
    asset: "border-mauve/40 bg-mauve/10 text-text",
    warn: "border-red/50 bg-red/10 text-red",
  } as const;
  return (
    <span
      role="button"
      tabIndex={disabled ? -1 : 0}
      title={title}
      aria-expanded={open}
      className={`inline-flex max-w-[16rem] cursor-pointer items-center gap-1 truncate rounded-md border px-1.5 py-0.5 font-mono text-[11px] leading-5 transition-colors hover:border-mauve ${tones[tone]} ${
        open ? "ring-1 ring-mauve" : ""
      } ${disabled ? "pointer-events-none opacity-70" : ""}`}
    >
      {children}
    </span>
  );
}
