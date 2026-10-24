// Orbit trail for one body. The line is rebuilt (when visible) starting exactly at the body's
// current position and running backwards along the orbit, with vertices dense near the body and
// expressed relative to it. That keeps the line glued to the body at any zoom level (no chord
// error, no float32 jitter) and gives a fading comet-tail look.
//
// Rebuilding is skipped while the body has moved less than a fraction of a pixel, so hundreds of
// moon orbits stay cheap unless time runs fast.

import * as THREE from 'three';

const TAU = Math.PI * 2;
const _p = new THREE.Vector3();

export class OrbitLine {
  constructor(body, segments) {
    this.body = body;
    this.segments = segments;
    const n = segments + 1;
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
    this.line = new THREE.Line(g, this.material);
    this.line.frustumCulled = false;
    this.line.renderOrder = 1;
    this.line.visible = false;
    const hsl = {};
    body.color.getHSL(hsl);
    // lift dark colours so every orbit stays readable on black
    this.rgb = new THREE.Color().setHSL(hsl.h, Math.min(hsl.s, 0.7), Math.max(hsl.l, 0.55));
    this.built = { opacity: -1, fade: -1, n: 0, version: -1, anchor: new THREE.Vector3(Infinity, 0, 0) };
  }

  hide() {
    this.line.visible = false;
    this.built.opacity = -1;
  }

  /**
   * @param opacity    overall alpha (0 hides)
   * @param toDisplay  null (identity) or fn(trueRelVector) -> display relative vector, in place
   * @param anchor     display-space world position of the orbit's current point
   * @param rel        the body's display offset from its primary (orbital progress)
   * @param fadeRadius segments closer than this to the body fade out (avoids lines across the planet)
   * @param pxSize     apparent orbit radius in pixels (sets the vertex count)
   * @param tolerance  rebuild only if the body moved along its orbit more than this (km)
   * @param version    bump to force a rebuild (scale settings changed)
   */
  update(opacity, toDisplay, anchor, rel, fadeRadius, pxSize, tolerance, version) {
    if (opacity <= 0.003) {
      this.hide();
      return;
    }
    // the primary may move freely: the line just follows the anchor
    this.line.position.copy(anchor);
    this.line.visible = true;
    // quadratic spacing keeps the far end within ~0.25 px of the true ellipse at this density
    const n = Math.min(this.segments, Math.max(48, Math.round(pxSize * 0.4)));
    const b = this.built;
    if (
      version === b.version &&
      n <= b.n * 1.5 && n >= b.n / 1.5 &&
      Math.abs(opacity - b.opacity) < 0.01 &&
      Math.abs(fadeRadius - b.fade) <= fadeRadius * 0.05 &&
      rel.distanceToSquared(b.anchor) < tolerance * tolerance
    ) {
      return;
    }
    b.version = version;
    b.n = n;
    b.opacity = opacity;
    b.fade = fadeRadius;
    b.anchor.copy(rel);

    const orbit = this.body.orbit;
    const { a, e, E: E0 } = orbit.el;
    const bAxis = a * Math.sqrt(1 - e * e);
    const P = orbit._P, Q = orbit._Q;
    const point = (E, out) => {
      const x = a * (Math.cos(E) - e), y = bAxis * Math.sin(E);
      out.set(P.x * x + Q.x * y, P.y * x + Q.y * y, P.z * x + Q.z * y);
      return toDisplay ? toDisplay(out) : out;
    };
    point(E0, _p);
    const x0 = _p.x, y0 = _p.y, z0 = _p.z;
    const pos = this.positions, col = this.colors;
    const { r, g, b: blue } = this.rgb;
    const f4 = fadeRadius * 4;
    for (let k = 0; k <= n; k++) {
      const s = k / n;
      point(E0 - TAU * s * s, _p);
      const dx = _p.x - x0, dy = _p.y - y0, dz = _p.z - z0;
      pos[k * 3] = dx;
      pos[k * 3 + 1] = dy;
      pos[k * 3 + 2] = dz;
      let near = 1;
      if (fadeRadius > 0) {
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        near = d <= fadeRadius ? 0 : d >= f4 ? 1 : THREE.MathUtils.smoothstep(d, fadeRadius, f4);
      }
      const i = k * 4;
      col[i] = r;
      col[i + 1] = g;
      col[i + 2] = blue;
      col[i + 3] = opacity * (1 - 0.82 * s) * near;
    }
    const geom = this.line.geometry;
    geom.setDrawRange(0, n + 1);
    geom.attributes.position.addUpdateRange(0, (n + 1) * 3);
    geom.attributes.color.addUpdateRange(0, (n + 1) * 4);
    geom.attributes.position.needsUpdate = true;
    geom.attributes.color.needsUpdate = true;
  }
}
