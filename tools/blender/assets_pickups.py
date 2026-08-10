"""Ammo and med pickups. Read-at-a-glance silhouettes: boxy = ammo, cylindrical = med."""

import bpy, math, sys, os

sys.path.append(os.path.dirname(bpy.data.filepath) or r"C:\Sci_Fi_Game\tools\blender")
sys.path.append(r"C:\Sci_Fi_Game\tools\blender")
import kit
from kit import HEX, mat, box, cyl, cone, sphere, torus, bevel, join, dup, centre, export

# Materials are rebuilt per asset: kit.reset() purges unused datablocks between
# builds, so a module-level material would be a dangling reference by the second.
def palette():
    # Deliberately two-tone. A pickup has to be findable on the arcology's
    # near-white plaza AND on the basin's mid-green floor, so a single-value
    # body fails on one of them: the chassis is dark, the detail is white, and
    # the type colour glows. That silhouette reads on any background.
    return dict(
        shell=mat("shell_chassis", HEX["charcoal"], rough=0.45, metal=0.5),
        panel=mat("shell_panel", HEX["white"], rough=0.55, metal=0.05),
        dark=mat("shell_dark", HEX["black"], rough=0.35, metal=0.6),
        steel=mat("shell_steel", HEX["steel"], rough=0.35, metal=0.8),
        violet=mat("glow_violet", HEX["black"], rough=0.3, emit=HEX["purpleBright"], emit_strength=6.0),
        mint=mat("glow_mint", HEX["black"], rough=0.3, emit=HEX["mint"], emit_strength=6.0),
        amber=mat("glow_amber", HEX["black"], rough=0.3, emit=HEX["amber"], emit_strength=5.0),
    )


# ----------------------------------------------------------------- ammo crate
def build_ammo():
    p = palette()
    shell, panel, dark, steel = p["shell"], p["panel"], p["dark"], p["steel"]
    violet, amber = p["violet"], p["amber"]
    parts = []
    # Chamfered main body.
    body = box((0.66, 0.5, 0.42), material=shell, name="ammo_body")
    bevel(body, 0.035, 2)
    parts.append(body)

    # Lid, slightly proud, so the crate reads as openable.
    lid = box((0.7, 0.54, 0.07), loc=(0, 0, 0.235), material=panel, name="ammo_lid")
    bevel(lid, 0.02, 2)
    parts.append(lid)

    # Ribs down each long side — the main silhouette break, and white against
    # the dark chassis so the crate has internal contrast at any distance.
    for x in (-0.18, 0.18):
        rib = box((0.07, 0.56, 0.36), loc=(x, 0, 0), material=panel, name="ammo_rib")
        bevel(rib, 0.012, 1)
        parts.append(rib)

    # Corner feet.
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(
                box((0.1, 0.1, 0.08), loc=(sx * 0.29, sy * 0.21, -0.26), material=steel, name="foot")
            )

    # Glowing charge strip on both long faces + status lamp on the lid.
    for sy in (-1, 1):
        parts.append(
            box((0.4, 0.03, 0.05), loc=(0, sy * 0.215, 0.06), material=violet, name="ammo_strip")
        )
    parts.append(cyl(0.05, 0.03, 12, loc=(0.22, 0, 0.28), material=amber, name="ammo_lamp"))

    # Stacked cell canisters visible above the lid — says "ammunition" instantly.
    for i, x in enumerate((-0.19, -0.06, 0.07)):
        c = cyl(0.055, 0.2, 10, loc=(x, 0, 0.36), material=steel, name="cell")
        parts.append(c)
        parts.append(cyl(0.062, 0.035, 10, loc=(x, 0, 0.45), material=violet, name="cell_tip"))

    obj = join(parts, "pickup_ammo")
    centre(obj)
    return obj


# ------------------------------------------------------------------ med canister
def build_health():
    p = palette()
    shell, panel, dark, steel, mint = p["shell"], p["panel"], p["dark"], p["steel"], p["mint"]
    parts = []
    # Twin canister body.
    for sx in (-0.13, 0.13):
        c = cyl(0.145, 0.5, 14, loc=(sx, 0, 0), material=shell, name="med_can")
        bevel(c, 0.02, 1)
        parts.append(c)
        parts.append(cyl(0.155, 0.05, 14, loc=(sx, 0, 0.24), material=dark, name="med_collar"))
        parts.append(cyl(0.155, 0.05, 14, loc=(sx, 0, -0.24), material=dark, name="med_collar"))
        parts.append(cyl(0.05, 0.1, 8, loc=(sx, 0, 0.3), material=steel, name="med_valve"))

    # Clamp band holding the pair together.
    parts.append(box((0.56, 0.3, 0.09), loc=(0, 0, 0.02), material=panel, name="med_band"))
    parts.append(box((0.58, 0.32, 0.02), loc=(0, 0, 0.075), material=dark, name="med_band_trim"))

    # Medical cross, front and back — the read at distance.
    for sy in (-1, 1):
        y = sy * 0.16
        parts.append(box((0.19, 0.02, 0.06), loc=(0, y, -0.04), material=mint, name="cross_h"))
        parts.append(box((0.06, 0.02, 0.19), loc=(0, y, -0.04), material=mint, name="cross_v"))

    # Fluid window: a glowing sliver down each canister.
    for sx in (-0.13, 0.13):
        parts.append(box((0.045, 0.02, 0.3), loc=(sx, -0.145, -0.03), material=mint, name="window"))

    obj = join(parts, "pickup_health")
    centre(obj)
    return obj


results = []
for builder, filename in ((build_ammo, "pickup_ammo.glb"), (build_health, "pickup_health.glb")):
    kit.reset()
    obj = builder()
    results.append(export(obj, filename))

print("PICKUPS DONE", len(results))
