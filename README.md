# Obsidian Protocol

A first-person sci-fi shooter set in a bright white arcology under a violet sky.
Built with Three.js and Rapier, running in the browser.

**Purple Park Studios × Lumalien**

---

## Running it

```bash
npm install
npm run dev      # http://127.0.0.1:5173
npm run build    # production build to dist/
```

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
  ui/                DOM HUD
tools/               GLB inspection, thumbnails, headless smoke test
public/models/       optimised GLB assets the game loads
```

`src/config.js` is the balance surface — weapon stats, AI ranges, spawn counts,
palette and feedback intensities all live there rather than being scattered
through the systems.

## Asset pipeline

Characters are generated in Meshy, auto-rigged in Mixamo, then merged and
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
node tools/thumbnails.mjs  public/models             # render previews (needs dev server)
node tools/verify.mjs                                # headless smoke test (needs dev server)
```

## Status

Early development. Known gaps: no navmesh (AI steers in straight lines, which
is fine on the current flat city but won't survive real terrain), no death
animations (bodies use a procedural topple), and the environment is a
placeholder for a more developed art direction.
