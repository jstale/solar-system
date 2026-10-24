// Geocentric position of the Moon from the main periodic terms of ELP-2000/82, as tabulated in
// J. Meeus, "Astronomical Algorithms" ch. 47 (terms truncated at ~0.002°). Accuracy ≈ 0.01°,
// i.e. ~70 km at the Moon's distance – good enough for eclipses to happen on the right dates,
// which mean Keplerian elements (errors > 1°) cannot do.

import { DEG, J2000 } from './constants.js';
import { eclToScene } from './frames.js';

// D, M, M', F, Σl (1e-6 deg), Σr (1e-3 km)
const LR = [
  [0, 0, 1, 0, 6288774, -20905355],
  [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888],
  [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158],
  [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620],
  [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755],
  [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782],
  [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636],
  [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675],
  [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445],
  [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0],
  [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322],
  [2, -2, 0, 0, 2236, -9884],
];

// D, M, M', F, Σb (1e-6 deg)
const B = [
  [0, 0, 0, 1, 5128122],
  [0, 0, 1, 1, 280602],
  [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573],
  [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216],
  [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200],
  [2, 1, 0, -1, -3359],
  [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065],
  [0, 1, -1, -1, -1870],
  [4, 0, -1, -1, 1828],
  [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749],
  [0, 1, -1, 1, -1565],
  [1, 0, 0, 1, -1491],
  [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410],
  [0, 1, 0, -1, -1344],
  [1, 0, 0, -1, -1335],
  [0, 0, 3, 1, 1107],
];

const deg = (x) => (x % 360) * DEG;

/** Moon position relative to Earth, km, scene frame (ecliptic J2000). */
export function lunarPosition(jd, out) {
  const T = (jd - J2000) / 36525;
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  const Lp = deg(218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000);
  const D = deg(297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000);
  const M = deg(357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000);
  const Mp = deg(134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000);
  const F = deg(93.272095 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000);
  const A1 = deg(119.75 + 131.849 * T);
  const A2 = deg(53.09 + 479264.29 * T);
  const A3 = deg(313.45 + 481266.484 * T);
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const ecc = (m) => (m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E);

  let sl = 0, sr = 0, sb = 0;
  for (const [d, m, mp, f, l, r] of LR) {
    const arg = d * D + m * M + mp * Mp + f * F;
    const k = ecc(m);
    sl += l * k * Math.sin(arg);
    sr += r * k * Math.cos(arg);
  }
  for (const [d, m, mp, f, b] of B) {
    sb += b * ecc(m) * Math.sin(d * D + m * M + mp * Mp + f * F);
  }
  sl += 3958 * Math.sin(A1) + 1962 * Math.sin(Lp - F) + 318 * Math.sin(A2);
  sb += -2235 * Math.sin(Lp) + 382 * Math.sin(A3) + 175 * Math.sin(A1 - F) + 175 * Math.sin(A1 + F) + 127 * Math.sin(Lp - Mp) - 115 * Math.sin(Lp + Mp);

  // ecliptic of date -> J2000 (general precession in longitude)
  const lambda = Lp + (sl / 1e6) * DEG - 1.396971 * T * DEG;
  const beta = (sb / 1e6) * DEG;
  const dist = 385000.56 + sr / 1000;
  const cb = Math.cos(beta);
  return eclToScene(dist * cb * Math.cos(lambda), dist * cb * Math.sin(lambda), dist * Math.sin(beta), out);
}
