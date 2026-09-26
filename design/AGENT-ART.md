# Asha, the MyCareer.AI guide: artwork brief

Asha is the illustrated character who guides users. The app already works with a simple built-in placeholder face;
when these images are added she appears in the corner with real artwork. Same character in every pose is the whole game,
so generate the **character sheet first**, then every pose from it.

## Step 1: the character sheet (generate once, approve, reuse)

> Character design sheet, friendly Indian woman in her late 20s, career coach and guide. Warm brown skin, dark hair in a
> neat low ponytail with a few loose strands, kind confident expression, natural smile. Smart-casual outfit: peacock-blue
> (#0a7399) blazer over a white top, small gold (#f0bf4c) pendant, and a slim teal earpiece headset on one ear.
> Stylised semi-realistic 3D illustration, soft cinematic lighting with teal and warm amber rim light, gentle glossy
> materials, same look as a premium fintech app illustration. Show front view, three-quarter view and side view of the
> same character, waist-up, on a plain solid bright green background (#00FF00).

Pick the one you like. Use that image as the **reference image** for every prompt below ("same character as the
reference image, identical face, hair, outfit and lighting").

## Step 2: the poses

Use this base for each pose, changing only the pose line:

> Same character as the reference image, identical face, hair, outfit, headset and lighting. Waist-up, facing slightly
> to the viewer's left, centred, generous empty space around her, on a plain solid bright green background (#00FF00),
> no shadows on the background, no text, no logos. **POSE:** ...

| File name | POSE line |
|---|---|
| `idle.png` | relaxed friendly smile, mouth closed, hands loosely together at waist |
| `talking.png` | mid-sentence, mouth open naturally as if speaking, one hand slightly raised in a gentle explaining gesture |
| `listening.png` | head tilted slightly, attentive interested look, one hand touching her headset earpiece |
| `thinking.png` | one hand at her chin, eyes looking up and to the side, thoughtful small smile |
| `pointing.png` | arm extended pointing to the viewer's right with an open palm or index finger, encouraging smile |
| `celebrating.png` | both arms raised in joy, big happy smile, a few gold and teal confetti pieces around her |
| `encouraging.png` | warm reassuring smile, thumbs up with one hand |
| `waving.png` | friendly wave hello with one hand, bright smile |

Optional extras: `sleeping.png` (eyes closed, calm) for "quiet mode", and `worried.png` (soft empathetic look) for
rejections.

## Step 3: check before you save

- Same face, hair, outfit and headset in every image. Regenerate any that drift.
- Background is flat green with nothing touching the edges (no cropped hands or ponytail).
- No text, watermark or logo. If the tool adds a corner sparkle/watermark, crop it out.
- Portrait or square is fine; at least 1024 px tall.

## Step 4: add them

1. Save the images in `design/agent/` with the exact file names above.
2. Run `node scripts/agent-art.mjs`. It removes the green, trims the edges, and writes transparent WebP files into
   `public/agent/`.
3. Refresh the app. Poses that are missing fall back to the built-in placeholder, so you can add them one at a time.
