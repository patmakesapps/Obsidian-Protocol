import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/**
 * GLB loading + caching.
 *
 * Meshy exports (and most rigged GLB) come through `loadModel`. Because the
 * same source model gets instanced across many enemies, we cache the parsed
 * gltf once and hand out skeleton-aware clones.
 */
export class Assets {
  constructor() {
    this.loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    this.loader.setDRACOLoader(draco);
    this.cache = new Map();

    /**
     * Optional hook run once per loaded GLB, before it's cached.
     *
     * The active visual style uses this to swap materials. It has to happen
     * here rather than on the live scene: props are instanced straight from
     * the cached gltf's materials, and characters are skeleton-cloned from it
     * on every spawn, so the cached original is the only place a change
     * reaches all of them.
     *
     * @type {((root: import('three').Object3D) => void)|null}
     */
    this.onModelLoaded = null;
  }

  /** Resolves to the raw gltf, or null if the file is missing (non-fatal). */
  async loadModel(url) {
    if (this.cache.has(url)) return this.cache.get(url);

    const promise = (async () => {
      // A dev server answers missing files with the SPA index.html, which the
      // GLTF parser reports as a JSON syntax error. Probe first so an absent
      // model logs "not found" instead of a misleading parse failure.
      if (!(await this._exists(url))) {
        console.info(`[Assets] no model at "${url}" — using placeholder.`);
        return null;
      }
      try {
        const gltf = await this.loader.loadAsync(url);
        gltf.scene.traverse((node) => {
          if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;
            node.frustumCulled = false; // skinned meshes cull badly on their bind pose
          }
        });
        this.onModelLoaded?.(gltf.scene);
        return gltf;
      } catch (err) {
        console.warn(`[Assets] could not load "${url}" — falling back to placeholder.`, err);
        return null;
      }
    })();

    this.cache.set(url, promise);
    return promise;
  }

  /** True only if the URL exists and actually looks like a binary model. */
  async _exists(url) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (!res.ok) return false;
      const type = res.headers.get('content-type') ?? '';
      return !type.includes('text/html');
    } catch {
      return false;
    }
  }

  /**
   * @returns {{scene: import('three').Object3D, animations: Array}|null}
   */
  async instantiate(url) {
    const gltf = await this.loadModel(url);
    if (!gltf) return null;
    return {
      scene: cloneSkinned(gltf.scene),
      animations: gltf.animations ?? [],
    };
  }
}
