// time-format.md: 20260520_23250530+09. local time to 10 ms, then the zone
// offset in whole hours. used by the asset store (event and version times)
// and for names made of a moment (a pasted image file).
export function timeTextGet(date = new Date()) {
  const pad = (value, length = 2) => String(value).padStart(length, '0');
  const zoneHours = -Math.round(date.getTimezoneOffset() / 60);
  const zoneText = `${zoneHours < 0 ? '-' : '+'}${pad(Math.abs(zoneHours))}`;
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}${pad(Math.floor(date.getMilliseconds() / 10))}`
    + zoneText;
}
