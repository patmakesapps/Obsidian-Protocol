# Character & weapon drop-in

Files here are loaded at startup. If a file is missing the game falls back to the
built-in primitive placeholder — nothing breaks, you just see the blocky version.

| File | What it becomes |
| --- | --- |
| `enemy.glb` | Every hostile in the level |
| `weapon.glb` | The first-person viewmodel |

## Exporting from Meshy

1. Generate the character, then use **Rig & Animate** so the GLB ships with clips.
2. Export as **GLB** (not FBX — GLB keeps textures embedded in one file).
3. Rename to `enemy.glb` and drop it in this folder. Refresh the browser.

Scale and pivot are handled automatically: `Enemy._normalizeModelScale()` measures
the model's bounding box, rescales it to `CONFIG.enemy.height`, and drops it so
the feet sit on the ground. You don't need to pre-scale anything in Blender.

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
