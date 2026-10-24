// Shared unit-sphere geometries plus a few procedurally "lumpy" variants for small,
// irregular bodies (most moons under ~150 km are not round).

import * as THREE from 'three';

const spheres = new Map();

export function sphere(segments) {
  if (!spheres.has(segments)) spheres.set(segments, new THREE.SphereGeometry(1, segments, segments / 2));
  return spheres.get(segments);
}

function hash3(x, y, z, seed) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h & 0xffff) / 0x8000 - 1;
}

function valueNoise(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const s = (t) => t * t * (3 - 2 * t);
  const u = s(xf), v = s(yf), w = s(zf);
  const lerp = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz, seed);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}

function fbm(x, y, z, seed) {
  let sum = 0, amp = 0.5, f = 1.3;
  for (let o = 0; o < 5; o++) {
    sum += amp * valueNoise(x * f, y * f, z * f, seed + o * 17);
    amp *= 0.5;
    f *= 2.1;
  }
  return sum;
}

const lumpy = [];
const LUMPY_VARIANTS = 6;

function buildLumpy(seed) {
  const g = new THREE.SphereGeometry(1, 64, 32);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // large-scale lobes + craters-ish detail
    const d = 1 + 0.22 * fbm(v.x + seed, v.y, v.z, seed) + 0.06 * fbm(v.x * 4, v.y * 4, v.z * 4, seed + 99);
    v.multiplyScalar(d);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  // SphereGeometry duplicates vertices along the seam and at the poles: average their normals
  const nrm = g.attributes.normal;
  const groups = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  const n = new THREE.Vector3(), t = new THREE.Vector3();
  for (const idx of groups.values()) {
    if (idx.length < 2) continue;
    n.set(0, 0, 0);
    for (const i of idx) n.add(t.fromBufferAttribute(nrm, i));
    n.normalize();
    for (const i of idx) nrm.setXYZ(i, n.x, n.y, n.z);
  }
  g.computeBoundingSphere();
  return g;
}

export function lumpyGeometry(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const k = Math.abs(h) % LUMPY_VARIANTS;
  if (!lumpy[k]) lumpy[k] = buildLumpy(k * 7 + 3);
  return lumpy[k];
}
