import { CONFIG } from '../config.js';

/**
 * Visual style presets.
 *
 * A style is two halves that have to agree with each other:
 *
 *   `toon`  — how surfaces are *shaded*. Swaps standard PBR materials for
 *             banded toon ones at load time.
 *   `post`  — how the finished frame is *treated*. Ink outlines, depth of
 *             field, posterisation, bloom, vignette.
 *
 * Shading alone looks like a lighting bug; grading alone leaves the detailed
 * characters sitting on top of the flat world instead of in it. Together they
 * put both through the same reduction, which is what actually unifies them.
 *
 * Lives here rather than in config.js for the same reason SKY_PRESETS lives in
 * Sky.js: it's data the renderer owns, and it's useless without it.
 */
export const STYLES = {
  clean: {
    id: 'clean',
    name: 'CLEAN',
    toon: null,
    post: null,
  },

  comic: {
    id: 'comic',
    name: 'COMIC',

    // Four bands keeps enough shading information for the characters to still
    // read as three-dimensional. Two is the hard XIII look — much flatter, and
    // it loses the Meshy models' form entirely.
    toon: { bands: 4 },

    post: {
      ink: {
        color: 0x0b0b14,
        thickness: 1.35, // in pixels, at the drawing-buffer resolution
        strength: 1.0,
        // Relative depth jump that counts as a silhouette.
        depthEdge: 0.02,
        // Second-derivative threshold that counts as a crease. Flat-shaded
        // geometry is planar across a face, so this is near zero everywhere
        // except where two faces actually meet.
        creaseEdge: 0.006,
        // Lines thin out with distance; without this the far treeline packs
        // into a solid black mass.
        fadeStart: 90,
        fadeEnd: 340,
      },
      posterize: 7,
      saturation: 1.06,
      vignette: 0.26,
      // The threshold is high because bloom runs on the linear HDR frame,
      // before tone mapping. A white wall under a 3.3-intensity sun is already
      // well past 1.0 there, so anything near the usual 0.7-0.9 blooms the
      // entire arcology into a white smear. Above 2 it catches only genuine
      // emissives — the violet trim, amber lamps and pickup glows.
      bloom: { strength: 0.35, radius: 0.45, threshold: 2.1 },
      // Deliberately gentle — enough to soften the far cliffs and settle the
      // frame, not a shallow cinematic rack focus.
      dof: {
        focus: 26,
        range: 130,
        maxBlur: 2.4,
        // Anything nearer than this stays sharp, which is what keeps the
        // first-person weapon crisp while the world behind it softens.
        nearClip: 1.6,
      },
    },
  },
};

/**
 * Resolves the active style: `?style=clean` in the URL wins, then config.
 * The query string exists so the look can be A/B'd against the plain renderer
 * without an edit-and-reload cycle.
 */
export function resolveStyle() {
  let requested = null;
  if (typeof window !== 'undefined') {
    requested = new URLSearchParams(window.location.search).get('style');
  }
  const id = requested ?? CONFIG.render.style;
  if (!STYLES[id]) {
    console.warn(`[styles] unknown style "${id}" — falling back to "clean".`);
    return STYLES.clean;
  }
  return STYLES[id];
}
