// Star background: NASA SVS "Deep Star Maps 2020" in equatorial J2000 coordinates, so the
// constellations and the Milky Way sit exactly where they are in the real sky.

import * as THREE from 'three';
import { equToScene } from '../astro/frames.js';

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 );
  gl_Position = p.xyww;
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uStars;
uniform float uIntensity;
uniform mat3 uSceneToEqu;
varying vec3 vDir;
void main() {
  vec3 d = normalize( uSceneToEqu * vDir );
  float ra = atan( d.y, d.x );
  float dec = asin( clamp( d.z, -1.0, 1.0 ) );
  // map centred on RA 0h, RA increasing to the left (as seen from inside the sphere)
  vec2 uv = vec2( 0.5 - ra / 6.2831853, 0.5 + dec / 3.1415927 );
  // seam-free mip selection: take derivatives from whichever parameterisation is continuous here
  vec2 uvAlt = vec2( fract( uv.x + 0.5 ), uv.y );
  vec2 dx = dFdx( uv ), dy = dFdy( uv );
  vec2 dxAlt = dFdx( uvAlt ), dyAlt = dFdy( uvAlt );
  if ( abs( dx.x ) + abs( dy.x ) > abs( dxAlt.x ) + abs( dyAlt.x ) ) { dx = dxAlt; dy = dyAlt; }
  vec3 c = textureGrad( uStars, uv, dx, dy ).rgb;
  gl_FragColor = vec4( c * uIntensity, 1.0 );
  #include <colorspace_fragment>
}
`;

export function createSky(textures) {
  const map = textures.get('stars');
  // columns of the scene->equatorial rotation
  const ex = equToScene(1, 0, 0), ey = equToScene(0, 1, 0), ez = equToScene(0, 0, 1);
  // equToScene is a rotation R; scene->equ is R^T, whose rows are ex, ey, ez
  const sceneToEqu = new THREE.Matrix3().set(ex.x, ex.y, ex.z, ey.x, ey.y, ey.z, ez.x, ez.y, ez.z);

  const uniforms = {
    uStars: { value: map },
    uIntensity: { value: 1 },
    uSceneToEqu: { value: sceneToEqu },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.visible = Boolean(map);
  return { mesh, uniforms };
}
