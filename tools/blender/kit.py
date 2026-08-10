"""
Procedural asset kit for Obsidian Protocol.

Everything the game ships is built from code rather than sculpted by hand, so a
style change is an edit here rather than a re-model. The house style is:

  * hard-surface white ceramic panels with charcoal glazing bands
  * violet emissive accents (matches PALETTE in src/config.js)
  * FLAT shading everywhere, no textures, no smooth normals

Flat shading is deliberate. The characters are the only textured, smooth-shaded
things in the frame, so keeping the world faceted and untextured means enemies
never visually merge into the set dressing.
"""

import bpy
import bmesh
import math
import os
import random
from mathutils import Vector

OUT = r"C:\Sci_Fi_Game\public\models"

# ------------------------------------------------------------------- palette
# sRGB hex from src/config.js, converted to linear on use.
HEX = {
    "white": 0xF4F5FA,
    "offWhite": 0xDDE2EF,
    "concrete": 0xC3C9DA,
    "panel": 0xE6E9F2,
    "black": 0x0D0D13,
    "charcoal": 0x1C1D27,
    "steel": 0x555B6E,
    "purple": 0x8B5CF6,
    "purpleBright": 0xC4A6FF,
    "amber": 0xFF9A3C,
    "danger": 0xFF4B6B,
    "mint": 0x6EFFC4,
    # Jungle. These read considerably darker in-engine than they look on a
    # swatch: the level's key light is high and the foliage is flat-shaded, so
    # most leaf faces are lit at a glancing angle. Everything here is pitched
    # brighter than the concept art to compensate — sampling the art directly
    # gave near-black trunks and boulders.
    "leaf": 0x5E8C46,
    "leafDeep": 0x3D6630,
    "leafLight": 0x86B45A,
    "bark": 0x6B5C49,
    "barkPale": 0x8A7A64,
    "rock": 0x8D9299,
    "rockDark": 0x6A6E78,
    "moss": 0x6B8A4C,
    "water": 0xBFD8E6,
    "rust": 0x8A6A52,
}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgba(hex_value, alpha=1.0):
    r = ((hex_value >> 16) & 255) / 255.0
    g = ((hex_value >> 8) & 255) / 255.0
    b = (hex_value & 255) / 255.0
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), alpha)


_MATS = {}


def mat(name, color, rough=0.65, metal=0.0, emit=None, emit_strength=2.5, alpha=1.0):
    """Cached Principled material. `color` is an sRGB hex int."""
    key = (name, color, rough, metal, emit, emit_strength, alpha)
    if key in _MATS and _MATS[key].name in bpy.data.materials:
        return _MATS[key]

    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = rgba(color)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if "Alpha" in bsdf.inputs:
        bsdf.inputs["Alpha"].default_value = alpha
    if alpha < 1.0:
        m.blend_method = "BLEND" if hasattr(m, "blend_method") else m.blend_method
    if emit is not None:
        bsdf.inputs["Emission Color"].default_value = rgba(emit)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    _MATS[key] = m
    return m


# ------------------------------------------------------------------- scene


def reset():
    """Wipe the scene and every orphaned datablock so builds never accumulate."""
    if bpy.context.mode != "OBJECT" and bpy.context.object:
        bpy.ops.object.mode_set(mode="OBJECT")
    if bpy.context.scene.objects:
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.curves, bpy.data.armatures):
        for item in list(block):
            if item.users == 0:
                block.remove(item)
    _MATS.clear()
    for m in list(bpy.data.materials):
        if m.users == 0:
            bpy.data.materials.remove(m)


def _finish(obj, material, flat=True):
    if material is not None:
        obj.data.materials.append(material)
    if flat:
        obj.data.polygons.foreach_set("use_smooth", [False] * len(obj.data.polygons))
        obj.data.update()
    return obj


# ------------------------------------------------------------------ shapes


def box(size=(1, 1, 1), loc=(0, 0, 0), rot=(0, 0, 0), material=None, name="box"):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(obj, material)


def cyl(r=1, h=1, verts=16, loc=(0, 0, 0), rot=(0, 0, 0), material=None, name="cyl", cap="NGON"):
    bpy.ops.mesh.primitive_cylinder_add(
        radius=r, depth=h, vertices=verts, location=loc, rotation=rot, end_fill_type=cap
    )
    obj = bpy.context.object
    obj.name = name
    return _finish(obj, material)


def cone(r1=1, r2=0, h=1, verts=12, loc=(0, 0, 0), rot=(0, 0, 0), material=None, name="cone"):
    bpy.ops.mesh.primitive_cone_add(
        radius1=r1, radius2=r2, depth=h, vertices=verts, location=loc, rotation=rot
    )
    obj = bpy.context.object
    obj.name = name
    return _finish(obj, material)


def sphere(r=1, segs=16, rings=8, loc=(0, 0, 0), material=None, name="sphere"):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=segs, ring_count=rings, location=loc)
    obj = bpy.context.object
    obj.name = name
    return _finish(obj, material)


def ico(r=1, subdiv=2, loc=(0, 0, 0), material=None, name="ico"):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=r, subdivisions=subdiv, location=loc)
    obj = bpy.context.object
    obj.name = name
    return _finish(obj, material)


def torus(major=1, minor=0.1, mseg=16, minseg=8, loc=(0, 0, 0), rot=(0, 0, 0), material=None, name="torus"):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major, minor_radius=minor, major_segments=mseg,
        minor_segments=minseg, location=loc, rotation=rot,
    )
    obj = bpy.context.object
    obj.name = name
    return _finish(obj, material)


def plane(size=(1, 1), loc=(0, 0, 0), rot=(0, 0, 0), material=None, name="plane"):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (size[0], size[1], 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(obj, material)


# --------------------------------------------------------------- operations


def bevel(obj, amount=0.02, segments=1, angle=50):
    m = obj.modifiers.new("bevel", "BEVEL")
    m.width = amount
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(angle)
    m.harden_normals = False
    _apply(obj, m)
    return obj


def solidify(obj, thickness=0.05):
    m = obj.modifiers.new("solid", "SOLIDIFY")
    m.thickness = thickness
    _apply(obj, m)
    return obj


def _apply(obj, modifier):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def deform(obj, strength=0.08, seed=0, axis_scale=(1, 1, 1)):
    """Random per-vertex push along the normal — turns primitives into rock."""
    rnd = random.Random(seed)
    me = obj.data
    for v in me.vertices:
        n = v.normal
        d = (rnd.random() - 0.5) * 2 * strength
        v.co.x += n.x * d * axis_scale[0]
        v.co.y += n.y * d * axis_scale[1]
        v.co.z += n.z * d * axis_scale[2]
    me.update()
    return obj


def join(objs, name):
    objs = [o for o in objs if o is not None]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    return obj


def dup(obj, loc=(0, 0, 0), rot=(0, 0, 0), scale=None, name=None):
    new = obj.copy()
    new.data = obj.data.copy()
    bpy.context.collection.objects.link(new)
    new.location = Vector(obj.location) + Vector(loc)
    new.rotation_euler = (
        obj.rotation_euler[0] + rot[0],
        obj.rotation_euler[1] + rot[1],
        obj.rotation_euler[2] + rot[2],
    )
    if scale:
        new.scale = scale
    if name:
        new.name = name
    return new


def ground(obj, z=0.0, bury=0.0):
    """
    Drop the object so it sits at z, centred on X/Y.

    `bury` is the fraction of vertices allowed to go *below* z. Resting a mesh
    on its single lowest vertex is what makes deformed props look like they're
    hovering: after deform() a boulder's minimum is one random spike, so the
    body ends up floating above the floor on a needle. Burying the bottom
    10-15% instead puts real surface area in contact with the ground.
    """
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for corner in obj.bound_box:
        for i in range(3):
            lo[i] = min(lo[i], corner[i])
            hi[i] = max(hi[i], corner[i])
    cx = (lo.x + hi.x) / 2
    cy = (lo.y + hi.y) / 2

    floor = lo.z
    if bury > 0:
        heights = sorted(v.co.z for v in obj.data.vertices)
        floor = heights[min(len(heights) - 1, int(bury * len(heights)))]

    for v in obj.data.vertices:
        v.co.x -= cx
        v.co.y -= cy
        v.co.z -= floor - z
    obj.data.update()
    return obj


def centre(obj):
    """Centre the object on its bounding box in all three axes."""
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for corner in obj.bound_box:
        for i in range(3):
            lo[i] = min(lo[i], corner[i])
            hi[i] = max(hi[i], corner[i])
    mid = (lo + hi) / 2
    for v in obj.data.vertices:
        v.co -= mid
    obj.data.update()
    return obj


def dims(obj):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    mw = obj.matrix_world
    for corner in obj.bound_box:
        p = mw @ Vector(corner)
        for i in range(3):
            lo[i] = min(lo[i], p[i])
            hi[i] = max(hi[i], p[i])
    return (hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)


# ------------------------------------------------------------------ export


def export(obj, filename, subdir=""):
    """Export a single object as GLB. Returns (path, tris, kb)."""
    folder = os.path.join(OUT, subdir) if subdir else OUT
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, filename)

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_normals=True,
        export_texcoords=False,
        export_tangents=False,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )

    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    kb = os.path.getsize(path) / 1024
    print(f"  {filename:<28} {tris:>6} tris  {kb:>7.1f} KB  {tuple(round(d,2) for d in dims(obj))}")
    return path, tris, kb
