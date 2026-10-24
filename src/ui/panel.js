// Left sidebar: searchable body tree. Bottom card: facts about the focused body.

import { AU, LIGHT_SPEED, DEG } from '../astro/constants.js';
import { KIND_LABEL } from '../scene/body.js';
import { TidalLock } from '../astro/rotation.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export class BodyTree {
  constructor(root, system, onPick) {
    this.root = root;
    this.onPick = onPick;
    this.rows = new Map();
    const search = el('input', 'search');
    search.type = 'search';
    search.placeholder = `Search ${system.bodies.length} bodies…`;
    search.addEventListener('input', () => this.filter(search.value));
    search.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const first = [...this.rows.values()].find((r) => r.row.style.display !== 'none');
        if (first) onPick(first.body);
      }
    });
    this.list = el('div', 'tree');
    root.append(search, this.list);

    const sun = system.sun;
    this.addRow(sun, this.list, 0);
    const sections = [
      ['Planets', sun.children.filter((b) => b.kind === 'planet')],
      ['Dwarf planets', sun.children.filter((b) => b.kind === 'dwarf')],
      ['Asteroids & comets', sun.children.filter((b) => b.kind === 'asteroid' || b.kind === 'comet')],
    ];
    for (const [title, bodies] of sections) {
      this.list.append(el('div', 'section', title));
      for (const b of bodies) {
        const wrap = el('div', 'group');
        this.addRow(b, wrap, 0);
        if (b.children.length) {
          const kids = el('div', 'children collapsed');
          const toggle = this.rows.get(b).toggle;
          toggle.textContent = '▸';
          toggle.title = `${b.children.length} moons`;
          toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            kids.classList.toggle('collapsed');
            toggle.textContent = kids.classList.contains('collapsed') ? '▸' : '▾';
          });
          this.rows.get(b).kids = kids;
          // biggest moons first
          for (const m of [...b.children].sort((x, y) => y.radius - x.radius)) this.addRow(m, kids, 1);
          wrap.append(kids);
        }
        this.list.append(wrap);
      }
    }
  }

  addRow(body, parent, depth) {
    const row = el('div', `row depth-${depth}`);
    const toggle = el('span', 'toggle');
    const dot = el('span', 'swatch');
    dot.style.background = `#${body.color.getHexString()}`;
    const name = el('span', 'name', body.name);
    row.append(toggle, dot, name);
    if (body.children.length) row.append(el('span', 'count', String(body.children.length)));
    row.addEventListener('click', () => this.onPick(body));
    parent.append(row);
    this.rows.set(body, { row, toggle, body });
  }

  filter(q) {
    q = q.trim().toLowerCase();
    for (const { row, body, kids } of this.rows.values()) {
      const match = !q || body.name.toLowerCase().includes(q);
      row.style.display = match || (kids && q && [...kids.children].some((c) => c.textContent.toLowerCase().includes(q))) ? '' : 'none';
      if (kids) kids.classList.toggle('collapsed', !q);
    }
  }

  setFocus(body) {
    for (const r of this.rows.values()) r.row.classList.toggle('active', r.body === body);
    const r = this.rows.get(body);
    if (!r) return;
    if (body.parent && this.rows.get(body.parent)?.kids) {
      const p = this.rows.get(body.parent);
      p.kids.classList.remove('collapsed');
      p.toggle.textContent = '▾';
    }
    r.row.scrollIntoView({ block: 'nearest' });
  }
}

function fmtDistance(km) {
  if (km > 0.1 * AU) return `${(km / AU).toFixed(km > 10 * AU ? 2 : 4)} AU`;
  if (km > 1e6) return `${(km / 1e6).toFixed(3)} million km`;
  return `${Math.round(km).toLocaleString('en-US')} km`;
}

function fmtDuration(days) {
  const abs = Math.abs(days);
  if (abs > 2 * 365.25) return `${(abs / 365.25).toFixed(abs > 100 * 365.25 ? 0 : 2)} years`;
  if (abs > 2) return `${abs.toFixed(2)} days`;
  return `${(abs * 24).toFixed(2)} hours`;
}

function fmtLight(km) {
  const s = km / LIGHT_SPEED;
  if (s < 120) return `${s.toFixed(1)} s`;
  if (s < 7200) return `${(s / 60).toFixed(1)} min`;
  return `${(s / 3600).toFixed(2)} h`;
}

export class InfoCard {
  constructor(root, system) {
    this.root = root;
    this.system = system;
    this.body = null;
    this.title = el('h2');
    this.subtitle = el('div', 'subtitle');
    this.desc = el('p', 'desc');
    this.table = el('dl');
    root.append(this.title, this.subtitle, this.desc, this.table);
    // on phones only the title shows until tapped
    root.addEventListener('click', () => root.classList.toggle('expanded'));
  }

  show(body) {
    this.body = body;
    this.title.textContent = body.name;
    const parent = body.parent && body.parent.kind !== 'star' ? ` of ${body.parent.name}` : '';
    this.subtitle.textContent = `${KIND_LABEL[body.kind]}${parent}`;
    this.subtitle.style.color = `#${body.color.getHexString()}`;
    this.desc.textContent = body.description;
    this.desc.style.display = body.description ? '' : 'none';
    this.update(this.system.lastJd);
  }

  update(jd) {
    const b = this.body;
    if (!b) return;
    const sys = this.system;
    const rows = [];
    const r = b.def.radii;
    rows.push(['Mean radius', `${b.radius.toLocaleString('en-US', { maximumFractionDigits: 1 })} km${r && Math.max(...r) - Math.min(...r) > 1 ? ` (${r.map((x) => Math.round(x)).join(' × ')})` : ''}${b.def.radiusSource === 'default' ? ' (estimate)' : ''}`]);
    if (b.kind !== 'star') {
      const dSun = b.truePos.length();
      rows.push(['Distance from Sun', `${fmtDistance(dSun)} · light ${fmtLight(dSun)}`]);
      const earth = sys.get('Earth');
      if (b !== earth && b.parent !== earth) rows.push(['Distance from Earth', fmtDistance(b.truePos.distanceTo(earth.truePos))]);
      if (b.isMoon) rows.push([`Distance from ${b.parent.name}`, fmtDistance(b.trueRel.length())]);
      const el2 = b.orbit.el;
      rows.push(['Orbital period', fmtDuration(b.orbit.periodDays) + (el2.i > Math.PI / 2 ? ' (retrograde)' : '')]);
      rows.push(['Semi-major axis', fmtDistance(el2.a)]);
      rows.push(['Eccentricity', el2.e.toFixed(4)]);
      rows.push(['Orbital speed', `${b.orbit.velocity(jd).length().toFixed(2)} km/s`]);
    }
    if (b.rotation) {
      const rot = b.rotation instanceof TidalLock ? 'synchronous (tidally locked)' : `${fmtDuration(b.rotation.periodHours / 24)}${b.rotation.retrograde ? ' (retrograde)' : ''}`;
      rows.push(['Rotation period', rot]);
      if (b.orbit && !b.isMoon) {
        let tilt = Math.acos(Math.min(1, Math.max(-1, b.rotation.pole(jd).dot(b.orbit.normal(jd))))) / DEG;
        // IAU "north" poles of retrograde rotators sit on the north side; obliquity uses the spin axis
        if (b.rotation.retrograde) tilt = 180 - tilt;
        rows.push(['Axial tilt', `${tilt.toFixed(2)}°`]);
      }
    }
    if (b.def.gm) rows.push(['Mass', `${(b.def.gm / 6.6743e-20).toExponential(3)} kg`]);
    if (b.children.length && b.kind !== 'star') rows.push(['Known moons', String(b.children.length)]);
    if (b.def.approximate) rows.push(['Note', 'orbit orientation approximate']);

    this.table.replaceChildren(...rows.flatMap(([k, v]) => [el('dt', '', k), el('dd', '', v)]));
  }
}
