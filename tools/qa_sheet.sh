#!/bin/sh
# Render contact sheets of maps from several camera angles with headless Chrome (needs the preview server).
# usage: qa_sheet.sh <outDir> <profileDir> <angles e.g. 0,45,90,135,180,225,270,315> <mode 0-3> <id>...
OUT="$1"; PROF="$2"; ANG="$3"; MODE="$4"; shift 4
N=$(echo "$ANG" | tr ',' '\n' | wc -l | tr -d ' '); ROWS=$(( (N + 3) / 4 )); COLS=$N; [ "$COLS" -gt 4 ] && COLS=4
for ID in "$@"; do
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --user-data-dir="$PROF" --no-first-run --disable-extensions --hide-scrollbars \
    --window-size=$((COLS * 480)),$((ROWS * 280)) --virtual-time-budget=20000 --screenshot="$OUT/$ID.png" \
    "http://localhost:8131/?sheet=$ANG&mode=$MODE#map-$ID" >/dev/null 2>&1
  [ -s "$OUT/$ID.png" ] && echo "sheet $ID" || echo "FAILED $ID"
done
