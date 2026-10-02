/* Keyboard codes for the press-a-key picker. The game only ever
   sees Controller.key codes (ASCII-ish: 32 space, 27 escape); this
   maps browser keys to those codes and back to display names.
   Single characters map to their uppercase char code; specials have
   a fixed table. Anything else keeps its best-effort code and shows
   as `Key N` — the manual number field remains the fallback. */
export function eventCode(e: KeyboardEvent): number | null {
  if (e.key === " ") return 32;
  if (e.key.length === 1) return e.key.toUpperCase().charCodeAt(0);
  const special: Record<string, number> = {
    Escape: 27,
    Enter: 13,
    Tab: 9,
    Backspace: 8,
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
  };
  return special[e.key] ?? null;
}

/** Display name for a code. `label` resolves the few translated
    special names; pass `(k) => t(lang, k)`. */
export function keyLabel(code: number, label: (key: string) => string): string {
  const special: Record<number, string> = {
    32: label("key.space"),
    27: label("key.escape"),
    13: label("key.enter"),
    9: label("key.tab"),
    8: label("key.backspace"),
    37: label("key.left"),
    38: label("key.up"),
    39: label("key.down"),
    40: label("key.right"),
  };
  if (special[code]) return special[code];
  if (code >= 32 && code < 127) return String.fromCharCode(code);
  return `Key ${code}`;
}
