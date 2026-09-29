#!/bin/sh
# Re-port the chess example into the frontend bundle.
# Source of truth: uxn-webpage/chess/*.ux (hand game) + pinned libs
# from the uxn-dsl checkout (UXN_DSL_DIR, default ../../uxn-dsl).
# The backend only resolves sibling imports, so game.ux's ../../lib
# imports are flattened to basenames. Idempotent: same sources in,
# same bytes out (the vitest chess gate proves the bundle assembles).
# Usage: sh scripts/sync-chess.sh
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
CHESS="$ROOT/../chess"
UXN_DSL="${UXN_DSL_DIR:-$ROOT/../../uxn-dsl}"
DEST="$ROOT/src/lib/examples/chess"

[ -d "$CHESS" ] || { echo "missing chess dir: $CHESS" >&2; exit 1; }
[ -d "$UXN_DSL/lib" ] || { echo "missing uxn-dsl lib: $UXN_DSL/lib" >&2; exit 1; }
mkdir -p "$DEST"

for f in main.ux devices.ux game.ux rules.ux pieces.ux; do
  cp "$CHESS/$f" "$DEST/$f"
done
for f in screen.ux font.ux audio.ux song.ux scene.ux input.ux; do
  cp "$UXN_DSL/lib/$f" "$DEST/$f"
done
sed -i 's#import "../../lib/\(.*\)"#import "\1"#' "$DEST/game.ux"

echo "synced $(ls "$DEST"/*.ux | wc -l) files into $DEST"
