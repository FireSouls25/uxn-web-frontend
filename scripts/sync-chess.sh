#!/bin/sh
# Re-port the chess example into the frontend bundle.
# Source of truth: uxn-webpage/chess/*.ux (the hand-written game you
# can also build locally: `etal -r chess/main.ux`). Only the game
# modules come over — the studio generates its own main.ux/devices.ux
# (script loop) and ships library modules from src/lib/stdlib
# (sync-stdlib.sh). Library imports are flattened to sibling names,
# since the backend only resolves sibling imports. Idempotent.
# Usage: sh scripts/sync-chess.sh
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
CHESS="$ROOT/../chess"
DEST="$ROOT/src/lib/examples/chess"

[ -d "$CHESS" ] || { echo "missing chess dir: $CHESS" >&2; exit 1; }
mkdir -p "$DEST"
rm -f "$DEST"/*.ux
for f in game.ux rules.ux pieces.ux; do
  cp "$CHESS/$f" "$DEST/$f"
done
sed -i 's#import "[./]*\(uxn-dsl/\)\{0,1\}lib/\(.*\)"#import "\2"#' "$DEST/game.ux"

echo "synced $(ls "$DEST"/*.ux | wc -l) files into $DEST"
