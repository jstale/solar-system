// Small-body populations rendered as GPU-propagated point clouds. Each particle carries its
// own Keplerian elements; the vertex shader solves Kepler's equation every frame, so the
// belts move correctly at any time rate. Resonant populations are phase-locked to their
// planet: Jupiter trojans lead/trail Jupiter by 60°, Hildas keep their triangular pattern
// (3:2 with Jupiter), and plutinos avoid Neptune (2:3 resonance).

import * as THREE from 'three';
import { AU, DEG, TAU } from '../astro/constants.js';
import { STANDISH } from '../data/bodies.js';

const GAUSS_K_DEG = 0.9856076686; // mean motion at 1 AU, deg/day

const vertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 aOrbit1; // a [AU], e, i, node
attribute vec4 aOrbit2; // w, M0, n [rad/day], size
attribute vec3 aColor;
uniform float uDays;
uniform float uDistExp;
uniform float uSize;
uniform float uPixelRatio;
varying vec3 vColor;

void main() {
  float a = aOrbit1.x, e = aOrbit1.y, inc = aOrbit1.z, node = aOrbit1.w;
  float w = aOrbit2.x;
  float M = mod( aOrbit2.y + aOrbit2.z * uDays, 6.2831853 );
  float E = e < 0.8 ? M : 3.1415927;
  for ( int k = 0; k < 10; k ++ ) E -= ( E - e * sin( E ) - M ) / ( 1.0 - e * cos( E ) );
  float x = a * ( cos( E ) - e );
  float y = a * sqrt( 1.0 - e * e ) * sin( E );
  float cO = cos( node ), sO = sin( node ), cw = cos( w ), sw = sin( w ), ci = cos( inc ), si = sin( inc );
  vec3 P = vec3( cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si );
  vec3 Q = vec3( -cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si );
  vec3 ecl = P * x + Q * y;
  float r = length( ecl );
  ecl *= pow( r, uDistExp ) / r * ${AU.toFixed(1)};
  vec4 mv = modelViewMatrix * vec4( ecl.x, ecl.z, -ecl.y, 1.0 );
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * aOrbit2.w * uPixelRatio;
  vColor = aColor;
  #include <logdepthbuf_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uOpacity;
varying vec3 vColor;
void main() {
  #include <logdepthbuf_fragment>
  float d = length( gl_PointCoord - 0.5 );
  if ( d > 0.5 ) discard;
  gl_FragColor = vec4( vColor, smoothstep( 0.5, 0.1, d ) * uOpacity );
  #include <colorspace_fragment>
}
`;

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSampler(seed) {
  const r = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(TAU * r());
  const rayleigh = (s) => s * Math.sqrt(-2 * Math.log(1 - r() + 1e-12));
  return { r, gauss, rayleigh, range: (a, b) => a + (b - a) * r() };
}

// mean longitude at J2000 and its rate (deg, deg/day) from the Standish elements
function meanLongitude(key) {
  const [el, rate] = STANDISH[key];
  return { L0: el[3], n: rate[3] / 36525 };
}

class Population {
  constructor() {
    this.o1 = [];
    this.o2 = [];
    this.c = [];
  }

  /** angles in degrees, n in deg/day */
  add(a, e, i, node, w, M, n, size, color) {
    this.o1.push(a, e, i * DEG, node * DEG);
    this.o2.push(w * DEG, M * DEG, n * DEG, size);
    this.c.push(...color);
  }

  /** add with mean longitude λ and longitude of perihelion ϖ instead of M and ω */
  addLambda(a, e, i, node, peri, lambda, n, size, color) {
    this.add(a, e, i, node, peri - node, lambda - peri, n, size, color);
  }

  toPoints(material) {
    const g = new THREE.BufferGeometry();
    const count = this.o1.length / 4;
    // positions are computed in the shader; a dummy attribute keeps three.js happy
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aOrbit1', new THREE.Float32BufferAttribute(this.o1, 4));
    g.setAttribute('aOrbit2', new THREE.Float32BufferAttribute(this.o2, 4));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.c, 3));
    const points = new THREE.Points(g, material);
    points.frustumCulled = false;
    points.renderOrder = 1;
    return points;
  }
}

const sizeOf = (s) => 0.7 + 1.6 * Math.pow(s.r(), 3);

function mainBelt(count, s) {
  const pop = new Population();
  const jup = meanLongitude('Jupiter');
  // Kirkwood gaps (mean-motion resonances with Jupiter): centre AU, half-width, depth
  const gaps = [[2.502, 0.025, 0.95], [2.825, 0.018, 0.9], [2.958, 0.012, 0.85], [3.279, 0.035, 0.97], [2.705, 0.008, 0.5]];
  const density = (a) => {
    let f = a < 2.15 ? 0 : a < 2.5 ? 0.8 : a < 2.85 ? 1 : a < 3.0 ? 0.75 : a < 3.3 ? 0.6 : 0;
    for (const [c, wdt, depth] of gaps) f *= 1 - depth * Math.exp(-(((a - c) / wdt) ** 2));
    return f;
  };
  const colorFor = () => {
    const t = s.r();
    return t < 0.55 ? [0.42, 0.4, 0.38] : t < 0.9 ? [0.62, 0.53, 0.43] : [0.55, 0.55, 0.58];
  };
  const nCore = Math.round(count * 0.93);
  for (let k = 0; k < nCore; ) {
    const a = s.range(2.1, 3.35);
    if (s.r() > density(a)) continue;
    const e = Math.min(s.rayleigh(0.08), 0.33);
    const i = s.r() < 0.85 ? s.rayleigh(6.5) : s.rayleigh(14);
    pop.add(a, e, i, s.range(0, 360), s.range(0, 360), s.range(0, 360), GAUSS_K_DEG / a ** 1.5, sizeOf(s), colorFor());
    k++;
  }
  // Hungarias: inner edge, high inclination
  for (let k = 0; k < count * 0.02; k++) {
    const a = s.range(1.78, 2.0);
    pop.add(a, s.range(0.02, 0.17), s.range(16, 34), s.range(0, 360), s.range(0, 360), s.range(0, 360), GAUSS_K_DEG / a ** 1.5, sizeOf(s), [0.65, 0.62, 0.6]);
  }
  // Hildas: 3:2 with Jupiter, resonant angle 3λJ − 2λ − ϖ librating around 0
  const nH = 1.5 * jup.n;
  const aH = Math.cbrt((GAUSS_K_DEG / nH) ** 2);
  for (let k = 0; k < count * 0.05; k++) {
    const lambda = s.range(0, 360);
    const peri = 3 * jup.L0 - 2 * lambda + s.gauss() * 20;
    pop.addLambda(aH + s.gauss() * 0.04, s.range(0.08, 0.28), s.rayleigh(8), s.range(0, 360), peri, lambda, nH, sizeOf(s), [0.45, 0.42, 0.42]);
  }
  return pop;
}

function trojans(count, s) {
  const pop = new Population();
  const jup = meanLongitude('Jupiter');
  const aJ = STANDISH.Jupiter[0][0];
  for (let k = 0; k < count; k++) {
    const lead = k % 5 < 3 ? 60 : -60; // L4 holds ~1.6x more than L5
    const lambda = jup.L0 + lead + s.gauss() * 13;
    pop.addLambda(aJ + s.gauss() * 0.06, s.rayleigh(0.06), s.rayleigh(11), s.range(0, 360), s.range(0, 360), lambda, jup.n, sizeOf(s), [0.5, 0.42, 0.38]);
  }
  return pop;
}

function kuiperBelt(count, s) {
  const pop = new Population();
  const nep = meanLongitude('Neptune');
  const icy = () => {
    const t = s.r();
    return t < 0.5 ? [0.62, 0.55, 0.5] : t < 0.8 ? [0.55, 0.58, 0.64] : [0.7, 0.5, 0.42];
  };
  for (let k = 0; k < count; k++) {
    const t = s.r();
    if (t < 0.22) {
      // plutinos: 2:3 with Neptune, 3λ − 2λN − ϖ librating around 180°
      const n = (2 / 3) * nep.n;
      const a = Math.cbrt((GAUSS_K_DEG / n) ** 2);
      const lambda = s.range(0, 360);
      const peri = 3 * lambda - 2 * nep.L0 - 180 + s.gauss() * 40;
      pop.addLambda(a + s.gauss() * 0.15, s.range(0.05, 0.3), s.rayleigh(10), s.range(0, 360), peri, lambda, n, sizeOf(s), icy());
    } else if (t < 0.57) {
      // cold classicals
      const a = s.range(42.2, 47.2);
      pop.add(a, Math.min(s.rayleigh(0.035), 0.1), s.rayleigh(2), s.range(0, 360), s.range(0, 360), s.range(0, 360), GAUSS_K_DEG / a ** 1.5, sizeOf(s), [0.72, 0.52, 0.42]);
    } else if (t < 0.85) {
      // hot classicals
      const a = s.range(40, 48);
      pop.add(a, s.range(0, 0.2), s.rayleigh(12), s.range(0, 360), s.range(0, 360), s.range(0, 360), GAUSS_K_DEG / a ** 1.5, sizeOf(s), icy());
    } else {
      // scattered disc
      const a = 50 * Math.pow(4, s.r());
      const q = s.range(32, 42);
      pop.add(a, 1 - q / a, s.rayleigh(16), s.range(0, 360), s.range(0, 360), s.range(0, 360), GAUSS_K_DEG / a ** 1.5, sizeOf(s), icy());
    }
  }
  return pop;
}

export class Belts {
  constructor() {
    this.group = new THREE.Group();
    this.uniforms = {
      uDays: { value: 0 },
      uDistExp: { value: 1 },
      uSize: { value: 1.6 },
      uPixelRatio: { value: 1 },
    };
    this.items = {};
  }

  _material(opacity) {
    return new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uOpacity: { value: opacity } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    });
  }

  build(density = 1) {
    for (const item of Object.values(this.items)) {
      this.group.remove(item);
      item.geometry.dispose();
      item.material.dispose();
    }
    const n = (x) => Math.round(x * density);
    this.items = {
      mainBelt: mainBelt(n(40000), makeSampler(1)).toPoints(this._material(0.75)),
      trojans: trojans(n(7000), makeSampler(2)).toPoints(this._material(0.75)),
      kuiper: kuiperBelt(n(30000), makeSampler(3)).toPoints(this._material(0.7)),
    };
    // typical radius (AU) and full opacity of each population
    this.items.mainBelt.userData = { radius: 2.7, opacity: 0.75 };
    this.items.trojans.userData = { radius: 5.2, opacity: 0.75 };
    this.items.kuiper.userData = { radius: 44, opacity: 0.7 };
    for (const item of Object.values(this.items)) this.group.add(item);
  }

  update(daysSinceJ2000, settings, pixelRatio, cameraDistance, pxPerRad) {
    this.uniforms.uDays.value = daysSinceJ2000;
    this.uniforms.uDistExp.value = settings.distanceExponent;
    this.uniforms.uSize.value = settings.beltPointSize;
    this.uniforms.uPixelRatio.value = pixelRatio;
    this.items.mainBelt.visible = settings.showMainBelt;
    this.items.trojans.visible = settings.showTrojans;
    this.items.kuiper.visible = settings.showKuiper;
    // tens of thousands of points squeezed into a few pixels just saturate: thin them out
    for (const item of Object.values(this.items)) {
      const { radius, opacity } = item.userData;
      const px = ((AU * Math.pow(radius, settings.distanceExponent)) / cameraDistance) * pxPerRad;
      item.material.uniforms.uOpacity.value = opacity * THREE.MathUtils.clamp(px / 450, 0.12, 1);
    }
  }
}
