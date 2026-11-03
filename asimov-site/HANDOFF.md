# $ASIMOV: handoff for Claude Code

Open this repo locally and tell Claude Code: **"Read HANDOFF.md and continue from Part 2."**
Everything below is the state as of the last cloud session, the next work in order, and the
gotchas that cost us time.

```
git clone https://github.com/IzzoSol/asimov-site.git && cd asimov-site && claude
python3 -m http.server 8811          # site at http://localhost:8811
```

---

## Part 1: what exists

### Site (static, no build step; deploys on Render from `main`)
| Section | Files | Notes |
|---|---|---|
| Newsstand bar, live ticker | `index.html` (TOKEN block), DexScreener | empty TOKEN fields stay hidden |
| Hero cover + live 3D robot R-7 | `hero3d.js`, `robot3d.js`, `assets/r7-cover.jpg` | still is the no-WebGL fallback |
| Cinematic intro (~11 s) | `intro.js` | `?introT=` freezes a moment; sessionStorage skip |
| The pair ($ASIMOV × NVDAx) | `three-scenes.js` (PairOrbit) | |
| Why a cat named Asimov | `cat3d.js`, `cat-live.js`, lore timeline in `index.html` | live 3D cat follows the cursor |
| $Asimov's Laws | `index.html`, `pulp.css` | |
| Read the originals / Foundation / Painters | `shelf.js` (Swivel), `foundation3d.js`, `cover-paint.js` | real covers via Open Library → Google Books |
| Featured feline + writers-and-cats | `index.html` | sources linked inline |
| Screening room | `index.html`, `assets/films/` | film 2 card says "Now rendering" until its MP4 + JPG exist |
| How to buy, footer | `index.html` | |
| Slide deck | `slides.html` | |

**Render settings:** branch `main` · root empty · build `echo "static site"` · publish `.` · no env vars.

### The 3D cat (`cat3d.js`)
- Sculpted from signed distance fields (`bodySDF`, `headSDF`), meshed with surface nets; coat painted per vertex (`bodyPaint`, `headPaint`); shell fur via `onBeforeCompile`.
- Parts: almond eyes with slit pupils and blinking lids (`EYE`, `LID_OPEN/LID_SHUT`), ears with tufts, nose, whiskers, red collar, gold "A" tag (texture rotated `Math.PI / 2`), tail rebuilt per frame.
- API: `AsimovCat.create({ envMap, shells, quality })` → `{ group, update(t, { lookX, lookY, dilate, lid, tilt, snap }), head, tag }`. Deterministic for a given `t`.
- Stills for the site: `tools/render-cat3d.html` (views `sit`, `peek`, `head`) → `assets/cat3d-*.png`. Character check: `tools/cat3d-sheet.html`.
- Anatomy follows the drawing references (pear body, haunches back, straight front legs under the shoulders, short neck, wedge head). **Still weakest: the face** (reads a little toy-like and wide).

### Film 1, "The First Law" (2:08), `film/`: final
- Script `film/SCRIPT.md`. 3D in `world3d.js`, 2D painters in `assets/scenes2d.js`, score `score2.py`.
- *I, Robot* dialogue excerpt at `film/assets/excerpt/john.wav` is **git-ignored** (licensed audio, kept local only). Re-cut it from your MP3 if needed: 46.75 s, 2.85 s long, placed at 77.0 s.
- Rendered share copy: `assets/films/the-first-law.mp4` (27 MB) + `.jpg` poster.

### Film 2, "The Cat Named Asimov" (2:27), `film-cat/`: built, NOT rendered
- Script and shot prompts: `film-cat/SCRIPT-CAT.md` (QUILL). 16 beats.
- `film-cat/scenes.js`: one 3D cat between a painted era background (`#bg`) and a foreground pass (`#fg`); `shot(t)` sets camera, cat placement, light per beat; `paint.*` draws each era; `foreground()` adds props, grain, vignette.
- Score: `film-cat/score_cat.py` → `assets/score.wav`.
- **Render profile is reduced for the GPU-less cloud box:** `shells: 6`, `quality: 0.9`, 3D layer at 60%. On a GPU restore `shells: 12`, `quality: 1`, `r.setSize(W, H, false)`.

### Reusable kit (other repo)
`IzzoSol/shaddai-design-studio`, branch `claude/magical-tesla-ykasmf`: `.claude/skills/` (cinematic-site, hyperframes-film, mascot-character, swivel-shelf, lore-fact-check, token-launch-site), `kits/`, `workflows/workflows.json`. Open a PR to `main` when you're happy with them.

---

## Part 2: finish what's in flight (do these first)

1. **Render film 2.**
   ```
   cd film-cat && python3 score_cat.py assets/score.wav
   npx --yes hyperframes@0.8.140 lint
   npx --yes hyperframes@0.8.140 render --output renders/the-cat-named-asimov.mp4 --quality looks
   ffmpeg -i renders/the-cat-named-asimov.mp4 -c:v libx264 -b:v 1650k -maxrate 2200k -bufsize 4400k -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart ../assets/films/the-cat-named-asimov.mp4
   ffmpeg -ss 141 -i renders/the-cat-named-asimov.mp4 -frames:v 1 -vf scale=1280:-2 ../assets/films/the-cat-named-asimov.jpg
   ```
   Commit both files; the Screening room picks them up. Keep site MP4s under ~30 MB (2-pass bitrate as above).
2. **Fact-check film 2's Sources section** in `SCRIPT-CAT.md`. QUILL named institutions (White House Historical Association, CNES, Library of Congress) that were never verified.
3. **Launch config** in `index.html`: `TOKEN = { ca, x, telegram, dexscreener, stonkfun }`, `AFFILIATE.amazonTag`, plus an affiliate disclosure line once the tag is set.
4. **Secrets:** revoke the two Hugging Face tokens pasted in chat. Put the new one in a local env var (`export HF_TOKEN=...`), never in the repo or in Render.

---

## Part 3: the next round (what you asked for)

### 3a. Better cat look
- Generate a **consistent multi-angle reference set** (front, ¾, side, close-up face, sitting, walking) with Hugging Face (e.g. FLUX via `router.huggingface.co`) using the "character block" in `SCRIPT-CAT.md` verbatim in every prompt. Save them to `refs/cat/`.
- Then tune `cat3d.js` against them: face first (`headSDF` cheek/muzzle volumes, `EYE` size and placement, `headPaint` M marking and blaze), then coat contrast (`FUR`, `FUR_L`, `STRIPE`), then fur length/density (`furred(...)` args).
- Re-render the stills (`tools/render-cat3d.html`) and both films' cat shots.
- New poses would help the film: walking (animate legs in `bodySDF` by time) and lying down.

### 3b. Cat film v2: longer, more robot, music, voice-over
- **Longer (~3:30–4:00):** add beats from `SCRIPT-CAT.md`'s shot list, and give **R-7 a real role**. Reuse `robot3d.js` (`AsimovRobot.create`, `bot.pose`, `bot.walk`) in `film-cat/scenes.js` beside the cat (e.g. R-7 as the cat's companion in the turn, house, Isaac and Now beats).
- **Voice-over:** write VO lines into the script first (QUILL), then render audio:
  - Best: a natural TTS (ElevenLabs, or open models like Kokoro / Piper with Hugging Face access). Keep the narrator warm; R-7's voice dry and literal.
  - Offline fallback (tested in the cloud): `espeak-ng` + MBROLA (`apt install espeak-ng mbrola mbrola-us1 mbrola-us2`).
    Narrator `espeak-ng -v mb-us2 -s 138 -p 38 -w narr.wav "..."`; R-7 `-v mb-us1 -s 150 -p 55`, then ring-modulate at 55 Hz for a metallic tone. Robotic, but on-brand for R-7.
  - Place each line as `<audio data-start=… data-duration=…>` clips in `film-cat/index.html`, and duck the score under VO in `score_cat.py` (the same pattern as `score2.py`'s `mix *= 1 - 0.7 * env(...)`).
- **Music:** `score_cat.py` is synthesized. For a real soundtrack use a licensed/royalty-free track or a generated one, mixed at -18 to -20 dB under VO. Keep a credits line for it.

### 3c. RoboKitty, the series (comedy-suspense agentic thriller)
Ask QUILL for three files in `robokitty/`:
- `BIBLE.md`: logline, premise, tone (comedy + real suspense), the hook (Asimov the cat + R-7 as a duo, built around agentic AI: rogue agents, tool-using AIs, prompt-injection tricks, swarms), cast with want/flaw/voice, an AI-agent antagonist whose weakness ties to the Three Laws, world rules, a Season 1 arc (8 episodes with cliffhangers), gags, visual and sound motifs, and a 10-idea short-form content plan for the coin.
- `EP01.md`: a 5–7 min pilot in screenplay-lite, with VO cues and a 12–20 shot list animatable in three.js/canvas.
- `GAME.md`: see 3d.
Canon to respect: `film/SCRIPT.md` (R-7, Meridian Collider, the First Law), `film-cat/SCRIPT-CAT.md` (Asimov the cat).
Content rules: no price talk or promises, disclose AI, no real person's likeness or voice, label fiction as fiction.

### 3d. RoboKitty, the game
- Browser game (three.js or 2D canvas, mobile + keyboard, **no wallet needed to play**). Suggested: stealth-puzzle co-op swap, where the cat sneaks and scouts while R-7 lifts and hacks. Three-Laws rules the player can exploit; enemy AI agents with readable behaviours; 5 levels; MVP in 1–2 weeks.
- Reuse `robot3d.js` and `cat3d.js` for characters. Holder perks only cosmetic, clearly separated, no pay-to-win.
- Put it in `game/` with its own `index.html`; link it from the site when playable.

---

## Part 4: gotchas we already paid for
- **GSAP:** use `fromTo`, never `from`, with ScrollTrigger; `gsap.ticker.lagSmoothing(0)`; refresh on load, fonts and at 1.5 s.
- `html,body{overflow-x:clip}` (entrance animations caused sideways scroll on mobile).
- Don't name globals `top`/`name`/`status` in classic scripts. Prefix intro classes (`cine-*`).
- **HyperFrames:**
  - The linter only reads **inline** scripts, so register `window.__timelines[id]` inline too (see `film-cat/index.html`).
  - Renders are deterministic: time comes from `hf-seek`, randomness from seeded `rng()`.
  - Check frames with `snapshot --at …` before any long render.
- **Three.js gotchas:**
  - Convert hex colors with `convertSRGBToLinear()` when they go into vertex colors.
  - Fur shells: divide by `Math.max(1, shells)` (0 shells gave NaN).
  - Surface-net winding: verify that triangles agree with the SDF normals.
- **Rendering speed:** the cloud box has no GPU (~8 frames/min with full fur), so render locally. Don't run heavy browser checks during a render.
- `pkill -f <pattern>` can kill your own shell if the pattern appears in the command line.
- Headless Chromium can't play H.264 (error 4). Test video playback in a real browser.
- **Copyright:** hotlink book covers, never rehost them; paintings are homages with credits and links; the *I, Robot* excerpt stays git-ignored and credited.

## File map
```
index.html pulp.css motion.js            site shell, styles, scroll motion
hero3d.js robot3d.js intro.js            R-7 hero, robot model, intro
cat3d.js cat-live.js                     3D cat + live mount
shelf.js cover-paint.js three-scenes.js  swivels, painted covers, pair orbit
foundation3d.js                          Trantor scene
assets/                                  stills, films, fonts in fonts/, libs in vendor/
tools/                                   render-cover, render-cat3d, cat3d-sheet, build-preview
film/                                    Film 1 (HyperFrames)
film-cat/                                Film 2 (HyperFrames)
slides.html MASTER-PROMPT.md README.md   deck, brief, docs
```
