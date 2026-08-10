import * as THREE from 'three';

let softParticle = null;

/**
 * Soft round particle sprite.
 *
 * An untextured THREE.Points renders each particle as a hard square, which is
 * exactly why blood and sparks read as blocky pixels. A radial alpha falloff
 * turns them into soft blobs for the cost of one 64px texture, shared by every
 * particle system in the game.
 */
export function getSoftParticleTexture() {
  if (softParticle) return softParticle;

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0.0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(0.7, 'rgba(255,255,255,0.25)');
  gradient.addColorStop(1.0, 'rgba(255,255,255,0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  softParticle = new THREE.CanvasTexture(canvas);
  softParticle.colorSpace = THREE.SRGBColorSpace;
  return softParticle;
}
