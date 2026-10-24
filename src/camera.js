// Orbit camera that follows the focused body and flies between bodies.
// Distances span ~10 km to ~10^11 km, so zoom and transitions work in log space.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, dom);
    Object.assign(this.controls, {
      enableDamping: true,
      dampingFactor: 0.07,
      enablePan: false,
      rotateSpeed: 0.45,
      zoomSpeed: 1.4,
      maxDistance: 2e11,
    });
    this.focus = null;
    this.lastFocusPos = new THREE.Vector3();
    this.transition = null;
    this._dir = new THREE.Vector3();
    this._qt = new THREE.Quaternion();
  }

  /** Comfortable viewing distance for a body (display space). */
  defaultDistance(body) {
    if (body.kind === 'star') return body.displayRadius * 9;
    let d = body.displayRadius * 4.2;
    if (body.def.rings?.texture) d = body.def.rings.outer * body.sizeScale * 2.6;
    return d;
  }

  minDistance(body) {
    return Math.max(body.displayRadius * 1.003 + 0.002, 0.005);
  }

  /**
   * @param body  target
   * @param opts  { distance, duration (s), instant, sun (Body) – to arrive on the day side }
   */
  flyTo(body, opts = {}) {
    const cam = this.camera;
    const controls = this.controls;
    const toDist = opts.distance ?? this.defaultDistance(body);
    if (opts.instant || !this.focus) {
      this.focus = body;
      const dir = opts.direction ?? this.arrivalDirection(body, opts.sun, new THREE.Vector3(0.3, 0.25, 1).normalize());
      cam.position.copy(body.pos).addScaledVector(dir, toDist);
      controls.target.copy(body.pos);
      this.lastFocusPos.copy(body.pos);
      controls.update();
      return;
    }
    // the rest is set up on the next update(), once body positions are current
    // (the clock may have jumped in the same tick)
    this.transition = { pending: true, from: this.focus, to: body, opts, toDist, t: 0 };
    this.focus = body;
    controls.enabled = false;
  }

  _startTransition(tr) {
    const { from, to: body, opts, toDist } = tr;
    const startDir = this._dir.copy(this.camera.position).sub(this.controls.target);
    const fromDist = startDir.length();
    startDir.normalize();
    const endDir = opts.direction ? opts.direction.clone().normalize() : this.arrivalDirection(body, opts.sun, startDir);
    const travel = from.pos.distanceTo(body.pos);
    // swing out far enough to see where we are going
    const peak = Math.max(fromDist, toDist, travel * 0.55);
    Object.assign(tr, {
      pending: false,
      fromOffset: this.controls.target.clone().sub(from.pos),
      q0: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), startDir),
      q1: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), endDir),
      logFrom: Math.log(fromDist),
      logPeak: Math.log(peak),
      logTo: Math.log(toDist),
      hasPeak: peak > Math.max(fromDist, toDist) * 1.5,
      duration: opts.duration ?? (travel > toDist * 50 ? 3.2 : 1.6),
    });
  }

  /** Direction from the body to the camera: mostly toward the Sun, at a pleasant 3/4 angle. */
  arrivalDirection(body, sun, fallback) {
    if (!sun || body === sun) return fallback.clone();
    const toSun = sun.pos.clone().sub(body.pos).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(up, toSun);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    return toSun.multiplyScalar(Math.cos(0.75)).addScaledVector(side, Math.sin(0.75)).addScaledVector(up, 0.3).normalize();
  }

  update(dt) {
    const cam = this.camera;
    const controls = this.controls;
    const focus = this.focus;
    if (!focus) return;
    controls.minDistance = this.minDistance(focus);

    const tr = this.transition;
    if (tr) {
      if (tr.pending) {
        // keep the old target glued to the body it was on while the clock jumped
        this.controls.target.add(this._dir.copy(tr.from.pos).sub(this.lastFocusPos));
        this.camera.position.add(this._dir);
        this._startTransition(tr);
      }
      tr.t = Math.min(1, tr.t + dt / tr.duration);
      const k = ease(tr.t);
      const fromPoint = this._dir.copy(tr.from.pos).add(tr.fromOffset);
      const target = fromPoint.lerp(tr.to.pos, ease(Math.min(1, tr.t * 1.15)));
      let logD;
      if (tr.hasPeak) {
        logD = tr.t < 0.5
          ? THREE.MathUtils.lerp(tr.logFrom, tr.logPeak, ease(tr.t * 2))
          : THREE.MathUtils.lerp(tr.logPeak, tr.logTo, ease(tr.t * 2 - 1));
      } else {
        logD = THREE.MathUtils.lerp(tr.logFrom, tr.logTo, k);
      }
      this._qt.slerpQuaternions(tr.q0, tr.q1, k);
      const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(this._qt);
      controls.target.copy(target);
      cam.position.copy(target).addScaledVector(dir, Math.exp(logD));
      cam.lookAt(target);
      if (tr.t >= 1) {
        this.transition = null;
        controls.enabled = true;
        controls.update();
      }
      this.lastFocusPos.copy(focus.pos);
      return;
    }

    // follow the focused body
    const delta = this._dir.copy(focus.pos).sub(this.lastFocusPos);
    cam.position.add(delta);
    controls.target.copy(focus.pos);
    this.lastFocusPos.copy(focus.pos);
    // keep the camera outside the (possibly rescaled) body
    const d = cam.position.distanceTo(controls.target);
    if (d < controls.minDistance) {
      cam.position.sub(controls.target).setLength(controls.minDistance).add(controls.target);
    }
    controls.update(dt);
  }

  /** Zoom by a factor (keyboard / buttons). */
  zoom(factor) {
    if (this.transition) return;
    const off = this.camera.position.clone().sub(this.controls.target);
    const len = THREE.MathUtils.clamp(off.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.copy(this.controls.target).addScaledVector(off.normalize(), len);
  }

  distance() {
    return this.camera.position.distanceTo(this.controls.target);
  }
}
