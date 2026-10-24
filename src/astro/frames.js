// Coordinate frames.
//
// Scene frame = ecliptic J2000, Y-up:
//   scene.x =  ecliptic x (towards the March equinox)
//   scene.y =  ecliptic z (ecliptic north)
//   scene.z = -ecliptic y
// Units are kilometres, origin at the Sun.

import { Vector3 } from 'three';
import { DEG, OBLIQUITY_J2000 } from './constants.js';

const cosE = Math.cos(OBLIQUITY_J2000);
const sinE = Math.sin(OBLIQUITY_J2000);

export function eclToScene(x, y, z, out = new Vector3()) {
  return out.set(x, z, -y);
}

/** ICRF / equatorial J2000 -> scene */
export function equToScene(x, y, z, out = new Vector3()) {
  const ye = cosE * y + sinE * z;
  const ze = -sinE * y + cosE * z;
  return out.set(x, ze, -ye);
}

/** scene -> ICRF / equatorial J2000, returns [x, y, z] */
export function sceneToEqu(v) {
  const xe = v.x, ye = -v.z, ze = v.y;
  return [xe, cosE * ye - sinE * ze, sinE * ye + cosE * ze];
}

export function raDecToEqu(raDeg, decDeg) {
  const ra = raDeg * DEG, dec = decDeg * DEG;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
}

export function raDecToScene(raDeg, decDeg, out = new Vector3()) {
  const [x, y, z] = raDecToEqu(raDeg, decDeg);
  return equToScene(x, y, z, out);
}

/**
 * Basis of an orbital reference plane given its pole (equatorial unit vector).
 * x-axis = ascending node of the plane on the ICRF equator (JPL convention for
 * satellite mean elements); for the ecliptic this is the equinox.
 * Returned vectors are in scene coordinates.
 */
export function referenceBasisFromPole(pole) {
  let nx = -pole[1], ny = pole[0]; // z_hat x pole
  const len = Math.hypot(nx, ny);
  if (len < 1e-9) { nx = 1; ny = 0; } else { nx /= len; ny /= len; }
  const n = [nx, ny, 0];
  const m = [pole[1] * n[2] - pole[2] * n[1], pole[2] * n[0] - pole[0] * n[2], pole[0] * n[1] - pole[1] * n[0]];
  return {
    e1: equToScene(n[0], n[1], n[2]),
    e2: equToScene(m[0], m[1], m[2]),
    e3: equToScene(pole[0], pole[1], pole[2]),
  };
}

export const ECLIPTIC_BASIS = {
  e1: new Vector3(1, 0, 0),
  e2: new Vector3(0, 0, -1),
  e3: new Vector3(0, 1, 0),
};

export const ECLIPTIC_POLE_EQU = [0, -sinE, cosE];
