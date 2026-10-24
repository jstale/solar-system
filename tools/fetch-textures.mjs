// Downloads the planet / moon / sky textures and prepares two variants of each:
//   public/textures/<name>.<ext>     default, max 2048 px wide (loaded at startup)
//   public/textures/hi/<name>.<ext>  high-res, up to 8192 px (streamed in when you fly close)
//
// Usage: node tools/fetch-textures.mjs [--force]
//
// Sources and licenses are listed in README.md (Credits).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'textures-src');
const OUT = path.join(ROOT, 'public', 'textures');
const OUT_HI = path.join(OUT, 'hi');
const FORCE = process.argv.includes('--force');

const LO_WIDTH = 2048;
const HI_WIDTH = 8192;

const SSS = 'https://www.solarsystemscope.com/textures/download/';
const ALB = 'https://stevealbers.net/albers/sos/';
const NASA3D = 'https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/Images%20and%20Textures/';
const SVS = 'https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/';

// format: output format; 'png' keeps alpha (rings)
const TEXTURES = [
  { name: 'sun', url: SSS + '8k_sun.jpg' },
  { name: 'mercury', url: SSS + '8k_mercury.jpg' },
  { name: 'venus_surface', url: SSS + '8k_venus_surface.jpg' },
  { name: 'venus_atmosphere', url: SSS + '4k_venus_atmosphere.jpg' },
  { name: 'earth_day', url: SSS + '8k_earth_daymap.jpg' },
  { name: 'earth_night', url: SSS + '8k_earth_nightmap.jpg' },
  { name: 'earth_clouds', url: SSS + '8k_earth_clouds.jpg' },
  { name: 'earth_normal', url: SSS + '8k_earth_normal_map.tif', hiWidth: 4096 },
  { name: 'earth_specular', url: SSS + '8k_earth_specular_map.tif', hiWidth: 4096 },
  { name: 'moon', url: SSS + '8k_moon.jpg' },
  { name: 'mars', url: SSS + '8k_mars.jpg' },
  { name: 'jupiter', url: SSS + '8k_jupiter.jpg' },
  { name: 'saturn', url: SSS + '8k_saturn.jpg' },
  { name: 'saturn_ring', url: SSS + '8k_saturn_ring_alpha.png', format: 'png' },
  { name: 'uranus', url: SSS + '2k_uranus.jpg' },
  { name: 'neptune', url: SSS + '2k_neptune.jpg' },
  // Solar System Scope: artist's impressions (no spacecraft imagery exists)
  { name: 'eris', url: SSS + '4k_eris_fictional.jpg' },
  { name: 'haumea', url: SSS + '4k_haumea_fictional.jpg' },
  { name: 'makemake', url: SSS + '4k_makemake_fictional.jpg' },
  // Steve Albers' cylindrical maps (NASA / JPL / USGS mission data)
  { name: 'ceres', url: ALB + 'asteroids/ceres_rgb_cyl.png' },
  { name: 'vesta', url: ALB + 'asteroids/vesta.png' },
  { name: 'pluto', url: ALB + 'pluto/pluto_rgb_cyl_8k.png' },
  { name: 'charon', url: ALB + 'pluto/charon/charon_rgb_cyl.jpg' },
  { name: 'io', url: ALB + 'jupiter/io/io_rgb_cyl.jpg' },
  { name: 'europa', url: ALB + 'jupiter/europa/europa_rgb_cyl_juno.png' },
  { name: 'ganymede', url: ALB + 'jupiter/ganymede/ganymede_4k.jpg' },
  { name: 'callisto', url: 'https://bjj.mmedia.is/data/callisto/callisto.jpg' },
  { name: 'mimas', url: ALB + 'saturn/mimas/mimas_rgb_cyl_www.jpg' },
  { name: 'enceladus', url: ALB + 'saturn/enceladus/enceladus_rgb_cyl_www.jpg' },
  { name: 'tethys', url: ALB + 'saturn/tethys/tethys_rgb_cyl_www.jpg' },
  { name: 'dione', url: ALB + 'saturn/dione/dione_rgb_cyl_www.jpg' },
  { name: 'rhea', url: ALB + 'saturn/rhea/rhea_rgb_cyl_www.jpg' },
  { name: 'iapetus', url: ALB + 'saturn/iapetus/iapetus_rgb_cyl_www.jpg' },
  { name: 'titan', url: ALB + 'saturn/titan/titan_rgb_cyl_www.jpg' },
  { name: 'ariel', url: ALB + 'uranus/ariel/ariel_rgb_cyl_www.jpg' },
  { name: 'miranda', url: ALB + 'uranus/miranda/miranda_rgb_cyl_www.jpg' },
  { name: 'oberon', url: ALB + 'uranus/oberon/oberon_rgb_cyl_www.jpg' },
  { name: 'titania', url: ALB + 'uranus/titania/titania_rgb_cyl_www.jpg' },
  { name: 'triton', url: ALB + 'neptune/triton/triton_rgb_cyl_www.jpg' },
  // NASA 3D Resources
  { name: 'umbriel', url: NASA3D + 'Uranus%20-%20Umbriel/Uranus%20-%20Umbriel.jpg' },
  { name: 'phobos', url: NASA3D + 'Mars%20-%20Phobos/Mars%20-%20Phobos.jpg' },
  { name: 'deimos', url: NASA3D + 'Mars%20-%20Deimos/Mars%20-%20Deimos.jpg' },
  // NASA SVS Deep Star Maps 2020 (Hipparcos-2, Tycho-2, Gaia DR2), equatorial J2000, HDR
  { name: 'stars', url: SVS + 'starmap_2020_8k.exr', exr: true },
];

fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT_HI, { recursive: true });

async function download(url, dest) {
  if (!FORCE && fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const type = res.headers.get('content-type') || '';
  if (type.startsWith('text/html')) throw new Error(`got HTML instead of an image for ${url}`);
  const tmp = dest + '.part';
  const file = fs.createWriteStream(tmp);
  for await (const chunk of res.body) file.write(chunk);
  await new Promise((resolve, reject) => file.end((err) => (err ? reject(err) : resolve())));
  fs.renameSync(tmp, dest);
}

function encode(img, format) {
  return format === 'png' ? img.png({ compressionLevel: 9 }) : img.jpeg({ quality: 90, mozjpeg: true });
}

async function processImage(tex, src) {
  const format = tex.format ?? 'jpg';
  const lo = path.join(OUT, `${tex.name}.${format}`);
  const hi = path.join(OUT_HI, `${tex.name}.${format}`);
  const input = tex.exr ? await exrToSharp(src) : sharp(src, { limitInputPixels: false });
  const { width } = await input.metadata();

  if (FORCE || !fs.existsSync(lo)) {
    await encode(input.clone().resize({ width: Math.min(width, LO_WIDTH) }), format).toFile(lo);
  }
  if (width > LO_WIDTH && (FORCE || !fs.existsSync(hi))) {
    await encode(input.clone().resize({ width: Math.min(width, tex.hiWidth ?? HI_WIDTH) }), format).toFile(hi);
  }
  return width;
}

// The app reads this to know which textures (and hi-res variants) exist.
function writeManifest() {
  const manifest = {};
  for (const tex of TEXTURES) {
    const format = tex.format ?? 'jpg';
    const lo = `${tex.name}.${format}`;
    if (!fs.existsSync(path.join(OUT, lo))) continue;
    const hi = fs.existsSync(path.join(OUT_HI, lo)) ? `textures/hi/${lo}` : null;
    manifest[tex.name] = { lo: `textures/${lo}`, hi };
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return Object.keys(manifest).length;
}

// Tone-map the HDR star map to 8-bit sRGB. Exposure is chosen from the data so the
// Milky Way is visible but faint while bright stars stay point-like.
async function exrToSharp(src) {
  const THREE = await import('three');
  const { EXRLoader } = await import('three/examples/jsm/loaders/EXRLoader.js');
  const buf = fs.readFileSync(src);
  const loader = new EXRLoader().setDataType(THREE.FloatType);
  const tex = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const { width, height, data } = tex;
  const channels = data.length / (width * height);

  // median-ish background level to set exposure
  const sample = [];
  for (let i = 0; i < width * height; i += 97) sample.push(data[i * channels] + data[i * channels + 1] + data[i * channels + 2]);
  sample.sort((a, b) => a - b);
  const p50 = sample[Math.floor(sample.length * 0.5)] / 3;
  const p999 = sample[Math.floor(sample.length * 0.999)] / 3;
  const exposure = 0.012 / Math.max(p50, 1e-9);
  console.log(`  stars: ${width}x${height}, p50=${p50.toExponential(3)}, p99.9=${p999.toExponential(3)}, exposure=${exposure.toExponential(3)}`);

  const out = Buffer.alloc(width * height * 3);
  const toSrgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  for (let y = 0; y < height; y++) {
    // EXRLoader returns rows bottom-up
    const srcRow = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const si = (srcRow * width + x) * channels;
      const di = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) {
        const v = 1 - Math.exp(-data[si + c] * exposure);
        out[di + c] = Math.max(0, Math.min(255, Math.round(toSrgb(v) * 255)));
      }
    }
  }
  return sharp(out, { raw: { width, height, channels: 3 }, limitInputPixels: false });
}

async function run() {
  const queue = [...TEXTURES];
  const failures = [];
  const worker = async () => {
    while (queue.length) {
      const tex = queue.shift();
      const ext = path.extname(new URL(tex.url).pathname);
      const src = path.join(CACHE, tex.name + ext);
      try {
        await download(tex.url, src);
        const w = await processImage(tex, src);
        console.log(`ok   ${tex.name.padEnd(18)} source ${w}px`);
      } catch (err) {
        failures.push(tex.name);
        console.error(`FAIL ${tex.name}: ${err.message}`);
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  console.log(`manifest: ${writeManifest()} textures`);
  if (failures.length) {
    console.error(`\n${failures.length} texture(s) failed: ${failures.join(', ')} (the app falls back to plain colours)`);
    process.exitCode = 1;
  } else {
    console.log('\nAll textures ready.');
  }
}

run();
