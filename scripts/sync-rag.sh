#!/bin/sh
# Sync the agent RAG corpus (backend/rag) into the frontend bundle.
# Single home: backend/rag/*.md. The Pi system prompt imports the
# local copies as ?raw (Vite cannot import outside the project root).
# Usage: sh scripts/sync-rag.sh
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC="$ROOT/../backend/rag"
DEST="$ROOT/src/lib/agent/corpus"
[ -d "$SRC" ] || { echo "missing corpus: $SRC" >&2; exit 1; }
mkdir -p "$DEST"
for f in tools.md etal.md varvara.md examples.md; do
  [ -f "$SRC/$f" ] || { echo "missing $SRC/$f" >&2; exit 1; }
  cp "$SRC/$f" "$DEST/$f"
done
echo "synced $(ls "$DEST"/*.md | wc -l) files into $DEST"
