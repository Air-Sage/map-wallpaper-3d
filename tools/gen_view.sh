#!/bin/sh
# Ask Codex (image generation) to redraw one map from another side of the scene.
# usage: gen_view.sh <workdir> <id> <deg>     -> <workdir>/out/<id>_<deg>.png
# The original camera is taken to stand SOUTH of the scene looking NORTH; <deg> is how far the camera
# orbits towards the east (90 = east side, 180 = north side, 270 = west side).
WD="$1"; ID="$2"; DEG="$3"
CODEX="${CODEX:-/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex}"
OUT="out/${ID}_${DEG}.png"
[ -s "$WD/$OUT" ] && { echo "skip $ID $DEG"; exit 0; }
case "$DEG" in
  045) SIDE="SOUTH-EAST"; LOOK="NORTH-WEST"; MAP="the original BOTTOM-RIGHT corner is now nearest to the camera (bottom of the image), the original TOP-LEFT corner is farthest (top), the original BOTTOM-LEFT is on the left and the original TOP-RIGHT is on the right";;
  090) SIDE="EAST"; LOOK="WEST"; MAP="what was on the RIGHT side of the original is now nearest to the camera (bottom of the image), the original LEFT side is farthest (top), the original BOTTOM (near) side is now on the left and the original TOP (far) side is now on the right";;
  135) SIDE="NORTH-EAST"; LOOK="SOUTH-WEST"; MAP="the original TOP-RIGHT corner is now nearest to the camera (bottom of the image), the original BOTTOM-LEFT corner is farthest (top), the original BOTTOM-RIGHT is on the left and the original TOP-LEFT is on the right";;
  180) SIDE="NORTH"; LOOK="SOUTH"; MAP="what was at the TOP (far side) of the original is now nearest to the camera (bottom of the image), the original BOTTOM (near side) is farthest (top), the original RIGHT side is now on the left and the original LEFT side is now on the right";;
  225) SIDE="NORTH-WEST"; LOOK="SOUTH-EAST"; MAP="the original TOP-LEFT corner is now nearest to the camera (bottom of the image), the original BOTTOM-RIGHT corner is farthest (top), the original TOP-RIGHT is on the left and the original BOTTOM-LEFT is on the right";;
  270) SIDE="WEST"; LOOK="EAST"; MAP="what was on the LEFT side of the original is now nearest to the camera (bottom of the image), the original RIGHT side is farthest (top), the original TOP (far) side is now on the left and the original BOTTOM (near) side is now on the right";;
  315) SIDE="SOUTH-WEST"; LOOK="NORTH-EAST"; MAP="the original BOTTOM-LEFT corner is now nearest to the camera (bottom of the image), the original TOP-RIGHT corner is farthest (top), the original TOP-LEFT is on the left and the original BOTTOM-RIGHT is on the right";;
  *) echo "bad deg $DEG"; exit 2;;
esac
KEEP="Keep every landmark, object, ground marking and character of the original."
# The frame follows the geometry: a scene that is wide from the front is narrow and deep from the side.
case "$DEG" in
  090|270) FRAME="Portrait format, 2:3 (taller than wide). The scene is wider (west to east) than it is deep (south to north), so seen from this side it is narrow and deep. Keep those true proportions: do not widen, squash or re-arrange the layout to fill a landscape frame.";;
  180) FRAME="Landscape format, same aspect ratio as the input.";;
  *) FRAME="Square format.";;
esac
PROMPT="The attached image in/${ID}.png is a hand-drawn 2.5D game map scene. Treat it as a small diorama standing on a turntable. The original camera stands on the SOUTH side looking NORTH: the bottom edge of the image is south (near), the top is north (far), left is west, right is east.

Use your image generation tool, with the attached image as the reference, to draw the SAME diorama after the camera has orbited ${DEG} degrees around the vertical axis through the centre of the scene, so that it now stands on the ${SIDE} side looking ${LOOK}. Keep the same elevation angle above the ground, the same distance, the same framing and scale; the centre of the scene stays at the centre of the image.

In the new image, ${MAP}.

${KEEP} Keep them at a consistent position on the ground, with the same colours and the same flat vector cartoon style with dark outlines. Draw the sides of the objects that are visible from the new direction. Fill the frame the way the original does: the ground runs to the edges of the image, the scene is not turned into a floating island and gets no dark surround. Do not add text, UI or a border.
This is a rigid rotation of one physical model: the distances between landmarks on the ground stay the same from every side.
${FRAME}

Copy the generated image file unchanged (do not resize or re-encode it) to ./${OUT} and reply with only the saved path."
cd "$WD" || exit 1
mkdir -p out logs
run() { printf '%s\n' "$PROMPT" | "$CODEX" exec --ephemeral --skip-git-repo-check -s workspace-write -c model_reasoning_effort='"low"' -C "$WD" -i "in/${ID}.png" - > "logs/${ID}_${DEG}$1.log" 2>&1; }
run ""
if [ -s "$OUT" ]; then echo "ok $ID $DEG"; exit 0; fi
# Codex sometimes declines to redraw named game characters. Ask once more for the scenery alone.
PROMPT=$(printf '%s\n' "$PROMPT" | sed "s/^Keep every landmark, object, ground marking and character of the original\./Draw only the scenery: terrain, buildings, props and ground markings. Leave out all characters, creatures, logos and lettering./")
run ".retry"
if [ -s "$OUT" ]; then echo "ok(scenery) $ID $DEG"; else echo "FAIL $ID $DEG"; exit 1; fi
