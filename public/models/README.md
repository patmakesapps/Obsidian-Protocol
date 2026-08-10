# Model assets

Everything here is loaded at startup by URL. **A missing file is never fatal** —
`Assets.loadModel` probes first and the caller falls back to a built-in
primitive, so you see the blocky version instead of a crash.

```
models/
  *.glb            characters, weapons, pickups, the hero cruiser
  city/            arcology street furniture
  jungle/          Verdant Basin environment set
```

## Two pipelines

**Characters and weapons** are generated in Meshy, auto-rigged in Mixamo, then
merged and optimised in Blender. They are textured and smooth-shaded. See the
root `README.md` for the two things that pipeline gets wrong by default.

**Environment and pickups** are *procedural*: they're generated from Python in
`tools/blender/`, not sculpted. They are untextured, flat-shaded, and coloured
straight from the palette in `src/config.js`. To change the art direction, edit
the script and re-run — don't hand-edit the GLBs, they'll be overwritten.

```
tools/blender/kit.py               shared primitives, materials, export
tools/blender/assets_pickups.py    pickup_ammo, pickup_health
tools/blender/assets_city.py       city/*
tools/blender/assets_jungle.py     jungle/*
```

Run them through the Blender MCP connection, or from Blender's scripting tab:

```python
exec(open(r"C:\Sci_Fi_Game\tools\blender\assets_jungle.py").read())
```

The flat shading is a deliberate gameplay decision, not a style shortcut: the
characters are the only textured, smooth-shaded things in the frame, so an enemy
standing in front of the treeline never visually merges into it.

## Inventory

| Path | Used by | Size (longest axis, in game) |
| --- | --- | --- |
| `player.glb` `enemy.glb` `ally.glb` `drone.glb` | combatants | from `CONFIG.<actor>.height` |
| `weapon_vanguard.glb` `weapon_thunder.glb` | loadout | hand-fitted |
| `pickup_ammo.glb` `pickup_health.glb` | `Pickups` | 0.85 m |
| `cruiser.glb` | arcology plaza anchor | 46 m |
| `city/city_{monument,arch,pylon,kiosk,bench,planter,barrier,cargo,generator}.glb` | `Level` | 2.8–13 m |
| `jungle/jungle_{hab_disc,hab_pod,hab_dome,hab_block,column,landing_pad,catwalk,antenna}.glb` | `JungleLevel` | 10–34 m |
| `jungle/jungle_{cliff,rock_a,rock_b,rock_c,crate,tree,palm,bush,fern}.glb` | `JungleLevel` | 2–62 m |

The whole procedural set is ~11k triangles across 28 files. It's scattered with
`InstancedMesh` (`src/world/props.js`), so a basin holding 700+ placed props
costs about 40 draw calls.

## Animation clip names

Clips are matched by substring, case-insensitive, so most exporters work as-is:

| Intent | Matches any clip name containing |
| --- | --- |
| idle | idle, stand, breathing, tpose, rest |
| walk | walk, move, locomotion |
| run | run, sprint, jog, charge |
| attack | attack, punch, swing, strike, shoot, melee, bite |
| hit | hit, impact, flinch, damage, react |
| death | death, die, dying, fall, defeat |

Missing clips degrade gracefully — an enemy with only an idle clip still chases
and attacks, it just doesn't have a run cycle. Add new aliases in
`src/entities/Character.js`.

## Unused

`prop_*.glb` and `incoming/` are the earlier imported Meshy street props. They
were switched off because they read as gritty industrial salvage against clean
white towers, and are now superseded by `city/`. Kept for reference; nothing
loads them.
