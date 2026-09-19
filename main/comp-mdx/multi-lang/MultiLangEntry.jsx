import { useMemo } from 'react';
import { DocLanguageProvider, useDocLanguage } from './MultiLangContext.jsx';
import {
  multiLangContentParse,
  multiLangTranslationGet,
  valueIsText,
} from './MultiLangData.js';
import { MultiLangList } from './MultiLangList.jsx';
import { MultiLangParagraphs } from './MultiLangParagraph.jsx';

// Shared entry for degradation-compatible multilingual basic components.
// A marked YAML block may contain paragraphs and recursively nested lists.
export function DocMultiLang({ data = {}, config = {} }) {
  const languageOwn = typeof data.language === 'string' ? data.language.trim() : '';

  if (data.type === 'paragraphs') {
    return (
      <DocLanguageProvider language={languageOwn}>
        <MultiLangParagraphs data={data} sourcePath={config.sourcePath} />
      </DocLanguageProvider>
    );
  }
  if (data.type === 'list') {
    return (
      <DocLanguageProvider language={languageOwn}>
        <MultiLangList data={data} sourcePath={config.sourcePath} />
      </DocLanguageProvider>
    );
  }
  return <DocMultiLangYaml data={data} languageOwn={languageOwn} />;
}

function DocMultiLangYaml({ data, languageOwn }) {
  const languageAncestor = useDocLanguage();
  const result = useMemo(() => multiLangContentParse(data.raw ?? ''), [data.raw]);
  const languagePreferred = languageOwn || languageAncestor;

  if (result.error) {
    return <MultiLangError message={result.error} raw={data.raw} />;
  }

  return (
    <DocLanguageProvider language={languageOwn}>
      {result.itemList.map((item, index) => (
        <MultiLangContentItem
          key={index}
          index={index}
          item={item}
          languagePreferred={languagePreferred}
        />
      ))}
    </DocLanguageProvider>
  );
}

// Inline renderer inserted into native Markdown heading nodes by the remark plugin.
export function MultiLangHeadingText({ variantsJson = '{}' }) {
  const languagePreferred = useDocLanguage();
  let translationByLanguage = {};
  try {
    translationByLanguage = JSON.parse(variantsJson);
  } catch {
    return null;
  }
  const languageRendered = languageRenderedGet(translationByLanguage, languagePreferred);
  return languageRendered
    ? <span lang={languageRendered}>{inlineContentRender(String(translationByLanguage[languageRendered]))}</span>
    : null;
}

function MultiLangContentItem({ index, item, languagePreferred }) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return <MultiLangError message={`item ${index + 1} must be a mapping`} />;
  }
  if (item.type === 'p') {
    return <MultiLangParagraph index={index} item={item} languagePreferred={languagePreferred} />;
  }
  if (item.type === 'ul' || item.type === 'ol') {
    return <MultiLangYamlList item={item} languagePreferred={languagePreferred} />;
  }
  return <MultiLangError message={`item ${index + 1} has unsupported type: ${String(item.type ?? '(missing)')}`} />;
}

function MultiLangParagraph({ index, item, languagePreferred }) {
  const translationByLanguage = multiLangTranslationGet(item);
  const languageRendered = languageRenderedGet(translationByLanguage, languagePreferred);
  if (!languageRendered) {
    return <MultiLangError message={`paragraph ${index + 1} has no text translation`} />;
  }
  return <p lang={languageRendered}>{inlineContentRender(String(translationByLanguage[languageRendered]))}</p>;
}

function MultiLangYamlList({ item, languagePreferred }) {
  const ListTag = item.type === 'ol' ? 'ol' : 'ul';
  if (!Array.isArray(item.items)) {
    return <MultiLangError message={`${item.type} must contain an items list`} />;
  }
  return (
    <ListTag>
      {item.items.map((listItem, index) => (
        <MultiLangListItem
          key={index}
          index={index}
          item={listItem}
          languagePreferred={languagePreferred}
        />
      ))}
    </ListTag>
  );
}

function MultiLangListItem({ index, item, languagePreferred }) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return <li><MultiLangError message={`list item ${index + 1} must be a mapping`} /></li>;
  }
  const translationByLanguage = multiLangTranslationGet(item);
  const languageRendered = languageRenderedGet(translationByLanguage, languagePreferred);
  const childList = Array.isArray(item.children) ? item.children : [];
  if (!languageRendered) {
    return <li><MultiLangError message={`list item ${index + 1} has no text translation`} /></li>;
  }
  return (
    <li lang={languageRendered}>
      {inlineContentRender(String(translationByLanguage[languageRendered]))}
      {childList.map((child, childIndex) => (
        child?.type === 'ul' || child?.type === 'ol'
          ? <MultiLangYamlList key={childIndex} item={child} languagePreferred={languagePreferred} />
          : <MultiLangError key={childIndex} message={`child ${childIndex + 1} must have type ul or ol`} />
      ))}
    </li>
  );
}

function languageRenderedGet(translationByLanguage, languagePreferred) {
  if (valueIsText(translationByLanguage[languagePreferred])) return languagePreferred;
  return Object.keys(translationByLanguage).find(
    (language) => valueIsText(translationByLanguage[language]),
  );
}

function inlineContentRender(text) {
  return text.split(/(`[^`]+`)/g).filter(Boolean).map((part, index) => (
    part.startsWith('`') && part.endsWith('`')
      ? <code key={index}>{part.slice(1, -1)}</code>
      : part
  ));
}

function MultiLangError({ message, raw }) {
  return (
    <div className="not-prose my-2 rounded-sm border border-red-300 p-2 text-sm text-red-600 select-text dark:border-red-700 dark:text-red-400" role="alert">
      <p className="font-medium">{message}</p>
      {raw ? <pre className="mt-1 whitespace-pre-wrap text-xs">{raw}</pre> : null}
    </div>
  );
}