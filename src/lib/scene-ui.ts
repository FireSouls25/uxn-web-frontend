/* Per-scene accents: deterministic by scene order, theme-aware via
   Catppuccin variables (readable on Mocha and Latte alike). */

const ACCENTS = ["mauve", "teal", "green", "peach", "sky", "pink"] as const;

export function sceneAccent(index: number): (typeof ACCENTS)[number] {
  return ACCENTS[((index % ACCENTS.length) + ACCENTS.length) % ACCENTS.length];
}

export function sceneVar(index: number): string {
  return `var(--ctp-${sceneAccent(index)})`;
}
