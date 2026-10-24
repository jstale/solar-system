// Julian dates. UTC vs TT (~69 s) is ignored: irrelevant at this level of accuracy.

export function jdFromDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

export function dateFromJd(jd) {
  return new Date((jd - 2440587.5) * 86400000);
}

/** JPL-style epoch "2000-01-01.5" (fractional day) -> JD */
export function jdFromEpochString(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(\.\d+)?$/.exec(s.trim());
  if (!m) throw new Error(`bad epoch ${s}`);
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]) + (m[4] ? parseFloat(m[4]) * 86400000 : 0);
  return ms / 86400000 + 2440587.5;
}

export function formatDate(jd) {
  const d = dateFromJd(jd);
  if (isNaN(d.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  const y = d.getUTCFullYear();
  const year = y < 0 ? `${-y + 1} BC` : String(y).padStart(4, '0');
  return `${year}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}
