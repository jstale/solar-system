// Keplerian orbits with linearly drifting elements.
//
// Every orbit in the simulation (planets, moons, dwarf planets, comets) is expressed as
//   element(t) = element0 + rate * (t - epoch)
// in some reference plane (ecliptic, a planet's equator or a Laplace plane), then rotated
// into the scene frame through that plane's basis.

import { Vector3 } from 'three';
import { DEG, TAU, J2000, AU } from './constants.js';
import { ECLIPTIC_BASIS } from './frames.js';

export function solveKepler(M, e) {
  M = M % TAU;
  if (M > Math.PI) M -= TAU;
  else if (M < -Math.PI) M += TAU;
  let E = e < 0.8 ? M : (M >= 0 ? Math.PI : -Math.PI);
  for (let k = 0; k < 50; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  return E;
}

export class Orbit {
  /**
   * @param {object} p
   *   a [km], e, i, node, w, M [deg] at epoch [JD]
   *   n mean motion [deg/day]
   *   rates: { a [km/day], e [/day], i, node, w [deg/day] }
   *   basis: reference plane basis in scene coords ({e1,e2,e3})
   */
  constructor(p) {
    this.a0 = p.a;
    this.e0 = p.e;
    this.i0 = p.i * DEG;
    this.node0 = p.node * DEG;
    this.w0 = p.w * DEG;
    this.M0 = p.M * DEG;
    this.n = p.n * DEG;
    this.epoch = p.epoch;
    const r = p.rates ?? {};
    this.aRate = r.a ?? 0;
    this.eRate = r.e ?? 0;
    this.iRate = (r.i ?? 0) * DEG;
    this.nodeRate = (r.node ?? 0) * DEG;
    this.wRate = (r.w ?? 0) * DEG;
    this.basis = p.basis ?? ECLIPTIC_BASIS;
    this.periodDays = TAU / Math.abs(this.n);
    this.el = { a: 0, e: 0, i: 0, node: 0, w: 0, M: 0, E: 0 };
    this._P = new Vector3();
    this._Q = new Vector3();
    this._W = new Vector3();
    this._jd = NaN;
  }

  /** Updates cached elements, perifocal unit vectors (scene frame) and eccentric anomaly. */
  update(jd) {
    if (jd === this._jd) return this.el;
    this._jd = jd;
    const dt = jd - this.epoch;
    const el = this.el;
    el.a = this.a0 + this.aRate * dt;
    el.e = Math.min(Math.max(this.e0 + this.eRate * dt, 0), 0.9999);
    el.i = this.i0 + this.iRate * dt;
    el.node = this.node0 + this.nodeRate * dt;
    el.w = this.w0 + this.wRate * dt;
    el.M = this.M0 + this.n * dt;
    el.E = solveKepler(el.M, el.e);

    const cO = Math.cos(el.node), sO = Math.sin(el.node);
    const cw = Math.cos(el.w), sw = Math.sin(el.w);
    const ci = Math.cos(el.i), si = Math.sin(el.i);
    // reference-plane components
    const Px = cO * cw - sO * sw * ci, Py = sO * cw + cO * sw * ci, Pz = sw * si;
    const Qx = -cO * sw - sO * cw * ci, Qy = -sO * sw + cO * cw * ci, Qz = cw * si;
    const Wx = sO * si, Wy = -cO * si, Wz = ci;
    const { e1, e2, e3 } = this.basis;
    toScene(this._P, Px, Py, Pz, e1, e2, e3);
    toScene(this._Q, Qx, Qy, Qz, e1, e2, e3);
    toScene(this._W, Wx, Wy, Wz, e1, e2, e3);
    return el;
  }

  /** Position relative to the primary, km, scene frame. */
  position(jd, out = new Vector3()) {
    const el = this.update(jd);
    // a more accurate theory (e.g. the Moon) can replace the Keplerian position;
    // the mean ellipse is still used for the orbit line and period
    if (this.positionModel) return this.positionModel(jd, out);
    return this.pointAtE(el.E, out);
  }

  /** Point on the current orbit ellipse at eccentric anomaly E (after update()). */
  pointAtE(E, out = new Vector3()) {
    const { a, e } = this.el;
    const x = a * (Math.cos(E) - e);
    const y = a * Math.sqrt(1 - e * e) * Math.sin(E);
    return out.copy(this._P).multiplyScalar(x).addScaledVector(this._Q, y);
  }

  /** Velocity relative to the primary, km/s. */
  velocity(jd, out = new Vector3()) {
    const el = this.update(jd);
    const { a, e, E } = el;
    const nSec = this.n / 86400;
    const k = (nSec * a) / (1 - e * Math.cos(E));
    return out
      .copy(this._P)
      .multiplyScalar(-Math.sin(E) * k)
      .addScaledVector(this._Q, Math.sqrt(1 - e * e) * Math.cos(E) * k);
  }

  /** Orbit normal (angular momentum direction), scene frame. */
  normal(jd, out = new Vector3()) {
    this.update(jd);
    return out.copy(this._W);
  }

  get periapsis() {
    return this.el.a * (1 - this.el.e);
  }

  get apoapsis() {
    return this.el.a * (1 + this.el.e);
  }
}

function toScene(out, x, y, z, e1, e2, e3) {
  out.set(
    x * e1.x + y * e2.x + z * e3.x,
    x * e1.y + y * e2.y + z * e3.y,
    x * e1.z + y * e2.z + z * e3.z,
  );
}

/**
 * JPL "Keplerian Elements for Approximate Positions of the Major Planets" (E.M. Standish),
 * valid 1800–2050 AD: [a AU, e, I, L, long.peri, long.node] and their rates per century.
 */
export function orbitFromStandish([el, rate]) {
  const [a, e, I, L, peri, node] = el;
  const [da, de, dI, dL, dperi, dnode] = rate;
  const cy = 36525;
  return new Orbit({
    a: a * AU,
    e,
    i: I,
    node,
    w: peri - node,
    M: L - peri,
    n: (dL - dperi) / cy,
    epoch: J2000,
    rates: { a: (da * AU) / cy, e: de / cy, i: dI / cy, node: dnode / cy, w: (dperi - dnode) / cy },
  });
}

/** JPL SBDB osculating elements (ecliptic J2000). a in AU, angles deg, n deg/day. */
export function orbitFromSbdb({ a, e, i, om, w, ma, n, epoch }) {
  return new Orbit({ a: a * AU, e, i, node: om, w, M: ma, n, epoch });
}
