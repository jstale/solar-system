// Extends MeshStandardMaterial with:
//   - eclipse shadows: penumbral shadows cast by up to MAX_OCC nearby spheres (moon shadows on
//     planets, planet shadows on moons), computed analytically from the overlap of the Sun's
//     disc and the occluder's disc as seen from each fragment
//   - ring shadows on the planet (Saturn)
//   - Earth: city lights on the night side, ocean glint from the specular map, cloud shadows
//
// All positions are in view space so precision holds at any distance from the Sun.

import * as THREE from 'three';

export const MAX_OCC = 4;

export function createLightingUniforms() {
  return {
    uSunPosV: { value: new THREE.Vector3() },
    uSunRadius: { value: 695700 },
    uOcc: { value: Array.from({ length: MAX_OCC }, () => new THREE.Vector4()) },
    uOccRefract: { value: new Array(MAX_OCC).fill(0) },
    uOccCount: { value: 0 },
  };
}

const COMMON_GLSL = /* glsl */ `
#define MAX_OCC ${MAX_OCC}
uniform vec3 uSunPosV;
uniform float uSunRadius;
uniform vec4 uOcc[ MAX_OCC ];
uniform float uOccRefract[ MAX_OCC ]; // 1 = occluder's atmosphere bends reddened light into its umbra
uniform int uOccCount;

// fraction of the Sun's disc (angular radius rs) hidden by a disc of radius ro at separation d
float sunDiskOverlap( float rs, float ro, float d ) {
  if ( d >= rs + ro ) return 0.0;
  if ( d <= abs( rs - ro ) ) return ro >= rs ? 1.0 : ( ro * ro ) / ( rs * rs );
  float rs2 = rs * rs, ro2 = ro * ro, d2 = d * d;
  float a1 = acos( clamp( ( d2 + rs2 - ro2 ) / ( 2.0 * d * rs ), -1.0, 1.0 ) );
  float a2 = acos( clamp( ( d2 + ro2 - rs2 ) / ( 2.0 * d * ro ), -1.0, 1.0 ) );
  float area = rs2 * ( a1 - 0.5 * sin( 2.0 * a1 ) ) + ro2 * ( a2 - 0.5 * sin( 2.0 * a2 ) );
  return clamp( area / ( PI * rs2 ), 0.0, 1.0 );
}

vec3 eclipseLight( vec3 p ) {
  vec3 toSun = uSunPosV - p;
  float dSun = length( toSun );
  vec3 sDir = toSun / dSun;
  float rs = asin( clamp( uSunRadius / dSun, 0.0, 1.0 ) );
  vec3 light = vec3( 1.0 );
  for ( int k = 0; k < MAX_OCC; k ++ ) {
    if ( k >= uOccCount ) break;
    vec3 toOcc = uOcc[ k ].xyz - p;
    float dOcc = length( toOcc );
    if ( dOcc >= dSun || dOcc <= uOcc[ k ].w ) continue;
    vec3 oDir = toOcc / dOcc;
    float c = dot( sDir, oDir );
    if ( c <= 0.0 ) continue;
    float ro = asin( uOcc[ k ].w / dOcc );
    float sep = atan( length( cross( sDir, oDir ) ), c );
    float f = sunDiskOverlap( rs, ro, sep );
    // "blood moon": sunlight refracted through the occluder's atmosphere fills the umbra
    // (exaggerated ~1000x, like a photo exposed for the eclipse)
    light *= vec3( 1.0 - f ) + uOccRefract[ k ] * f * vec3( 0.3, 0.085, 0.03 );
  }
  return light;
}

#ifdef RING_SHADOW
uniform vec3 uRingCenterV;
uniform vec3 uRingNormalV;
uniform float uRingInner;
uniform float uRingOuter;
uniform sampler2D uRingMap;

float ringShadowLight( vec3 p ) {
  vec3 L = normalize( uSunPosV - p );
  float denom = dot( L, uRingNormalV );
  if ( abs( denom ) < 1e-6 ) return 1.0;
  float t = dot( uRingCenterV - p, uRingNormalV ) / denom;
  if ( t <= 0.0 ) return 1.0;
  float r = length( p + L * t - uRingCenterV );
  float u = ( r - uRingInner ) / ( uRingOuter - uRingInner );
  if ( u <= 0.0 || u >= 1.0 ) return 1.0;
  return 1.0 - 0.92 * texture2D( uRingMap, vec2( u, 0.5 ) ).a;
}
#endif

#ifdef EARTH
uniform sampler2D uCloudMap;
uniform float uCloudOffset;
uniform float uCloudShadow;
uniform float uNightLights;
#endif

vec3 bodyLight( vec3 p ) {
  vec3 l = eclipseLight( p );
  #ifdef RING_SHADOW
    l *= ringShadowLight( p );
  #endif
  #if defined( EARTH ) && defined( USE_MAP )
    l *= 1.0 - uCloudShadow * texture2D( uCloudMap, vec2( vMapUv.x + uCloudOffset, vMapUv.y ) ).r;
  #endif
  return l;
}
`;

const EARTH_EMISSIVE = /* glsl */ `
#ifdef USE_EMISSIVEMAP
  vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
  vec3 sunDirE = normalize( uSunPosV + vViewPosition );
  float nightMask = smoothstep( 0.05, -0.18, dot( normalize( vNormal ), sunDirE ) );
  float cloudCover = texture2D( uCloudMap, vec2( vEmissiveMapUv.x + uCloudOffset, vEmissiveMapUv.y ) ).r;
  totalEmissiveRadiance *= emissiveColor.rgb * nightMask * ( 1.0 - 0.7 * cloudCover ) * uNightLights;
#endif
`;

const EARTH_ROUGHNESS = /* glsl */ `
float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
  float specMask = texture2D( roughnessMap, vRoughnessMapUv ).r;
  roughnessFactor = mix( 0.95, 0.45, specMask );
#endif
`;

const lightsChunk = THREE.ShaderChunk.lights_fragment_begin.replace(
  'getPointLightInfo( pointLight, geometryPosition, directLight );',
  'getPointLightInfo( pointLight, geometryPosition, directLight );\n\t\tdirectLight.color *= bodyLight( geometryPosition );',
);
if (lightsChunk === THREE.ShaderChunk.lights_fragment_begin) {
  console.warn('three.js shader chunk changed: eclipse shadows disabled');
}

/**
 * @param material MeshStandardMaterial
 * @param uniforms object from createLightingUniforms() (+ ring / earth uniforms), shared and updated per frame
 * @param features { ringShadow?: boolean, earth?: boolean }
 */
export function extendBodyMaterial(material, uniforms, features = {}) {
  material.defines = material.defines ?? {};
  if (features.ringShadow) material.defines.RING_SHADOW = '';
  if (features.earth) material.defines.EARTH = '';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    // declarations go right before main() so varyings like vMapUv are already declared
    let fs = shader.fragmentShader
      .replace('void main() {', `${COMMON_GLSL}\nvoid main() {`)
      .replace('#include <lights_fragment_begin>', lightsChunk);
    if (features.earth) {
      fs = fs.replace('#include <emissivemap_fragment>', EARTH_EMISSIVE).replace('#include <roughnessmap_fragment>', EARTH_ROUGHNESS);
    }
    shader.fragmentShader = fs;
  };
  const key = `body:${features.ringShadow ? 'r' : ''}${features.earth ? 'e' : ''}`;
  material.customProgramCacheKey = () => key;
  return material;
}
