// Extra data layered on top of the JPL satellite tables in moons.json.

/** Satellites of dwarf planets (not in JPL's planetary satellite tables). Ecliptic J2000, approximate. */
export const DWARF_MOONS = [
  // Holler et al. 2021; mean anomaly at epoch unknown -> 0
  { planet: 'Eris', name: 'Dysnomia', frame: 'ecliptic', epoch: '2000-01-01.5', a: 37273, e: 0.0062, i: 78.29, node: 126.17, w: 180.83, M: 0, P: 15.785899, radius: 307 },
  // Ragozzine & Brown 2009 (epoch JD 2454615.0)
  { planet: 'Haumea', name: 'Hiʻiaka', frame: 'ecliptic', epoch: '2008-05-31.5', a: 49880, e: 0.0513, i: 126.356, node: 206.766, w: 154.1, M: 152.8, P: 49.462, radius: 160 },
  { planet: 'Haumea', name: 'Namaka', frame: 'ecliptic', epoch: '2008-05-31.5', a: 25657, e: 0.249, i: 113.013, node: 205.016, w: 178.9, M: 178.5, P: 18.2783, radius: 85 },
  { planet: 'Makemake', name: 'MK2', frame: 'ecliptic', epoch: '2000-01-01.5', a: 22250, e: 0, i: 64, node: 80, w: 0, M: 0, P: 18.023, radius: 87.5 },
  { planet: 'Orcus', name: 'Vanth', frame: 'ecliptic', epoch: '2000-01-01.5', a: 9010, e: 0.007, i: 105.03, node: 50, w: 0, M: 0, P: 9.5393, radius: 221 },
  { planet: 'Quaoar', name: 'Weywot', frame: 'ecliptic', epoch: '2000-01-01.5', a: 13289, e: 0.02, i: 14, node: 0, w: 0, M: 0, P: 12.431, radius: 100 },
  { planet: 'Gonggong', name: 'Xiangliu', frame: 'ecliptic', epoch: '2000-01-01.5', a: 24021, e: 0.29, i: 83.08, node: 0, w: 0, M: 0, P: 25.22, radius: 50 },
].map((m) => ({ ...m, approximate: true }));

/** Spacecraft-derived global maps available for these moons. */
export const MOON_TEXTURES = {
  Moon: 'moon',
  Phobos: 'phobos',
  Deimos: 'deimos',
  Io: 'io',
  Europa: 'europa',
  Ganymede: 'ganymede',
  Callisto: 'callisto',
  Mimas: 'mimas',
  Enceladus: 'enceladus',
  Tethys: 'tethys',
  Dione: 'dione',
  Rhea: 'rhea',
  Titan: 'titan',
  Iapetus: 'iapetus',
  Miranda: 'miranda',
  Ariel: 'ariel',
  Umbriel: 'umbriel',
  Titania: 'titania',
  Oberon: 'oberon',
  Triton: 'triton',
  Charon: 'charon',
};

/** Triaxial radii [toward primary, polar, along-track] km. */
export const MOON_SHAPES = {
  Phobos: [13.0, 9.1, 11.4],
  Deimos: [7.8, 5.1, 6.0],
  Amalthea: [125, 64, 73],
  Thebe: [58, 42, 49],
  Mimas: [207.8, 190.6, 196.7],
  Hyperion: [180, 103, 133],
  Janus: [101.7, 76.3, 93.0],
  Epimetheus: [64.9, 53.0, 57.3],
  Prometheus: [68.2, 28.2, 41.6],
  Pandora: [52.2, 31.5, 40.8],
  Pan: [17.2, 10.4, 15.4],
  Atlas: [20.4, 9.4, 17.7],
  Daphnis: [4.6, 2.8, 4.5],
  Puck: [81, 81, 81],
  Proteus: [218, 201, 208],
  Larissa: [108, 89, 102],
  Nix: [25, 16, 18],
  Hydra: [25.5, 16, 19],
  Kerberos: [9.5, 4.5, 5],
  Styx: [8, 4, 5],
};

/** Non-synchronous rotators (hours; negative = retrograde). Others: inner moons are tidally locked, irregulars get a pseudo-random spin. */
export const MOON_SPIN = {
  Hyperion: 312, // chaotic
  Phoebe: 9.274,
  Himalia: 7.782,
  Elara: 12,
  Nereid: 11.594,
  Nix: 43.9,
  Hydra: 10.3,
  Kerberos: 5.31,
  Styx: 3.24,
};

/** Moons with an atmosphere worth drawing. */
export const MOON_ATMOSPHERES = {
  // photochemical haze: optically thick, orange
  Titan: { scaleHeight: 45, tau: [2.2, 1.7, 1.2], albedo: [0.55, 0.33, 0.12], intensity: 1.0 },
  Triton: { scaleHeight: 14, tau: [0.004, 0.006, 0.01], intensity: 1.0 },
};

export const MOON_DESCRIPTIONS = {
  Moon: 'Earth’s only natural satellite, probably formed from debris of a giant impact 4.5 billion years ago.',
  Phobos: 'Larger Martian moon, spiralling inward – it will break up or crash into Mars in ~50 million years.',
  Deimos: 'Smaller, outer moon of Mars, smoothed by a thick regolith blanket.',
  Io: 'Most volcanically active body known, heated by tidal flexing from Jupiter.',
  Europa: 'Ice shell over a global salt-water ocean – a prime target in the search for life.',
  Ganymede: 'Largest moon in the Solar System – bigger than Mercury – with its own magnetic field.',
  Callisto: 'The most heavily cratered object known; its surface is ~4 billion years old.',
  Amalthea: 'Reddest object in the Solar System; it sheds dust into Jupiter’s gossamer ring.',
  Himalia: 'Largest of Jupiter’s irregular, captured moons.',
  Mimas: 'Its giant crater Herschel gives it a “Death Star” look; may hide a young ocean.',
  Enceladus: 'Fires geysers of water from a subsurface ocean out of its “tiger stripes”, feeding Saturn’s E ring.',
  Tethys: 'Icy moon with the 400 km Odysseus crater and the Ithaca Chasma canyon.',
  Dione: 'Icy moon with bright wispy fracture terrain on its trailing hemisphere.',
  Rhea: 'Saturn’s second-largest moon, a cratered ball of ice.',
  Titan: 'Only moon with a thick atmosphere (1.5 bar, mostly N₂) and lakes of liquid methane; Huygens landed here in 2005.',
  Hyperion: 'Sponge-like, irregular moon tumbling chaotically.',
  Iapetus: 'Two-toned moon – one hemisphere dark as coal, the other bright as snow – with an equatorial ridge.',
  Phoebe: 'Captured, retrograde moon; source of the enormous, faint Phoebe ring.',
  Pan: '“Ravioli”-shaped shepherd moon that keeps the Encke Gap open.',
  Janus: 'Co-orbital with Epimetheus – the two swap orbits every four years.',
  Epimetheus: 'Co-orbital with Janus – the two swap orbits every four years.',
  Miranda: 'Patchwork moon with 20 km-high cliffs (Verona Rupes).',
  Ariel: 'Brightest Uranian moon, with a young, canyon-crossed surface.',
  Umbriel: 'Darkest of Uranus’s large moons.',
  Titania: 'Largest moon of Uranus.',
  Oberon: 'Outermost large moon of Uranus, heavily cratered.',
  Triton: 'Captured Kuiper-belt object on a retrograde orbit, with active nitrogen geysers.',
  Nereid: 'Has one of the most eccentric orbits of any moon (e ≈ 0.75).',
  Proteus: 'Among the largest irregularly shaped bodies – almost massive enough to be round.',
  Charon: 'Half Pluto’s size; Pluto and Charon are mutually tidally locked around a barycentre in open space.',
  Nix: 'Small, chaotically tumbling moon of Pluto.',
  Hydra: 'Outermost known moon of Pluto, covered in water ice.',
  Dysnomia: 'Eris’s only known moon; its orbit gave Eris’s mass.',
  'Hiʻiaka': 'Larger, outer moon of Haumea; its orbit is aligned with Haumea’s ring.',
};
