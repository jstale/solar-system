import * as THREE from 'three';
import './style.css';
import { loadSettings } from './settings.js';
import { TextureStore } from './scene/textures.js';
import { SolarSystem } from './scene/system.js';
import { createSky } from './scene/sky.js';
import { Belts } from './scene/belts.js';
import { CameraRig } from './camera.js';
import { Labels } from './ui/labels.js';
import { BodyTree, InfoCard } from './ui/panel.js';
import { Clock, TimeBar } from './ui/timebar.js';
import { createGui } from './ui/gui.js';
import { AU, J2000 } from './astro/constants.js';

const settings = loadSettings();

// ---------------------------------------------------------------- renderer & scene

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  // depth precision from 1 m to 10^13 km
  logarithmicDepthBuffer: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
// units: km. Near plane is adjusted every frame.
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1e-3, 1e13);

// sunlight: decay 0 keeps the irradiance constant with distance (outer planets would otherwise
// be 900x darker than Earth – true, but exposure-adapted views are what spacecraft show)
const sunLight = new THREE.PointLight(0xffffff, Math.PI, 0, 0);
scene.add(sunLight);
const ambient = new THREE.AmbientLight(0xffffff, settings.ambient);
scene.add(ambient);

// ---------------------------------------------------------------- loading

const loadingEl = document.getElementById('loading');
const loadingBar = loadingEl.querySelector('.bar div');
const loadingMsg = loadingEl.querySelector('.msg');
const manager = new THREE.LoadingManager();
manager.onProgress = (_url, loaded, total) => {
  loadingBar.style.width = `${(100 * loaded) / total}%`;
  loadingMsg.textContent = `Loading textures… ${loaded} / ${total}`;
};
let started = false;
const finishLoading = () => {
  if (started) return;
  started = true;
  loadingEl.classList.add('done');
};
manager.onLoad = finishLoading;
manager.onError = (url) => console.warn('texture failed', url);

const textures = new TextureStore(renderer, manager);
await textures.init();
if (!Object.keys(textures.manifest).length) {
  loadingMsg.textContent = 'No textures found – run `npm run textures`';
  setTimeout(finishLoading, 2500);
}

// ---------------------------------------------------------------- world

const sky = createSky(textures);
scene.add(sky.mesh);

const system = new SolarSystem(scene, textures, settings);
system.build();

const belts = new Belts();
belts.build(settings.beltDensity);
scene.add(belts.group);

const clock = new Clock();
const rig = new CameraRig(camera, canvas);

// ---------------------------------------------------------------- UI

const labels = new Labels(document.getElementById('labels'), system, (b) => focusBody(b));
const tree = new BodyTree(document.getElementById('tree'), system, (b) => focusBody(b));
const info = new InfoCard(document.getElementById('info'), system);
const timebar = new TimeBar(document.getElementById('timebar'), clock);
const gui = createGui(settings, {
  onScaleChange: () => {
    // keep the camera at the same apparent size of the focused body
    const f = rig.focus;
    const before = f.displayRadius;
    system.scaleVersion++;
    system.updatePositions(clock.jd);
    if (f && before > 0) rig.zoom(f.displayRadius / before);
  },
  onBeltDensity: () => belts.build(settings.beltDensity),
});

function focusBody(body, opts = {}) {
  if (!body) return;
  rig.flyTo(body, { sun: system.sun, ...opts });
  tree.setFocus(body);
  info.show(body);
  history.replaceState(null, '', `#${encodeURIComponent(body.name)}`);
}

// overview distances in AU (true scale; compressed with the distance exponent)
const VIEWS = { inner: 3.2, outer: 70, kuiper: 210 };
document.querySelectorAll('[data-view]').forEach((btn) =>
  btn.addEventListener('click', () => {
    // look down on the ecliptic at ~30°
    const direction = new THREE.Vector3(0.15, 0.55, 1).normalize();
    const distance = AU * Math.pow(VIEWS[btn.dataset.view], settings.distanceExponent);
    focusBody(system.sun, { distance, direction });
  }),
);

const sidebar = document.getElementById('sidebar');
document.getElementById('sidebar-toggle').addEventListener('click', () => {
  sidebar.classList.toggle(window.innerWidth <= 760 ? 'expanded' : 'collapsed');
});

const credits = document.getElementById('credits');
document.getElementById('credits-link').addEventListener('click', (e) => {
  e.preventDefault();
  credits.showModal();
});

// click (not drag) on the canvas focuses the body under the cursor
let down = null;
canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
  const b = labels.pick(e.clientX, e.clientY);
  if (b && b !== rig.focus) focusBody(b);
});
canvas.addEventListener('dblclick', (e) => {
  const b = labels.pick(e.clientX, e.clientY) ?? rig.focus;
  focusBody(b, { distance: rig.defaultDistance(b) });
});

const PLANET_KEYS = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
  const f = rig.focus;
  if (e.key >= '1' && e.key <= '9') focusBody(system.get(PLANET_KEYS[+e.key - 1]));
  else if (e.key === '0') focusBody(system.sun);
  else if (e.key === ' ') timebar.act('pause');
  else if (e.key === ',') timebar.act('slower');
  else if (e.key === '.') timebar.act('faster');
  else if (e.key === 'r' || e.key === 'R') timebar.act('reverse');
  else if (e.key === 'n' || e.key === 'N') timebar.act('now');
  else if (e.key === 'h' || e.key === 'H') {
    const hidden = document.getElementById('ui').classList.toggle('hidden');
    gui.show(!hidden);
  } else if (e.key === 'o' || e.key === 'O') settings.showOrbits = !settings.showOrbits;
  else if (e.key === 'l' || e.key === 'L') settings.showLabels = !settings.showLabels;
  else if (e.key === 'b' || e.key === 'B') sidebar.classList.toggle('collapsed');
  else if (e.key === 'Escape' || e.key === 'Backspace') f?.parent && focusBody(f.parent);
  else if (e.key === ']' || e.key === '[') {
    const sibs = f?.parent ? f.parent.children : [];
    const i = sibs.indexOf(f);
    if (i >= 0) focusBody(sibs[(i + (e.key === ']' ? 1 : sibs.length - 1)) % sibs.length]);
  } else if (e.key === '+' || e.key === '=') rig.zoom(0.7);
  else if (e.key === '-' || e.key === '_') rig.zoom(1 / 0.7);
  else return;
  e.preventDefault();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- start

system.updatePositions(clock.jd);
const fromHash = system.get(decodeURIComponent(location.hash.slice(1)));
const start = fromHash ?? system.get('Earth');
rig.flyTo(start, { instant: true, sun: system.sun });
tree.setFocus(start);
info.show(start);

// handle for poking around from the dev-tools console
window.solar = { system, rig, clock, settings, camera, renderer, focus: focusBody };

let last = performance.now();
let infoTimer = 0;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  clock.tick(dt);
  system.lastJd = clock.jd;
  system.updatePositions(clock.jd);
  sunLight.position.copy(system.sun.pos);

  rig.update(dt);
  // near plane follows the distance to the closest surface we are looking at
  const surface = Math.max(rig.distance() - rig.focus.displayRadius, 1e-3);
  camera.near = THREE.MathUtils.clamp(surface * 0.01, 1e-4, 1e4);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  const w = window.innerWidth, h = window.innerHeight;
  system.updateView(camera, w, h, rig.focus, clock.jd);
  const pxPerRad = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  belts.update(clock.jd - J2000, settings, renderer.getPixelRatio(), camera.position.distanceTo(system.sun.pos), pxPerRad);
  labels.update(w, h, rig.focus, settings);

  renderer.toneMappingExposure = settings.exposure;
  ambient.intensity = settings.ambient;
  sky.uniforms.uIntensity.value = settings.starBrightness;

  renderer.render(scene, camera);

  timebar.update();
  infoTimer += dt;
  if (infoTimer > 0.25) {
    infoTimer = 0;
    info.update(clock.jd);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// fail-safe: never keep the loading screen up forever
setTimeout(finishLoading, 20000);
