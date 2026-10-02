// Localized text: a non-empty string, or a mapping of language code to
// non-empty string kept in authored order. Shared by part indexes and
// side-panel item labels, so both select a translation the same way.
//
//   text: Guide
//   text:
//     jp: 手引き
//     en: Guide

// Checks and trims an authored value. message is '' when the value is usable;
// otherwise it completes a sentence such as `Index title ${message}`.
export function textLocalizedParse(value) {
  if (typeof value === 'string') {
    if (!textIs(value)) return { textLocalized: '', message: 'must be non-empty text.' };
    return { textLocalized: value.trim(), message: '' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { textLocalized: '', message: 'must be text or a language mapping.' };
  }
  const textLocalized = Object.fromEntries(
    Object.entries(value)
      .filter(([language, text]) => textIs(language) && textIs(text))
      .map(([language, text]) => [language.trim(), text.trim()]),
  );
  if (Object.keys(textLocalized).length === 0) {
    return { textLocalized: '', message: 'requires at least one translation.' };
  }
  return { textLocalized, message: '' };
}

// Selects the text to display:
//   string                          -> the string, language ''
//   mapping with languagePreferred  -> that translation
//   otherwise                       -> the first authored translation
export function textLocalizedGet(value, languagePreferred = '') {
  if (typeof value === 'string') return { language: '', text: value };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { language: '', text: '' };
  }
  const language = textIs(value[languagePreferred])
    ? languagePreferred
    : Object.keys(value).find((key) => textIs(value[key])) ?? '';
  return {
    language,
    text: language ? String(value[language]) : '',
  };
}

function textIs(value) {
  return typeof value === 'string' && value.trim() !== '';
}
