// Planetary rings: flat annulus in the planet's equatorial plane.
// Saturn uses a real radial texture; the other ring systems are generated from ring catalogues.
// The planet's shadow on the rings is computed analytically against the oblate planet.

import * as THREE from 'three';

const vertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vLocal;
varying vec3 vViewPos;
void main() {
  vLocal = position;
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uMap;
uniform float uInner;
uniform float uOuter;
uniform vec3 uColor;
uniform float uUseMapColor;
uniform float uOpacity;
uniform float uBrightness;
uniform vec3 uSunPosV;
uniform float uSunRadius;
uniform vec3 uNormalV;
uniform vec3 uPlanetCenterV;
uniform float uPlanetRe;
uniform float uPlanetRp;
varying vec3 vLocal;
varying vec3 vViewPos;

float planetShadow( vec3 p, vec3 L ) {
  vec3 d = p - uPlanetCenterV;
  float dp = dot( d, uNormalV );
  vec3 ds = ( d - dp * uNormalV ) / uPlanetRe + uNormalV * ( dp / uPlanetRp );
  float lp = dot( L, uNormalV );
  vec3 ls = normalize( ( L - lp * uNormalV ) / uPlanetRe + uNormalV * ( lp / uPlanetRp ) );
  float t = -dot( ds, ls );
  if ( t < 0.0 ) return 1.0;
  float m = length( ds + ls * t );
  float sunAng = uSunRadius / length( uSunPosV - uPlanetCenterV );
  float w = max( sunAng * t, 0.003 );
  return smoothstep( 1.0 - w, 1.0 + w, m );
}

void main() {
  #include <logdepthbuf_fragment>
  float r = length( vLocal.xz );
  float u = ( r - uInner ) / ( uOuter - uInner );
  if ( u < 0.0 || u > 1.0 ) discard;
  vec4 tex = texture2D( uMap, vec2( u, 0.5 ) );
  float alpha = clamp( tex.a * uOpacity, 0.0, 1.0 );
  if ( alpha < 0.002 ) discard;
  vec3 base = mix( uColor, tex.rgb, uUseMapColor );

  vec3 L = normalize( uSunPosV - vViewPos );
  vec3 V = normalize( -vViewPos );
  float nl = dot( uNormalV, L );
  float nv = dot( uNormalV, V );
  // lit face: diffuse reflection; unlit face: light diffusing through gaps / thin parts
  float lit = nl * nv > 0.0 ? mix( 0.45, 1.0, sqrt( abs( nl ) ) ) : 0.6 * ( 1.0 - alpha ) * sqrt( abs( nl ) ) + 0.04;
  // dusty rings scatter strongly forward
  float forward = pow( max( dot( -L, V ), 0.0 ), 8.0 ) * ( 1.0 - uUseMapColor ) * 3.0;
  float shadow = planetShadow( vViewPos, L );
  vec3 col = base * ( lit + forward ) * shadow * uBrightness;
  gl_FragColor = vec4( col, alpha );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Builds a 1D radial opacity profile from a ring catalogue (bands with at/width or from/to, in km). */
function proceduralRingTexture(def) {
  const W = 4096;
  const span = def.outer - def.inner;
  const kmPerTexel = span / W;
  const alpha = new Float32Array(W);
  for (const b of def.bands) {
    const from = b.at !== undefined ? b.at - b.width / 2 : b.from;
    const to = b.at !== undefined ? b.at + b.width / 2 : b.to;
    // area-weighted coverage so sub-texel ringlets keep their integrated brightness
    const x0 = (from - def.inner) / kmPerTexel;
    const x1 = (to - def.inner) / kmPerTexel;
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(W - 1, Math.floor(x1)); x++) {
      const cover = Math.min(x + 1, x1) - Math.max(x, x0);
      if (cover > 0) alpha[x] = 1 - (1 - alpha[x]) * (1 - b.opacity * cover);
    }
  }
  const data = new Uint8Array(W * 4);
  for (let x = 0; x < W; x++) {
    data[x * 4] = data[x * 4 + 1] = data[x * 4 + 2] = 255;
    data[x * 4 + 3] = Math.round(Math.min(1, alpha[x]) * 255);
  }
  const tex = new THREE.DataTexture(data, W, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export function createRings(def, textures, lighting) {
  let map = def.texture ? textures.get(def.texture) : null;
  const useMapColor = Boolean(map);
  if (!map) map = proceduralRingTexture(def);

  const uniforms = {
    uMap: { value: map },
    uInner: { value: def.inner },
    uOuter: { value: def.outer },
    uColor: { value: new THREE.Color(...(def.color ?? [1, 1, 1])) },
    uUseMapColor: { value: useMapColor ? 1 : 0 },
    uOpacity: { value: def.opacity ?? 1 },
    uBrightness: { value: useMapColor ? 1.4 : 1.0 },
    uSunPosV: lighting.uSunPosV,
    uSunRadius: lighting.uSunRadius,
    uNormalV: { value: new THREE.Vector3() },
    uPlanetCenterV: { value: new THREE.Vector3() },
    uPlanetRe: { value: 1 },
    uPlanetRp: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const geometry = new THREE.RingGeometry(def.inner, def.outer, 512, 1);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;

  return {
    mesh,
    map,
    uniforms,
    def,
    update(centerV, normalV, re, rp) {
      uniforms.uPlanetCenterV.value.copy(centerV);
      uniforms.uNormalV.value.copy(normalV);
      uniforms.uPlanetRe.value = re;
      uniforms.uPlanetRp.value = rp;
    },
  };
}
