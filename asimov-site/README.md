# $ASIMOV — Science Finance

Static site for **$ASIMOV**, a Solana token launched on StonkFun and paired against **NVDAx** (Backed Finance's
tokenized NVIDIA share). Dressed as a 1990s science-fiction digest. No build step, no framework.

| File | What it is |
|---|---|
| `index.html` | The site. **Launch config lives in the `TOKEN` block** at the top of its main script. |
| `intro.js` | Cinematic opening (three.js): 1942 caption → particle robot head → orbit → `$ASIMOV`. ~11s, skippable, once per browser session, off for reduced motion. Footer link replays it. |
| `three-scenes.js` | 3D bookshelf turntable of Asimov's books + the $ASIMOV/NVDAx coin orbit. Falls back to CSS without WebGL. |
| `cover-paint.js` | Procedural painted pulp covers (canvas). |
| `pulp.css` | All styles. |
| `slides.html` | 8-page slide deck (← → / swipe). |
| `MASTER-PROMPT.md` | The creative brief and truth rules. |
| `render.yaml` | Render Blueprint (static site). |

## Launch checklist
1. In `index.html`, fill `TOKEN`: `ca`, `stonkfun`, `x`, `telegram`, `dexscreener`. Empty fields stay hidden.
2. Optional: `AFFILIATE.amazonTag` (Amazon Associates). Add a disclosure line in the footer when you set it.

## Deploy on Render
Render dashboard → **New → Blueprint** → pick this repo → Apply. (Or **New → Static Site**, publish directory `.`,
build command empty.) Every push to `main` redeploys.

## Local preview
`python3 -m http.server 8080` in this folder, then open http://localhost:8080. Add `#intro` to replay the intro,
or `?introT=6` to freeze it at a given second.

## Truth rules
Live prices only (DexScreener), no invented stats, no NVIDIA logo, disclaimers kept in the footer.
$ASIMOV trades against NVDAx but is not itself an NVIDIA share. Not financial advice.

## The short film (`movie/`)
"The Three Laws": an 82-second 1080p film about Asimov, the Three Laws and the AI breakthroughs that followed.
Rendered frame by frame from `movie.html` (open it in a browser for a live preview), with an original synthesized
score (`score.py`). The I, Robot excerpt is **not** in the repo: pass your own copy to the renderer.

```
cd movie && npm i playwright && pip install numpy
node render.js /path/to/i-robot-clip.mp4 the-three-laws.mp4 [--clip-start 45.6]
```
MP4 files are git-ignored so the film excerpt never gets published by Render.

## The short film v3 (`film/`): "Nine Lives" (HyperFrames)

3:04. Asimov the cat witnesses nine leaps of innovation (Tesla's Mačak, the Boxing Cats, Schrödinger, Hubel & Wiesel,
Félicette, the robot cat of 1969, I, Robot's Asimov, the Google cat on NVIDIA GPUs, cats on-chain), cut into the R-7
First Law story. Script and sources: `film/SCRIPT.md` (v2 story: `film/SCRIPT-v2.md`). Chapters: `film/assets/catlore.js`;
score: `score2.py` then `score3.py`.

QUILL's script (`film/SCRIPT.md`): a Higgs field containment leak at a fictional collider, where R-7 refuses an order
to save a technician (the First Law), Asimov's history, an original homage to the 2004 I, Robot tunnel scene, the AI
breakthroughs, and an epilogue where the cat finds R-7. No licensed footage. Original synthesized score.
```
cd film && npm run score    # writes assets/score.wav (python3 + numpy)
# the I, Robot dialogue excerpt (assets/excerpt/john.wav) is git-ignored: cut your own copy to that path
npm run check               # HyperFrames lint/validate
npm run render              # → renders/nine-lives.mp4
```
`world3d.js` is the 3D set (three.js, seekable by time); `assets/scenes2d.js` holds the 2D history scenes.

## Site map (what's on the page)
Intro (3D R-7, Three Laws rings, the cat, masthead slam) · live 3D cover · the $ASIMOV/NVDAx pair · the robot cast ·
$Asimov's Laws of Tokenomics · Read the originals (3D bookshelf) · The Foundation (3D Trantor + 7-novel shelf) ·
Painters of the future (credited homage gallery) · How to buy · slide deck. Without WebGL, rendered stills and painted
covers stand in (`assets/r7-*.jpg`, re-render with `node tools/render-cover.js`).

## Preview build
`python3 tools/build-preview.py OUT_DIR` writes a bundle with fonts embedded (for the claude.ai preview).
