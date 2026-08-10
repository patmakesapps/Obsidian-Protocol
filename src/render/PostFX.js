import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { TexturePass } from 'three/addons/postprocessing/TexturePass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Comic post chain: ink outlines, depth of field, posterisation, bloom.
 *
 * Two structural decisions worth knowing before editing this:
 *
 * 1. The scene is rendered into our OWN target rather than by a RenderPass.
 *    The outline and DOF passes need the depth buffer, and EffectComposer
 *    ping-pongs between two targets that share a depth attachment — so by the
 *    time a later pass runs, the depth it wants has been trampled. Owning the
 *    scene target keeps depth valid for the whole chain.
 *
 * 2. Everything except SMAA runs in linear HDR, before tone mapping.
 *    `SMAAPass` in three r185 operates in linear-sRGB and documents that it
 *    must precede `OutputPass`, so `OutputPass` goes last and posterisation
 *    happens before it. That's fine — tone mapping is monotonic, so quantised
 *    bands stay quantised, they just land on different values.
 */

const ComicShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uTexel: { value: new THREE.Vector2() },
    uNear: { value: 0.1 },
    uFar: { value: 1000 },

    uInkColor: { value: new THREE.Color(0x0b0b14) },
    uInkThickness: { value: 1.3 },
    uInkStrength: { value: 1.0 },
    uDepthEdge: { value: 0.02 },
    uCreaseEdge: { value: 0.006 },
    uInkFadeStart: { value: 90 },
    uInkFadeEnd: { value: 340 },

    uPosterize: { value: 7 },
    uSaturation: { value: 1.06 },
    uVignette: { value: 0.26 },

    uFocus: { value: 26 },
    uFocusRange: { value: 130 },
    uMaxBlur: { value: 2.4 },
    uNearClip: { value: 1.6 },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 uTexel;
    uniform float uNear;
    uniform float uFar;

    uniform vec3 uInkColor;
    uniform float uInkThickness;
    uniform float uInkStrength;
    uniform float uDepthEdge;
    uniform float uCreaseEdge;
    uniform float uInkFadeStart;
    uniform float uInkFadeEnd;

    uniform float uPosterize;
    uniform float uSaturation;
    uniform float uVignette;

    uniform float uFocus;
    uniform float uFocusRange;
    uniform float uMaxBlur;
    uniform float uNearClip;

    varying vec2 vUv;

    // Depth buffer value -> distance from the camera in metres.
    float viewDistance(float d) {
      return (uNear * uFar) / (uFar - d * (uFar - uNear));
    }

    float sampleDistance(vec2 uv) {
      return viewDistance(texture2D(tDepth, uv).x);
    }

    void main() {
      vec2 offset = uTexel * uInkThickness;

      // Nothing wrote depth here, so it's the sky dome. It gets outlined
      // against (silhouettes still work) but is otherwise left alone.
      float rawDepth = texture2D(tDepth, vUv).x;
      bool isSky = rawDepth > 0.9999;

      float zC = sampleDistance(vUv);
      float zR = sampleDistance(vUv + vec2(offset.x, 0.0));
      float zL = sampleDistance(vUv - vec2(offset.x, 0.0));
      float zU = sampleDistance(vUv + vec2(0.0, offset.y));
      float zD = sampleDistance(vUv - vec2(0.0, offset.y));

      // --- Depth of field -------------------------------------------------
      float coc = 0.0;
      if (zC > uNearClip) {
        coc = clamp(abs(zC - uFocus) / uFocusRange, 0.0, 1.0);
      }
      coc *= uMaxBlur;

      vec3 color = texture2D(tDiffuse, vUv).rgb;
      if (coc > 0.2) {
        vec2 r = uTexel * coc;
        vec3 sum = color;
        sum += texture2D(tDiffuse, vUv + vec2( 1.0,  0.0) * r).rgb;
        sum += texture2D(tDiffuse, vUv + vec2(-1.0,  0.0) * r).rgb;
        sum += texture2D(tDiffuse, vUv + vec2( 0.0,  1.0) * r).rgb;
        sum += texture2D(tDiffuse, vUv + vec2( 0.0, -1.0) * r).rgb;
        sum += texture2D(tDiffuse, vUv + vec2( 0.7,  0.7) * r).rgb;
        sum += texture2D(tDiffuse, vUv + vec2(-0.7,  0.7) * r).rgb;
        sum += texture2D(tDiffuse, vUv + vec2( 0.7, -0.7) * r).rgb;
        sum += texture2D(tDiffuse, vUv + vec2(-0.7, -0.7) * r).rgb;
        color = sum / 9.0;
      }

      // --- Posterise ------------------------------------------------------
      // Quantise LUMINANCE and rescale the colour to match, rather than
      // quantising R, G and B independently. Per-channel banding makes the
      // three channels step at slightly different places, which paints rainbow
      // contours across anything near-neutral — and this game's architecture is
      // almost entirely near-white. Banding brightness alone keeps hue intact
      // and gives the flat plates of one colour that cel shading is made of.
      //
      // Quantisation happens in an approximate perceptual space: on raw linear
      // values nearly every band lands in the highlights, leaving the midtones
      // — where the image actually lives — smooth.
      // The sky is exempt. It's a smooth wide-field gradient, so quantising it
      // draws a hard contour arc across the whole frame and chops the starfield
      // into blocks — both read as bugs rather than style.
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      if (!isSky && uPosterize > 0.5 && luma > 1e-4) {
        float g = pow(luma, 0.4545);
        float stepped = floor(g * uPosterize + 0.5) / uPosterize;
        color *= pow(stepped, 2.2) / luma;
        luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      }

      color = mix(vec3(luma), color, uSaturation);

      // --- Ink ------------------------------------------------------------
      // Silhouettes: a large jump in distance, measured relative to how far
      // away we are so a 1 m step reads the same at 5 m and at 200 m.
      float step1 = max(max(abs(zC - zR), abs(zC - zL)), max(abs(zC - zU), abs(zC - zD)));
      float silhouette = step1 / max(zC, 1.0);

      // Creases: the second derivative of depth. Across a flat face this is
      // zero, and it spikes exactly where two faces meet — which is why it
      // works so well on untextured flat-shaded geometry.
      float crease = (abs(zL + zR - 2.0 * zC) + abs(zU + zD - 2.0 * zC)) / max(zC, 1.0);

      float ink = max(
        smoothstep(uDepthEdge, uDepthEdge * 2.0, silhouette),
        smoothstep(uCreaseEdge, uCreaseEdge * 2.0, crease)
      );

      // Fade on the NEAREST sample, not the centre one. Using the centre kills
      // the outline on the sky side of a silhouette, which is the single most
      // important line in the frame.
      float nearest = min(min(zC, zR), min(min(zL, zU), zD));
      ink *= 1.0 - smoothstep(uInkFadeStart, uInkFadeEnd, nearest);
      // Out-of-focus things get softer ink, so lines don't stay razor sharp
      // over blurred geometry.
      ink *= uInkStrength / (1.0 + coc * 0.6);

      color = mix(color, uInkColor, clamp(ink, 0.0, 1.0));

      // --- Vignette -------------------------------------------------------
      float v = length(vUv - 0.5) * 1.4142;
      color *= 1.0 - uVignette * v * v;

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

export class PostFX {
  constructor(renderer, style) {
    this.renderer = renderer;
    this.style = style;

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());

    this.sceneTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      depthBuffer: true,
    });
    this.sceneTarget.texture.name = 'PostFX.scene';
    this.sceneTarget.depthTexture = new THREE.DepthTexture(size.x, size.y);
    this.sceneTarget.depthTexture.type = THREE.UnsignedIntType;

    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.addPass(new TexturePass(this.sceneTarget.texture));

    const post = style.post;

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      post.bloom.strength,
      post.bloom.radius,
      post.bloom.threshold,
    );
    this.composer.addPass(this.bloomPass);

    this.comicPass = new ShaderPass(ComicShader);
    this.comicPass.material.depthTest = false;
    this.comicPass.material.depthWrite = false;
    this._applyStyleUniforms(post);
    this.comicPass.uniforms.tDepth.value = this.sceneTarget.depthTexture;
    this.composer.addPass(this.comicPass);

    // SMAA is not optional here. Rendering through a composer disables the
    // renderer's MSAA, and the ink lines this chain generates are pure
    // high-contrast edges — the most aliasing-prone thing you can draw.
    this.composer.addPass(new SMAAPass());
    this.composer.addPass(new OutputPass());

    this._size = size.clone();
    this._updateTexel();

    // renderer.info reflects only the most recent draw, which once a composer
    // is in play is a full-screen quad. Snapshotting right after the scene
    // render keeps the debug panel reporting the scene's real cost.
    this.sceneStats = { calls: 0, triangles: 0 };
  }

  _applyStyleUniforms(post) {
    const u = this.comicPass.uniforms;
    u.uInkColor.value.set(post.ink.color);
    u.uInkThickness.value = post.ink.thickness;
    u.uInkStrength.value = post.ink.strength;
    u.uDepthEdge.value = post.ink.depthEdge;
    u.uCreaseEdge.value = post.ink.creaseEdge;
    u.uInkFadeStart.value = post.ink.fadeStart;
    u.uInkFadeEnd.value = post.ink.fadeEnd;
    u.uPosterize.value = post.posterize;
    u.uSaturation.value = post.saturation;
    u.uVignette.value = post.vignette;
    u.uFocus.value = post.dof.focus;
    u.uFocusRange.value = post.dof.range;
    u.uMaxBlur.value = post.dof.maxBlur;
    u.uNearClip.value = post.dof.nearClip;
  }

  _updateTexel() {
    this.comicPass.uniforms.uTexel.value.set(1 / this._size.x, 1 / this._size.y);
  }

  setSize(width, height) {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.sceneTarget.setSize(size.x, size.y);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
    this.bloomPass.setSize(size.x, size.y);
    this._size.copy(size);
    this._updateTexel();
  }

  render(scene, camera) {
    const u = this.comicPass.uniforms;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;

    this.renderer.setRenderTarget(this.sceneTarget);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);

    this.sceneStats.calls = this.renderer.info.render.calls;
    this.sceneStats.triangles = this.renderer.info.render.triangles;

    this.composer.render();
  }

  dispose() {
    this.sceneTarget.dispose();
    this.composer.dispose?.();
  }
}
