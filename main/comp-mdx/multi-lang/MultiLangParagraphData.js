import { remark } from 'remark';
import remarkGfm from 'remark-gfm';

const markdownParser = remark().use(remarkGfm);

export function multiLangParagraphsParse(raw, languagesValue) {
  const languageList = multiLangLanguageListParse(languagesValue);
  if (languageList.length === 0) {
    return { error: 'paragraphs format requires a non-empty languages list', groupList: [], languageList };
  }

  const tree = multiLangMarkdownParse(raw);
  const paragraphList = tree.children.filter((node) => node.type === 'paragraph');
  if (paragraphList.length !== tree.children.length) {
    return { error: 'paragraphs format accepts paragraphs only', groupList: [], languageList };
  }
  if (paragraphList.length === 0 || paragraphList.length % languageList.length !== 0) {
    return {
      error: `paragraphs format requires a positive multiple of ${languageList.length} paragraphs`,
      groupList: [],
      languageList,
    };
  }

  const groupList = [];
  for (let index = 0; index < paragraphList.length; index += languageList.length) {
    groupList.push(Object.fromEntries(
      languageList.map((language, languageIndex) => [language, paragraphList[index + languageIndex]]),
    ));
  }
  return { error: '', groupList, languageList };
}

export function multiLangParagraphsLanguageListGet(_raw, { props } = {}) {
  return multiLangLanguageListParse(props?.languages);
}

export function multiLangParagraphsStructuredDataGet(raw, { props } = {}) {
  const result = multiLangParagraphsParse(raw, props?.languages);
  if (result.error) return { contents: [] };
  return {
    contents: result.groupList.flatMap((group) => (
      Object.values(group).map((paragraph) => ({ content: multiLangMarkdownTextGet(paragraph) }))
    )),
  };
}

export function multiLangLanguageListParse(value) {
  if (Array.isArray(value)) return languageListNormalize(value);
  if (typeof value !== 'string') return [];
  const source = value.trim();
  if (!source.startsWith('[') || !source.endsWith(']')) return [];
  return languageListNormalize(source.slice(1, -1).split(','));
}

export function multiLangMarkdownParse(raw) {
  return markdownParser.parse(raw);
}

export function multiLangMarkdownTextGet(node) {
  if (typeof node?.value === 'string') return node.value;
  if (!Array.isArray(node?.children)) return '';
  return node.children.map(multiLangMarkdownTextGet).join('');
}

function languageListNormalize(valueList) {
  const languageList = valueList.map((value) => String(value).trim()).filter(Boolean);
  return languageList.length === new Set(languageList).size ? languageList : [];
}
