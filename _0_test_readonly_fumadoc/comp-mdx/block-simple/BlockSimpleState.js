const toneSet = new Set([
  'info',
  'note',
  'tip',
  'important',
  'success',
  'warning',
  'caution',
  'error',
]);

function blockSimpleToneGet(data = {}) {
  const toneInput = String(data.type ?? data.tone ?? 'info').trim().toLowerCase();
  return toneSet.has(toneInput) ? toneInput : 'info';
}

function blockSimpleTitleGet(data = {}, tone = blockSimpleToneGet(data)) {
  const title = String(data.title ?? '').trim();
  return title || tone.toUpperCase();
}

function blockSimpleIsTitleHiddenGet(data = {}) {
  return data.isTitleHidden === true
    || String(data.isTitleHidden ?? '').trim().toLowerCase() === 'true';
}

export { blockSimpleIsTitleHiddenGet, blockSimpleTitleGet, blockSimpleToneGet };
