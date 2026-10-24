// Camera-facing glow billboard (the Sun's corona / bloom). Its size never drops below a
// minimum number of pixels, so the Sun stays visible as a bright star from the outer system.

import * as THREE from 'three';

const vertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uRadius;
uniform float uMinPixels;
uniform float uPixelScale;
varying vec2 vUv;
varying float vPixels;
void main() {
  vec4 mv = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
  float worldPerPixel = max( -mv.z, 1e-6 ) * uPixelScale;
  float size = max( uRadius, uMinPixels * worldPerPixel );
  vPixels = size / worldPerPixel;
  mv.xy += position.xy * size;
  vUv = position.xy;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uIntensity;
uniform float uCore;
varying vec2 vUv;
varying float vPixels;
void main() {
  #include <logdepthbuf_fragment>
  float r = length( vUv );
  if ( r > 1.0 ) discard;
  float halo = pow( 1.0 - r, 2.6 );
  float core = exp( -r * uCore );
  float a = ( 0.55 * halo + core ) * uIntensity;
  gl_FragColor = vec4( uColor * a, 1.0 );
  #include <colorspace_fragment>
}
`;

export function createGlow({ radius, color = 0xffe2b0, minPixels = 40, intensity = 1, core = 9 }) {
  const uniforms = {
    uRadius: { value: radius },
    uMinPixels: { value: minPixels },
    uPixelScale: { value: 1 },
    uColor: { value: new THREE.Color(color) },
    uIntensity: { value: intensity },
    uCore: { value: core },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  return { mesh, uniforms };
}
