import './style.css';
import * as THREE from 'three';

const app = document.querySelector('#app');

app.innerHTML = `
  <div class="hud">
    <h1>WebMoshemu</h1>
    <p>Move your cursor to trigger local datamosh artifacts.</p>
  </div>
`;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
app.appendChild(renderer.domElement);

const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const sourceCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const fsScene = new THREE.Scene();
const sourceScene = new THREE.Scene();

const mouse = new THREE.Vector2(0.5, 0.5);
const resolution = new THREE.Vector2(window.innerWidth, window.innerHeight);

const sourceMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: `
    varying vec2 vUv;
    uniform float uTime;

    void main() {
      vec2 uv = vUv;
      vec2 p = uv * 2.0 - 1.0;
      float a = atan(p.y, p.x);
      float r = length(p);

      float wave = sin(a * 6.0 + uTime * 1.5) * 0.5 + 0.5;
      float glow = smoothstep(0.82, 0.2, r);

      vec3 col = mix(
        vec3(0.06, 0.08, 0.16),
        vec3(0.22, 0.78, 1.0),
        wave * glow
      );
      col += 0.08 * sin(vec3(0.0, 2.0, 4.0) + uTime + uv.xyx * 8.0);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});

sourceScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sourceMaterial));

const sourceRT = new THREE.WebGLRenderTarget(1, 1, {
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  format: THREE.RGBAFormat,
  type: THREE.UnsignedByteType,
});
const feedbackA = sourceRT.clone();
const feedbackB = sourceRT.clone();

let readRT = feedbackA;
let writeRT = feedbackB;

const processMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uSource: { value: sourceRT.texture },
    uPrev: { value: readRT.texture },
    uResolution: { value: resolution.clone() },
    uTime: { value: 0 },
    uMouse: { value: mouse },
    uRadius: { value: 0.17 },
    uFeather: { value: 0.07 },
    uPersistence: { value: 0.92 },
    uBlockSize: { value: 24.0 },
    uMoshStrength: { value: 0.03 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: `
    varying vec2 vUv;
    uniform sampler2D uSource;
    uniform sampler2D uPrev;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform vec2 uMouse;
    uniform float uRadius;
    uniform float uFeather;
    uniform float uPersistence;
    uniform float uBlockSize;
    uniform float uMoshStrength;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    vec2 blockVector(vec2 uv) {
      vec2 grid = floor(uv * uResolution / uBlockSize);
      float n1 = hash(grid);
      float n2 = hash(grid + 13.7);
      vec2 dir = vec2(n1 - 0.5, n2 - 0.5);

      float ang = sin(uTime * 0.7 + grid.x * 0.13 + grid.y * 0.19) * 3.14159;
      mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
      dir = normalize(rot * dir + 1e-5);
      return dir * uMoshStrength;
    }

    vec3 quantize(vec3 c, float levels) {
      return floor(c * levels) / levels;
    }

    void main() {
      vec2 uv = vUv;
      vec3 src = texture2D(uSource, uv).rgb;

      float d = distance(uv, uMouse);
      float mask = smoothstep(uRadius + uFeather, uRadius - uFeather, d);

      vec2 mv = blockVector(uv);
      vec2 moshedUv = clamp(uv - mv, 0.0, 1.0);

      vec3 prev = texture2D(uPrev, moshedUv).rgb;
      float ch = 1.5 / uResolution.x;
      vec3 prevChroma = vec3(
        texture2D(uPrev, moshedUv + vec2(ch, 0.0)).r,
        texture2D(uPrev, moshedUv).g,
        texture2D(uPrev, moshedUv - vec2(ch, 0.0)).b
      );

      vec3 mosh = mix(prev, prevChroma, 0.35);
      mosh = quantize(mosh, 24.0);

      vec3 inside = mix(src, mosh, uPersistence);
      vec3 color = mix(src, inside, mask);
      gl_FragColor = vec4(color, 1.0);
    }
  `,
});

fsScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), processMaterial));

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  renderer.setSize(width, height);
  resolution.set(width, height);
  processMaterial.uniforms.uResolution.value.set(width, height);

  sourceRT.setSize(width, height);
  feedbackA.setSize(width, height);
  feedbackB.setSize(width, height);
}

window.addEventListener('resize', resize);
window.addEventListener('pointermove', (event) => {
  mouse.x = event.clientX / window.innerWidth;
  mouse.y = 1.0 - event.clientY / window.innerHeight;
});

resize();

const clock = new THREE.Clock();

function frame() {
  requestAnimationFrame(frame);

  const time = clock.getElapsedTime();
  sourceMaterial.uniforms.uTime.value = time;
  processMaterial.uniforms.uTime.value = time;
  processMaterial.uniforms.uSource.value = sourceRT.texture;
  processMaterial.uniforms.uPrev.value = readRT.texture;

  renderer.setRenderTarget(sourceRT);
  renderer.render(sourceScene, sourceCamera);

  renderer.setRenderTarget(writeRT);
  renderer.render(fsScene, orthoCamera);

  processMaterial.uniforms.uPrev.value = writeRT.texture;
  renderer.setRenderTarget(null);
  renderer.render(fsScene, orthoCamera);

  const temp = readRT;
  readRT = writeRT;
  writeRT = temp;
}

frame();
