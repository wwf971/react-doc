// time-format.md: 20260520_23250530+09. local time to 10 ms, then the zone
// offset in whole hours. used by the asset service layer (event and version times)
// and for names made of a moment (a pasted image file).
export function timeTextGet(date = new Date()) {
  const pad = (value, length = 2) => String(value).padStart(length, '0');
  const zoneHours = -Math.round(date.getTimezoneOffset() / 60);
  const zoneText = `${zoneHours < 0 ? '-' : '+'}${pad(Math.abs(zoneHours))}`;
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}${pad(Math.floor(date.getMilliseconds() / 10))}`
    + zoneText;
}

// a time as a person reads it, ALWAYS with its zone: "2026-11-15 04:44 +09". a time shown
// without a zone cannot be told from the same digits elsewhere, so no part of the page shows one.
//   time      a text of the project's format (20261115_04441234+09: shown in the zone it carries),
//             a number of milliseconds or a Date (shown in the zone of the browser), or an iso text
//   part      'minute' (default) | 'second' | 'date': how far the time is spelled out
//   isYearShown   false leaves the year out (a list of recent things): "11-15 04:44 +09"
// '' for a time that is none
export function timeTextDisplay(time, { part = 'minute', isYearShown = true } = {}) {
  const pad = (value) => String(value).padStart(2, '0');
  let field;
  const match = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})?\d*([+-]\d{2})?/.exec(typeof time === 'string' ? time : '');
  if (match) {
    field = { year: match[1], month: match[2], day: match[3], hour: match[4], minute: match[5], second: match[6] ?? '00', zone: match[7] ?? '+00' };
  } else {
    if (time === undefined || time === null || time === '' || time === 0) return '';
    const date = time instanceof Date ? time : new Date(time);
    if (Number.isNaN(date.getTime())) return '';
    const zoneHours = -Math.round(date.getTimezoneOffset() / 60);
    field = {
      year: String(date.getFullYear()), month: pad(date.getMonth() + 1), day: pad(date.getDate()),
      hour: pad(date.getHours()), minute: pad(date.getMinutes()), second: pad(date.getSeconds()),
      zone: `${zoneHours < 0 ? '-' : '+'}${pad(Math.abs(zoneHours))}`,
    };
  }
  const dateText = isYearShown ? `${field.year}-${field.month}-${field.day}` : `${field.month}-${field.day}`;
  if (part === 'date') return `${dateText} ${field.zone}`;
  return `${dateText} ${field.hour}:${field.minute}${part === 'second' ? `:${field.second}` : ''} ${field.zone}`;
}
