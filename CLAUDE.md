# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Interactive, true-scale Solar System simulation (three.js + Vite, plain ES modules, no framework,
no TypeScript). Live at https://jstale.github.io/solar-system/.

## Commands

```bash
npm install
npm run dev        # Vite dev server, http://localhost:5173 (append #Saturn etc. to start at a body)
npm run build      # static site in dist/ (includes public/textures, ~120 MB)
npm run preview    # serve dist/
npm run textures   # (re)build public/textures from tools/fetch-textures.mjs; add -- --force to redo existing files
python -I tools/build_moons.py elem.html phys.html wiki.html src/data/moons.json   # regenerate moon data (see README)
```

There is no test suite and no linter. Verify changes by running the app: `window.solar`
(`{ system, rig, clock, settings, camera, renderer, focus }`) is exposed for the dev-tools console,
e.g. `solar.clock.jd = Date.parse('2027-08-02T10:07Z')/864e5 + 2440587.5; solar.clock.paused = true`
then `solar.focus(solar.system.get('Earth'))` shows the total solar eclipse over Egypt — a good
end-to-end check of orbits, rotation and the eclipse shader. Set the clock and focus in separate
steps/frames: positions only update in the render loop.

Deployment: every push to `main` runs `.github/workflows/deploy.yml` (npm ci → build → GitHub Pages).
`vite.config.js` uses `base: './'` so the build works under the `/solar-system/` sub-path; keep
asset URLs relative (`textures/...`, not `/textures/...`).

## Architecture

### Units, frames, precision
- Everything is in **kilometres** in the **scene frame = ecliptic J2000 with Y up**:
  scene `(x, y, z)` = ecliptic `(x, z, −y)`. Conversions live in `src/astro/frames.js`
  (`eclToScene`, `equToScene`, `referenceBasisFromPole`).
- Body meshes use `SphereGeometry` conventions: local +X = prime meridian (centre of an
  equirectangular map), +Y = north pole, −Z = 90° E. `quaternionFromAxes` in `src/astro/rotation.js`
  builds orientations from that.
- Positions span 1 m – 10¹³ km. The renderer uses a **logarithmic depth buffer**, positions are kept
  as JS doubles, and three.js computes `modelViewMatrix` on the CPU. **Custom shaders must work in
  view space**: pass positions/directions as uniforms already transformed by
  `camera.matrixWorldInverse` (see `updateVisual` in `body.js`, `updateOccluders` in `system.js`).
  Never rely on world-space positions or `cameraPosition` in GLSL — float32 breaks down far from the Sun.
- Custom `ShaderMaterial`s must include the `logdepthbuf_*` chunks, or they won't depth-test
  correctly against the rest of the scene. The only exception is the sky (`sky.js`), which renders
  first with depth test and depth write off.

### True space vs display space
Each `Body` (`src/scene/body.js`) carries both:
- `truePos` / `trueRel` / `trueBaryPos`: physical positions, used for the info panel and physics.
- `pos` / `displayRel` / `baryPos` / `displayRadius` / `sizeScale`: what is rendered after the
  user's scale settings.

All scale mapping goes through `SolarSystem.helioToDisplay()` (distance exponent) and
`SolarSystem.moonToDisplay()` (moon distance above the planet's surface, so moons stay outside
enlarged planets) in `src/scene/system.js`. The belts apply the distance exponent in their vertex
shader (`src/scene/belts.js`). When scale settings change, bump `system.scaleVersion` (main.js does
this in `onScaleChange`) so cached orbit lines rebuild. Defaults must stay at true scale (all 1).

### Per-frame order (`src/main.js`)
`clock.tick` → `system.updatePositions(jd)` (parents before children; Earth–Moon and Pluto–Charon
are barycentric pairs: the planet's orbit is the barycentre, see `bary`/`orbitsBarycentre`) →
`rig.update` (camera follows the focused body by its frame-to-frame delta) → camera matrices →
`system.updateView` (screen metrics, eclipse occluders, shader uniforms, orbit lines, hi-res
texture streaming) → `belts.update` → `labels.update` → render.
`CameraRig.flyTo` defers its setup to the next `update()` (`pending`) because the clock may have
jumped in the same tick and body positions would be stale.

### Orbits and rotation (`src/astro/`)
- `Orbit` = Keplerian elements drifting linearly in time, expressed in a reference-plane basis
  (ecliptic, a planet's equator, or a Laplace plane, per JPL's satellite tables). Factories:
  `orbitFromStandish` (planets, valid 1800–2050), `orbitFromSbdb` (small bodies), `moonOrbit`
  (in `system.js`).
- `orbit.positionModel` can replace the Keplerian position with a better theory; the Moon uses
  `lunarPosition` (truncated ELP-2000/Meeus, `moon.js`) so eclipses land on real dates. The mean
  ellipse is still used for its orbit line, period and velocity.
- Rotation models: `IauRotation` (IAU WGCCRE; negative `W` rate = retrograde, and axial tilt is
  reported as 180° − angle for those), `SimpleRotation`, and `TidalLock` (prime meridian faces the
  primary, pole = orbit normal).

### Data
- `src/data/bodies.js`: Sun, planets and small bodies — Standish elements, SBDB elements, IAU
  rotation, triaxial `radii` [equatorial, polar, equatorial], textures, `rings` (texture or `bands`
  catalogue), `atmosphere` (real `scaleHeight` km, per-channel vertical `tau`, optional `albedo`).
- `src/data/moons.json` is **generated** by `tools/build_moons.py` from JPL + Wikipedia pages — do
  not hand-edit. Overrides (texture names, shapes, non-synchronous spins, atmospheres,
  descriptions, dwarf-planet moons) go in `src/data/moons-extra.js`.
- Saturn's ring texture is calibrated to 75 200–140 200 km. Change both numbers together if the
  texture changes.

### Rendering pieces (`src/scene/`)
- `materials.js` extends `MeshStandardMaterial` via `onBeforeCompile`: eclipse shadows (up to
  `MAX_OCC` = 4 spheres, analytic Sun-disc overlap, red refracted light for occluders with
  atmospheres), ring shadows, and the Earth extras (night lights, specular→roughness, cloud
  shadows). It patches three.js's `lights_fragment_begin` chunk at the
  `getPointLightInfo( pointLight, geometryPosition, directLight );` line and logs a warning if that
  text is missing. **Re-check this when upgrading three.js.** One lighting-uniforms object per body
  is shared by its surface, clouds and rings.
- Lighting is one `PointLight` at the Sun with decay 0 (constant irradiance, deliberately not
  1/r²) and intensity π, so `MeshStandardMaterial` albedo maps 1:1.
- `atmosphere.js` analytic Chapman-style haze shell (computed in a polar-stretched space for
  oblate planets); `rings.js` (planet shadow on rings); `belts.js` (Kepler solved in the vertex
  shader; trojans/Hildas/plutinos phase-locked to Jupiter/Neptune); `orbitLine.js` (rebuilt
  starting at the body, dense near it, skipped while the body moved < 0.25 px); `sky.js` (star map
  in equatorial coordinates, sampled with explicit gradients to avoid the seam).
- `textures.js`: textures are listed in `public/textures/manifest.json` (written by
  `fetch-textures.mjs`; the Vite dev server answers missing files with index.html, so never probe
  URLs). Default ≤2K maps load at startup; ≤8K `hi/` maps are reference-counted
  (`acquireHi`/`releaseHi`) and swapped per texture slot (`Body.addSlot`/`setHiRes`) using request
  tokens to avoid applying stale loads.

### UI (`src/ui/`)
DOM labels are decluttered every frame (`labels.js`, also provides `pick()` for canvas clicks).
`panel.js` holds the body tree and info card, `timebar.js` the clock and rates, `gui.js` the
lil-gui settings. Settings live in `src/settings.js`: `DEFAULTS`, `PRESETS`, and localStorage key
`solar-settings-v1`. `loadSettings` only accepts keys present in `DEFAULTS`, so new settings must
be added there. Changing an existing default won't reach users who already have saved settings
unless the storage key is bumped.

## Conventions
- Source files are UTF-8 without BOM and contain non-ASCII text (–, ’, ₂, °). Edit them with
  tools that preserve encoding; on Windows, PowerShell `Get-Content`/`Set-Content` round-trips
  corrupt them.
- Third-party texture credits and licenses are listed in the README and in the in-app credits
  dialog (`index.html`). Update both when adding texture sources.
