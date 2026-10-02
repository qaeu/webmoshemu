/**
 * Every shader pass's material, with its uniforms and their initial values.
 *
 * @module
 */
import * as THREE from 'three';

import { params } from './config';
import { pass } from './gl';
import backgroundFrag from './shaders/background.frag?raw';
import videoFrag from './shaders/video.frag?raw';
import flowFrag from './shaders/flow.frag?raw';
import maskFrag from './shaders/mask.frag?raw';
import blocksFrag from './shaders/blocks.frag?raw';
import subFrag from './shaders/sub.frag?raw';
import dctRowsFrag from './shaders/dctRows.frag?raw';
import dctColsFrag from './shaders/dctCols.frag?raw';
import idctRowsFrag from './shaders/idctRows.frag?raw';
import reconstructFrag from './shaders/reconstruct.frag?raw';
import presentFrag from './shaders/present.frag?raw';

/** A sampler uniform; `null` until the decoder binds a target's texture. */
type Tex = THREE.Texture | null;

/** All pass materials, by name. See {@link createPasses}. */
export type Passes = ReturnType<typeof createPasses>;

/**
 * Create every pass material. Constant tuning uniforms are initialised from
 * {@link params}; textures and per-step values are set by the sources and the
 * decoder before each draw.
 */
export function createPasses() {
  return {
    /** Procedural source frame. */
    background: pass<{ uTime: number; uSize: THREE.Vector2 }>(backgroundFrag, {
      uTime: { value: 0 },
      uSize: { value: new THREE.Vector2() },
    }),
    /** Video source frame, cover-cropped to the internal size. */
    video: pass<{ uVideo: Tex; uSize: THREE.Vector2; uVideoSize: THREE.Vector2 }>(videoFrag, {
      uVideo: { value: null },
      uSize: { value: new THREE.Vector2() },
      uVideoSize: { value: new THREE.Vector2() },
    }),
    /** Background motion per macroblock (pyramidal Lucas–Kanade): `rg` px/step, `b` speed. */
    flow: pass<{ uCur: Tex; uPrev: Tex; uFlowEps: number }>(flowFrag, {
      uCur: { value: null },
      uPrev: { value: null },
      uFlowEps: { value: params.flowEps },
    }),
    /** Pointer zone strength per macroblock. */
    mask: pass<{
      uPointer: THREE.Vector2;
      uActive: number;
      uRadius: number;
      uTime: number;
      uNoiseScale: number;
      uNoiseSpeed: number;
    }>(maskFrag, {
      uPointer: { value: new THREE.Vector2() },
      uActive: { value: 0 },
      uRadius: { value: params.radius },
      uTime: { value: 0 },
      uNoiseScale: { value: params.noiseScale },
      uNoiseSpeed: { value: params.noiseSpeed },
    }),
    /** Macroblock state: `r` melt latch, `b` heat, `a` seed. */
    blocks: pass<{
      uState: Tex;
      uSub: Tex;
      uFlow: Tex;
      uMask: Tex;
      uVelocity: THREE.Vector2;
      uSpeedRef: number;
      uHealSpeed: THREE.Vector2;
      uHealRate: number;
      uCut: number;
      uMeltMv: number;
      uMeltFrac: number;
    }>(blocksFrag, {
      uState: { value: null },
      uSub: { value: null },
      uFlow: { value: null },
      uMask: { value: null },
      uVelocity: { value: new THREE.Vector2() },
      uSpeedRef: { value: params.speedRef },
      uHealSpeed: { value: params.healSpeed },
      uHealRate: { value: params.healRate },
      uCut: { value: 0 },
      uMeltMv: { value: params.meltMv },
      uMeltFrac: { value: params.meltFrac },
    }),
    /** Sub-block vectors (`rg`) and partition code (`b`). */
    sub: pass<{
      uSub: Tex;
      uState: Tex;
      uMask: Tex;
      uPointer: THREE.Vector2;
      uVelocity: THREE.Vector2;
      uRadius: number;
      uTime: number;
      uSwirl: number;
      uBreath: number;
      uInflow: number;
      uMvRelax: number;
      uSpeedRef: number;
      uSubShear: number;
      uSubTwist: number;
      uLamLo: number;
      uLamHi: number;
      uBloomFrac: number;
      uBloomRelax: number;
    }>(subFrag, {
      uSub: { value: null },
      uState: { value: null },
      uMask: { value: null },
      uPointer: { value: new THREE.Vector2() },
      uVelocity: { value: new THREE.Vector2() },
      uRadius: { value: params.radius },
      uTime: { value: 0 },
      uSwirl: { value: params.swirl },
      uBreath: { value: params.breath },
      uInflow: { value: params.inflow },
      uMvRelax: { value: params.mvRelax },
      uSpeedRef: { value: params.speedRef },
      uSubShear: { value: params.subShear },
      uSubTwist: { value: params.subTwist },
      uLamLo: { value: params.lamLo },
      uLamHi: { value: params.lamHi },
      uBloomFrac: { value: params.bloomFrac },
      uBloomRelax: { value: params.bloomRelax },
    }),
    /** Forward DCT rows of the residual. */
    dctRows: pass<{ uCur: Tex; uPrev: Tex; uState: Tex; uSub: Tex }>(dctRowsFrag, {
      uCur: { value: null },
      uPrev: { value: null },
      uState: { value: null },
      uSub: { value: null },
    }),
    /** Forward DCT columns, quantised. */
    dctCols: pass<{ uTmp: Tex; uState: Tex; uSub: Tex; uQstep: number }>(dctColsFrag, {
      uTmp: { value: null },
      uState: { value: null },
      uSub: { value: null },
      uQstep: { value: params.qstep },
    }),
    /** First half of the inverse DCT; reconstruct does the columns. */
    idctRows: pass<{ uCoef: Tex; uState: Tex; uSub: Tex }>(idctRowsFrag, {
      uCoef: { value: null },
      uState: { value: null },
      uSub: { value: null },
    }),
    /** Motion compensation plus residual against the previous decoded frame. */
    reconstruct: pass<{
      uRef: Tex;
      uCur: Tex;
      uTmp: Tex;
      uState: Tex;
      uSub: Tex;
      uFlow: Tex;
      uResidualGain: number;
      uPhase: THREE.Vector4;
      uChromaLag: number;
      uDcDrift: number;
      uResBloomFrac: number;
      uResBloom: number;
      uSmear: number;
      uSmearBand: number;
      uHealSpeed: THREE.Vector2;
      uHealRate: number;
    }>(reconstructFrag, {
      uRef: { value: null },
      uCur: { value: null },
      uTmp: { value: null },
      uState: { value: null },
      uSub: { value: null },
      uFlow: { value: null },
      uResidualGain: { value: 1 },
      uPhase: { value: new THREE.Vector4() },
      uChromaLag: { value: params.chromaLag },
      uDcDrift: { value: params.dcDrift },
      uResBloomFrac: { value: params.resBloomFrac },
      uResBloom: { value: params.resBloom },
      uSmear: { value: params.smear },
      uSmearBand: { value: params.smearBand },
      uHealSpeed: { value: params.healSpeed },
      uHealRate: { value: params.healRate },
    }),
    /** Draws the decoded frame (or the clean source) and the debug overlay to the screen. */
    present: pass<{
      uRef: Tex;
      uCur: Tex;
      uState: Tex;
      uSub: Tex;
      uFlow: Tex;
      uMask: Tex;
      uDebug: boolean;
    }>(presentFrag, {
      uRef: { value: null },
      uCur: { value: null },
      uState: { value: null },
      uSub: { value: null },
      uFlow: { value: null },
      uMask: { value: null },
      uDebug: { value: false },
    }),
  };
}
