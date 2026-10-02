/**
 * WebGL plumbing: the renderer and fullscreen quad, shader pass materials and
 * render targets.
 *
 * @module
 */
import * as THREE from 'three';

import common from './shaders/common.glsl?raw';
import quadVert from './shaders/quad.vert?raw';

/**
 * A double buffer. After each write the array is swapped with `reverse()`, so
 * index 0 is always the latest.
 */
export type PingPong<T> = [T, T];

/**
 * A pass's uniforms, typed by name so a misspelt uniform is a type error.
 *
 * @typeParam T - Map of uniform name to value type.
 */
export type Uniforms<T> = { [K in keyof T]: THREE.IUniform<T[K]> };
/** A fullscreen shader pass whose {@link Uniforms} are typed by `T`. */
export type Pass<T> = THREE.ShaderMaterial & { uniforms: Uniforms<T> };

/** The renderer and the single fullscreen quad every pass is drawn with. */
export interface Gl {
  renderer: THREE.WebGLRenderer;
  /** The renderer's canvas, already in the DOM. */
  canvas: HTMLCanvasElement;
  /**
   * Render the fullscreen quad with `material`.
   *
   * @param rt - The target to write, or `null` for the screen.
   */
  draw(material: THREE.Material, rt: THREE.WebGLRenderTarget | null): void;
}

// ── Renderer ─────────────────────────────────────────────────────────────────
/**
 * Create the renderer and append its canvas to `container`. The canvas is
 * unsized; the caller sets its size.
 */
export function createGl(container: HTMLElement): Gl {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.autoClear = false;
  container.appendChild(renderer.domElement);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  scene.add(quad);

  return {
    renderer,
    canvas: renderer.domElement,
    draw(material, rt) {
      quad.material = material;
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
    },
  };
}

/** The 8×8 DCT-II basis, `basis[k * 8 + x]`, injected into every pass as `uBasis`. */
const basis = Array.from({ length: 64 }, (_, i) => {
  const k = Math.floor(i / 8);
  const x = i % 8;
  return (k === 0 ? Math.SQRT1_2 : 1) * 0.5 * Math.cos(((2 * x + 1) * k * Math.PI) / 16);
});

/**
 * Build a fullscreen pass material. `common.glsl` is prepended to the fragment
 * shader and `uBasis` is added to its uniforms.
 *
 * @param fragmentShader - GLSL3 fragment source, without `#version`.
 * @param uniforms - Initial values of the pass's own uniforms.
 */
export function pass<T>(fragmentShader: string, uniforms: Uniforms<T>): Pass<T> {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: quadVert,
    fragmentShader: `${common}\n${fragmentShader}`,
    uniforms: { uBasis: { value: basis }, ...uniforms },
    depthTest: false,
    depthWrite: false,
  }) as Pass<T>;
}

// ── Render targets (RGBA16F: renderable on iOS, unlike 32-bit float) ────────
/**
 * Allocate an RGBA16F render target without a depth buffer.
 *
 * @param filter - Magnification filter, and minification filter unless `mipmaps`.
 * @param mipmaps - Generate a mip chain after each write (trilinear minification).
 */
export function target(
  w: number,
  h: number,
  filter: THREE.MagnificationTextureFilter = THREE.NearestFilter,
  mipmaps = false,
): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : filter,
    magFilter: filter,
    generateMipmaps: mipmaps,
    depthBuffer: false,
  });
}
