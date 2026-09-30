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
  return booleanAuthoredIs(data.isTitleHidden);
}

function blockSimpleIsCopyEnabledGet(data = {}) {
  return booleanAuthoredIs(data.isCopyEnabled);
}

// the body that is rendered and copied: quote markers and GitHub alert marker
// lines removed, Markdown inside kept as written.
//   > [!INFO]
//   > Run `npm install`.     ->  Run `npm install`.
function blockSimpleSourceGet(data = {}) {
  return String(data.raw ?? '')
    .split('\n')
    .map((line) => line.replace(/^> ?/, ''))
    .filter((line) => !alertMarkerPattern.test(line.trim()))
    .join('\n')
    .trim();
}

const alertMarkerPattern = /^\[!(?:CAUTION|WARNING|INFO|NOTE|ERROR|TIP|IMPORTANT|SUCCESS)\]$/i;

// boolean true or the case-insensitive string "true"
function booleanAuthoredIs(value) {
  return value === true || String(value ?? '').trim().toLowerCase() === 'true';
}

export {
  blockSimpleIsCopyEnabledGet,
  blockSimpleIsTitleHiddenGet,
  blockSimpleSourceGet,
  blockSimpleTitleGet,
  blockSimpleToneGet,
};
