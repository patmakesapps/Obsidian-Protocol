# Audio clips

Sampled SFX loaded by `src/core/Audio.js`. A clip missing from this folder
plays nothing — drop a correctly named file in here and it just works, no code
changes needed (as long as the name is listed in the `MANIFEST` in
`src/core/Audio.js`).

Formats: `.mp3`, `.wav`, or `.ogg` (checked in that order). Numbered suffixes
(`_1`, `_2`, ...) are random-picked variants — to add variety, add the next
number and list it in the `MANIFEST`.

## Music

The shared playlist `music_1` / `music_2` rotates on repeat. A level with its
own track uses it instead, looping alone:

| File | Level |
| --- | --- |
| `music_arcology.mp3` | OBSIDIAN ARCOLOGY (city) — Ghost Server Vault |
| `music_basin.mp3` | VERDANT BASIN (jungle) — Black Orbit |

## Filled slots

| File | Used for |
| --- | --- |
| `shoot_1/2.mp3` | Player weapon fire |
| `enemy_shoot_1.mp3` | Hostile fire (allies reuse it pitched up) |
| `impact_1.mp3` | Bolt hitting a surface |
| `explosion_1-4.mp3` | Drone / barrel explosions |
| `enemy_death_1.mp3` | Enemy killed |
| `pickup_1.mp3` | Ammo / weapon pickup |
| `health_pickup_1.mp3` | Health pickup |
| `deploy_1.mp3` | One-shot stinger on deploy |
| `dry_fire_1.mp3` | Trigger pull on empty mag |
| `reload_1.mp3` | Reload |
| `headshot_1.mp3` | Headshot sting (2 s cooldown so it can't stack) |
| `whizz_1/2.mp3` | Round snapping past your head |
| `weapon_switch_1.mp3` | Swapping weapons |
| `victory_1.mp3` | Mission complete |
| `run_loop_1.wav` | Looping bed while sprinting (WAV so the loop is seamless) |
| `walk_loop_1.wav` | Looping bed while walking |
| `music_1.mp3`, `music_2.mp3` | Shared soundtrack playlist |

## Empty slots (silent until filled)

| File | Used for |
| --- | --- |
| `footstep_1` | Footsteps (add `_2`/`_3` variants, they get pitch-jittered) |
| `player_hurt_1` | Taking damage |
| `hit_confirm_1` | Short tick when a body shot lands |
| `ally_shoot_1` | Friendly fire sound (optional — falls back to pitched enemy clip) |
| `objective_1` | New objective chime |
| `objective_complete_1` | Objective complete fanfare |
