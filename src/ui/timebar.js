// Simulation clock + its controls.

import { jdFromDate, dateFromJd, formatDate } from '../astro/time.js';

const YEAR = 365.25 * 86400;
export const RATES = [
  [1, 'real time'],
  [10, '10 s / s'],
  [60, '1 min / s'],
  [600, '10 min / s'],
  [3600, '1 hour / s'],
  [6 * 3600, '6 hours / s'],
  [86400, '1 day / s'],
  [7 * 86400, '1 week / s'],
  [30 * 86400, '1 month / s'],
  [YEAR, '1 year / s'],
  [10 * YEAR, '10 years / s'],
];

export class Clock {
  constructor() {
    this.jd = jdFromDate(new Date());
    this.rateIndex = 0;
    this.direction = 1;
    this.paused = false;
  }

  get rate() {
    return this.paused ? 0 : RATES[this.rateIndex][0] * this.direction;
  }

  tick(dtSeconds) {
    this.jd += (this.rate * dtSeconds) / 86400;
    // keep within the range where the approximate ephemerides stay meaningful
    if (this.jd < 1721425.5) this.jd = 1721425.5; // 1 AD
    if (this.jd > 2816787.5) this.jd = 2816787.5; // 3000 AD
  }
}

export class TimeBar {
  constructor(root, clock) {
    this.clock = clock;
    root.innerHTML = `
      <div class="date" title="Click to set the date"></div>
      <input class="date-input" type="datetime-local" step="1" hidden />
      <div class="controls">
        <button data-act="reverse" title="Reverse time (R)">⇆</button>
        <button data-act="slower" title="Slower (,)">«</button>
        <button data-act="pause" title="Pause / play (Space)">❚❚</button>
        <button data-act="faster" title="Faster (.)">»</button>
        <button data-act="now" title="Jump to now (N)">Now</button>
      </div>
      <div class="rate"></div>`;
    this.dateEl = root.querySelector('.date');
    this.rateEl = root.querySelector('.rate');
    this.input = root.querySelector('.date-input');
    this.pauseBtn = root.querySelector('[data-act="pause"]');
    this.reverseBtn = root.querySelector('[data-act="reverse"]');
    root.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => this.act(b.dataset.act)));

    this.dateEl.addEventListener('click', () => {
      const d = dateFromJd(clock.jd);
      this.input.value = d.toISOString().slice(0, 19);
      this.input.hidden = false;
      this.dateEl.hidden = true;
      this.input.focus();
    });
    const commit = () => {
      if (this.input.value) {
        const d = new Date(`${this.input.value}Z`);
        if (!isNaN(d.getTime())) clock.jd = jdFromDate(d);
      }
      this.input.hidden = true;
      this.dateEl.hidden = false;
    };
    this.input.addEventListener('change', commit);
    this.input.addEventListener('blur', commit);
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === 'Escape') this.input.blur();
    });
    this.render();
  }

  act(action) {
    const c = this.clock;
    if (action === 'pause') c.paused = !c.paused;
    if (action === 'slower') c.rateIndex = Math.max(0, c.rateIndex - 1);
    if (action === 'faster') c.rateIndex = Math.min(RATES.length - 1, c.rateIndex + 1);
    if (action === 'reverse') c.direction *= -1;
    if (action === 'now') {
      c.jd = jdFromDate(new Date());
      c.rateIndex = 0;
      c.direction = 1;
      c.paused = false;
    }
    if ((action === 'slower' || action === 'faster') && c.paused) c.paused = false;
    this.render();
  }

  render() {
    const c = this.clock;
    this.pauseBtn.textContent = c.paused ? '▶' : '❚❚';
    this.reverseBtn.classList.toggle('on', c.direction < 0);
    this.rateEl.textContent = c.paused ? 'paused' : `${c.direction < 0 ? '−' : ''}${RATES[c.rateIndex][1]}`;
  }

  update() {
    this.dateEl.textContent = formatDate(this.clock.jd);
  }
}
