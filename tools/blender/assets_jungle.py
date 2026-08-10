"""
Verdant Basin asset set — the jungle-canyon outpost.

Style reference: weathered white ceramic habitat modules cantilevered out of a
green cliff face. The modules are hard-surface and bright; the foliage is
matte, dark and untextured. Everything is flat-shaded so the smooth, textured
characters stay separable from the set dressing at a glance.

Scale is real metres. The level code re-measures each GLB and fits it to a
target size anyway, but modelling true-to-scale keeps proportions honest.
"""

import bpy, bmesh, math, random, sys, os
from mathutils import Vector

sys.path.insert(0, r"C:\Sci_Fi_Game\tools\blender")
import kit
from kit import (HEX, mat, box, cyl, cone, sphere, ico, torus, plane,
                 bevel, solidify, deform, join, dup, centre, ground, export, dims)

SUB = "jungle"


def hull():
    """Materials for the habitat modules."""
    return dict(
        shell=mat("hab_shell", HEX["white"], rough=0.62, metal=0.03),
        panel=mat("hab_panel", HEX["offWhite"], rough=0.7),
        worn=mat("hab_worn", HEX["concrete"], rough=0.82),
        dark=mat("hab_dark", HEX["charcoal"], rough=0.35, metal=0.6),
        glass=mat("hab_glass", HEX["black"], rough=0.12, metal=0.4),
        steel=mat("hab_steel", HEX["steel"], rough=0.4, metal=0.85),
        amber=mat("hab_amber", HEX["black"], rough=0.3, emit=HEX["amber"], emit_strength=3.0),
        violet=mat("hab_violet", HEX["black"], rough=0.3, emit=HEX["purpleBright"], emit_strength=3.0),
        moss=mat("hab_moss", HEX["moss"], rough=0.9),
    )


def flora():
    return dict(
        bark=mat("bark", HEX["bark"], rough=0.9),
        barkPale=mat("bark_pale", HEX["barkPale"], rough=0.9),
        leaf=mat("leaf", HEX["leaf"], rough=0.85),
        leafDeep=mat("leaf_deep", HEX["leafDeep"], rough=0.88),
        leafLight=mat("leaf_light", HEX["leafLight"], rough=0.82),
    )


def stone():
    return dict(
        rock=mat("rock", HEX["rock"], rough=0.92),
        rockDark=mat("rock_dark", HEX["rockDark"], rough=0.95),
        moss=mat("rock_moss", HEX["moss"], rough=0.9),
    )


# --------------------------------------------------------------------- leaves

def blade(length=3.0, width=0.5, droop=0.55, segments=5, material=None, name="blade"):
    """
    A drooping leaf strip built as a quad ribbon. Cheaper and better-shaded than
    a bent plane, and the taper keeps the silhouette organic at flat shading.
    """
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rows = []
    for i in range(segments + 1):
        t = i / segments
        y = t * length
        # Sag accelerates toward the tip, and the blade tapers to a point.
        z = -droop * (t ** 2) * length * 0.5
        w = width * (1.0 - t ** 1.6) * (0.35 + 0.65 * math.sin(min(t * 3.4, math.pi / 2)))
        rows.append((bm.verts.new((-w, y, z)), bm.verts.new((w, y, z))))
    for i in range(segments):
        a, b = rows[i]
        c, d = rows[i + 1]
        bm.faces.new((a, b, d, c))
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    if material:
        obj.data.materials.append(material)
    obj.data.polygons.foreach_set("use_smooth", [False] * len(obj.data.polygons))
    return obj


# ------------------------------------------------------------- hero: hab disc

def build_hab_disc():
    """The big saucer habitat that hangs over the basin. 24 m across."""
    m = hull()
    parts = []
    R = 12.0

    # Body: two shallow cones back to back gives the classic saucer section
    # without the polygon cost of a lathe.
    upper = cone(r1=R, r2=R * 0.74, h=2.4, verts=24, loc=(0, 0, 1.2), material=m["shell"], name="disc_upper")
    parts.append(upper)
    lower = cone(r1=R * 0.86, r2=R * 0.44, h=3.0, verts=24, loc=(0, 0, -1.5), material=m["worn"], name="disc_lower")
    parts.append(lower)

    # Glazing band around the widest point — the read that says "inhabited".
    parts.append(cyl(R * 1.005, 0.9, 24, loc=(0, 0, 0.15), material=m["glass"], name="disc_glass"))
    parts.append(torus(R * 1.01, 0.16, 24, 6, loc=(0, 0, 0.62), material=m["dark"], name="disc_lip"))
    parts.append(torus(R * 1.01, 0.16, 24, 6, loc=(0, 0, -0.32), material=m["dark"], name="disc_lip"))

    # Upper deck stack.
    parts.append(cyl(R * 0.62, 1.1, 20, loc=(0, 0, 2.9), material=m["panel"], name="deck"))
    parts.append(cyl(R * 0.4, 0.7, 16, loc=(0, 0, 3.7), material=m["shell"], name="deck2"))
    parts.append(torus(R * 0.4, 0.12, 16, 6, loc=(0, 0, 4.05), material=m["steel"], name="deck_rail"))

    # Radial roof panels + a couple of amber service lamps.
    for i in range(8):
        a = i * math.pi / 4
        parts.append(box((2.6, 0.9, 0.22), loc=(math.cos(a) * R * 0.8, math.sin(a) * R * 0.8, 2.45),
                         rot=(0, 0, a), material=m["panel"], name="roof_panel"))
    for i in range(4):
        a = i * math.pi / 2 + 0.4
        parts.append(box((0.5, 0.16, 0.12), loc=(math.cos(a) * R * 0.95, math.sin(a) * R * 0.95, 2.42),
                         rot=(0, 0, a), material=m["amber"], name="lamp"))

    # Underside: docking collar and radiating ribs, which is what you actually
    # see from the basin floor.
    parts.append(cyl(R * 0.3, 1.6, 16, loc=(0, 0, -3.6), material=m["steel"], name="collar"))
    parts.append(torus(R * 0.32, 0.2, 16, 6, loc=(0, 0, -4.3), material=m["dark"], name="collar_ring"))
    for i in range(6):
        a = i * math.pi / 3
        parts.append(box((0.5, R * 0.7, 0.4), loc=(math.cos(a) * R * 0.4, math.sin(a) * R * 0.4, -2.4),
                         rot=(0, 0, a + math.pi / 2), material=m["steel"], name="rib"))

    # Antenna mast so the silhouette breaks the canopy line.
    parts.append(cyl(0.16, 5.0, 8, loc=(2.2, -1.4, 6.4), material=m["steel"], name="mast"))
    parts.append(cyl(1.5, 0.18, 12, loc=(2.2, -1.4, 8.7), material=m["panel"], name="dish"))
    parts.append(box((0.22, 0.22, 0.5), loc=(2.2, -1.4, 9.1), material=m["amber"], name="mast_lamp"))

    obj = join(parts, "jungle_hab_disc")
    ground(obj)
    return obj


# --------------------------------------------------------------- capsule pod

def build_hab_pod():
    """Horizontal capsule module, 9 m long. Used both perched and grounded."""
    m = hull()
    parts = []
    L, R = 5.2, 1.9

    body = cyl(R, L, 16, rot=(0, math.pi / 2, 0), material=m["shell"], name="pod_body")
    parts.append(body)
    for sx in (-1, 1):
        capsule_end = sphere(R, 16, 8, loc=(sx * L / 2, 0, 0), material=m["worn"], name="pod_cap")
        capsule_end.scale = (0.65, 1, 1)
        bpy.context.view_layer.objects.active = capsule_end
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        parts.append(capsule_end)

    # Rib rings.
    for x in (-1.7, 0.0, 1.7):
        parts.append(cyl(R * 1.06, 0.28, 16, rot=(0, math.pi / 2, 0), loc=(x, 0, 0),
                         material=m["dark"], name="pod_rib"))

    # Window band down one flank + a lit porthole row on the other.
    parts.append(box((3.6, 0.2, 0.9), loc=(0, -R * 0.94, 0.25), material=m["glass"], name="pod_glass"))
    for x in (-1.1, 0.0, 1.1):
        parts.append(cyl(0.34, 0.2, 12, rot=(math.pi / 2, 0, 0), loc=(x, R * 0.92, 0.3),
                         material=m["glass"], name="porthole"))

    # Dorsal service spine.
    parts.append(box((4.4, 0.7, 0.4), loc=(0, 0, R * 0.86), material=m["panel"], name="spine"))
    parts.append(box((3.0, 0.24, 0.1), loc=(0, 0, R * 1.06), material=m["amber"], name="spine_strip"))

    # Landing skids.
    for sx in (-1.6, 1.6):
        for sy in (-1, 1):
            parts.append(box((0.34, 0.34, 1.5), loc=(sx, sy * 1.1, -R - 0.5),
                             material=m["steel"], name="skid"))
    for sy in (-1, 1):
        parts.append(box((4.2, 0.42, 0.3), loc=(0, sy * 1.1, -R - 1.3), material=m["dark"], name="skid_foot"))

    # Hatch.
    parts.append(box((0.14, 1.3, 1.6), loc=(L / 2 + 0.9, 0, -0.2), material=m["panel"], name="hatch"))
    parts.append(box((0.06, 0.9, 0.16), loc=(L / 2 + 1.0, 0, 0.3), material=m["violet"], name="hatch_light"))

    obj = join(parts, "jungle_hab_pod")
    ground(obj)
    return obj


# ------------------------------------------------------------------ dome silo

def build_hab_dome():
    """Domed silo with an arched entry — the ground-level structure players enter."""
    m = hull()
    parts = []
    R = 3.4

    parts.append(cyl(R, 5.0, 20, loc=(0, 0, 2.5), material=m["shell"], name="silo"))
    dome_top = sphere(R, 20, 10, loc=(0, 0, 5.0), material=m["worn"], name="dome")
    dome_top.scale = (1, 1, 0.72)
    bpy.context.view_layer.objects.active = dome_top
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    parts.append(dome_top)
    # Trim the hidden lower hemisphere off by burying it — cheaper than a boolean
    # and invisible once the silo body occludes it.

    parts.append(torus(R * 1.02, 0.22, 20, 6, loc=(0, 0, 5.0), material=m["dark"], name="dome_ring"))
    parts.append(torus(R * 1.02, 0.18, 20, 6, loc=(0, 0, 1.2), material=m["dark"], name="base_ring"))

    # Vertical ribs.
    for i in range(8):
        a = i * math.pi / 4
        parts.append(box((0.34, 0.34, 4.4), loc=(math.cos(a) * R * 0.99, math.sin(a) * R * 0.99, 3.0),
                         rot=(0, 0, a), material=m["panel"], name="silo_rib"))

    # Arched entry: a recessed dark portal with a lit lintel.
    parts.append(box((2.4, 0.5, 2.8), loc=(0, -R * 0.95, 1.4), material=m["glass"], name="portal"))
    parts.append(cyl(1.2, 0.5, 12, rot=(math.pi / 2, 0, 0), loc=(0, -R * 0.95, 2.8),
                     material=m["glass"], name="portal_arch"))
    parts.append(box((2.9, 0.3, 0.3), loc=(0, -R * 1.05, 3.4), material=m["amber"], name="lintel"))
    for sx in (-1.45, 1.45):
        parts.append(box((0.34, 0.44, 3.5), loc=(sx, -R * 1.02, 1.75), material=m["shell"], name="jamb"))

    # Window slits high on the flanks.
    for a in (math.pi * 0.35, math.pi * 0.65, math.pi * 1.35, math.pi * 1.65):
        parts.append(box((1.4, 0.3, 0.55), loc=(math.cos(a) * R * 0.96, math.sin(a) * R * 0.96, 4.1),
                         rot=(0, 0, a + math.pi / 2), material=m["glass"], name="slit"))

    # Roof cap and vent stacks.
    parts.append(cyl(0.9, 0.5, 12, loc=(0, 0, 7.5), material=m["steel"], name="cap"))
    for sx, sy in ((1.6, 0.6), (-1.2, -1.3)):
        parts.append(cyl(0.34, 1.6, 8, loc=(sx, sy, 6.6), material=m["steel"], name="vent"))

    # Weathering: a moss skirt where the structure meets the ground.
    parts.append(cyl(R * 1.06, 0.5, 20, loc=(0, 0, 0.25), material=m["moss"], name="moss_skirt"))

    obj = join(parts, "jungle_hab_dome")
    ground(obj)
    return obj


# ------------------------------------------------------------- cliff module

def build_hab_block():
    """Rectilinear module cantilevered from the cliff — background silhouette."""
    m = hull()
    parts = []

    parts.append(box((9.0, 5.0, 3.6), loc=(0, 0, 1.8), material=m["shell"], name="block"))
    parts.append(box((6.4, 4.0, 2.4), loc=(-0.8, 0.4, 4.6), material=m["worn"], name="block_upper"))
    parts.append(box((9.4, 5.4, 0.4), loc=(0, 0, 3.75), material=m["panel"], name="block_lip"))

    # Glazing runs the long face.
    parts.append(box((7.6, 0.3, 1.3), loc=(0, -2.5, 2.1), material=m["glass"], name="block_glass"))
    parts.append(box((5.2, 0.3, 1.0), loc=(-0.8, -1.5, 4.8), material=m["glass"], name="block_glass2"))

    # Balcony with railing posts.
    parts.append(box((7.0, 1.6, 0.3), loc=(0, -3.2, 0.45), material=m["panel"], name="balcony"))
    for i in range(9):
        x = -3.2 + i * 0.8
        parts.append(box((0.1, 0.1, 1.0), loc=(x, -3.9, 1.0), material=m["steel"], name="post"))
    parts.append(box((7.0, 0.1, 0.1), loc=(0, -3.9, 1.5), material=m["steel"], name="rail"))

    # Support struts under the overhang.
    for sx in (-3.0, 0.0, 3.0):
        parts.append(box((0.4, 0.4, 3.2), loc=(sx, -2.2, -1.4), rot=(0.42, 0, 0),
                         material=m["steel"], name="strut"))

    # Roof clutter.
    parts.append(box((2.0, 1.6, 0.7), loc=(2.6, -0.6, 6.15), material=m["steel"], name="hvac"))
    parts.append(cyl(0.22, 3.0, 8, loc=(3.6, 1.2, 7.3), material=m["steel"], name="aerial"))
    parts.append(box((5.0, 0.22, 0.16), loc=(-0.8, -2.0, 5.85), material=m["amber"], name="strip"))

    obj = join(parts, "jungle_hab_block")
    ground(obj)
    return obj


# ----------------------------------------------------------------- structures

def build_column():
    """18 m support column. Carries the disc habitat and frames the waterfall."""
    m = hull()
    parts = []
    H = 18.0

    parts.append(cone(r1=2.6, r2=1.9, h=H, verts=16, loc=(0, 0, H / 2), material=m["worn"], name="col"))
    for z in (2.5, 6.5, 10.5, 14.5):
        parts.append(torus(2.35 - z * 0.02, 0.3, 16, 6, loc=(0, 0, z), material=m["dark"], name="collar"))
    # Vertical greeble ribs on three faces only — cheaper, and the column is
    # always seen from the basin side.
    for i in range(5):
        a = -0.9 + i * 0.45
        parts.append(box((0.4, 0.4, H * 0.8), loc=(math.cos(a) * 2.3, math.sin(a) * 2.3, H * 0.45),
                         rot=(0, 0, a), material=m["panel"], name="col_rib"))
    parts.append(cyl(3.4, 1.2, 16, loc=(0, 0, 0.6), material=m["dark"], name="footing"))
    parts.append(cyl(3.0, 1.0, 16, loc=(0, 0, H - 0.5), material=m["steel"], name="capital"))
    parts.append(box((1.2, 0.3, 0.2), loc=(0, -2.4, 8.0), material=m["amber"], name="marker"))
    parts.append(cyl(3.5, 0.6, 16, loc=(0, 0, 0.3), material=m["moss"], name="moss"))

    obj = join(parts, "jungle_column")
    ground(obj)
    return obj


def build_landing_pad():
    """Ground-level platform with ramp — gives the flat basin some structure."""
    m = hull()
    parts = []

    parts.append(cyl(6.0, 0.9, 16, loc=(0, 0, 0.45), material=m["panel"], name="pad"))
    parts.append(torus(6.0, 0.25, 16, 6, loc=(0, 0, 0.9), material=m["dark"], name="pad_rim"))
    # Landing chevrons.
    for i in range(4):
        a = i * math.pi / 2 + math.pi / 4
        parts.append(box((2.4, 0.4, 0.06), loc=(math.cos(a) * 3.4, math.sin(a) * 3.4, 0.93),
                         rot=(0, 0, a + math.pi / 2), material=m["amber"], name="chevron"))
    parts.append(torus(2.2, 0.1, 16, 6, loc=(0, 0, 0.93), material=m["violet"], name="ring"))
    # Ramp down to grade.
    parts.append(box((3.0, 3.4, 0.25), loc=(0, -6.8, 0.45), rot=(-0.26, 0, 0), material=m["panel"], name="ramp"))
    # Perimeter service boxes, chest height, so the pad doubles as cover.
    for a in (0.6, 2.2, 3.9, 5.4):
        parts.append(box((1.3, 0.9, 1.2), loc=(math.cos(a) * 5.0, math.sin(a) * 5.0, 1.5),
                         rot=(0, 0, a), material=m["shell"], name="service"))
        parts.append(box((1.34, 0.2, 0.12), loc=(math.cos(a) * 5.0, math.sin(a) * 5.0, 2.05),
                         rot=(0, 0, a), material=m["violet"], name="service_strip"))

    obj = join(parts, "jungle_landing_pad")
    ground(obj)
    return obj


def build_catwalk():
    """8 m walkway segment with railings — connects pods on the cliff."""
    m = hull()
    parts = []
    parts.append(box((8.0, 1.8, 0.22), loc=(0, 0, 0), material=m["panel"], name="deck"))
    for i in range(9):
        x = -3.6 + i * 0.9
        parts.append(box((0.18, 1.7, 0.06), loc=(x, 0, 0.14), material=m["dark"], name="tread"))
    for sy in (-1, 1):
        parts.append(box((8.0, 0.08, 0.08), loc=(0, sy * 0.88, 1.0), material=m["steel"], name="rail"))
        for i in range(7):
            x = -3.4 + i * 1.15
            parts.append(box((0.08, 0.08, 1.0), loc=(x, sy * 0.88, 0.5), material=m["steel"], name="post"))
    parts.append(box((0.5, 2.0, 0.5), loc=(-3.9, 0, -0.3), material=m["dark"], name="anchor"))
    parts.append(box((0.5, 2.0, 0.5), loc=(3.9, 0, -0.3), material=m["dark"], name="anchor"))

    obj = join(parts, "jungle_catwalk")
    centre(obj)
    return obj


def build_crate():
    """Weathered supply crate — chest-high cover on the basin floor."""
    m = hull()
    parts = []
    body = box((1.5, 1.2, 1.15), loc=(0, 0, 0.6), material=m["worn"], name="crate")
    bevel(body, 0.05, 1)
    parts.append(body)
    parts.append(box((1.56, 1.26, 0.14), loc=(0, 0, 1.2), material=m["dark"], name="lid"))
    for sx in (-0.62, 0.62):
        parts.append(box((0.14, 1.26, 1.0), loc=(sx, 0, 0.6), material=m["steel"], name="corner"))
    parts.append(box((0.9, 0.06, 0.1), loc=(0, -0.62, 0.9), material=m["amber"], name="label"))
    parts.append(box((1.5, 1.2, 0.16), loc=(0, 0, 0.08), material=m["moss"], name="moss"))

    obj = join(parts, "jungle_crate")
    ground(obj)
    return obj


def build_antenna():
    """Comms mast — vertical accent, no cover value."""
    m = hull()
    parts = []
    parts.append(cyl(0.34, 7.0, 8, loc=(0, 0, 3.5), material=m["steel"], name="mast"))
    parts.append(cyl(0.9, 0.4, 12, loc=(0, 0, 0.2), material=m["dark"], name="base"))
    for z, r in ((2.4, 1.1), (4.2, 0.9), (5.8, 0.7)):
        parts.append(torus(r, 0.07, 10, 5, loc=(0, 0, z), material=m["steel"], name="ring"))
        for i in range(3):
            a = i * 2.094 + z
            parts.append(box((r, 0.08, 0.08), loc=(math.cos(a) * r / 2, math.sin(a) * r / 2, z),
                             rot=(0, 0, a), material=m["steel"], name="spoke"))
    parts.append(cyl(1.3, 0.14, 12, rot=(0.6, 0, 0), loc=(0, -0.5, 7.0), material=m["panel"], name="dish"))
    parts.append(box((0.2, 0.2, 0.4), loc=(0, 0, 7.4), material=m["amber"], name="beacon"))
    obj = join(parts, "jungle_antenna")
    ground(obj)
    return obj


# ---------------------------------------------------------------------- rocks

def build_rock(seed, radius=1.6, tall=0.8, mossy=True, name="jungle_rock"):
    s = stone()
    parts = []
    r = ico(radius, 1, material=s["rock"], name="rock")
    r.scale = (1.0, 0.85, tall)
    bpy.context.view_layer.objects.active = r
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    deform(r, radius * 0.28, seed)
    parts.append(r)

    rnd = random.Random(seed + 7)
    for _ in range(2):
        chunk = ico(radius * (0.4 + rnd.random() * 0.25), 1, material=s["rockDark"], name="chunk")
        chunk.location = (
            (rnd.random() - 0.5) * radius * 1.6,
            (rnd.random() - 0.5) * radius * 1.6,
            -radius * 0.2,
        )
        bpy.context.view_layer.objects.active = chunk
        bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
        deform(chunk, radius * 0.16, seed + 3)
        parts.append(chunk)

    if mossy:
        cap = ico(radius * 0.92, 1, loc=(0, 0, radius * tall * 0.34), material=s["moss"], name="moss")
        cap.scale = (1.0, 0.85, tall * 0.5)
        bpy.context.view_layer.objects.active = cap
        bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)
        deform(cap, radius * 0.2, seed + 11)
        parts.append(cap)

    obj = join(parts, name)
    # Boulders are the worst offender for the balanced-on-a-spike problem, so
    # they get the deepest bury of anything in the set.
    ground(obj, bury=0.16)
    return obj


def build_cliff(seed=5):
    """A 26 m cliff slab. The basin is ringed with these, rotated and scaled."""
    s = stone()
    parts = []
    slab = box((14.0, 8.0, 26.0), material=s["rock"], name="cliff")
    # Subdivide so the deform has something to bite on.
    bpy.context.view_layer.objects.active = slab
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.subdivide(number_cuts=3)
    bpy.ops.object.mode_set(mode="OBJECT")
    deform(slab, 1.5, seed, axis_scale=(1.4, 1.4, 0.6))
    parts.append(slab)

    rnd = random.Random(seed)
    for i in range(5):
        ledge = box((rnd.uniform(3, 7), rnd.uniform(2, 5), rnd.uniform(2, 5)),
                    loc=(rnd.uniform(-5, 5), -3.5 + rnd.uniform(-1, 1), rnd.uniform(-9, 9)),
                    rot=(rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), rnd.uniform(0, 3)),
                    material=s["rockDark"], name="ledge")
        parts.append(ledge)
    for i in range(4):
        m = ico(rnd.uniform(1.4, 2.6), 1,
                loc=(rnd.uniform(-6, 6), -4.0, rnd.uniform(-11, 11)),
                material=s["moss"], name="moss")
        deform(m, 0.5, seed + i)
        parts.append(m)

    obj = join(parts, "jungle_cliff")
    ground(obj)
    return obj


# --------------------------------------------------------------------- plants

def build_tree(seed=1):
    """Broadleaf canopy tree, ~12 m. Trunk plus deformed canopy blobs."""
    f = flora()
    rnd = random.Random(seed)
    parts = []

    H = 7.5
    trunk = cone(r1=0.55, r2=0.3, h=H, verts=7, loc=(0, 0, H / 2), material=f["bark"], name="trunk")
    parts.append(trunk)
    parts.append(cone(r1=1.1, r2=0.55, h=1.2, verts=7, loc=(0, 0, 0.5), material=f["bark"], name="flare"))

    # Boughs angling up into the canopy.
    for i in range(3):
        a = i * 2.094 + rnd.random()
        parts.append(cyl(0.16, 3.0, 6,
                         loc=(math.cos(a) * 1.0, math.sin(a) * 1.0, H * 0.78),
                         rot=(math.cos(a) * 0.6, math.sin(a) * 0.6, 0),
                         material=f["bark"], name="bough"))

    # Canopy: overlapping blobs, two greens so it isn't a single flat mass.
    blobs = [
        (0.0, 0.0, H + 1.4, 3.1, f["leaf"]),
        (1.9, 0.9, H + 0.4, 2.2, f["leafDeep"]),
        (-1.7, 1.2, H + 0.7, 2.0, f["leafLight"]),
        (0.6, -2.0, H + 0.2, 2.1, f["leafDeep"]),
        (-0.9, -1.1, H + 2.4, 1.8, f["leafLight"]),
    ]
    for i, (x, y, z, r, material) in enumerate(blobs):
        b = ico(r, 1, loc=(x, y, z), material=material, name="canopy")
        b.scale = (1.0, 1.0, 0.68)
        bpy.context.view_layer.objects.active = b
        bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)
        deform(b, r * 0.22, seed * 13 + i)
        parts.append(b)

    obj = join(parts, "jungle_tree")
    ground(obj, bury=0.03)
    return obj


def build_palm(seed=2):
    """Curved palm, ~9 m. Segmented trunk with a crown of drooping fronds."""
    f = flora()
    rnd = random.Random(seed)
    parts = []

    segs = 8
    x = z = 0.0
    lean = 0.0
    for i in range(segs):
        t = i / (segs - 1)
        r = 0.36 * (1 - t * 0.45)
        h = 1.15
        lean += 0.055 + rnd.random() * 0.02
        x += math.sin(lean) * h * 0.5
        z += math.cos(lean) * h
        seg = cyl(r, h * 1.06, 7, loc=(x, 0, z - h / 2), rot=(0, lean, 0),
                  material=f["barkPale"] if i % 2 else f["bark"], name="palm_seg")
        parts.append(seg)

    crown = Vector((x + math.sin(lean) * 0.4, 0, z + 0.2))
    parts.append(ico(0.5, 1, loc=crown, material=f["bark"], name="crown"))

    # Fronds radiating from the crown, drooping outward.
    for i in range(9):
        a = i * (2 * math.pi / 9) + rnd.random() * 0.2
        fr = blade(length=3.4 + rnd.random() * 0.8, width=0.62, droop=0.75, segments=5,
                   material=f["leaf"] if i % 2 else f["leafDeep"], name="frond")
        fr.location = crown
        fr.rotation_euler = (0.35 + rnd.random() * 0.25, 0, a)
        bpy.context.view_layer.objects.active = fr
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=False)
        parts.append(fr)

    # Two hanging seed clusters for asymmetry.
    for i in range(2):
        parts.append(ico(0.34, 1, loc=(crown.x + (i - 0.5) * 0.6, (i - 0.5) * 0.5, crown.z - 0.55),
                         material=f["leafLight"], name="cluster"))

    obj = join(parts, "jungle_palm")
    ground(obj, bury=0.03)
    return obj


def build_fern(seed=3):
    """Ground fern, ~1.6 m. Scattered densely; no collider in game."""
    f = flora()
    rnd = random.Random(seed)
    parts = []
    parts.append(ico(0.22, 1, loc=(0, 0, 0.12), material=f["bark"], name="base"))
    for i in range(9):
        a = i * (2 * math.pi / 9) + rnd.random() * 0.3
        fr = blade(length=1.5 + rnd.random() * 0.5, width=0.32, droop=0.5, segments=4,
                   material=f["leaf"] if i % 3 else f["leafLight"], name="frond")
        fr.location = (0, 0, 0.25)
        # Positive X rotation lifts the blade up and out, so it rises from the
        # crown and droops at the tip. Negative flips the whole plant over —
        # it hangs like an inverted umbrella with its base cap on top.
        fr.rotation_euler = (0.78 + rnd.random() * 0.32, 0, a)
        bpy.context.view_layer.objects.active = fr
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=False)
        parts.append(fr)
    obj = join(parts, "jungle_fern")
    ground(obj, bury=0.10)
    return obj


def build_bush(seed=4):
    """Low leafy mass, ~2 m across. Fills the ground plane cheaply."""
    f = flora()
    rnd = random.Random(seed)
    parts = []
    for i in range(4):
        r = 0.55 + rnd.random() * 0.35
        b = ico(r, 1,
                loc=((rnd.random() - 0.5) * 1.1, (rnd.random() - 0.5) * 1.1, 0.35 + rnd.random() * 0.4),
                material=(f["leafDeep"], f["leaf"], f["leafLight"])[i % 3], name="bush")
        b.scale = (1.2, 1.2, 0.8)
        bpy.context.view_layer.objects.active = b
        bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)
        deform(b, r * 0.3, seed * 5 + i)
        parts.append(b)
    obj = join(parts, "jungle_bush")
    ground(obj, bury=0.18)
    return obj


# ----------------------------------------------------------------------- run

BUILDS = [
    (build_hab_disc, "jungle_hab_disc.glb"),
    (build_hab_pod, "jungle_hab_pod.glb"),
    (build_hab_dome, "jungle_hab_dome.glb"),
    (build_hab_block, "jungle_hab_block.glb"),
    (build_column, "jungle_column.glb"),
    (build_landing_pad, "jungle_landing_pad.glb"),
    (build_catwalk, "jungle_catwalk.glb"),
    (build_crate, "jungle_crate.glb"),
    (build_antenna, "jungle_antenna.glb"),
    (lambda: build_rock(1, 1.7, 0.85, True, "jungle_rock_a"), "jungle_rock_a.glb"),
    (lambda: build_rock(2, 2.6, 0.7, True, "jungle_rock_b"), "jungle_rock_b.glb"),
    (lambda: build_rock(3, 1.0, 1.0, False, "jungle_rock_c"), "jungle_rock_c.glb"),
    (build_cliff, "jungle_cliff.glb"),
    (build_tree, "jungle_tree.glb"),
    (build_palm, "jungle_palm.glb"),
    (build_fern, "jungle_fern.glb"),
    (build_bush, "jungle_bush.glb"),
]

total_tris = 0
for builder, filename in BUILDS:
    kit.reset()
    obj = builder()
    _, tris, _ = export(obj, filename, SUB)
    total_tris += tris

print(f"JUNGLE SET DONE — {len(BUILDS)} assets, {total_tris} tris total")
