# Obsidian Protocol

A first-person sci-fi shooter. Built with Three.js and Rapier, running in the
browser.

**Purple Park Studios × Lumalien**

---

## Running it

```bash
npm install
npm run dev      # http://127.0.0.1:5173
npm run build    # production build to dist/
```

## Levels

| id | Name | |
| --- | --- | --- |
| `arcology` | Obsidian Arcology | White towers on a block grid under a violet night sky |
| `basin` | Verdant Basin | An overgrown research outpost in a jungle canyon |

Pick one from **DEPLOYMENT ZONE** on the start screen — also reachable from the
pause menu, so you can switch without restarting the session. `CONFIG.world.level`
sets the default and `?level=arcology` overrides it per load.

A level is any class with `build()`, `heightAt()`, `isOpenGround()` and
`randomSpawnPoint()`, plus optional `update(dt)`, registered in
`src/world/levels.js` alongside its sky preset. The picker builds itself from
that registry, so adding a level needs no markup or UI change. Atmosphere is
per-level data in `src/world/Sky.js`, not global config.

**Both levels are dead flat.** That is a constraint, not a style choice: the AI
has no navmesh and steers in straight lines, so real terrain would strand
hostiles on geometry they can't path around. All of Verdant Basin's verticality
is scenery — habitat discs on piers, a cliff ring outside the boundary wall —
and nothing the player fights on is more than a step high.

## Controls

| | |
| --- | --- |
| `W` `A` `S` `D` | Move |
| `Shift` | Sprint |
| `Ctrl` / `C` | Crouch |
| `Space` | Jump |
| `Mouse` | Look |
| `LMB` | Fire |
| `R` | Reload |
| `Q` · `1` `2` · Wheel | Switch weapon |
| `Esc` | Release cursor (pauses) |
| `F3` | Debug panel |

## What's in it

- **Movement** — kinematic capsule on Rapier's character controller: slope limits,
  auto-step, ground snapping, coyote time and jump buffering.
- **Combat** — hitscan weapons for the player, travelling energy bolts for everyone
  else, with swept-segment collision so nothing tunnels at speed.
- **AI** — squads of hostiles that stay dormant until you close in, then alert
  together and engage at staggered standoff ranges. Allied squad fights alongside
  you and stays leashed so it doesn't get picked off alone.
- **Objectives** — a chained mission structure (`eliminate` / `reach` / `hold`)
  with a world waypoint and HUD banner.
- **Pickups** — ammo and med crates that appear when you're actually short, plus
  weapons dropped by the dead carrying their leftover ammo.

## Layout

```
src/
  config.js          all tuning: palette, weapons, AI, feedback
  core/              renderer, physics, input, audio, assets, game loop
  player/            controller, camera, weapons, loadout
  entities/          Actor base + Enemy / Ally / Drone, Character rig wrapper
  combat/            pooled projectiles and impacts
  items/             pickups
  game/              objectives
  world/             levels, sky presets, prop instancing
  ui/                DOM HUD
tools/               GLB inspection, screenshots, headless smoke test
tools/blender/       procedural asset generation (see public/models/README.md)
public/models/       optimised GLB assets the game loads
```

`src/config.js` is the balance surface — weapon stats, AI ranges, spawn counts,
palette and feedback intensities all live there rather than being scattered
through the systems.

## Asset pipeline

Two separate pipelines, for two deliberately different looks.

**The environment is procedural.** Every prop, structure and plant is generated
by Python in `tools/blender/` and exported as untextured, flat-shaded GLB. The
whole set is ~11k triangles across 28 files, scattered with `InstancedMesh`, so a
level holding 700+ props costs about 40 draw calls. Changing the art direction is
an edit to `tools/blender/kit.py` and a re-run — the GLBs are build output, not
source. See `public/models/README.md`.

The flat shading is a gameplay decision. Characters are the only textured,
smooth-shaded things in the frame, so an enemy standing against the treeline
never visually merges into it.

**Characters** are generated in Meshy, auto-rigged in Mixamo, then merged and
optimised in Blender before export. Two things that pipeline handles which are
easy to get wrong:

- **Weapons are baked** barrel-forward with their origin at the pistol grip, and
  parented to `mixamorig:RightHand` using a transform derived from the aiming
  pose. The runtime does no orientation guessing — that was the source of
  every backwards-weapon bug, because the source models disagreed on which way
  was forward.
- **Textures are re-encoded** to JPEG at 2K on export. Blender's glTF exporter
  will happily re-encode 4K JPEGs as PNG, which took the character set from
  27 MB to 53 MB each. The whole model set is ~58 MB as a result of not doing
  that.

Raw Meshy exports and Mixamo FBX round-trip files are excluded from the repo —
they're inputs, not shipped assets.

## Tools

```bash
node tools/inspect-glb.mjs public/models/enemy.glb   # rig, clips, bounds, textures
node tools/dump-nodes.mjs  public/models/ally.glb    # node hierarchy & transforms
node tools/shoot.mjs basin                           # screenshot a level (needs dev server)
```

`shoot.mjs` renders through SwiftShader, so the fps it reports means nothing —
the draw-call and triangle counts it prints are the numbers to watch.

## Status

Early development. Known gaps:

- **No navmesh.** AI steers in straight lines, which is why both levels are
  flat. Terrain is blocked on this.
- **No death animations** — bodies use a procedural topple.
- **Characters dominate the frame budget.** The whole environment is ~11k
  triangles; a populated level renders ~930k, essentially all of it the ~35
  Meshy characters. They're the thing to optimise next, not the world.
