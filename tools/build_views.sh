#!/bin/sh
# Everything after Codex has drawn the side views: depth -> web assets -> placement on the turntable.
# usage: build_views.sh <codexOutDir> <rawDepthDir> <model.onnx> <nodeBinDir>
OUT="$1"; RAW="$2"; MODEL="$3"; export PATH="$4:$PATH"
HERE="$(cd "$(dirname "$0")" && pwd)"; SITE="$(dirname "$HERE")"
node "$HERE/infer.mjs" "$MODEL" "$OUT" "$RAW" 2>&1 | grep -v 'trust settings' | tail -1
node "$HERE/pack_views.mjs" "$OUT" "$RAW" "$SITE" 2>&1 | grep -v 'trust settings' | tail -1 | cut -c1-60
node "$HERE/register.mjs" "$SITE" 2>&1 | grep -v 'trust settings' | grep -E 'original|maps with'
