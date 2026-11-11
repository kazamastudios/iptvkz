// IPTVKZ — campo de partículas 3D do hero (Three.js). Carregado só em telas maiores e sem
// "reduzir movimento". Uma malha de pontos ondula como um sinal, reage ao mouse e ao scroll,
// e para de desenhar quando o hero sai da tela ou a aba fica em segundo plano.
import {
  WebGLRenderer, Scene, PerspectiveCamera, PlaneGeometry, ShaderMaterial, Points,
  AdditiveBlending, Color, Vector2,
} from './vendor/three.module.min.js';

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uScroll;
  uniform vec2 uMouse;
  uniform float uPixel;
  varying float vWave;
  varying float vFade;
  void main() {
    vec3 p = position;
    float w = sin(p.x * 0.45 + uTime * 0.8) * 0.32
            + sin(p.z * 0.75 + uTime * 0.55) * 0.22
            + sin((p.x + p.z) * 0.28 - uTime * 0.35) * 0.28;
    // ondulação em volta do mouse
    vec2 m = vec2(uMouse.x * 11.0, -2.0 - uMouse.y * 5.0);
    float d = distance(p.xz, m);
    w += exp(-d * d * 0.06) * sin(uTime * 2.4 - d * 1.6) * 0.7;
    w *= 1.0 + uScroll * 1.6;
    p.y += w;
    vWave = w;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (2.8 + max(w, 0.0) * 3.0) * uPixel * (7.0 / -mv.z);
    vFade = smoothstep(-34.0, -9.0, mv.z) * smoothstep(-1.5, -4.5, mv.z);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uRed;
  uniform float uAlpha;
  varying float vWave;
  varying float vFade;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    float soft = smoothstep(0.5, 0.0, r);
    vec3 col = mix(uRed * 0.55, mix(uRed, vec3(1.0), 0.55), smoothstep(-0.2, 0.9, vWave));
    gl_FragColor = vec4(col, soft * vFade * uAlpha * (0.45 + smoothstep(-0.4, 0.9, vWave) * 0.75));
  }
`;

export function init(canvas, { onScroll } = {}) {
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' });
  } catch (e) {
    return null; // sem WebGL: fica só o brilho em CSS
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(52, 1, 0.1, 80);
  camera.position.set(0, 3.1, 7.5);
  camera.lookAt(0, -1.6, -6);

  const geo = new PlaneGeometry(34, 26, 170, 110);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -1.4, -9);

  const uniforms = {
    uTime: { value: 0 },
    uScroll: { value: 0 },
    uMouse: { value: new Vector2(0, 0) },
    uPixel: { value: dpr },
    uRed: { value: new Color('#ff2a2a') },
    uAlpha: { value: 1.0 },
  };
  const mat = new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms,
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  });
  scene.add(new Points(geo, mat));

  const size = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  size();
  window.addEventListener('resize', size);

  // mouse suavizado
  const target = new Vector2();
  window.addEventListener('pointermove', (e) => {
    target.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
  }, { passive: true });

  let visible = true;
  let raf = 0;
  let last = performance.now();
  const tick = (now) => {
    raf = 0;
    if (!visible || document.hidden) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    uniforms.uTime.value += dt;
    uniforms.uMouse.value.lerp(target, 0.05);
    camera.position.x += (target.x * 0.6 - camera.position.x) * 0.03;
    camera.lookAt(0, -1.6, -6);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };
  const start = () => { if (!raf && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(tick); } };

  new IntersectionObserver(([e]) => { visible = e.isIntersecting; start(); }).observe(canvas);
  document.addEventListener('visibilitychange', start);
  start();

  if (onScroll) onScroll((p) => { uniforms.uScroll.value = p; });
  canvas.classList.add('is-on');
  return { renderer };
}
