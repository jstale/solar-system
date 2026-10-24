// HTML name tags + position markers. Bodies at realistic scale are usually far below one pixel,
// so every body gets a dot; names are decluttered greedily by importance.

const PRIORITY = { star: 6, planet: 5, dwarf: 4, asteroid: 3, comet: 3, moon: 1 };

export class Labels {
  constructor(container, system, onPick) {
    this.container = container;
    this.system = system;
    this.items = [];
    for (const body of system.bodies) {
      const el = document.createElement('div');
      el.className = `label kind-${body.kind}`;
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = `#${body.color.getHexString()}`;
      const text = document.createElement('span');
      text.className = 'text';
      text.textContent = body.name;
      el.append(dot, text);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onPick(body);
      });
      container.appendChild(el);
      this.items.push({ body, el, text, state: '', width: body.name.length * 6.6 + 18 });
    }
  }

  categoryOn(body, s) {
    if (body.kind === 'moon') return body.isMajor ? s.labelsMoons : s.labelsMinorMoons;
    if (body.kind === 'planet' || body.kind === 'star') return s.labelsPlanets;
    return s.labelsSmallBodies;
  }

  update(width, height, focus, settings) {
    const show = settings.showLabels;
    const candidates = [];
    // big on-screen bodies hide whatever is behind them
    const occluders = this.system.bodies.filter((b) => b.screen.inFront && b.screen.px > 3);

    for (const item of this.items) {
      const b = item.body;
      const sc = b.screen;
      let state = 'hidden';
      if (show && sc.onScreen && this.categoryOn(b, settings)) {
        let visible = true;
        // moons sitting on top of their planet's dot only add clutter
        if (b.isMoon && b !== focus) {
          const p = b.parent.screen;
          const sep = Math.hypot(sc.x - p.x, sc.y - p.y);
          if (sep < Math.max(6, p.px + 4)) visible = false;
        }
        if (visible) {
          for (const o of occluders) {
            if (o === b || o.screen.depth >= sc.depth) continue;
            if (Math.hypot(sc.x - o.screen.x, sc.y - o.screen.y) < o.screen.px * 0.98) {
              visible = false;
              break;
            }
          }
        }
        if (visible) {
          state = sc.px > 3 ? 'big' : 'dot';
          candidates.push(item);
        }
      }
      item.next = state;
    }

    // greedy declutter of the text: focus first, then by kind and size
    candidates.sort((a, b) => this.priority(b.body, focus) - this.priority(a.body, focus));
    const placed = [];
    for (const item of candidates) {
      const b = item.body;
      const sc = b.screen;
      const offsetY = item.next === 'big' ? sc.px + 6 : 0;
      const x0 = sc.x - 6, y0 = sc.y + offsetY - 9;
      const rect = [x0, y0, x0 + item.width, y0 + 18];
      let free = true;
      for (const r of placed) {
        if (rect[0] < r[2] && rect[2] > r[0] && rect[1] < r[3] && rect[3] > r[1]) {
          free = false;
          break;
        }
      }
      // moons only get names once they are spread out around their planet
      if (b.isMoon && b !== focus) {
        const p = b.parent.screen;
        if (Math.hypot(sc.x - p.x, sc.y - p.y) < Math.max(28, p.px + 16)) free = false;
      }
      if (free) placed.push(rect);
      if (!free) item.next = item.next === 'big' ? 'hidden' : 'dot-only';
      item.offsetY = offsetY;
    }

    for (const item of this.items) {
      const { el, body } = item;
      if (item.next !== item.state) {
        el.className = `label kind-${body.kind} ${item.next}${body === focus ? ' focus' : ''}`;
        item.state = item.next;
        item.focus = body === focus;
      } else if (item.focus !== (body === focus)) {
        item.focus = body === focus;
        el.classList.toggle('focus', item.focus);
      }
      if (item.state !== 'hidden') {
        const sc = body.screen;
        el.style.transform = `translate(${sc.x.toFixed(1)}px, ${(sc.y + (item.offsetY ?? 0)).toFixed(1)}px)`;
      }
    }
  }

  priority(b, focus) {
    if (b === focus) return 1e12;
    let p = PRIORITY[b.kind] * 1e6 + b.radius;
    if (focus && (b.parent === focus || b === focus.parent)) p += 5e6;
    return p;
  }

  /** Body under a screen point (for clicks on the canvas). */
  pick(x, y) {
    let best = null;
    let bestScore = Infinity;
    for (const item of this.items) {
      const b = item.body;
      const sc = b.screen;
      if (!sc.inFront || !sc.onScreen) continue;
      const d = Math.hypot(sc.x - x, sc.y - y);
      const reach = Math.max(sc.px, item.state === 'hidden' ? 0 : 9);
      if (d > reach) continue;
      // prefer what is in front; among dots prefer the closest and the more important
      const score = (sc.px > 3 ? sc.depth : 1e20 + d * 1e10) - PRIORITY[b.kind];
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    return best;
  }
}
