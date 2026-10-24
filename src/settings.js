// All user-tweakable settings in one place. Scale factors default to 1 = true scale.

export const DEFAULTS = {
  // scale (1 = realistic)
  sunScale: 1,
  planetScale: 1, // planets, dwarf planets, asteroids, comets
  moonScale: 1,
  moonOrbitScale: 1, // stretches moon distances above the planet's surface
  distanceExponent: 1, // heliocentric distance r -> AU * (r/AU)^p; < 1 compresses the system

  // orbits
  showOrbits: true,
  orbitOpacity: 0.55,
  orbitsPlanets: true,
  orbitsSmallBodies: true,
  orbitsMoons: true,
  orbitsMinorMoons: false,

  // labels
  showLabels: true,
  labelsPlanets: true,
  labelsSmallBodies: true,
  labelsMoons: true,
  labelsMinorMoons: false,

  // small-body populations
  showMainBelt: true,
  showTrojans: true,
  showKuiper: true,
  beltDensity: 1,
  beltPointSize: 1.6,

  // rendering
  exposure: 1.0,
  starBrightness: 0.35,
  ambient: 0.02,
  sunGlow: true,
  atmospheres: true,
  clouds: true,
  rings: true,
  eclipses: true,
  nightLights: 1.0,
  hiResTextures: true,
};

export const PRESETS = {
  Realistic: { sunScale: 1, planetScale: 1, moonScale: 1, moonOrbitScale: 1, distanceExponent: 1 },
  'Enlarged bodies': { sunScale: 10, planetScale: 100, moonScale: 100, moonOrbitScale: 6, distanceExponent: 1 },
  'Compressed system': { sunScale: 25, planetScale: 400, moonScale: 400, moonOrbitScale: 25, distanceExponent: 0.45 },
};

const STORAGE_KEY = 'solar-settings-v1';

export function loadSettings() {
  const s = { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    for (const k of Object.keys(DEFAULTS)) if (typeof saved[k] === typeof DEFAULTS[k]) s[k] = saved[k];
  } catch {
    // storage unavailable: defaults
  }
  return s;
}

export function saveSettings(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}
