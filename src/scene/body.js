// A celestial body: physical data, orbit/rotation models and its three.js visuals.
//
// Hierarchy:  root (position, unrotated)
//               ├─ frame (body-fixed rotation, uniform display scale)
//               │    ├─ mesh   (unit sphere scaled to the triaxial radii in km)
//               │    ├─ clouds
//               │    └─ rings  (equatorial plane)
//               ├─ atmosphere shell
//               └─ glow (Sun)

import * as THREE from 'three';
import { createLightingUniforms, extendBodyMaterial } from './materials.js';
import { createAtmosphere } from './atmosphere.js';
import { createRings } from './rings.js';
import { createGlow } from './glow.js';
import { sphere, lumpyGeometry } from './geometry.js';
import { TidalLock } from '../astro/rotation.js';

export const KIND_LABEL = {
  star: 'Star',
  planet: 'Planet',
  dwarf: 'Dwarf planet',
  moon: 'Moon',
  asteroid: 'Asteroid',
  comet: 'Comet',
};

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Matrix4();
const Y = new THREE.Vector3(0, 1, 0);

const sunVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewPos;
void main() {
  vUv = uv;
  vNormalV = normalize( normalMatrix * normal );
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const sunFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uMap;
uniform float uHasMap;
uniform float uBrightness;
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewPos;
void main() {
  #include <logdepthbuf_fragment>
  vec3 c = mix( vec3( 1.0, 0.8, 0.45 ), texture2D( uMap, vUv ).rgb, uHasMap );
  float mu = max( dot( normalize( vNormalV ), normalize( -vViewPos ) ), 0.0 );
  // photospheric limb darkening (quadratic law, visible light)
  float limb = 1.0 - 0.47 * ( 1.0 - mu ) - 0.23 * ( 1.0 - mu ) * ( 1.0 - mu );
  vec3 col = c * limb * uBrightness * vec3( 1.25, 1.12, 1.0 );
  gl_FragColor = vec4( col, 1.0 );
  #include <colorspace_fragment>
}
`;

export class Body {
  constructor(def, { orbit = null, rotation = null } = {}) {
    this.def = def;
    this.name = def.name;
    this.kind = def.kind;
    this.radius = def.radius;
    const r = def.radii ?? [def.radius, def.radius, def.radius];
    this.radii = new THREE.Vector3(...r);
    this.maxRadius = Math.max(...r);
    this.color = new THREE.Color(def.color ?? '#9a9a9a');
    this.orbit = orbit;
    this.rotation = rotation;
    this.parent = null;
    this.children = [];
    this.description = def.description ?? '';

    // barycentric partner (Earth–Moon, Pluto–Charon): set up by the system
    this.bary = null;
    this.orbitsBarycentre = false;

    // state (km). true* = physical, the rest = display space (after scale settings)
    this.trueRel = new THREE.Vector3();
    this.truePos = new THREE.Vector3();
    this.trueBaryPos = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.baryPos = new THREE.Vector3();
    this.displayRel = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.sizeScale = 1;
    this.displayRadius = this.radius;

    // screen-space info, filled by the system each frame
    this.screen = { x: 0, y: 0, px: 0, depth: 0, inFront: false, onScreen: false };

    this.root = new THREE.Group();
    this.root.name = this.name;
    this.frame = new THREE.Group();
    this.root.add(this.frame);
    this.lighting = createLightingUniforms();
    this.textureSlots = [];
    this.hiRes = false;
    this.mesh = null;
    this.clouds = null;
    this.rings = null;
    this.atmosphere = null;
    this.glow = null;
    this.orbitLine = null;
  }

  get isMoon() {
    return this.kind === 'moon';
  }

  // ---------------------------------------------------------------- visuals

  build(textures) {
    const def = this.def;
    const tex = def.textures ?? {};

    if (this.kind === 'star') {
      const map = textures.get(tex.map);
      this.sunUniforms = {
        uMap: { value: map },
        uHasMap: { value: map ? 1 : 0 },
        uBrightness: { value: 2.1 },
      };
      const mat = new THREE.ShaderMaterial({ uniforms: this.sunUniforms, vertexShader: sunVertex, fragmentShader: sunFragment });
      this.mesh = new THREE.Mesh(sphere(128), mat);
      this.mesh.scale.copy(this.radii);
      this.frame.add(this.mesh);
      this.addSlot(tex.map, true, (t) => (this.sunUniforms.uMap.value = t));
      this.glow = createGlow({ radius: this.radius * 6, minPixels: 46, intensity: 1.15 });
      this.root.add(this.glow.mesh);
      return;
    }

    const geometry =
      this.maxRadius >= 1000 ? sphere(128) : this.maxRadius >= 150 ? sphere(64) : lumpyGeometry(this.name);
    const mapName = tex.map ?? tex.generic;
    const map = textures.get(mapName);
    const material = new THREE.MeshStandardMaterial({
      map,
      color: map ? new THREE.Color(...(tex.tint ?? [1, 1, 1])) : this.color,
      roughness: 1,
      metalness: 0,
    });
    if (tex.map) this.addSlot(tex.map, true, (t) => (material.map = t));

    const features = { ringShadow: Boolean(def.rings), earth: def.material === 'earth' };
    const lighting = this.lighting;

    if (features.earth) {
      material.emissive = new THREE.Color(1.0, 0.82, 0.55);
      material.emissiveIntensity = 1.6;
      material.emissiveMap = textures.get(tex.night);
      material.normalMap = textures.get(tex.normal, { color: false });
      material.normalScale = new THREE.Vector2(0.9, 0.9);
      material.roughnessMap = textures.get(tex.specular, { color: false });
      lighting.uCloudMap = { value: textures.get(tex.clouds, { color: false }) };
      lighting.uCloudOffset = { value: 0 };
      lighting.uCloudShadow = { value: 0.45 };
      lighting.uNightLights = { value: 1 };
      this.addSlot(tex.night, true, (t) => (material.emissiveMap = t));
      this.addSlot(tex.normal, false, (t) => (material.normalMap = t));
      this.addSlot(tex.specular, false, (t) => (material.roughnessMap = t));
    }

    if (def.rings) {
      this.rings = createRings(def.rings, textures, lighting);
      this.frame.add(this.rings.mesh);
      lighting.uRingCenterV = { value: new THREE.Vector3() };
      lighting.uRingNormalV = { value: new THREE.Vector3() };
      lighting.uRingInner = { value: def.rings.inner };
      lighting.uRingOuter = { value: def.rings.outer };
      lighting.uRingMap = { value: this.rings.map };
      if (def.rings.texture) {
        this.addSlot(def.rings.texture, true, (t) => {
          this.rings.uniforms.uMap.value = t;
          lighting.uRingMap.value = t;
        });
      }
    }

    extendBodyMaterial(material, lighting, features);
    this.material = material;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.scale.copy(this.radii);
    this.frame.add(this.mesh);

    if (def.clouds && tex.clouds) {
      const c = def.clouds;
      const cloudTex = textures.get(tex.clouds, { color: !features.earth });
      const cloudMat = c.opaque
        ? new THREE.MeshStandardMaterial({ map: cloudTex, roughness: 1, metalness: 0 })
        : new THREE.MeshStandardMaterial({
            color: 0xffffff,
            alphaMap: cloudTex,
            transparent: true,
            depthWrite: false,
            roughness: 1,
            metalness: 0,
          });
      extendBodyMaterial(cloudMat, lighting, {});
      this.clouds = new THREE.Mesh(sphere(128), cloudMat);
      this.clouds.scale.copy(this.radii).multiplyScalar(1 + c.height / this.radius);
      this.clouds.renderOrder = 1;
      this.cloudRate = (Math.PI * 2) / (c.periodHours / 24); // rad/day relative to inertial space
      this.frame.add(this.clouds);
      if (features.earth) {
        this.addSlot(tex.clouds, false, (t) => {
          cloudMat.alphaMap = t;
          lighting.uCloudMap.value = t;
        });
      } else {
        this.addSlot(tex.clouds, true, (t) => (cloudMat.map = t));
      }
    }

    if (def.atmosphere) {
      this.atmosphere = createAtmosphere(def.atmosphere);
      this.frame.add(this.atmosphere.mesh);
    }
  }

  addSlot(name, color, apply) {
    if (!name) return;
    this.textureSlots.push({ name, color, apply, lo: null });
  }

  /** Swap between default and hi-res textures. */
  setHiRes(on, textures) {
    if (on === this.hiRes) return;
    this.hiRes = on;
    for (const slot of this.textureSlots) {
      if (!textures.hasHi(slot.name)) continue;
      if (on) {
        const request = textures.acquireHi(slot.name, { color: slot.color });
        slot.request = request;
        // only apply if this is still the current request (it may have been released meanwhile)
        request.then((t) => slot.request === request && slot.apply(t), () => {});
      } else {
        slot.request = null;
        slot.apply(textures.get(slot.name, { color: slot.color }));
        textures.releaseHi(slot.name, { color: slot.color });
      }
    }
  }

  // ---------------------------------------------------------------- per frame

  updateRotation(jd) {
    if (!this.rotation) return;
    if (this.rotation instanceof TidalLock) this.rotation.quaternion(jd, this.quaternion, this.trueRel);
    else this.rotation.quaternion(jd, this.quaternion);
  }

  /** Called after positions, camera and screen metrics are up to date. */
  updateVisual(ctx) {
    const { viewMatrix, settings, jd } = ctx;
    this.root.position.copy(this.pos);
    this.frame.quaternion.copy(this.quaternion);
    this.frame.scale.setScalar(this.sizeScale);

    const px = this.screen.px;
    const visible = this.screen.inFront && px > 0.3;
    this.frame.visible = visible;
    if (this.glow) {
      this.glow.mesh.visible = settings.sunGlow;
      this.glow.uniforms.uRadius.value = this.displayRadius * 6;
      this.glow.uniforms.uPixelScale.value = ctx.pixelScale;
    }
    if (this.atmosphere) this.atmosphere.mesh.visible = visible && px > 1.5 && settings.atmospheres;
    if (!visible || this.kind === 'star') return;

    const L = this.lighting;
    L.uSunPosV.value.copy(ctx.sunV);
    L.uSunRadius.value = ctx.sunRadius;

    // centre and pole in view space
    const centerV = _v.copy(this.pos).applyMatrix4(viewMatrix);
    const poleV = _n.copy(Y).applyQuaternion(this.quaternion).transformDirection(viewMatrix);

    if (this.rings) {
      const s = this.sizeScale;
      this.rings.mesh.visible = settings.rings;
      this.rings.update(centerV, poleV, this.radii.x * s, this.radii.y * s);
      L.uRingCenterV.value.copy(centerV);
      L.uRingNormalV.value.copy(poleV);
      L.uRingInner.value = this.def.rings.inner * s;
      L.uRingOuter.value = (settings.rings ? this.def.rings.outer : this.def.rings.inner + 1e-3) * s;
    }

    if (this.clouds) {
      this.clouds.visible = settings.clouds;
      // cloud deck drifts relative to the surface
      const bodyRate = this.rotation ? (Math.PI * 2) / (this.rotation.periodHours / 24) * (this.rotation.retrograde ? -1 : 1) : 0;
      const angle = ((this.cloudRate - bodyRate) * (jd - 2451545.0)) % (Math.PI * 2);
      this.clouds.rotation.y = angle;
      if (L.uCloudOffset) {
        L.uCloudOffset.value = -angle / (Math.PI * 2);
        L.uCloudShadow.value = settings.clouds ? 0.45 : 0;
      }
    }
    if (L.uNightLights) L.uNightLights.value = settings.nightLights;

    if (this.atmosphere && this.atmosphere.mesh.visible) {
      const sunDirV = ctx.tmp.copy(ctx.sunV).sub(centerV).normalize();
      _m.makeRotationFromQuaternion(this.quaternion).premultiply(viewMatrix);
      this.atmosphere.update(centerV, sunDirV, this.radii, this.sizeScale, _m);
    }
  }
}
