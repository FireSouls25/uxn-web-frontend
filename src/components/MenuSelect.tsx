import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown } from "lucide-react";

export interface MenuOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

interface Props {
  value: string;
  options: MenuOption[];
  onChange: (value: string) => void;
  label: string;
  icon?: React.ReactNode;
}

/* Shared pill dropdown (theme + language). Native <select> options
   are browser-owned and can't be styled, so this renders its own
   popover in the dock language: blurred card, hovered rows, a check
   on the active row. The menu portals to <body> with fixed
   positioning, so it never clips inside the sticky header or the
   mobile nav's animated container. */
const MENU_W = 176;

export default function MenuSelect({ value, options, onChange, label, icon }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [mounted, setMounted] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Portals need document: only render the menu after hydration.
  useEffect(() => setMounted(true), []);

  const current = options.find((o) => o.value === value) ?? options[0];

  useLayoutEffect(() => {
    if (!open) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const estH = options.length * 40 + 20;
    const left = Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8));
    let top = r.bottom + 8;
    if (top + estH > window.innerHeight - 8) top = Math.max(8, r.top - estH - 8);
    setPos({ top, left });
  }, [open, options.length]);

  useEffectClose(open, btnRef, () => setOpen(false));

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className="inline-flex items-center gap-1.5 rounded-full border border-surface0 bg-base py-1 pl-2.5 pr-2 text-subtext0 transition-colors hover:border-surface1 hover:text-text"
      >
        {icon ?? current?.icon}
        <span className="font-mono text-[11px]">{current?.label}</span>
        <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {mounted &&
        createPortal(
          <AnimatePresence>
          {open && (
            <motion.ul
              role="listbox"
              aria-label={label}
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              data-menu="uxn-select"
              className="dock fixed z-[80] rounded-xl p-1.5"
              style={{ top: pos.top, left: pos.left, width: MENU_W }}
            >
              {options.map((o) => {
                const active = o.value === value;
                return (
                  <li key={o.value}>
                    <button
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        onChange(o.value);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${
                        active ? "seg-active" : "text-subtext0 hover:bg-surface0 hover:text-text"
                      }`}
                    >
                      {o.icon}
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      {active && <Check size={14} className="shrink-0" />}
                    </button>
                  </li>
                );
              })}
            </motion.ul>
          )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}

/* Outside pointer, Escape, scroll and resize all dismiss the menu. */
function useEffectClose(
  open: boolean,
  btnRef: React.RefObject<HTMLButtonElement | null>,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest('[data-menu="uxn-select"]')) return;
      if (btnRef.current?.contains(el)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, btnRef, close]);
}
