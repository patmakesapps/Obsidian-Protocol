"""
Street furniture for the arcology level.

These replace the imported Meshy props, which were switched off in config
(`world.useGlbProps`) because they read as gritty industrial salvage against
clean white towers. This set is built from the same palette as the procedural
architecture, so it belongs in the frame instead of fighting it.

Cover pieces are modelled at 1.0-1.3 m — chest height on a 1.8 m player — since
the AI's standoff behaviour only works if there is something to break line of
sight at torso level.
"""

import bpy, math, random, sys, os

sys.path.insert(0, r"C:\Sci_Fi_Game\tools\blender")
import kit
from kit import (HEX, mat, box, cyl, cone, sphere, ico, torus, bevel, deform,
                 join, centre, ground, export)

SUB = "city"


def pal():
    return dict(
        white=mat("city_white", HEX["white"], rough=0.5, metal=0.1),
        panel=mat("city_panel", HEX["offWhite"], rough=0.6),
        grey=mat("city_grey", HEX["concrete"], rough=0.7),
        dark=mat("city_dark", HEX["charcoal"], rough=0.4, metal=0.55),
        glass=mat("city_glass", HEX["black"], rough=0.15, metal=0.4),
        steel=mat("city_steel", HEX["steel"], rough=0.35, metal=0.85),
        violet=mat("city_violet", HEX["black"], rough=0.3, emit=HEX["purpleBright"], emit_strength=4.0),
        deep=mat("city_deep", HEX["black"], rough=0.3, emit=HEX["purple"], emit_strength=3.0),
        amber=mat("city_amber", HEX["black"], rough=0.3, emit=HEX["amber"], emit_strength=3.5),
        leaf=mat("city_leaf", HEX["leaf"], rough=0.85),
        leafDeep=mat("city_leaf_deep", HEX["leafDeep"], rough=0.88),
    )


# --------------------------------------------------------------------- cover

def build_barrier():
    """Crowd barrier, 3.2 m — the workhorse cover piece."""
    p = pal()
    parts = []
    body = box((3.2, 0.42, 1.05), loc=(0, 0, 0.55), material=p["white"], name="body")
    bevel(body, 0.04, 2)
    parts.append(body)
    parts.append(box((3.3, 0.5, 0.12), loc=(0, 0, 1.1), material=p["dark"], name="cap"))
    parts.append(box((2.4, 0.16, 0.08), loc=(0, -0.24, 0.82), material=p["violet"], name="strip"))
    for sx in (-1.5, 0.0, 1.5):
        parts.append(box((0.16, 0.62, 1.0), loc=(sx, 0, 0.5), material=p["panel"], name="rib"))
    for sx in (-1.45, 1.45):
        parts.append(box((0.3, 0.7, 0.16), loc=(sx, 0, 0.08), material=p["steel"], name="foot"))
    obj = join(parts, "city_barrier")
    ground(obj)
    return obj


def build_planter():
    """Hexagonal planter with a clipped hedge. Cover that isn't another box."""
    p = pal()
    parts = []
    tub = cyl(1.5, 0.95, 6, loc=(0, 0, 0.48), material=p["white"], name="tub")
    bevel(tub, 0.04, 1)
    parts.append(tub)
    parts.append(cyl(1.58, 0.14, 6, loc=(0, 0, 0.95), material=p["dark"], name="rim"))
    parts.append(cyl(1.42, 0.1, 6, loc=(0, 0, 0.88), material=p["grey"], name="soil"))
    parts.append(box((0.9, 0.06, 0.1), loc=(0, -1.35, 0.6), material=p["violet"], name="strip"))
    # Hedge: two flattened blobs so it isn't a perfect dome.
    for i, (r, z, material) in enumerate(((1.25, 1.35, p["leafDeep"]), (0.95, 1.7, p["leaf"]))):
        b = ico(r, 1, loc=(0, 0, z), material=material, name="hedge")
        b.scale = (1.0, 1.0, 0.62)
        bpy.context.view_layer.objects.active = b
        bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)
        deform(b, r * 0.18, 40 + i)
        parts.append(b)
    obj = join(parts, "city_planter")
    ground(obj)
    return obj


def build_cargo():
    """Sealed transport pallet, 2.4 m. Stackable-looking cover."""
    p = pal()
    parts = []
    body = box((2.4, 1.6, 1.3), loc=(0, 0, 0.65), material=p["panel"], name="body")
    bevel(body, 0.05, 2)
    parts.append(body)
    parts.append(box((2.5, 1.7, 0.16), loc=(0, 0, 1.32), material=p["dark"], name="lid"))
    parts.append(box((2.5, 1.7, 0.18), loc=(0, 0, 0.09), material=p["steel"], name="pallet"))
    for sx in (-0.8, 0.0, 0.8):
        parts.append(box((0.14, 1.66, 1.2), loc=(sx, 0, 0.65), material=p["white"], name="rib"))
    for sy in (-1, 1):
        parts.append(box((1.2, 0.06, 0.12), loc=(0, sy * 0.82, 1.0), material=p["amber"], name="label"))
    obj = join(parts, "city_cargo")
    ground(obj)
    return obj


def build_generator():
    """Utility plant unit, 2.8 m. Reads as infrastructure, works as cover."""
    p = pal()
    parts = []
    parts.append(box((2.8, 1.5, 1.25), loc=(0, 0, 0.63), material=p["white"], name="body"))
    parts.append(box((2.86, 1.56, 0.14), loc=(0, 0, 1.28), material=p["dark"], name="cap"))
    # Cooling fins.
    for i in range(7):
        x = -1.1 + i * 0.37
        parts.append(box((0.1, 1.6, 0.9), loc=(x, 0, 0.72), material=p["steel"], name="fin"))
    parts.append(cyl(0.42, 0.5, 10, rot=(math.pi / 2, 0, 0), loc=(1.1, -0.78, 0.7),
                     material=p["dark"], name="fan"))
    parts.append(torus(0.42, 0.06, 10, 5, rot=(math.pi / 2, 0, 0), loc=(1.1, -0.82, 0.7),
                       material=p["violet"], name="fan_ring"))
    parts.append(box((0.5, 0.3, 0.4), loc=(-1.15, -0.72, 0.9), material=p["glass"], name="panel"))
    parts.append(cyl(0.2, 1.1, 8, loc=(-0.9, 0.4, 1.75), material=p["steel"], name="stack"))
    parts.append(cyl(0.24, 0.16, 8, loc=(-0.9, 0.4, 2.3), material=p["amber"], name="stack_tip"))
    obj = join(parts, "city_generator")
    ground(obj)
    return obj


# ------------------------------------------------------------------- fixtures

def build_kiosk():
    """Info pillar, 3.4 m. Vertical accent along the avenues."""
    p = pal()
    parts = []
    parts.append(cyl(0.62, 0.24, 8, loc=(0, 0, 0.12), material=p["dark"], name="base"))
    col = box((0.9, 0.62, 3.0), loc=(0, 0, 1.6), material=p["white"], name="col")
    bevel(col, 0.04, 2)
    parts.append(col)
    # Screens, both faces.
    for sy in (-1, 1):
        parts.append(box((0.72, 0.06, 1.5), loc=(0, sy * 0.32, 2.0), material=p["glass"], name="screen"))
        parts.append(box((0.6, 0.04, 1.2), loc=(0, sy * 0.35, 2.0), material=p["deep"], name="screen_glow"))
    parts.append(box((0.96, 0.68, 0.18), loc=(0, 0, 3.2), material=p["dark"], name="crown"))
    parts.append(box((0.8, 0.5, 0.08), loc=(0, 0, 3.32), material=p["violet"], name="crown_glow"))
    parts.append(box((0.86, 0.1, 0.06), loc=(0, -0.3, 0.9), material=p["amber"], name="ticker"))
    obj = join(parts, "city_kiosk")
    ground(obj)
    return obj


def build_bench():
    """Bench with an integrated lamp — plaza dressing, not cover."""
    p = pal()
    parts = []
    seat = box((2.6, 0.7, 0.16), loc=(0, 0, 0.48), material=p["white"], name="seat")
    bevel(seat, 0.03, 2)
    parts.append(seat)
    parts.append(box((2.6, 0.14, 0.5), loc=(0, 0.3, 0.78), material=p["panel"], name="back"))
    parts.append(box((2.4, 0.06, 0.06), loc=(0, 0.36, 0.98), material=p["violet"], name="glow"))
    for sx in (-1.05, 1.05):
        parts.append(box((0.16, 0.62, 0.44), loc=(sx, 0, 0.22), material=p["dark"], name="leg"))
    parts.append(cyl(0.09, 2.6, 6, loc=(1.5, 0.2, 1.3), material=p["steel"], name="post"))
    parts.append(box((0.34, 0.34, 0.12), loc=(1.5, 0.2, 2.6), material=p["violet"], name="lamp"))
    obj = join(parts, "city_bench")
    ground(obj)
    return obj


def build_pylon():
    """Transit signal pylon, 8 m. Breaks up long street sightlines."""
    p = pal()
    parts = []
    parts.append(cyl(0.9, 0.5, 8, loc=(0, 0, 0.25), material=p["dark"], name="base"))
    parts.append(cone(r1=0.62, r2=0.34, h=7.0, verts=8, loc=(0, 0, 3.6), material=p["white"], name="shaft"))
    for z in (2.0, 4.0, 6.0):
        parts.append(torus(0.5 - z * 0.03, 0.1, 8, 5, loc=(0, 0, z), material=p["dark"], name="collar"))
        parts.append(box((0.9, 0.1, 0.1), loc=(0, 0, z + 0.25), material=p["violet"], name="tick"))
    # Signal head.
    parts.append(box((1.5, 0.5, 0.9), loc=(0, 0, 7.5), material=p["panel"], name="head"))
    for sx in (-0.45, 0.0, 0.45):
        parts.append(cyl(0.16, 0.1, 8, rot=(math.pi / 2, 0, 0), loc=(sx, -0.28, 7.5),
                         material=p["amber"] if sx == 0 else p["violet"], name="light"))
    parts.append(cyl(0.14, 1.4, 6, loc=(0, 0, 8.6), material=p["steel"], name="whip"))
    obj = join(parts, "city_pylon")
    ground(obj)
    return obj


def build_arch():
    """Gateway arch, 11 m span. Frames streets and reads at distance."""
    p = pal()
    parts = []
    for sx in (-5.0, 5.0):
        leg = box((1.4, 1.4, 8.0), loc=(sx, 0, 4.0), material=p["white"], name="leg")
        bevel(leg, 0.06, 2)
        parts.append(leg)
        parts.append(box((1.9, 1.9, 0.5), loc=(sx, 0, 0.25), material=p["dark"], name="footing"))
        parts.append(box((0.2, 1.44, 5.0), loc=(sx + 0.72, 0, 4.5), material=p["violet"], name="leg_glow"))
    parts.append(box((11.6, 1.6, 1.5), loc=(0, 0, 8.7), material=p["panel"], name="span"))
    parts.append(box((11.8, 1.7, 0.2), loc=(0, 0, 9.5), material=p["dark"], name="span_cap"))
    parts.append(box((9.0, 0.16, 0.5), loc=(0, -0.85, 8.6), material=p["deep"], name="sign"))
    for i in range(5):
        x = -4.0 + i * 2.0
        parts.append(box((0.5, 1.7, 0.4), loc=(x, 0, 7.9), material=p["steel"], name="strut"))
    obj = join(parts, "city_arch")
    ground(obj)
    return obj


def build_monument():
    """Plaza monument, 9 m. A landmark to navigate by in an even grid."""
    p = pal()
    parts = []
    parts.append(cyl(3.2, 0.6, 12, loc=(0, 0, 0.3), material=p["grey"], name="step"))
    parts.append(cyl(2.4, 0.6, 12, loc=(0, 0, 0.9), material=p["panel"], name="step2"))
    parts.append(cyl(1.6, 0.7, 12, loc=(0, 0, 1.55), material=p["white"], name="plinth"))
    parts.append(torus(1.6, 0.12, 12, 6, loc=(0, 0, 1.9), material=p["violet"], name="plinth_ring"))
    # Three tapered blades leaning into each other.
    for i in range(3):
        a = i * 2.094
        parts.append(cone(r1=0.55, r2=0.12, h=6.5, verts=4,
                          loc=(math.cos(a) * 0.75, math.sin(a) * 0.75, 5.1),
                          rot=(math.sin(a) * -0.16, math.cos(a) * 0.16, a),
                          material=p["white"], name="blade"))
    parts.append(ico(0.85, 1, loc=(0, 0, 8.3), material=p["deep"], name="core"))
    parts.append(torus(1.3, 0.08, 16, 5, rot=(0.5, 0, 0), loc=(0, 0, 8.3), material=p["violet"], name="halo"))
    obj = join(parts, "city_monument")
    ground(obj)
    return obj


BUILDS = [
    (build_barrier, "city_barrier.glb"),
    (build_planter, "city_planter.glb"),
    (build_cargo, "city_cargo.glb"),
    (build_generator, "city_generator.glb"),
    (build_kiosk, "city_kiosk.glb"),
    (build_bench, "city_bench.glb"),
    (build_pylon, "city_pylon.glb"),
    (build_arch, "city_arch.glb"),
    (build_monument, "city_monument.glb"),
]

total = 0
for builder, filename in BUILDS:
    kit.reset()
    obj = builder()
    _, tris, _ = export(obj, filename, SUB)
    total += tris
print(f"CITY SET DONE — {len(BUILDS)} assets, {total} tris total")
