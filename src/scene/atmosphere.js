// Analytic single-scattering-style atmosphere shell.
//
// For each pixel the view ray is intersected with the planet analytically; optical depth uses
// the Chapman grazing-incidence approximation for an exponential atmosphere with scale height H:
//   tau(limb, impact parameter h) ≈ tau_vertical * sqrt(2πh/H) * exp(-(h-R)/H)
// Real scale heights are used, so at true scale Earth gets the thin blue limb seen from orbit.
// Oblate planets are handled by doing the maths in a space where the polar axis is stretched
// so the planet becomes a sphere of its equatorial radius.

import * as THREE from 'three';

const vertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vViewPos;
void main() {
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uCenterV;
uniform vec3 uSunDirV;
uniform float uRp;
uniform float uH;
uniform float uRa;
uniform vec3 uTau;
uniform float uIntensity;
uniform vec3 uAlbedo; // single-scattering albedo: what a thick haze saturates to
uniform mat3 uToSphere; // view space -> body space with the polar axis stretched (oblate planet -> sphere)
varying vec3 vViewPos;

void main() {
  #include <logdepthbuf_fragment>
  vec3 dir = normalize( uToSphere * vViewPos );
  vec3 center = uToSphere * uCenterV;
  vec3 sunDir = normalize( uToSphere * uSunDirV );
  float camR = length( center );
  float grazing = sqrt( 6.2831853 * uRp / uH );
  float depth;
  float hitsGround = 0.0;
  vec3 sampleN;
  if ( camR > uRa ) {
    float tc = dot( center, dir );
    if ( tc <= 0.0 ) discard;
    vec3 closest = dir * tc - center;
    float h = length( closest );
    if ( h < uRp ) {
      float th = tc - sqrt( uRp * uRp - h * h );
      sampleN = normalize( dir * th - center );
      float mu = max( dot( sampleN, -dir ), 0.0 );
      depth = min( 1.0 / max( mu, 1e-4 ), 0.5 * grazing );
      hitsGround = 1.0;
    } else {
      sampleN = closest / h;
      depth = sqrt( 6.2831853 * h / uH ) * exp( -( h - uRp ) / uH );
    }
  } else {
    vec3 up = -center / camR;
    float mu = dot( dir, up );
    float rho = exp( -( camR - uRp ) / uH );
    depth = rho * min( 1.0 / max( abs( mu ), 1e-3 ), grazing );
    hitsGround = step( mu, 0.0 );
    sampleN = up;
  }
  float sunDot = dot( sampleN, sunDir );
  float day = smoothstep( -0.22, 0.25, sunDot );
  vec3 tau = uTau * depth;
  vec3 scatter = 1.0 - exp( -tau );
  vec3 twilight = mix( vec3( 1.0, 0.5, 0.25 ), vec3( 1.0 ), smoothstep( -0.05, 0.3, sunDot ) );
  // looking down into the haze, brightness follows the local sun elevation
  float shade = mix( 1.0, clamp( sunDot * 1.3 + 0.1, 0.0, 1.0 ), hitsGround );
  vec3 col = scatter * uAlbedo * twilight * day * shade * uIntensity;
  // extinction of whatever lies behind (premultiplied blending)
  float ext = hitsGround * ( 1.0 - exp( -( tau.r + tau.g + tau.b ) / 3.0 ) );
  gl_FragColor = vec4( col, ext );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const _m4 = new THREE.Matrix4();
const _m3 = new THREE.Matrix3();
const _v = new THREE.Vector3();

export function createAtmosphere(def) {
  const uniforms = {
    uCenterV: { value: new THREE.Vector3() },
    uSunDirV: { value: new THREE.Vector3() },
    uRp: { value: 1 },
    uH: { value: def.scaleHeight },
    uRa: { value: 1 },
    uTau: { value: new THREE.Vector3(...def.tau) },
    uIntensity: { value: def.intensity ?? 1 },
    uAlbedo: { value: new THREE.Vector3(...(def.albedo ?? [1, 1, 1])) },
    uToSphere: { value: new THREE.Matrix3() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    side: THREE.FrontSide,
  });
  const segments = 96;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, segments, segments / 2), material);
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  // optical depth at the shell edge must be negligible
  const tauMax = Math.max(...def.tau) * Math.sqrt(2 * Math.PI * 1000);
  const shellHeights = Math.max(6, Math.log(tauMax / 0.003));
  // circumscribe the polygonal sphere around the analytic shell
  const circumscribe = 1 / Math.cos(Math.PI / segments);

  return {
    mesh,
    uniforms,
    /**
     * The mesh lives in the body's rotating frame (local units = true km).
     * @param radii      true triaxial radii (local X, Y = pole, Z)
     * @param scale      display size multiplier
     * @param bodyToView rotation matrix (Matrix4) body-local -> view
     */
    update(centerV, sunDirV, radii, scale, bodyToView) {
      const Re = radii.x;
      const stretch = radii.x / radii.y;
      const H = def.scaleHeight;
      const Ra = Re + H * shellHeights;
      uniforms.uCenterV.value.copy(centerV);
      uniforms.uSunDirV.value.copy(sunDirV);
      uniforms.uRp.value = Re * scale;
      uniforms.uH.value = H * scale;
      uniforms.uRa.value = Ra * scale;
      // view -> body (transpose of the rotation), then stretch the polar axis
      _m3.setFromMatrix4(_m4.copy(bodyToView)).transpose();
      const e = _m3.elements; // column-major: row 1 = elements 1, 4, 7
      e[1] *= stretch;
      e[4] *= stretch;
      e[7] *= stretch;
      uniforms.uToSphere.value.copy(_m3);
      const k = (Ra / Re) * circumscribe;
      mesh.scale.set(radii.x * k, radii.y * k, radii.z * k);
      const camR = _v.copy(centerV).applyMatrix3(_m3).length();
      material.side = camR < Ra * scale * circumscribe ? THREE.BackSide : THREE.FrontSide;
    },
  };
}
