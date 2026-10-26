import {
  multiLangLanguageListParse,
  multiLangMarkdownParse,
  multiLangMarkdownTextGet,
} from './MultiLangParagraphData.js';

export function multiLangListParse(raw, languagesValue) {
  const languageList = multiLangLanguageListParse(languagesValue);
  if (languageList.length === 0) {
    return { error: 'list format requires a non-empty languages list', languageList, list: null };
  }

  const tree = multiLangMarkdownParse(raw);
  if (tree.children.length !== 1 || tree.children[0].type !== 'list') {
    return { error: 'list format requires exactly one Markdown list', languageList, list: null };
  }
  const error = listValidate(tree.children[0], languageList.length);
  return { error, languageList, list: error ? null : tree.children[0] };
}

export function multiLangListLanguageListGet(_raw, { props } = {}) {
  return multiLangLanguageListParse(props?.languages);
}

export function multiLangListStructuredDataGet(raw, { props } = {}) {
  const result = multiLangListParse(raw, props?.languages);
  if (result.error) return { contents: [] };
  const contents = [];
  listContentCollect(result.list, contents);
  return { contents };
}

function listValidate(list, languageCount) {
  if (list.children.length === 0 || list.children.length % languageCount !== 0) {
    return `each list requires a positive multiple of ${languageCount} items`;
  }
  for (const item of list.children) {
    const paragraphList = item.children.filter((child) => child.type === 'paragraph');
    if (paragraphList.length !== 1) return 'each list item requires exactly one paragraph';
    for (const child of item.children) {
      if (child.type !== 'paragraph' && child.type !== 'list') {
        return 'list items may contain only one paragraph and nested lists';
      }
      if (child.type === 'list') {
        const error = listValidate(child, languageCount);
        if (error) return error;
      }
    }
  }
  return '';
}

function listContentCollect(list, contents) {
  for (const item of list.children) {
    const paragraph = item.children.find((child) => child.type === 'paragraph');
    contents.push({ content: multiLangMarkdownTextGet(paragraph) });
    for (const child of item.children) {
      if (child.type === 'list') listContentCollect(child, contents);
    }
  }
}