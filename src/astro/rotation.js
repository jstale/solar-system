// Body orientation models.
//
// Body-fixed frame -> mesh-local frame: SphereGeometry puts the north pole on +Y and
// longitude 0 (the centre of an equirectangular map) on +X, with east longitudes on -Z.
// So a body-fixed frame (x = prime meridian, y = 90°E, z = north) maps to the mesh as
// local X = x, local Y = z, local Z = -y.

import { Matrix4, Quaternion, Vector3 } from 'three';
import { DEG, J2000 } from './constants.js';
import { equToScene } from './frames.js';

const _m = new Matrix4();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _q = new Vector3();

/** Builds the mesh quaternion from body-fixed axes (scene frame). */
export function quaternionFromAxes(primeMeridian, pole, out) {
  // local Z = -east = primeMeridian x pole
  _z.crossVectors(primeMeridian, pole);
  _m.makeBasis(primeMeridian, pole, _z);
  return out.setFromRotationMatrix(_m);
}

/** IAU WGCCRE rotational elements: alpha0, delta0 (+ rate per century), W (+ deg/day). */
export class IauRotation {
  constructor({ ra, dec, W }) {
    this.ra = ra;
    this.dec = dec;
    this.W = W;
    this.periodHours = Math.abs(360 / W[1]) * 24;
    this.retrograde = W[1] < 0;
  }

  pole(jd, out = new Vector3()) {
    const T = (jd - J2000) / 36525;
    const ra = (this.ra[0] + (this.ra[1] ?? 0) * T) * DEG;
    const dec = (this.dec[0] + (this.dec[1] ?? 0) * T) * DEG;
    return equToScene(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec), out);
  }

  quaternion(jd, out = new Quaternion()) {
    const d = jd - J2000;
    const T = d / 36525;
    const ra = (this.ra[0] + (this.ra[1] ?? 0) * T) * DEG;
    const dec = (this.dec[0] + (this.dec[1] ?? 0) * T) * DEG;
    const W = ((this.W[0] + this.W[1] * d) % 360) * DEG;
    const cr = Math.cos(ra), sr = Math.sin(ra), cd = Math.cos(dec), sd = Math.sin(dec);
    // pole p, node q = z x p (normalised), and p x q, all equatorial
    const px = cd * cr, py = cd * sr, pz = sd;
    const qx = -sr, qy = cr, qz = 0;
    const rx = -sd * cr, ry = -sd * sr, rz = cd;
    const cW = Math.cos(W), sW = Math.sin(W);
    equToScene(cW * qx + sW * rx, cW * qy + sW * ry, cW * qz + sW * rz, _x);
    equToScene(px, py, pz, _y);
    return quaternionFromAxes(_x, _y, out);
  }
}

/** Uniform spin about a fixed pole given in scene coordinates. */
export class SimpleRotation {
  constructor({ pole, periodHours, W0 = 0 }) {
    this.polVec = pole.clone().normalize();
    this.periodHours = Math.abs(periodHours);
    this.rate = (360 / (periodHours / 24)) * DEG; // rad/day, sign = direction
    this.retrograde = periodHours < 0;
    this.W0 = W0 * DEG;
    // node direction: any vector perpendicular to the pole
    _q.set(0, 1, 0).cross(this.polVec);
    if (_q.lengthSq() < 1e-8) _q.set(1, 0, 0);
    this.node = _q.clone().normalize();
    this.node90 = new Vector3().crossVectors(this.polVec, this.node);
  }

  pole(_jd, out = new Vector3()) {
    return out.copy(this.polVec);
  }

  quaternion(jd, out = new Quaternion()) {
    const W = this.W0 + this.rate * (jd - J2000);
    _x.copy(this.node).multiplyScalar(Math.cos(W)).addScaledVector(this.node90, Math.sin(W));
    return quaternionFromAxes(_x, this.polVec, out);
  }
}

/**
 * Synchronous rotation: prime meridian always faces the primary, pole = orbit normal.
 * Needs the body's current relative position, so the Body drives it.
 */
export class TidalLock {
  constructor(orbit) {
    this.orbit = orbit;
    this.periodHours = orbit.periodDays * 24;
    this.retrograde = false;
  }

  pole(jd, out = new Vector3()) {
    return this.orbit.normal(jd, out);
  }

  quaternion(jd, out = new Quaternion(), relPos) {
    this.orbit.normal(jd, _y);
    _x.copy(relPos).negate().normalize();
    // keep exactly orthogonal to the pole
    _x.addScaledVector(_y, -_x.dot(_y)).normalize();
    return quaternionFromAxes(_x, _y, out);
  }
}
