// Settings panel (lil-gui).

import GUI from 'lil-gui';
import { DEFAULTS, PRESETS, saveSettings } from '../settings.js';

/** Logarithmic slider for a scale factor; the label shows the actual multiplier. */
function logSlider(folder, settings, key, label, max, onChange) {
  const proxy = { v: Math.log10(settings[key]) };
  const fmt = (x) => (x >= 10 ? Math.round(x) : x.toFixed(x < 2 ? 2 : 1));
  const ctrl = folder.add(proxy, 'v', 0, max, 0.01).name(`${label} ×${fmt(settings[key])}`);
  ctrl.onChange((v) => {
    settings[key] = Math.pow(10, v);
    ctrl.name(`${label} ×${fmt(settings[key])}`);
    onChange();
  });
  ctrl.sync = () => {
    proxy.v = Math.log10(settings[key]);
    ctrl.name(`${label} ×${fmt(settings[key])}`);
    ctrl.updateDisplay();
  };
  return ctrl;
}

export function createGui(settings, hooks) {
  const gui = new GUI({ title: 'Settings', width: 290 });
  const save = () => saveSettings(settings);
  gui.onChange(save);

  // ---- scale
  const scale = gui.addFolder('Scale');
  const presetState = { preset: 'Realistic' };
  const logCtrls = [];
  const refreshScale = () => {
    hooks.onScaleChange();
    save();
  };
  scale
    .add(presetState, 'preset', Object.keys(PRESETS))
    .name('Preset')
    .onChange((name) => {
      Object.assign(settings, PRESETS[name]);
      logCtrls.forEach((c) => c.sync());
      expCtrl.updateDisplay();
      refreshScale();
    });
  logCtrls.push(logSlider(scale, settings, 'sunScale', 'Sun size', 2, refreshScale));
  logCtrls.push(logSlider(scale, settings, 'planetScale', 'Planet size', 3, refreshScale));
  logCtrls.push(logSlider(scale, settings, 'moonScale', 'Moon size', 3, refreshScale));
  logCtrls.push(logSlider(scale, settings, 'moonOrbitScale', 'Moon distance', 2, refreshScale));
  const expCtrl = scale.add(settings, 'distanceExponent', 0.25, 1, 0.01).name('Distance exponent').onChange(refreshScale);
  scale.add({ note: '1 = true scale' }, 'note').name('Info').disable();

  // ---- view
  const view = gui.addFolder('Orbits & labels');
  view.add(settings, 'showOrbits').name('Orbits');
  view.add(settings, 'orbitOpacity', 0.05, 1, 0.01).name('Orbit opacity');
  view.add(settings, 'orbitsPlanets').name('· planets');
  view.add(settings, 'orbitsSmallBodies').name('· dwarf planets & small bodies');
  view.add(settings, 'orbitsMoons').name('· major moons');
  view.add(settings, 'orbitsMinorMoons').name('· minor moons');
  view.add(settings, 'showLabels').name('Labels');
  view.add(settings, 'labelsPlanets').name('· planets');
  view.add(settings, 'labelsSmallBodies').name('· dwarf planets & small bodies');
  view.add(settings, 'labelsMoons').name('· major moons');
  view.add(settings, 'labelsMinorMoons').name('· minor moons');

  // ---- populations
  const belts = gui.addFolder('Asteroids & Kuiper belt');
  belts.add(settings, 'showMainBelt').name('Main asteroid belt');
  belts.add(settings, 'showTrojans').name('Jupiter trojans');
  belts.add(settings, 'showKuiper').name('Kuiper belt & scattered disc');
  belts.add(settings, 'beltPointSize', 0.5, 4, 0.1).name('Point size');
  belts.add(settings, 'beltDensity', 0.1, 3, 0.1).name('Density').onFinishChange(() => hooks.onBeltDensity());

  // ---- rendering
  const render = gui.addFolder('Rendering');
  render.add(settings, 'hiResTextures').name('Hi-res textures (8K)');
  render.add(settings, 'exposure', 0.2, 4, 0.01).name('Exposure');
  render.add(settings, 'ambient', 0, 0.3, 0.005).name('Night-side light');
  render.add(settings, 'starBrightness', 0, 2, 0.01).name('Stars / Milky Way');
  render.add(settings, 'nightLights', 0, 3, 0.05).name('Earth city lights');
  render.add(settings, 'sunGlow').name('Sun glow');
  render.add(settings, 'atmospheres').name('Atmospheres');
  render.add(settings, 'clouds').name('Clouds');
  render.add(settings, 'rings').name('Rings');
  render.add(settings, 'eclipses').name('Eclipse shadows');

  gui
    .add(
      {
        reset() {
          Object.assign(settings, DEFAULTS);
          gui.controllersRecursive().forEach((c) => c.updateDisplay());
          logCtrls.forEach((c) => c.sync());
          presetState.preset = 'Realistic';
          refreshScale();
          hooks.onBeltDensity();
        },
      },
      'reset',
    )
    .name('Reset all settings');

  view.close();
  belts.close();
  render.close();
  // phones: keep the scene visible until the user asks for settings
  if (window.innerWidth <= 760) gui.close();
  return gui;
}
