import { parse as parseYaml } from 'yaml';

const KEY_LIST_STRUCTURAL = new Set(['children', 'items', 'text', 'type']);

export function multiLangContentParse(raw) {
  try {
    const value = parseYaml(raw);
    if (!Array.isArray(value)) {
      return { error: 'multilingual content must be a YAML list', itemList: [] };
    }
    return { error: '', itemList: value };
  } catch (error) {
    return {
      error: `failed to parse multilingual YAML: ${String(error?.message ?? error)}`,
      itemList: [],
    };
  }
}

export function multiLangLanguageListGet(raw) {
  const result = multiLangContentParse(raw);
  if (result.error) return [];
  const languageSet = new Set();
  for (const item of result.itemList) languageCollect(item, languageSet);
  return [...languageSet];
}

export function multiLangStructuredDataGet(raw) {
  const result = multiLangContentParse(raw);
  if (result.error) return { contents: [] };
  const contents = [];
  for (const item of result.itemList) contentCollect(item, contents);
  return { contents };
}

export function multiLangTranslationGet(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value.text && typeof value.text === 'object' && !Array.isArray(value.text)
    ? value.text
    : value;
  return Object.fromEntries(
    Object.entries(source).filter(([key, item]) => !KEY_LIST_STRUCTURAL.has(key) && valueIsText(item)),
  );
}

export function valueIsText(value) {
  return typeof value === 'string' || typeof value === 'number';
}

function languageCollect(value, languageSet) {
  if (Array.isArray(value)) {
    for (const item of value) languageCollect(item, languageSet);
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const language of Object.keys(multiLangTranslationGet(value))) languageSet.add(language);
  languageCollect(value.items, languageSet);
  languageCollect(value.children, languageSet);
}

function contentCollect(value, contents) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const text of Object.values(multiLangTranslationGet(value))) {
    contents.push({ content: String(text) });
  }
  if (Array.isArray(value.items)) {
    for (const item of value.items) contentCollect(item, contents);
  }
  if (Array.isArray(value.children)) {
    for (const child of value.children) contentCollect(child, contents);
  }
}