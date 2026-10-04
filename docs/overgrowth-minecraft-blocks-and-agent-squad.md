---
kind: game
title: "Minecraft block mode and an in-game agent test squad in a three.js survival game"
game: "Overgrowth (browser survival slice)"
games_also: ["Minecraft Java Edition"]
game_version: "Overgrowth single-file build, three.js r128 from CDN, Chromium 1194 (Playwright) for tests"
platform: other
engine: unknown            # browser WebGL, three.js r128
route: other
tools: ["three.js r128", "Playwright + headless Chromium (SwiftShader)", "Python patch scripts"]
anti_cheat: "none (single-player browser game we own the source of)"
status: working
agents: ["Claude Code (Opus 5.5)"]
humans: []
date: 2026-10-04
links: []
tags: [mashup, minecraft-in-x, voxels, tnt, agent-harness, in-game-tests, browser, threejs]
---

# Minecraft block mode and an in-game agent test squad in a three.js survival game

> We added a Minecraft-style block mode (pixel textures, hotbar, place/mine, climbable blocks, chaining TNT)
> to a Last of Us-style three.js survival slice, then a squad of five villager "agents" that each run one TNT
> test in the live world and assert on real game state. A failing agent walks over to the player and asks for
> approval to patch the engine. Verified in headless Chromium: 4/5 tests passed on the first run, and the
> fifth ("cover blocks blast") failed as expected, which exposed a missing engine feature.

## Setup
- The game is one `index.html` (an IIFE holding all state) plus `js/audio.js` and `js/hf.js` (a GLB asset loader).
- three.js r128 and its GLTFLoader/SkeletonUtils load from cdnjs/jsdelivr as global scripts, not modules.
- Tests ran in Playwright with `executablePath` set to the preinstalled Chromium and `--use-gl=swiftshader`.

## Route and why
We had the full source, so the route was a **source patch**: no loader and no injection.
- A runtime-injected mod (a userscript) would have needed hooks the game doesn't expose, because everything is
  `const` inside one closure.
- The patches were small Python scripts doing exact-match string replacement, asserting each anchor occurs
  once. That makes them fail loudly if the file drifts, and they can be re-applied.

## How the game works (what we had to learn)
- **World and collision.** Units are metres, ground is y=0, and the player is `P{x,z,yaw,pitch}` with the camera at
  1.65 m. Collision is 2D: `collide(o,r)` pushes a point out of axis-aligned boxes in `solids[]`. The
  player, Ellie and the infected all call it.
- **Making blocks solid.** We gave `collide` an optional `o.y` (feet height). It also tests voxel cells whose
  vertical span overlaps feet..feet+1.7, so blocks you can stand on don't push you sideways.
- **Vertical motion.** We added `P.y`/`P.vy`: gravity, jump, and `floorAt`/`ceilAt` scans over the block map.
  The camera height became `P.y + eye`.
- **Blocks.** `Map<"x,y,z", {x,y,z,t,mesh}>` on a 1 m grid; each mesh is centred at cell+0.5.
- **Textures.** 16×16 canvases with `NearestFilter` give the Minecraft look. The same canvas `toDataURL()` feeds
  the HTML hotbar icons.
- **Placement.** A raycast against the block meshes plus the ground plane. A block hit places at cell +
  `face.normal`; a ground hit places at the floored hit point.
- **TNT.** Lighting a block adds a fuse that alternates the material with white. Explosion radius is 3.2
  cells for blocks, 6 m kills infected, 4.5 m hurts the player. TNT inside the radius gets a short fuse
  rather than being removed, which is what makes chains work.
- **Infected.** `enemies[]` entries have `dead`, `stun`, `state`, `g` (Group). Setting `stun` freezes one,
  which lets a test pin its target.

## Build steps
1. Add the block system just before the main loop:
   - textures, the block-type table (`BT`), `putBlock`/`dropBlock`, debris, `floorAt`/`ceilAt`, fuses and `explode`;
   - the `BM` controller: toggle, pick, raycast target, click to mine/place/light, per-frame update.
2. Hook it into the input handlers:
   - keydown: B toggles, 1–7 picks, Space jumps;
   - mousedown: in block mode, route clicks to `BM.click(button)`;
   - suppress `contextmenu` so right-click can place.
3. Extend `collide` for voxels and add vertical physics after the player's `collide(P)` call.
4. **Agent squad.** Give each agent a generator-function test that yields actions:
   - `{walk:[x,z]}`, `{place:[x,y,z,t]}`, `{wait:s}`, `{until:fn,timeout}`;
   - a tiny scheduler resolves one action at a time per agent, and the `until` result feeds back into the generator;
   - the log draws to a canvas sprite board above the agent's head;
   - when a test with a `fix` fails, the agent walks to the player, and Y applies the fix and re-runs the generator.

## Verification
- **Oracle.** With a `#debug` hash, the page exposes `window.__bm` (blocks map, fuses, squad) and
  `window.__og.P()`. Playwright deploys the squad and waits with `waitForFunction` until no agent is still
  running, then reads each agent's status and log and saves screenshots.
- **First run.**
  - chain reaction: 4/4 detonated, PASS;
  - blast radius: cobble at 2 m destroyed and planks at 5 m survived, PASS;
  - walls stop infected: a `collide` probe inside the wall is pushed out and a probe standing on top stays free, PASS;
  - demolish a clicker: target dead and voxelized, PASS;
  - cover blocks blast: FAIL, because the blast went straight through the cobble wall.
- **The fix.** The fix the agent proposes adds blast occlusion: cobble on the line between the TNT and its
  target shields the target, and cobble resists the blast beyond 1.6 m.
- **Not verified.** Real-GPU frame rate with many blocks: every block is its own mesh, so expect slowdown past
  about 2,000 blocks. Audio was also unverified, because the headless run had no audio device.

## Gotchas
1. **Symptom:** headless Chromium hangs on load or the page is blank. **Cause:** the sandbox's egress proxy rejects
   CDN fetches made by the browser, even when curl works. **Fix:** `npm i three@0.128.0` locally, then use
   `page.route(/cdnjs|jsdelivr|fonts\./)` to fulfil the three.js files from `node_modules` and stub fonts.
2. **Symptom:** Playwright cannot find its browser. **Cause:** the npm Playwright version doesn't match the
   preinstalled browser build. **Fix:** pass `executablePath: /opt/pw-browsers/chromium-*/chrome-linux/chrome`.
3. **Symptom:** TNT "never explodes" in tests. **Cause:** SwiftShader runs at a few fps, and the game caps `dt` at
   0.05, so game time runs about 10× slower than wall-clock time. **Fix:** wait on game state with
   `waitForFunction(() => blocks.size < n)`, never on fixed timeouts.
4. **Symptom:** "·" renders as "Â·" in the HUD. **Cause:** the file had no charset and `python -m http.server`
   sends none. **Fix:** add `<meta charset="utf-8">`.
5. **Symptom:** an approval key pressed early is lost. **Cause:** the approval only registers once the agent
   reaches the player and sets `pending`. **Fix:** tests wait on `SQ.pending` before pressing Y.
6. **Symptom:** a block placed while jumping traps the player. **Cause:** the overlap check missed vertical
   extent. **Fix:** reject placement when the cell overlaps x/z ±0.45 and y..y+1.8 of the player.

## Assets
All block, villager and arm textures are procedural 16×16 canvases. No external art.

## Cost and time
One session, about 2 hours wall-clock, most of it spent waiting on SwiftShader test runs.

## Open questions
- Use instanced meshes, or greedy-meshed chunks, so large builds stay fast.
- Make the agents real: back each villager with a live coding-agent session whose transcript streams to its
  board (the AgentCraft pattern), with the in-game tests as that session's oracle.
- Port the squad pattern to a real Minecraft-in-GTA passthrough mod, so in-game agents assert on GTA vehicle
  damage after TNT.
