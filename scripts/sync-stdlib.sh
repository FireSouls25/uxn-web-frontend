#!/bin/sh
# Bundle the uxn-dsl standard library into the studio so scripts can
# `import "screen.ux"` (etc.) and the emitter ships exactly the
# modules a project imports. Source of truth: uxn-dsl/lib/*.ux
# (UXN_DSL_DIR, default ../uxn-dsl next to this frontend). Test files
# stay out. Idempotent: same sources in, same bytes out.
# Usage: sh scripts/sync-stdlib.sh
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
UXN_DSL="${UXN_DSL_DIR:-$ROOT/../uxn-dsl}"
DEST="$ROOT/src/lib/stdlib"

[ -d "$UXN_DSL/lib" ] || { echo "missing uxn-dsl lib: $UXN_DSL/lib" >&2; exit 1; }
mkdir -p "$DEST"
rm -f "$DEST"/*.ux
for f in "$UXN_DSL"/lib/*.ux; do
  case "$(basename "$f")" in
    test_*) continue ;;
  esac
  cp "$f" "$DEST/"
done
echo "synced $(ls "$DEST"/*.ux | wc -l) stdlib modules into $DEST"
