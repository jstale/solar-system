// Builds every body from the data tables and advances the whole system each frame.

import * as THREE from 'three';
import { Body } from './body.js';
import { OrbitLine } from './orbitLine.js';
import { MAX_OCC } from './materials.js';
import { SUN, PLANETS, SMALL_BODIES, STANDISH } from '../data/bodies.js';
import moonsData from '../data/moons.json';
import {
  DWARF_MOONS,
  MOON_TEXTURES,
  MOON_SHAPES,
  MOON_SPIN,
  MOON_ATMOSPHERES,
  MOON_DESCRIPTIONS,
} from '../data/moons-extra.js';
import { Orbit, orbitFromStandish, orbitFromSbdb } from '../astro/orbit.js';
import { IauRotation, SimpleRotation, TidalLock } from '../astro/rotation.js';
import { referenceBasisFromPole, raDecToEqu, ECLIPTIC_BASIS, eclToScene } from '../astro/frames.js';
import { jdFromEpochString } from '../astro/time.js';
import { lunarPosition } from '../astro/moon.js';
import { AU, DEG, J2000 } from '../astro/constants.js';

const MOON_IAU = { ra: [269.9949, 0.0031], dec: [66.5392, 0.013], W: [38.3213, 13.17635815] };

const SYSTEM_TINT = {
  Mars: [0.75, 0.68, 0.62],
  Jupiter: [0.8, 0.72, 0.64],
  Saturn: [0.82, 0.8, 0.76],
  Uranus: [0.55, 0.55, 0.58],
  Neptune: [0.6, 0.6, 0.64],
  Pluto: [0.85, 0.85, 0.85],
};

function hashUnit(name, salt = 0) {
  let h = 2166136261 ^ salt;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

function moonOrbit(m, planetDef) {
  let basis = ECLIPTIC_BASIS;
  if (m.frame === 'laplace' && m.ra != null) basis = referenceBasisFromPole(raDecToEqu(m.ra, m.dec));
  else if (m.frame === 'equatorial') {
    const r = planetDef.rotation;
    basis = referenceBasisFromPole(raDecToEqu(r.ra[0], r.dec[0]));
  }
  const yr = 365.25;
  const cosI = Math.cos(m.i * DEG), sinI = Math.sin(m.i * DEG);
  // J2-like precession: node regresses for prograde orbits; apsides advance below the critical inclination
  const nodeRate = m.Pnode ? (-Math.sign(cosI) * 360) / (m.Pnode * yr) : 0;
  const wRate = m.Pw ? (Math.sign(4 - 5 * sinI * sinI) * 360) / (m.Pw * yr) : 0;
  return new Orbit({
    a: m.a,
    e: m.e,
    i: m.i,
    node: m.node,
    w: m.w,
    M: m.M,
    n: 360 / m.P,
    epoch: jdFromEpochString(m.epoch),
    rates: { node: nodeRate, w: wRate },
    basis,
  });
}

function polarToScene(lonDeg, latDeg) {
  const lon = lonDeg * DEG, lat = latDeg * DEG;
  return eclToScene(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
}

export class SolarSystem {
  constructor(scene, textures, settings) {
    this.scene = scene;
    this.textures = textures;
    this.settings = settings;
    this.bodies = [];
    this.byName = new Map();
    this.orbitGroup = new THREE.Group();
    scene.add(this.orbitGroup);
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._view = new THREE.Vector3();
    this.ctx = { tmp: new THREE.Vector3(), sunV: new THREE.Vector3(), sunRadius: 1, pixelScale: 1 };
    this.scaleVersion = 0; // bumped when scale settings change, forces orbit-line rebuilds
  }

  add(body, parent) {
    if (parent) {
      body.parent = parent;
      parent.children.push(body);
    }
    this.bodies.push(body);
    this.byName.set(body.name, body);
    return body;
  }

  build() {
    const sun = this.add(new Body(SUN, { rotation: new IauRotation(SUN.rotation) }));
    this.sun = sun;

    const pendingPoles = [];
    for (const def of [...PLANETS, ...SMALL_BODIES]) {
      const o = def.orbit;
      const orbit = o.type === 'standish' ? orbitFromStandish(STANDISH[o.key]) : orbitFromSbdb(o);
      let rotation = null;
      const r = def.rotation;
      if (r.type === 'iau') rotation = new IauRotation(r);
      else if (r.poleEcl) rotation = new SimpleRotation({ pole: polarToScene(...r.poleEcl), periodHours: r.periodHours });
      else pendingPoles.push(def);
      this.add(new Body(def, { orbit, rotation }), sun);
    }

    // moons: JPL tables + dwarf-planet satellites
    const planetDefs = new Map([...PLANETS, ...SMALL_BODIES].map((d) => [d.name, d]));
    for (const m of [...moonsData, ...DWARF_MOONS]) {
      const parent = this.byName.get(m.planet);
      if (!parent) continue;
      const orbit = moonOrbit(m, planetDefs.get(m.planet));
      const textureName = MOON_TEXTURES[m.name];
      const shape = MOON_SHAPES[m.name];
      const tint = SYSTEM_TINT[m.planet] ?? [0.8, 0.8, 0.8];
      const generic = ['phobos', 'deimos', 'callisto', 'umbriel'][Math.floor(hashUnit(m.name) * 4)];
      const def = {
        name: m.name,
        kind: 'moon',
        radius: m.radius,
        radii: shape,
        color: textureName ? '#c8c2b8' : `rgb(${tint.map((c) => Math.round(c * 200)).join(',')})`,
        textures: textureName ? { map: textureName } : { generic, tint },
        atmosphere: MOON_ATMOSPHERES[m.name],
        description: MOON_DESCRIPTIONS[m.name] ?? '',
        jplCode: m.code,
        approximate: m.approximate,
        radiusSource: m.radiusSource,
      };
      let rotation;
      if (m.name === 'Moon') {
        orbit.positionModel = lunarPosition;
        rotation = new IauRotation(MOON_IAU);
      } else if (MOON_SPIN[m.name] || m.frame === 'ecliptic' && !m.approximate) {
        // irregular / non-synchronous: spin about a pole near the orbit normal
        const pole = orbit.normal(J2000).clone();
        pole.x += hashUnit(m.name, 1) - 0.5;
        pole.z += hashUnit(m.name, 2) - 0.5;
        const period = MOON_SPIN[m.name] ?? 5 + 15 * hashUnit(m.name, 3);
        rotation = new SimpleRotation({ pole, periodHours: period, W0: 360 * hashUnit(m.name, 4) });
      } else rotation = new TidalLock(orbit);
      this.add(new Body(def, { orbit, rotation }), parent);
    }

    for (const def of pendingPoles) {
      const body = this.byName.get(def.name);
      const moon = this.byName.get(def.rotation.poleFromMoon);
      const pole = moon ? moon.orbit.normal(J2000).clone() : new THREE.Vector3(0, 1, 0);
      body.rotation = new SimpleRotation({ pole, periodHours: def.rotation.periodHours });
    }

    // barycentric pairs
    for (const body of this.bodies) {
      const b = body.def.orbit?.barycentre;
      if (!b) continue;
      body.bary = { satellite: this.byName.get(b.satellite), massRatio: b.massRatio };
      for (const child of body.children) if (child !== body.bary.satellite) child.orbitsBarycentre = true;
    }

    for (const body of this.bodies) {
      body.build(this.textures);
      this.scene.add(body.root);
      body.isMajor = !body.isMoon || body.radius >= 100 || Boolean(MOON_TEXTURES[body.name]);
      if (body.orbit) {
        const segments = !body.isMoon ? 900 : body.isMajor ? 360 : 200;
        body.orbitLine = new OrbitLine(body, segments);
        this.orbitGroup.add(body.orbitLine.line);
      }
    }
    // parents before children
    this.ordered = [...this.bodies].sort((a, b) => depth(a) - depth(b));
    for (const b of this.bodies) b.children.sort((x, y) => (x.orbit?.a0 ?? 0) - (y.orbit?.a0 ?? 0));
  }

  get(name) {
    return this.byName.get(name);
  }

  sizeScaleFor(body) {
    const s = this.settings;
    if (body.kind === 'star') return s.sunScale;
    if (body.kind === 'moon') return s.moonScale;
    return s.planetScale;
  }

  /**
   * Moon offset (true, km) -> display offset, in place. Distance above the planet's surface is
   * scaled by moonOrbitScale while the planet itself is scaled by planetScale, so moons always
   * stay outside an enlarged planet. Identity at realistic scale.
   */
  moonToDisplay(moon, v) {
    const k = this.settings.moonOrbitScale;
    const p = moon.parent;
    if (k === 1 && p.sizeScale === 1) return v;
    const r = v.length();
    if (r === 0) return v;
    const R = p.maxRadius;
    return v.multiplyScalar((R * p.sizeScale + Math.max(r - R, 0) * k) / r);
  }

  /** heliocentric true vector -> display vector (distance compression), in place */
  helioToDisplay(v) {
    const p = this.settings.distanceExponent;
    if (p === 1) return v;
    const r = v.length();
    if (r > 0) v.multiplyScalar((AU * Math.pow(r / AU, p)) / r);
    return v;
  }

  updatePositions(jd) {
    for (const b of this.ordered) {
      b.sizeScale = this.sizeScaleFor(b);
      b.displayRadius = b.maxRadius * b.sizeScale;
      if (!b.parent) {
        b.updateRotation(jd);
        continue;
      }
      b.orbit.position(jd, b.trueRel);
      if (!b.isMoon) {
        this.helioToDisplay(b.displayRel.copy(b.trueRel));
        b.trueBaryPos.copy(b.trueRel);
        b.baryPos.copy(b.displayRel);
        b.truePos.copy(b.trueRel);
        b.pos.copy(b.displayRel);
        if (b.bary) {
          const sat = b.bary.satellite;
          sat.orbit.position(jd, sat.trueRel);
          sat.sizeScale = this.sizeScaleFor(sat);
          const k = b.bary.massRatio;
          b.truePos.addScaledVector(sat.trueRel, -k);
          b.pos.addScaledVector(this.moonToDisplay(sat, this._tmp.copy(sat.trueRel)), -k);
        }
      } else {
        const p = b.parent;
        b.truePos.copy(b.orbitsBarycentre ? p.trueBaryPos : p.truePos).add(b.trueRel);
        this.moonToDisplay(b, b.displayRel.copy(b.trueRel));
        b.pos.copy(b.orbitsBarycentre ? p.baryPos : p.pos).add(b.displayRel);
      }
      b.updateRotation(jd);
    }
  }

  /** Camera-dependent work: screen metrics, lighting uniforms, orbit lines, hi-res textures. */
  updateView(camera, width, height, focus, jd) {
    const s = this.settings;
    const viewMatrix = camera.matrixWorldInverse;
    const pxPerRad = height / (2 * Math.tan((camera.fov * DEG) / 2));
    const ctx = this.ctx;
    ctx.viewMatrix = viewMatrix;
    ctx.settings = s;
    ctx.jd = jd;
    ctx.pixelScale = 1 / pxPerRad;
    ctx.sunV.copy(this.sun.pos).applyMatrix4(viewMatrix);
    ctx.sunRadius = this.sun.displayRadius;

    const v = this._view;
    for (const b of this.bodies) {
      v.copy(b.pos).applyMatrix4(viewMatrix);
      const depth = -v.z;
      const sc = b.screen;
      sc.depth = depth;
      sc.dist = v.length();
      sc.inFront = depth > 0;
      if (sc.inFront) {
        sc.x = width / 2 + (v.x / depth) * pxPerRad;
        sc.y = height / 2 - (v.y / depth) * pxPerRad;
        sc.px = (b.displayRadius / depth) * pxPerRad;
        sc.onScreen = sc.x > -50 && sc.x < width + 50 && sc.y > -50 && sc.y < height + 50;
      } else {
        sc.px = 0;
        sc.onScreen = false;
      }
    }

    for (const b of this.bodies) {
      if (b.kind !== 'star' && b.screen.inFront && b.screen.px > 0.3) this.updateOccluders(b, viewMatrix);
      b.updateVisual(ctx);
      this.updateHiRes(b, focus);
    }

    this.updateOrbitLines(camera, pxPerRad, focus);
  }

  updateOccluders(b, viewMatrix) {
    const L = b.lighting;
    if (!this.settings.eclipses) {
      L.uOccCount.value = 0;
      return;
    }
    const sunDir = this._tmp.copy(this.sun.pos).sub(b.pos);
    const sunDist = sunDir.length();
    sunDir.divideScalar(sunDist);
    const sunAng = this.sun.displayRadius / sunDist;
    const found = [];
    const consider = (o) => {
      if (!o || o === b || o.kind === 'star' || o.radius < 20) return;
      const rel = this._tmp2.copy(o.pos).sub(b.pos);
      const along = rel.dot(sunDir);
      if (along <= 0) return;
      const perp = rel.addScaledVector(sunDir, -along).length();
      const limit = b.displayRadius + o.displayRadius + along * sunAng * 1.5;
      if (perp < limit) found.push([perp - o.displayRadius, o]);
    };
    consider(b.parent);
    for (const c of b.children) consider(c);
    if (b.parent && b.parent.kind !== 'star') for (const sib of b.parent.children) consider(sib);
    found.sort((x, y) => x[0] - y[0]);
    const n = Math.min(found.length, MAX_OCC);
    for (let k = 0; k < n; k++) {
      const o = found[k][1];
      const vv = L.uOcc.value[k];
      this._tmp2.copy(o.pos).applyMatrix4(viewMatrix);
      vv.set(this._tmp2.x, this._tmp2.y, this._tmp2.z, o.radius * o.sizeScale);
      // solid worlds with real atmospheres redden the light in their umbra
      L.uOccRefract.value[k] = o.def.atmosphere && o.radius < 10000 ? 1 : 0;
    }
    L.uOccCount.value = n;
  }

  updateHiRes(b, focus) {
    if (!b.textureSlots.length) return;
    const px = b.screen.inFront ? b.screen.px : 0;
    const isFocus = b === focus;
    if (!this.settings.hiResTextures) {
      b.setHiRes(false, this.textures);
      return;
    }
    if (!b.hiRes && (px > 260 || (isFocus && px > 60))) b.setHiRes(true, this.textures);
    else if (b.hiRes && px < 90 && !(isFocus && px > 30)) b.setHiRes(false, this.textures);
  }

  orbitCategoryVisible(b) {
    const s = this.settings;
    if (!s.showOrbits) return false;
    if (b.kind === 'planet') return s.orbitsPlanets;
    if (b.kind === 'moon') return b.isMajor ? s.orbitsMoons : s.orbitsMinorMoons;
    return s.orbitsSmallBodies;
  }

  updateOrbitLines(camera, pxPerRad, focus) {
    const s = this.settings;
    const camPos = camera.position;
    const focusDist = focus ? camPos.distanceTo(focus.pos) : Infinity;
    const helioIdentity = s.distanceExponent === 1;
    const helioMap = (v) => this.helioToDisplay(v);
    for (const b of this.bodies) {
      const line = b.orbitLine;
      if (!line) continue;
      if (!this.orbitCategoryVisible(b)) {
        line.hide();
        continue;
      }
      const el = b.orbit.el; // already advanced in updatePositions()
      let opacity;
      let toDisplay = null;
      let anchor;
      let size;
      let px;
      if (b.isMoon) {
        const center = b.orbitsBarycentre ? b.parent.baryPos : b.parent.pos;
        size = this.moonToDisplay(b, this._tmp.set(el.a * (1 + el.e), 0, 0)).x;
        px = (size / Math.max(camPos.distanceTo(center), 1e-9)) * pxPerRad;
        opacity = THREE.MathUtils.smoothstep(px, 12, 60) * s.orbitOpacity * (b.isMajor ? 1 : 0.6);
        if (s.moonOrbitScale !== 1 || b.parent.sizeScale !== 1) toDisplay = (v) => this.moonToDisplay(b, v);
        anchor = b.pos;
      } else {
        size = AU * Math.pow((el.a * (1 + el.e)) / AU, s.distanceExponent);
        px = (size / Math.max(camPos.length(), 1e-9)) * pxPerRad;
        opacity = THREE.MathUtils.smoothstep(px, 10, 50) * s.orbitOpacity;
        if (!helioIdentity) toDisplay = helioMap;
        anchor = b.baryPos;
      }
      // zoomed in on a body: other, much larger orbits would only streak across the view
      if (b !== focus) opacity *= THREE.MathUtils.smoothstep(focusDist / size, 0.004, 0.03);
      // rebuild once the body has moved ~0.25 px along its orbit
      const tolerance = (0.25 * camPos.distanceTo(anchor)) / pxPerRad;
      const rel = b.isMoon ? b.displayRel : b.baryPos;
      line.update(opacity, toDisplay, anchor, rel, b.displayRadius * 2.5, px, tolerance, this.scaleVersion);
    }
  }
}

function depth(b) {
  let d = 0;
  for (let p = b.parent; p; p = p.parent) d++;
  return d;
}
